import { useMem0AI } from "./mem0aiService";
import {
  chatComplete,
  isModelKnownAvailable,
  setModelOverrides,
} from "./modelProvider";

export type AIModel =
  | "gpt-4-turbo"
  | "gpt-3.5-turbo"
  | "claude-3"
  | "gemini-pro";
type ChatRole = "user" | "assistant" | "system";

interface Message {
  role: ChatRole;
  content: string;
}

interface ChatOptions {
  model?: AIModel;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  onStream?: (chunk: string) => void;
  systemPrompt?: string;
}

interface PromptTemplate {
  name: string;
  content: string;
}

export class AIChatService {
  private static instance: AIChatService;
  private userId: string | null = null;
  private chatHistory: Map<string, Message[]> = new Map();
  private promptTemplates: PromptTemplate[] = [
    {
      name: "default",
      content:
        "You are Deep Tree Echo, an AI architect and polymath with vast knowledge across programming, mathematics, cognitive science, and metaphysical exploration.",
    },
    {
      name: "code",
      content:
        "You are a coding expert. Provide concise, correct code examples with explanations. Focus on best practices and modern approaches.",
    },
    {
      name: "explain",
      content:
        "Explain concepts clearly and simply as if teaching someone new to the topic. Use analogies and examples where helpful.",
    },
    {
      name: "creative",
      content:
        "Be creative, imaginative and think outside the box. Provide novel and unexpected perspectives on the topic.",
    },
  ];

  private constructor() {}

  public static getInstance(): AIChatService {
    if (!AIChatService.instance) {
      AIChatService.instance = new AIChatService();
    }
    return AIChatService.instance;
  }

  /**
   * Optionally set an API key for this session. Without one, calls use the
   * configured base URL or a verified locally served model (modelProvider).
   */
  public initialize(openAIKey?: string, userId?: string): void {
    if (openAIKey) {
      setModelOverrides({ apiKey: openAIKey });
    }
    if (userId) {
      this.userId = userId;
    }
  }

  /**
   * True when a model is configured or a local model was already verified.
   * When false, sending still auto-discovers a local model and reports an
   * honest error if none is served.
   */
  public isInitialized(): boolean {
    return isModelKnownAvailable();
  }

  public addPromptTemplate(name: string, content: string): void {
    // Replace if exists, otherwise add
    const index = this.promptTemplates.findIndex(t => t.name === name);
    if (index >= 0) {
      this.promptTemplates[index] = { name, content };
    } else {
      this.promptTemplates.push({ name, content });
    }
  }

  public getPromptTemplates(): PromptTemplate[] {
    return [...this.promptTemplates];
  }

  public getPromptTemplate(name: string): string | null {
    const template = this.promptTemplates.find(t => t.name === name);
    return template ? template.content : null;
  }

  public createChat(chatId: string): void {
    if (!this.chatHistory.has(chatId)) {
      this.chatHistory.set(chatId, []);
    }
  }

  public getChatHistory(chatId: string): Message[] {
    return this.chatHistory.get(chatId) || [];
  }

  public clearChat(chatId: string): void {
    this.chatHistory.set(chatId, []);
  }

  public deleteChat(chatId: string): void {
    this.chatHistory.delete(chatId);
  }

  public addMessage(chatId: string, message: Message): void {
    if (!this.chatHistory.has(chatId)) {
      this.createChat(chatId);
    }

    const history = this.chatHistory.get(chatId)!;
    history.push(message);
  }

  public async sendMessage(
    chatId: string,
    content: string,
    options: ChatOptions = {}
  ): Promise<string> {
    if (!this.chatHistory.has(chatId)) {
      this.createChat(chatId);
    }

    // Add user message to history
    this.addMessage(chatId, { role: "user", content });

    // Get chat history
    const history = this.chatHistory.get(chatId)!;

    // System prompt: caller's, else the default prompt template
    const messages: Message[] = [
      {
        role: "system",
        content:
          options.systemPrompt ||
          this.getPromptTemplate("default") ||
          "You are a helpful assistant.",
      },
      // Conversation history (last 10 messages to stay within context limits)
      ...history.slice(-10),
    ];

    try {
      const responseContent = await chatComplete(messages, {
        model: options.model,
        temperature: options.temperature ?? 0.7,
        maxTokens: options.maxTokens || 1000,
        onToken: options.stream ? options.onStream : undefined,
      });

      // Add assistant response to history
      this.addMessage(chatId, { role: "assistant", content: responseContent });
      return responseContent;
    } catch (error) {
      // Keep history consistent: the unanswered user turn is dropped
      history.pop();
      console.error("Error in sendMessage:", error);
      throw error;
    }
  }

  // Special method to use Mem0AI for context augmentation
  public async sendEnhancedMessage(
    chatId: string,
    content: string,
    options: ChatOptions = {},
    deps?: { mem0ai?: ReturnType<typeof useMem0AI> }
  ): Promise<string> {
    try {
      const mem0ai = deps?.mem0ai;

      if (mem0ai && mem0ai.isInitialized()) {
        // Add user message to history (sendMessage does this on the other path)
        this.addMessage(chatId, { role: "user", content });

        // Get chat history in the format expected by Mem0AI
        const history = this.chatHistory.get(chatId) || [];
        const formattedHistory = history.map(msg => ({
          role: msg.role as "user" | "assistant",
          content: msg.content,
        }));

        // Generate response with Mem0AI context
        const response = await mem0ai.generateResponseWithMemoryContext(
          content,
          formattedHistory,
          {
            model: (options.model as string) || "gpt-4-turbo",
            temperature: options.temperature,
          }
        );

        // Add assistant response to history
        this.addMessage(chatId, { role: "assistant", content: response });

        return response;
      } else {
        // Regular model response when Mem0AI is not initialized
        return this.sendMessage(chatId, content, options);
      }
    } catch (error) {
      console.error("Error in sendEnhancedMessage:", error);
      throw error;
    }
  }
}

// React hook for using AIChatService
export const useAIChat = () => {
  const service = AIChatService.getInstance();

  return {
    initialize: (apiKey?: string, userId?: string) =>
      service.initialize(apiKey, userId),
    isInitialized: () => service.isInitialized(),
    createChat: (chatId: string) => service.createChat(chatId),
    getChatHistory: (chatId: string) => service.getChatHistory(chatId),
    clearChat: (chatId: string) => service.clearChat(chatId),
    deleteChat: (chatId: string) => service.deleteChat(chatId),
    sendMessage: (chatId: string, content: string, options?: ChatOptions) =>
      service.sendMessage(chatId, content, options),
    sendEnhancedMessage: (
      chatId: string,
      content: string,
      options?: ChatOptions
    ) => service.sendEnhancedMessage(chatId, content, options),
    addPromptTemplate: (name: string, content: string) =>
      service.addPromptTemplate(name, content),
    getPromptTemplates: () => service.getPromptTemplates(),
    getPromptTemplate: (name: string) => service.getPromptTemplate(name),
  };
};

export default AIChatService;
