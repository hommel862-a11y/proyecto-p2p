import type {
  ArmWorkspaceId,
  PipelineDeal,
  CrmContact,
  CrmBankAccount,
  BankLiveTelemetry,
  ActivityLogEntry,
  OmnichannelConversation,
  CrmBillingDocument,
  ArmApprovalQueueItem,
  ArmAutonomousFeedEvent,
  ArmShadowExample,
  ArmPipelineStageConfig,
  ArmAgentDefinition,
  ArmCloserPreCallBriefing,
  ArmReplayComparisonResult,
  ArmSandboxPersonaId,
  AiOperatingMode,
  AiTriageResult,
  CopyableBankBubbles,
  CrmDocumentType,
  FiatCurrency,
  BillingLineItem,
  GeminiOcrParsedResult,
  MessagingChannel,
  WorkspaceScope,
} from '@p2p/core';

export type CrmPrimaryNavId =
  | 'OVERVIEW'
  | 'PIPELINE'
  | 'INBOX_STUDIO'
  | 'CONTACTS_RAILS'
  | 'AUDIT_SYSTEM';

export type CrmModuleView =
  | 'DASHBOARD'
  | 'KANBAN'
  | 'CONTACTS'
  | 'BANKS'
  | 'ACTIVITIES'
  | 'OMNICHANNEL'
  | 'ARM_COMMAND'
  | 'SETTINGS';

export type CrmOverviewPeriod = 'TODAY' | '7D' | '30D' | 'ALL';

export interface CrmHeroKpiCard {
  id: string;
  label: string;
  value: string;
  deltaLabel: string;
  tone: 'cyan' | 'emerald' | 'amber' | 'violet';
  subtext: string;
  targetNav?: CrmPrimaryNavId;
}

export interface CrmCashflowColumn {
  id: string;
  label: string;
  valueFormatted: string;
  sublabel: string;
  highlighted?: boolean;
}

export interface CrmVelocityBarItem {
  id: string;
  label: string;
  formattedValue: string;
  ratioPct: number;
  tone: 'cyan' | 'emerald' | 'amber' | 'danger';
}

export interface CrmHealthRecommendation {
  id: string;
  label: string;
  impactBadge: string;
  tone: 'emerald' | 'blue' | 'amber';
  actionId: string;
}

export interface CrmDealsStatusRow {
  id: string;
  counterparty: string;
  lastContactLabel: string;
  ownerLabel: string;
  ownerInitials: string;
  statusLabel: string;
  statusTone: 'won' | 'transit' | 'stuck' | 'quoted';
  dealValueFormatted: string;
  rawDeal?: PipelineDeal;
}

export interface ArmKanbanCardVm {
  id: string;
  workspaceId: ArmWorkspaceId;
  leadName: string;
  companyName: string;
  stageSlug: string;
  qualificationScore: number;
  painPointSummary: string;
  lastMessagePreview: string;
  assignedAgentRole: string;
  movedByAgentBadge: string;
  dealValueLabel: string;
  estimatedValueNum?: number;
  freeWindowLabel: string;
  messages: { sender: 'LEAD' | 'AGENT'; text: string; mediaBadge?: string }[];
  toolTraces: { toolName: string; latencyMs: number; status: string }[];
}

export interface CrmSiloExecutiveKpi {
  label: string;
  value: string;
  sub: string;
}

export interface CrmStorageHealthTelemetry {
  postgresStatus: 'CONNECTED' | 'LOCAL_FALLBACK' | 'DISCONNECTED';
  postgresDetail: string;
  sqliteStatus: 'SYNCED' | 'BROWSER_ONLY';
  sqliteDetail: string;
  gatewayStatus: 'CONNECTED' | 'CONNECTING' | 'DISCONNECTED';
  gatewayDetail: string;
  dailyBudgetUsedUsd: number;
  dailyBudgetCapUsd: number;
}

export interface CrmUiQuickCreateOption {
  id: 'NEW_DEAL' | 'NEW_CONTACT' | 'NEW_BANK' | 'NEW_CHAT';
  label: string;
  hint: string;
}

export type CrmHeaderSilo = ArmWorkspaceId;

export type {
  ArmWorkspaceId,
  PipelineDeal,
  CrmContact,
  CrmBankAccount,
  BankLiveTelemetry,
  ActivityLogEntry,
  OmnichannelConversation,
  CrmBillingDocument,
  ArmApprovalQueueItem,
  ArmAutonomousFeedEvent,
  ArmShadowExample,
  ArmPipelineStageConfig,
  ArmAgentDefinition,
  ArmCloserPreCallBriefing,
  ArmReplayComparisonResult,
  ArmSandboxPersonaId,
  AiOperatingMode,
  AiTriageResult,
  CopyableBankBubbles,
  CrmDocumentType,
  FiatCurrency,
  BillingLineItem,
  GeminiOcrParsedResult,
  MessagingChannel,
  WorkspaceScope,
};
