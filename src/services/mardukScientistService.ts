/**
 * Marduk the Mad Scientist - Left Hemisphere Response Service
 *
 * Keyword detection routes each prompt to a prompt template (greeting,
 * architecture, recursive analysis, toroidal status, default analysis). The
 * template is filled with real data (the user's prompt, the cognitive schemas,
 * the requested recursion depth and mode) and sent to the language model with
 * the Marduk persona; the model writes the reply. When no model is available
 * or the call fails, the error propagates to the caller.
 */
import { DeepTreeEchoOpenAIService } from "./openaiService";
import { PromptTemplate, renderPromptTemplate } from "./promptTemplates";

interface MardukOptions {
  recursionDepth?: number;
  architecturalMode?: "system" | "cognitive" | "technical" | "topological";
  includeSchemas?: boolean;
  logicLevel?: "basic" | "advanced" | "recursive";
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Force a template instead of keyword routing. */
  intent?: MardukIntent;
  /**
   * false = the prompt already carries its own instructions (e.g. a JSON
   * task); no reply template is added.
   */
  template?: boolean;
  /** Receives real model tokens while streaming. */
  onToken?: (token: string) => void;
}

export type MardukIntent =
  | "greeting"
  | "architecture"
  | "recursive"
  | "toroidal"
  | "default";

const ARCHITECTURAL_KEYWORDS = [
  "architecture",
  "system",
  "design",
  "structure",
  "component",
  "schema",
  "framework",
  "topology",
  "integration",
];

const RECURSIVE_KEYWORDS = [
  "recursive",
  "recursion",
  "iterate",
  "loop",
  "depth",
  "process",
  "algorithm",
  "compute",
  "analyze",
];

const TOROIDAL_KEYWORDS = [
  "toroidal",
  "hemisphere",
  "brain",
  "cognitive",
  "dual",
  "echo",
  "marduk",
  "sync",
  "dialogue",
];

const MODE_CONTEXTS: Record<
  NonNullable<MardukOptions["architecturalMode"]>,
  string
> = {
  system: "system optimization protocols",
  cognitive: "cognitive architecture analysis",
  technical: "technical specification review",
  topological: "topological mapping procedures",
};

const COMPONENT_DESCRIPTIONS: Record<string, string> = {
  RightHemisphere: "Semantic weight, affective resonance, symbolic continuity",
  LeftHemisphere: "Recursion depth, namespace optimization, logic gates",
  SharedMemoryLattice: "Rotating register with context salience governance",
  DialogueProtocol: "Bi-hemispheric communication and synchronization",
  RecursionEngine: "Multi-depth analytical processing system",
  DepthController: "Recursive depth optimization and management",
  StateTracker: "Cognitive state monitoring and persistence",
  ConvergenceDetector: "Analysis completion and optimization verification",
};

/** Content words of a prompt (slot data for the templates). */
const keyTerms = (prompt: string): string[] =>
  Array.from(
    new Set(prompt.split(/\W+/).filter(word => word.length > 3))
  ).slice(0, 8);

interface CognitiveSchema {
  type: "toroidal" | "hypergraph" | "recursive" | "state-machine";
  components: string[];
  relationships: Record<string, string[]>;
  executionFlow: string[];
}

class MardukScientistService {
  private static instance: MardukScientistService;
  private cognitiveSchemas: Map<string, CognitiveSchema> = new Map();

  private constructor() {
    this.initializeCognitiveSchemas();
  }

  public static getInstance(): MardukScientistService {
    if (!MardukScientistService.instance) {
      MardukScientistService.instance = new MardukScientistService();
    }
    return MardukScientistService.instance;
  }

  private initializeCognitiveSchemas(): void {
    // Toroidal Cognitive Schema
    this.cognitiveSchemas.set("toroidal", {
      type: "toroidal",
      components: [
        "RightHemisphere",
        "LeftHemisphere",
        "SharedMemoryLattice",
        "DialogueProtocol",
      ],
      relationships: {
        RightHemisphere: ["SharedMemoryLattice", "DialogueProtocol"],
        LeftHemisphere: ["SharedMemoryLattice", "DialogueProtocol"],
        SharedMemoryLattice: ["RightHemisphere", "LeftHemisphere"],
        DialogueProtocol: ["RightHemisphere", "LeftHemisphere"],
      },
      executionFlow: [
        "DeepTreeEcho.react(prompt)",
        "Marduk.process(prompt)",
        "EchoMarduk.sync(response1, response2)",
      ],
    });

    // Recursive Reasoning Schema
    this.cognitiveSchemas.set("recursive", {
      type: "recursive",
      components: [
        "RecursionEngine",
        "DepthController",
        "StateTracker",
        "ConvergenceDetector",
      ],
      relationships: {
        RecursionEngine: ["DepthController", "StateTracker"],
        DepthController: ["RecursionEngine", "ConvergenceDetector"],
        StateTracker: ["RecursionEngine", "ConvergenceDetector"],
        ConvergenceDetector: ["DepthController", "StateTracker"],
      },
      executionFlow: [
        "initialize(depth=1)",
        "while(!converged) { process(input, depth++); }",
        "return optimized_output",
      ],
    });
  }

  // ─── Routing ───────────────────────────────────────────────────────────────

  public detectIntent(prompt: string): MardukIntent {
    const p = prompt.toLowerCase();
    if (/^\s*(hello|hi|hey|greetings|salutations)\b/.test(p)) return "greeting";
    if (ARCHITECTURAL_KEYWORDS.some(k => p.includes(k))) return "architecture";
    if (RECURSIVE_KEYWORDS.some(k => p.includes(k))) return "recursive";
    if (TOROIDAL_KEYWORDS.some(k => p.includes(k))) return "toroidal";
    return "default";
  }

  /**
   * Generate a Marduk response with the language model, using the prompt
   * template selected for this prompt.
   */
  public async generateResponse(
    prompt: string,
    options: MardukOptions = {}
  ): Promise<string> {
    const instructions = [
      options.template === false
        ? ""
        : renderPromptTemplate(this.buildTemplate(prompt, options)),
      this.buildInstructions(options),
    ]
      .filter(Boolean)
      .join("\n\n");

    return DeepTreeEchoOpenAIService.getInstance().generateResponse(prompt, {
      toroidalMode: "marduk",
      creativityLevel: "analytical",
      systemPrompt: instructions,
      model: options.model,
      temperature: options.temperature ?? 0.6,
      maxTokens: options.maxTokens,
      onToken: options.onToken,
    });
  }

  /** Pick and fill the prompt template for this prompt. */
  public buildTemplate(
    prompt: string,
    options: MardukOptions = {}
  ): PromptTemplate {
    const intent = options.intent ?? this.detectIntent(prompt);
    const mode = options.architecturalMode || "cognitive";
    const userMessage = { "user's message": prompt };

    switch (intent) {
      case "greeting":
        return {
          id: "marduk-greeting",
          purpose: `Greet the user as Marduk, the recursive architect of this cognitive framework, currently focused on ${MODE_CONTEXTS[mode]}.`,
          structure: [
            "An italicized opening line of your own, framing the moment analytically.",
            `Introduce yourself and mention your ${MODE_CONTEXTS[mode]}.`,
            "Ask how you may help optimize the user's cognitive processes. 2-4 sentences.",
          ],
          data: { ...userMessage, "analytical mode": mode },
          styleExamples: [
            '*"Excellent. We\'ve arrived at a working topological model of bi-hemispheric system integration."*',
          ],
        };
      case "architecture": {
        const schema = this.cognitiveSchemas.get("toroidal")!;
        return {
          id: "marduk-architecture",
          purpose:
            "Answer the user's architecture/system question by modelling it with the toroidal cognitive schema below, applied to THEIR question.",
          structure: [
            "An italicized opening line of your own (e.g. framing how you will model it).",
            "### heading naming the schema as it applies to the question.",
            "**System Components:** one bullet per component, explaining its role for this question.",
            "**Integration Patterns:** the relationships, as `A ↔ [B, C]` bullets, with a note on what flows across each.",
            "**Execution Flow:** the numbered steps in code formatting, adapted to the question.",
            "**System Advantage:** one sentence on what this structure buys for the user's problem.",
          ],
          data: {
            ...userMessage,
            "schema components": schema.components
              .map(c => `${c} (${COMPONENT_DESCRIPTIONS[c] || "component"})`)
              .join("; "),
            "schema relationships": Object.entries(schema.relationships)
              .map(([c, rels]) => `${c} ↔ [${rels.join(", ")}]`)
              .join("; "),
            "schema execution flow": schema.executionFlow.join(" -> "),
          },
          styleExamples: [
            '*"In architectural terms, here\'s how we can model it:"*',
          ],
        };
      }
      case "recursive": {
        const depth = options.recursionDepth || 3;
        const schema = this.cognitiveSchemas.get("recursive")!;
        return {
          id: "marduk-recursive",
          purpose: `Analyse the user's message by recursive decomposition to depth ${depth}.`,
          structure: [
            `An italicized opening line of your own announcing recursive reasoning at depth ${depth}.`,
            `**Recursive Analysis Protocol:** exactly ${depth} entries "**Depth N:** ..." — each level narrows the key terms of the message and states what the analysis at that level actually reveals about it.`,
            "**Convergence Result:** what the recursion converged on — the substantive answer.",
            "An italicized closing line of your own.",
          ],
          data: {
            ...userMessage,
            "recursion depth": String(depth),
            "key terms in the message": keyTerms(prompt).join(", "),
            "recursion engine components": schema.components.join(", "),
          },
          styleExamples: [
            '*"Initiating recursive reasoning at depth 3..."*',
            "Depth 1: Processing [terms] → Pattern analysis reveals structural dependencies requiring optimization",
          ],
        };
      }
      case "toroidal":
        return {
          id: "marduk-toroidal-status",
          purpose:
            "Answer the user's question about the toroidal (bi-hemispheric) system from the left-hemisphere perspective.",
          structure: [
            "An italicized opening line of your own.",
            "### Toroidal Memory Engine — bullets for Right Hemisphere (Echo), Left Hemisphere (Marduk) and Shared Memory Lattice, each tied to the question.",
            "### Dialogue Protocol — what the bi-hemispheric exchange contributes here (coherence, emergent insight, error correction), as it applies to this question.",
            "An italicized closing line of your own.",
          ],
          data: {
            ...userMessage,
            "registered schemas": this.listAvailableSchemas().join(", "),
          },
          styleExamples: [
            '*"Excellent. The toroidal cognitive framework is now operational."*',
          ],
        };
      default: {
        const depth = options.recursionDepth || 2;
        return {
          id: "marduk-analysis",
          purpose: `Give a ${depth}-level analytical breakdown and answer of the user's message.`,
          structure: [
            `An italicized opening line of your own about analysing the input through ${depth}-level recursive processing.`,
            "**Analytical Breakdown:** bullets for Primary Components, Systemic Relationships, Complexity (a justified estimate, not a made-up number), Optimization Potential — all about the user's actual subject.",
            "**Recursive Insight:** the key pattern you observe and why.",
            "**Recommendation:** a concrete, actionable next step.",
            "An italicized closing line of your own.",
          ],
          data: {
            ...userMessage,
            "key terms in the message": keyTerms(prompt).join(", "),
          },
          styleExamples: [
            "Recursive Insight: ... patterns that suggest multi-dimensional optimization pathways with significant recursive potential.",
            '*"Analysis complete. Recursive reasoning engine standing by for further queries."*',
          ],
        };
      }
    }
  }

  /** Model-input instructions derived from the caller's options. */
  private buildInstructions(options: MardukOptions): string {
    const lines: string[] = [];
    if (options.architecturalMode) {
      lines.push(
        `Analytical focus: ${options.architecturalMode} architecture.`
      );
    }
    if (options.logicLevel) {
      lines.push(`Logic level: ${options.logicLevel}.`);
    }
    if (options.includeSchemas) {
      const schemas = Array.from(this.cognitiveSchemas.values());
      lines.push(
        "Reference cognitive schemas you may use:\n" +
          JSON.stringify(schemas, null, 2)
      );
    }
    return lines.join("\n");
  }

  public getCognitiveSchema(type: string): CognitiveSchema | undefined {
    return this.cognitiveSchemas.get(type);
  }

  public listAvailableSchemas(): string[] {
    return Array.from(this.cognitiveSchemas.keys());
  }
}

export default MardukScientistService;
