import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  inject,
  signal,
  OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { StorageService } from '../../core/storage';
import { ToastService } from '../../core/toast.service';
import { Finance360Service } from '../../core/finance-360.service';
import { InboundGatewayService } from '../../core/services/inbound-gateway.service';
import { computeTriMonetaryAmount } from '../../core/models/finance-360.models';
import {
  compileCrmWorkspaceState,
  transitionDealStage,
  checkCounterpartyExposure,
  parseBankSmsClipboard,
  verifyReferenceCollision,
  calculateDirectQuote,
  buildContactWhatsAppReceipt,
  createDailyProfitSettlementForFinance360,
  calculateBankReconciliationAdjustment,
  normalizeBankReference,
  CRM_STORAGE_KEYS,
  safeHydrateCrmCollection,
  validateAndSanitizeCrmBackupPayload,
  serializeContactsToCsv,
  parseAndValidateContactsCsv,
  serializeBanksToCsv,
  parseAndValidateBanksCsv,
  serializeActivitiesToCsv,
  parseAndValidateActivitiesCsv,
  reconcileCrmCollectionById,
  evaluateMeta24hFreeWindow,
  classifyAndDraftAiResponse,
  buildCopyableBankBubbles,
  calculateBillingDocumentTotals,
  formatDocumentForMessaging,
  buildWhatsAppDirectUrl,
  buildGeminiMultimodalOcrPayload,
  parseGeminiOcrResponse,
  formatFiatNumber,
  ARM_WORKSPACES,
  getWorkspaceStages,
  getWorkspaceAgents,
  getWorkspaceCatalog,
  runArmSandboxSimulationTurn,
  recordShadowLearningCorrection,
  selectFewShotExamplesForAgent,
  processCloserPostCallNote,
  evaluateGhostingFollowUp,
  evaluateDealTokenCircuitBreaker,
  runArmDeterministicReplayComparison,
  generateCloserPreCallBriefing,
  type CrmImportStrategy,
  type CrmCsvCatalogEntity,
  type WorkspaceScope,
  type PipelineStage,
  type FiatCurrency,
  type CrmContactCategory,
  type PipelineDeal,
  type CrmContact,
  type CrmBankAccount,
  type ActivityLogEntry,
  type DailyNetProfitTransferPayload,
  type CompiledCrmWorkspaceState,
  type DirectCommercialQuote,
  type ClipboardParseResult,
  type KanbanColumn,
  type InboundReceiptEvent,
  type MessagingChannel,
  type AiOperatingMode,
  type OmnichannelMessage,
  type OmnichannelConversation,
  type MetaFreeWindowEvaluation,
  type AiTriageResult,
  type CopyableBankBubbles,
  type CrmDocumentType,
  type BillingLineItem,
  type CrmBillingDocument,
  type OmnichannelIntegrationConfig,
  type GeminiOcrParsedResult,
  type ArmWorkspaceId,
  type ArmPipelineStageConfig,
  type ArmAgentDefinition,
  type ArmApprovalQueueItem,
  type ArmAutonomousFeedEvent,
  type ArmShadowExample,
  type ArmSandboxPersonaId,
  type ArmOutboxSseEvent,
  type ArmReplayComparisonResult,
  type ArmCloserPreCallBriefing,
} from '@p2p/core';

export type CrmModuleView =
  | 'DASHBOARD'
  | 'KANBAN'
  | 'CONTACTS'
  | 'BANKS'
  | 'ACTIVITIES'
  | 'OMNICHANNEL'
  | 'ARM_COMMAND'
  | 'SETTINGS';

@Component({
  selector: 'app-compliance-cockpit',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './compliance-cockpit.html',
  styleUrls: ['./compliance-cockpit.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ComplianceCockpitComponent implements OnDestroy {
  private readonly storage = inject(StorageService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly finance360 = inject(Finance360Service);
  readonly inboundGateway = inject(InboundGatewayService);

  private gatewaySubscription: Subscription | null = null;
  private armEventSubscription: Subscription | null = null;

  constructor() {
    this.gatewaySubscription = this.inboundGateway.receipt$.subscribe((receipt) => {
      this.handleInboundReceipt(receipt);
    });
    if (this.inboundGateway.armEvent$) {
      this.armEventSubscription = this.inboundGateway.armEvent$.subscribe((evt: ArmOutboxSseEvent) => {
        this.handleIncomingArmOutboxEvent(evt);
      });
    }
  }

  ngOnDestroy(): void {
    this.gatewaySubscription?.unsubscribe();
    this.armEventSubscription?.unsubscribe();
  }

  readonly showGatewayConfigModal = signal<boolean>(false);
  readonly gatewayUrlInput = signal<string>(this.inboundGateway.getGatewayUrl());
  readonly gatewayTesting = signal<boolean>(false);
  readonly gatewayTestResult = signal<{ ok: boolean; message: string } | null>(null);

  onGatewayPillClick(): void {
    this.gatewayUrlInput.set(this.inboundGateway.getGatewayUrl());
    this.gatewayTestResult.set(null);

    if (this.inboundGateway.status() === 'CONNECTED') {
      this.toast.info(
        `Inbound Gateway activo en ${this.inboundGateway.getGatewayUrl()}. Podés editar o verificar la conexión.`,
        'Gateway Conectado'
      );
    }
    this.showGatewayConfigModal.set(true);
  }

  setGatewayUrlPreset(presetUrl: string): void {
    this.gatewayUrlInput.set(presetUrl);
    this.gatewayTestResult.set(null);
  }

  async testGatewayConnection(): Promise<void> {
    this.gatewayTesting.set(true);
    this.gatewayTestResult.set(null);
    const targetUrl = this.gatewayUrlInput().trim();
    const result = await this.inboundGateway.testConnection(targetUrl);
    this.gatewayTesting.set(false);
    if (result.ok) {
      this.gatewayTestResult.set({ ok: true, message: `¡Conexión exitosa! Estado: ${result.status}` });
    } else {
      this.gatewayTestResult.set({
        ok: false,
        message: `No se pudo conectar (${result.error || 'Host inalcanzable'}). Asegurate de que el daemon esté activo ('npm run inbound:start').`,
      });
    }
  }

  saveAndConnectGateway(): void {
    const targetUrl = this.gatewayUrlInput().trim();
    if (!targetUrl) return;
    this.inboundGateway.setGatewayUrl(targetUrl);
    this.showGatewayConfigModal.set(false);
    this.toast.success(`Guardada URL del Gateway: ${targetUrl}`, 'Gateway Configurado');
  }

  // ---------------------------------------------------------------------------
  // 1. DUAL-VAULT & VIEW NAVIGATION (ZERO-SEED POLICY)
  // ---------------------------------------------------------------------------
  readonly activeScope = signal<WorkspaceScope>(
    (this.storage.get<WorkspaceScope>(CRM_STORAGE_KEYS.ACTIVE_SCOPE) ?? 'P2P_DESK') === 'FINANCE_360'
      ? 'FINANCE_360'
      : 'P2P_DESK',
  );

  readonly activeView = signal<CrmModuleView>(
    this.storage.get<CrmModuleView>(CRM_STORAGE_KEYS.ACTIVE_VIEW) ?? 'DASHBOARD',
  );

  readonly privacyMode = signal<boolean>(
    this.storage.get<boolean>(CRM_STORAGE_KEYS.PRIVACY_MODE) ?? false,
  );

  // Clean persistent signals (initialized strictly as empty arrays if no user data exists)
  readonly deals = signal<PipelineDeal[]>(
    safeHydrateCrmCollection<PipelineDeal>(this.storage.get(CRM_STORAGE_KEYS.DEALS)),
  );

  readonly contacts = signal<CrmContact[]>(
    safeHydrateCrmCollection<CrmContact>(this.storage.get(CRM_STORAGE_KEYS.CONTACTS)),
  );

  readonly banks = signal<CrmBankAccount[]>(
    safeHydrateCrmCollection<CrmBankAccount>(this.storage.get(CRM_STORAGE_KEYS.BANKS)),
  );

  readonly activities = signal<ActivityLogEntry[]>(
    safeHydrateCrmCollection<ActivityLogEntry>(this.storage.get(CRM_STORAGE_KEYS.ACTIVITIES)),
  );

  readonly settlements = signal<DailyNetProfitTransferPayload[]>(
    safeHydrateCrmCollection<DailyNetProfitTransferPayload>(
      this.storage.get(CRM_STORAGE_KEYS.SETTLEMENTS),
      false,
    ),
  );

  readonly conversations = signal<OmnichannelConversation[]>(
    safeHydrateCrmCollection<OmnichannelConversation>(this.storage.get(CRM_STORAGE_KEYS.CONVERSATIONS)),
  );

  readonly invoicesOrQuotes = signal<CrmBillingDocument[]>(
    safeHydrateCrmCollection<CrmBillingDocument>(this.storage.get(CRM_STORAGE_KEYS.INVOICES_OR_QUOTES)),
  );

  readonly omnichannelConfig = signal<OmnichannelIntegrationConfig>(
    this.storage.get<OmnichannelIntegrationConfig>(CRM_STORAGE_KEYS.OMNICHANNEL_CONFIG) ?? {
      aiMode: 'COPILOT_DRAFT',
      businessDisplayName: 'P2P Quant Treasury',
      welcomeTemplateP2p: '¡Hola! Con gusto te atendemos en nuestra mesa P2P. Indícanos el monto en USDT o Fiat que deseas operar y tu método de pago preferido.',
      welcomeTemplate360: '¡Hola! Con gusto gestionamos tu cotización o factura comercial. Indícanos los ítems o servicios requeridos para emitirte la propuesta formal.',
    },
  );

  // ---------------------------------------------------------------------------
  // OMNICHANNEL & BILLING STUDIO SIGNALS
  // ---------------------------------------------------------------------------
  readonly omnichannelSubTab = signal<'INBOX' | 'STUDIO' | 'CONFIG'>('INBOX');
  readonly selectedConversationId = signal<string | null>(null);
  readonly chatSearchTerm = signal<string>('');
  readonly chatDraftText = signal<string>('');
  readonly testInboundText = signal<string>('');
  readonly activeAiTriage = signal<AiTriageResult | null>(null);
  readonly selectedBankForBubbles = signal<string>('');
  readonly isAnalyzingOcr = signal<boolean>(false);
  readonly ocrExtractedResult = signal<GeminiOcrParsedResult | null>(null);

  // New Chat Modal
  readonly showNewChatModal = signal<boolean>(false);
  readonly newChatChannel = signal<MessagingChannel>('WHATSAPP');
  readonly newChatContactId = signal<string>('');
  readonly newChatRecipient = signal<string>('');
  readonly newChatName = signal<string>('');

  // Studio Document Signals
  readonly studioDocType = signal<CrmDocumentType>('PRESUPUESTO_QUOTE');
  readonly studioContactId = signal<string>('');
  readonly studioDocNumber = signal<string>('');
  readonly studioFiatCurrency = signal<FiatCurrency>('VES');
  readonly studioExchangeRate = signal<number>(82.0);
  readonly studioDiscountUsdt = signal<number>(0);
  readonly studioTaxPct = signal<number>(0);
  readonly studioBankAccountId = signal<string>('');
  readonly studioBankRefId = signal<string>('');
  readonly studioPaymentInstructions = signal<string>('');
  readonly studioItems = signal<BillingLineItem[]>([
    {
      id: 'item-1',
      description: 'Servicio / Operación Comercial',
      quantity: 1,
      unitPriceUsdt: 100,
      category: 'PRODUCT',
    },
  ]);

  // Non-blocking in-component dialog signals (Electron & Web safe)
  readonly promptClosingDeal = signal<{
    deal: PipelineDeal;
    reference: string;
    isDuplicate: boolean;
    collidingDealId?: string;
  } | null>(null);

  readonly confirmModal = signal<{
    title: string;
    message: string;
    confirmLabel?: string;
    isDestructive?: boolean;
    onConfirm: () => void;
  } | null>(null);

  readonly allowExposureOverride = signal<boolean>(false);
  readonly allowDuplicateRefOverride = signal<boolean>(false);

  // Live market baseline for calculations
  readonly liveReplacementRate = signal<number>(82.0);

  // Clock tick for live 15-min burst cooldown and TTL expirations
  readonly clockTick = signal<number>(Date.now());

  // ---------------------------------------------------------------------------
  // 2. COMPILED CRM WORKSPACE STATE (O(n) SINGLE-PASS ENGINE)
  // ---------------------------------------------------------------------------
  readonly workspaceState = computed<CompiledCrmWorkspaceState>(() => {
    return compileCrmWorkspaceState(
      this.deals(),
      this.contacts(),
      this.banks(),
      this.activities(),
      this.activeScope(),
      this.liveReplacementRate(),
      this.clockTick(),
    );
  });

  readonly kpis = computed(() => this.workspaceState().kpis);

  readonly kanbanColumnsList = computed<KanbanColumn[]>(() => {
    const cols = this.workspaceState().kanbanColumns;
    return [
      cols.STAGE_1_NEW,
      cols.STAGE_2_TRANSIT,
      cols.STAGE_3_VERIFY,
      cols.STAGE_4_CLOSED,
    ];
  });

  // Kanban Toolbar & Interactive Filtering Signals
  readonly kanbanSearchQuery = signal<string>('');
  readonly kanbanFilterMode = signal<'ALL' | 'EXPIRED' | 'WITH_REF' | 'HIGH_VALUE'>('ALL');
  readonly kanbanCompactMode = signal<boolean>(false);

  readonly filteredKanbanColumnsList = computed<KanbanColumn[]>(() => {
    const baseCols = this.kanbanColumnsList();
    const q = this.kanbanSearchQuery().trim().toLowerCase();
    const mode = this.kanbanFilterMode();

    if (!q && mode === 'ALL') {
      return baseCols;
    }

    return baseCols.map((col) => {
      const deals = col.deals.filter((d) => {
        if (q) {
          const matchesQuery =
            d.id.toLowerCase().includes(q) ||
            d.contactName.toLowerCase().includes(q) ||
            d.bankName.toLowerCase().includes(q) ||
            (d.bankReferenceId && d.bankReferenceId.toLowerCase().includes(q));
          if (!matchesQuery) return false;
        }
        if (mode === 'EXPIRED' && !d.isRateExpired) return false;
        if (mode === 'WITH_REF' && !d.bankReferenceId?.trim()) return false;
        if (mode === 'HIGH_VALUE' && d.cryptoAmountUsdt < 500) return false;
        return true;
      });

      const totalUsdt = deals.reduce((acc, d) => acc + d.cryptoAmountUsdt, 0);
      const totalFiat = deals.reduce((acc, d) => acc + d.totalFiatAmount, 0);
      return {
        ...col,
        deals,
        totalUsdt: Math.round(totalUsdt * 100) / 100,
        totalFiat: Math.round(totalFiat * 100) / 100,
      };
    });
  });

  readonly pipelineConversionSummary = computed(() => {
    const cols = this.kanbanColumnsList();
    const totalDeals = cols.reduce((acc, c) => acc + c.deals.length, 0);
    const totalPipelineUsdt = cols.reduce((acc, c) => acc + c.totalUsdt, 0);
    const closedCount = cols[3]?.deals.length ?? 0;
    const expiredCount = cols.reduce(
      (acc, c) => acc + c.deals.filter((d) => d.isRateExpired).length,
      0,
    );
    const conversionRatePct = totalDeals > 0 ? Math.round((closedCount / totalDeals) * 100) : 0;
    return {
      totalDeals,
      totalPipelineUsdt: Math.round(totalPipelineUsdt * 100) / 100,
      closedCount,
      expiredCount,
      conversionRatePct,
    };
  });

  readonly todayDateIso = computed<string>(() => {
    const d = new Date(this.clockTick());
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  });

  readonly isTodaySettled = computed<boolean>(() => {
    const todaySettlementId = `SETTLE-${this.todayDateIso()}`;
    return this.settlements().some((s) => s.settlementId === todaySettlementId);
  });

  readonly filteredConversations = computed(() => {
    const scope = this.activeScope();
    const term = this.chatSearchTerm().toLowerCase().trim();
    return this.conversations().filter((c) => {
      if (c.scope !== scope) return false;
      if (!term) return true;
      return (
        c.contactName.toLowerCase().includes(term) ||
        c.recipientPhoneOrIgId.toLowerCase().includes(term)
      );
    });
  });

  readonly activeConversation = computed(() => {
    const id = this.selectedConversationId();
    const list = this.filteredConversations();
    if (!id) return list[0] ?? null;
    return this.conversations().find((c) => c.id === id) ?? list[0] ?? null;
  });

  readonly activeConvFreeWindow = computed<MetaFreeWindowEvaluation>(() => {
    const conv = this.activeConversation();
    return evaluateMeta24hFreeWindow(conv?.lastInboundTimestamp, this.clockTick());
  });

  readonly studioTotals = computed(() => {
    return calculateBillingDocumentTotals(
      this.studioItems(),
      this.studioDiscountUsdt(),
      this.studioTaxPct(),
      this.studioExchangeRate(),
    );
  });

  // ---------------------------------------------------------------------------
  // 3. CLIPBOARD SMS PARSER & ANTI-FRAUDE VERIFIER STATE
  // ---------------------------------------------------------------------------
  readonly candidateRef = signal<string>('');
  readonly rawClipboardInput = signal<string>('');
  readonly activitySearchQuery = signal<string>('');
  readonly activityTypeFilter = signal<string>('ALL');

  readonly referenceCheck = computed(() => {
    return verifyReferenceCollision(this.deals(), this.candidateRef());
  });

  readonly parsedClipboard = computed<ClipboardParseResult>(() => {
    return parseBankSmsClipboard(this.rawClipboardInput());
  });

  readonly filteredActivities = computed<ActivityLogEntry[]>(() => {
    const list = this.workspaceState().activities;
    const q = this.activitySearchQuery().trim().toLowerCase();
    const typeFilter = this.activityTypeFilter();

    return list.filter((act) => {
      if (typeFilter !== 'ALL' && act.type !== typeFilter) return false;
      if (!q) return true;
      return (
        act.description.toLowerCase().includes(q) ||
        act.type.toLowerCase().includes(q) ||
        (act.referenceId && act.referenceId.toLowerCase().includes(q))
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 4. NUEVO TRATO / PIPELINE MODAL & FORM STATE
  // ---------------------------------------------------------------------------
  readonly showAddDealModal = signal<boolean>(false);
  readonly dealTitle = signal<string>('');
  readonly dealContactId = signal<string>('');
  readonly dealBankAccountId = signal<string>('');
  readonly dealAmountUsdt = signal<number | null>(null);
  readonly dealAppliedRate = signal<number | null>(null);
  readonly dealReplacementRate = signal<number | null>(null);
  readonly dealReferenceId = signal<string>('');
  readonly dealQuoteTtlMinutes = signal<number>(15);

  readonly dealCommercialQuote = computed<DirectCommercialQuote>(() => {
    return calculateDirectQuote(
      this.dealAmountUsdt() ?? 0,
      this.dealReplacementRate() ?? this.liveReplacementRate(),
      this.dealAppliedRate() ?? 0,
      0.3,
    );
  });

  // Drag & Drop tracking
  readonly draggingDealId = signal<string | null>(null);

  // ---------------------------------------------------------------------------
  // 5. CONTACTS CRM & 360° DOSSIER STATE
  // ---------------------------------------------------------------------------
  readonly showAddContactModal = signal<boolean>(false);
  readonly newContactName = signal<string>('');
  readonly newContactDocId = signal<string>('');
  readonly newContactPhone = signal<string>('');
  readonly newContactCategory = signal<CrmContactCategory>('CLIENT_P2P');
  readonly newContactPaymentDetails = signal<string>('');
  readonly newContactCreditLimit = signal<number>(5000);
  readonly newContactMaxExposure = signal<number>(5000);
  readonly contactSearchQuery = signal<string>('');
  readonly contactCategoryFilter = signal<'ALL' | 'WITH_BALANCE' | 'VIP_OTC' | 'CLIENT_P2P' | 'SUPPLIER_360' | 'CLIENT_360'>('ALL');
  readonly selectedContactId = signal<string | null>(null);
  readonly contactBalanceAdjustAmount = signal<number | null>(null);

  readonly selectedContact = computed<CrmContact | null>(() => {
    const id = this.selectedContactId();
    if (!id) return null;
    return this.workspaceState().contacts.find((c) => c.id === id) ?? null;
  });

  readonly selectedContactDeals = computed<PipelineDeal[]>(() => {
    const id = this.selectedContactId();
    if (!id) return [];
    return this.workspaceState().deals.filter((d) => d.contactId === id);
  });

  readonly selectedContactMetrics = computed(() => {
    const c = this.selectedContact();
    const deals = this.selectedContactDeals();
    if (!c) {
      return {
        totalDeals: 0,
        closedDeals: 0,
        inTransitDeals: 0,
        lifetimeVolumeUsdt: 0,
        lifetimeProfitUsdt: 0,
        inTransitExposureUsdt: 0,
        exposurePct: 0,
      };
    }

    let closedDeals = 0;
    let inTransitDeals = 0;
    let lifetimeVolumeUsdt = 0;
    let lifetimeProfitUsdt = 0;
    let inTransitExposureUsdt = 0;

    for (const d of deals) {
      lifetimeVolumeUsdt += d.cryptoAmountUsdt;
      if (d.stage === 'STAGE_4_CLOSED') {
        closedDeals++;
        lifetimeProfitUsdt += d.netProfitUsdt;
      } else {
        inTransitDeals++;
        inTransitExposureUsdt += d.cryptoAmountUsdt;
      }
    }

    const maxExp = c.maxPendingExposureUsdt > 0 ? c.maxPendingExposureUsdt : 1;
    const exposurePct = Math.min(100, Math.round((inTransitExposureUsdt / maxExp) * 100));

    return {
      totalDeals: deals.length,
      closedDeals,
      inTransitDeals,
      lifetimeVolumeUsdt: Math.round(lifetimeVolumeUsdt * 100) / 100,
      lifetimeProfitUsdt: Math.round(lifetimeProfitUsdt * 100) / 100,
      inTransitExposureUsdt: Math.round(inTransitExposureUsdt * 100) / 100,
      exposurePct,
    };
  });

  readonly filteredContacts = computed<CrmContact[]>(() => {
    const q = this.contactSearchQuery().trim().toLowerCase();
    const catFilter = this.contactCategoryFilter();
    const list = this.workspaceState().contacts;

    return list.filter((c) => {
      if (catFilter === 'WITH_BALANCE' && Math.abs(c.pendingBalanceUsdt) < 0.01) return false;
      if (
        catFilter !== 'ALL' &&
        catFilter !== 'WITH_BALANCE' &&
        c.category !== catFilter
      ) {
        return false;
      }
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.documentId.toLowerCase().includes(q) ||
        c.phoneOrContact.toLowerCase().includes(q)
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 6. BANK SHIELD & RECONCILIATION STATE
  // ---------------------------------------------------------------------------
  readonly showAddBankModal = signal<boolean>(false);
  readonly newBankName = signal<string>('');
  readonly newBankCurrency = signal<FiatCurrency>('VES');
  readonly newBankHolderDetails = signal<string>('');
  readonly newBankInitialBalance = signal<number | null>(0);
  readonly newBankDailyCap = signal<number | null>(50000);
  readonly newBankFeePct = signal<number | null>(0.3);
  readonly newBankBurstMax = signal<number | null>(5);

  readonly reconcilingBankId = signal<string | null>(null);
  readonly realBankBalanceInput = signal<number | null>(null);

  readonly bankFleetSummary = computed(() => {
    const telemetry = this.workspaceState().bankTelemetry;
    const totalCount = telemetry.length;
    const availableCount = telemetry.filter((b) => b.status === 'AVAILABLE').length;
    const cooldownCount = telemetry.filter((b) => b.status === 'COOLDOWN_BURST').length;
    const capReachedCount = telemetry.filter((b) => b.status === 'DAILY_CAP_REACHED').length;
    const avgUsagePct =
      totalCount > 0
        ? Math.round((telemetry.reduce((acc, b) => acc + b.dailyUsagePct, 0) / totalCount) * 10) / 10
        : 0;
    const totalVesBalance = telemetry
      .filter((b) => b.currency === 'VES')
      .reduce((acc, b) => acc + b.currentBalanceFiat, 0);

    return {
      totalCount,
      availableCount,
      cooldownCount,
      capReachedCount,
      avgUsagePct,
      totalVesBalance: Math.round(totalVesBalance * 100) / 100,
    };
  });

  // ---------------------------------------------------------------------------
  // LIFECYCLE & HOTKEYS
  // ---------------------------------------------------------------------------
  @HostListener('window:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent): void {
    if (event.altKey && (event.key === 'p' || event.key === 'P')) {
      event.preventDefault();
      this.togglePrivacyMode();
    }
  }

  // ---------------------------------------------------------------------------
  // ACTIONS: SCOPE & VIEW NAVIGATION
  // ---------------------------------------------------------------------------
  setScope(scope: WorkspaceScope): void {
    this.activeScope.set(scope);
    this.storage.set(CRM_STORAGE_KEYS.ACTIVE_SCOPE, scope);
    this.selectedContactId.set(null);
    this.toast.info(
      scope === 'P2P_DESK'
        ? 'Bóveda P2P / OTC activada.'
        : 'Bóveda Finanzas 360 activada.',
      'Aislamiento de Bóveda',
    );
  }

  setView(view: CrmModuleView): void {
    this.activeView.set(view);
    this.storage.set(CRM_STORAGE_KEYS.ACTIVE_VIEW, view);
  }

  togglePrivacyMode(): void {
    const next = !this.privacyMode();
    this.privacyMode.set(next);
    this.storage.set(CRM_STORAGE_KEYS.PRIVACY_MODE, next);
    this.toast.info(
      next ? 'Modo Privacidad [ACTIVO] (cifras ocultas)' : 'Modo Privacidad [DESACTIVADO]',
      'Vista Operativa',
    );
  }

  navigateToFinance360(): void {
    void this.router.navigate(['/finanzas-360']);
  }

  // ---------------------------------------------------------------------------
  // ACTIONS: FINANCES 360 PROFIT BRIDGE
  // ---------------------------------------------------------------------------
  transferDailyProfitToFinance360(): void {
    const deals = this.deals();
    const dateIso = this.todayDateIso();
    const existing = this.settlements();

    const result = createDailyProfitSettlementForFinance360(deals, dateIso, existing);

    if (!result.success || !result.payload) {
      if (result.error === 'SETTLEMENT_ALREADY_EXISTS') {
        this.toast.warn('La ganancia de hoy ya fue transferida a Finanzas 360.', 'Corte Diario');
      } else {
        this.toast.warn('No hay ganancia neta positiva de tratos liquidados hoy.', 'Corte Diario');
      }
      return;
    }

    const payload = result.payload;
    const nextSettlements = [...existing, payload];
    this.settlements.set(nextSettlements);
    this.storage.set(CRM_STORAGE_KEYS.SETTLEMENTS, nextSettlements);

    try {
      this.finance360.addIncome({
        title: `Corte Diario P2P Desk (${payload.dateIso})`,
        scope: 'business',
        category: 'p2p_profit',
        channel: 'crypto',
        triMonetary: computeTriMonetaryAmount(payload.netProfitUsdt, 'USDT', 1, 1),
        date: payload.dateIso,
        referenceNumber: payload.settlementId,
        notes: `Liquidación automática P2P #${payload.settlementId} (${payload.tradesCount} operaciones cerradas).`,
        p2pBridgeMetadata: {
          operationsCount: payload.tradesCount,
          realizedPnlVes: 0,
          realizedPnlUsdt: payload.netProfitUsdt,
          importedAt: new Date(payload.timestamp).toISOString(),
        },
      });

      this.toast.success(
        `💰 +$${payload.netProfitUsdt.toFixed(2)} USDT transferidos a Finanzas 360 (#${payload.settlementId}).`,
        'Puente Liquidación 360',
      );
    } catch {
      this.toast.warn(
        `Liquidación #${payload.settlementId} registrada localmente.`,
        'Liquidación P2P',
      );
    }
  }

  // ---------------------------------------------------------------------------
  // ACTIONS: KANBAN & PIPELINE MANAGEMENT
  // ---------------------------------------------------------------------------
  openNewDealModal(): void {
    this.dealTitle.set('');
    this.dealContactId.set(this.selectedContactId() ?? '');
    this.dealBankAccountId.set(this.workspaceState().recommendedBankId ?? '');
    this.dealAmountUsdt.set(null);
    this.dealAppliedRate.set(null);
    this.dealReplacementRate.set(this.liveReplacementRate());
    this.dealReferenceId.set('');
    this.dealQuoteTtlMinutes.set(15);
    this.showAddDealModal.set(true);
  }

  saveNewDeal(directSettle = false): void {
    const scope = this.activeScope();
    const contactId = this.dealContactId();
    const bankId = this.dealBankAccountId();
    const amountUsdt = this.dealAmountUsdt();
    const appliedRate = this.dealAppliedRate();
    const replacementRate = this.dealReplacementRate() ?? this.liveReplacementRate();
    const ref = this.dealReferenceId().trim();

    if (!contactId) {
      this.toast.warn('Seleccione un contacto o cliente.', 'Formulario Incompleto');
      return;
    }
    if (!bankId) {
      this.toast.warn('Seleccione una cuenta bancaria.', 'Formulario Incompleto');
      return;
    }
    if (!amountUsdt || amountUsdt <= 0) {
      this.toast.warn('Ingrese un monto válido en USDT.', 'Formulario Incompleto');
      return;
    }
    if (!appliedRate || appliedRate <= 0) {
      this.toast.warn('Ingrese la tasa aplicada al cliente.', 'Formulario Incompleto');
      return;
    }

    const contact = this.contacts().find((c) => c.id === contactId);
    const bank = this.banks().find((b) => b.id === bankId);
    if (!contact || !bank) {
      this.toast.error('Contacto o banco no encontrado.', 'Error');
      return;
    }

    // Check Counterparty Exposure Limit
    if (!directSettle) {
      const exposureCheck = checkCounterpartyExposure(contact, this.deals(), amountUsdt);
      if (!exposureCheck.allowed && !this.allowExposureOverride()) {
        this.confirmModal.set({
          title: 'Alerta de Sobreexposición Crediticia',
          message: `El cliente ${contact.name} tiene $${exposureCheck.currentExposureUsdt} USDT en tránsito. Esta nueva operación de $${amountUsdt} USDT supera su límite de $${exposureCheck.limitUsdt} USDT.\n\n¿Desea autorizar este trato de todas formas?`,
          confirmLabel: 'Autorizar Operación',
          isDestructive: false,
          onConfirm: () => {
            this.allowExposureOverride.set(true);
            this.confirmModal.set(null);
            this.saveNewDeal();
          },
        });
        return;
      }
    }

    // Check Reference Collision if reference provided
    if (ref) {
      const collision = verifyReferenceCollision(this.deals(), ref);
      if (collision.isDuplicate && collision.existingDeal && !this.allowDuplicateRefOverride()) {
        this.confirmModal.set({
          title: 'Alerta: Colisión de Referencia',
          message: `La referencia "${ref}" ya fue usada en el trato #${collision.existingDeal.id} (${collision.existingDeal.contactName}).\n\n¿Desea registrarla de todas formas?`,
          confirmLabel: 'Confirmar con Referencia Duplicada',
          isDestructive: false,
          onConfirm: () => {
            this.allowDuplicateRefOverride.set(true);
            this.confirmModal.set(null);
            this.saveNewDeal();
          },
        });
        return;
      }
    }

    // Financial calculations
    const quote = calculateDirectQuote(amountUsdt, replacementRate, appliedRate, bank.feePct);
    const now = Date.now();
    const targetStage: PipelineStage = directSettle ? 'STAGE_4_CLOSED' : 'STAGE_1_NEW';

    const newDeal: PipelineDeal = {
      id: `DL-${Date.now().toString().slice(-6)}`,
      scope,
      title: this.dealTitle().trim() || `Trato ${amountUsdt} USDT - ${contact.name}`,
      contactId: contact.id,
      contactName: contact.name,
      bankAccountId: bank.id,
      bankName: bank.bankName,
      stage: targetStage,
      fiatCurrency: bank.currency,
      cryptoAmountUsdt: amountUsdt,
      appliedRate,
      replacementRate,
      totalFiatAmount: quote.totalFiatToCollect,
      paidFiatAmount: directSettle ? quote.totalFiatToCollect : 0,
      netProfitUsdt: quote.netProfitUsdt,
      bankReferenceId: ref,
      quoteTtlMinutes: this.dealQuoteTtlMinutes(),
      quotedAt: now,
      isRateExpired: false,
      timeline: [
        {
          timestamp: now,
          fromStage: null,
          toStage: targetStage,
          notes: directSettle ? 'Liquidación directa inmediata' : 'Trato cotizado en tablero',
        },
      ],
      createdAt: now,
      closedAt: directSettle ? now : null,
    };

    // 1. Insert Deal
    const nextDeals = [newDeal, ...this.deals()];
    this.deals.set(nextDeals);
    this.storage.set(CRM_STORAGE_KEYS.DEALS, nextDeals);

    // 2. If direct settle, update Bank balance
    if (directSettle) {
      const nextBanks = this.banks().map((b) =>
        b.id === bank.id
          ? { ...b, currentBalanceFiat: Math.round((b.currentBalanceFiat + newDeal.totalFiatAmount) * 100) / 100 }
          : b,
      );
      this.banks.set(nextBanks);
      this.storage.set(CRM_STORAGE_KEYS.BANKS, nextBanks);
    }

    // 3. Record Activity Log
    this.logActivity({
      type: directSettle ? 'DEAL_CLOSED' : 'DEAL_CREATED',
      description: directSettle
        ? `Operación #${newDeal.id} liquidada directamente (+${newDeal.netProfitUsdt} USDT)`
        : `Nuevo trato #${newDeal.id} cotizado para ${contact.name}`,
      amountUsdt: newDeal.cryptoAmountUsdt,
      referenceId: ref,
    });

    this.showAddDealModal.set(false);
    this.toast.success(
      directSettle
        ? `⚡ Operación #${newDeal.id} liquidada con éxito (+${newDeal.netProfitUsdt.toFixed(2)} USDT PnL).`
        : `📋 Trato #${newDeal.id} agregado al tablero en "Cotizado".`,
      'Pipeline Operativo',
    );
  }

  handleInboundReceipt(receipt: InboundReceiptEvent): void {
    if (!receipt || !receipt.parsed) return;

    // Dual-Vault filter: Only ingest into matching active workspace scope
    if (receipt.scope !== this.activeScope()) {
      return;
    }

    const ref = receipt.parsed.referenceId || '';

    // Anti-fraud duplicate reference detection
    if (ref) {
      const collision = verifyReferenceCollision(this.deals(), ref);
      if (collision.isDuplicate) {
        this.toast.warn(
          `Comprobante duplicado recibido vía ${receipt.channel} (Ref: ${ref})`,
          'Alerta de Colisión',
        );
        this.logActivity({
          type: 'EXPOSURE_ALERT',
          description: `Comprobante duplicado detectado (${receipt.channel}) Ref: ${ref}`,
          amountUsdt: 0,
          referenceId: ref,
        });
        return;
      }
    }

    // Match existing counterparty contact by phone number or name
    const matchedContact = this.contacts().find(
      (c) =>
        (c.phoneOrContact && receipt.sender.id && c.phoneOrContact.includes(receipt.sender.id)) ||
        (c.name && receipt.sender.name && c.name.toLowerCase() === receipt.sender.name.toLowerCase()),
    );
    const contactId = matchedContact ? matchedContact.id : 'CNT-UNREGISTERED';
    const contactName = matchedContact
      ? matchedContact.name
      : (receipt.sender.name || receipt.sender.id || 'Contraparte Externa');

    // Match existing bank or default to first bank in scope
    const matchedBank = this.banks().find(
      (b) =>
        receipt.parsed.detectedBank &&
        b.bankName.toLowerCase().includes(receipt.parsed.detectedBank.toLowerCase()),
    ) ?? this.banks()[0] ?? null;

    const bankAccountId = matchedBank ? matchedBank.id : 'BNK-UNASSIGNED';
    const bankName = matchedBank ? matchedBank.bankName : (receipt.parsed.detectedBank || 'Banco Sin Asignar');

    const totalFiat = Number.isFinite(receipt.parsed.amountFiat) ? Number(receipt.parsed.amountFiat) : 0;
    const replacementRate = this.liveReplacementRate();

    const cryptoAmountUsdt =
      totalFiat > 0 && replacementRate > 0
        ? Math.round((totalFiat / replacementRate) * 100) / 100
        : 0;
    const netProfitUsdt = 0;

    const now = Date.now();
    const newDeal: PipelineDeal = {
      id: `INB-${receipt.eventId.slice(-6)}`,
      scope: this.activeScope(),
      title: `Ingreso ${receipt.channel}: ${contactName}`,
      contactId,
      contactName,
      bankAccountId,
      bankName,
      stage: 'STAGE_1_NEW',
      fiatCurrency: (receipt.parsed.currency as FiatCurrency) || 'VES',
      cryptoAmountUsdt,
      appliedRate: replacementRate,
      replacementRate,
      totalFiatAmount: totalFiat,
      paidFiatAmount: 0,
      netProfitUsdt,
      bankReferenceId: ref,
      quoteTtlMinutes: 15,
      quotedAt: now,
      isRateExpired: false,
      timeline: [
        {
          timestamp: now,
          fromStage: null,
          toStage: 'STAGE_1_NEW',
          notes: `Comprobante entrante recibido automáticamente vía ${receipt.channel} [Remitente: ${receipt.sender.id}]`,
        },
      ],
      createdAt: now,
      closedAt: null,
    };

    const nextDeals = [newDeal, ...this.deals()];
    this.deals.set(nextDeals);
    this.storage.set(CRM_STORAGE_KEYS.DEALS, nextDeals);

    this.logActivity({
      type: 'DEAL_CREATED',
      description: `Comprobante ingresado vía ${receipt.channel} #${newDeal.id} para ${contactName}`,
      amountUsdt: newDeal.cryptoAmountUsdt,
      referenceId: ref,
    });

    this.toast.success(
      `⚡ Nuevo comprobante ingresado vía ${receipt.channel} (Ref: ${ref || 'S/R'}, Bs. ${totalFiat.toLocaleString('es-VE')})`,
      'Pipeline Operativo',
    );
  }

  moveDealToStage(dealId: string, targetStage: PipelineStage, targetRef?: string): void {
    const deal = this.deals().find((d) => d.id === dealId);
    if (!deal) return;

    const refToUse = targetRef !== undefined ? targetRef : deal.bankReferenceId;

    if (targetStage === 'STAGE_4_CLOSED' && !refToUse.trim()) {
      this.promptClosingDeal.set({
        deal,
        reference: '',
        isDuplicate: false,
      });
      return;
    }

    this.executeStageTransition(deal, targetStage, refToUse);
  }

  updateCloseDealRef(ref: string): void {
    const current = this.promptClosingDeal();
    if (!current) return;
    const coll = verifyReferenceCollision(this.deals(), ref, current.deal.id);
    this.promptClosingDeal.set({
      ...current,
      reference: ref,
      isDuplicate: coll.isDuplicate,
      collidingDealId: coll.existingDeal?.id,
    });
  }

  cancelCloseDealModal(): void {
    this.promptClosingDeal.set(null);
  }

  executeCloseDealModal(overrideDuplicate: boolean = false): void {
    const current = this.promptClosingDeal();
    if (!current) return;
    const ref = current.reference.trim();
    if (!ref) {
      this.toast.warn('Ingrese el comprobante o referencia para liquidar la operación.', 'Referencia Requerida');
      return;
    }

    if (current.isDuplicate && !overrideDuplicate) {
      this.toast.warn('Esta referencia ya fue utilizada. Confirme en el modal si desea forzar el cierre.', 'Referencia Duplicada');
      return;
    }

    const deal = current.deal;
    this.promptClosingDeal.set(null);
    this.executeStageTransition(deal, 'STAGE_4_CLOSED', ref);
  }

  private executeStageTransition(deal: PipelineDeal, targetStage: PipelineStage, targetRef: string): void {

    const now = Date.now();
    const transition = transitionDealStage(
      deal,
      targetStage,
      targetRef,
      now,
      this.liveReplacementRate(),
    );

    if (!transition.success) {
      this.toast.error('No se pudo mover el trato.', 'Error de Pipeline');
      return;
    }

    const updated = transition.updatedDeal;

    // 1. Update deals list
    const nextDeals = this.deals().map((d) => (d.id === deal.id ? updated : d));
    this.deals.set(nextDeals);
    this.storage.set(CRM_STORAGE_KEYS.DEALS, nextDeals);

    // 2. If moving to CLOSED_WON, impact bank balance and contact verified references
    if (targetStage === 'STAGE_4_CLOSED' && deal.stage !== 'STAGE_4_CLOSED') {
      const nextBanks = this.banks().map((b) =>
        b.id === deal.bankAccountId
          ? { ...b, currentBalanceFiat: Math.round((b.currentBalanceFiat + deal.totalFiatAmount) * 100) / 100 }
          : b,
      );
      this.banks.set(nextBanks);
      this.storage.set(CRM_STORAGE_KEYS.BANKS, nextBanks);

      // Add verified reference to contact
      const nextContacts = this.contacts().map((c) => {
        if (c.id === deal.contactId && targetRef) {
          const refs = c.verifiedReferences.includes(targetRef)
            ? c.verifiedReferences
            : [targetRef, ...c.verifiedReferences];
          return { ...c, verifiedReferences: refs };
        }
        return c;
      });
      this.contacts.set(nextContacts);
      this.storage.set(CRM_STORAGE_KEYS.CONTACTS, nextContacts);

      this.logActivity({
        type: 'DEAL_CLOSED',
        description: `Trato #${deal.id} liquidado (+${updated.netProfitUsdt} USDT PnL) en ${deal.bankName}`,
        amountUsdt: deal.cryptoAmountUsdt,
        referenceId: targetRef,
      });

      this.toast.success(
        `🎉 Trato #${deal.id} liquidado. +$${updated.netProfitUsdt.toFixed(2)} USDT sumados al Dashboard.`,
        'Trato Cerrado',
      );
    } else {
      this.logActivity({
        type: 'STAGE_MOVED',
        description: `Trato #${deal.id} avanzado a ${targetStage}`,
        amountUsdt: deal.cryptoAmountUsdt,
      });
      this.toast.info(`Trato #${deal.id} movido a "${targetStage}".`, 'Pipeline');
    }
  }

  closeConfirmModal(): void {
    this.confirmModal.set(null);
  }

  deleteDeal(dealId: string): void {
    const deal = this.deals().find((d) => d.id === dealId);
    if (!deal) return;

    this.confirmModal.set({
      title: 'Eliminar Trato',
      message: `¿Eliminar el trato #${deal.id} (${deal.cryptoAmountUsdt} USDT - ${deal.contactName})?`,
      confirmLabel: 'Eliminar Trato',
      isDestructive: true,
      onConfirm: () => {
        const nextDeals = this.deals().filter((d) => d.id !== dealId);
        this.deals.set(nextDeals);
        this.storage.set(CRM_STORAGE_KEYS.DEALS, nextDeals);
        this.toast.info(`Trato #${dealId} eliminado.`, 'Pipeline');
        this.confirmModal.set(null);
      },
    });
  }

  // Drag & drop handlers
  onDragStart(event: DragEvent, dealId: string): void {
    this.draggingDealId.set(dealId);
    if (event.dataTransfer) {
      event.dataTransfer.setData('text/plain', dealId);
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  onDrop(event: DragEvent, targetStage: PipelineStage): void {
    event.preventDefault();
    const dealId = this.draggingDealId();
    if (dealId) {
      this.moveDealToStage(dealId, targetStage);
      this.draggingDealId.set(null);
    }
  }

  // Keyboard and accessibility handlers for Kanban cards
  onCardKeyDown(event: KeyboardEvent, deal: PipelineDeal): void {
    const key = event.key;
    if (key === 'ArrowRight') {
      event.preventDefault();
      if (deal.stage === 'STAGE_1_NEW') {
        this.moveDealToStage(deal.id, 'STAGE_2_TRANSIT');
      } else if (deal.stage === 'STAGE_2_TRANSIT') {
        this.moveDealToStage(deal.id, 'STAGE_3_VERIFY');
      } else if (deal.stage === 'STAGE_3_VERIFY') {
        this.moveDealToStage(deal.id, 'STAGE_4_CLOSED');
      }
    } else if (key === 'ArrowLeft') {
      event.preventDefault();
      if (deal.stage === 'STAGE_3_VERIFY') {
        this.moveDealToStage(deal.id, 'STAGE_2_TRANSIT');
      } else if (deal.stage === 'STAGE_2_TRANSIT') {
        this.moveDealToStage(deal.id, 'STAGE_1_NEW');
      }
    } else if (key === '1') {
      event.preventDefault();
      this.moveDealToStage(deal.id, 'STAGE_1_NEW');
    } else if (key === '2') {
      event.preventDefault();
      this.moveDealToStage(deal.id, 'STAGE_2_TRANSIT');
    } else if (key === '3') {
      event.preventDefault();
      this.moveDealToStage(deal.id, 'STAGE_3_VERIFY');
    } else if (key === '4') {
      event.preventDefault();
      this.moveDealToStage(deal.id, 'STAGE_4_CLOSED');
    } else if (key === 'Enter' || key === 'l' || key === 'L') {
      event.preventDefault();
      this.moveDealToStage(deal.id, 'STAGE_4_CLOSED');
    } else if (key === 'Delete' || key === 'Backspace') {
      event.preventDefault();
      this.deleteDeal(deal.id);
    }
  }

  // ---------------------------------------------------------------------------
  // ACTIONS: CLIPBOARD & SMS AUTO-INTAKE
  // ---------------------------------------------------------------------------
  applyParsedClipboard(): void {
    const parsed = this.parsedClipboard();
    if (parsed.referenceId) {
      this.candidateRef.set(parsed.referenceId);
      this.dealReferenceId.set(parsed.referenceId);
    }
    if (parsed.amountFiat) {
      // Find matching bank if detected
      if (parsed.detectedBank) {
        const found = this.banks().find((b) =>
          b.bankName.toLowerCase().includes(parsed.detectedBank!.toLowerCase()),
        );
        if (found) {
          this.dealBankAccountId.set(found.id);
        }
      }
      this.toast.success(
        `Datos de ${parsed.detectedBank || 'banco'} detectados (Ref: ${parsed.referenceId || 'N/A'}, Monto: ${parsed.amountFiat}).`,
        'Parser Inteligente',
      );
    }
  }

  // ---------------------------------------------------------------------------
  // ACTIONS: CONTACTS CRM & RUNNING ACCOUNT
  // ---------------------------------------------------------------------------
  saveNewContact(): void {
    const name = this.newContactName().trim();
    if (!name) {
      this.toast.warn('Ingrese el nombre del contacto o cliente.', 'Campo Requerido');
      return;
    }

    const newContact: CrmContact = {
      id: `CLI-${Date.now().toString().slice(-6)}`,
      scope: this.activeScope(),
      name,
      documentId: this.newContactDocId().trim(),
      phoneOrContact: this.newContactPhone().trim(),
      category: this.newContactCategory(),
      paymentDetailsText: this.newContactPaymentDetails().trim(),
      creditLimitUsdt: this.newContactCreditLimit() ?? 5000,
      pendingBalanceUsdt: 0,
      maxPendingExposureUsdt: this.newContactMaxExposure() ?? 5000,
      isDebtIndexedToUsdt: true,
      verifiedReferences: [],
      createdAt: Date.now(),
    };

    const nextContacts = [...this.contacts(), newContact];
    this.contacts.set(nextContacts);
    this.storage.set(CRM_STORAGE_KEYS.CONTACTS, nextContacts);

    this.showAddContactModal.set(false);
    this.newContactName.set('');
    this.newContactDocId.set('');
    this.newContactPhone.set('');
    this.newContactPaymentDetails.set('');
    this.selectedContactId.set(newContact.id);
    this.toast.success(`Contacto "${newContact.name}" registrado en el CRM.`, 'Padrón CRM');
  }

  selectContact(contactId: string): void {
    this.selectedContactId.set(contactId);
  }

  adjustContactBalance(mode: 'POSITIVE' | 'NEGATIVE' | 'ZERO'): void {
    const contact = this.selectedContact();
    if (!contact) return;

    if (mode === 'ZERO') {
      this.confirmModal.set({
        title: 'Saldar Cuenta Corriente',
        message: `¿Saldar la cuenta corriente de ${contact.name} a $0.00 USDT?`,
        confirmLabel: 'Saldar a $0.00',
        isDestructive: false,
        onConfirm: () => {
          const nextContacts = this.contacts().map((c) =>
            c.id === contact.id ? { ...c, pendingBalanceUsdt: 0 } : c,
          );
          this.contacts.set(nextContacts);
          this.storage.set(CRM_STORAGE_KEYS.CONTACTS, nextContacts);
          this.logActivity({
            type: 'BALANCE_ADJUSTED',
            description: `Cuenta corriente de ${contact.name} saldada a $0.00`,
            amountUsdt: 0,
          });
          this.toast.success(`Cuenta de ${contact.name} saldada a $0.00.`, 'Cuenta Corriente');
          this.confirmModal.set(null);
        },
      });
      return;
    }

    const amount = this.contactBalanceAdjustAmount();
    if (!amount || amount <= 0) {
      this.toast.warn('Ingrese un monto válido a ajustar.', 'Monto Inválido');
      return;
    }

    const delta = mode === 'POSITIVE' ? amount : -amount;
    const newBal = Math.round((contact.pendingBalanceUsdt + delta) * 100) / 100;

    const nextContacts = this.contacts().map((c) =>
      c.id === contact.id ? { ...c, pendingBalanceUsdt: newBal } : c,
    );
    this.contacts.set(nextContacts);
    this.storage.set(CRM_STORAGE_KEYS.CONTACTS, nextContacts);
    this.contactBalanceAdjustAmount.set(null);

    this.logActivity({
      type: 'BALANCE_ADJUSTED',
      description: `Ajuste de saldo para ${contact.name}: ${delta >= 0 ? '+' : ''}${delta} USDT (Nuevo saldo: ${newBal} USDT)`,
      amountUsdt: amount,
    });

    this.toast.success(
      `Saldo de ${contact.name} actualizado a ${newBal.toFixed(2)} USDT.`,
      'Cuenta Corriente',
    );
  }

  copyWhatsAppReceipt(): void {
    const contact = this.selectedContact();
    if (!contact) return;

    const deals = this.selectedContactDeals();
    const statement = buildContactWhatsAppReceipt(contact, deals, true);

    void navigator.clipboard.writeText(statement);
    this.toast.success(
      `Estado de cuenta de ${contact.name} copiado al portapapeles.`,
      'WhatsApp CRM',
    );
  }

  copyText(text: string, label: string): void {
    if (!text) return;
    void navigator.clipboard.writeText(text);
    this.toast.info(`${label} copiado al portapapeles.`, '1-Click Copy');
  }

  copyBankHolderDetails(bankAccountId: string): void {
    const bank = this.banks().find((b) => b.id === bankAccountId);
    if (!bank || !bank.holderDetailsText) {
      this.toast.warn('Esta cuenta no tiene datos de titular detallados.', '1-Click Copy');
      return;
    }
    const bubbles = buildCopyableBankBubbles(bank);
    void navigator.clipboard.writeText(bubbles.formattedBlock);
    this.toast.success(
      `Datos de pago de ${bank.bankName} copiados al portapapeles.`,
      '1-Click Copy Bancario',
    );
  }

  // ---------------------------------------------------------------------------
  // ACTIONS: BANKS & RECONCILIATION
  // ---------------------------------------------------------------------------
  saveNewBank(): void {
    const name = this.newBankName().trim();
    if (!name) {
      this.toast.warn('Ingrese el nombre del banco o riel.', 'Campo Requerido');
      return;
    }

    const newBank: CrmBankAccount = {
      id: `BNK-${Date.now().toString().slice(-6)}`,
      scope: this.activeScope(),
      bankName: name,
      currency: this.newBankCurrency(),
      holderDetailsText: this.newBankHolderDetails().trim() || name,
      currentBalanceFiat: this.newBankInitialBalance() ?? 0,
      maxDailyCapFiat: this.newBankDailyCap() ?? 50000,
      feePct: this.newBankFeePct() ?? 0.3,
      maxBurstTxPer15Min: this.newBankBurstMax() ?? 5,
    };

    const nextBanks = [...this.banks(), newBank];
    this.banks.set(nextBanks);
    this.storage.set(CRM_STORAGE_KEYS.BANKS, nextBanks);

    this.showAddBankModal.set(false);
    this.newBankName.set('');
    this.newBankHolderDetails.set('');
    this.toast.success(`Cuenta bancaria "${newBank.bankName}" agregada.`, 'Escudo Bancario');
  }

  openReconciliation(bankId: string, currentBalance: number): void {
    this.reconcilingBankId.set(bankId);
    this.realBankBalanceInput.set(currentBalance);
  }

  applyBankReconciliation(bankId: string): void {
    const realBalance = this.realBankBalanceInput();
    if (realBalance === null) return;

    const bank = this.banks().find((b) => b.id === bankId);
    if (!bank) return;

    const adj = calculateBankReconciliationAdjustment(bank.currentBalanceFiat, realBalance);

    const nextBanks = this.banks().map((b) =>
      b.id === bankId ? { ...b, currentBalanceFiat: realBalance } : b,
    );
    this.banks.set(nextBanks);
    this.storage.set(CRM_STORAGE_KEYS.BANKS, nextBanks);
    this.reconcilingBankId.set(null);

    this.logActivity({
      type: 'BANK_RECONCILED',
      description: `Cuadre bancario en ${bank.bankName}: Ajuste de ${adj.formattedDrift} ${bank.currency} (Saldo real: ${realBalance})`,
      amountUsdt: 0,
    });

    this.toast.success(
      `Saldo de ${bank.bankName} ajustado a ${realBalance.toFixed(2)} ${bank.currency} (${adj.formattedDrift}).`,
      'Cuadre Bancario',
    );
  }

  deleteBank(bankId: string): void {
    const bank = this.banks().find((b) => b.id === bankId);
    if (!bank) return;

    this.confirmModal.set({
      title: 'Eliminar Cuenta Bancaria',
      message: `¿Eliminar la cuenta "${bank.bankName}"?`,
      confirmLabel: 'Eliminar Cuenta',
      isDestructive: true,
      onConfirm: () => {
        const nextBanks = this.banks().filter((b) => b.id !== bankId);
        this.banks.set(nextBanks);
        this.storage.set(CRM_STORAGE_KEYS.BANKS, nextBanks);
        this.toast.info(`Cuenta "${bank.bankName}" eliminada.`, 'Escudo Bancario');
        this.confirmModal.set(null);
      },
    });
  }

  // ---------------------------------------------------------------------------
  // ACTIONS: BACKUP & DATA EXPORT/IMPORT
  // ---------------------------------------------------------------------------
  // 8. OMNICHANNEL CRM & INVOICE STUDIO METHODS
  // ---------------------------------------------------------------------------
  saveConversations(): void {
    this.storage.set(CRM_STORAGE_KEYS.CONVERSATIONS, this.conversations());
  }

  saveInvoicesOrQuotes(): void {
    this.storage.set(CRM_STORAGE_KEYS.INVOICES_OR_QUOTES, this.invoicesOrQuotes());
  }

  updateOmnichannelConfig(field: keyof OmnichannelIntegrationConfig, val: any): void {
    const updated = {
      ...this.omnichannelConfig(),
      [field]: val,
    };
    this.omnichannelConfig.set(updated);
    this.storage.set(CRM_STORAGE_KEYS.OMNICHANNEL_CONFIG, updated);
  }

  selectConversation(id: string): void {
    this.selectedConversationId.set(id);
    const updated = this.conversations().map((c) =>
      c.id === id ? { ...c, unreadCount: 0 } : c,
    );
    this.conversations.set(updated);
    this.saveConversations();
  }

  openNewChatModal(): void {
    this.newChatChannel.set('WHATSAPP');
    this.newChatContactId.set('');
    this.newChatRecipient.set('');
    this.newChatName.set('');
    this.showNewChatModal.set(true);
  }

  onNewChatContactSelected(contactId: string): void {
    this.newChatContactId.set(contactId);
    const c = this.contacts().find((item) => item.id === contactId);
    if (c) {
      this.newChatName.set(c.name);
      this.newChatRecipient.set(c.phoneOrContact || '');
    }
  }

  createNewConversation(): void {
    const recipient = this.newChatRecipient().trim();
    if (!recipient) {
      this.toast.warn('Ingrese el número o handle del destinatario.', 'Nueva Conversación');
      return;
    }

    const name = this.newChatName().trim() || recipient;
    const newConv: OmnichannelConversation = {
      id: `conv-${Date.now()}`,
      scope: this.activeScope(),
      contactId: this.newChatContactId() || null,
      contactName: name,
      channel: this.newChatChannel(),
      recipientPhoneOrIgId: recipient,
      lastInboundTimestamp: Date.now(),
      unreadCount: 0,
      linkedDealId: null,
      messages: [
        {
          id: `msg-${Date.now()}`,
          conversationId: `conv-${Date.now()}`,
          channel: this.newChatChannel(),
          direction: 'INBOUND',
          senderHandle: recipient,
          text: 'Conversación iniciada con cliente.',
          timestamp: Date.now(),
        },
      ],
    };

    const next = [newConv, ...this.conversations()];
    this.conversations.set(next);
    this.saveConversations();
    this.selectedConversationId.set(newConv.id);
    this.showNewChatModal.set(false);
    this.toast.success(`Conversación creada con ${name}.`, 'Omnicanal');
  }

  sendChatMessage(): void {
    const text = this.chatDraftText().trim();
    const conv = this.activeConversation();
    if (!conv || !text) return;

    const newMsg: OmnichannelMessage = {
      id: `msg-${Date.now()}`,
      conversationId: conv.id,
      channel: conv.channel,
      direction: 'OUTBOUND',
      senderHandle: 'Operador CRM',
      text,
      timestamp: Date.now(),
    };

    this.appendMessageToConversation(conv.id, newMsg);
    this.chatDraftText.set('');
    this.toast.success('Mensaje despachado.', 'Chat Omnicanal');
  }

  simulateIncomingCustomerMessage(): void {
    const text = this.testInboundText().trim();
    const conv = this.activeConversation();
    if (!conv || !text) {
      this.toast.warn('Escriba un mensaje simulado primero.', 'Simulación IA');
      return;
    }

    const triage = classifyAndDraftAiResponse(
      text,
      this.deals(),
      this.activeScope(),
      this.omnichannelConfig(),
    );
    this.activeAiTriage.set(triage);

    const inboundMsg: OmnichannelMessage = {
      id: `msg-${Date.now()}`,
      conversationId: conv.id,
      channel: conv.channel,
      direction: 'INBOUND',
      senderHandle: conv.recipientPhoneOrIgId,
      text,
      timestamp: Date.now(),
      detectedIntent: triage.detectedIntent,
      extractedReferenceId: triage.extractedReferenceId,
      extractedAmount: triage.extractedAmount,
      aiConfidence: triage.confidence,
    };

    this.appendMessageToConversation(conv.id, inboundMsg);
    this.testInboundText.set('');

    const mode = this.omnichannelConfig().aiMode;
    if (mode === 'AUTOPILOT') {
      setTimeout(() => {
        const aiMsg: OmnichannelMessage = {
          id: `msg-${Date.now() + 1}`,
          conversationId: conv.id,
          channel: conv.channel,
          direction: 'OUTBOUND',
          senderHandle: 'IA Autopilot',
          text: triage.suggestedReplyText,
          timestamp: Date.now(),
        };
        this.appendMessageToConversation(conv.id, aiMsg);
        this.toast.info('Autopilot IA respondió automáticamente al cliente.', 'Autopilot');
      }, 500);
    } else {
      // COPILOT_DRAFT or MANUAL
      this.chatDraftText.set(triage.suggestedReplyText);
      this.toast.info(
        `Triaje IA: ${triage.detectedIntent} (${(triage.confidence * 100).toFixed(0)}% conf). Respuesta sugerida cargada en el borrador.`,
        'Copiloto IA',
      );
    }
  }

  applyTriageAction(): void {
    const triage = this.activeAiTriage();
    const conv = this.activeConversation();
    if (!triage || !conv) return;

    if (triage.recommendedKanbanAction === 'CREATE_P2P_DEAL' || triage.recommendedKanbanAction === 'CREATE_360_QUOTE_DEAL') {
      const is360 = triage.recommendedKanbanAction === 'CREATE_360_QUOTE_DEAL';
      const targetScope: WorkspaceScope = is360 ? 'FINANCE_360' : 'P2P_DESK';
      const contact = this.contacts().find((c) => c.id === conv.contactId);
      const contactName = contact ? contact.name : conv.contactName;
      const bank = this.banks().find((b) => b.scope === targetScope) ?? this.banks()[0] ?? { id: 'BNK-1', bankName: 'Banco Primario' };

      const amountUsdt = triage.extractedAmount || 100;
      const rate = this.liveReplacementRate();
      const now = Date.now();

      const newDeal: PipelineDeal = {
        id: `DEAL-${Date.now().toString().slice(-6)}`,
        scope: targetScope,
        title: is360 ? `Presupuesto Comercial: ${contactName}` : `Operación P2P: ${contactName}`,
        contactId: contact ? contact.id : 'CNT-DIRECT',
        contactName,
        bankAccountId: bank.id,
        bankName: bank.bankName,
        stage: 'STAGE_1_NEW',
        fiatCurrency: 'VES',
        cryptoAmountUsdt: amountUsdt,
        appliedRate: rate,
        replacementRate: rate,
        totalFiatAmount: Math.round(amountUsdt * rate * 100) / 100,
        paidFiatAmount: 0,
        netProfitUsdt: Math.round(amountUsdt * 0.02 * 100) / 100,
        bankReferenceId: triage.extractedReferenceId || '',
        quoteTtlMinutes: 15,
        quotedAt: now,
        isRateExpired: false,
        timeline: [
          {
            timestamp: now,
            fromStage: null,
            toStage: 'STAGE_1_NEW',
            notes: `Trato creado automáticamente por Triaje IA (${conv.channel})`,
          },
        ],
        createdAt: now,
        closedAt: null,
      };

      const updatedDeals = [newDeal, ...this.deals()];
      this.deals.set(updatedDeals);
      this.storage.set(CRM_STORAGE_KEYS.DEALS, updatedDeals);

      // Link to conversation
      const updatedConvs = this.conversations().map((c) =>
        c.id === conv.id ? { ...c, linkedDealId: newDeal.id } : c,
      );
      this.conversations.set(updatedConvs);
      this.saveConversations();

      this.toast.success(`Trato #${newDeal.id} creado en el Pipeline Kanban.`, 'Triaje IA');
      this.setView('KANBAN');
    } else if (triage.recommendedKanbanAction === 'ATTACH_PAYMENT_REF') {
      const ref = triage.extractedReferenceId;
      if (!ref) return;

      const dealToUpdate = this.deals().find(
        (d) => d.id === conv.linkedDealId || (conv.contactId && d.contactId === conv.contactId && d.stage !== 'STAGE_4_CLOSED'),
      );

      if (dealToUpdate) {
        this.moveDealToStage(dealToUpdate.id, 'STAGE_3_VERIFY', ref);
        this.toast.success(`Referencia ${ref} adjuntada al trato #${dealToUpdate.id}. Avanzado a Verificando.`, 'Referencia Bancaria');
      } else {
        this.toast.info(`Referencia ${ref} verificada. No se encontró trato abierto pendiente para este contacto.`, 'Referencia Registrada');
      }
    }

    this.activeAiTriage.set(null);
  }

  sendBankBubblesToChat(bankId: string): void {
    const bank = this.banks().find((b) => b.id === bankId);
    const conv = this.activeConversation();
    if (!bank || !conv) {
      this.toast.warn('Seleccione una cuenta bancaria válida.', 'Burbujas Bancarias');
      return;
    }

    const linkedDeal = this.deals().find((d) => d.id === conv.linkedDealId);
    const bubbles = buildCopyableBankBubbles(bank, linkedDeal?.totalFiatAmount);

    this.chatDraftText.set(bubbles.formattedBlock);

    try {
      navigator.clipboard.writeText(bubbles.formattedBlock);
      this.toast.success('Burbujas bancarias cargadas y copiadas al portapapeles.', 'Fácil Copiar');
    } catch {
      this.toast.success('Burbujas bancarias cargadas en el borrador.', 'Burbujas');
    }
  }

  insertDocTemplateIntoChat(docId: string): void {
    const doc = this.invoicesOrQuotes().find((d) => d.id === docId);
    if (!doc) return;

    const bank = this.banks().find((b) => b.id === this.studioBankAccountId()) ?? this.banks()[0];
    const text = formatDocumentForMessaging(doc, bank);
    this.chatDraftText.set(text);
    this.toast.success(`Documento #${doc.docNumber} insertado en el borrador.`, 'Documento');
  }

  openWhatsAppDirectForActiveChat(): void {
    const conv = this.activeConversation();
    if (!conv) return;
    const text = this.chatDraftText();
    const url = buildWhatsAppDirectUrl(conv.recipientPhoneOrIgId, text);
    window.open(url, '_blank');
  }

  evaluateConversationFreeWindow(conv: OmnichannelConversation): MetaFreeWindowEvaluation {
    return evaluateMeta24hFreeWindow(conv?.lastInboundTimestamp, this.clockTick());
  }

  copyFullDraftText(): void {
    const text = this.chatDraftText();
    if (!text) return;
    navigator.clipboard.writeText(text);
    this.toast.success('Texto copiado al portapapeles.', 'Copiado');
  }

  private appendMessageToConversation(convId: string, msg: OmnichannelMessage): void {
    const nextConvs = this.conversations().map((c) => {
      if (c.id !== convId) return c;
      const isIncoming = msg.direction === 'INBOUND';
      return {
        ...c,
        lastInboundTimestamp: isIncoming ? msg.timestamp : c.lastInboundTimestamp,
        unreadCount: isIncoming ? c.unreadCount + 1 : c.unreadCount,
        messages: [...c.messages, msg],
      };
    });
    this.conversations.set(nextConvs);
    this.saveConversations();
  }

  // ---------------------------------------------------------------------------
  // CLIPBOARD OCR IMAGE LISTENER (CTRL+V CAPTURE PASTE)
  // ---------------------------------------------------------------------------
  @HostListener('paste', ['$event'])
  onGlobalPaste(event: ClipboardEvent): void {
    if (this.activeView() !== 'OMNICHANNEL' || this.omnichannelSubTab() !== 'INBOX') return;
    const items = event.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          event.preventDefault();
          this.handlePastedImageFile(file);
          break;
        }
      }
    }
  }

  handlePastedImageFile(file: File): void {
    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target?.result as string;
      if (!base64) return;
      this.processReceiptOcr(base64);
    };
    reader.readAsDataURL(file);
  }

  async processReceiptOcr(base64: string): Promise<void> {
    const activeConv = this.activeConversation();
    if (!activeConv) {
      this.toast.warn('Seleccione una conversación para adjuntar la captura.', 'Bandeja');
      return;
    }

    const apiKey = this.omnichannelConfig().geminiApiKey?.trim();
    this.isAnalyzingOcr.set(true);

    let ocrResult: GeminiOcrParsedResult;

    if (apiKey) {
      this.toast.info('Analizando captura con Gemini Flash Multimodal...', 'OCR IA');
      try {
        const payload = buildGeminiMultimodalOcrPayload(base64);
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        ocrResult = parseGeminiOcrResponse(data);
      } catch (err) {
        console.warn('Gemini OCR API error:', err);
        ocrResult = {
          bank: null,
          reference: null,
          amount: null,
          currency: null,
          date: null,
          rawNotes: 'Error al contactar Gemini API.',
        };
      }
    } else {
      this.toast.info('Captura adjuntada. Ingrese su API Key gratuita de Gemini Flash en Ajustes para extracción OCR automática.', 'Comprobante');
      ocrResult = {
        bank: null,
        reference: null,
        amount: null,
        currency: null,
        date: null,
        rawNotes: 'Comprobante adjuntado vía portapapeles.',
      };
    }

    this.isAnalyzingOcr.set(false);
    this.ocrExtractedResult.set(ocrResult);

    const refText = ocrResult.reference ? ` | Ref: ${ocrResult.reference}` : '';
    const amountText = ocrResult.amount ? ` | Monto: ${ocrResult.amount} ${ocrResult.currency || ''}` : '';
    const newMsg: OmnichannelMessage = {
      id: `msg-${Date.now()}`,
      conversationId: activeConv.id,
      channel: activeConv.channel,
      direction: 'INBOUND',
      senderHandle: activeConv.recipientPhoneOrIgId,
      text: `[Comprobante de Pago]${refText}${amountText}`,
      timestamp: Date.now(),
      imageUrl: base64,
      detectedIntent: 'PAYMENT_PROOF',
      extractedReferenceId: ocrResult.reference || undefined,
      extractedAmount: ocrResult.amount || undefined,
    };

    this.appendMessageToConversation(activeConv.id, newMsg);

    if (ocrResult.reference) {
      const collision = verifyReferenceCollision(this.deals(), ocrResult.reference);
      if (collision.isDuplicate) {
        this.toast.error(
          `⚠️ ALERTA: La referencia ${ocrResult.reference} ya fue utilizada en el trato #${collision.existingDeal?.id}`,
          'Colisión de Referencia',
        );
      } else {
        this.toast.success(
          `Referencia ${ocrResult.reference} cotejada y válida. Lista para avanzar en Kanban.`,
          'Pago Válido',
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 9. NATIVE INVOICE, QUOTE & RECEIPT STUDIO
  // ---------------------------------------------------------------------------
  addStudioItem(): void {
    const newItem: BillingLineItem = {
      id: `item-${Date.now()}`,
      description: 'Nuevo Ítem Comercial',
      quantity: 1,
      unitPriceUsdt: 50,
      category: 'PRODUCT',
    };
    this.studioItems.set([...this.studioItems(), newItem]);
    setTimeout(() => this.renderVoucherCanvas(), 50);
  }

  removeStudioItem(itemId: string): void {
    const next = this.studioItems().filter((it) => it.id !== itemId);
    this.studioItems.set(next);
    setTimeout(() => this.renderVoucherCanvas(), 50);
  }

  updateStudioItem(index: number, field: keyof BillingLineItem, val: any): void {
    const items = [...this.studioItems()];
    if (!items[index]) return;
    items[index] = { ...items[index], [field]: val };
    this.studioItems.set(items);
    setTimeout(() => this.renderVoucherCanvas(), 50);
  }

  renderVoucherCanvas(): void {
    const canvas = document.getElementById('voucherCanvas') as HTMLCanvasElement | null;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = 800;
    const height = 980;
    canvas.width = width;
    canvas.height = height;

    // Background Dark Slate
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, width, height);

    // Border
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 4;
    ctx.strokeRect(8, 8, width - 16, height - 16);

    // Header Banner
    const grad = ctx.createLinearGradient(0, 0, width, 0);
    grad.addColorStop(0, '#1e293b');
    grad.addColorStop(1, '#0f172a');
    ctx.fillStyle = grad;
    ctx.fillRect(10, 10, width - 20, 140);

    // Brand Label
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText((this.omnichannelConfig().businessDisplayName || 'P2P QUANT TREASURY').toUpperCase(), 40, 55);

    // Subtitle
    ctx.fillStyle = '#94a3b8';
    ctx.font = '13px sans-serif';
    ctx.fillText('SISTEMA INTEGRADO DE LIQUIDACIÓN Y FACTURACIÓN COMERCIAL', 40, 80);

    // Document Title & Number
    const docTypeTitles: Record<CrmDocumentType, string> = {
      PRESUPUESTO_QUOTE: 'PRESUPUESTO / COTIZACIÓN',
      FACTURA_INVOICE: 'FACTURA COMERCIAL',
      COMPROBANTE_P2P: 'COMPROBANTE DE LIQUIDACIÓN P2P',
    };
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 26px sans-serif';
    ctx.fillText(docTypeTitles[this.studioDocType()] || 'COMPROBANTE', 40, 122);

    // Doc Number & Date
    const docNum = this.studioDocNumber() || `DOC-${Date.now().toString().slice(-6)}`;
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 18px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`Nº ${docNum}`, width - 40, 60);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '13px sans-serif';
    ctx.fillText(`Fecha: ${new Date().toLocaleDateString('es-ES')}`, width - 40, 85);
    ctx.fillText(`Ámbito: ${this.activeScope()}`, width - 40, 110);
    ctx.textAlign = 'left';

    // Divider
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(30, 160);
    ctx.lineTo(width - 30, 160);
    ctx.stroke();

    // Client Info Box
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(30, 175, width - 60, 90);

    const contact = this.contacts().find((c) => c.id === this.studioContactId());
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText('EMITIDO A NOMBRE DE:', 50, 202);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText(contact ? contact.name : 'Cliente Directo / Mostrador', 50, 230);

    ctx.fillStyle = '#cbd5e1';
    ctx.font = '14px monospace';
    ctx.fillText(`Doc: ${contact?.documentId || 'N/A'}  |  Tel: ${contact?.phoneOrContact || 'N/A'}`, 50, 252);

    // Table Header
    let y = 300;
    ctx.fillStyle = '#334155';
    ctx.fillRect(30, y, width - 60, 36);

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText('CANT', 45, y + 23);
    ctx.fillText('DESCRIPCIÓN', 120, y + 23);
    ctx.fillText('CATEGORÍA', 460, y + 23);
    ctx.textAlign = 'right';
    ctx.fillText('P. UNIT (USDT)', 650, y + 23);
    ctx.fillText('TOTAL (USDT)', width - 45, y + 23);
    ctx.textAlign = 'left';

    // Line Items
    y += 48;
    ctx.font = '14px sans-serif';
    for (const it of this.studioItems()) {
      ctx.fillStyle = '#f1f5f9';
      ctx.fillText(`${it.quantity}x`, 45, y);
      ctx.fillText(it.description || 'Ítem sin descripción', 120, y);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '12px monospace';
      ctx.fillText(it.category, 460, y);

      ctx.fillStyle = '#f1f5f9';
      ctx.font = '14px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`$${it.unitPriceUsdt.toFixed(2)}`, 650, y);
      ctx.fillText(`$${(it.quantity * it.unitPriceUsdt).toFixed(2)}`, width - 45, y);
      ctx.textAlign = 'left';

      y += 34;
      if (y > 560) break;
    }

    // Totals Box
    const totalsY = 620;
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(width - 380, totalsY, 350, 190);
    ctx.strokeStyle = '#38bdf8';
    ctx.strokeRect(width - 380, totalsY, 350, 190);

    const totals = this.studioTotals();
    let rowY = totalsY + 30;

    const drawRow = (label: string, val: string, isBig = false, color = '#f8fafc') => {
      ctx.fillStyle = '#94a3b8';
      ctx.font = isBig ? 'bold 15px sans-serif' : '13px sans-serif';
      ctx.fillText(label, width - 360, rowY);

      ctx.fillStyle = color;
      ctx.font = isBig ? 'bold 20px monospace' : 'bold 14px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(val, width - 50, rowY);
      ctx.textAlign = 'left';
      rowY += isBig ? 38 : 28;
    };

    drawRow('Subtotal:', `$${totals.subtotalUsdt.toFixed(2)} USDT`);
    if (totals.discountUsdt > 0) drawRow('Descuento:', `-$${totals.discountUsdt.toFixed(2)} USDT`, false, '#ef4444');
    if (totals.taxOrFeeUsdt > 0) drawRow(`Impuesto (${this.studioTaxPct()}%):`, `+$${totals.taxOrFeeUsdt.toFixed(2)} USDT`, false, '#f59e0b');
    drawRow('TOTAL A PAGAR:', `$${totals.totalUsdt.toFixed(2)} USDT`, true, '#10b981');
    drawRow(`TOTAL EN ${this.studioFiatCurrency()}:`, `${formatFiatNumber(totals.totalFiat)} ${this.studioFiatCurrency()}`, true, '#38bdf8');

    // Left info (Bank Instructions & Ref)
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText('INSTRUCCIONES / DETALLES DE PAGO:', 40, totalsY + 25);

    const bank = this.banks().find((b) => b.id === this.studioBankAccountId());
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '13px sans-serif';
    if (bank) {
      const bubbles = buildCopyableBankBubbles(bank, totals.totalFiat);
      ctx.fillText(`Banco: ${bank.bankName} (${bank.currency})`, 40, totalsY + 50);
      ctx.fillText(`Titular: ${bank.holderDetailsText.split('\n')[0] || ''}`, 40, totalsY + 75);
      ctx.font = '13px monospace';
      ctx.fillText(`Doc / RIF: ${bubbles.docIdBubble}`, 40, totalsY + 100);
      ctx.fillText(`Cuenta / Pago Móvil: ${bubbles.accountOrPhoneBubble}`, 40, totalsY + 125);
    } else {
      ctx.fillText(this.studioPaymentInstructions() || 'Pago acordado vía transferencia bancaria o Pago Móvil.', 40, totalsY + 55);
    }

    if (this.studioBankRefId()) {
      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 14px monospace';
      ctx.fillText(`REFERENCIA BANCARIA: ${this.studioBankRefId()}`, 40, totalsY + 160);
    }

    // Bottom Watermark
    ctx.fillStyle = '#475569';
    ctx.font = '11px sans-serif';
    ctx.fillText('Documento digital generado institucionalmente por P2P Quant Treasury CRM.', 40, height - 30);
    ctx.textAlign = 'right';
    ctx.fillText(`ID: ${docNum} | Verificación Criptográfica`, width - 40, height - 30);
    ctx.textAlign = 'left';
  }

  copyCanvasImageToClipboard(): void {
    const canvas = document.getElementById('voucherCanvas') as HTMLCanvasElement | null;
    if (!canvas) {
      this.toast.warn('Renderice el comprobante primero.', 'Studio');
      return;
    }
    canvas.toBlob((blob) => {
      if (!blob) {
        this.toast.error('No se pudo generar la imagen del comprobante.', 'Error');
        return;
      }
      try {
        navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(() => {
          this.toast.success('¡Comprobante copiado al portapapeles! Listo para pegar en WhatsApp o Instagram.', 'Copiado');
        }).catch(() => {
          this.downloadCanvasImage();
        });
      } catch {
        this.downloadCanvasImage();
      }
    });
  }

  downloadCanvasImage(): void {
    const canvas = document.getElementById('voucherCanvas') as HTMLCanvasElement | null;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    const docNum = this.studioDocNumber() || `DOC-${Date.now().toString().slice(-6)}`;
    a.download = `Comprobante-${docNum}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    this.toast.success('Comprobante descargado en PNG.', 'Descargado');
  }

  saveStudioDocument(createDeal: boolean = false): void {
    const contact = this.contacts().find((c) => c.id === this.studioContactId());
    const totals = this.studioTotals();
    const docNum = this.studioDocNumber() || `DOC-${Date.now().toString().slice(-6)}`;

    const newDoc: CrmBillingDocument = {
      id: `doc-${Date.now()}`,
      docNumber: docNum,
      scope: this.activeScope(),
      docType: this.studioDocType(),
      contactId: contact ? contact.id : 'CNT-DIRECT',
      contactName: contact ? contact.name : 'Cliente Directo',
      contactDocId: contact?.documentId || '',
      fiatCurrency: this.studioFiatCurrency(),
      exchangeRate: this.studioExchangeRate(),
      items: this.studioItems(),
      subtotalUsdt: totals.subtotalUsdt,
      discountUsdt: totals.discountUsdt,
      taxOrFeeUsdt: totals.taxOrFeeUsdt,
      totalUsdt: totals.totalUsdt,
      totalFiat: totals.totalFiat,
      paymentInstructionsText: this.studioPaymentInstructions(),
      bankReferenceId: this.studioBankRefId() || undefined,
      status: this.studioDocType() === 'COMPROBANTE_P2P' ? 'PAID' : 'DRAFT',
      createdAt: Date.now(),
    };

    const next = [newDoc, ...this.invoicesOrQuotes()];
    this.invoicesOrQuotes.set(next);
    this.saveInvoicesOrQuotes();
    this.toast.success(`Documento #${newDoc.docNumber} guardado en el estudio.`, 'Guardado');

    if (createDeal) {
      const bank = this.banks().find((b) => b.id === this.studioBankAccountId()) ?? this.banks()[0] ?? { id: 'BNK-1', bankName: 'Banco' };
      const now = Date.now();
      const newDeal: PipelineDeal = {
        id: `DEAL-${Date.now().toString().slice(-6)}`,
        scope: this.activeScope(),
        title: `${newDoc.docType === 'COMPROBANTE_P2P' ? 'Liquidación' : 'Cotización'}: ${newDoc.contactName}`,
        contactId: newDoc.contactId,
        contactName: newDoc.contactName,
        bankAccountId: bank.id,
        bankName: bank.bankName,
        stage: newDoc.docType === 'COMPROBANTE_P2P' ? 'STAGE_4_CLOSED' : 'STAGE_1_NEW',
        fiatCurrency: newDoc.fiatCurrency,
        cryptoAmountUsdt: newDoc.totalUsdt,
        appliedRate: newDoc.exchangeRate,
        replacementRate: newDoc.exchangeRate,
        totalFiatAmount: newDoc.totalFiat,
        paidFiatAmount: newDoc.docType === 'COMPROBANTE_P2P' ? newDoc.totalFiat : 0,
        netProfitUsdt: Math.round(newDoc.totalUsdt * 0.02 * 100) / 100,
        bankReferenceId: newDoc.bankReferenceId || '',
        quoteTtlMinutes: 15,
        quotedAt: now,
        isRateExpired: false,
        timeline: [
          {
            timestamp: now,
            fromStage: null,
            toStage: newDoc.docType === 'COMPROBANTE_P2P' ? 'STAGE_4_CLOSED' : 'STAGE_1_NEW',
            notes: `Generado desde Estudio de Facturación (${newDoc.docNumber})`,
          },
        ],
        createdAt: now,
        closedAt: newDoc.docType === 'COMPROBANTE_P2P' ? now : null,
      };

      const updatedDeals = [newDeal, ...this.deals()];
      this.deals.set(updatedDeals);
      this.storage.set(CRM_STORAGE_KEYS.DEALS, updatedDeals);
      this.toast.success(`Trato #${newDeal.id} generado en el tablero Kanban.`, 'Kanban');
      this.setView('KANBAN');
    }
  }

  sendStudioDocViaWhatsApp(): void {
    const contact = this.contacts().find((c) => c.id === this.studioContactId());
    const phone = contact?.phoneOrContact || '';
    if (!phone) {
      this.toast.warn('El contacto seleccionado no tiene número de teléfono registrado.', 'WhatsApp Direct');
      return;
    }

    const totals = this.studioTotals();
    const docNum = this.studioDocNumber() || `DOC-${Date.now().toString().slice(-6)}`;
    const doc: CrmBillingDocument = {
      id: `doc-${Date.now()}`,
      docNumber: docNum,
      scope: this.activeScope(),
      docType: this.studioDocType(),
      contactId: contact ? contact.id : 'CNT-DIRECT',
      contactName: contact ? contact.name : 'Cliente Directo',
      contactDocId: contact?.documentId || '',
      fiatCurrency: this.studioFiatCurrency(),
      exchangeRate: this.studioExchangeRate(),
      items: this.studioItems(),
      subtotalUsdt: totals.subtotalUsdt,
      discountUsdt: totals.discountUsdt,
      taxOrFeeUsdt: totals.taxOrFeeUsdt,
      totalUsdt: totals.totalUsdt,
      totalFiat: totals.totalFiat,
      paymentInstructionsText: this.studioPaymentInstructions(),
      bankReferenceId: this.studioBankRefId() || undefined,
      status: 'DRAFT',
      createdAt: Date.now(),
    };

    const bank = this.banks().find((b) => b.id === this.studioBankAccountId());
    const msg = formatDocumentForMessaging(doc, bank);
    const url = buildWhatsAppDirectUrl(phone, msg);
    window.open(url, '_blank');
  }

  deleteStudioDocument(docId: string): void {
    const next = this.invoicesOrQuotes().filter((d) => d.id !== docId);
    this.invoicesOrQuotes.set(next);
    this.saveInvoicesOrQuotes();
    this.toast.success('Documento eliminado del historial.', 'Eliminado');
  }

  loadStudioDocument(doc: CrmBillingDocument): void {
    this.studioDocType.set(doc.docType);
    this.studioContactId.set(doc.contactId);
    this.studioDocNumber.set(doc.docNumber);
    this.studioFiatCurrency.set(doc.fiatCurrency);
    this.studioExchangeRate.set(doc.exchangeRate);
    this.studioDiscountUsdt.set(doc.discountUsdt);
    this.studioTaxPct.set(0);
    this.studioPaymentInstructions.set(doc.paymentInstructionsText || '');
    this.studioBankRefId.set(doc.bankReferenceId || '');
    this.studioItems.set(doc.items || []);
    this.toast.info(`Documento #${doc.docNumber} cargado en el editor.`, 'Cargado');
    setTimeout(() => this.renderVoucherCanvas(), 50);
  }

  // ---------------------------------------------------------------------------
  // 10. CROSS-MODULE SHORTCUTS
  // ---------------------------------------------------------------------------
  openOmnichannelForDeal(deal: PipelineDeal): void {
    let conv = this.conversations().find(
      (c) => c.scope === deal.scope && (c.linkedDealId === deal.id || (c.contactId && c.contactId === deal.contactId)),
    );

    if (!conv) {
      const contact = this.contacts().find((c) => c.id === deal.contactId);
      const phone = contact?.phoneOrContact || '584140000000';
      conv = {
        id: `conv-${Date.now()}`,
        scope: deal.scope,
        contactId: deal.contactId,
        contactName: deal.contactName,
        channel: 'WHATSAPP',
        recipientPhoneOrIgId: phone,
        lastInboundTimestamp: Date.now(),
        unreadCount: 0,
        linkedDealId: deal.id,
        messages: [
          {
            id: `msg-${Date.now()}`,
            conversationId: `conv-${Date.now()}`,
            channel: 'WHATSAPP',
            direction: 'OUTBOUND',
            senderHandle: 'Operador CRM',
            text: `Hola ${deal.contactName}, nos comunicamos respecto a su operación #${deal.id} por $${deal.cryptoAmountUsdt.toFixed(2)} USDT (${deal.totalFiatAmount.toFixed(2)} ${deal.fiatCurrency}).`,
            timestamp: Date.now(),
          },
        ],
      };
      this.conversations.set([conv, ...this.conversations()]);
      this.saveConversations();
    }

    this.selectedConversationId.set(conv.id);
    this.chatDraftText.set(
      `Hola ${deal.contactName}, confirmamos su orden #${deal.id}: Monto: $${deal.cryptoAmountUsdt.toFixed(2)} USDT (${deal.totalFiatAmount.toFixed(2)} ${deal.fiatCurrency}).`,
    );
    this.omnichannelSubTab.set('INBOX');
    this.setView('OMNICHANNEL');
  }

  openOmnichannelForContact(contact?: CrmContact | null): void {
    if (!contact) return;
    let conv = this.conversations().find(
      (c) => c.scope === contact.scope && c.contactId === contact.id,
    );

    if (!conv) {
      conv = {
        id: `conv-${Date.now()}`,
        scope: contact.scope,
        contactId: contact.id,
        contactName: contact.name,
        channel: 'WHATSAPP',
        recipientPhoneOrIgId: contact.phoneOrContact || '584140000000',
        lastInboundTimestamp: Date.now(),
        unreadCount: 0,
        linkedDealId: null,
        messages: [
          {
            id: `msg-${Date.now()}`,
            conversationId: `conv-${Date.now()}`,
            channel: 'WHATSAPP',
            direction: 'INBOUND',
            senderHandle: contact.phoneOrContact || contact.name,
            text: `Expediente de contacto abierto en Omnicanal.`,
            timestamp: Date.now(),
          },
        ],
      };
      this.conversations.set([conv, ...this.conversations()]);
      this.saveConversations();
    }

    this.selectedConversationId.set(conv.id);
    this.omnichannelSubTab.set('INBOX');
    this.setView('OMNICHANNEL');
  }

  // ---------------------------------------------------------------------------
  // 11. DUAL-FORMAT EXPORT / IMPORT (JSON STATEFUL + CSV CATALOGS)
  // ---------------------------------------------------------------------------
  readonly importStrategy = signal<CrmImportStrategy>('MERGE');
  readonly csvCatalogTarget = signal<CrmCsvCatalogEntity>('CONTACTS');

  exportDataJson(): void {
    const backup = {
      version: '2.5',
      timestamp: Date.now(),
      scope: this.activeScope(),
      deals: this.deals(),
      contacts: this.contacts(),
      banks: this.banks(),
      activities: this.activities(),
      settlements: this.settlements(),
      conversations: this.conversations(),
      invoicesOrQuotes: this.invoicesOrQuotes(),
      omnichannelConfig: this.omnichannelConfig(),
    };

    const blob = new Blob([JSON.stringify(backup, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `p2p_crm_backup_${this.todayDateIso()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.toast.success('Copia de respaldo exportada con éxito.', 'Exportación JSON');
  }

  applyBackupJsonText(jsonText: string, strategy: CrmImportStrategy = this.importStrategy()): boolean {
    try {
      const raw = JSON.parse(jsonText);
      const report = validateAndSanitizeCrmBackupPayload(raw);

      if (!report.valid) {
        this.toast.error(report.errors[0] || 'Formato de archivo inválido.', 'Error de Importación');
        return false;
      }

      const { deals, contacts, banks, activities, settlements } = report.sanitizedPayload;

      const nextDeals = reconcileCrmCollectionById(this.deals(), deals, strategy, (d) => d.id);
      const nextContacts = reconcileCrmCollectionById(this.contacts(), contacts, strategy, (c) => c.id);
      const nextBanks = reconcileCrmCollectionById(this.banks(), banks, strategy, (b) => b.id);
      const nextActivities = reconcileCrmCollectionById(this.activities(), activities, strategy, (a) => a.id);
      const nextSettlements = reconcileCrmCollectionById(
        this.settlements(),
        settlements,
        strategy,
        (s) => s.settlementId,
      );

      this.deals.set(nextDeals);
      this.contacts.set(nextContacts);
      this.banks.set(nextBanks);
      this.activities.set(nextActivities);
      this.settlements.set(nextSettlements);

      this.storage.set(CRM_STORAGE_KEYS.DEALS, nextDeals);
      this.storage.set(CRM_STORAGE_KEYS.CONTACTS, nextContacts);
      this.storage.set(CRM_STORAGE_KEYS.BANKS, nextBanks);
      this.storage.set(CRM_STORAGE_KEYS.ACTIVITIES, nextActivities);
      this.storage.set(CRM_STORAGE_KEYS.SETTLEMENTS, nextSettlements);

      if (Array.isArray(raw['conversations'])) {
        const cleanConvs = safeHydrateCrmCollection<OmnichannelConversation>(raw['conversations']);
        const nextConvs = reconcileCrmCollectionById(this.conversations(), cleanConvs, strategy, (c) => c.id);
        this.conversations.set(nextConvs);
        this.storage.set(CRM_STORAGE_KEYS.CONVERSATIONS, nextConvs);
      }
      if (Array.isArray(raw['invoicesOrQuotes'])) {
        const cleanDocs = safeHydrateCrmCollection<CrmBillingDocument>(raw['invoicesOrQuotes']);
        const nextDocs = reconcileCrmCollectionById(this.invoicesOrQuotes(), cleanDocs, strategy, (d) => d.id);
        this.invoicesOrQuotes.set(nextDocs);
        this.storage.set(CRM_STORAGE_KEYS.INVOICES_OR_QUOTES, nextDocs);
      }
      if (raw['omnichannelConfig'] && typeof raw['omnichannelConfig'] === 'object') {
        this.omnichannelConfig.set(raw['omnichannelConfig']);
        this.storage.set(CRM_STORAGE_KEYS.OMNICHANNEL_CONFIG, raw['omnichannelConfig']);
      }

      if (report.quarantinedCount > 0) {
        this.toast.warn(
          `Base de datos procesada (${strategy}). Se omitieron ${report.quarantinedCount} registros corruptos o sin ámbito.`,
          'Importación con Advertencias',
        );
      } else {
        this.toast.success(
          `Base de datos procesada (${strategy}: ${nextDeals.length} tratos, ${nextContacts.length} contactos, ${nextBanks.length} bancos).`,
          'Importación Exitosa',
        );
      }
      return true;
    } catch {
      this.toast.error('No se pudo procesar el archivo JSON.', 'Error');
      return false;
    }
  }

  importDataJson(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = () => {
      this.applyBackupJsonText(String(reader.result ?? ''), this.importStrategy());
    };
    reader.readAsText(file);
  }

  exportCatalogCsv(entity: CrmCsvCatalogEntity = this.csvCatalogTarget()): void {
    const scope = this.activeScope();
    let csvContent = '';
    let prefix = 'crm_catalog';

    if (entity === 'CONTACTS') {
      csvContent = serializeContactsToCsv(this.contacts(), scope);
      prefix = `crm_contactos_${scope.toLowerCase()}`;
    } else if (entity === 'BANKS') {
      csvContent = serializeBanksToCsv(this.banks(), scope);
      prefix = `crm_bancos_${scope.toLowerCase()}`;
    } else {
      csvContent = serializeActivitiesToCsv(this.activities(), scope);
      prefix = `crm_actividades_${scope.toLowerCase()}`;
    }

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${prefix}_${this.todayDateIso()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    this.toast.success(`Catálogo CSV (${entity}) exportado para ${scope}.`, 'Exportación CSV');
  }

  applyCatalogCsvText(
    csvText: string,
    entity: CrmCsvCatalogEntity = this.csvCatalogTarget(),
    strategy: CrmImportStrategy = this.importStrategy(),
  ): boolean {
    const fallbackScope = this.activeScope();

    if (entity === 'CONTACTS') {
      const res = parseAndValidateContactsCsv(csvText, fallbackScope);
      if (!res.valid) {
        this.toast.error(res.errors[0] || 'CSV de contactos inválido.', 'Error CSV');
        return false;
      }
      const next = reconcileCrmCollectionById(this.contacts(), res.records, strategy, (c) => c.id);
      this.contacts.set(next);
      this.storage.set(CRM_STORAGE_KEYS.CONTACTS, next);
      this.notifyCsvImportResult('Contactos', res.records.length, res.quarantinedCount, strategy);
      return true;
    }

    if (entity === 'BANKS') {
      const res = parseAndValidateBanksCsv(csvText, fallbackScope);
      if (!res.valid) {
        this.toast.error(res.errors[0] || 'CSV de bancos inválido.', 'Error CSV');
        return false;
      }
      const next = reconcileCrmCollectionById(this.banks(), res.records, strategy, (b) => b.id);
      this.banks.set(next);
      this.storage.set(CRM_STORAGE_KEYS.BANKS, next);
      this.notifyCsvImportResult('Bancos', res.records.length, res.quarantinedCount, strategy);
      return true;
    }

    const res = parseAndValidateActivitiesCsv(csvText, fallbackScope);
    if (!res.valid) {
      this.toast.error(res.errors[0] || 'CSV de actividades inválido.', 'Error CSV');
      return false;
    }
    const next = reconcileCrmCollectionById(this.activities(), res.records, strategy, (a) => a.id);
    this.activities.set(next);
    this.storage.set(CRM_STORAGE_KEYS.ACTIVITIES, next);
    this.notifyCsvImportResult('Actividades', res.records.length, res.quarantinedCount, strategy);
    return true;
  }

  importCatalogCsv(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = () => {
      this.applyCatalogCsvText(
        String(reader.result ?? ''),
        this.csvCatalogTarget(),
        this.importStrategy(),
      );
    };
    reader.readAsText(file);
  }

  private notifyCsvImportResult(
    label: string,
    importedCount: number,
    quarantinedCount: number,
    strategy: CrmImportStrategy,
  ): void {
    if (quarantinedCount > 0) {
      this.toast.warn(
        `${label}: ${importedCount} registros procesados (${strategy}). Se omitieron ${quarantinedCount} filas corruptas.`,
        'Importación CSV con Advertencias',
      );
    } else {
      this.toast.success(
        `${label}: ${importedCount} registros procesados (${strategy}) correctamente.`,
        'Importación CSV Exitosa',
      );
    }
  }

  private logActivity(entry: Omit<ActivityLogEntry, 'id' | 'scope' | 'timestamp'>): void {
    const newEntry: ActivityLogEntry = {
      id: `ACT-${Date.now().toString().slice(-6)}`,
      scope: this.activeScope(),
      timestamp: Date.now(),
      ...entry,
    };
    const nextActivities = [newEntry, ...this.activities()].slice(0, 100);
    this.activities.set(nextActivities);
    this.storage.set(CRM_STORAGE_KEYS.ACTIVITIES, nextActivities);
  }

  // ---------------------------------------------------------------------------
  // 11. ARM MULTI-WORKSPACE COMMAND CENTER, HITL QUEUE, SANDBOX & CLOSER COPILOT
  // ---------------------------------------------------------------------------
  readonly activeArmSilo = signal<ArmWorkspaceId>('ARM_B2B');
  readonly armApprovalQueue = signal<ArmApprovalQueueItem[]>([]);
  readonly armAutonomousFeed = signal<ArmAutonomousFeedEvent[]>([]);
  readonly armShadowExamples = signal<ArmShadowExample[]>([]);
  readonly selectedSandboxPersona = signal<ArmSandboxPersonaId>('SKEPTICAL_DISCOUNT_30');
  readonly closerNoteLeadName = signal<string>('Clínica Aurora');
  readonly closerNoteTranscript = signal<string>('');
  readonly editingApprovalId = signal<string | null>(null);
  readonly editingApprovalText = signal<string>('');
  readonly editingSaveAsExample = signal<boolean>(true);
  readonly selectedArmLeadId = signal<string>('arm-lead-b2b-1');

  readonly armKanbanCards = signal<
    Array<{
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
      freeWindowLabel: string;
      messages: Array<{ sender: 'LEAD' | 'AGENT'; text: string; mediaBadge?: string }>;
      toolTraces: Array<{ toolName: string; latencyMs: number; status: string }>;
    }>
  >([
    {
      id: 'arm-lead-b2b-1',
      workspaceId: 'ARM_B2B',
      leadName: 'Dra. Elena Gómez',
      companyName: 'Clínica Aurora (18 Médicos)',
      stageSlug: 'calificado',
      qualificationScore: 88,
      painPointSummary: 'HubSpot actual es caro y manual; busca migrar en 30 días.',
      lastMessagePreview: '🎤 [Nota de Voz 0:47s]: "¿Qué descuento anual tienen para 18 médicos?"',
      assignedAgentRole: 'QUOTER',
      movedByAgentBadge: 'Movido por Agente SDR_QUALIFIER',
      dealValueLabel: '$2,400 USD / año',
      freeWindowLabel: 'FREE_0_USD • 18h 40m rest.',
      messages: [
        {
          sender: 'LEAD',
          text: 'Somos 18 especialistas en Clínica Aurora, buscamos migrar este mes si el plan anual cierra en presupuesto.',
          mediaBadge: '🎤 Nota de Voz 0:47s (Transcrita por Gemini Flash)',
        },
        {
          sender: 'AGENT',
          text: '¡Clarísimo Dra. Gómez! El Plan Enterprise anual cubre las 18 agendas médicas. Ya escalé el 15% de descuento corporativo a dirección comercial.',
        },
      ],
      toolTraces: [
        { toolName: 'route_conversation', latencyMs: 38, status: 'OK → SDR_QUALIFIER' },
        { toolName: 'update_lead_bant_and_profile', latencyMs: 112, status: 'OK → Score @p2p/core: 88/100' },
        { toolName: 'transition_pipeline_stage', latencyMs: 44, status: 'OK → en-descubrimiento → calificado' },
        { toolName: 'create_or_submit_quote', latencyMs: 165, status: 'BLOCKED_BY_RISK_GATE → approval_queue' },
      ],
    },
    {
      id: 'arm-lead-b2b-2',
      workspaceId: 'ARM_B2B',
      leadName: 'Dr. Ricardo Méndez',
      companyName: 'Grupo Médico Ávila',
      stageSlug: 'sesion-agendada',
      qualificationScore: 94,
      painPointSummary: 'Ausentismo del 28% en citas médicas por falta de confirmación WhatsApp.',
      lastMessagePreview: 'Confirmado mañana 10:00 AM (elena@grupoavila.com)',
      assignedAgentRole: 'SCHEDULER',
      movedByAgentBadge: 'Movido por Agente SCHEDULER',
      dealValueLabel: '$1,200 USD / año',
      freeWindowLabel: 'FREE_0_USD • 22h 15m rest.',
      messages: [
        { sender: 'LEAD', text: 'Me sirve mañana a las 10:00 AM, mi correo es rmendez@grupoavila.com' },
        { sender: 'AGENT', text: 'Reunión confirmada para mañana 10:00 AM. Ya envié el enlace y el briefing ejecutivo.' },
      ],
      toolTraces: [
        { toolName: 'check_calendar_slots', latencyMs: 85, status: 'OK → 2 horarios libres propuestos' },
        { toolName: 'book_appointment', latencyMs: 140, status: 'OK → Briefing Closer generado' },
      ],
    },
    {
      id: 'arm-lead-b2b-3',
      workspaceId: 'ARM_B2B',
      leadName: 'Lic. Valeria Torres',
      companyName: 'Lab BioSalud (12 Sedes)',
      stageSlug: 'en-descubrimiento',
      qualificationScore: 62,
      painPointSummary: 'Cotizaciones manuales en Excel demoran 48h en responderse.',
      lastMessagePreview: '📄 [PDF Adjunto]: Presupuesto actual de proveedor previo',
      assignedAgentRole: 'SDR_QUALIFIER',
      movedByAgentBadge: 'Movido por Agente ROUTER',
      dealValueLabel: '$1,200 USD / año',
      freeWindowLabel: 'FREE_0_USD • 14h 10m rest.',
      messages: [
        {
          sender: 'LEAD',
          text: 'Te paso el presupuesto que nos dieron hoy para ver si ustedes automatizan esto por WhatsApp.',
          mediaBadge: '📄 PDF Adjunto (Analizado por Vision)',
        },
      ],
      toolTraces: [
        { toolName: 'route_conversation', latencyMs: 31, status: 'OK → SDR_QUALIFIER' },
        { toolName: 'save_lead_memory_fact', latencyMs: 52, status: 'OK → PAIN_POINT guardado' },
      ],
    },
    {
      id: 'arm-lead-p2p-1',
      workspaceId: 'P2P_DESK',
      leadName: 'Carlos M. (VIP OTC)',
      companyName: 'Mesa Cambiaria Banesco',
      stageSlug: 'STAGE_3_VERIFY',
      qualificationScore: 95,
      painPointSummary: 'Liquidación inmediata lote 1,200 USDT vía Pago Móvil Banesco.',
      lastMessagePreview: '📷 [Captura Banesco Ref #8849201 • 45,000 VES]',
      assignedAgentRole: 'QUOTER',
      movedByAgentBadge: 'Movido por Agente P2P_OCR_SHIELD',
      dealValueLabel: '1,200 USDT',
      freeWindowLabel: 'TTL Tasa: 11m restantes',
      messages: [
        {
          sender: 'LEAD',
          text: '[Comprobante Banesco Ref #8849201 por 45,000.00 VES]',
          mediaBadge: '📷 Captura sin texto (Extraída por Gemini OCR)',
        },
        {
          sender: 'AGENT',
          text: 'Comprobante #8849201 recibido sin colisión. En espera de visto bueno de tesorería para liberar.',
        },
      ],
      toolTraces: [
        { toolName: 'verifyReferenceCollision', latencyMs: 14, status: 'OK → isDuplicate: false' },
        { toolName: 'transition_pipeline_stage', latencyMs: 49, status: 'BLOCKED_HITL → STAGE_4_CLOSED requiere humano' },
      ],
    },
    {
      id: 'arm-lead-360-1',
      workspaceId: 'FINANCE_360',
      leadName: 'Distribuidora Sol C.A.',
      companyName: 'PyME Mayorista',
      stageSlug: 'presupuestado-360',
      qualificationScore: 84,
      painPointSummary: 'Requiere esquema de pago fraccionado 50% anticipo / 50% a 30 días.',
      lastMessagePreview: '🎤 [Audio 0:28s]: "Si nos aprueban 50/50 cerramos hoy"',
      assignedAgentRole: 'QUOTER',
      movedByAgentBadge: 'Movido por Agente PYME_QUOTER',
      dealValueLabel: '$1,850 USD',
      freeWindowLabel: 'FREE_0_USD • 21h 00m rest.',
      messages: [
        {
          sender: 'LEAD',
          text: 'Vimos el presupuesto de $1,850 USD, ¿podemos pagar 50% hoy y 50% a 30 días?',
          mediaBadge: '🎤 Nota de Voz 0:28s',
        },
      ],
      toolTraces: [
        { toolName: 'get_catalog_items', latencyMs: 22, status: 'OK → SKU PYME-SERV-360' },
        { toolName: 'create_or_submit_quote', latencyMs: 98, status: 'QUEUED_HITL → Crédito 50/50' },
      ],
    },
  ]);

  readonly armExecutiveKpisForSilo = computed(() => {
    const silo = this.activeArmSilo();
    if (silo === 'P2P_DESK') {
      return [
        { label: 'Volumen En Tránsito', value: '14,850 USDT', sub: 'Cupo Banesco / Mercantil' },
        { label: 'Conversión Autónoma', value: '81.4%', sub: 'Triaje + 3-Burbujas' },
        { label: 'SLA Respuesta & OCR', value: '0.9s', sub: 'Gemini Vision + Regex' },
        { label: 'Colisiones Frenadas', value: '100% Seguro', sub: 'Regla Anti-Fraude Activa' },
      ];
    }
    if (silo === 'FINANCE_360') {
      return [
        { label: 'Pipeline Presupuestado', value: '$12,400 USD', sub: 'QuoteEngine Unificado' },
        { label: 'Conversión Autónoma', value: '72.0%', sub: 'Cotizador + Cobranza' },
        { label: 'SLA Respuesta IA', value: '1.5s', sub: 'WhatsApp & Instagram' },
        { label: 'Ingresos Facturados 360', value: '$8,950 USD', sub: 'Sincronizado Gavetas 50/30/20' },
      ];
    }
    return [
      { label: 'Valor Pipeline (MRR/ARR)', value: '$48,500 MRR', sub: '$582k ARR proyectado' },
      { label: 'Tasa Conversión Autónoma', value: '64.2%', sub: 'SDR BANT + Scheduler' },
      { label: 'SLA de Respuesta IA', value: '1.8s', sub: 'Debounce 3.0s Coalescing' },
      { label: 'Ingresos Cerrados', value: '$19,200 USD', sub: '14 cuentas corporativas' },
    ];
  });

  readonly armKanbanCardsForSilo = computed(() =>
    this.armKanbanCards().filter((c) => c.workspaceId === this.activeArmSilo()),
  );

  readonly selectedArmLeadSplitInspector = computed(() => {
    const cards = this.armKanbanCardsForSilo();
    return cards.find((c) => c.id === this.selectedArmLeadId()) ?? cards[0] ?? null;
  });

  readonly activeArmWorkspaceConfig = computed(() => ARM_WORKSPACES[this.activeArmSilo()]);
  readonly armStagesForSilo = computed<ArmPipelineStageConfig[]>(() =>
    getWorkspaceStages(this.activeArmSilo()),
  );
  readonly armAgentsForSilo = computed<ArmAgentDefinition[]>(() =>
    getWorkspaceAgents(this.activeArmSilo()),
  );
  readonly armApprovalQueueForSilo = computed<ArmApprovalQueueItem[]>(() =>
    this.armApprovalQueue().filter(
      (item) => item.workspaceId === this.activeArmSilo() && item.status === 'PENDING',
    ),
  );
  readonly armAutonomousFeedForSilo = computed<ArmAutonomousFeedEvent[]>(() =>
    this.armAutonomousFeed().filter((f) => f.workspaceId === this.activeArmSilo()),
  );
  readonly armShadowExamplesForSilo = computed<ArmShadowExample[]>(() =>
    selectFewShotExamplesForAgent(this.armShadowExamples(), this.activeArmSilo(), 'QUOTER', 10),
  );
  readonly armTokenCircuitBreakerForSilo = computed(() =>
    evaluateDealTokenCircuitBreaker({
      workspaceId: this.activeArmSilo(),
      dailyTokensUsed: 14_200,
      estimatedTurnTokens: 1_800,
    }),
  );
  readonly armReplayComparisonResult = signal<ArmReplayComparisonResult | null>(null);
  readonly armCloserPreCallBriefing = signal<ArmCloserPreCallBriefing | null>(null);

  setArmSilo(silo: ArmWorkspaceId): void {
    this.activeArmSilo.set(silo);
    if (silo === 'P2P_DESK' || silo === 'FINANCE_360') {
      this.activeScope.set(silo);
    }
    const firstCard = this.armKanbanCards().find((c) => c.workspaceId === silo);
    if (firstCard) {
      this.selectedArmLeadId.set(firstCard.id);
    }
    this.editingApprovalId.set(null);
  }

  selectArmLeadForInspector(cardId: string): void {
    this.selectedArmLeadId.set(cardId);
  }

  moveArmCardToStage(cardId: string, toStageSlug: string, actor: 'AGENT' | 'HUMAN' = 'HUMAN'): void {
    this.armKanbanCards.set(
      this.armKanbanCards().map((c) =>
        c.id === cardId
          ? {
              ...c,
              stageSlug: toStageSlug,
              movedByAgentBadge:
                actor === 'AGENT'
                  ? `Movido por Agente ${c.assignedAgentRole}`
                  : 'Movido por Humano (Override)',
            }
          : c,
      ),
    );
  }

  @HostListener('window:keydown', ['$event'])
  onArmCommandKeydown(event: KeyboardEvent): void {
    if (this.activeView() !== 'ARM_COMMAND') return;
    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable)
    ) {
      return;
    }

    const key = (event.key || '').toLowerCase();
    if (key === '1') {
      this.setArmSilo('ARM_B2B');
      return;
    }
    if (key === '2') {
      this.setArmSilo('P2P_DESK');
      return;
    }
    if (key === '3') {
      this.setArmSilo('FINANCE_360');
      return;
    }

    const firstPending = this.armApprovalQueueForSilo()[0];
    if (!firstPending) return;

    if (key === 'a') {
      this.approveArmQueueItem(firstPending.id);
    } else if (key === 'e') {
      this.startEditArmApproval(firstPending);
    } else if (key === 'h') {
      this.takeoverHumanFromArmQueue(firstPending.id);
    }
  }

  triggerArmSandboxTurn(personaOverride?: ArmSandboxPersonaId): void {
    const silo = this.activeArmSilo();
    const persona =
      personaOverride ??
      (silo === 'P2P_DESK'
        ? 'P2P_SPOOFED_RECEIPT'
        : silo === 'FINANCE_360'
          ? 'PYME_SPLIT_PAYMENT'
          : this.selectedSandboxPersona());

    const sim = runArmSandboxSimulationTurn({
      workspaceId: silo,
      personaId: persona,
    });

    const newEvents: ArmAutonomousFeedEvent[] = sim.toolTrace.map((t, idx) => ({
      id: `feed-${Date.now()}-${idx}`,
      workspaceId: silo,
      agentRole: t.agentRole,
      agentName: `${t.agentRole} (${silo})`,
      leadId: `sbx-${silo.toLowerCase()}`,
      leadName: sim.queuedApproval?.leadName || `[Sandbox] ${silo}`,
      toolName: t.toolName,
      summary: `${t.toolName} → ${t.outcome} (Movido: ${sim.fromStageSlug} → ${sim.toStageSlug})`,
      latencyMs: t.latencyMs,
      timestamp: Date.now(),
      isSandbox: true,
    }));

    this.armAutonomousFeed.set([...newEvents, ...this.armAutonomousFeed()].slice(0, 60));

    if (sim.queuedApproval) {
      this.armApprovalQueue.set([sim.queuedApproval, ...this.armApprovalQueue()]);
    }

    this.toast.info(
      `Simulación Sandbox (${silo}) ejecutada a $0 costo Meta API: ${sim.fromStageSlug} → ${sim.toStageSlug}`,
      'ARM Sandbox',
    );
  }

  startEditArmApproval(item: ArmApprovalQueueItem): void {
    this.editingApprovalId.set(item.id);
    const msg =
      (item.proposedPayload['proposedWhatsappMessage'] as string) ||
      (item.proposedPayload['previewText'] as string) ||
      JSON.stringify(item.proposedPayload);
    this.editingApprovalText.set(msg);
    this.editingSaveAsExample.set(true);
  }

  approveArmQueueItem(id: string, editedText?: string, saveAsExample = false): void {
    const target = this.armApprovalQueue().find((a) => a.id === id);
    if (!target) return;

    const proposedMsg =
      (target.proposedPayload['proposedWhatsappMessage'] as string) ||
      (target.proposedPayload['previewText'] as string) ||
      target.title;
    const finalMsg = editedText && editedText.trim().length > 0 ? editedText.trim() : proposedMsg;

    if (saveAsExample && finalMsg !== proposedMsg) {
      const updatedExamples = recordShadowLearningCorrection(this.armShadowExamples(), {
        workspaceId: target.workspaceId,
        agentRole: target.requestedByRole,
        actionType: target.actionType,
        proposedText: proposedMsg,
        approvedText: finalMsg,
        saveAsExample: true,
      });
      this.armShadowExamples.set(updatedExamples);
    }

    this.armApprovalQueue.set(
      this.armApprovalQueue().map((a) =>
        a.id === id
          ? {
              ...a,
              status: finalMsg !== proposedMsg ? 'EDITED_AND_APPROVED' : 'APPROVED',
              finalApprovedPayload: { ...a.proposedPayload, approvedMessage: finalMsg },
              saveAsExample,
            }
          : a,
      ),
    );

    const feedEvt: ArmAutonomousFeedEvent = {
      id: `feed-app-${Date.now()}`,
      workspaceId: target.workspaceId,
      agentRole: target.requestedByRole,
      agentName: `${target.requestedByRole} [HITL OK]`,
      leadId: target.leadId,
      leadName: target.leadName,
      toolName: target.toolName,
      summary: `Aprobado por Humano: ${target.title}`,
      latencyMs: 15,
      timestamp: Date.now(),
    };
    this.armAutonomousFeed.set([feedEvt, ...this.armAutonomousFeed()]);
    this.editingApprovalId.set(null);
    this.toast.success(`Acción aprobada y despachada en ${target.workspaceId}.`, 'HITL Aprobado');
  }

  takeoverHumanFromArmQueue(id: string): void {
    const target = this.armApprovalQueue().find((a) => a.id === id);
    if (!target) return;

    this.armApprovalQueue.set(
      this.armApprovalQueue().map((a) => (a.id === id ? { ...a, status: 'REJECTED' } : a)),
    );
    this.toast.warn(
      `Control humano activado para ${target.leadName} (${target.workspaceId}). Agentes en pausa.`,
      'Human Takeover',
    );
  }

  submitCloserVoiceNoteForArm(): void {
    const transcript = this.closerNoteTranscript().trim();
    if (!transcript) {
      this.toast.warn('Ingresá o dictá la nota post-llamada de 30s del closer.', 'Closer Copilot');
      return;
    }

    const silo = this.activeArmSilo();
    const defaultSku =
      getWorkspaceCatalog(silo)[0]?.sku ||
      (silo === 'ARM_B2B' ? 'PLAN-ENTERPRISE' : 'PYME-SERV-360');

    const res = processCloserPostCallNote({
      workspaceId: silo,
      leadId: `closer-lead-${Date.now()}`,
      leadName: this.closerNoteLeadName().trim() || 'Prospecto Closer',
      voiceNoteTranscript: transcript,
      sku: defaultSku,
    });

    this.armApprovalQueue.set([res.approvalEntry, ...this.armApprovalQueue()]);
    this.armAutonomousFeed.set([
      {
        id: `feed-closer-${Date.now()}`,
        workspaceId: silo,
        agentRole: 'QUOTER',
        agentName: 'Closer Copilot AI',
        leadId: res.approvalEntry.leadId,
        leadName: res.approvalEntry.leadName,
        toolName: 'processCloserPostCallNote',
        summary: `${res.executiveNotes} → Etapa sugerida: ${res.recommendedStageSlug}`,
        latencyMs: 92,
        timestamp: Date.now(),
      },
      ...this.armAutonomousFeed(),
    ]);
    this.closerNoteTranscript.set('');
    this.toast.success('Nota post-llamada procesada y propuesta enviada a Approval Queue.', 'Closer Copilot');
  }

  triggerAntiGhostingScanForSilo(): void {
    const silo = this.activeArmSilo();
    const now = Date.now();
    const ghostRes = evaluateGhostingFollowUp({
      workspaceId: silo,
      leadId: `ghost-${silo.toLowerCase()}`,
      leadName: silo === 'ARM_B2B' ? 'Dr. Méndez (Clínica Norte)' : 'Cliente Inactivo 72h',
      lastInboundTimestampMs: now - 72 * 3600 * 1000,
      nowTimestampMs: now,
      followupAttempts: 1,
      painPointMemory:
        silo === 'ARM_B2B'
          ? 'automatizar agenda y reducir ausentismo de pacientes'
          : 'liquidación rápida sin fricción bancaria',
    });

    if (ghostRes.shouldQueueFollowUp && ghostRes.approvalEntry) {
      this.armApprovalQueue.set([ghostRes.approvalEntry, ...this.armApprovalQueue()]);
      this.toast.info('Detectado prospecto sin respuesta (72h). Plantilla HSM encolada.', 'Anti-Ghosting');
    }
  }

  triggerArmDeterministicReplayDryRun(): void {
    const silo = this.activeArmSilo();
    const selected = this.selectedArmLeadSplitInspector();
    const res = runArmDeterministicReplayComparison({
      workspaceId: silo,
      leadName: selected ? `${selected.leadName} (${selected.companyName})` : `Prospecto ${silo}`,
      historicalInboundText:
        selected?.lastMessagePreview || '¿Qué descuento me dan en el Plan Enterprise si cerramos hoy?',
      shadowStore: this.armShadowExamples(),
      agentRole: 'QUOTER',
    });
    this.armReplayComparisonResult.set(res);
    this.toast.info(res.diffSummary, 'Replay Determinista A/B ($0)');
  }

  triggerCloserPreCallBriefingForSilo(): void {
    const silo = this.activeArmSilo();
    const selected = this.selectedArmLeadSplitInspector();
    const briefing = generateCloserPreCallBriefing({
      workspaceId: silo,
      leadName: selected?.leadName || 'Dra. Elena Gómez',
      companyName: selected?.companyName || 'Clínica Aurora',
      startsInMinutes: 15,
      qualificationScore: selected?.qualificationScore ?? 92,
      bantData: {
        budget: selected?.dealValueLabel || '$2,400 USD anuales',
        authority: 'Decisor Principal Confirmado',
        need_pain_point: selected?.painPointSummary || 'Automatización omnicanal con IA',
        timeline: 'Esta misma semana',
      },
      memoryFacts: [
        selected?.painPointSummary || 'Solicitó esquema de pago 50/50 o descuento corporativo',
      ],
      estimatedDealValue: silo === 'ARM_B2B' ? 2400 : silo === 'FINANCE_360' ? 1850 : 1200,
    });
    this.armCloserPreCallBriefing.set(briefing);
    this.toast.success(
      `Briefing 15m pre-llamada generado para ${briefing.companyName}.`,
      'Closer Copilot',
    );
  }

  private handleIncomingArmOutboxEvent(evt: ArmOutboxSseEvent): void {
    if (evt.eventType === 'approval_requested' && evt.payload['approval']) {
      const approval = evt.payload['approval'] as ArmApprovalQueueItem;
      const exists = this.armApprovalQueue().some((a) => a.id === approval.id);
      if (!exists) {
        this.armApprovalQueue.set([approval, ...this.armApprovalQueue()]);
      }
    }
    if (evt.eventType === 'pipeline_transition') {
      const feedEvt: ArmAutonomousFeedEvent = {
        id: `sse-${evt.id}`,
        workspaceId: evt.workspaceId,
        agentRole: 'SDR_QUALIFIER',
        agentName: `SSE Outbox #${evt.id}`,
        leadId: evt.aggregateId,
        leadName: evt.aggregateId,
        toolName: 'transition_pipeline_stage',
        summary: `Transición SSE: ${evt.payload['fromStageSlug']} → ${evt.payload['toStageSlug']}`,
        latencyMs: 25,
        timestamp: evt.timestamp,
      };
      this.armAutonomousFeed.set([feedEvt, ...this.armAutonomousFeed()].slice(0, 60));
    }
  }
}

