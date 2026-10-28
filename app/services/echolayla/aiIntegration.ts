/**
 * EchoLayla AI Integration
 *
 * Integration with various AI services for actual inference.
 * This module provides adapters for different AI providers.
 */

import type { InferenceConfig } from "./types";
import process from "node:process";

/**
 * AI Provider types
 */
export type AIProvider = "openai" | "huggingface" | "nanecho" | "local";

/**
 * Thrown when no real model provider is configured.
 */
export class AIConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIConfigurationError";
  }
}

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

  constructor(apiKey?: string, baseURL?: string) {
    this.apiKey = apiKey || process.env.OPENAI_API_KEY || "";
    this.baseURL = baseURL || "https://api.openai.com/v1";
  }

  async generate(
    messages: Array<{ role: string; content: string }>,
    config: InferenceConfig
  ): Promise<AIResponse> {
    if (!this.apiKey) {
      throw new Error("OpenAI API key not configured");
    }

    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model || "gpt-3.5-turbo",
        messages,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        top_p: config.topP,
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${await readErrorDetail(response)}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    const content: string | undefined = choice?.message?.content;
    if (!content || !content.trim()) {
      throw new Error("OpenAI API returned an empty completion");
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
    if (!this.apiKey) {
      throw new Error("OpenAI API key not configured");
    }

    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model || "gpt-3.5-turbo",
        messages,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        top_p: config.topP,
        stream: true,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${await readErrorDetail(response)}`);
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
      throw new Error("OpenAI API returned an empty completion");
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
      const parsed = JSON.parse(data) as { token?: string; error?: string };
      if (parsed.error) {
        throw new Error(`NanEcho generation error: ${parsed.error}`);
      }
      if (parsed.token) {
        fullContent += parsed.token;
        onChunk(parsed.token);
      }
    }

    if (!fullContent.trim()) {
      throw new Error("NanEcho model returned an empty completion");
    }

    return { content: fullContent, finishReason: "stop" };
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
        return new OpenAIAdapter(options?.apiKey, options?.baseURL);
      case "huggingface":
        return new HuggingFaceAdapter(options?.apiKey, options?.model);
      case "nanecho":
      case "local":
        return new NanEchoAdapter(options?.baseURL);
      default:
        throw new AIConfigurationError(
          `Unknown AI provider: ${String(provider)}`
        );
    }
  }
}

/**
 * Get default AI adapter based on environment.
 * Throws when no real model provider is configured.
 */
export function getDefaultAdapter(): AIAdapter {
  if (process.env.OPENAI_API_KEY) {
    return AIServiceFactory.createAdapter("openai");
  }

  if (process.env.HUGGINGFACE_API_KEY) {
    return AIServiceFactory.createAdapter("huggingface");
  }

  if (process.env.NANECHO_URL) {
    return AIServiceFactory.createAdapter("nanecho");
  }

  throw new AIConfigurationError(
    "No AI model provider is configured. Set OPENAI_API_KEY, HUGGINGFACE_API_KEY, or NANECHO_URL (URL of a running NanEcho/server.py)."
  );
}
