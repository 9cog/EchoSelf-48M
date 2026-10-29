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
  /** Measured by the Python engine; null when it is not available. */
  bodySchemaRelevance: number | null;
  /**
   * Measured by the Python engine when a real visual frame and a goal were
   * supplied; null otherwise.
   */
  predictionError: number | null;
  /** Which engine produced this grounding. */
  source?: "model" | "model+virtual-embodiment";
}

export interface EmbodimentContext {
  objects?: Array<{ id: string; position?: number[]; value?: number }>;
  goal?: { type: string; valueThreshold?: number };
  /** A real visual frame (H x W x 3); required for a perceive-act cycle. */
  visual?: number[][][];
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
   * Ground language in embodied metaphors. The language model always writes
   * the grounding from the embodied-grounding prompt template; when Python is
   * available the VirtualEmbodiment engine adds its measured values.
   */
  public async groundLanguageInEmbodiment(
    language: string,
    environmentContext: EmbodimentContext = {}
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
    environmentContext: EmbodimentContext
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
        // The raw visual frame is measured by the Python engine, not prompted.
        "environment context": JSON.stringify({
          objects: environmentContext.objects,
          goal: environmentContext.goal,
        }),
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

  /**
   * Python path: the model writes the grounding (metaphors and
   * sensorimotor mappings, from the embodied-grounding prompt template);
   * the VirtualEmbodiment engine contributes only what it actually measures
   * (body-schema energy and, when a real visual frame and a goal are
   * supplied, the prediction error of one perceive-act cycle).
   */
  private async groundLanguagePython(
    language: string,
    environmentContext: EmbodimentContext
  ): Promise<EmbodiedGrounding> {
    const grounding = await this.groundLanguageWithModel(
      language,
      environmentContext
    );

    const payload = JSON.stringify({
      objects: (environmentContext.objects || []).map(o => ({
        id: o.id,
        position: o.position || [0, 0, 0],
        value: o.value ?? null,
      })),
      goal: environmentContext.goal ?? null,
      visual: environmentContext.visual ?? null,
    });

    // The payload is passed on stdin, never interpolated into the script.
    const script = `
import sys, json, numpy as np
sys.path.insert(0, ${JSON.stringify(this.projectRoot)})
from virtual_embodiment import VirtualEmbodiment

ctx = json.loads(sys.stdin.read())
embodiment = VirtualEmbodiment()

prediction_error = None
if ctx['visual'] is not None and ctx['goal'] is not None:
    environment = {
        'objects': [
            {'id': o['id'], 'position': np.array(o['position']), 'value': o['value']}
            for o in ctx['objects'] if o['value'] is not None
        ],
        'terrain': {'walkable': []},
        'visual': np.asarray(ctx['visual'], dtype=float),
    }
    result = embodiment.perceive_act_cycle(environment, ctx['goal'])
    if result.get('action') is not None:
        prediction_error = round(float(result['prediction_error']), 4)

proprio = embodiment.get_proprioception()
print(json.dumps({
    'bodySchemaRelevance': float(proprio['energy']),
    'predictionError': prediction_error,
}))
`;

    const measured = await new Promise<{
      bodySchemaRelevance: number | null;
      predictionError: number | null;
    }>((resolve, reject) => {
      const child = execFile(
        this.pythonPath,
        ["-c", script],
        { timeout: 15000 },
        (error, stdout) => {
          if (error) {
            reject(error);
            return;
          }
          try {
            resolve(JSON.parse(stdout.trim()));
          } catch (parseError) {
            reject(parseError);
          }
        }
      );
      child.stdin?.end(payload);
    });

    return {
      ...grounding,
      bodySchemaRelevance: measured.bodySchemaRelevance,
      predictionError: measured.predictionError,
      source: "model+virtual-embodiment",
    };
  }
}

export default CognitiveEngineBridge;
