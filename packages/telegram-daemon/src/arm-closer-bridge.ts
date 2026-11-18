import {
  processCloserPostCallNote,
  generateCloserPreCallBriefing,
  getWorkspaceCatalog,
  escapeMarkdownV2,
  type ArmWorkspaceId,
  type ArmBantData,
  type ArmCloserPreCallBriefing,
} from '@p2p/core';

export interface CloserCommandExecutionResult {
  handled: boolean;
  workspaceId?: ArmWorkspaceId;
  detectedSplitPayment?: boolean;
  gatewaySynced?: boolean;
  replyMarkdown?: string;
}

const VALID_WORKSPACES: ReadonlySet<string> = new Set(['ARM_B2B', 'P2P_DESK', 'FINANCE_360']);

export async function handleTelegramCloserCommand(params: {
  rawText: string;
  gatewayUrl: string;
  fetchImpl?: typeof fetch;
}): Promise<CloserCommandExecutionResult> {
  const trimmed = (params.rawText || '').trim();
  if (!trimmed.toLowerCase().startsWith('/closer')) {
    return { handled: false };
  }

  let body = trimmed.replace(/^\/closer\s*/i, '').trim();
  let workspaceId: ArmWorkspaceId = 'ARM_B2B';
  const tokens = body.split(/\s+/);
  if (tokens.length > 0 && VALID_WORKSPACES.has(tokens[0].toUpperCase())) {
    workspaceId = tokens[0].toUpperCase() as ArmWorkspaceId;
    body = tokens.slice(1).join(' ').trim();
  }

  if (!body) {
    return {
      handled: true,
      workspaceId,
      replyMarkdown:
        'Uso: `/closer [ARM_B2B|P2P_DESK|FINANCE_360] Carlos — Clínica Aurora | Le gustó pero quiere pagar 50/50`',
    };
  }

  const pipeParts = body.split('|');
  const leadName = pipeParts.length > 1 ? pipeParts[0].trim() : 'Prospecto Telegram';
  const transcript = pipeParts.length > 1 ? pipeParts.slice(1).join('|').trim() : body;
  const defaultSku = getWorkspaceCatalog(workspaceId)[0]?.sku || 'PLAN-ENTERPRISE';

  const processed = processCloserPostCallNote({
    workspaceId,
    leadId: `tg-closer-${Date.now()}`,
    leadName,
    voiceNoteTranscript: transcript,
    sku: defaultSku,
  });

  let gatewaySynced = false;
  const doFetch = params.fetchImpl ?? fetch;
  try {
    const cleanGateway = params.gatewayUrl.trim().replace(/\/+$/, '');
    const res = await doFetch(`${cleanGateway}/api/arm/closer/post-call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId,
        leadName,
        voiceNoteTranscript: transcript,
        sku: defaultSku,
      }),
      signal: AbortSignal.timeout(4000),
    });
    gatewaySynced = res.ok;
  } catch {
    gatewaySynced = false;
  }

  const replyMarkdown =
    `🎙️ *CLOSER COPILOT PROCESSOR* \\(${escapeMarkdownV2(workspaceId)}\\)\n\n` +
    `• *Prospecto:* ${escapeMarkdownV2(leadName)}\n` +
    `• *Resumen:* ${escapeMarkdownV2(processed.executiveNotes)}\n` +
    `• *Etapa Kanban:* \`${escapeMarkdownV2(processed.recommendedStageSlug)}\`\n` +
    `• *Estado:* Encolado en *Approval Queue* \\(${gatewaySynced ? 'SSE Gateway Sincronizado' : 'Modo Local'}\\)\n\n` +
    `_Confirmá el envío en 1 clic con \\[A\\] Aprobar desde tu Command Center Apple Pro\\._`;

  return {
    handled: true,
    workspaceId,
    detectedSplitPayment: processed.detectedSplitPayment,
    gatewaySynced,
    replyMarkdown,
  };
}

export function buildTelegramPreCallBriefingCard(params: {
  workspaceId: ArmWorkspaceId;
  leadName: string;
  companyName: string;
  startsInMinutes?: number;
  qualificationScore: number;
  bantData: ArmBantData;
  memoryFacts: string[];
  estimatedDealValue: number;
}): ArmCloserPreCallBriefing {
  return generateCloserPreCallBriefing(params);
}
