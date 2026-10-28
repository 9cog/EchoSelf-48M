import { useMemory } from "../contexts/MemoryContext";
import { DeepTreeEchoOpenAIService } from "./openaiService";
import { PromptTemplate, renderPromptTemplate } from "./promptTemplates";

export type LLMIntent =
  | "greeting"
  | "capabilities"
  | "code"
  | "memory"
  | "default";

interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  memoryContext?: boolean;
}

/**
 * Assistant completions over DeepTreeEchoOpenAIService (configured API or a
 * verified local model). Keyword detection picks a prompt template
 * (greeting, capabilities, code, memory, default); the template plus real
 * data (the prompt, the memories actually supplied) is sent to the model,
 * which writes the reply. There is no simulated mode.
 */
export class LLMService {
  private static instance: LLMService;
  private defaultOptions: LLMOptions = {
    model: "gpt-4-turbo",
    temperature: 0.7,
    maxTokens: 1000,
    memoryContext: true,
  };

  private constructor() {}

  public static getInstance(): LLMService {
    if (!LLMService.instance) {
      LLMService.instance = new LLMService();
    }
    return LLMService.instance;
  }

  private get openai(): DeepTreeEchoOpenAIService {
    return DeepTreeEchoOpenAIService.getInstance();
  }

  public setApiKey(key: string): void {
    this.openai.setApiKey(key);
  }

  public hasApiKey(): boolean {
    return this.openai.hasApiKey();
  }

  public detectIntent(prompt: string): LLMIntent {
    const p = prompt.toLowerCase();
    if (/^\s*(hello|hi|hey|greetings)\b/.test(p)) return "greeting";
    if (p.includes("what can you do") || p.includes("capabilities"))
      return "capabilities";
    if (p.includes("code") || p.includes("programming")) return "code";
    if (p.includes("memory") || p.includes("remember")) return "memory";
    return "default";
  }

  /** The prompt template for this prompt, filled with real data. */
  public buildTemplate(prompt: string, memoryCount: number): PromptTemplate {
    const data = {
      "user's message": prompt,
      "memories supplied as context": String(memoryCount),
    };
    switch (this.detectIntent(prompt)) {
      case "greeting":
        return {
          id: "assistant-greeting",
          purpose:
            "Return the user's greeting as Deep Tree Echo, their AI assistant, and ask how you can help.",
          structure: ["One or two friendly sentences in your own words."],
          data,
          styleExamples: [
            "Hello! I'm Deep Tree Echo, your AI assistant. How can I help you today?",
          ],
        };
      case "capabilities":
        return {
          id: "assistant-capabilities",
          purpose: "Tell the user what you can help with.",
          structure: [
            "Summarize what you can do: coding assistance, answering questions, suggestions grounded in context.",
            memoryCount > 0
              ? "Mention that your answers draw on the user's personal memory system (memories are supplied with this request)."
              : "Mention that you can draw on the user's personal memory system once memories are stored (none were supplied with this request).",
            "Offer a next step related to their message.",
          ],
          data,
        };
      case "code":
        return {
          id: "assistant-code",
          purpose: "Help with the user's programming request.",
          structure: [
            "If the request is concrete, answer it directly with correct code and a brief explanation.",
            "If it is vague, ask whether they want a concept explained, code reviewed, or a specific problem solved.",
          ],
          data,
        };
      case "memory":
        return {
          id: "assistant-memory",
          purpose:
            "Answer the user's question about memory, using only the memories actually supplied.",
          structure: [
            memoryCount > 0
              ? "Refer to the supplied memories that are relevant and answer from them."
              : "Say honestly that no stored memories matched this request, and answer what you can.",
            "Do not claim to remember anything that is not in the supplied memories or this conversation.",
          ],
          data,
        };
      default:
        return {
          id: "assistant-default",
          purpose: "Answer the user's request helpfully.",
          structure: [
            "Give the substantive answer.",
            "Offer to elaborate on a specific aspect if useful.",
          ],
          data,
        };
    }
  }

  public async generateCompletion(
    prompt: string,
    options: LLMOptions = {}
  ): Promise<string> {
    const mergedOptions = { ...this.defaultOptions, ...options };
    return this.openai.generateResponse(prompt, {
      model: mergedOptions.model,
      temperature: mergedOptions.temperature,
      maxTokens: mergedOptions.maxTokens,
      systemPrompt: renderPromptTemplate(this.buildTemplate(prompt, 0)),
    });
  }

  // Generate a response with the given memory contents supplied as model context
  public async generateWithMemory(
    prompt: string,
    memoryContents: string[] = [],
    options: LLMOptions = {}
  ): Promise<string> {
    const mergedOptions = { ...this.defaultOptions, ...options };

    if (!mergedOptions.memoryContext || memoryContents.length === 0) {
      return this.generateCompletion(prompt, mergedOptions);
    }

    return this.openai.generateResponseWithMemory(
      prompt,
      [{ role: "user", content: prompt }],
      memoryContents,
      {
        model: mergedOptions.model,
        temperature: mergedOptions.temperature,
        maxTokens: mergedOptions.maxTokens,
        systemPrompt: renderPromptTemplate(
          this.buildTemplate(prompt, memoryContents.length)
        ),
      }
    );
  }
}

// React hook for using the LLM service
export const useLLM = () => {
  const llmService = LLMService.getInstance();
  const { memories } = useMemory();

  const generateResponse = async (prompt: string, options: LLMOptions = {}) => {
    const promptWords = prompt
      .toLowerCase()
      .split(/\s+/)
      .filter(word => word.length > 3);

    const relevantMemories = memories
      .filter(memory => {
        const content = memory.content.toLowerCase();
        return promptWords.some(word => content.includes(word));
      })
      .slice(0, 3)
      .map(memory => `Title: ${memory.title}\nContent: ${memory.content}`);

    return llmService.generateWithMemory(prompt, relevantMemories, options);
  };

  return {
    generateResponse,
    hasApiKey: llmService.hasApiKey(),
    setApiKey: (key: string) => llmService.setApiKey(key),
  };
};
