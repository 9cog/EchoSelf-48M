/**
 * Shared model resolver for every service in src/ that calls a language model.
 *
 * Resolution order (first match wins):
 *  1. Explicit configuration:
 *     - base URL of an OpenAI-compatible API (`echo_model_base_url` in
 *       localStorage, or VITE_ECHO_MODEL_BASE_URL / ECHO_MODEL_BASE_URL),
 *       optional model name (`echo_model_name` / ECHO_MODEL_NAME) and API key
 *       (`openai_api_key` / ECHO_MODEL_API_KEY / OPENAI_API_KEY);
 *     - or just an OpenAI API key, which targets https://api.openai.com/v1.
 *  2. Otherwise a locally served model is auto-discovered and VERIFIED: the
 *     server must list at least one model (Ollama /api/tags, OpenAI-compatible
 *     /v1/models on the usual local ports, or the repo's NanEcho server /status
 *     with `model_loaded: true`). A server that answers without a model is not
 *     used.
 *  3. Nothing configured or verified: a ModelUnavailableError explains how to
 *     fix it. No text is ever produced in place of the model.
 *
 * The resolved endpoint is cached and re-resolved after connection failures or
 * when the settings change.
 */
import OpenAI from "openai";

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ModelEndpoint {
  /** Wire protocol: OpenAI-compatible chat completions or NanEcho /chat. */
  kind: "openai" | "nanecho";
  /** "explicit" = configured by the user; "local" = discovered and verified. */
  source: "explicit" | "local";
  baseURL: string;
  apiKey: string;
  model: string;
  /** True when the model name came from configuration or discovery (not a default). */
  modelPinned: boolean;
  /** Human-readable description for status displays. */
  label: string;
}

export interface CompletionOptions {
  /** Requested model; honoured only for an explicit endpoint without a pinned model. */
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Receives real model tokens as they arrive (OpenAI-compatible endpoints). */
  onToken?: (token: string) => void;
}

export interface ModelSettings {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  /** Extra local base URLs to probe first (comma separated in storage). */
  localURLs?: string[];
}

export class ModelUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelUnavailableError";
  }
}

/** localStorage keys used by the settings UI. */
export const MODEL_SETTINGS_KEYS = {
  apiKey: "openai_api_key",
  baseURL: "echo_model_base_url",
  model: "echo_model_name",
  localURLs: "echo_model_local_urls",
} as const;

const OPENAI_BASE_URL = "https://api.openai.com/v1";
/** Used only when the hosted OpenAI API is configured without a model name. */
export const DEFAULT_HOSTED_MODEL = "gpt-4o-mini";
const PROBE_TIMEOUT_MS = 1500;
const LOCAL_DUMMY_KEY = "local-model";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

let runtimeOverrides: ModelSettings = {};

function readStorage(key: string): string | undefined {
  try {
    if (typeof localStorage === "undefined") return undefined;
    const value = localStorage.getItem(key);
    return value && value.trim() ? value.trim() : undefined;
  } catch {
    return undefined;
  }
}

function readEnv(...names: string[]): string | undefined {
  const viteEnv = (import.meta as { env?: Record<string, unknown> }).env;
  const nodeEnv = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process?.env;
  for (const name of names) {
    const fromVite = viteEnv?.[`VITE_${name}`];
    if (typeof fromVite === "string" && fromVite.trim()) return fromVite.trim();
    const fromNode = nodeEnv?.[name];
    if (typeof fromNode === "string" && fromNode.trim()) return fromNode.trim();
  }
  return undefined;
}

const splitList = (value?: string): string[] =>
  (value || "")
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);

/** Current effective settings: runtime overrides > localStorage > env. */
export function readModelSettings(): ModelSettings {
  return {
    apiKey:
      runtimeOverrides.apiKey ??
      readStorage(MODEL_SETTINGS_KEYS.apiKey) ??
      readEnv("ECHO_MODEL_API_KEY", "OPENAI_API_KEY"),
    baseURL:
      runtimeOverrides.baseURL ??
      readStorage(MODEL_SETTINGS_KEYS.baseURL) ??
      readEnv("ECHO_MODEL_BASE_URL"),
    model:
      runtimeOverrides.model ??
      readStorage(MODEL_SETTINGS_KEYS.model) ??
      readEnv("ECHO_MODEL_NAME"),
    localURLs:
      runtimeOverrides.localURLs ??
      splitList(
        readStorage(MODEL_SETTINGS_KEYS.localURLs) ??
          readEnv("ECHO_MODEL_LOCAL_URLS")
      ),
  };
}

/**
 * Persist settings from the UI (empty strings clear a field) and drop the
 * cached endpoint so the next call re-resolves.
 */
export function saveModelSettings(settings: ModelSettings): void {
  const write = (key: string, value: string | undefined) => {
    try {
      if (typeof localStorage === "undefined") return;
      if (value && value.trim()) localStorage.setItem(key, value.trim());
      else localStorage.removeItem(key);
    } catch {
      // storage unavailable: runtime overrides below still apply
    }
  };
  if ("apiKey" in settings) write(MODEL_SETTINGS_KEYS.apiKey, settings.apiKey);
  if ("baseURL" in settings)
    write(MODEL_SETTINGS_KEYS.baseURL, settings.baseURL);
  if ("model" in settings) write(MODEL_SETTINGS_KEYS.model, settings.model);
  if ("localURLs" in settings)
    write(MODEL_SETTINGS_KEYS.localURLs, settings.localURLs?.join(","));
  runtimeOverrides = {};
  invalidateModel();
}

/** In-memory configuration (e.g. a key passed to a service's initialize()). */
export function setModelOverrides(settings: ModelSettings): void {
  runtimeOverrides = { ...runtimeOverrides, ...settings };
  invalidateModel();
}

/** True when the user has configured a key or base URL. */
export function hasExplicitModelConfig(): boolean {
  const settings = readModelSettings();
  return !!(settings.apiKey || settings.baseURL);
}

// ---------------------------------------------------------------------------
// Probing
// ---------------------------------------------------------------------------

type FetchLike = typeof fetch;
let fetchImpl: FetchLike | null = null;

/** Test hook: substitute the fetch implementation used for probes and calls. */
export function setModelFetch(impl: FetchLike | null): void {
  fetchImpl = impl;
  invalidateModel();
}

const doFetch: FetchLike = (input, init) =>
  (fetchImpl ?? globalThis.fetch)(input, init);

interface ProbeOutcome {
  endpoint?: ModelEndpoint;
  /** Why this candidate was not used. */
  problem?: string;
}

const trimSlash = (url: string) => url.replace(/\/+$/, "");
const originOf = (url: string) => {
  try {
    return new URL(url).origin;
  } catch {
    return trimSlash(url);
  }
};

async function getJson(url: string, apiKey?: string): Promise<unknown> {
  try {
    return await getJsonOnce(url, apiKey);
  } catch (error) {
    // One immediate retry: a server restart leaves stale keep-alive sockets
    // whose first reuse fails like a refused connection
    if ((error as { retryable?: boolean }).retryable) {
      return getJsonOnce(url, apiKey);
    }
    throw error;
  }
}

async function getJsonOnce(url: string, apiKey?: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await doFetch(url, {
      signal: controller.signal,
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("no answer (timeout)");
    }
    if (error instanceof TypeError) {
      // fetch() reports refused connections and CORS rejections identically
      throw Object.assign(
        new Error("unreachable (not running, or blocked by CORS)"),
        { retryable: true }
      );
    }
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    clearTimeout(timer);
  }
}

/** Pick the configured model if served, else the first one listed. */
function chooseModel(
  served: string[],
  where: string,
  wanted?: string
): { model?: string; problem?: string } {
  if (served.length === 0) {
    return { problem: `${where} answered but lists no model` };
  }
  if (wanted) {
    const match = served.find(
      name => name === wanted || name.split(":")[0] === wanted
    );
    return match
      ? { model: match }
      : {
          problem: `${where} does not serve the configured model "${wanted}" (serves: ${served.join(", ")})`,
        };
  }
  return { model: served[0] };
}

async function probeOllama(
  origin: string,
  wanted?: string
): Promise<ProbeOutcome> {
  const where = `Ollama at ${origin}`;
  try {
    const data = (await getJson(`${origin}/api/tags`)) as {
      models?: Array<{ name?: string; model?: string }>;
    };
    const served = (data.models || [])
      .map(m => m.name || m.model || "")
      .filter(Boolean);
    const { model, problem } = chooseModel(served, where, wanted);
    if (!model) return { problem };
    return {
      endpoint: {
        kind: "openai",
        source: "local",
        baseURL: `${origin}/v1`,
        apiKey: LOCAL_DUMMY_KEY,
        model,
        modelPinned: true,
        label: `${model} (Ollama, ${origin})`,
      },
    };
  } catch (error) {
    return { problem: `${where}: ${(error as Error).message}` };
  }
}

async function probeOpenAICompatible(
  baseURL: string,
  wanted?: string,
  apiKey?: string,
  source: ModelEndpoint["source"] = "local"
): Promise<ProbeOutcome> {
  const base = trimSlash(baseURL);
  const where = `OpenAI-compatible server at ${base}`;
  try {
    const data = (await getJson(`${base}/models`, apiKey)) as {
      data?: Array<{ id?: string }>;
    };
    const served = (data.data || []).map(m => m.id || "").filter(Boolean);
    const { model, problem } = chooseModel(served, where, wanted);
    if (!model) return { problem };
    return {
      endpoint: {
        kind: "openai",
        source,
        baseURL: base,
        apiKey: apiKey || LOCAL_DUMMY_KEY,
        model,
        modelPinned: true,
        label: `${model} (${base})`,
      },
    };
  } catch (error) {
    return { problem: `${where}: ${(error as Error).message}` };
  }
}

/** EchoSelf's NanEcho servers (NanEcho/server.py :8000, neserver.py :8081). */
async function probeNanEcho(origin: string): Promise<ProbeOutcome> {
  const where = `NanEcho server at ${origin}`;
  try {
    const data = (await getJson(`${origin}/status`)) as {
      model_loaded?: boolean;
      model_path?: string | null;
    };
    if (data.model_loaded !== true) {
      return { problem: `${where} answered but has no model loaded` };
    }
    const model = data.model_path
      ? data.model_path.split(/[\\/]/).pop() || "nanecho"
      : "nanecho";
    return {
      endpoint: {
        kind: "nanecho",
        source: "local",
        baseURL: origin,
        apiKey: "",
        model,
        modelPinned: true,
        label: `${model} (NanEcho, ${origin})`,
      },
    };
  } catch (error) {
    return { problem: `${where}: ${(error as Error).message}` };
  }
}

const LOCAL_HOST = "http://127.0.0.1";
const OPENAI_COMPATIBLE_PORTS = [8080, 1234, 8000, 5000];
const NANECHO_PORTS = [8081, 8000];

function localCandidates(
  settings: ModelSettings
): Array<() => Promise<ProbeOutcome>> {
  const wanted = settings.model;
  const candidates: Array<() => Promise<ProbeOutcome>> = [];

  for (const url of settings.localURLs || []) {
    const base = trimSlash(url);
    const origin = originOf(base);
    const v1 = /\/v1$/.test(base) ? base : `${base}/v1`;
    candidates.push(async () => {
      const problems: string[] = [];
      for (const probe of [
        () => probeOpenAICompatible(v1, wanted),
        () => probeOllama(origin, wanted),
        () => probeNanEcho(origin),
      ]) {
        const outcome = await probe();
        if (outcome.endpoint) return outcome;
        if (outcome.problem) problems.push(outcome.problem);
      }
      return { problem: problems.join("; ") };
    });
  }

  candidates.push(() => probeOllama(`${LOCAL_HOST}:11434`, wanted));
  for (const port of OPENAI_COMPATIBLE_PORTS) {
    candidates.push(() =>
      probeOpenAICompatible(`${LOCAL_HOST}:${port}/v1`, wanted)
    );
  }
  if (!wanted) {
    // NanEcho serves exactly one checkpoint; it cannot honour a model name
    for (const port of NANECHO_PORTS) {
      candidates.push(() => probeNanEcho(`${LOCAL_HOST}:${port}`));
    }
  }
  return candidates;
}

function originHint(): string {
  try {
    if (typeof window !== "undefined" && window.location?.origin) {
      return window.location.origin;
    }
  } catch {
    // not in a browser
  }
  return "<this app's origin>";
}

function unavailableMessage(problems: string[]): string {
  const lines = [
    "No language model is available, so no character reply can be generated.",
    "Fix it by either:",
    "- setting an API key and/or an OpenAI-compatible base URL and model in the chat settings, or",
    "- serving a local model: e.g. `ollama serve` and `ollama pull llama3.2` (from a browser page Ollama must allow this origin: start it with OLLAMA_ORIGINS=" +
      originHint() +
      "), or llama.cpp server (:8080), LM Studio (:1234), vLLM (:8000), text-generation-webui (:5000), or the NanEcho server (NanEcho/neserver.py :8081, NanEcho/server.py :8000).",
  ];
  if (problems.length > 0) {
    lines.push("Local servers probed:");
    problems.forEach(problem => lines.push(`- ${problem}`));
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Resolution + cache
// ---------------------------------------------------------------------------

let cached: ModelEndpoint | null = null;
let inFlight: Promise<ModelEndpoint> | null = null;
let generation = 0;
const listeners = new Set<(endpoint: ModelEndpoint | null) => void>();

/** Forget the resolved endpoint; the next call resolves again. */
export function invalidateModel(): void {
  cached = null;
  inFlight = null;
  generation += 1;
  listeners.forEach(listener => listener(null));
}

/** The endpoint resolved by the last successful resolution, if any. */
export function getCachedModel(): ModelEndpoint | null {
  return cached;
}

/** Subscribe to endpoint changes (resolution or invalidation). */
export function onModelChange(
  listener: (endpoint: ModelEndpoint | null) => void
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function resolveUncached(): Promise<ModelEndpoint> {
  const settings = readModelSettings();

  if (settings.baseURL) {
    const base = trimSlash(settings.baseURL);
    if (settings.model) {
      return {
        kind: "openai",
        source: "explicit",
        baseURL: base,
        apiKey: settings.apiKey || LOCAL_DUMMY_KEY,
        model: settings.model,
        modelPinned: true,
        label: `${settings.model} (${base})`,
      };
    }
    // Base URL without a model name: use what the server says it serves
    const outcome = await probeOpenAICompatible(
      base,
      undefined,
      settings.apiKey,
      "explicit"
    );
    if (outcome.endpoint) return outcome.endpoint;
    throw new ModelUnavailableError(
      `The configured model base URL could not be used: ${outcome.problem}. Set a model name in the chat settings or check the server.`
    );
  }

  if (settings.apiKey) {
    const model = settings.model || DEFAULT_HOSTED_MODEL;
    return {
      kind: "openai",
      source: "explicit",
      baseURL: OPENAI_BASE_URL,
      apiKey: settings.apiKey,
      model,
      modelPinned: !!settings.model,
      label: `${model} (OpenAI API)`,
    };
  }

  // Probe all local candidates in parallel; take the first verified one in
  // priority order
  const outcomes = await Promise.all(
    localCandidates(settings).map(candidate => candidate())
  );
  const found = outcomes.find(outcome => outcome.endpoint);
  if (found?.endpoint) return found.endpoint;

  const problems = outcomes
    .map(outcome => outcome.problem)
    .filter((p): p is string => !!p);
  if (settings.model) {
    problems.unshift(
      `Configured model name "${settings.model}" is not served by any local server.`
    );
  }
  throw new ModelUnavailableError(unavailableMessage(problems));
}

/**
 * Resolve the model endpoint (cached). Throws ModelUnavailableError with
 * instructions when nothing is configured and no local model is verified.
 */
export async function resolveModel(force = false): Promise<ModelEndpoint> {
  if (force) invalidateModel();
  if (cached) return cached;
  if (!inFlight) {
    const myGeneration = generation;
    inFlight = resolveUncached().then(
      endpoint => {
        if (myGeneration === generation) {
          cached = endpoint;
          inFlight = null;
          listeners.forEach(listener => listener(endpoint));
        }
        return endpoint;
      },
      error => {
        if (myGeneration === generation) inFlight = null;
        throw error;
      }
    );
  }
  return inFlight;
}

/** True if a model is configured or a local one has already been verified. */
export function isModelKnownAvailable(): boolean {
  return !!cached || hasExplicitModelConfig();
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

const clients = new Map<string, OpenAI>();

/** OpenAI SDK client for an OpenAI-compatible endpoint (hosted or local). */
export function getOpenAIClient(endpoint: ModelEndpoint): OpenAI {
  const key = `${endpoint.baseURL}|${endpoint.apiKey}`;
  let client = clients.get(key);
  if (!client) {
    client = new OpenAI({
      apiKey: endpoint.apiKey || LOCAL_DUMMY_KEY,
      baseURL: endpoint.baseURL,
      dangerouslyAllowBrowser: true,
      maxRetries: 0,
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        doFetch(input, init),
    });
    clients.set(key, client);
  }
  return client;
}

function isConnectionFailure(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (error instanceof OpenAI.APIConnectionError) return true;
  const name = (error as { name?: string } | null)?.name || "";
  return /FetchError/.test(name);
}

function modelFor(endpoint: ModelEndpoint, requested?: string): string {
  return requested && endpoint.source === "explicit" && !endpoint.modelPinned
    ? requested
    : endpoint.model;
}

async function completeOpenAI(
  endpoint: ModelEndpoint,
  messages: ChatMessage[],
  options: CompletionOptions
): Promise<string> {
  const client = getOpenAIClient(endpoint);
  const params = {
    model: modelFor(endpoint, options.model),
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens,
  };

  if (options.onToken) {
    const stream = await client.chat.completions.create({
      ...params,
      stream: true,
    });
    let text = "";
    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta?.content || "";
      if (token) {
        text += token;
        options.onToken(token);
      }
    }
    return text;
  }

  const completion = await client.chat.completions.create(params);
  return completion.choices[0]?.message?.content || "";
}

async function completeNanEcho(
  endpoint: ModelEndpoint,
  messages: ChatMessage[],
  options: CompletionOptions
): Promise<string> {
  // neserver.py has no system role: fold instructions into the user turns
  const system = messages
    .filter(m => m.role === "system")
    .map(m => m.content)
    .join("\n\n");
  const turns = messages.filter(m => m.role !== "system");
  if (system && turns.length > 0) {
    const firstUser = turns.findIndex(m => m.role === "user");
    if (firstUser >= 0) {
      turns[firstUser] = {
        role: "user",
        content: `${system}\n\n${turns[firstUser].content}`,
      };
    }
  }

  const response = await doFetch(`${endpoint.baseURL}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: turns,
      max_tokens: options.maxTokens ?? 500,
      temperature: options.temperature ?? 0.7,
    }),
  });
  if (!response.ok) {
    throw new Error(
      `NanEcho server error ${response.status}: ${await response.text()}`
    );
  }
  const data = (await response.json()) as { text?: string };
  const text = data.text || "";
  if (text && options.onToken) options.onToken(text);
  return text;
}

/**
 * Send a chat to the resolved model and return its reply. Errors propagate;
 * after a connection failure the endpoint is re-resolved once and retried.
 */
export async function chatComplete(
  messages: ChatMessage[],
  options: CompletionOptions = {}
): Promise<string> {
  let streamed = false;
  const tracked: CompletionOptions = options.onToken
    ? {
        ...options,
        onToken: token => {
          streamed = true;
          options.onToken!(token);
        },
      }
    : options;

  const attempt = async (endpoint: ModelEndpoint) =>
    endpoint.kind === "nanecho"
      ? completeNanEcho(endpoint, messages, tracked)
      : completeOpenAI(endpoint, messages, tracked);

  let endpoint = await resolveModel();
  let text: string;
  try {
    text = await attempt(endpoint);
  } catch (error) {
    if (!isConnectionFailure(error) || streamed) {
      throw error;
    }
    invalidateModel();
    endpoint = await resolveModel();
    text = await attempt(endpoint);
  }

  if (!text.trim()) {
    throw new Error(
      `The model (${endpoint.label}) returned an empty response.`
    );
  }
  return text;
}

/** Convenience: one system prompt + one user prompt. */
export function completePrompt(
  systemPrompt: string,
  userPrompt: string,
  options: CompletionOptions = {}
): Promise<string> {
  const messages: ChatMessage[] = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  messages.push({ role: "user", content: userPrompt });
  return chatComplete(messages, options);
}

/**
 * Extract and parse the first JSON object in a model reply. Throws when the
 * reply contains no parseable object (callers validate the fields).
 */
export function parseModelJson<T = Record<string, unknown>>(raw: string): T {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("The model did not return a JSON object.");
  }
  try {
    return JSON.parse(raw.slice(start, end + 1)) as T;
  } catch (error) {
    throw new Error(
      `The model returned malformed JSON: ${(error as Error).message}`
    );
  }
}

/** Format a probe/model error for a system notice. */
export function describeModelError(error: unknown): string {
  if (error instanceof ModelUnavailableError) return error.message;
  const message = error instanceof Error ? error.message : String(error);
  const endpoint = cached;
  return `Model request failed${endpoint ? ` (${endpoint.label})` : ""}: ${message}`;
}
