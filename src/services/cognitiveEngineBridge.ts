// deno-lint-ignore-file no-node-globals
/**
 * Cognitive Engine Bridge - Python-TypeScript interop for cognitive engines
 *
 * Bridges the TypeScript frontend with Python cognitive engines
 * (RelevanceRealizationEngine and VirtualEmbodiment) via child_process.
 * When Python is unavailable, relevance evaluation fails with an error (no
 * heuristic scores are substituted); embodiment grounding is instead written
 * by the language model from a prompt template (validated JSON), with the
 * engine-measured fields left null.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import * as path from "path";
import process from "node:process";
import { completePrompt, parseModelJson } from "./modelProvider";
import { renderPromptTemplate } from "./promptTemplates";

const execFileAsync = promisify(execFile);

// ---------- Types ----------

export interface RelevanceEvaluation {
  conceptId: string;
  relevanceScore: number;
  criteria: {
    goalAlignment: number;
    predictivePower: number;
    cognitiveEconomy: number;
    noveltyValue: number;
    contextualFit: number;
  };
  opponentProcessStates: {
    explorationExploitation: number;
    breadthDepth: number;
    speedAccuracy: number;
    certaintyOpenness: number;
  };
}

export interface EmbodiedGrounding {
  originalLanguage: string;
  groundedMetaphors: string[];
  sensoriMotorMappings: Array<{
    concept: string;
    modality: string;
    affordance: string;
  }>;
  /** Measured by the Python engine; null when grounded by the model. */
  bodySchemaRelevance: number | null;
  /** Measured by the Python engine; null when grounded by the model. */
  predictionError: number | null;
  /** Which engine produced this grounding. */
  source?: "virtual-embodiment" | "model";
}

export interface BridgeStatus {
  pythonAvailable: boolean;
  relevanceEngineReady: boolean;
  embodimentEngineReady: boolean;
  pythonVersion: string | null;
  lastCheck: string;
}

// ---------- Service ----------

export class CognitiveEngineBridge {
  private static instance: CognitiveEngineBridge;
  private pythonPath: string;
  private projectRoot: string;
  private pythonAvailable: boolean | null = null;
  private pythonVersion: string | null = null;

  private constructor() {
    this.pythonPath = process.env.PYTHON_PATH || "python3";
    // Resolve project root relative to this file's location (src/services/)
    this.projectRoot =
      process.env.ECHOSELF_ROOT || path.resolve(__dirname, "..", "..");
  }

  public static getInstance(): CognitiveEngineBridge {
    if (!CognitiveEngineBridge.instance) {
      CognitiveEngineBridge.instance = new CognitiveEngineBridge();
    }
    return CognitiveEngineBridge.instance;
  }

  // ---------- Python availability ----------

  /**
   * Check whether Python 3 and required dependencies are available.
   */
  public async checkPythonAvailability(): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync(this.pythonPath, [
        "-c",
        "import sys, numpy; print(sys.version.split()[0])",
      ]);
      this.pythonVersion = stdout.trim();
      this.pythonAvailable = true;
      return true;
    } catch {
      this.pythonAvailable = false;
      this.pythonVersion = null;
      console.warn(
        "CognitiveEngineBridge: Python 3 or numpy not available. Cognitive engines are unavailable."
      );
      return false;
    }
  }

  /**
   * Return current bridge health status.
   */
  public async getStatus(): Promise<BridgeStatus> {
    if (this.pythonAvailable === null) {
      await this.checkPythonAvailability();
    }
    return {
      pythonAvailable: this.pythonAvailable ?? false,
      relevanceEngineReady: this.pythonAvailable ?? false,
      embodimentEngineReady: this.pythonAvailable ?? false,
      pythonVersion: this.pythonVersion,
      lastCheck: new Date().toISOString(),
    };
  }

  // ---------- Relevance Realization ----------

  /**
   * Evaluate the relevance of a concept within a given context by calling
   * the Python RelevanceRealizationEngine.
   *
   * Throws when Python is unavailable.
   */
  public async evaluateRelevance(
    conceptId: string,
    conceptData: Record<string, unknown>,
    context: {
      goals?: string[];
      noveltyNeeded?: boolean;
      precisionNeeded?: boolean;
    } = {}
  ): Promise<RelevanceEvaluation> {
    if (this.pythonAvailable === null) {
      await this.checkPythonAvailability();
    }

    if (!this.pythonAvailable) {
      throw new Error(
        "Relevance engine unavailable: Python 3 with numpy is required"
      );
    }
    return this.evaluateRelevancePython(conceptId, conceptData, context);
  }

  private async evaluateRelevancePython(
    conceptId: string,
    conceptData: Record<string, unknown>,
    context: Record<string, unknown>
  ): Promise<RelevanceEvaluation> {
    const script = `
import sys, json
sys.path.insert(0, '${this.projectRoot}')
from relevance_realization_engine import RelevanceRealizationEngine, Possibility

engine = RelevanceRealizationEngine()
ctx = json.loads('''${JSON.stringify(context)}''')
concept = json.loads('''${JSON.stringify(conceptData)}''')

p = Possibility(id='${conceptId}', data=concept)
results = engine.realize_relevance([p], ctx)

if results:
    r = results[0]
    out = {
        "conceptId": r.id,
        "relevanceScore": round(r.criteria.score(), 4),
        "criteria": {
            "goalAlignment": round(r.criteria.goal_alignment, 4),
            "predictivePower": round(r.criteria.predictive_power, 4),
            "cognitiveEconomy": round(r.criteria.cognitive_economy, 4),
            "noveltyValue": round(r.criteria.novelty_value, 4),
            "contextualFit": round(r.criteria.contextual_fit, 4),
        },
        "opponentProcessStates": {
            "explorationExploitation": round(engine.exploration_exploitation.balance, 4),
            "breadthDepth": round(engine.breadth_depth.balance, 4),
            "speedAccuracy": round(engine.speed_accuracy.balance, 4),
            "certaintyOpenness": round(engine.certainty_openness.balance, 4),
        }
    }
else:
    sys.exit("RelevanceRealizationEngine returned no result")

print(json.dumps(out))
`;

    const { stdout } = await execFileAsync(this.pythonPath, ["-c", script], {
      timeout: 15000,
    });
    return JSON.parse(stdout.trim()) as RelevanceEvaluation;
  }

  // ---------- Virtual Embodiment ----------

  /**
   * Ground language in embodied metaphors by calling the Python
   * VirtualEmbodiment engine.
   *
   * Without Python, the language model grounds the text from the
   * embodied-grounding prompt template.
   */
  public async groundLanguageInEmbodiment(
    language: string,
    environmentContext: {
      objects?: Array<{ id: string; position?: number[]; value?: number }>;
      goal?: { type: string; valueThreshold?: number };
    } = {}
  ): Promise<EmbodiedGrounding> {
    if (this.pythonAvailable === null) {
      await this.checkPythonAvailability();
    }

    if (!this.pythonAvailable) {
      return this.groundLanguageWithModel(language, environmentContext);
    }
    return this.groundLanguagePython(language, environmentContext);
  }

  /** Model-written grounding (prompt template + validated JSON). */
  private async groundLanguageWithModel(
    language: string,
    environmentContext: Record<string, unknown>
  ): Promise<EmbodiedGrounding> {
    const instructions = renderPromptTemplate({
      id: "embodied-grounding",
      purpose:
        "Ground the given language in embodied, sensorimotor metaphors (4E cognition: embodied, embedded, enacted, extended).",
      structure: [
        'Reply with ONLY a JSON object: {"groundedMetaphors": string[], "sensoriMotorMappings": [{"concept": string, "modality": "vision" | "audio" | "touch" | "proprioception" | "interoception", "affordance": string}]}',
        "Map each concept in the language that has a bodily basis to the modality it grounds through and the action it affords.",
        "Write one grounded metaphor per mapping.",
      ],
      data: {
        language,
        "environment context": JSON.stringify(environmentContext),
      },
      styleExamples: [
        'groundedMetaphors: ["The concept grasp grounds through touch: understanding as holding"]',
      ],
    });

    const raw = await completePrompt(instructions, language, {
      temperature: 0.4,
      maxTokens: 600,
    });
    const data = parseModelJson<{
      groundedMetaphors?: unknown;
      sensoriMotorMappings?: unknown;
    }>(raw);
    if (
      !Array.isArray(data.groundedMetaphors) ||
      !Array.isArray(data.sensoriMotorMappings)
    ) {
      throw new Error(
        "The model's grounding is missing groundedMetaphors or sensoriMotorMappings."
      );
    }
    const mappings = data.sensoriMotorMappings
      .filter(
        (m): m is Record<string, unknown> => typeof m === "object" && m !== null
      )
      .map(m => ({
        concept: String(m.concept ?? ""),
        modality: String(m.modality ?? ""),
        affordance: String(m.affordance ?? ""),
      }))
      .filter(m => m.concept && m.modality);

    return {
      originalLanguage: language,
      groundedMetaphors: data.groundedMetaphors.map(String),
      sensoriMotorMappings: mappings,
      bodySchemaRelevance: null,
      predictionError: null,
      source: "model",
    };
  }

  private async groundLanguagePython(
    language: string,
    environmentContext: Record<string, unknown>
  ): Promise<EmbodiedGrounding> {
    // Build a safe environment state for Python (numpy arrays constructed in-script)
    const objectsJson = JSON.stringify(
      ((environmentContext.objects as any[]) || []).map((o: any) => ({
        id: o.id,
        position: o.position || [0, 0, 0],
        value: o.value || 0.5,
      }))
    );

    const script = `
import sys, json, numpy as np
sys.path.insert(0, '${this.projectRoot}')
from virtual_embodiment import VirtualEmbodiment

embodiment = VirtualEmbodiment()

objects_raw = json.loads('''${objectsJson}''')
environment = {
    'objects': [
        {'id': o['id'], 'position': np.array(o['position']), 'value': o['value']}
        for o in objects_raw
    ],
    'terrain': {'walkable': [{'center': np.array([1.0, 0.0, 0.0])}]}
}

goal = ${environmentContext.goal ? `json.loads('''${JSON.stringify(environmentContext.goal)}''')` : "None"}

result = embodiment.perceive_act_cycle(environment, goal)
proprio = embodiment.get_proprioception()

# Map concepts in the language to sensorimotor modalities
language = '''${language.replace(/'/g, "\\'")}'''
words = language.lower().split()

modality_map = {
    'see': 'vision', 'look': 'vision', 'observe': 'vision', 'watch': 'vision',
    'hear': 'audio', 'listen': 'audio', 'sound': 'audio',
    'touch': 'touch', 'feel': 'touch', 'grasp': 'touch', 'hold': 'touch',
    'move': 'proprioception', 'walk': 'proprioception', 'run': 'proprioception',
    'sense': 'interoception', 'aware': 'interoception',
}

mappings = []
for word in words:
    if word in modality_map:
        mappings.append({
            'concept': word,
            'modality': modality_map[word],
            'affordance': f'{word}_action'
        })

metaphors = [
    f"The concept grounds through {m['modality']} as {m['concept']}"
    for m in mappings
]

prediction_error = float(result.get('prediction_error', 0.0))

out = {
    'originalLanguage': language,
    'groundedMetaphors': metaphors,
    'sensoriMotorMappings': mappings,
    'bodySchemaRelevance': float(proprio['energy']),
    'predictionError': round(prediction_error, 4)
}

print(json.dumps(out))
`;

    const { stdout } = await execFileAsync(this.pythonPath, ["-c", script], {
      timeout: 15000,
    });
    return {
      ...(JSON.parse(stdout.trim()) as EmbodiedGrounding),
      source: "virtual-embodiment",
    };
  }
}

export default CognitiveEngineBridge;
