import { describe, it, expect } from 'vitest';
import {
  ARM_WORKSPACES,
  ARM_UNIFIED_TOOL_CONTRACTS,
  getWorkspaceStages,
  getWorkspaceAgents,
  getWorkspaceCatalog,
  calculateDeterministicBantScore,
  mergeBantAndLeadProfile,
  evaluateDeterministicPreRouter,
  validateArmStageTransition,
  evaluateAndBuildArmQuote,
  scanOutboundMessageDlp,
  evaluateGhostingFollowUp,
  processCloserPostCallNote,
  recordShadowLearningCorrection,
  selectFewShotExamplesForAgent,
  runArmSandboxSimulationTurn,
  type ArmLeadProfile,
  type ArmShadowExample,
} from './arm-orchestration-engine';

describe('ARM Multi-Workspace Orchestration Engine (@p2p/core)', () => {
  it('enforces strict isolation across ARM_B2B, P2P_DESK, and FINANCE_360 workspaces (S4)', () => {
    expect(Object.keys(ARM_WORKSPACES)).toEqual(['ARM_B2B', 'P2P_DESK', 'FINANCE_360']);

    const b2bStages = getWorkspaceStages('ARM_B2B').map((s) => s.slug);
    const p2pStages = getWorkspaceStages('P2P_DESK').map((s) => s.slug);
    const f360Stages = getWorkspaceStages('FINANCE_360').map((s) => s.slug);

    expect(b2bStages).toEqual([
      'nuevo',
      'en-descubrimiento',
      'calificado',
      'no-calificado',
      'cotizacion-enviada',
      'sesion-agendada',
    ]);
    expect(p2pStages).toContain('STAGE_1_NEW');
    expect(p2pStages).not.toContain('sesion-agendada');
    expect(f360Stages).toContain('presupuestado-360');
    expect(f360Stages).not.toContain('STAGE_1_NEW');

    const b2bAgents = getWorkspaceAgents('ARM_B2B').map((a) => a.role);
    expect(b2bAgents).toEqual(['ROUTER', 'SDR_QUALIFIER', 'QUOTER', 'SCHEDULER', 'FOLLOW_UP']);

    // Cross-silo stage transition must be rejected
    const crossCheck = validateArmStageTransition({
      workspaceId: 'P2P_DESK',
      fromStageSlug: 'STAGE_1_NEW',
      toStageSlug: 'sesion-agendada',
      triggeredByType: 'AGENT',
      reasoning: 'Intento cruzado inválido',
    });
    expect(crossCheck.allowed).toBe(false);
    expect(crossCheck.rejectionCode).toBe('STAGE_NOT_IN_WORKSPACE');
  });

  it('computes deterministic BANT score (+30/+20/+25/+25) and merges profile without null-clobbering (S1, S2)', () => {
    const initial: ArmLeadProfile = {
      id: 'lead-1',
      workspaceId: 'ARM_B2B',
      fullName: 'Dra. Elena Gómez',
      companyName: 'Clínica Aurora',
      phoneWhatsapp: '+584141234567',
      email: 'elena@clinicaaurora.com',
      currentStageSlug: 'nuevo',
      qualificationScore: 30,
      isQualified: false,
      substantiveTurnsCount: 1,
      bantData: {
        budget: null,
        authority: 'Directora Médica (Decisora)',
        need_pain_point: 'HubSpot actual es muy costoso y manual',
        timeline: null,
      },
      aiExecutiveSummary: 'Clínica con dolor en CRM actual',
      estimatedDealValue: 0,
      currency: 'USD',
    };

    // Second turn sends null for fullName/email/authority, but adds budget & timeline
    const updated = mergeBantAndLeadProfile(
      initial,
      {
        full_name: null,
        company_name: null,
        email: null,
        bant_patch: {
          budget: '$2,400 USD anuales aprobados',
          authority: null,
          need_pain_point: null,
          timeline: 'Inmediato (este mismo mes)',
        },
        ai_executive_summary: 'Clínica Aurora lista para propuesta anual Pro',
        estimated_deal_value: 2400,
      },
      'Tenemos $2,400 USD aprobados para migrar este mismo mes',
    );

    // Must preserve existing non-null fields
    expect(updated.fullName).toBe('Dra. Elena Gómez');
    expect(updated.email).toBe('elena@clinicaaurora.com');
    expect(updated.bantData.authority).toBe('Directora Médica (Decisora)');
    expect(updated.bantData.need_pain_point).toBe('HubSpot actual es muy costoso y manual');
    expect(updated.bantData.budget).toBe('$2,400 USD anuales aprobados');
    expect(updated.bantData.timeline).toBe('Inmediato (este mismo mes)');

    // 30 (Need) + 20 (Authority) + 25 (Timeline) + 25 (Budget) = 100
    expect(updated.qualificationScore).toBe(100);
    expect(updated.isQualified).toBe(true);
    expect(updated.recommendedStageSlug).toBe('calificado');

    // Low score after 4 substantive turns recommends no-calificado
    const lowScore = calculateDeterministicBantScore(
      { budget: null, authority: null, need_pain_point: null, timeline: null },
      4,
    );
    expect(lowScore.score).toBe(0);
    expect(lowScore.recommendedStageSlug).toBe('no-calificado');
  });

  it('pre-routes deterministically and respects HUMAN_TAKEOVER / WAITING_APPROVAL locks (S1)', () => {
    const locked = evaluateDeterministicPreRouter({
      workspaceId: 'ARM_B2B',
      conversationStatus: 'HUMAN_TAKEOVER',
      currentStageSlug: 'en-descubrimiento',
      bantData: { budget: null, authority: null, need_pain_point: null, timeline: null },
      messageText: 'Quiero hablar ya',
    });
    expect(locked.shouldInvokeLlm).toBe(false);
    expect(locked.targetRole).toBe('HUMAN_TAKEOVER');

    const angry = evaluateDeterministicPreRouter({
      workspaceId: 'ARM_B2B',
      conversationStatus: 'AUTOPILOT',
      currentStageSlug: 'en-descubrimiento',
      bantData: { budget: null, authority: null, need_pain_point: 'Dolor', timeline: null },
      messageText: 'Estoy harto, pásame con un humano o supervisor ahora mismo',
    });
    expect(angry.targetRole).toBe('HUMAN_TAKEOVER');
    expect(angry.sentiment).toBe('FRUSTRATED');

    const scheduleReq = evaluateDeterministicPreRouter({
      workspaceId: 'ARM_B2B',
      conversationStatus: 'AUTOPILOT',
      currentStageSlug: 'calificado',
      bantData: { budget: '$2k', authority: 'CEO', need_pain_point: 'Dolor', timeline: 'Hoy' },
      messageText: 'Genial, agendemos una llamada o demo para mañana a las 10am',
    });
    expect(scheduleReq.targetRole).toBe('SCHEDULER');
  });

  it('enforces Risk Gate in evaluateAndBuildArmQuote using official catalog prices and thresholds (S1, S3)', () => {
    const catalog = getWorkspaceCatalog('ARM_B2B');
    expect(catalog.length).toBeGreaterThan(0);

    // 1. Standard quote: 0% discount and <= $1,500 -> auto-approved
    const autoQuote = evaluateAndBuildArmQuote({
      workspaceId: 'ARM_B2B',
      leadId: 'lead-1',
      items: [{ sku: 'PLAN-PRO', qty: 1 }], // Official unit_price = 1200
      discountPct: 0,
      validDays: 7,
    });
    expect(autoQuote.subtotal).toBe(1200);
    expect(autoQuote.totalAmount).toBe(1200);
    expect(autoQuote.requiresHumanApproval).toBe(false);
    expect(autoQuote.status).toBe('SENT');

    // 2. Discount > 0% OR total > $1,500 -> forced to PENDING_APPROVAL in approval_queue
    const gatedQuote = evaluateAndBuildArmQuote({
      workspaceId: 'ARM_B2B',
      leadId: 'lead-1',
      items: [{ sku: 'PLAN-ENTERPRISE', qty: 1 }], // Official unit_price = 2400
      discountPct: 15,
      validDays: 7,
      proposedWhatsappMessage: 'Te paso el 15% de descuento en el plan Enterprise.',
    });
    expect(gatedQuote.subtotal).toBe(2400);
    expect(gatedQuote.totalAmount).toBe(2040);
    expect(gatedQuote.requiresHumanApproval).toBe(true);
    expect(gatedQuote.status).toBe('PENDING_APPROVAL');
    expect(gatedQuote.approvalEntry).toBeDefined();
    expect(gatedQuote.approvalEntry?.actionType).toBe('APPLY_DISCOUNT');
  });

  it('blocks P2P settlement stage transition without human approval or bank reconciliation (S2, S5)', () => {
    const blockedP2p = validateArmStageTransition({
      workspaceId: 'P2P_DESK',
      fromStageSlug: 'STAGE_3_VERIFY',
      toStageSlug: 'STAGE_4_CLOSED',
      triggeredByType: 'AGENT',
      reasoning: 'OCR leyó referencia Banesco 8849201',
      hasHumanSettlementApproval: false,
    });
    expect(blockedP2p.allowed).toBe(false);
    expect(blockedP2p.rejectionCode).toBe('P2P_SETTLEMENT_REQUIRES_HUMAN_APPROVAL');

    const allowedP2p = validateArmStageTransition({
      workspaceId: 'P2P_DESK',
      fromStageSlug: 'STAGE_3_VERIFY',
      toStageSlug: 'STAGE_4_CLOSED',
      triggeredByType: 'HUMAN',
      reasoning: 'Saldo confirmado en cuenta Banesco',
      hasHumanSettlementApproval: true,
    });
    expect(allowedP2p.allowed).toBe(true);
  });

  it('prevents cross-silo leaks and internal prompt leaks in scanOutboundMessageDlp (S4, S6)', () => {
    const leakScore = scanOutboundMessageDlp({
      workspaceId: 'ARM_B2B',
      outboundText: 'Tu qualification_score actual es 88 y mi límite interno es $1500.',
    });
    expect(leakScore.safe).toBe(false);
    expect(leakScore.violations).toContain('INTERNAL_METRIC_LEAK');

    const crossSiloP2pLeak = scanOutboundMessageDlp({
      workspaceId: 'ARM_B2B',
      outboundText: 'Transfiere por Pago Móvil Banesco 0134-0946 a la cédula V-12345678 para liberar USDT.',
    });
    expect(crossSiloP2pLeak.safe).toBe(false);
    expect(crossSiloP2pLeak.violations).toContain('CROSS_SILO_P2P_RAIL_IN_B2B');
  });

  it('handles anti-ghosting HSM follow-up, closer post-call voice notes, shadow learning, and sandbox (S5)', () => {
    const nowMs = 1_760_000_000_000;
    const ghostEval = evaluateGhostingFollowUp({
      workspaceId: 'ARM_B2B',
      leadId: 'lead-1',
      leadName: 'Dra. Gómez',
      lastInboundTimestampMs: nowMs - 72 * 3600 * 1000, // 72h ago -> Meta 24h window closed
      nowTimestampMs: nowMs,
      followupAttempts: 1,
      painPointMemory: 'reducir costos de HubSpot en 18 médicos',
    });
    expect(ghostEval.shouldQueueFollowUp).toBe(true);
    expect(ghostEval.requiresHsmTemplate).toBe(true);
    expect(ghostEval.approvalEntry?.actionType).toBe('SEND_FOLLOWUP');

    const postCall = processCloserPostCallNote({
      workspaceId: 'ARM_B2B',
      leadId: 'lead-1',
      leadName: 'Carlos (Clínica Aurora)',
      voiceNoteTranscript: 'Hablé con Carlos, le gustó el Plan Enterprise pero quiere pagar en 2 partes 50/50',
      sku: 'PLAN-ENTERPRISE',
    });
    expect(postCall.detectedSplitPayment).toBe(true);
    expect(postCall.approvalEntry.actionType).toBe('SEND_QUOTE');
    expect(postCall.approvalEntry.proposedPayload['paymentTerms']).toBe('50% anticipo / 50% a 30 días');

    const store: ArmShadowExample[] = [];
    const saved = recordShadowLearningCorrection(store, {
      workspaceId: 'ARM_B2B',
      agentRole: 'QUOTER',
      actionType: 'APPLY_DISCOUNT',
      proposedText: 'Le damos 15% de descuento.',
      approvedText: 'Por tratarse de pago anual corporativo, dirección autorizó una bonificación del 15%.',
      saveAsExample: true,
    });
    expect(saved.length).toBe(1);
    expect(selectFewShotExamplesForAgent(saved, 'ARM_B2B', 'QUOTER').length).toBe(1);
    expect(selectFewShotExamplesForAgent(saved, 'P2P_DESK', 'QUOTER').length).toBe(0);

    const sandboxTurn = runArmSandboxSimulationTurn({
      workspaceId: 'ARM_B2B',
      personaId: 'SKEPTICAL_DISCOUNT_30',
    });
    expect(sandboxTurn.isSandbox).toBe(true);
    expect(sandboxTurn.metaApiCostUsd).toBe(0);
    expect(sandboxTurn.toolTrace.length).toBeGreaterThanOrEqual(3);
    expect(sandboxTurn.queuedApproval).toBeDefined();

    expect(ARM_UNIFIED_TOOL_CONTRACTS.length).toBe(10);
  });
});
