export const AG360_SUB_TAB = {
  OVERVIEW: 'overview',
  BRIEF_STUDIO: 'brief-studio',
  VIDEO_PIPELINE: 'video-pipeline',
  VIRAL_CLIPS: 'viral-clips',
  FLYER_STUDIO: 'flyer-studio',
  TRAFFICKER_HITL: 'trafficker-hitl',
} as const;

export type Ag360SubTab = (typeof AG360_SUB_TAB)[keyof typeof AG360_SUB_TAB];

export const AG360_VERTICAL = {
  CASHEA_ALLY: 'CASHEA_ALLY',
  RETAIL_COMMERCE: 'RETAIL_COMMERCE',
  FINTECH_P2P: 'FINTECH_P2P',
  B2B_SERVICES: 'B2B_SERVICES',
} as const;

export type Ag360Vertical = (typeof AG360_VERTICAL)[keyof typeof AG360_VERTICAL];

export const AG360_CLIP_SOURCE = {
  PC_LOCAL_INBOX: 'PC_LOCAL_INBOX',
  YOUTUBE_SURGICAL: 'YOUTUBE_SURGICAL',
} as const;

export type Ag360ClipSource = (typeof AG360_CLIP_SOURCE)[keyof typeof AG360_CLIP_SOURCE];

export interface Ag360SubTabDescriptor {
  id: Ag360SubTab;
  code: string;
  label: string;
  badge: string;
}

export interface Ag360BrandVault {
  id: string;
  slug: string;
  displayName: string;
  vertical: Ag360Vertical;
  metaAdAccountId: string;
  metaPixelId: string;
  tiktokAdvertiserId: string;
  youtubeChannelId: string;
  vaultBalanceUsd: number;
  spendCapUsd: number;
  accumulatedSpendUsd: number;
  reservedSpendUsd: number;
  attributedRevenueUsd: number;
  closedWonCount: number;
  alertThresholdPct: number;
}

export interface Ag360HookVariant {
  variant: 'HOOK_A' | 'HOOK_B' | 'HOOK_C';
  title: string;
  script3s: string;
  brollSource: string;
  retentionScore: number;
}

export interface Ag360ViralClipJob {
  id: string;
  title: string;
  sourceMode: Ag360ClipSource;
  sourceLocator: string;
  sectionRange: string;
  viralityScore: number;
  faceConfidencePct: number;
  aspectRatio: '9:16';
  status: 'CURATED' | 'QUEUED_C1' | 'COMPLETED';
}

export interface Ag360FlyerAsset {
  id: string;
  brandId: string;
  aspectRatio: '9:16' | '4:5';
  headline: string;
  priceBadge: string;
  ctaText: string;
  textDensityPct: number;
  complianceStatus: 'APPROVED' | 'REWRITTEN_APPROVED';
  publicHttpsUrl: string;
}

export interface Ag360HitlProposal {
  approvalId: string;
  campaignId: string;
  brandId: string;
  platform: 'META_ADS' | 'TIKTOK_ADS' | 'YOUTUBE_ADS';
  campaignName: string;
  hookVariant: 'HOOK_A' | 'HOOK_B' | 'HOOK_C';
  dailyBudgetUsd: number;
  originalCopy: string;
  approvedCopy: string;
  complianceStatus: 'APPROVED' | 'REWRITTEN_APPROVED';
  riskScorePct: number;
  hitlStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  campaignStatus: 'DRAFT_PENDING_HITL' | 'ACTIVE' | 'PAUSED_BY_OPERATOR';
}

export interface Ag360CommandItem {
  id: string;
  label: string;
  category: string;
  shortcut: string;
  tabTarget?: Ag360SubTab;
}
