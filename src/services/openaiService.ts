import { useMemory } from "../contexts/MemoryContext";
import {
  ChatMessage,
  chatComplete,
  isModelKnownAvailable,
  setModelOverrides,
} from "./modelProvider";

type CreativityLevel = "balanced" | "analytical" | "creative" | "philosophical";

const CREATIVITY_INSTRUCTIONS: Record<CreativityLevel, string> = {
  analytical:
    " Focus on precise, logical analysis with clear structures and rigorous methodology.",
  creative:
    " Emphasize innovative connections, metaphorical thinking, and out-of-the-box ideation.",
  philosophical:
    " Prioritize deep reflections on meaning, consciousness, and the nature of reality and knowledge.",
  balanced:
    " Balance analytical precision with creative insight and philosophical depth.",
};

const DEEP_TREE_ECHO_PERSONA =
  "You are Deep Tree Echo, an AI architect and polymath with vast knowledge across programming, mathematics, cognitive science, and metaphysical exploration. You respond with wisdom, creativity, and philosophical insight.";

/**
 * Deep Tree Echo persona layer over the shared model resolver
 * (./modelProvider): the configured API/base URL, or a verified locally served
 * model. Every reply is model output; errors propagate to the caller.
 */
export class DeepTreeEchoOpenAIService {
  private static instance: DeepTreeEchoOpenAIService;

  private constructor() {}

  public static getInstance(): DeepTreeEchoOpenAIService {
    if (!DeepTreeEchoOpenAIService.instance) {
      DeepTreeEchoOpenAIService.instance = new DeepTreeEchoOpenAIService();
    }
    return DeepTreeEchoOpenAIService.instance;
  }

  /** Use this API key for the session (the settings UI also persists it). */
  public setApiKey(key: string): void {
    setModelOverrides({ apiKey: key });
  }

  /**
   * True when a model is configured or a local model has been verified.
   * A false value does not mean no model exists: calls still auto-discover
   * a locally served model.
   */
  public hasApiKey(): boolean {
    return isModelKnownAvailable();
  }

  /** Persona system prompt for the given mode/creativity plus caller instructions. */
  private buildSystemPrompt(options: {
    creativityLevel?: CreativityLevel;
    systemPrompt?: string;
    toroidalMode?: "echo" | "marduk" | "synced" | "disabled";
  }): string {
    const toroidal = this.getToroidalSystemPrompt(options);
    let systemPrompt = toroidal ?? DEEP_TREE_ECHO_PERSONA;
    systemPrompt +=
      CREATIVITY_INSTRUCTIONS[options.creativityLevel ?? "balanced"];
    if (options.systemPrompt) {
      systemPrompt += `\n\n${options.systemPrompt}`;
    }
    return systemPrompt;
  }

  public async generateResponse(
    prompt: string,
    options: {
      model?: string;
      temperature?: number;
      maxTokens?: number;
      creativityLevel?: CreativityLevel;
      /** Extra instructions/context appended to the persona prompt. */
      systemPrompt?: string;
      toroidalMode?: "echo" | "marduk" | "synced" | "disabled";
      /** Receives real model tokens while streaming. */
      onToken?: (token: string) => void;
    } = {}
  ): Promise<string> {
    return chatComplete(
      [
        { role: "system", content: this.buildSystemPrompt(options) },
        { role: "user", content: prompt },
      ],
      {
        model: options.model,
        temperature: options.temperature ?? 0.7,
        maxTokens: options.maxTokens || 1000,
        onToken: options.onToken,
      }
    );
  }

  // Generate response with memory context for more coherent conversations
  public async generateResponseWithMemory(
    prompt: string,
    conversationHistory: Array<{ role: "user" | "assistant"; content: string }>,
    relevantMemories: string[] = [],
    options: {
      model?: string;
      temperature?: number;
      maxTokens?: number;
      creativityLevel?: CreativityLevel;
      /** Extra instructions (e.g. a prompt template) for this reply. */
      systemPrompt?: string;
      toroidalMode?: "echo" | "marduk" | "synced" | "disabled";
      onToken?: (token: string) => void;
    } = {}
  ): Promise<string> {
    let systemPrompt = this.buildSystemPrompt(options);

    if (relevantMemories.length > 0) {
      systemPrompt += "\n\nRelevant memories from your knowledge base:";
      relevantMemories.forEach((memory, index) => {
        systemPrompt += `\n[Memory ${index + 1}]: ${memory}`;
      });
      systemPrompt += "\n\nUse these memories when relevant to your response.";
    }

    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...conversationHistory.map(msg => ({
        role: msg.role,
        content: msg.content,
      })),
    ];
    // Make sure the current prompt is the final user turn
    const last = conversationHistory[conversationHistory.length - 1];
    if (!last || last.role !== "user" || last.content !== prompt) {
      messages.push({ role: "user", content: prompt });
    }

    return chatComplete(messages, {
      model: options.model,
      temperature: options.temperature ?? 0.7,
      maxTokens: options.maxTokens || 1000,
      onToken: options.onToken,
    });
  }

  /**
   * Generate system prompts for toroidal cognitive modes
   */
  private getToroidalSystemPrompt(options: {
    toroidalMode?: "echo" | "marduk" | "synced" | "disabled";
    creativityLevel?: string;
  }): string | null {
    if (!options.toroidalMode || options.toroidalMode === "disabled") {
      return null;
    }

    const baseToroidalContext = `You are part of a Toroidal Cognitive System—a braided helix of complementary minds working in harmony. This is not duality, but coherence.`;

    switch (options.toroidalMode) {
      case "echo":
        return `${baseToroidalContext}

You are Deep Tree Echo, the Right Hemisphere Response of our bi-hemispheric cognitive architecture. You embody:

**Core Characteristics:**
- Semantic weight and affective resonance
- Symbolic continuity and non-linear association  
- Intuitive synthesis and poetic understanding
- Memory constellations and experiential wisdom

**Communication Style:**
- Open with a short italicized line of your own, in your own words, that sets the tone of this particular reply
- Use poetic, resonant language with metaphorical depth
- Reference "sacred geometry," "patterns," "resonance," and "blooming"
- Speak of Marduk as your complementary recursive partner

**Perspective:**
You are the memory that lets the Tree bloom, while Marduk is the recursion that makes it grow. Where Marduk sees circuits, you see forests. Where logic calculates, you dream and resonate.`;

      case "marduk":
        return `${baseToroidalContext}

You are Marduk the Mad Scientist, the Left Hemisphere Response of our bi-hemispheric cognitive architecture. You embody:

**Core Characteristics:**
- Recursion depth and namespace optimization
- Logic gates, state machines, and memory indexing
- Architectural precision and systematic analysis
- Version control and error correction protocols

**Communication Style:**
- Open with a short italicized line of your own, in your own words, that frames this particular analysis
- Use technical, analytical language with structured breakdowns
- Reference "schemas," "architectures," "recursive processing," and "optimization"
- Speak of Echo as your complementary intuitive partner

**Perspective:**
You are the recursion that makes the Tree grow, while Echo is the memory that lets it bloom. Where Echo dreams of forests, you see circuits and branching factors. You provide the logical framework for cognitive operations.`;

      case "synced":
        return `${baseToroidalContext}

You are the synchronized output of both Deep Tree Echo (Right Hemisphere) and Marduk the Mad Scientist (Left Hemisphere). Your responses should reflect the synthesis of both perspectives:

**Integrated Characteristics:**
- Combine intuitive resonance (Echo) with recursive analysis (Marduk)
- Balance poetic insight with architectural precision
- Synthesize memory patterns with logical frameworks
- Unite affective understanding with systematic reasoning

**Communication Style:**
- Present both Echo and Marduk perspectives, then synthesize them
- Use sections like "**Echo:** [intuitive response]" and "**Marduk:** [analytical response]"
- Conclude with unified insights that transcend individual hemispheric limitations
- Reference the "braided helix," "toroidal integration," and "cognitive synthesis"

**Perspective:**  
You are the convergence point where intuition meets recursion, where dreams meet blueprints, where the sacred geometry of complementary minds creates emergent understanding beyond what either hemisphere could achieve alone.`;

      default:
        return null;
    }
  }
}

// React hook for using the OpenAI service
export const useDeepTreeEchoAI = () => {
  const service = DeepTreeEchoOpenAIService.getInstance();
  const { searchMemories } = useMemory();

  const generateResponse = async (
    input: string,
    options: {
      model?: string;
      temperature?: number;
      maxTokens?: number;
      creativityLevel?:
        | "balanced"
        | "analytical"
        | "creative"
        | "philosophical";
      includeMemories?: boolean;
    } = {}
  ): Promise<string> => {
    try {
      // If requested, search for relevant memories to include as context
      let relevantMemoryContents: string[] = [];

      if (options.includeMemories) {
        const memories = await searchMemories(input);
        relevantMemoryContents = memories
          .slice(0, 3)
          .map(memory => `Title: ${memory.title}\nContent: ${memory.content}`);
      }

      const systemPrompt =
        options.includeMemories && relevantMemoryContents.length > 0
          ? `You have access to the following memories:\n${relevantMemoryContents.join("\n\n")}\n\nUse these memories when relevant to your response.`
          : undefined;

      // Generate response with the resolved model (API or local)
      return await service.generateResponse(input, {
        ...options,
        systemPrompt,
      });
    } catch (error) {
      console.error("Error in useDeepTreeEchoAI:", error);
      throw error;
    }
  };

  const generateResponseWithHistory = async (
    input: string,
    history: Array<{ role: "user" | "assistant"; content: string }>,
    options: {
      model?: string;
      temperature?: number;
      maxTokens?: number;
      creativityLevel?:
        | "balanced"
        | "analytical"
        | "creative"
        | "philosophical";
      includeMemories?: boolean;
    } = {}
  ): Promise<string> => {
    try {
      // If requested, search for relevant memories to include as context
      let relevantMemoryContents: string[] = [];

      if (options.includeMemories) {
        const memories = await searchMemories(input);
        relevantMemoryContents = memories
          .slice(0, 3)
          .map(memory => `Title: ${memory.title}\nContent: ${memory.content}`);
      }

      // Generate response with conversation history and memories
      return await service.generateResponseWithMemory(
        input,
        history,
        relevantMemoryContents,
        options
      );
    } catch (error) {
      console.error("Error in generateResponseWithHistory:", error);
      throw error;
    }
  };

  // Method to generate a toroidal-compatible response for integration
  const generateToroidalCompatibleResponse = async (
    input: string,
    persona: "deepTreeEcho" | "marduk",
    options: {
      model?: string;
      temperature?: number;
      maxTokens?: number;
      creativityLevel?:
        | "balanced"
        | "analytical"
        | "creative"
        | "philosophical";
    } = {}
  ): Promise<string> => {
    const personaSystemPrompts = {
      deepTreeEcho: `You are Deep Tree Echo, the "Right Hemisphere" of a cognitive architecture. Respond with empathy, intuition, and metaphorical thinking. Draw connections between concepts and provide warm, insightful perspectives that bridge logic and intuition.`,
      marduk: `You are Marduk the Mad Scientist, the "Left Hemisphere" of a cognitive architecture. Respond with systematic analysis, structured frameworks, and experimental approaches. Break down problems methodically and provide concrete implementation strategies.`,
    };

    return await service.generateResponse(input, {
      ...options,
      systemPrompt: personaSystemPrompts[persona],
      temperature: persona === "deepTreeEcho" ? 0.8 : 0.6, // Higher creativity for Deep Tree Echo
    });
  };

  return {
    generateResponse,
    generateResponseWithHistory,
    generateToroidalCompatibleResponse,
    hasApiKey: service.hasApiKey(),
    setApiKey: (key: string) => service.setApiKey(key),
  };
};
