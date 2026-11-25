import type {
  CopilotChatMessage,
  CopilotContextScope,
  CopilotResponse,
  CopilotStreamEvent,
  CopilotThreadDto,
  CopilotThreadMessageDto,
  CopilotUsage,
  CopilotUsageSummaryDto,
  EngramReviewResult,
  StrategyPlanCard,
  ToolCallTrace,
} from '../../../../../electron/shared/types';

export type CopilotViewMode = 'workbench' | 'dashboard';

export interface AlphaWatcherStatusDto {
  enabled: boolean;
  pollIntervalSeconds: number;
  minNetSpreadPct: number;
  scanCount: number;
  lastOpportunity: { time: number; netSpreadPct: number; route: string } | null;
}

export interface EngramObservationDto {
  id?: number;
  topicKey: string;
  type: 'discovery' | 'decision' | 'architecture' | 'pattern' | 'bugfix' | 'preference';
  scope?: string;
  what: string;
  why: string;
  whereAffected: string;
  learned: string;
  confidenceScore: number;
  status: 'active' | 'needs_review';
  createdAt?: number;
  updatedAt?: number;
}

export interface AgentHealthStatusDto {
  role: string;
  name: string;
  status: 'ONLINE' | 'STANDBY' | 'BUSY' | 'DEGRADED';
  lastActiveTime: number;
  opsProcessed: number;
  description: string;
}

export interface MarketLearningRecord {
  id?: number;
  topicKey: string;
  category: string;
  insight: string;
  confidenceScore?: number;
  sampleCount?: number;
  dataPayload?: unknown;
  createdAt?: number;
  updatedAt?: number;
}

export interface ChatMessageView extends CopilotChatMessage {
  id?: string;
  toolTraces?: ToolCallTrace[];
  usage?: CopilotUsage;
  requestId?: string;
  cancelled?: boolean;
}

export interface CopilotSlashCommand {
  command: string;
  label: string;
  description: string;
  template: string;
}

export interface RadarAlertItem {
  id: string;
  kind: 'ALPHA' | 'MACRO';
  title: string;
  message: string;
  timestamp: number;
  plan?: StrategyPlanCard;
}

export interface ElectronCopilotBridge {
  sendMessage(params: {
    prompt: string;
    history?: CopilotChatMessage[];
    threadId?: string;
    agentId?: string;
    contextScope?: CopilotContextScope;
    requestId?: string;
    apiKey?: string;
    provider?: string;
    model?: string;
  }): Promise<CopilotResponse>;
  transcribeAudio?(params: {
    audioBase64: string;
    mimeType: string;
  }): Promise<{ text: string; error?: string }>;
  executePlan(params: {
    planId: string;
  }): Promise<{ success: boolean; error?: string; riskWarnings?: string[] }>;
  getPlans(params?: { limit?: number }): Promise<StrategyPlanCard[]>;
  getLearnings(params?: { category?: string; limit?: number }): Promise<MarketLearningRecord[]>;
  getEngramObservations?(params?: {
    filter?: { topicKey?: string; type?: string; status?: string };
    limit?: number;
  }): Promise<EngramObservationDto[]>;
  setApiKey(params: { apiKey: string }): Promise<boolean>;
  setProviderConfig?(params: { provider: string; model?: string; apiKey?: string }): Promise<boolean>;
  getProviderConfig?(): Promise<{
    activeProvider: string;
    activeModel: string;
    configuredProviders: Record<string, boolean>;
  }>;
  testConnection(): Promise<{ success: boolean; model: string; message: string }>;
  getWatcherStatus(): Promise<AlphaWatcherStatusDto>;
  setWatcherConfig(
    params: Partial<{ enabled: boolean; minNetSpreadPct: number; pollIntervalSeconds: number }>,
  ): Promise<boolean>;
  runSwarmAnalysis?(): Promise<{
    riskVerdict: {
      status: string;
      riskScore: number;
      recommendedAction: string;
      vetoReason?: string;
    };
    sentinelSignal: { netSpreadPct: number };
    strategistProposal?: { rationale: string };
    suggestedPlan?: StrategyPlanCard;
    executionSummary: string;
  }>;
  getSwarmHealth?(): Promise<AgentHealthStatusDto[]>;
  listAgents?(): Promise<
    {
      id: string;
      name: string;
      role: string;
      avatar?: string;
      description: string;
      enabled: boolean;
      tools?: string[];
      skills?: string[];
    }[]
  >;
  toggleAgent?(params: { id: string; enabled: boolean }): Promise<boolean>;
  cancelTurn?(params: { requestId?: string }): Promise<{ cancelled: boolean }>;
  listThreads?(params?: { limit?: number }): Promise<CopilotThreadDto[]>;
  createThread?(params?: { title?: string; agentId?: string }): Promise<CopilotThreadDto>;
  getThreadMessages?(params: {
    threadId: string;
    limit?: number;
  }): Promise<CopilotThreadMessageDto[]>;
  deleteThread?(params: { threadId: string }): Promise<boolean>;
  rejectPlan?(params: { planId: string; reason?: string }): Promise<{ success: boolean }>;
  reviewEngramObservation?(params: {
    id: number;
    action: 'approve' | 'discard';
  }): Promise<EngramReviewResult>;
  getUsageSummary?(params?: { windowHours?: number }): Promise<CopilotUsageSummaryDto>;
  onAlphaOpportunity?(
    callback: (data: { plan: StrategyPlanCard; detectedAt: number }) => void,
  ): () => void;
  onProactiveAlert?(callback: (payload: unknown) => void): () => void;
  onStreamEvent?(callback: (event: CopilotStreamEvent) => void): () => void;
}
