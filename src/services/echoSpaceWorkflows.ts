/**
 * EchoSpace Workflows: Implementation of Marduk's recursive workflow system
 *
 * These workflows embody the step-by-step implementation roadmap from the problem statement,
 * creating a living system with fractal agency.
 */

import {
  SimulationRecord,
  ConsensusState,
  ConsensusVote,
  SimulationResult,
  AgentArenaMemory,
} from "../types/EchoSpace";
import { Mem0rySearchResult } from "../types/Mem0AI";

import { EchoSpaceService } from "./echoSpaceService";
import Mem0AIService from "./mem0aiService";
import MardukScientistService from "./mardukScientistService";

export interface WorkflowContext {
  agentNamespace: string;
  arenaNamespace: string;
  taskQueue: string;
  metadata?: Record<string, unknown>;
}

export interface WorkflowResult<T = unknown> {
  success: boolean;
  result?: T;
  error?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Memory Workflow: Store and retrieve Agent-Arena relations and simulation results
 */
export class MemoryWorkflow {
  private echoSpace: EchoSpaceService;
  private memoryService: Mem0AIService | null = null;

  constructor() {
    this.echoSpace = EchoSpaceService.getInstance();
  }

  public async run(
    context: WorkflowContext & {
      operation: "store" | "retrieve" | "update";
      data?: AgentArenaMemory;
      query?: string;
    }
  ): Promise<WorkflowResult<AgentArenaMemory | AgentArenaMemory[]>> {
    console.log(
      `Memory Workflow: ${context.operation} in ${context.arenaNamespace} for ${context.agentNamespace}`
    );

    try {
      switch (context.operation) {
        case "store":
          if (!context.data) {
            throw new Error("Data required for store operation");
          }
          return await this.storeMemory(context.data);

        case "retrieve":
          if (!context.query) {
            throw new Error("Query required for retrieve operation");
          }
          return await this.retrieveMemory(
            context.agentNamespace,
            context.query
          );

        case "update":
          if (!context.data) {
            throw new Error("Data required for update operation");
          }
          return await this.updateMemory(context.data);

        default:
          throw new Error(`Unknown memory operation: ${context.operation}`);
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        metadata: { workflow: "memory", operation: context.operation },
      };
    }
  }

  private async storeMemory(
    memory: AgentArenaMemory
  ): Promise<WorkflowResult<AgentArenaMemory>> {
    // Store the Agent-Arena-Relation and simulation result
    if (!this.memoryService) {
      this.memoryService = Mem0AIService.getInstance();
    }

    if (!this.memoryService.isInitialized()) {
      console.warn("Memory service not initialized");
      return { success: false, error: "Memory service not initialized" };
    }

    const stored = await this.memoryService.addMemory({
      title: `Agent-Arena Memory: ${memory.agentId} -> ${memory.arenaId}`,
      content: memory.content,
      tags: [
        "echospace",
        "workflow",
        memory.memoryType,
        memory.agentId,
        memory.arenaId,
      ],
      type: "procedural",
      metadata: {
        echoSpaceMemory: memory,
        agentId: memory.agentId,
        arenaId: memory.arenaId,
      },
    });

    return {
      success: true,
      result: memory,
      metadata: { storedMemoryId: stored.id },
    };
  }

  private async retrieveMemory(
    agentId: string,
    query: string
  ): Promise<WorkflowResult<AgentArenaMemory[]>> {
    if (!this.memoryService) {
      this.memoryService = Mem0AIService.getInstance();
    }

    if (!this.memoryService.isInitialized()) {
      return { success: false, error: "Memory service not initialized" };
    }

    const results = await this.memoryService.searchMemories(query, {
      limit: 20,
      includeTags: ["echospace", agentId],
    });

    const memories: AgentArenaMemory[] = results
      .filter((r: Mem0rySearchResult) => r.metadata?.echoSpaceMemory)
      .map(
        (r: Mem0rySearchResult) =>
          r.metadata!.echoSpaceMemory as AgentArenaMemory
      );

    return {
      success: true,
      result: memories,
      metadata: { foundCount: memories.length },
    };
  }

  private async updateMemory(
    memory: AgentArenaMemory
  ): Promise<WorkflowResult<AgentArenaMemory>> {
    memory.updatedAt = new Date();
    return await this.storeMemory(memory);
  }
}

/**
 * Sandbox Workflow: Run simulations for Virtual Marduks
 */
export class SandboxWorkflow {
  private echoSpace: EchoSpaceService;

  constructor() {
    this.echoSpace = EchoSpaceService.getInstance();
  }

  public async run(
    context: WorkflowContext & {
      hypothesis: string;
      virtualAgentId?: string;
    }
  ): Promise<WorkflowResult<SimulationResult>> {
    console.log(
      `Sandbox Workflow: Testing hypothesis "${context.hypothesis}" in ${context.arenaNamespace}`
    );

    try {
      // Create a simulated environment
      const sandbox = this.createSandboxEnvironment(context.arenaNamespace);

      // Run the hypothesis in the sandbox
      const result = await sandbox.test(
        context.hypothesis,
        context.virtualAgentId
      );

      console.log(
        `Hypothesis tested: ${context.hypothesis}, Result: ${result.success ? "SUCCESS" : "FAILURE"}`
      );

      return {
        success: true,
        result,
        metadata: {
          workflow: "sandbox",
          hypothesis: context.hypothesis,
          arenaNamespace: context.arenaNamespace,
        },
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Sandbox execution failed",
        metadata: { workflow: "sandbox", hypothesis: context.hypothesis },
      };
    }
  }

  /**
   * The sandbox assessment is produced by the model speaking as Marduk. The
   * model's structured JSON verdict is parsed; nothing is randomized or
   * filled in locally. If the model is unavailable or returns unusable
   * output, the error propagates.
   */
  private createSandboxEnvironment(arenaId: string) {
    return {
      async test(
        hypothesis: string,
        virtualAgentId?: string
      ): Promise<SimulationResult> {
        const start = Date.now();
        const prompt = `You are Virtual Marduk agent "${virtualAgentId || "virtual"}" running a thought-experiment sandbox in arena "${arenaId}".
Assess this hypothesis:
"${hypothesis}"

Reply with ONLY a JSON object of this shape:
{"success": boolean, "outcome": string, "confidence": number between 0 and 1, "observations": string[], "recommendations": string[], "riskLevel": "low" | "medium" | "high" | "critical", "riskFactors": string[]}`;

        const raw = await MardukScientistService.getInstance().generateResponse(
          prompt,
          { architecturalMode: "system", temperature: 0.4, template: false }
        );
        const assessment = parseSandboxAssessment(raw);

        return {
          success: assessment.success,
          outcome: assessment.outcome,
          metrics: {
            confidence: assessment.confidence,
            executionTime: Date.now() - start,
          },
          observations: assessment.observations,
          recommendations: assessment.recommendations,
          riskAssessment: {
            level: assessment.riskLevel,
            factors: assessment.riskFactors,
          },
        };
      },
    };
  }
}

const RISK_LEVELS = ["low", "medium", "high", "critical"] as const;

/** Parse and validate the model's JSON sandbox assessment. */
function parseSandboxAssessment(raw: string): {
  success: boolean;
  outcome: string;
  confidence: number;
  observations: string[];
  recommendations: string[];
  riskLevel: SimulationResult["riskAssessment"]["level"];
  riskFactors: string[];
} {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("Model did not return a JSON sandbox assessment");
  }
  const data = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;

  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.map(String) : [];

  if (typeof data.success !== "boolean" || typeof data.outcome !== "string") {
    throw new Error("Model sandbox assessment is missing success/outcome");
  }
  const confidence = Number(data.confidence);
  if (!Number.isFinite(confidence)) {
    throw new Error("Model sandbox assessment is missing confidence");
  }
  const riskLevel = RISK_LEVELS.find(level => level === data.riskLevel);
  if (!riskLevel) {
    throw new Error("Model sandbox assessment has an invalid riskLevel");
  }

  return {
    success: data.success,
    outcome: data.outcome,
    confidence: Math.max(0, Math.min(1, confidence)),
    observations: strings(data.observations),
    recommendations: strings(data.recommendations),
    riskLevel,
    riskFactors: strings(data.riskFactors),
  };
}

/**
 * Virtual Marduk Workflow: Coordinate parallel simulations
 */
export class VirtualMardukWorkflow {
  private sandboxWorkflow: SandboxWorkflow;
  private memoryWorkflow: MemoryWorkflow;

  constructor() {
    this.sandboxWorkflow = new SandboxWorkflow();
    this.memoryWorkflow = new MemoryWorkflow();
  }

  public async run(
    context: WorkflowContext & {
      hypothesis: string;
      agentId: string;
    }
  ): Promise<WorkflowResult<SimulationRecord>> {
    const agentNamespace = `VirtualMarduk-${context.agentId}`;
    const arenaNamespace = "Marduk-Sandbox";

    console.log(
      `Virtual Marduk Workflow: Agent: ${agentNamespace}, Arena: ${arenaNamespace}`
    );

    try {
      // Run the simulation using sandbox workflow
      const sandboxResult = await this.sandboxWorkflow.run({
        agentNamespace,
        arenaNamespace,
        taskQueue: "Marduk-Sandbox",
        hypothesis: context.hypothesis,
        virtualAgentId: context.agentId,
      });

      if (!sandboxResult.success || !sandboxResult.result) {
        throw new Error(`Sandbox simulation failed: ${sandboxResult.error}`);
      }

      // Create simulation record
      const simulationRecord: SimulationRecord = {
        id: `sim-${context.agentId}-${Date.now()}`,
        virtualAgentId: context.agentId,
        hypothesis: context.hypothesis,
        arenaId: arenaNamespace,
        startTime: new Date(),
        endTime: new Date(),
        results: sandboxResult.result,
      };

      // Record results in memory
      const memoryResult = await this.memoryWorkflow.run({
        agentNamespace,
        arenaNamespace: "Marduk-Memory",
        taskQueue: "Marduk-Memory",
        operation: "store",
        data: {
          id: `memory-${simulationRecord.id}`,
          agentId: agentNamespace,
          arenaId: "Marduk-Memory",
          memoryType: "simulation",
          content: `Simulation completed: ${context.hypothesis}`,
          metadata: {
            simulations: [simulationRecord],
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      if (!memoryResult.success) {
        console.warn(
          "Failed to store simulation in memory:",
          memoryResult.error
        );
      }

      return {
        success: true,
        result: simulationRecord,
        metadata: { workflow: "virtual-marduk", agentId: context.agentId },
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Virtual Marduk workflow failed",
        metadata: { workflow: "virtual-marduk", agentId: context.agentId },
      };
    }
  }
}

/**
 * Consensus Workflow: Aggregate simulation results and reach strategic decisions
 */
export class ConsensusWorkflow {
  constructor() {}

  public async run(
    context: WorkflowContext & {
      simulationResults: SimulationRecord[];
    }
  ): Promise<WorkflowResult<ConsensusState>> {
    console.log(
      `Consensus Workflow: Processing ${context.simulationResults.length} simulation results`
    );

    try {
      // Aggregate results from simulations. Only simulations the model has
      // actually assessed, with a model-reported confidence, can vote; an
      // unassessed simulation or a missing confidence is never given an
      // invented value.
      const votes: ConsensusVote[] = [];
      const unassessed: string[] = [];
      for (const simulation of context.simulationResults) {
        const results = simulation.results;
        const confidence = results?.metrics.confidence;
        if (
          !results ||
          typeof confidence !== "number" ||
          !Number.isFinite(confidence)
        ) {
          unassessed.push(simulation.virtualAgentId);
          continue;
        }
        votes.push({
          virtualAgentId: simulation.virtualAgentId,
          vote: results.success ? "approve" : "reject",
          confidence,
          reasoning: results.outcome,
          modifications: results.success ? [] : results.recommendations,
        });
      }
      if (unassessed.length > 0) {
        console.warn(
          `Consensus Workflow: excluding ${unassessed.length} simulation(s) without a model assessment/confidence: ${unassessed.join(", ")}`
        );
      }
      if (votes.length === 0) {
        throw new Error(
          "No simulation has a model-assessed result with a confidence value; consensus cannot be computed"
        );
      }

      const consensus = this.aggregateVotes(votes);

      const consensusState: ConsensusState = {
        sessionId: `consensus-${Date.now()}`,
        participatingAgents: votes.map(v => v.virtualAgentId),
        strategy: this.deriveStrategy(context.simulationResults),
        votes,
        status: consensus.converged ? "converged" : "diverged",
        finalDecision: consensus.converged
          ? {
              strategy: consensus.strategy,
              confidence: consensus.confidence,
              dissenting: consensus.dissenting,
            }
          : undefined,
        timestamp: new Date(),
      };

      return {
        success: true,
        result: consensusState,
        metadata: {
          workflow: "consensus",
          participantCount: votes.length,
          convergence: consensus.converged,
        },
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Consensus workflow failed",
        metadata: { workflow: "consensus" },
      };
    }
  }

  private aggregateVotes(votes: ConsensusVote[]): {
    converged: boolean;
    strategy: string;
    confidence: number;
    dissenting: string[];
  } {
    const approvals = votes.filter(v => v.vote === "approve");
    const rejections = votes.filter(v => v.vote === "reject");
    const modifications = votes.filter(v => v.vote === "modify");

    const totalVotes = votes.length;
    const approvalRate = approvals.length / totalVotes;
    const avgConfidence =
      votes.reduce((sum, v) => sum + v.confidence, 0) / totalVotes;

    // Consensus threshold: >60% approval with >0.7 average confidence
    const converged = approvalRate > 0.6 && avgConfidence > 0.7;

    let strategy = "No consensus reached";
    if (converged) {
      strategy = "Proceed with validated approach";
    } else if (modifications.length > rejections.length) {
      strategy = "Implement recommended modifications";
    } else {
      strategy = "Revise approach significantly";
    }

    return {
      converged,
      strategy,
      confidence: avgConfidence,
      dissenting: rejections.map(v => v.virtualAgentId),
    };
  }

  private deriveStrategy(simulations: SimulationRecord[]): string {
    const assessed = simulations.filter(s => s.results !== null);
    if (assessed.length === 0) {
      return "No assessed simulations";
    }
    const successfulSimulations = assessed.filter(s => s.results?.success);
    const successRate = successfulSimulations.length / assessed.length;

    if (successRate > 0.8) {
      return "High confidence strategy: Proceed with implementation";
    } else if (successRate > 0.5) {
      return "Moderate confidence strategy: Proceed with caution";
    } else {
      return "Low confidence strategy: Requires significant revision";
    }
  }
}

/**
 * Actual Marduk Workflow: Execute strategies based on Virtual Marduk consensus
 */
export class ActualMardukWorkflow {
  private memoryWorkflow: MemoryWorkflow;

  constructor() {
    this.memoryWorkflow = new MemoryWorkflow();
  }

  public async run(
    context: WorkflowContext & {
      strategy: string;
      consensusState: ConsensusState;
    }
  ): Promise<WorkflowResult<{ actionTaken: string; outcome: string }>> {
    console.log(
      `Actual Marduk Workflow: Executing strategy in ${context.arenaNamespace}`
    );

    try {
      // Validate consensus before execution
      if (context.consensusState.status !== "converged") {
        return {
          success: false,
          error: "Cannot execute without consensus",
          metadata: { consensusStatus: context.consensusState.status },
        };
      }

      // Execute the strategy
      const result = await this.takeRealWorldAction(context.strategy);

      // Record feedback in memory
      const memoryResult = await this.memoryWorkflow.run({
        agentNamespace: "ActualMarduk",
        arenaNamespace: "Marduk-Memory",
        taskQueue: "Marduk-Memory",
        operation: "store",
        data: {
          id: `execution-${Date.now()}`,
          agentId: "ActualMarduk",
          arenaId: "Marduk-Space",
          memoryType: "strategy",
          content: `Executed strategy: ${context.strategy}. Outcome: ${result.outcome}`,
          metadata: {
            consensus: [context.consensusState],
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      if (!memoryResult.success) {
        console.warn("Failed to store execution feedback:", memoryResult.error);
      }

      return {
        success: true,
        result,
        metadata: {
          workflow: "actual-marduk",
          consensusId: context.consensusState.sessionId,
        },
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Real-world execution failed",
        metadata: { workflow: "actual-marduk", strategy: context.strategy },
      };
    }
  }

  private async takeRealWorldAction(
    strategy: string
  ): Promise<{ actionTaken: string; outcome: string }> {
    // No real-world executor is wired up; never report a fabricated outcome
    throw new Error(
      `Real-world executor unavailable: strategy not executed ("${strategy}")`
    );
  }
}

/**
 * Workflow Orchestrator: Manages the complete workflow pipeline
 */
export class EchoSpaceWorkflowOrchestrator {
  private memoryWorkflow: MemoryWorkflow;
  private sandboxWorkflow: SandboxWorkflow;
  private virtualMardukWorkflow: VirtualMardukWorkflow;
  private consensusWorkflow: ConsensusWorkflow;
  private actualMardukWorkflow: ActualMardukWorkflow;

  constructor() {
    this.memoryWorkflow = new MemoryWorkflow();
    this.sandboxWorkflow = new SandboxWorkflow();
    this.virtualMardukWorkflow = new VirtualMardukWorkflow();
    this.consensusWorkflow = new ConsensusWorkflow();
    this.actualMardukWorkflow = new ActualMardukWorkflow();
  }

  /**
   * Execute the complete Marduk pipeline: Virtual Simulations -> Consensus -> Real Action
   */
  public async executeMardukPipeline(hypotheses: string[]): Promise<
    WorkflowResult<{
      simulations: SimulationRecord[];
      consensus: ConsensusState;
      execution: { actionTaken: string; outcome: string };
    }>
  > {
    try {
      console.log(
        `🚀 Starting Marduk Pipeline with ${hypotheses.length} hypotheses`
      );

      // Step 1: Spawn Virtual Marduks and run parallel simulations
      const simulationPromises = hypotheses.map(async (hypothesis, index) => {
        return await this.virtualMardukWorkflow.run({
          agentNamespace: `VirtualMarduk-${index}`,
          arenaNamespace: "Marduk-Sandbox",
          taskQueue: "Marduk-Sandbox",
          hypothesis,
          agentId: `${index}`,
        });
      });

      const simulationResults = await Promise.all(simulationPromises);
      const successful = simulationResults.filter(r => r.success && r.result);

      if (successful.length === 0) {
        throw new Error("All simulations failed");
      }

      const simulations = successful.map(r => r.result!);
      console.log(`✅ Completed ${simulations.length} simulations`);

      // Step 2: Run consensus workflow
      const consensusResult = await this.consensusWorkflow.run({
        agentNamespace: "VirtualMardukCollective",
        arenaNamespace: "Marduk-Memory",
        taskQueue: "Marduk-Consensus",
        simulationResults: simulations,
      });

      if (!consensusResult.success || !consensusResult.result) {
        throw new Error(`Consensus failed: ${consensusResult.error}`);
      }

      const consensus = consensusResult.result;
      console.log(`✅ Consensus reached: ${consensus.status}`);

      // Step 3: Execute with Actual Marduk (only if consensus reached)
      if (consensus.status === "converged" && consensus.finalDecision) {
        const executionResult = await this.actualMardukWorkflow.run({
          agentNamespace: "ActualMarduk",
          arenaNamespace: "Marduk-Space",
          taskQueue: "Marduk-Space",
          strategy: consensus.finalDecision.strategy,
          consensusState: consensus,
        });

        if (!executionResult.success || !executionResult.result) {
          return {
            success: false,
            error: `Execution failed: ${executionResult.error}`,
            metadata: {
              simulations,
              consensus,
              consensusStatus: consensus.status,
            },
          };
        }

        const execution = executionResult.result;
        console.log(`✅ Strategy executed: ${execution.actionTaken}`);

        return {
          success: true,
          result: { simulations, consensus, execution },
          metadata: {
            pipeline: "complete",
            hypothesesCount: hypotheses.length,
          },
        };
      } else {
        return {
          success: false,
          error: "No consensus reached, cannot execute",
          metadata: {
            simulations,
            consensus,
            consensusStatus: consensus.status,
          },
        };
      }
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Pipeline execution failed",
        metadata: { pipeline: "failed", hypothesesCount: hypotheses.length },
      };
    }
  }
}
