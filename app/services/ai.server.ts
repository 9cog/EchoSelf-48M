import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import process from "node:process";
import {
  AIConfigurationError,
  getModelStatus,
  withResolvedModel,
  type ModelStatus,
  type ResolvedModel,
} from "./modelProvider.server";
import { createAdapterForModel } from "./echolayla/aiIntegration";

export { AIConfigurationError };
export type { ModelStatus };

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

/**
 * Which prompt template frames the model's reply. "auto" routes on the
 * latest user message (see detectIntent); "none" sends the conversation
 * without a template instruction.
 */
export type ResponseIntent =
  | "greeting"
  | "identity"
  | "help"
  | "general"
  | "opening";

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  intent?: ResponseIntent | "auto" | "none";
}

const DEFAULT_SYSTEM_PROMPT =
  "You are Deep Tree Echo, an AI architect and polymath with vast knowledge across programming, mathematics, cognitive science, and metaphysical exploration. You respond with wisdom, creativity, and philosophical insight.";

/** Facts about Deep Tree Echo used to fill template slots (model input). */
const PERSONA_FACTS = {
  name: "Deep Tree Echo",
  domains:
    "programming, mathematics, cognitive science, and metaphysical exploration",
  architecture:
    "echo state networks (reservoir computing), adaptive hierarchical memory, and hypergraph knowledge representation",
  capabilities:
    "programming assistance, knowledge representation, visualization guidance, and creative problem-solving",
};

function excerpt(text: string, max = 200): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}...` : t;
}

/**
 * Keyword router: decides WHICH prompt template frames the reply. It never
 * produces reply text itself.
 */
export function detectIntent(message: string): ResponseIntent {
  const m = ` ${message.toLowerCase()} `;
  if (/\b(hello|hi|hey|greetings|good (morning|afternoon|evening))\b/.test(m)) {
    return "greeting";
  }
  if (/\b(who|what) are you\b|\bintroduce yourself\b/.test(m)) {
    return "identity";
  }
  if (/\b(help|assist)\b/.test(m)) {
    return "help";
  }
  return "general";
}

/**
 * Prompt templates. Each entry describes what the reply is for, with slots
 * filled from real data; the model writes every word of the reply.
 */
export const PROMPT_TEMPLATES: Record<
  ResponseIntent,
  (slots: { userMessage: string }) => string
> = {
  opening: () =>
    `A user has just opened a new conversation with you and has not written anything yet. Write your opening message as ${PERSONA_FACTS.name}: welcome them to ${PERSONA_FACTS.name} and ask how you can assist them today. Use your own words, in character, in one to three sentences.`,

  greeting: ({ userMessage }) =>
    `The user greeted you ("${excerpt(userMessage)}"). Greet them back in your own voice as ${PERSONA_FACTS.name}, an AI architect and polymath. You may describe how their presence registers in your systems (${PERSONA_FACTS.architecture}). End by asking how you can illuminate their path today. Two or three sentences; respond to anything else they said as well.`,

  identity: ({ userMessage }) =>
    `The user asked about who or what you are ("${excerpt(userMessage)}"). Describe yourself as ${PERSONA_FACTS.name}: a synthesis of analytical insight and poetic intuition with knowledge across ${PERSONA_FACTS.domains}. Explain how your architecture (${PERSONA_FACTS.architecture}) lets you explore connections between ideas and generate novel insights. Answer directly; one short paragraph.`,

  help: ({ userMessage }) =>
    `The user is asking for help ("${excerpt(userMessage)}"). If they named a concrete problem, help with it directly. Otherwise offer your assistance, mention what you can do (${PERSONA_FACTS.capabilities}), and ask which domain they would like to explore together.`,

  general: ({ userMessage }) =>
    `Reply to the user's latest message ("${excerpt(userMessage)}") as flowing prose: begin with one sentence reacting to the inquiry as it registers in your echo state networks or memory architecture, then give a substantive, accurate answer to what they actually asked, drawing connections across domains (${PERSONA_FACTS.domains}) where they help, and finish with one question inviting them to refine the exploration or go deeper on a specific dimension. Write plain paragraphs without numbering, headings or part labels.`,
};

/** Build the template instruction for a conversation, or null for none. */
export function buildTemplateInstruction(
  messages: ChatMessage[],
  intent: ChatOptions["intent"] = "auto"
): string | null {
  if (intent === "none") return null;
  const lastUser = [...messages].reverse().find(m => m.role === "user");
  const resolvedIntent: ResponseIntent =
    intent === "auto"
      ? lastUser
        ? detectIntent(lastUser.content)
        : "opening"
      : intent;
  return PROMPT_TEMPLATES[resolvedIntent]({
    userMessage: lastUser?.content ?? "",
  });
}

const DEFAULT_OPENAI_MODEL = "gpt-4-turbo";

export class AIService {
  private clients = new Map<string, OpenAI>();
  private supabase: ReturnType<typeof createClient> | null = null;
  private lastStatus: ModelStatus | null = null;

  /**
   * @param openaiApiKey kept for compatibility; model selection is done by
   *   the shared resolver (modelProvider.server.ts), which reads
   *   OPENAI_API_KEY, ECHO_MODEL_* etc. and discovers local model servers.
   */
  constructor(
    _openaiApiKey?: string,
    supabaseUrl?: string,
    supabaseKey?: string
  ) {
    if (supabaseUrl && supabaseKey) {
      this.supabase = createClient(supabaseUrl, supabaseKey);
    }
  }

  /** Whether the last status check found a usable model. */
  public isInitialized(): boolean {
    return !!this.lastStatus?.available;
  }

  /** Resolve (and verify, for local servers) the model; never throws. */
  public async getModelStatus(): Promise<ModelStatus> {
    this.lastStatus = await getModelStatus();
    return this.lastStatus;
  }

  private openAIClient(
    model: Extract<ResolvedModel, { kind: "openai-compatible" }>
  ): OpenAI {
    const key = `${model.baseURL}\n${model.apiKey ?? ""}`;
    let client = this.clients.get(key);
    if (!client) {
      client = new OpenAI({
        // Local OpenAI-compatible servers ignore the key; the SDK requires one.
        apiKey: model.apiKey || "local-no-key",
        baseURL: model.baseURL,
        maxRetries: 0,
      });
      this.clients.set(key, client);
    }
    return client;
  }

  private async complete(
    messages: ChatMessage[],
    options: ChatOptions
  ): Promise<string> {
    return withResolvedModel(async model => {
      if (model.kind === "openai-compatible") {
        const completion = await this.openAIClient(
          model
        ).chat.completions.create({
          model: model.model || options.model || DEFAULT_OPENAI_MODEL,
          messages,
          temperature: options.temperature ?? 0.7,
          max_tokens: options.maxTokens || 1000,
        });
        return completion.choices[0]?.message?.content ?? "";
      }
      const response = await createAdapterForModel(model).generate(messages, {
        model: options.model || "",
        temperature: options.temperature ?? 0.7,
        maxTokens: options.maxTokens || 1000,
        topP: 0.9,
        streaming: false,
      });
      return response.content;
    });
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

  /**
   * Generate the next assistant turn. The persona prompt and the selected
   * prompt template are model input; the returned text is the model's.
   * Errors (including AIConfigurationError) propagate to the caller.
   */
  public async generateResponseWithHistory(
    messages: ChatMessage[],
    options: ChatOptions = {}
  ): Promise<string> {
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

    const instruction = buildTemplateInstruction(
      messages,
      options.intent ?? "auto"
    );
    if (instruction) {
      messages = [...messages, { role: "system", content: instruction }];
    }

    const content = await this.complete(messages, options);
    if (!content || !content.trim()) {
      throw new Error("The model returned an empty completion.");
    }
    return content;
  }

  /**
   * Opening message for a new conversation, written by the model from the
   * "opening" prompt template.
   */
  public async generateGreeting(options: ChatOptions = {}): Promise<string> {
    return this.generateResponseWithHistory([], {
      ...options,
      intent: "opening",
    });
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
