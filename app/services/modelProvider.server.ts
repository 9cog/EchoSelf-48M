/**
 * Model provider resolution (server side).
 *
 * One resolver shared by the Deep Tree Echo chat service (ai.server.ts) and
 * the EchoLayla adapters. It never produces model output itself: it only
 * decides WHICH real model endpoint is used.
 *
 * Order:
 *   1. Explicit configuration
 *        ECHO_MODEL_BASE_URL (+ ECHO_MODEL_NAME, ECHO_MODEL_API_KEY)
 *            any OpenAI-compatible server, hosted or local
 *        OPENAI_API_KEY (+ OPENAI_BASE_URL, ECHO_MODEL_NAME)
 *        HUGGINGFACE_API_KEY (+ ECHO_MODEL_NAME)
 *        NANECHO_URL  (NanEcho/server.py or NanEcho/neserver.py)
 *   2. Auto-discovery of a locally served model, verified by asking the
 *      server which models it is serving (a server with no model is not used):
 *        ECHO_MODEL_LOCAL_URLS (comma-separated base URLs, probed first)
 *        Ollama                    http://127.0.0.1:11434/api/tags
 *        llama.cpp / LM Studio / vLLM / text-generation-webui
 *                                  http://127.0.0.1:{8080,1234,8000,5000}/v1/models
 *        NanEcho server.py :8000 / neserver.py :8081   GET /status -> model_loaded
 *   3. Nothing available -> AIConfigurationError explaining how to fix it.
 *
 * The result is cached; call invalidateResolvedModel() (done automatically by
 * withResolvedModel) after a connection failure so the next request
 * re-resolves.
 */

import process from "node:process";

/**
 * Thrown when no real model is configured or reachable. Its message is a
 * system-level explanation for the operator, never character output.
 */
export class AIConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIConfigurationError";
  }
}

export type ResolvedModel =
  | {
      kind: "openai-compatible";
      /** Human-readable origin, e.g. "ECHO_MODEL_BASE_URL" or "Ollama (local)". */
      source: string;
      baseURL: string;
      /** Model to request. Undefined only for OPENAI_API_KEY without a name. */
      model?: string;
      /** Undefined for local servers that need no key. */
      apiKey?: string;
      local: boolean;
    }
  | {
      kind: "huggingface";
      source: string;
      apiKey: string;
      model?: string;
      local: false;
    }
  | {
      kind: "nanecho";
      source: string;
      baseURL: string;
      local: boolean;
    };

export interface ModelStatus {
  available: boolean;
  /** e.g. "llama3.1:8b via Ollama (local) at http://127.0.0.1:11434/v1" */
  description?: string;
  error?: string;
}

const DEFAULT_PROBE_TIMEOUT_MS = 1500;
const OPENAI_COMPATIBLE_LOCAL_PORTS: Array<[number, string]> = [
  [8080, "llama.cpp server"],
  [1234, "LM Studio"],
  [8000, "vLLM"],
  [5000, "text-generation-webui"],
];
const NANECHO_LOCAL_PORTS: Array<[number, string]> = [
  [8000, "NanEcho server.py"],
  [8081, "NanEcho neserver.py"],
];

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

function stripSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function probeTimeout(): number {
  const raw = Number(env("ECHO_MODEL_PROBE_TIMEOUT_MS"));
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_PROBE_TIMEOUT_MS;
}

/** Ollama lists "llama3.1:latest" for a model pulled as "llama3.1". */
function sameModel(listed: string, wanted: string): boolean {
  return (
    listed === wanted ||
    listed === `${wanted}:latest` ||
    `${listed}:latest` === wanted
  );
}

async function getJSON(
  url: string,
  headers: Record<string, string> = {}
): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Accept: "application/json", ...headers },
    signal: AbortSignal.timeout(probeTimeout()),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      return "no answer (timeout)";
    }
    const cause = (error as { cause?: { code?: string } }).cause;
    if (cause?.code === "ECONNREFUSED") return "connection refused";
    return cause?.code || error.message;
  }
  return String(error);
}

/** One probe outcome: a verified model, or the reason the candidate failed. */
type ProbeResult =
  | { ok: true; resolved: ResolvedModel }
  | { ok: false; url: string; reason: string };

function pickModel(
  ids: string[],
  wanted: string | undefined,
  url: string
): { ok: true; model: string } | { ok: false; url: string; reason: string } {
  if (ids.length === 0) {
    return { ok: false, url, reason: "server answered but serves no model" };
  }
  if (!wanted) return { ok: true, model: ids[0] };
  const match = ids.find(id => sameModel(id, wanted));
  return match
    ? { ok: true, model: match }
    : {
        ok: false,
        url,
        reason: `ECHO_MODEL_NAME "${wanted}" is not served (serves: ${ids.join(", ")})`,
      };
}

/** OpenAI-compatible: GET {base}/models -> non-empty "data". */
async function probeOpenAICompatible(
  baseURL: string,
  label: string,
  wanted: string | undefined,
  apiKey?: string
): Promise<ProbeResult> {
  const url = `${baseURL}/models`;
  try {
    const data = (await getJSON(
      url,
      apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
    )) as { data?: Array<{ id?: string }> };
    const ids = (Array.isArray(data?.data) ? data.data : [])
      .map(m => m?.id)
      .filter((id): id is string => typeof id === "string" && !!id);
    const picked = pickModel(ids, wanted, url);
    if (!picked.ok) return picked;
    return {
      ok: true,
      resolved: {
        kind: "openai-compatible",
        source: label,
        baseURL,
        model: picked.model,
        apiKey,
        local: true,
      },
    };
  } catch (error) {
    return { ok: false, url, reason: describeError(error) };
  }
}

/** Ollama: GET {origin}/api/tags -> non-empty "models"; served at {origin}/v1. */
async function probeOllama(
  origin: string,
  label: string,
  wanted: string | undefined
): Promise<ProbeResult> {
  const url = `${origin}/api/tags`;
  try {
    const data = (await getJSON(url)) as {
      models?: Array<{ name?: string; model?: string }>;
    };
    const ids = (Array.isArray(data?.models) ? data.models : [])
      .map(m => m?.name || m?.model)
      .filter((id): id is string => typeof id === "string" && !!id);
    const picked = pickModel(ids, wanted, url);
    if (!picked.ok) return picked;
    return {
      ok: true,
      resolved: {
        kind: "openai-compatible",
        source: label,
        baseURL: `${origin}/v1`,
        model: picked.model,
        local: true,
      },
    };
  } catch (error) {
    return { ok: false, url, reason: describeError(error) };
  }
}

/** NanEcho server.py / neserver.py: GET /status -> model_loaded === true. */
async function probeNanEcho(
  baseURL: string,
  label: string
): Promise<ProbeResult> {
  const url = `${baseURL}/status`;
  try {
    const data = (await getJSON(url)) as { model_loaded?: unknown };
    if (data?.model_loaded !== true) {
      return {
        ok: false,
        url,
        reason: "NanEcho server answered but has no model loaded",
      };
    }
    return {
      ok: true,
      resolved: { kind: "nanecho", source: label, baseURL, local: true },
    };
  } catch (error) {
    return { ok: false, url, reason: describeError(error) };
  }
}

/**
 * Probe a user-supplied base URL (ECHO_MODEL_LOCAL_URLS) with every
 * protocol we know, returning the first verified one.
 */
async function probeAnyBase(
  rawBase: string,
  wanted: string | undefined
): Promise<ProbeResult> {
  const base = stripSlash(rawBase);
  const label = `ECHO_MODEL_LOCAL_URLS (${base})`;
  const origin = base.replace(/\/v1$/, "");
  const attempts = await Promise.all([
    probeOpenAICompatible(base, label, wanted),
    base === origin
      ? probeOpenAICompatible(`${origin}/v1`, label, wanted)
      : Promise.resolve<ProbeResult>({ ok: false, url: base, reason: "" }),
    probeOllama(origin, label, wanted),
    probeNanEcho(origin, label),
  ]);
  const hit = attempts.find(a => a.ok);
  if (hit) return hit;
  const reasons = attempts
    .filter(
      (a): a is Extract<ProbeResult, { ok: false }> => !a.ok && !!a.reason
    )
    .map(a => `${a.url}: ${a.reason}`)
    .join("; ");
  return { ok: false, url: base, reason: reasons || "no model found" };
}

/** Explicit configuration, or null when none is set. */
async function resolveExplicit(): Promise<ResolvedModel | null> {
  const name = env("ECHO_MODEL_NAME");

  const baseURL = env("ECHO_MODEL_BASE_URL");
  if (baseURL) {
    const base = stripSlash(baseURL);
    const apiKey = env("ECHO_MODEL_API_KEY");
    if (name) {
      return {
        kind: "openai-compatible",
        source: "ECHO_MODEL_BASE_URL",
        baseURL: base,
        model: name,
        apiKey,
        local: /^https?:\/\/(localhost|127\.|\[::1\])/.test(base),
      };
    }
    // No model name configured: ask the server which model it serves.
    const probe = await probeOpenAICompatible(
      base,
      "ECHO_MODEL_BASE_URL",
      undefined,
      apiKey
    );
    if (!probe.ok) {
      throw new AIConfigurationError(
        `ECHO_MODEL_BASE_URL is set to ${base} but no served model could be verified (${probe.url}: ${probe.reason}). Set ECHO_MODEL_NAME or make sure the server is running and serving a model.`
      );
    }
    return {
      ...probe.resolved,
      local: /^https?:\/\/(localhost|127\.|\[::1\])/.test(base),
    } as ResolvedModel;
  }

  const openaiKey = env("OPENAI_API_KEY");
  if (openaiKey) {
    return {
      kind: "openai-compatible",
      source: "OPENAI_API_KEY",
      baseURL: stripSlash(
        env("OPENAI_BASE_URL") || "https://api.openai.com/v1"
      ),
      model: name,
      apiKey: openaiKey,
      local: false,
    };
  }

  const hfKey = env("HUGGINGFACE_API_KEY");
  if (hfKey) {
    return {
      kind: "huggingface",
      source: "HUGGINGFACE_API_KEY",
      apiKey: hfKey,
      model: name,
      local: false,
    };
  }

  const nanecho = env("NANECHO_URL");
  if (nanecho) {
    return {
      kind: "nanecho",
      source: "NANECHO_URL",
      baseURL: stripSlash(nanecho),
      local: /^https?:\/\/(localhost|127\.|\[::1\])/.test(nanecho),
    };
  }

  return null;
}

/** Auto-discover a locally served model. Throws with a fix-it message. */
async function discoverLocal(): Promise<ResolvedModel> {
  const wanted = env("ECHO_MODEL_NAME");
  const host = env("ECHO_MODEL_LOCAL_HOST") || "127.0.0.1";
  const extra = (env("ECHO_MODEL_LOCAL_URLS") || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  // All probes run concurrently (each bounded by the probe timeout); the
  // first verified candidate in priority order wins.
  const probes: Array<Promise<ProbeResult>> = [
    ...extra.map(url => probeAnyBase(url, wanted)),
    probeOllama(`http://${host}:11434`, "Ollama (local)", wanted),
    ...OPENAI_COMPATIBLE_LOCAL_PORTS.map(([port, label]) =>
      probeOpenAICompatible(
        `http://${host}:${port}/v1`,
        `${label} (local)`,
        wanted
      )
    ),
    ...NANECHO_LOCAL_PORTS.map(([port, label]) =>
      probeNanEcho(`http://${host}:${port}`, `${label} (local)`)
    ),
  ];
  const results = await Promise.all(probes);
  const hit = results.find(r => r.ok);
  if (hit && hit.ok) return hit.resolved;

  const tried = results
    .filter((r): r is Extract<ProbeResult, { ok: false }> => !r.ok)
    .map(r => `  - ${r.url}: ${r.reason}`)
    .join("\n");
  throw new AIConfigurationError(
    [
      "No language model is available, so no reply can be generated.",
      "Fix it in one of these ways:",
      "  - Serve a local model, e.g. `ollama serve` and `ollama pull <model>` (or start llama.cpp server on :8080, LM Studio on :1234, vLLM on :8000, NanEcho/server.py on :8000 or NanEcho/neserver.py on :8081 with a checkpoint).",
      "  - Or set ECHO_MODEL_BASE_URL (OpenAI-compatible base URL) with ECHO_MODEL_NAME and, if needed, ECHO_MODEL_API_KEY.",
      "  - Or set OPENAI_API_KEY, HUGGINGFACE_API_KEY or NANECHO_URL.",
      "  - Other local servers can be listed in ECHO_MODEL_LOCAL_URLS (comma-separated base URLs).",
      wanted
        ? `ECHO_MODEL_NAME is "${wanted}": a local server must list that model.`
        : "",
      "Local servers probed:",
      tried,
    ]
      .filter(Boolean)
      .join("\n")
  );
}

const ENV_KEYS = [
  "ECHO_MODEL_BASE_URL",
  "ECHO_MODEL_NAME",
  "ECHO_MODEL_API_KEY",
  "ECHO_MODEL_LOCAL_URLS",
  "ECHO_MODEL_LOCAL_HOST",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "HUGGINGFACE_API_KEY",
  "NANECHO_URL",
];

let cached: { key: string; promise: Promise<ResolvedModel> } | null = null;

function envKey(): string {
  return JSON.stringify(ENV_KEYS.map(k => process.env[k] ?? null));
}

/**
 * Resolve the model endpoint to use. Successful resolutions are cached
 * (until the relevant environment changes or invalidateResolvedModel() is
 * called); failures are not, so serving a model later just works.
 */
export function resolveModel(
  options: { force?: boolean } = {}
): Promise<ResolvedModel> {
  const key = envKey();
  if (!options.force && cached && cached.key === key) {
    return cached.promise;
  }
  const promise = (async () =>
    (await resolveExplicit()) ?? (await discoverLocal()))();
  cached = { key, promise };
  promise.catch(() => {
    if (cached?.promise === promise) cached = null;
  });
  return promise;
}

export function invalidateResolvedModel(): void {
  cached = null;
}

/** True when the error means the endpoint could not be reached at all. */
export function isConnectionError(error: unknown, depth = 0): boolean {
  if (!(error instanceof Error) || depth > 4) return false;
  // openai SDK: APIConnectionError / APIConnectionTimeoutError
  if (
    /^APIConnection(Timeout)?Error$/.test(error.name) ||
    /^APIConnection(Timeout)?Error$/.test(error.constructor?.name ?? "")
  ) {
    return true;
  }
  const code = (error as { code?: string }).code ?? "";
  if (
    /^(ECONNREFUSED|ECONNRESET|ENOTFOUND|EHOSTUNREACH|UND_ERR_SOCKET|UND_ERR_CONNECT_TIMEOUT)$/.test(
      code
    )
  ) {
    return true;
  }
  if (error instanceof TypeError && /fetch failed/i.test(error.message)) {
    return true;
  }
  return isConnectionError((error as { cause?: unknown }).cause, depth + 1);
}

/**
 * Run `fn` against the resolved model. If the endpoint cannot be reached,
 * drop the cached resolution, resolve again (a different local server may
 * now be the one serving) and retry once. Nothing was generated by the
 * failed attempt, so the retry cannot duplicate output.
 */
export async function withResolvedModel<T>(
  fn: (model: ResolvedModel) => Promise<T>
): Promise<T> {
  const first = await resolveModel();
  try {
    return await fn(first);
  } catch (error) {
    if (!isConnectionError(error)) throw error;
    invalidateResolvedModel();
    const second = await resolveModel({ force: true });
    return fn(second);
  }
}

export function describeResolvedModel(model: ResolvedModel): string {
  switch (model.kind) {
    case "openai-compatible":
      return `${model.model ?? "(default model)"} via ${model.source} at ${model.baseURL}`;
    case "huggingface":
      return `${model.model ?? "(default model)"} via ${model.source} (HuggingFace Inference API)`;
    case "nanecho":
      return `NanEcho checkpoint via ${model.source} at ${model.baseURL}`;
  }
}

/** Resolve without throwing, for status displays. */
export async function getModelStatus(): Promise<ModelStatus> {
  try {
    const model = await resolveModel();
    return { available: true, description: describeResolvedModel(model) };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
