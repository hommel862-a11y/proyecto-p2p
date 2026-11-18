import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { CrmPipelineComponent } from './crm-pipeline.component';
import type {
  ArmApprovalQueueItem,
  ArmAutonomousFeedEvent,
  ArmCloserPreCallBriefing,
  ArmKanbanCardVm,
  ArmPipelineStageConfig,
  ArmReplayComparisonResult,
  ArmSandboxPersonaId,
  PipelineDeal,
} from '../../crm-ui.models';

describe('CrmPipelineComponent', () => {
  let fixture: ComponentFixture<CrmPipelineComponent>;
  let component: CrmPipelineComponent;

  const sampleDeal1: PipelineDeal = {
    id: 'DL-1',
    scope: 'P2P_DESK',
    title: 'Compra USDT',
    contactId: 'CT-1',
    contactName: 'María López',
    bankAccountId: 'BK-1',
    bankName: 'Banesco',
    stage: 'STAGE_1_NEW',
    fiatCurrency: 'VES',
    cryptoAmountUsdt: 650,
    appliedRate: 85.2,
    replacementRate: 83.4,
    totalFiatAmount: 55380,
    paidFiatAmount: 0,
    netProfitUsdt: 14.1,
    bankReferenceId: 'REF9988',
    quoteTtlMinutes: 15,
    quotedAt: 1_700_000_000_000,
    isRateExpired: false,
    timeline: [],
    createdAt: 1_700_000_000_000,
    closedAt: null,
  };

  const sampleDeal2: PipelineDeal = {
    ...sampleDeal1,
    id: 'DL-2',
    stage: 'STAGE_4_CLOSED',
    closedAt: 1_700_000_500_000,
  };

  const sampleColumns = [
    { stage: 'STAGE_1_NEW', label: '1. Cotizado', deals: [sampleDeal1], totalVolumeUsdt: 650 },
    { stage: 'STAGE_2_TRANSIT', label: '2. En Tránsito', deals: [], totalVolumeUsdt: 0 },
    { stage: 'STAGE_3_VERIFY', label: '3. Verificando Ref', deals: [], totalVolumeUsdt: 0 },
    { stage: 'STAGE_4_CLOSED', label: '4. Liquidado', deals: [sampleDeal2], totalVolumeUsdt: 650 },
  ];

  const sampleStages: ArmPipelineStageConfig[] = [
    { slug: 'nuevo', name: 'Nuevo', workspaceId: 'ARM_B2B', position: 1, colorHex: '#0A84FF', isTerminal: false },
    { slug: 'calificado', name: 'Calificado', workspaceId: 'ARM_B2B', position: 2, colorHex: '#30D158', isTerminal: false },
  ];

  const sampleArmCard: ArmKanbanCardVm = {
    id: 'lead-1',
    workspaceId: 'ARM_B2B',
    leadName: 'Sofía Vargas',
    companyName: 'Clínica Aurora',
    stageSlug: 'nuevo',
    qualificationScore: 84,
    painPointSummary: 'Conciliación manual lenta',
    lastMessagePreview: '¿Incluye multi-sede?',
    assignedAgentRole: 'SDR_QUALIFIER',
    movedByAgentBadge: 'SDR 84/100',
    dealValueLabel: '$1,200 USD',
    freeWindowLabel: 'Ventana 24h: $0 Meta',
    messages: [{ sender: 'LEAD', text: '¿Incluye multi-sede?' }],
    toolTraces: [{ toolName: 'update_lead_bant_and_profile', latencyMs: 145, status: 'OK' }],
  };

  const sampleApproval: ArmApprovalQueueItem = {
    id: 'apr-1',
    workspaceId: 'ARM_B2B',
    idempotencyKey: 'idem-1',
    leadId: 'lead-1',
    leadName: 'Sofía Vargas',
    requestedByRole: 'QUOTER',
    toolName: 'create_or_submit_quote',
    actionType: 'SEND_QUOTE',
    title: 'Enviar Cotización Plan Pro ($1,200)',
    agentReasoning: 'Supera tope auto-aprobación.',
    riskRuleTriggered: 'MAX_AUTO_QUOTE',
    proposedPayload: { proposedWhatsappMessage: 'Adjuntamos propuesta Plan Pro.' },
    confidenceScore: 92,
    priority: 'HIGH',
    status: 'PENDING',
    createdAt: 1_700_000_000_000,
  };

  const sampleFeed: ArmAutonomousFeedEvent[] = [
    {
      id: 'ev-1',
      workspaceId: 'ARM_B2B',
      agentRole: 'SDR_QUALIFIER',
      agentName: 'Meteor SDR',
      leadId: 'lead-1',
      leadName: 'Sofía Vargas',
      toolName: 'update_lead_bant_and_profile',
      summary: 'BANT actualizado a 84/100',
      latencyMs: 120,
      timestamp: 1_700_000_000_000,
    },
  ];

  const sampleBriefing: ArmCloserPreCallBriefing = {
    workspaceId: 'ARM_B2B',
    leadName: 'Sofía Vargas',
    companyName: 'Clínica Aurora',
    startsInMinutes: 15,
    qualificationScore: 84,
    estimatedDealValue: 1200,
    bantSummary: 'Dolor: Conciliación | Autoridad: Directora',
    keyObjectionsAndMemories: ['Requiere factura fiscal'],
    recommendedClosingAngle: 'Anclar ROI y ofrecer 50/50 esta semana.',
    telegramMarkdownPayload: '*Briefing*',
  };

  const sampleReplay: ArmReplayComparisonResult = {
    workspaceId: 'ARM_B2B',
    leadName: 'Sofía Vargas',
    agentRole: 'QUOTER',
    historicalInboundText: 'Dame descuento',
    metaApiCostUsd: 0,
    baselineToolCall: { toolName: 'get_catalog_items', argsPreview: '{}', proposedReply: 'Base' },
    candidateToolCall: { toolName: 'create_or_submit_quote', argsPreview: '{}', proposedReply: 'Candidate', injectedFewShotCount: 2 },
    diffSummary: 'Mejora adherencia con 2 ejemplos Few-Shot.',
  };

  const setup = (
    overrides: Partial<{
      pipelineMode: 'LEGACY_BOARD' | 'ARM_AUTOPILOT';
      editingApprovalId: string | null;
      editingApprovalText: string;
      editingSaveAsExample: boolean;
      selectedArmCard: ArmKanbanCardVm | null;
      briefing: ArmCloserPreCallBriefing | null;
      replayResult: ArmReplayComparisonResult | null;
    }> = {},
  ) => {
    TestBed.configureTestingModule({
      imports: [CrmPipelineComponent],
    });

    fixture = TestBed.createComponent(CrmPipelineComponent);
    component = fixture.componentInstance;

    fixture.componentRef.setInput('activeSilo', 'P2P_DESK');
    fixture.componentRef.setInput('pipelineMode', overrides.pipelineMode ?? 'LEGACY_BOARD');
    fixture.componentRef.setInput('deals', [sampleDeal1, sampleDeal2]);
    fixture.componentRef.setInput('kanbanColumns', sampleColumns);
    fixture.componentRef.setInput('armStages', sampleStages);
    fixture.componentRef.setInput('armCards', [sampleArmCard]);
    fixture.componentRef.setInput('armApprovals', [sampleApproval]);
    fixture.componentRef.setInput('armFeed', sampleFeed);
    fixture.componentRef.setInput('armShadowCount', 4);
    fixture.componentRef.setInput('selectedArmCard', overrides.selectedArmCard ?? sampleArmCard);
    fixture.componentRef.setInput('briefing', overrides.briefing ?? sampleBriefing);
    fixture.componentRef.setInput('replayResult', overrides.replayResult ?? sampleReplay);
    fixture.componentRef.setInput('selectedSandboxPersona', 'SKEPTICAL_DISCOUNT_30');
    fixture.componentRef.setInput('dealFilter', 'ALL');
    fixture.componentRef.setInput('dealSearch', '');
    fixture.componentRef.setInput('compactView', false);
    fixture.componentRef.setInput('editingApprovalId', overrides.editingApprovalId ?? null);
    fixture.componentRef.setInput('editingApprovalText', overrides.editingApprovalText ?? '');
    fixture.componentRef.setInput('editingSaveAsExample', overrides.editingSaveAsExample ?? false);
    fixture.componentRef.setInput('closerLeadName', '');
    fixture.componentRef.setInput('closerTranscript', '');
    fixture.componentRef.setInput('privacyMode', false);

    fixture.detectChanges();
    return { fixture, component };
  };

  it('renders streamlined sub-toolbar with mode toggle, search, filter pills, and 3 ARM action buttons', () => {
    const { fixture, component } = setup();
    const host = fixture.nativeElement as HTMLElement;

    const modes: ('LEGACY_BOARD' | 'ARM_AUTOPILOT')[] = [];
    const sandboxes: ArmSandboxPersonaId[] = [];
    let replayCount = 0;
    let ghostingCount = 0;
    component.modeChange.subscribe((m) => modes.push(m));
    component.runSandbox.subscribe((p) => sandboxes.push(p));
    component.runReplay.subscribe(() => replayCount++);
    component.runAntiGhosting.subscribe(() => ghostingCount++);

    (host.querySelector('[data-testid="mode-arm-btn"]') as HTMLButtonElement).click();
    (host.querySelector('[data-testid="arm-sandbox-btn"]') as HTMLButtonElement).click();
    (host.querySelector('[data-testid="arm-ghosting-btn"]') as HTMLButtonElement).click();
    (host.querySelector('[data-testid="arm-replay-btn"]') as HTMLButtonElement).click();

    expect(modes).toEqual(['ARM_AUTOPILOT']);
    expect(sandboxes).toEqual(['SKEPTICAL_DISCOUNT_30']);
    expect(ghostingCount).toBe(1);
    expect(replayCount).toBe(1);
  });

  it('renders 4-column Kanban using content cards (no glass) with max 2 primary card actions + overflow menu', () => {
    const { fixture, component } = setup({ pipelineMode: 'LEGACY_BOARD' });
    const host = fixture.nativeElement as HTMLElement;

    const columns = host.querySelectorAll('[data-testid="kanban-col"]');
    expect(columns.length).toBe(4);

    const dealCard = host.querySelector('[data-testid="deal-card-DL-1"]') as HTMLElement;
    expect(dealCard.classList.contains('crm-content-card')).toBe(true);
    expect(dealCard.classList.contains('crm-liquid-glass')).toBe(false);

    const primaryActions = dealCard.querySelectorAll('[data-testid="card-primary-action"]');
    expect(primaryActions.length).toBeLessThanOrEqual(2);

    const advanced: unknown[] = [];
    const settled: string[] = [];
    const chats: PipelineDeal[] = [];
    const deleted: string[] = [];
    component.advanceDeal.subscribe((v) => advanced.push(v));
    component.settleDeal.subscribe((v) => settled.push(v));
    component.openDealChat.subscribe((v) => chats.push(v));
    component.deleteDeal.subscribe((v) => deleted.push(v));

    (primaryActions[0] as HTMLButtonElement).click();
    (primaryActions[1] as HTMLButtonElement).click();
    expect(advanced).toEqual([{ dealId: 'DL-1', targetStage: 'STAGE_2_TRANSIT' }]);
    expect(settled).toEqual(['DL-1']);

    const overflowBtn = dealCard.querySelector('[data-testid="card-overflow-btn-DL-1"]') as HTMLButtonElement;
    overflowBtn.click();
    fixture.detectChanges();

    (host.querySelector('[data-testid="card-menu-chat-DL-1"]') as HTMLButtonElement).click();
    expect(chats).toEqual([sampleDeal1]);

    overflowBtn.click();
    fixture.detectChanges();
    (host.querySelector('[data-testid="card-menu-delete-DL-1"]') as HTMLButtonElement).click();
    expect(deleted).toEqual(['DL-1']);
  });

  it('renders ARM_AUTOPILOT cards, stage select, feed, and floating liquid glass HITL inspector', () => {
    const { fixture, component } = setup({ pipelineMode: 'ARM_AUTOPILOT' });
    const host = fixture.nativeElement as HTMLElement;

    const inspector = host.querySelector('.crm-liquid-glass.pipeline-inspector');
    expect(inspector).toBeTruthy();

    const selectedLeads: string[] = [];
    const moved: { cardId: string; stageSlug: string }[] = [];
    component.selectArmLead.subscribe((id) => selectedLeads.push(id));
    component.moveArmStage.subscribe((payload) => moved.push(payload));

    const selectBtn = host.querySelector('[data-testid="arm-card-select-lead-1"]') as HTMLButtonElement;
    selectBtn.click();
    expect(selectedLeads).toEqual(['lead-1']);

    const stageSelect = host.querySelector('[data-testid="arm-card-stage-lead-1"]') as HTMLSelectElement;
    stageSelect.value = 'calificado';
    stageSelect.dispatchEvent(new Event('change'));
    expect(moved).toEqual([{ cardId: 'lead-1', stageSlug: 'calificado' }]);

    expect(host.textContent).toContain('Briefing');
    expect(host.textContent).toContain('Clínica Aurora');
    expect(host.textContent).toContain('update_lead_bant_and_profile');
  });

  it('supports HITL Approval Queue [A/E/H] actions and inline edit mode', () => {
    const { fixture, component } = setup();
    const host = fixture.nativeElement as HTMLElement;

    const approved: { id: string; text?: string; saveAsExample: boolean }[] = [];
    const rejected: string[] = [];
    const startedEdit: ArmApprovalQueueItem[] = [];
    component.approveItem.subscribe((p) => approved.push(p));
    component.rejectItem.subscribe((id) => rejected.push(id));
    component.startEditApproval.subscribe((item) => startedEdit.push(item));

    (host.querySelector('[data-testid="hitl-approve-apr-1"]') as HTMLButtonElement).click();
    (host.querySelector('[data-testid="hitl-edit-apr-1"]') as HTMLButtonElement).click();
    (host.querySelector('[data-testid="hitl-reject-apr-1"]') as HTMLButtonElement).click();

    expect(approved).toEqual([{ id: 'apr-1', saveAsExample: false }]);
    expect(startedEdit).toEqual([sampleApproval]);
    expect(rejected).toEqual(['apr-1']);

    fixture.componentRef.setInput('editingApprovalId', 'apr-1');
    fixture.componentRef.setInput('editingApprovalText', 'Propuesta ajustada');
    fixture.componentRef.setInput('editingSaveAsExample', true);
    fixture.detectChanges();

    (host.querySelector('[data-testid="hitl-confirm-edit-apr-1"]') as HTMLButtonElement).click();
    expect(approved[1]).toEqual({
      id: 'apr-1',
      text: 'Propuesta ajustada',
      saveAsExample: true,
    });
  });

  it('emits closer intelligence, search, filter, compact, and keyboard [A/E/H] actions', () => {
    const { fixture, component } = setup();
    const host = fixture.nativeElement as HTMLElement;

    const searches: string[] = [];
    const filters: string[] = [];
    let compactCalls = 0;
    let noteCalls = 0;
    let briefingCalls = 0;
    const approved: { id: string; text?: string; saveAsExample: boolean }[] = [];

    component.searchChange.subscribe((v) => searches.push(v));
    component.filterChange.subscribe((v) => filters.push(v));
    component.compactToggle.subscribe(() => compactCalls++);
    component.submitCloserNote.subscribe(() => noteCalls++);
    component.generateBriefing.subscribe(() => briefingCalls++);
    component.approveItem.subscribe((p) => approved.push(p));

    const searchInput = host.querySelector('.search-input') as HTMLInputElement;
    searchInput.value = 'Banesco';
    searchInput.dispatchEvent(new Event('input'));

    const expiredPill = Array.from(host.querySelectorAll('.filter-pill')).find((el) =>
      el.textContent?.includes('Tasa Vencida'),
    ) as HTMLButtonElement;
    expiredPill.click();

    const compactBtn = Array.from(host.querySelectorAll('.toolbar-meta-actions button')).find(
      (el) => el.textContent?.includes('Vista Compacta'),
    ) as HTMLButtonElement;
    compactBtn.click();

    const noteBtn = Array.from(host.querySelectorAll('.closer-form button')).find((el) =>
      el.textContent?.includes('Procesar Nota'),
    ) as HTMLButtonElement;
    const briefingBtn = Array.from(host.querySelectorAll('.closer-form button')).find((el) =>
      el.textContent?.includes('Briefing 15m'),
    ) as HTMLButtonElement;
    noteBtn.click();
    briefingBtn.click();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));

    expect(searches).toEqual(['Banesco']);
    expect(filters).toEqual(['EXPIRED']);
    expect(compactCalls).toBe(1);
    expect(noteCalls).toBe(1);
    expect(briefingCalls).toBe(1);
    expect(approved).toEqual([{ id: 'apr-1', saveAsExample: false }]);
  });
});
