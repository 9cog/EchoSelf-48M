/**
 * EchoLayla Core Service
 *
 * Main service for managing EchoLayla AI assistant functionality,
 * integrating with EchoSelf's memory and cognitive systems.
 */

import type {
  CharacterProfile,
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
 * Greeting prompt template: when a conversation opens, the character
 * introduces itself and asks how it can help. The model writes the words.
 */
const GREETING_TEMPLATE = (character: CharacterProfile): string =>
  `A user has just opened a conversation with you and has not written anything yet. Greet them as ${character.name}: introduce yourself by name, say in a few words what you are like (${character.description}; traits: ${character.traits.join(", ")}), and ask how you can help today. One or two sentences, in your own voice.`;

type TaskTemplate = (slots: {
  character: string;
  description: string;
  input: string;
}) => string;

/**
 * Prompt templates for task types the model itself can perform. Task types
 * without an entry ("remember", "schedule", "remind") need an executor
 * (memory store, scheduler) and are reported as not executed.
 */
const TASK_TEMPLATES: Partial<Record<TaskType, TaskTemplate>> = {
  summarize: ({ description, input }) =>
    `Task: ${description || "Summarize the input."}\nWrite a concise, faithful summary of the input below. Keep the key facts and conclusions; add nothing that is not in it.\n\nInput:\n${input}`,
  analyze: ({ description, input }) =>
    `Task: ${description || "Analyze the input."}\nAnalyze the input below: identify its main points, patterns, strengths, weaknesses or risks, and give your conclusions. Say clearly where the input does not support a conclusion.\n\nInput:\n${input}`,
  create: ({ character, description, input }) =>
    `Task: ${description || "Create the requested content."}\nAs ${character}, create the requested content. Use the input below as material and constraints.\n\nInput:\n${input}`,
};

function formatTaskInput(input: unknown): string {
  if (input === undefined || input === null || input === "") return "(none)";
  return typeof input === "string" ? input : JSON.stringify(input, null, 2);
}

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
  private taskRuns: Map<string, Promise<void>> = new Map();
  // Resolved lazily so a missing provider surfaces as an error on use.
  private aiAdapter?: AIAdapter;

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    console.log("[EchoLayla] Initializing service...");

    // Load saved settings from localStorage if available
    if (typeof localStorage !== "undefined") {
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
   * Run one model turn on the current context with an extra prompt-template
   * instruction appended (model input only). Returns the model's text.
   */
  private async generateWithInstruction(instruction: string): Promise<string> {
    const character = this.getActiveCharacterProfile();
    if (!this.currentContext) {
      this.startNewContext();
    }
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
      { role: "system", content: instruction },
    ];
    if (!this.aiAdapter) {
      this.aiAdapter = getDefaultAdapter();
    }
    const response = await this.aiAdapter.generate(
      messages,
      this.inferenceConfig
    );
    if (!response.content || !response.content.trim()) {
      throw new Error("The model returned an empty response");
    }
    return response.content.trim();
  }

  /**
   * The active character greets the user when a conversation opens. The
   * greeting template is an instruction; the model writes the greeting.
   */
  async generateGreeting(): Promise<ConversationMessage> {
    const content = await this.generateWithInstruction(
      GREETING_TEMPLATE(this.getActiveCharacterProfile())
    );
    return this.addMessage("assistant", content);
  }

  /**
   * Set AI adapter (for testing or custom providers)
   */
  setAIAdapter(adapter: AIAdapter): void {
    this.aiAdapter = adapter;
  }

  /**
   * Create an automation task. Processing starts immediately and runs
   * asynchronously; poll getTask() or use runTask() to await the result.
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

    // Start processing task asynchronously
    this.processTask(task.id).catch(error =>
      console.error("[EchoLayla] Task processing failed:", error)
    );

    return task;
  }

  /**
   * Create a task and wait until it has completed or failed.
   */
  async runTask(
    type: TaskType,
    description: string,
    input: unknown
  ): Promise<AutomationTask> {
    const task = this.createTask(type, description, input);
    await this.taskRuns.get(task.id);
    return task;
  }

  /**
   * Process an automation task. Text tasks the model can actually perform
   * (summarize, analyze, create) run through a prompt template and the
   * model's real output is the result. Tasks that need an executor this
   * service does not have (memory store, scheduler) are reported as not
   * executed.
   */
  private processTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return Promise.resolve();

    const template = TASK_TEMPLATES[task.type];
    if (!template) {
      task.status = "failed";
      task.completedAt = new Date();
      task.output = {
        error: `Task not executed: no executor is available for task type "${task.type}".`,
      };
      return Promise.resolve();
    }

    task.status = "processing";
    const run = (async () => {
      try {
        const result = await this.generateTaskOutput(
          template({
            character: this.getActiveCharacterProfile().name,
            description: task.description,
            input: formatTaskInput(task.input),
          })
        );
        task.status = "completed";
        task.output = { result };
      } catch (error) {
        task.status = "failed";
        task.output = {
          error: `Task failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      } finally {
        task.completedAt = new Date();
        this.taskRuns.delete(taskId);
      }
    })();
    this.taskRuns.set(taskId, run);
    return run;
  }

  /**
   * One stand-alone model call for a task (the conversation is not sent).
   */
  private async generateTaskOutput(prompt: string): Promise<string> {
    const character = this.getActiveCharacterProfile();
    if (!this.aiAdapter) {
      this.aiAdapter = getDefaultAdapter();
    }
    const response = await this.aiAdapter.generate(
      [
        {
          role: "system",
          content: this.inferenceConfig.systemPrompt || character.systemPrompt,
        },
        { role: "user", content: prompt },
      ],
      this.inferenceConfig
    );
    if (!response.content || !response.content.trim()) {
      throw new Error("The model returned an empty response");
    }
    return response.content.trim();
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
    if (typeof localStorage === "undefined") return;

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
    if (typeof localStorage === "undefined") return;

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
