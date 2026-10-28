import { useMemory } from "../contexts/MemoryContext";
import { DeepTreeEchoOpenAIService } from "./openaiService";

interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  memoryContext?: boolean;
}

/**
 * Thin wrapper over the real OpenAI-backed DeepTreeEchoOpenAIService.
 * Every completion is produced by the model; there is no simulated mode.
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

  public async generateCompletion(
    prompt: string,
    options: LLMOptions = {}
  ): Promise<string> {
    const mergedOptions = { ...this.defaultOptions, ...options };
    return this.openai.generateResponse(prompt, {
      model: mergedOptions.model,
      temperature: mergedOptions.temperature,
      maxTokens: mergedOptions.maxTokens,
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
