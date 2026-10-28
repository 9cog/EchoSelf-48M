/**
 * Adaptive Feedback Service
 *
 * Tracks project models and community feedback in the hypergraph, computes
 * salience and adaptive attention thresholds, and builds a prioritized
 * upgrade wishlist. No Copilot executor is configured, so upgrade requests
 * are recorded as "not executed" - no upgrade content is ever fabricated.
 */
import { HypergraphSchemeCore } from "./hypergraphSchemeCore";

export interface CommunityFeedback {
  id: string;
  modelId: string;
  userId: string;
  type: "performance" | "improvement" | "feature_request" | "bug";
  priority: "low" | "medium" | "high" | "urgent";
  description: string;
  votes: number;
  timestamp: Date;
}

export interface ProjectModel {
  id: string;
  name: string;
  description: string;
  version: string;
  lastModified: Date;
  usageCount: number;
  communityFeedback: CommunityFeedback[];
  salienceScore: number;
}

export interface CopilotRequest {
  modelId: string;
  priority: CommunityFeedback["priority"];
  salienceScore: number;
  feedbackSummary: string[];
}

export interface CopilotResponse {
  modelId: string;
  executed: false;
  error: string;
}

export interface AdaptiveThresholds {
  attentionThreshold: number;
  cognitiveLoad: number;
  recentActivity: number;
}

const PRIORITY_WEIGHT: Record<CommunityFeedback["priority"], number> = {
  low: 0.25,
  medium: 0.5,
  high: 0.75,
  urgent: 1,
};

export class AdaptiveFeedbackService {
  private static instance: AdaptiveFeedbackService;
  private hypergraph = new HypergraphSchemeCore();
  private models: Map<string, ProjectModel> = new Map();
  private feedback: CommunityFeedback[] = [];
  private thresholds: AdaptiveThresholds = {
    attentionThreshold: 0.5,
    cognitiveLoad: 0,
    recentActivity: 0,
  };
  private lastFeedbackCycle: Date = new Date(0);
  private lastCopilotResponses: CopilotResponse[] = [];
  private cycleTimer: ReturnType<typeof setInterval> | null = null;

  private constructor() {}

  public static getInstance(): AdaptiveFeedbackService {
    if (!AdaptiveFeedbackService.instance) {
      AdaptiveFeedbackService.instance = new AdaptiveFeedbackService();
    }
    return AdaptiveFeedbackService.instance;
  }

  public registerProjectModel(
    model: Omit<ProjectModel, "communityFeedback" | "salienceScore">
  ): void {
    const existing = this.models.get(model.id);
    this.models.set(model.id, {
      ...model,
      communityFeedback: existing?.communityFeedback || [],
      salienceScore: existing?.salienceScore || 0,
    });
    this.hypergraph.createNode(model.id, "model", { ...model }, []);
  }

  public addCommunityFeedback(
    feedback: Omit<CommunityFeedback, "id" | "timestamp">
  ): CommunityFeedback {
    const entry: CommunityFeedback = {
      ...feedback,
      id: `feedback_${Date.now()}_${this.feedback.length}`,
      timestamp: new Date(),
    };
    this.feedback.push(entry);
    this.models.get(feedback.modelId)?.communityFeedback.push(entry);
    return entry;
  }

  public getSystemStatus() {
    return {
      projectModelsCount: this.models.size,
      communityFeedbackCount: this.feedback.length,
      hypergraphNodesCount: this.hypergraph.getAllNodes().length,
      attentionFilteredNodes: this.hypergraph.getAttentionFilteredNodes(
        this.thresholds.attentionThreshold
      ).length,
      adaptiveThresholds: { ...this.thresholds },
      lastFeedbackCycle: this.lastFeedbackCycle,
      lastCopilotResponses: [...this.lastCopilotResponses],
    };
  }

  public setFeedbackCycleInterval(intervalMs: number): void {
    if (this.cycleTimer) clearInterval(this.cycleTimer);
    this.cycleTimer =
      intervalMs > 0
        ? setInterval(() => {
            void this.triggerFeedbackLoop();
          }, intervalMs)
        : null;
  }

  /**
   * Run one feedback cycle: update thresholds and salience from the recorded
   * data, then build the upgrade wishlist. Upgrade requests cannot be
   * executed (no Copilot executor), which is reported in the responses.
   */
  public async triggerFeedbackLoop(): Promise<void> {
    const hourAgo = Date.now() - 60 * 60 * 1000;
    const recentFeedback = this.feedback.filter(
      f => f.timestamp.getTime() > hourAgo
    );

    this.thresholds.recentActivity = Math.min(1, recentFeedback.length / 20);
    this.thresholds.cognitiveLoad = Math.min(1, this.models.size / 50);
    this.thresholds.attentionThreshold = Math.max(
      0,
      Math.min(
        1,
        this.hypergraph.adaptiveAttention(
          this.thresholds.cognitiveLoad,
          this.thresholds.recentActivity
        )
      )
    );
    this.hypergraph.updateAttentionThreshold(
      this.thresholds.attentionThreshold
    );

    const requests: CopilotRequest[] = [];
    this.models.forEach(model => {
      const metrics = this.hypergraph.calculateSalienceMetrics(
        model.id,
        model.communityFeedback
      );
      const urgency = model.communityFeedback.reduce(
        (max, f) => Math.max(max, PRIORITY_WEIGHT[f.priority]),
        0
      );
      model.salienceScore = Math.min(1, metrics.overall * 0.7 + urgency * 0.3);

      if (model.communityFeedback.length > 0) {
        const top = [...model.communityFeedback].sort(
          (a, b) =>
            PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority] ||
            b.votes - a.votes
        );
        requests.push({
          modelId: model.id,
          priority: top[0].priority,
          salienceScore: model.salienceScore,
          feedbackSummary: top.slice(0, 5).map(f => f.description),
        });
      }
    });

    requests.sort((a, b) => b.salienceScore - a.salienceScore);
    this.lastCopilotResponses = requests.map(request => ({
      modelId: request.modelId,
      executed: false,
      error: "Copilot upgrade executor unavailable: request not executed",
    }));
    if (requests.length > 0) {
      console.warn(
        `Adaptive feedback: ${requests.length} upgrade request(s) not executed (no Copilot executor configured)`
      );
    }

    this.lastFeedbackCycle = new Date();
  }
}

export default AdaptiveFeedbackService;
