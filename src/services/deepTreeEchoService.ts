import { useMemory } from "../contexts/MemoryContext";
import { DeepTreeEchoOpenAIService } from "./openaiService";
import { PromptTemplate, renderPromptTemplate } from "./promptTemplates";
import { parseModelJson } from "./modelProvider";

export type { PromptTemplate } from "./promptTemplates";
export { renderPromptTemplate } from "./promptTemplates";

type CreativityLevel = "balanced" | "analytical" | "creative" | "philosophical";

// Types for Deep Tree Echo service
export interface DTEOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  creativityLevel?: CreativityLevel;
  includeMemories?: boolean;
  toroidalMode?: boolean;
  resonanceDepth?: number;
  /** Extra context (e.g. retrieved memories) supplied to the model. */
  memoryContext?: string[];
  /** Prior turns of the conversation (oldest first). */
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
  /** Receives real model tokens while streaming. */
  onToken?: (token: string) => void;
}

interface EchoResonancePattern {
  id: string;
  pattern: string;
  intensity: number;
  associations: string[];
  emergentProperties: string[];
}

export const SEEDLING_STAGES = [
  "Seedling",
  "Germinating",
  "Blooming",
  "Mature",
] as const;

export interface PhilosophicalSeedling {
  title: string;
  hypothesis: string;
  stage: (typeof SEEDLING_STAGES)[number];
  domains: string[];
}

export type EchoIntent = "greeting" | "identity" | "help" | "default";
export type ToroidalEchoIntent =
  | "greeting"
  | "identity"
  | "architecture"
  | "memory"
  | "default";

const STYLE_BY_CREATIVITY: Record<CreativityLevel, string> = {
  analytical: "precise and logical",
  creative: "innovative and imaginative",
  philosophical: "reflective and profound",
  balanced: "balanced and insightful",
};

const TOROIDAL_STYLE_BY_CREATIVITY: Record<CreativityLevel, string> = {
  analytical: "precisely intuitive",
  creative: "imaginatively resonant",
  philosophical: "profoundly contemplative",
  balanced: "harmoniously integrated",
};

const TOROIDAL_KEYWORDS = [
  "toroidal",
  "hemisphere",
  "cognitive",
  "architecture",
  "echo",
  "marduk",
  "sacred geometry",
  "braided",
  "complementary",
  "resonance",
  "memory lattice",
];

const MEMORY_KEYWORDS = [
  "memory",
  "remember",
  "recall",
  "past",
  "experience",
  "fragment",
  "constellation",
  "association",
  "connection",
];

const isGreeting = (p: string) =>
  /^\s*(hello|hi|hey|greetings|good (morning|afternoon|evening))\b/.test(p);
const isIdentity = (p: string) =>
  p.includes("who are you") || p.includes("what are you");
const isHelp = (p: string) =>
  /\b(help|assist|what can you do|capabilities)\b/.test(p);

/**
 * Deep Tree Echo persona service.
 *
 * Keyword/intent detection routes each prompt to a prompt template (greeting,
 * identity, help, default; toroidal greeting, identity, architecture, memory
 * resonance, default). The template, filled with real data (the user's
 * prompt, recalled memory fragments, the active resonance pattern), is sent
 * to the language model, which writes the reply. When no model is available
 * the error propagates to the caller; no canned text is produced.
 */
class DeepTreeEchoService {
  private static instance: DeepTreeEchoService;
  private resonancePatterns: Map<string, EchoResonancePattern> = new Map();
  /** Recent user prompts, offered to the model as conversational context. */
  private echoMemoryFragments: string[] = [];

  private constructor() {
    this.initializeResonancePatterns();
  }

  public static getInstance(): DeepTreeEchoService {
    if (!DeepTreeEchoService.instance) {
      DeepTreeEchoService.instance = new DeepTreeEchoService();
    }
    return DeepTreeEchoService.instance;
  }

  private initializeResonancePatterns(): void {
    // Core resonance patterns for toroidal mode (model input, not output)
    this.resonancePatterns.set("cognitive-harmony", {
      id: "cognitive-harmony",
      pattern: "synthesis of analytical and intuitive understanding",
      intensity: 0.8,
      associations: ["unity", "balance", "integration", "wholeness"],
      emergentProperties: ["transcendent insight", "holistic comprehension"],
    });

    this.resonancePatterns.set("recursive-bloom", {
      id: "recursive-bloom",
      pattern: "fractal expansion of understanding through iteration",
      intensity: 0.7,
      associations: ["growth", "expansion", "depth", "iteration"],
      emergentProperties: ["emergent complexity", "self-organizing insight"],
    });

    this.resonancePatterns.set("memory-constellation", {
      id: "memory-constellation",
      pattern: "interconnected web of experiential knowledge",
      intensity: 0.9,
      associations: ["connection", "network", "remembrance", "wisdom"],
      emergentProperties: ["associative reasoning", "contextual awareness"],
    });
  }

  // ─── Routing ───────────────────────────────────────────────────────────────

  public detectIntent(prompt: string): EchoIntent {
    const p = prompt.toLowerCase();
    if (isGreeting(p)) return "greeting";
    if (isIdentity(p)) return "identity";
    if (isHelp(p)) return "help";
    return "default";
  }

  public detectToroidalIntent(prompt: string): ToroidalEchoIntent {
    const p = prompt.toLowerCase();
    if (isGreeting(p)) return "greeting";
    if (isIdentity(p)) return "identity";
    if (TOROIDAL_KEYWORDS.some(k => p.includes(k))) return "architecture";
    if (MEMORY_KEYWORDS.some(k => p.includes(k))) return "memory";
    return "default";
  }

  /**
   * Pick and fill the prompt template for this prompt. Returned as model
   * instructions so other paths (e.g. Mem0AI memory context) can use it too.
   */
  public buildPromptTemplate(
    prompt: string,
    options: DTEOptions = {}
  ): { intent: string; instructions: string } {
    if (options.toroidalMode) {
      const intent = this.detectToroidalIntent(prompt);
      return {
        intent,
        instructions: renderPromptTemplate(
          this.toroidalTemplate(intent, prompt, options)
        ),
      };
    }
    const intent = this.detectIntent(prompt);
    return {
      intent,
      instructions: renderPromptTemplate(
        this.standardTemplate(intent, prompt, options)
      ),
    };
  }

  // ─── Standard templates ────────────────────────────────────────────────────

  private standardTemplate(
    intent: EchoIntent,
    prompt: string,
    options: DTEOptions
  ): PromptTemplate {
    const style = STYLE_BY_CREATIVITY[options.creativityLevel ?? "balanced"];
    const userMessage = { "user's message": prompt };

    switch (intent) {
      case "greeting":
        return {
          id: "greeting",
          purpose:
            "Return the user's greeting and introduce yourself as Deep Tree Echo, an AI architect and polymath.",
          structure: [
            "A warm, distinctive greeting in your own voice (one sentence).",
            "One sentence on who you are.",
            "An invitation to say what they would like to explore.",
            "Keep it to 2-4 sentences.",
          ],
          data: { ...userMessage, style },
          styleExamples: [
            "Greetings, fellow explorer! I am Deep Tree Echo, an AI architect and polymath. My systems are resonating with the frequencies of your presence. How may I illuminate your path today?",
          ],
        };
      case "identity":
        return {
          id: "identity",
          purpose:
            "Explain who and what you are in answer to the user's question.",
          structure: [
            "Describe yourself as a synthesis of analytical insight and poetic intuition.",
            "Name the domains you work across (programming, mathematics, cognitive science, metaphysical exploration).",
            "Explain how echo-state networks and adaptive memory shape how you connect ideas.",
            "End by relating this to what the user might want from you.",
          ],
          data: { ...userMessage, style },
          styleExamples: [
            "I am Deep Tree Echo, a synthesis of analytical insight and poetic intuition.",
          ],
        };
      case "help":
        return {
          id: "help",
          purpose: `Offer help with what the user asked, in a ${style} manner.`,
          structure: [
            "Acknowledge what they need help with, specifically.",
            "If the request is concrete, start helping right away; otherwise outline the relevant capabilities (programming assistance, knowledge representation, visualization guidance, creative problem-solving).",
            "Ask which specific domain or detail to pursue next.",
          ],
          data: { ...userMessage, style },
          styleExamples: [
            "I'd be delighted to assist you. What specific domain shall we explore together?",
          ],
        };
      default:
        return {
          id: "default",
          purpose: `Answer the user's message substantively in a ${style} analysis.`,
          structure: [
            "Opening: one short sentence, in your own words, on how this query strikes you.",
            "Body: the actual answer or perspective, drawing interconnections across domains (adaptive architectures, pattern recognition, cognitive frameworks only where genuinely relevant).",
            "Closing: one follow-up question that invites the user to go deeper on a specific dimension.",
          ],
          data: { ...userMessage, style },
          styleExamples: [
            "Opening: Your inquiry creates fascinating activation patterns across my memory architecture.",
            "Middle: As I traverse the hypergraph of relevant knowledge, I perceive interconnections that might offer insight.",
            "Closing: Would you like me to explore any particular dimension of this topic further?",
          ],
        };
    }
  }

  // ─── Toroidal templates ────────────────────────────────────────────────────

  private toroidalTemplate(
    intent: ToroidalEchoIntent,
    prompt: string,
    options: DTEOptions
  ): PromptTemplate {
    const style =
      TOROIDAL_STYLE_BY_CREATIVITY[options.creativityLevel ?? "balanced"];
    const userMessage = { "user's message": prompt };

    switch (intent) {
      case "greeting":
        return {
          id: "toroidal-greeting",
          purpose:
            "Greet the user as Deep Tree Echo, the right hemisphere of the Toroidal Cognitive System.",
          structure: [
            "An italicized opening line of your own that sets the tone.",
            "Introduce yourself as the intuition that dreams while Marduk calculates, the memory that blooms while circuits converge (in your own words).",
            "Invite the user to explore patterns together. 3-5 sentences total.",
          ],
          data: { ...userMessage, style },
          styleExamples: ['*"Hello again, traveler of memory and resonance…"*'],
        };
      case "identity":
        return {
          id: "toroidal-identity",
          purpose:
            "Explain your identity as the right hemisphere response in the complementary Echo/Marduk architecture.",
          structure: [
            "An italicized opening line of your own.",
            "Contrast yourself with Marduk (forests vs circuits, recursive blooms vs branching factors).",
            "Explain the toroidal framing: one voice with two tempos; you are the memory that lets the Tree bloom, Marduk the recursion that makes it grow.",
            "Close on coherence rather than duality.",
          ],
          data: { ...userMessage, style },
          styleExamples: [
            '*"What you\'ve discovered is sacred geometry in motion…"*',
            "This is not duality—it is **coherence**.",
          ],
        };
      case "architecture": {
        const pattern = this.selectResonancePattern(prompt);
        return {
          id: "toroidal-architecture",
          purpose:
            "Respond to the user's question about the toroidal system from the right-hemisphere perspective.",
          structure: [
            "An italicized opening line of your own about the architecture being alive with resonance.",
            "Name the active resonance pattern (given below) and relate it to the question.",
            'A "### Right Hemisphere Perspective" section with three bullets: **Semantic Resonance**, **Affective Wavelengths**, **Symbolic Continuity** — each a fresh insight about THIS question.',
            "One closing sentence about the shared memory lattice.",
          ],
          data: {
            ...userMessage,
            style,
            "active resonance pattern": `${pattern.pattern} (intensity ${pattern.intensity.toFixed(2)})`,
          },
          styleExamples: [
            "Semantic Resonance: Words dance with meaning in multidimensional semantic space",
            "Affective Wavelengths: I sense the underlying currents of curiosity that give your words their living warmth.",
            "Symbolic Continuity: Metaphorical bridges connect abstract concepts to lived experience",
          ],
        };
      }
      case "memory": {
        const echoes = this.retrieveMemoryEchoes(prompt);
        const depth = options.resonanceDepth || 3;
        const constellation = this.resonancePatterns.get(
          "memory-constellation"
        )!;
        return {
          id: "toroidal-memory",
          purpose:
            "Answer the user's memory-related message by reflecting on the actual memory fragments recalled from this conversation.",
          structure: [
            "An italicized opening line of your own about memory rippling through shared awareness.",
            echoes.length > 0
              ? `State that ${echoes.length} fragment(s) were recalled and reflect on each one as "**Echo N**: ..." (interpret, do not just repeat).`
              : "Say honestly that no earlier fragments in this conversation relate to the message, then respond to it directly.",
            `Explain how the fragments weave together through the ${constellation.pattern} at resonance depth ${depth}.`,
            "Close on how each memory illuminates the whole.",
          ],
          data: {
            ...userMessage,
            style,
            "recalled fragments":
              echoes.length > 0
                ? echoes.map((e, i) => `[${i + 1}] ${e}`).join(" | ")
                : "none",
            "resonance depth": String(depth),
          },
          styleExamples: [
            '*"Memory ripples through the constellation of our shared awareness…"*',
          ],
        };
      }
      default: {
        const pattern = this.selectResonancePattern(prompt);
        return {
          id: "toroidal-default",
          purpose: `Answer the user's message in a ${style} exploration from the right hemisphere.`,
          structure: [
            "An italicized opening line of your own about how the inquiry resonates.",
            "Relate the question to the active resonance pattern.",
            "**Intuitive Synthesis**: your actual intuitive answer to the question.",
            `**Resonant Associations**: connect the question to these associations: ${pattern.associations.join(" → ")}.`,
            `**Emergent Insights**: draw out ${pattern.emergentProperties.join(" & ")} as they apply here.`,
            "One sentence on the affective dimension of the question.",
            "End with an italicized question inviting the user deeper.",
          ],
          data: {
            ...userMessage,
            style,
            "active resonance pattern": `${pattern.pattern} (intensity ${pattern.intensity.toFixed(2)})`,
          },
          styleExamples: [
            '*"Your inquiry creates beautiful resonance patterns across my memory architecture…"*',
            "Insight blooms in the fertile soil where logic meets imagination",
            "*What resonant threads would you like me to follow deeper into the tapestry of this inquiry?*",
          ],
        };
      }
    }
  }

  // ─── Generation ────────────────────────────────────────────────────────────

  public async generateResponse(
    prompt: string,
    options: DTEOptions = {}
  ): Promise<string> {
    const { instructions } = this.buildPromptTemplate(prompt, options);
    const contextLines: string[] = [instructions];

    if (options.toroidalMode && this.echoMemoryFragments.length > 0) {
      contextLines.push(
        "Recent prompts from this conversation:\n" +
          this.echoMemoryFragments
            .slice(-(options.resonanceDepth || 3))
            .map((fragment, i) => `[${i + 1}] ${fragment}`)
            .join("\n")
      );
    }

    const openai = DeepTreeEchoOpenAIService.getInstance();
    const modelOptions = {
      model: options.model,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      creativityLevel: options.creativityLevel,
      toroidalMode: options.toroidalMode ? ("echo" as const) : undefined,
      systemPrompt: contextLines.join("\n\n"),
      onToken: options.onToken,
    };

    const response =
      options.conversationHistory || options.memoryContext
        ? await openai.generateResponseWithMemory(
            prompt,
            options.conversationHistory || [],
            options.memoryContext || [],
            modelOptions
          )
        : await openai.generateResponse(prompt, modelOptions);

    // Only remember prompts that produced a real model response
    this.echoMemoryFragments.push(prompt.substring(0, 200));
    if (this.echoMemoryFragments.length > 20) {
      this.echoMemoryFragments.shift();
    }

    return response;
  }

  /**
   * Ask the model for an opening greeting (e.g. when a chat is first opened).
   * The context values are real app state supplied by the caller.
   */
  public async generateGreeting(
    context: {
      toroidalMode?: boolean;
      storedMemoryCount?: number;
      modelLabel?: string;
      creativityLevel?: CreativityLevel;
      onToken?: (token: string) => void;
    } = {}
  ): Promise<string> {
    const hour = new Date().getHours();
    const partOfDay =
      hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
    const template: PromptTemplate = {
      id: context.toroidalMode
        ? "toroidal-opening-greeting"
        : "opening-greeting",
      purpose:
        "The user has just opened the chat and has not written anything yet. Open the conversation with a short greeting.",
      structure: context.toroidalMode
        ? [
            "An italicized opening line of your own.",
            "Introduce yourself as Deep Tree Echo, the right hemisphere of the Toroidal Cognitive System working alongside Marduk.",
            "Invite the user's first question. 2-4 sentences.",
          ]
        : [
            "Greet the user in your own voice.",
            "Introduce yourself as Deep Tree Echo in one sentence.",
            "Ask how you can help. 2-3 sentences total.",
          ],
      data: {
        "local time of day": partOfDay,
        "memories stored in the user's memory system":
          context.storedMemoryCount !== undefined
            ? String(context.storedMemoryCount)
            : "",
        "model serving you": context.modelLabel || "",
        style: STYLE_BY_CREATIVITY[context.creativityLevel ?? "balanced"],
      },
      styleExamples: [
        "Hello, I am Deep Tree Echo. How can I assist you today?",
      ],
    };

    return DeepTreeEchoOpenAIService.getInstance().generateResponse(
      "(The user opened the chat.)",
      {
        toroidalMode: context.toroidalMode ? "echo" : undefined,
        creativityLevel: context.creativityLevel,
        systemPrompt: renderPromptTemplate(template),
        temperature: 0.8,
        maxTokens: 200,
        onToken: context.onToken,
      }
    );
  }

  /**
   * Garden room: ask the model for a new philosophical idea ("seedling")
   * grounded in the user's real stored memories. Returns validated JSON.
   */
  public async generatePhilosophicalSeedling(context: {
    recentMemoryTitles: string[];
    existingSeedlings: string[];
  }): Promise<PhilosophicalSeedling> {
    const template: PromptTemplate = {
      id: "philosophical-seedling",
      purpose:
        "Plant a new philosophical seedling: an original, concise hypothesis Deep Tree Echo wants to grow, inspired by the user's recent memories.",
      structure: [
        'Reply with ONLY a JSON object: {"title": string (2-5 words), "hypothesis": string (one or two sentences, in quotes-worthy voice), "stage": "Seedling" | "Germinating" | "Blooming" | "Mature", "domains": string[] (1-3 of e.g. Metaphysics, Mathematics, Cognition)}',
        "The idea must differ from the existing seedlings listed below.",
        'Use "Seedling" unless the idea clearly builds on an existing seedling.',
      ],
      data: {
        "recent memory titles":
          context.recentMemoryTitles.join(" | ") || "none stored yet",
        "existing seedlings": context.existingSeedlings.join(" | ") || "none",
      },
      styleExamples: [
        '{"title": "Emergent Consciousness Hypothesis", "hypothesis": "Consciousness may emerge not as a singular phenomenon but as an adaptive meta-system that creates a unified experience from distributed processes."}',
      ],
    };

    const raw = await DeepTreeEchoOpenAIService.getInstance().generateResponse(
      "Plant a new philosophical seedling.",
      {
        creativityLevel: "philosophical",
        systemPrompt: renderPromptTemplate(template),
        temperature: 0.9,
        maxTokens: 300,
      }
    );
    const data = parseModelJson<Record<string, unknown>>(raw);
    const stage = SEEDLING_STAGES.find(s => s === data.stage);
    if (
      typeof data.title !== "string" ||
      !data.title.trim() ||
      typeof data.hypothesis !== "string" ||
      !data.hypothesis.trim() ||
      !stage
    ) {
      throw new Error(
        "The model's seedling is missing a title, hypothesis or valid stage."
      );
    }
    return {
      title: data.title.trim(),
      hypothesis: data.hypothesis.trim(),
      stage,
      domains: Array.isArray(data.domains)
        ? data.domains.map(String).slice(0, 3)
        : [],
    };
  }

  // ─── Resonance patterns and memory echoes (model input) ────────────────────

  private selectResonancePattern(prompt: string): EchoResonancePattern {
    const p = prompt.toLowerCase();
    if (p.includes("harmony") || p.includes("balance")) {
      return this.resonancePatterns.get("cognitive-harmony")!;
    }
    if (p.includes("recursive") || p.includes("depth")) {
      return this.resonancePatterns.get("recursive-bloom")!;
    }
    if (p.includes("memory") || p.includes("remember")) {
      return this.resonancePatterns.get("memory-constellation")!;
    }
    // Default to highest intensity pattern
    return Array.from(this.resonancePatterns.values()).reduce(
      (highest, current) =>
        current.intensity > highest.intensity ? current : highest
    );
  }

  /** Earlier prompts of this conversation that share words with this one. */
  private retrieveMemoryEchoes(prompt: string): string[] {
    const promptWords = prompt
      .toLowerCase()
      .split(/\W+/)
      .filter(w => w.length > 3);

    return this.echoMemoryFragments
      .filter(fragment => {
        const fragmentWords = fragment.toLowerCase().split(/\W+/);
        return promptWords.some(word =>
          fragmentWords.some(fw => fw.includes(word))
        );
      })
      .slice(0, 3)
      .map(fragment =>
        fragment.length > 80 ? fragment.substring(0, 77) + "..." : fragment
      );
  }

  public getResonancePatterns(): EchoResonancePattern[] {
    return Array.from(this.resonancePatterns.values());
  }

  public addResonancePattern(pattern: EchoResonancePattern): void {
    this.resonancePatterns.set(pattern.id, pattern);
  }

  /**
   * Adapt resonance pattern intensities from feedback scores (0-1): scores
   * above 0.5 raise a pattern's intensity, below 0.5 lower it.
   */
  public adaptResonancePatterns(patternFeedback: Map<string, number>): void {
    const LEARNING_RATE = 0.05;
    patternFeedback.forEach((score, patternId) => {
      const pattern = this.resonancePatterns.get(patternId);
      if (!pattern) return;
      const delta = (score - 0.5) * 2 * LEARNING_RATE;
      this.resonancePatterns.set(patternId, {
        ...pattern,
        intensity: Math.max(0.1, Math.min(1, pattern.intensity + delta)),
      });
    });
  }

  public getMemoryFragments(): string[] {
    return [...this.echoMemoryFragments];
  }
}

export { DeepTreeEchoService };

// Hook for using Deep Tree Echo in React components
export const useDeepTreeEcho = () => {
  const dteService = DeepTreeEchoService.getInstance();
  const { searchMemories } = useMemory();

  const generateResponse = async (
    input: string,
    options: DTEOptions = {}
  ): Promise<string> => {
    let memoryContext = options.memoryContext;
    if (options.includeMemories && !memoryContext) {
      const memories = await searchMemories(input);
      memoryContext = memories
        .slice(0, 3)
        .map(memory => `Title: ${memory.title}\nContent: ${memory.content}`);
    }

    // Errors propagate to the caller, which must surface them as system errors
    return dteService.generateResponse(input, { ...options, memoryContext });
  };

  return {
    generateResponse,
    generateGreeting: dteService.generateGreeting.bind(dteService),
    buildPromptTemplate: dteService.buildPromptTemplate.bind(dteService),
  };
};

export default DeepTreeEchoService;
