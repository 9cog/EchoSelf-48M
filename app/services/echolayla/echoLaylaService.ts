/**
 * EchoLayla Core Service
 *
 * Main service for managing EchoLayla AI assistant functionality,
 * integrating with EchoSelf's memory and cognitive systems.
 */

import type {
  LaylaCharacter,
  ConversationMessage,
  ConversationContext,
  InferenceConfig,
  PrivacySettings,
  AutomationTask,
  TaskType,
} from "./types";
import { getCharacter, getDefaultCharacter } from "./characters";
import { getDefaultAdapter, type AIAdapter } from "./aiIntegration";

/**
 * Default inference configuration
 */
const DEFAULT_INFERENCE_CONFIG: InferenceConfig = {
  model: "gpt-3.5-turbo",
  temperature: 0.7,
  maxTokens: 1000,
  topP: 0.9,
  streaming: true,
};

/**
 * Default privacy settings (privacy-first approach)
 */
const DEFAULT_PRIVACY_SETTINGS: PrivacySettings = {
  localProcessingOnly: false,
  dataRetentionDays: 30,
  enableVoiceRecording: false,
  enableVisionCapture: false,
  shareDataWithEcho: true,
};

/**
 * EchoLayla Service Class
 */
export class EchoLaylaService {
  private activeCharacter: LaylaCharacter = "max";
  private currentContext?: ConversationContext;
  private inferenceConfig: InferenceConfig = { ...DEFAULT_INFERENCE_CONFIG };
  private privacySettings: PrivacySettings = { ...DEFAULT_PRIVACY_SETTINGS };
  private tasks: Map<string, AutomationTask> = new Map();
  // Resolved lazily so a missing provider surfaces as an error on use.
  private aiAdapter?: AIAdapter;

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    console.log("[EchoLayla] Initializing service...");

    // Load saved settings from localStorage if available
    if (typeof window !== "undefined") {
      this.loadSettings();
    }

    console.log(
      `[EchoLayla] Initialized with character: ${this.activeCharacter}`
    );
  }

  /**
   * Switch to a different character
   */
  setCharacter(characterId: LaylaCharacter): void {
    const character = getCharacter(characterId);
    if (!character) {
      throw new Error(`Unknown character: ${characterId}`);
    }

    this.activeCharacter = characterId;

    // Update system prompt in inference config
    this.inferenceConfig.systemPrompt = character.systemPrompt;

    // Start a new conversation context
    this.startNewContext();

    this.saveSettings();
    console.log(`[EchoLayla] Switched to character: ${character.name}`);
  }

  /**
   * Get current active character
   */
  getActiveCharacter(): LaylaCharacter {
    return this.activeCharacter;
  }

  /**
   * Get current character profile
   */
  getActiveCharacterProfile() {
    return getCharacter(this.activeCharacter) || getDefaultCharacter();
  }

  /**
   * Start a new conversation context
   */
  startNewContext(): ConversationContext {
    this.currentContext = {
      id: this.generateId(),
      character: this.activeCharacter,
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: {},
    };

    return this.currentContext;
  }

  /**
   * Get current conversation context
   */
  getContext(): ConversationContext | undefined {
    return this.currentContext;
  }

  /**
   * Add a message to the current context
   */
  addMessage(
    role: "user" | "assistant" | "system",
    content: string,
    metadata?: Record<string, unknown>
  ): ConversationMessage {
    if (!this.currentContext) {
      this.startNewContext();
    }

    const message: ConversationMessage = {
      id: this.generateId(),
      role,
      content,
      character: this.activeCharacter,
      mode: "text",
      timestamp: new Date(),
      metadata,
    };

    this.currentContext!.messages.push(message);
    this.currentContext!.updatedAt = new Date();

    return message;
  }

  /**
   * Send a message and get AI response
   */
  async sendMessage(userMessage: string): Promise<ConversationMessage> {
    // Add user message
    this.addMessage("user", userMessage);

    // Generate the reply with the configured model. Errors propagate to the
    // caller; no assistant message is recorded on failure.
    const response = await this.generateResponse(userMessage);

    return this.addMessage("assistant", response);
  }

  /**
   * Generate AI response using AI adapter
   */
  private async generateResponse(_userMessage: string): Promise<string> {
    const character = this.getActiveCharacterProfile();

    if (!this.currentContext) {
      this.startNewContext();
    }

    // Build messages for AI (persona prompt is model input)
    const messages = [
      {
        role: "system",
        content: this.inferenceConfig.systemPrompt || character.systemPrompt,
      },
      ...this.currentContext!.messages.filter(msg => msg.role !== "system").map(
        msg => ({
          role: msg.role === "assistant" ? "assistant" : "user",
          content: msg.content,
        })
      ),
    ];

    if (!this.aiAdapter) {
      this.aiAdapter = getDefaultAdapter();
    }

    // Generate response; errors propagate to the caller.
    const response = await this.aiAdapter.generate(
      messages,
      this.inferenceConfig
    );

    if (!response.content || !response.content.trim()) {
      throw new Error("The model returned an empty response");
    }

    // Update token usage in context metadata
    if (response.usage && this.currentContext) {
      this.currentContext.metadata.totalTokens = response.usage.totalTokens;
    }

    return response.content;
  }

  /**
   * Set AI adapter (for testing or custom providers)
   */
  setAIAdapter(adapter: AIAdapter): void {
    this.aiAdapter = adapter;
  }

  /**
   * Create an automation task
   */
  createTask(
    type: TaskType,
    description: string,
    input: unknown
  ): AutomationTask {
    const task: AutomationTask = {
      id: this.generateId(),
      type,
      description,
      status: "pending",
      character: this.activeCharacter,
      input,
      createdAt: new Date(),
    };

    this.tasks.set(task.id, task);

    // Attempt to process the task
    this.processTask(task.id);

    return task;
  }

  /**
   * Process an automation task
   */
  private processTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    // No task executor is implemented. Report the task honestly as not
    // executed instead of fabricating a result.
    task.status = "failed";
    task.completedAt = new Date();
    task.output = {
      error: `Task not executed: no executor is available for task type "${task.type}".`,
    };
  }

  /**
   * Get task by ID
   */
  getTask(taskId: string): AutomationTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Get all tasks
   */
  getAllTasks(): AutomationTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * Update inference configuration
   */
  setInferenceConfig(config: Partial<InferenceConfig>): void {
    this.inferenceConfig = { ...this.inferenceConfig, ...config };
    this.saveSettings();
  }

  /**
   * Get current inference configuration
   */
  getInferenceConfig(): InferenceConfig {
    return { ...this.inferenceConfig };
  }

  /**
   * Update privacy settings
   */
  setPrivacySettings(settings: Partial<PrivacySettings>): void {
    this.privacySettings = { ...this.privacySettings, ...settings };
    this.saveSettings();
  }

  /**
   * Get current privacy settings
   */
  getPrivacySettings(): PrivacySettings {
    return { ...this.privacySettings };
  }

  /**
   * Save settings to localStorage
   */
  private saveSettings(): void {
    if (typeof window === "undefined") return;

    const settings = {
      activeCharacter: this.activeCharacter,
      inferenceConfig: this.inferenceConfig,
      privacySettings: this.privacySettings,
    };

    localStorage.setItem("echolayla:settings", JSON.stringify(settings));
  }

  /**
   * Load settings from localStorage
   */
  private loadSettings(): void {
    if (typeof window === "undefined") return;

    const saved = localStorage.getItem("echolayla:settings");
    if (!saved) return;

    try {
      const settings = JSON.parse(saved);

      if (settings.activeCharacter) {
        this.activeCharacter = settings.activeCharacter;
      }

      if (settings.inferenceConfig) {
        this.inferenceConfig = {
          ...DEFAULT_INFERENCE_CONFIG,
          ...settings.inferenceConfig,
        };
      }

      if (settings.privacySettings) {
        this.privacySettings = {
          ...DEFAULT_PRIVACY_SETTINGS,
          ...settings.privacySettings,
        };
      }
    } catch (error) {
      console.error("[EchoLayla] Failed to load settings:", error);
    }
  }

  /**
   * Generate a unique ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }
}

/**
 * Singleton instance
 */
let echoLaylaInstance: EchoLaylaService | null = null;

/**
 * Get or create the EchoLayla service instance
 */
export function getEchoLaylaService(): EchoLaylaService {
  if (!echoLaylaInstance) {
    echoLaylaInstance = new EchoLaylaService();
  }
  return echoLaylaInstance;
}
