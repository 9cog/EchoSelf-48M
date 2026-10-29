import {
  chatComplete,
  getOpenAIClient,
  isModelKnownAvailable,
  parseModelJson,
  resolveModel,
  setModelOverrides,
} from "./modelProvider";
import { HfInference } from "@huggingface/inference";
import { createClient } from "@supabase/supabase-js";
import { getMemoryService } from "../../app/services/memory.server";

export interface AIServiceConfig {
  openaiApiKey?: string;
  huggingfaceApiKey?: string;
  supabaseUrl?: string;
  supabaseKey?: string;
  userId?: string;
}

export interface AIResponseMetadata {
  model?: string;
  [key: string]: unknown;
}

export interface AIResponse {
  text: string;
  source?: string;
  confidence?: number;
  metadata?: AIResponseMetadata;
}

export class AIService {
  private static instance: AIService;
  private hf: HfInference | null = null;
  private llama: unknown | null = null;
  private supabase: ReturnType<typeof createClient> | null = null;
  private userId: string | null = null;
  private memoryService = getMemoryService();

  private constructor() {}

  public static getInstance(): AIService {
    if (!AIService.instance) {
      AIService.instance = new AIService();
    }
    return AIService.instance;
  }

  public initialize(config: AIServiceConfig): void {
    if (config.openaiApiKey) {
      // Shared resolver: explicit key, configured base URL or a verified
      // locally served model
      setModelOverrides({ apiKey: config.openaiApiKey });
    }

    if (config.huggingfaceApiKey) {
      this.hf = new HfInference(config.huggingfaceApiKey);
    }

    if (config.supabaseUrl && config.supabaseKey) {
      this.supabase = createClient(config.supabaseUrl, config.supabaseKey);
    }

    if (config.userId) {
      this.userId = config.userId;
    }

    // LlamaIndex is not wired up; the "llama" provider reports that honestly
    this.llama = null;
  }

  public isInitialized(): boolean {
    return isModelKnownAvailable() || !!this.hf;
  }

  public async generateResponse(
    prompt: string,
    options: {
      model?: string;
      temperature?: number;
      maxTokens?: number;
      useMemoryContext?: boolean;
      provider?: "openai" | "huggingface" | "llama";
    } = {}
  ): Promise<AIResponse> {
    const { model, provider = "openai" } = options;

    // Get relevant memories if requested
    let contextMemories: string[] = [];
    if (options.useMemoryContext && this.userId) {
      const memories = await this.memoryService.searchMemories(prompt, {
        limit: 3,
        threshold: 0.7,
      });
      contextMemories = memories.map((mem: { content: string }) => mem.content);
    }

    // Build context-aware prompt
    const contextPrompt =
      contextMemories.length > 0
        ? `Context from memory:\n${contextMemories.join("\n\n")}\n\nUser request: ${prompt}`
        : prompt;

    try {
      switch (provider) {
        case "openai": {
          // Configured API or verified local model (OpenAI-compatible)
          const text = await chatComplete(
            [{ role: "user", content: contextPrompt }],
            {
              model,
              temperature: options.temperature ?? 0.7,
              maxTokens: options.maxTokens,
            }
          );
          const endpoint = await resolveModel();
          return {
            text,
            source: endpoint.source === "local" ? "local" : "openai",
            metadata: { model: endpoint.model, endpoint: endpoint.label },
          };
        }

        case "huggingface": {
          if (!this.hf) throw new Error("HuggingFace not initialized");
          const response = await this.hf.textGeneration({
            model: "mistralai/Mixtral-8x7B-Instruct-v0.1",
            inputs: contextPrompt,
            parameters: {
              temperature: options.temperature ?? 0.7,
              max_new_tokens: options.maxTokens ?? 1000,
            },
          });
          return {
            text: response.generated_text,
            source: "huggingface",
            metadata: { model: "Mixtral-8x7B" },
          };
        }

        case "llama": {
          if (!this.llama) throw new Error("LlamaIndex not initialized");
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const llamaResponse = await (this.llama as any).query(contextPrompt);
          return {
            text: String(llamaResponse),
            source: "llama",
            metadata: { model: "llama-index" },
          };
        }

        default: {
          throw new Error(`Unknown provider: ${provider}`);
        }
      }
    } catch (error) {
      console.error("Error generating AI response:", error);
      throw error;
    }
  }

  public async generateEmbedding(text: string): Promise<number[]> {
    const endpoint = await resolveModel();
    if (endpoint.kind !== "openai") {
      throw new Error(
        `Embeddings are not supported by the resolved model server (${endpoint.label})`
      );
    }
    const client = getOpenAIClient(endpoint);
    const hosted = endpoint.baseURL === "https://api.openai.com/v1";

    try {
      const response = await client.embeddings.create(
        hosted
          ? { model: "text-embedding-3-large", input: text, dimensions: 1536 }
          : { model: endpoint.model, input: text }
      );
      return response.data[0].embedding;
    } catch (error) {
      console.error("Error generating embedding:", error);
      throw error;
    }
  }

  public async analyzeMemories(): Promise<{
    insights: string[];
    patterns: string[];
    recommendations: string[];
  }> {
    if (!this.userId) {
      throw new Error("User not initialized");
    }

    try {
      const memories = await this.memoryService.listMemories({ limit: 20 });
      const memoryText = memories
        .map(
          (m: { title: string; content: string; tags: string[] }) =>
            `Title: ${m.title}\nContent: ${m.content}\nTags: ${m.tags.join(", ")}`
        )
        .join("\n\n");

      const raw = await chatComplete(
        [
          {
            role: "system",
            content:
              "Analyze the provided memories and extract insights, patterns, and recommendations. Reply with ONLY a JSON object with three string arrays: insights, patterns, and recommendations.",
          },
          { role: "user", content: memoryText },
        ],
        { temperature: 0.3 }
      );

      const analysis = parseModelJson<{
        insights?: unknown;
        patterns?: unknown;
        recommendations?: unknown;
      }>(raw);
      const strings = (value: unknown): string[] =>
        Array.isArray(value) ? value.map(String) : [];
      return {
        insights: strings(analysis.insights),
        patterns: strings(analysis.patterns),
        recommendations: strings(analysis.recommendations),
      };
    } catch (error) {
      console.error("Error analyzing memories:", error);
      throw error;
    }
  }
}

// React hook for using AIService
export const useAI = () => {
  const service = AIService.getInstance();

  return {
    initialize: (config: AIServiceConfig) => service.initialize(config),
    isInitialized: () => service.isInitialized(),
    generateResponse: (
      prompt: string,
      options?: Parameters<typeof service.generateResponse>[1]
    ) => service.generateResponse(prompt, options),
    generateEmbedding: (text: string) => service.generateEmbedding(text),
    analyzeMemories: () => service.analyzeMemories(),
  };
};
