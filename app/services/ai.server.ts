import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import process from "node:process";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

export class AIConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIConfigurationError";
  }
}

const DEFAULT_SYSTEM_PROMPT =
  "You are Deep Tree Echo, an AI architect and polymath with vast knowledge across programming, mathematics, cognitive science, and metaphysical exploration. You respond with wisdom, creativity, and philosophical insight.";

export class AIService {
  private openai: OpenAI | null = null;
  private supabase: ReturnType<typeof createClient> | null = null;

  constructor(
    openaiApiKey?: string,
    supabaseUrl?: string,
    supabaseKey?: string
  ) {
    if (openaiApiKey) {
      this.openai = new OpenAI({
        apiKey: openaiApiKey,
        dangerouslyAllowBrowser: true,
      });
    }

    if (supabaseUrl && supabaseKey) {
      this.supabase = createClient(supabaseUrl, supabaseKey);
    }
  }

  public isInitialized(): boolean {
    return !!this.openai;
  }

  private requireClient(): OpenAI {
    if (!this.openai) {
      throw new AIConfigurationError(
        "No language model is configured. Set the OPENAI_API_KEY environment variable on the server."
      );
    }
    return this.openai;
  }

  public async generateResponse(
    prompt: string,
    options: ChatOptions = {}
  ): Promise<string> {
    return this.generateResponseWithHistory(
      [{ role: "user", content: prompt }],
      options
    );
  }

  public async generateResponseWithHistory(
    messages: ChatMessage[],
    options: ChatOptions = {}
  ): Promise<string> {
    const client = this.requireClient();

    // Add system message (persona prompt, used as model input) if not present
    if (!messages.some(msg => msg.role === "system")) {
      messages = [
        {
          role: "system",
          content: options.systemPrompt || DEFAULT_SYSTEM_PROMPT,
        },
        ...messages,
      ];
    }

    // API errors propagate to the caller; no fallback output is produced.
    const completion = await client.chat.completions.create({
      model: options.model || "gpt-4-turbo",
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens || 1000,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content || !content.trim()) {
      throw new Error("The model returned an empty completion.");
    }
    return content;
  }
}

// Create a server-side AI service instance
let aiService: AIService | null = null;

export const getAIService = () => {
  if (!aiService) {
    aiService = new AIService(
      process.env.OPENAI_API_KEY,
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );
  }

  return aiService;
};
