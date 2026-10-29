/**
 * EchoLayla AI Integration
 *
 * Integration with various AI services for actual inference.
 * This module provides adapters for different AI providers.
 */

import type { InferenceConfig } from "./types";
import process from "node:process";
import {
  AIConfigurationError,
  resolveModel,
  withResolvedModel,
  type ResolvedModel,
} from "../modelProvider.server";

export { AIConfigurationError };

/**
 * AI Provider types
 */
export type AIProvider = "openai" | "huggingface" | "nanecho" | "local";

/**
 * Read an error body from a failed response without assuming JSON.
 */
async function readErrorDetail(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  try {
    const parsed = JSON.parse(text);
    const detail =
      parsed?.error?.message ?? parsed?.error ?? parsed?.detail ?? text;
    return typeof detail === "string" ? detail : JSON.stringify(detail);
  } catch {
    return text || response.statusText;
  }
}

/**
 * Iterate over the `data:` payloads of a server-sent-event response body,
 * buffering partial lines across network chunks.
 */
async function* readSSEData(response: Response): AsyncGenerator<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Failed to get response reader");
  }
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("data:")) {
          yield trimmed.slice(5).trim();
        }
      }
    }
    const rest = buffer.trim();
    if (rest.startsWith("data:")) {
      yield rest.slice(5).trim();
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * AI Response structure
 */
export interface AIResponse {
  content: string;
  finishReason: "stop" | "length" | "error";
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * Streaming callback
 */
export type StreamCallback = (chunk: string) => void;

/**
 * Base AI Adapter interface
 */
export interface AIAdapter {
  generate(
    messages: Array<{ role: string; content: string }>,
    config: InferenceConfig
  ): Promise<AIResponse>;

  generateStream(
    messages: Array<{ role: string; content: string }>,
    config: InferenceConfig,
    onChunk: StreamCallback
  ): Promise<AIResponse>;
}

/**
 * OpenAI Adapter
 */
export class OpenAIAdapter implements AIAdapter {
  private apiKey: string;
  private baseURL: string;
  private model?: string;

  /**
   * @param apiKey  required for the hosted OpenAI API; local
   *                OpenAI-compatible servers (Ollama, llama.cpp, LM Studio,
   *                vLLM) need none
   * @param baseURL OpenAI-compatible base URL (default: hosted OpenAI)
   * @param model   model served at baseURL; overrides config.model
   */
  constructor(apiKey?: string, baseURL?: string, model?: string) {
    this.baseURL = (baseURL || "https://api.openai.com/v1").replace(/\/+$/, "");
    this.apiKey = apiKey || (baseURL ? "" : process.env.OPENAI_API_KEY || "");
    this.model = model;
  }

  private headers(): Record<string, string> {
    if (!this.apiKey && this.baseURL === "https://api.openai.com/v1") {
      throw new AIConfigurationError("OpenAI API key not configured");
    }
    return {
      "Content-Type": "application/json",
      ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
    };
  }

  private body(
    messages: Array<{ role: string; content: string }>,
    config: InferenceConfig,
    stream: boolean
  ): string {
    return JSON.stringify({
      model: this.model || config.model || "gpt-3.5-turbo",
      messages,
      temperature: config.temperature,
      max_tokens: config.maxTokens,
      top_p: config.topP,
      stream,
    });
  }

  async generate(
    messages: Array<{ role: string; content: string }>,
    config: InferenceConfig
  ): Promise<AIResponse> {
    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: this.body(messages, config, false),
    });

    if (!response.ok) {
      throw new Error(
        `Model API error (${this.baseURL}): ${await readErrorDetail(response)}`
      );
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    const content: string | undefined = choice?.message?.content;
    if (!content || !content.trim()) {
      throw new Error("The model returned an empty completion");
    }

    return {
      content,
      finishReason: choice.finish_reason,
      usage: data.usage,
    };
  }

  async generateStream(
    messages: Array<{ role: string; content: string }>,
    config: InferenceConfig,
    onChunk: StreamCallback
  ): Promise<AIResponse> {
    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: this.body(messages, config, true),
    });

    if (!response.ok) {
      throw new Error(
        `Model API error (${this.baseURL}): ${await readErrorDetail(response)}`
      );
    }

    let fullContent = "";
    let finishReason: "stop" | "length" | "error" = "stop";

    for await (const data of readSSEData(response)) {
      if (data === "[DONE]") continue;

      let parsed;
      try {
        parsed = JSON.parse(data);
      } catch (e) {
        console.error("Error parsing SSE data:", e);
        continue;
      }
      const content = parsed.choices?.[0]?.delta?.content || "";

      if (content) {
        fullContent += content;
        onChunk(content);
      }

      if (parsed.choices?.[0]?.finish_reason) {
        finishReason = parsed.choices[0].finish_reason;
      }
    }

    if (!fullContent.trim()) {
      throw new Error("The model returned an empty completion");
    }

    return {
      content: fullContent,
      finishReason,
    };
  }
}

/**
 * HuggingFace Adapter
 */
export class HuggingFaceAdapter implements AIAdapter {
  private apiKey: string;
  private model: string;

  constructor(apiKey?: string, model?: string) {
    this.apiKey = apiKey || process.env.HUGGINGFACE_API_KEY || "";
    this.model = model || "mistralai/Mistral-7B-Instruct-v0.2";
  }

  async generate(
    messages: Array<{ role: string; content: string }>,
    config: InferenceConfig
  ): Promise<AIResponse> {
    if (!this.apiKey) {
      throw new Error("HuggingFace API key not configured");
    }

    // Convert messages to HuggingFace format
    const prompt = this.formatMessages(messages);

    const response = await fetch(
      `https://api-inference.huggingface.co/models/${this.model}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: prompt,
          parameters: {
            temperature: config.temperature,
            max_new_tokens: config.maxTokens,
            top_p: config.topP,
            top_k: config.topK,
            return_full_text: false,
          },
        }),
      }
    );

    if (!response.ok) {
      throw new Error(
        `HuggingFace API error: ${await readErrorDetail(response)}`
      );
    }

    const data = await response.json();
    const generated: string = data[0]?.generated_text || "";
    if (!generated.trim()) {
      throw new Error("HuggingFace API returned an empty completion");
    }

    return {
      content: generated,
      finishReason: "stop",
    };
  }

  async generateStream(
    messages: Array<{ role: string; content: string }>,
    config: InferenceConfig,
    onChunk: StreamCallback
  ): Promise<AIResponse> {
    // This endpoint is used without token streaming: deliver the whole real
    // model reply as a single chunk.
    const result = await this.generate(messages, config);
    onChunk(result.content);
    return result;
  }

  private formatMessages(
    messages: Array<{ role: string; content: string }>
  ): string {
    // Simple formatting for instruction-tuned models
    return messages
      .map(msg => {
        if (msg.role === "system") {
          return `<<SYS>>\n${msg.content}\n<</SYS>>`;
        }
        if (msg.role === "user") {
          return `[INST] ${msg.content} [/INST]`;
        }
        return msg.content;
      })
      .join("\n\n");
  }
}

/**
 * NanEcho Adapter - the locally trained NanEcho model served by
 * NanEcho/server.py (FastAPI). Configure with NANECHO_URL.
 */
export class NanEchoAdapter implements AIAdapter {
  private baseURL: string;

  constructor(baseURL?: string) {
    this.baseURL = (baseURL || process.env.NANECHO_URL || "").replace(
      /\/+$/,
      ""
    );
  }

  private requireURL(): string {
    if (!this.baseURL) {
      throw new AIConfigurationError(
        "NanEcho server URL (NANECHO_URL) not configured"
      );
    }
    return this.baseURL;
  }

  private body(
    messages: Array<{ role: string; content: string }>,
    config: InferenceConfig,
    stream: boolean
  ): string {
    return JSON.stringify({
      messages,
      max_tokens: config.maxTokens,
      temperature: config.temperature,
      ...(config.topK !== undefined ? { top_k: config.topK } : {}),
      stream,
    });
  }

  async generate(
    messages: Array<{ role: string; content: string }>,
    config: InferenceConfig
  ): Promise<AIResponse> {
    const response = await fetch(`${this.requireURL()}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: this.body(messages, config, false),
    });

    if (!response.ok) {
      throw new Error(
        `NanEcho server error: ${await readErrorDetail(response)}`
      );
    }

    const data = (await response.json()) as {
      text?: string;
      tokens_generated?: number;
    };
    const content = data.text ?? "";
    if (!content.trim()) {
      throw new Error("NanEcho model returned an empty completion");
    }

    return {
      content,
      finishReason: "stop",
      usage:
        data.tokens_generated !== undefined
          ? {
              promptTokens: 0,
              completionTokens: data.tokens_generated,
              totalTokens: data.tokens_generated,
            }
          : undefined,
    };
  }

  async generateStream(
    messages: Array<{ role: string; content: string }>,
    config: InferenceConfig,
    onChunk: StreamCallback
  ): Promise<AIResponse> {
    const response = await fetch(`${this.requireURL()}/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: this.body(messages, config, true),
    });

    if (!response.ok) {
      throw new Error(
        `NanEcho server error: ${await readErrorDetail(response)}`
      );
    }

    let fullContent = "";
    for await (const data of readSSEData(response)) {
      if (data === "[DONE]") break;
      // server.py sends {token}, neserver.py sends {text, finished}.
      const parsed = JSON.parse(data) as {
        token?: string;
        text?: string;
        error?: string;
        finished?: boolean;
      };
      if (parsed.error) {
        throw new Error(`NanEcho generation error: ${parsed.error}`);
      }
      const token = parsed.token ?? parsed.text;
      if (token) {
        fullContent += token;
        onChunk(token);
      }
      if (parsed.finished) break;
    }

    if (!fullContent.trim()) {
      throw new Error("NanEcho model returned an empty completion");
    }

    return { content: fullContent, finishReason: "stop" };
  }
}

/**
 * Build the adapter for an endpoint chosen by the shared resolver
 * (app/services/modelProvider.server.ts). Local OpenAI-compatible servers
 * go through the OpenAI adapter with their own base URL and no key.
 */
export function createAdapterForModel(model: ResolvedModel): AIAdapter {
  switch (model.kind) {
    case "openai-compatible":
      return new OpenAIAdapter(model.apiKey, model.baseURL, model.model);
    case "huggingface":
      return new HuggingFaceAdapter(model.apiKey, model.model);
    case "nanecho":
      return new NanEchoAdapter(model.baseURL);
  }
}

/**
 * Adapter that resolves the model endpoint on first use (explicit config,
 * else a verified local model server) and re-resolves after a connection
 * failure. It never answers on its own: with no model available it throws
 * AIConfigurationError.
 */
export class ResolvedModelAdapter implements AIAdapter {
  private adapters = new Map<ResolvedModel, AIAdapter>();

  private adapterFor(model: ResolvedModel): AIAdapter {
    let adapter = this.adapters.get(model);
    if (!adapter) {
      adapter = createAdapterForModel(model);
      this.adapters.set(model, adapter);
    }
    return adapter;
  }

  /** The endpoint the next request will use. */
  resolve(): Promise<ResolvedModel> {
    return resolveModel();
  }

  generate(
    messages: Array<{ role: string; content: string }>,
    config: InferenceConfig
  ): Promise<AIResponse> {
    return withResolvedModel(model =>
      this.adapterFor(model).generate(messages, config)
    );
  }

  generateStream(
    messages: Array<{ role: string; content: string }>,
    config: InferenceConfig,
    onChunk: StreamCallback
  ): Promise<AIResponse> {
    let streamed = false;
    return withResolvedModel(model => {
      if (streamed) {
        // Tokens already reached the caller; do not start a second reply.
        throw new Error("Model connection lost during streaming");
      }
      return this.adapterFor(model).generateStream(messages, config, chunk => {
        streamed = true;
        onChunk(chunk);
      });
    });
  }
}

/**
 * AI Service Factory
 */
export class AIServiceFactory {
  static createAdapter(
    provider: AIProvider,
    options?: Record<string, string>
  ): AIAdapter {
    switch (provider) {
      case "openai":
        return new OpenAIAdapter(
          options?.apiKey,
          options?.baseURL,
          options?.model
        );
      case "huggingface":
        return new HuggingFaceAdapter(options?.apiKey, options?.model);
      case "nanecho":
        return new NanEchoAdapter(options?.baseURL);
      case "local":
        // An explicit local OpenAI-compatible server, or auto-discovery of a
        // verified local model server.
        return options?.baseURL
          ? new OpenAIAdapter(options.apiKey, options.baseURL, options.model)
          : new ResolvedModelAdapter();
      default:
        throw new AIConfigurationError(
          `Unknown AI provider: ${String(provider)}`
        );
    }
  }
}

/**
 * Get the default AI adapter: explicit configuration (ECHO_MODEL_BASE_URL,
 * OPENAI_API_KEY, HUGGINGFACE_API_KEY, NANECHO_URL) or a verified locally
 * served model, resolved on first use. Requests throw AIConfigurationError
 * when no model is available.
 */
export function getDefaultAdapter(): AIAdapter {
  return new ResolvedModelAdapter();
}
