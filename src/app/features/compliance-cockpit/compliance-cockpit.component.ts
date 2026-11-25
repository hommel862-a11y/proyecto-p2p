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
import { P2PRadarService } from '../../core/p2p-radar.service';
import { HotkeysService } from '../../core/hotkeys.service';
import { todayVetIso } from '../../core/models/finance-360.models';
import { CrmCommandHeaderComponent } from './components/crm-command-header/crm-command-header.component';
import { CrmOverviewComponent } from './components/crm-overview/crm-overview.component';
import {
  CrmPipelineComponent,
  type CrmPipelineMode,
  type PipelineKanbanColumnInput,
} from './components/crm-pipeline/crm-pipeline.component';
import {
  CrmInboxStudioComponent,
  type ExportPngMode,
  type InboxStudioState,
  type SendMessageCommand,
} from './components/crm-inbox-studio/crm-inbox-studio.component';
import {
  CrmContactsRailsComponent,
  type AdjustBalancePayload,
  type ContactsRailsSubMode,
  type ReconcileBankPayload,
} from './components/crm-contacts-rails/crm-contacts-rails.component';
import {
  CrmAuditSystemComponent,
  type ParsedSmsPreview,
  type RefVerifyResult,
} from './components/crm-audit-system/crm-audit-system.component';
import type {
  ArmKanbanCardVm,
  CrmCashflowColumn,
  CrmDealsStatusRow,
  CrmHealthRecommendation,
  CrmHeroKpiCard,
  CrmOverviewPeriod,
  CrmPrimaryNavId,
  CrmSiloExecutiveKpi,
  CrmStorageHealthTelemetry,
  CrmVelocityBarItem,
} from './crm-ui.models';
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
  migrateLocalCrmDealsToArmCards,
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
  type OmnichannelMessage,
  type OmnichannelConversation,
  type MetaFreeWindowEvaluation,
  type AiTriageResult,
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

interface ElectronArmLeadDto {
  id: string;
  workspaceId: ArmWorkspaceId;
  fullName: string | null;
  companyName: string | null;
  currentStageSlug: string;
  assignedAgentRole: string | null;
  qualificationScore: number;
  bantData?: {
    need_pain_point?: string | null;
  };
  aiExecutiveSummary: string | null;
  estimatedDealValue: number;
  currency: string;
}

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
  imports: [
    CommonModule,
    FormsModule,
    CrmCommandHeaderComponent,
    CrmOverviewComponent,
    CrmPipelineComponent,
    CrmInboxStudioComponent,
    CrmContactsRailsComponent,
    CrmAuditSystemComponent,
  ],
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
  private readonly radarService = inject(P2PRadarService, { optional: true });
  private readonly hotkeys = inject(HotkeysService, { optional: true });

  private gatewaySubscription: Subscription | null = null;
  private armEventSubscription: Subscription | null = null;
  private connectedSubscription: Subscription | null = null;
  private radarDealSubscription: Subscription | null = null;
  private unregisterScopedPalette: (() => void) | null = null;

  constructor() {
    this.hydrateArmPersistenceState();
    if (this.radarService?.crmDealDispatched$) {
      this.radarDealSubscription = this.radarService.crmDealDispatched$.subscribe(() => {
        this.deals.set(
          safeHydrateCrmCollection<PipelineDeal>(this.storage.get(CRM_STORAGE_KEYS.DEALS)),
        );
      });
    }
    this.unregisterScopedPalette =
      this.hotkeys?.registerScopedPalette(
        () => this.showArmCommandPalette.update((v) => !v),
        () => {
          if (this.showArmCommandPalette()) {
            this.showArmCommandPalette.set(false);
            return true;
          }
          return false;
        },
      ) ?? null;
    this.gatewaySubscription = this.inboundGateway.receipt$.subscribe((receipt) => {
      this.handleInboundReceipt(receipt);
    });
    if (this.inboundGateway.armEvent$) {
      this.armEventSubscription = this.inboundGateway.armEvent$.subscribe((evt: ArmOutboxSseEvent) => {
        this.handleIncomingArmOutboxEvent(evt);
      });
    }
    if (this.inboundGateway.connected$) {
      this.connectedSubscription = this.inboundGateway.connected$.subscribe(() => {
        void this.hydrateWhatsAppHistoryFromGateway();
      });
    }
    if (typeof window !== 'undefined' && this.inboundGateway.status() === 'CONNECTED') {
      void this.inboundGateway.fetchStorageHealth?.();
      void this.hydrateWhatsAppHistoryFromGateway();
    }
  }

  ngOnDestroy(): void {
    this.gatewaySubscription?.unsubscribe();
    this.armEventSubscription?.unsubscribe();
    this.connectedSubscription?.unsubscribe();
    this.radarDealSubscription?.unsubscribe();
    this.unregisterScopedPalette?.();
    this.unregisterScopedPalette = null;
  }

  readonly showGatewayConfigModal = signal<boolean>(false);
  readonly gatewayUrlInput = signal<string>(this.inboundGateway.getGatewayUrl());
  readonly gatewayAuthTokenInput = signal<string>(this.inboundGateway.getAuthToken?.() ?? '');
  readonly metaPhoneNumberIdInput = signal<string>('');
  readonly metaWhatsappPhoneInput = signal<string>('');
  readonly metaIgAccountIdInput = signal<string>('');
  readonly metaFbPageIdInput = signal<string>('');
  readonly metaAccessTokenInput = signal<string>('');
  readonly metaAppSecretInput = signal<string>('');
  readonly metaVerifyTokenInput = signal<string>('p2p-verify-secret');
  readonly metaConfigStatus = signal<'LIVE_META_GRAPH' | 'DRY_RUN_NO_META_CREDENTIALS'>('DRY_RUN_NO_META_CREDENTIALS');
  readonly waQrStatus = computed(() => this.inboundGateway.waQrStatus?.() ?? null);
  readonly waQrBusy = signal<boolean>(false);
  readonly gatewayTesting = signal<boolean>(false);
  readonly gatewayTestResult = signal<{ ok: boolean; message: string } | null>(null);

  onGatewayPillClick(): void {
    this.gatewayUrlInput.set(this.inboundGateway.getGatewayUrl());
    this.gatewayAuthTokenInput.set(this.inboundGateway.getAuthToken?.() ?? '');
    this.gatewayTestResult.set(null);
    void this.loadMetaConfigFromGateway();
    void this.inboundGateway.fetchWhatsAppQrStatus?.(this.gatewayUrlInput().trim());

    if (this.inboundGateway.status() === 'CONNECTED') {
      this.toast.info(
        `Inbound Gateway activo en ${this.inboundGateway.getGatewayUrl()}. Podés editar o verificar la conexión.`,
        'Gateway Conectado'
      );
    }
    this.showGatewayConfigModal.set(true);
  }

  async connectWhatsAppQr(): Promise<void> {
    if (typeof this.inboundGateway.connectWhatsAppQr !== 'function') return;
    this.waQrBusy.set(true);
    const targetUrl = this.gatewayUrlInput().trim();
    const res = await this.inboundGateway.connectWhatsAppQr(targetUrl);
    this.waQrBusy.set(false);
    if (!res) {
      this.toast.warn(
        'No se pudo iniciar el puente WhatsApp QR. Verificá que el Gateway esté activo.',
        'WhatsApp QR',
      );
      return;
    }
    if (res.status === 'CONNECTED') {
      this.toast.success(
        `WhatsApp conectado (${res.connectedPhone || 'Dispositivo vinculado'}).`,
        'WhatsApp QR',
      );
    } else if (res.status === 'QR_READY') {
      this.toast.info(
        'Escaneá el código QR desde WhatsApp Business → Dispositivos vinculados.',
        'QR Listo',
      );
    }
  }

  async disconnectWhatsAppQr(clearSession = false): Promise<void> {
    if (typeof this.inboundGateway.disconnectWhatsAppQr !== 'function') return;
    this.waQrBusy.set(true);
    const targetUrl = this.gatewayUrlInput().trim();
    await this.inboundGateway.disconnectWhatsAppQr(clearSession, targetUrl);
    this.waQrBusy.set(false);
    this.toast.info(
      clearSession ? 'Sesión WhatsApp QR eliminada.' : 'WhatsApp QR desconectado.',
      'WhatsApp QR',
    );
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
      void this.inboundGateway.fetchStorageHealth?.(targetUrl);
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
    this.inboundGateway.setAuthToken?.(this.gatewayAuthTokenInput().trim());
    this.inboundGateway.setGatewayUrl(targetUrl);
    void this.inboundGateway.fetchStorageHealth?.(targetUrl);
    void this.persistMetaConfigToGateway(targetUrl);
    this.showGatewayConfigModal.set(false);
    this.toast.success(`Guardada configuración del Gateway y Meta Cloud API (${targetUrl})`, 'Gateway Configurado');
  }

  private async loadMetaConfigFromGateway(): Promise<void> {
    const cfg = await this.inboundGateway.fetchMetaConfig?.(this.gatewayUrlInput().trim());
    if (!cfg) return;
    this.metaPhoneNumberIdInput.set(cfg.phoneNumberId || '');
    this.metaWhatsappPhoneInput.set(cfg.whatsappDisplayPhone || '');
    this.metaIgAccountIdInput.set(cfg.igBusinessAccountId || '');
    this.metaFbPageIdInput.set(cfg.fbPageId || '');
    this.metaVerifyTokenInput.set(cfg.verifyToken || 'p2p-verify-secret');
    this.metaConfigStatus.set(cfg.mode);
  }

  private async persistMetaConfigToGateway(targetUrl: string): Promise<void> {
    if (typeof this.inboundGateway.saveMetaConfig !== 'function') return;
    const saved = await this.inboundGateway.saveMetaConfig(
      {
        phoneNumberId: this.metaPhoneNumberIdInput().trim(),
        whatsappDisplayPhone: this.metaWhatsappPhoneInput().trim(),
        igBusinessAccountId: this.metaIgAccountIdInput().trim(),
        fbPageId: this.metaFbPageIdInput().trim(),
        verifyToken: this.metaVerifyTokenInput().trim() || 'p2p-verify-secret',
        ...(this.metaAccessTokenInput().trim() ? { accessToken: this.metaAccessTokenInput().trim() } : {}),
        ...(this.metaAppSecretInput().trim() ? { appSecret: this.metaAppSecretInput().trim() } : {}),
      },
      targetUrl,
    );
    if (saved) {
      this.metaConfigStatus.set(saved.mode);
      this.metaAccessTokenInput.set('');
      this.metaAppSecretInput.set('');
    }
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
      if (c.scope !== scope && c.channel !== 'WHATSAPP') return false;
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
  // ---------------------------------------------------------------------------
  // ACTIONS: SCOPE, UNIFIED 5-PILL NAVIGATION & SUBCOMPONENT VIEWMODELS
  // ---------------------------------------------------------------------------
  readonly contactsRailsSubMode = signal<ContactsRailsSubMode>('CONTACTS');
  readonly overviewPeriod = signal<CrmOverviewPeriod>('TODAY');
  readonly preferredPipelineMode = signal<CrmPipelineMode>('LEGACY_BOARD');
  readonly aiStrategistInsight = signal<string | null>(null);
  readonly gatewayRefVerifyState = signal<{ ref: string; result: RefVerifyResult } | null>(null);

  readonly primaryNav = computed<CrmPrimaryNavId>(() => {
    switch (this.activeView()) {
      case 'DASHBOARD':
        return 'OVERVIEW';
      case 'KANBAN':
      case 'ARM_COMMAND':
        return 'PIPELINE';
      case 'OMNICHANNEL':
        return 'INBOX_STUDIO';
      case 'CONTACTS':
      case 'BANKS':
        return 'CONTACTS_RAILS';
      case 'ACTIVITIES':
      case 'SETTINGS':
      default:
        return 'AUDIT_SYSTEM';
    }
  });

  readonly pipelineViewMode = computed<CrmPipelineMode>(() =>
    this.activeView() === 'ARM_COMMAND' ? 'ARM_AUTOPILOT' : 'LEGACY_BOARD',
  );

  readonly pipelineKanbanColumns = computed<PipelineKanbanColumnInput[]>(() =>
    this.filteredKanbanColumnsList().map((col) => ({
      stage: col.stage,
      label: col.label,
      deals: col.deals,
      totalVolumeUsdt: col.totalUsdt,
    })),
  );

  readonly activeConvFreeWindowLabel = computed<string>(() => {
    const fw = this.activeConvFreeWindow();
    if (!fw.isOpen) return 'Ventana 24h Cerrada';
    const hrs = Math.floor(fw.remainingMinutes / 60);
    const mins = fw.remainingMinutes % 60;
    return `${fw.costStatus} • ${hrs}h ${mins}m rest.`;
  });

  readonly scopedBanks = computed<CrmBankAccount[]>(() =>
    this.banks().filter((b) => b.scope === this.activeScope()),
  );

  readonly scopedInvoices = computed<CrmBillingDocument[]>(() =>
    this.invoicesOrQuotes().filter((d) => d.scope === this.activeScope()),
  );

  readonly totalBankCapacityFiat = computed<number>(() =>
    this.scopedBanks().reduce((sum, b) => sum + (b.maxDailyCapFiat || 0), 0),
  );

  readonly inboxStudioStateVm = computed<InboxStudioState>(() => {
    const totals = this.studioTotals();
    return {
      docType: this.studioDocType(),
      contactId: this.studioContactId(),
      docNumber: this.studioDocNumber(),
      fiatCurrency: this.studioFiatCurrency(),
      exchangeRate: this.studioExchangeRate(),
      discountUsdt: this.studioDiscountUsdt(),
      taxPct: this.studioTaxPct(),
      bankAccountId: this.studioBankAccountId(),
      bankRefId: this.studioBankRefId(),
      paymentInstructions: this.studioPaymentInstructions(),
      items: this.studioItems(),
      totalUsdt: totals.totalUsdt,
      totalFiat: totals.totalFiat,
    };
  });

  readonly selectedContactVectorMemories = computed<string[]>(() => {
    const contact = this.selectedContact();
    if (!contact) return [];
    const memories: string[] = [];
    memories.push(
      `Perfil ${contact.category} • Cupo máx $${this.formatDecimal(contact.maxPendingExposureUsdt)} USDT`,
    );
    if (contact.paymentDetailsText?.trim()) {
      memories.push(`Riel preferido: ${contact.paymentDetailsText.trim()}`);
    }
    for (const ref of contact.verifiedReferences.slice(0, 4)) {
      memories.push(`Ref bancaria verificada #${ref}`);
    }
    const matchingArmCards = this.armKanbanCards().filter(
      (c) =>
        c.leadName.toLowerCase().includes(contact.name.toLowerCase()) ||
        c.companyName.toLowerCase().includes(contact.name.toLowerCase()),
    );
    for (const card of matchingArmCards) {
      if (card.painPointSummary) {
        memories.push(`[${card.workspaceId}] ${card.painPointSummary}`);
      }
    }
    return memories;
  });

  readonly auditStorageHealth = computed<CrmStorageHealthTelemetry>(() => {
    const gwStatus = this.inboundGateway.status();
    const remoteHealth = this.inboundGateway.storageHealth?.() ?? null;
    const cb = this.armTokenCircuitBreakerForSilo();
    const sqliteAvailable = typeof window !== 'undefined' && Boolean(window.electron?.arm);
    const postgresStatus: CrmStorageHealthTelemetry['postgresStatus'] = remoteHealth?.postgresConnected
      ? 'CONNECTED'
      : gwStatus === 'CONNECTED'
        ? 'LOCAL_FALLBACK'
        : 'DISCONNECTED';

    return {
      postgresStatus,
      postgresDetail: remoteHealth?.postgresConnected
        ? `PG17 + RLS (${remoteHealth.pgvectorAvailable ? 'pgvector HNSW ON' : 'SQL relacional'})`
        : gwStatus === 'CONNECTED'
          ? 'Gateway en Memory Fallback (define DATABASE_URL para PG17)'
          : 'Sin enlace Gateway — operando local-first',
      sqliteStatus: sqliteAvailable ? 'SYNCED' : 'BROWSER_ONLY',
      sqliteDetail: sqliteAvailable
        ? 'Espejo SQLite Desktop activo (WAL + idempotencia)'
        : 'Modo Web (StorageService cifrado local)',
      gatewayStatus: gwStatus,
      gatewayDetail:
        gwStatus === 'CONNECTED'
          ? `SSE Stream conectado (${this.inboundGateway.totalReceiptsReceived()} eventos)`
          : 'Esperando enlace 127.0.0.1:3030',
      dailyBudgetUsedUsd: Math.round((cb.utilizationPct / 100) * 10 * 100) / 100,
      dailyBudgetCapUsd: 10,
    };
  });

  readonly auditParsedSmsPreview = computed<ParsedSmsPreview | null>(() => {
    if (!this.rawClipboardInput().trim()) return null;
    const parsed = this.parsedClipboard();
    if (!parsed.detectedBank && !parsed.referenceId && parsed.amountFiat === null) {
      return null;
    }
    return {
      bank: parsed.detectedBank ?? undefined,
      reference: parsed.referenceId ?? undefined,
      amount: parsed.amountFiat ?? undefined,
      confidence: parsed.referenceId && parsed.amountFiat ? 96 : parsed.referenceId ? 85 : 68,
    };
  });

  readonly auditRefVerifyResult = computed<RefVerifyResult | null>(() => {
    const ref = this.candidateRef().trim();
    if (!ref) return null;
    const gwOverride = this.gatewayRefVerifyState();
    if (gwOverride && gwOverride.ref === ref) {
      return gwOverride.result;
    }
    const check = this.referenceCheck();
    return {
      checked: true,
      isUnique: !check.isDuplicate,
      message: check.isDuplicate
        ? `Colisión local en trato #${check.existingDeal?.id ?? 'N/D'} (${check.existingDeal?.contactName ?? ''})`
        : 'Referencia única en historial local',
    };
  });

  private readonly periodFilteredDeals = computed<PipelineDeal[]>(() => {
    const allDeals = this.workspaceState().deals;
    const period = this.overviewPeriod();
    if (period === 'ALL') return allDeals;
    const now = this.clockTick();
    const dayMs = 86_400_000;
    const cutoff =
      period === 'TODAY' ? now - dayMs : period === '7D' ? now - 7 * dayMs : now - 30 * dayMs;
    return allDeals.filter((d) => d.createdAt >= cutoff);
  });

  readonly overviewPipelineVolumeLabel = computed<string>(() => {
    const vol = this.periodFilteredDeals().reduce((sum, d) => sum + d.cryptoAmountUsdt, 0);
    return `$${this.formatDecimal(vol)} USDT`;
  });

  readonly overviewSpreadRateLabel = computed<string>(() => {
    const eff = this.kpis().spreadEfficiencyPct;
    return `${eff.toFixed(2)}%`;
  });

  readonly overviewAvgCloseLabel = computed<string>(() => {
    const closed = this.periodFilteredDeals().filter(
      (d) => d.stage === 'STAGE_4_CLOSED' && d.closedAt && d.closedAt >= d.createdAt,
    );
    if (closed.length === 0) return '—';
    const avgMin = Math.round(
      closed.reduce((sum, d) => sum + ((d.closedAt ?? d.createdAt) - d.createdAt), 0) /
        closed.length /
        60_000,
    );
    return avgMin < 60 ? `${Math.max(1, avgMin)}m` : `${(avgMin / 60).toFixed(1)}h`;
  });

  readonly overviewHeroKpis = computed<CrmHeroKpiCard[]>(() => {
    const kpi = this.kpis();
    const summary = this.pipelineConversionSummary();
    const fleet = this.bankFleetSummary();
    const silo = this.activeArmSilo();
    const armKpis = this.armExecutiveKpisForSilo();

    if (silo === 'ARM_B2B') {
      return [
        {
          id: 'arm-mrr',
          label: armKpis[0]?.label ?? 'Pipeline MRR/ARR',
          value: armKpis[0]?.value ?? '$0 MRR',
          deltaLabel: armKpis[0]?.sub ?? 'Silo ARM B2B',
          tone: 'emerald',
          subtext: `${this.armKanbanCardsForSilo().length} cuentas activas`,
          targetNav: 'PIPELINE',
        },
        {
          id: 'arm-conv',
          label: armKpis[1]?.label ?? 'Conversión Autónoma',
          value: armKpis[1]?.value ?? '0.0%',
          deltaLabel: armKpis[1]?.sub ?? 'Calificación BANT',
          tone: 'cyan',
          subtext: 'SDR & Scheduler en vivo',
          targetNav: 'PIPELINE',
        },
        {
          id: 'arm-sla',
          label: armKpis[2]?.label ?? 'SLA Respuesta IA',
          value: armKpis[2]?.value ?? '0.0s',
          deltaLabel: armKpis[2]?.sub ?? 'Ejecuciones',
          tone: 'violet',
          subtext: 'Sin intervención manual',
          targetNav: 'INBOX_STUDIO',
        },
        {
          id: 'arm-hitl',
          label: 'Cola HITL Pendiente',
          value: `${this.armApprovalQueueForSilo().length}`,
          deltaLabel: armKpis[3]?.value ?? '$0 USD',
          tone: 'amber',
          subtext: 'Revisión humana segura',
          targetNav: 'PIPELINE',
        },
      ];
    }

    const periodDeals = this.periodFilteredDeals();
    const periodProfit = periodDeals
      .filter((d) => d.stage === 'STAGE_4_CLOSED')
      .reduce((s, d) => s + d.netProfitUsdt, 0);
    const openInbox = this.filteredConversations().filter((c) => c.unreadCount > 0).length;

    return [
      {
        id: 'pnl-net',
        label: silo === 'FINANCE_360' ? 'Utilidad Neta Facturada' : 'PnL Neto Cerrado',
        value: `$${this.formatDecimal(this.overviewPeriod() === 'TODAY' ? kpi.closedNetProfitTodayUsdt : periodProfit)}`,
        deltaLabel: `${kpi.spreadEfficiencyPct.toFixed(2)}% spread`,
        tone: 'emerald',
        subtext: `${kpi.closedTradesCountToday} operaciones cerradas hoy`,
        targetNav: 'PIPELINE',
      },
      {
        id: 'transit-vol',
        label: 'Volumen En Tránsito',
        value: `$${this.formatDecimal(kpi.inTransitVolumeUsdt)}`,
        deltaLabel: `${summary.totalDeals} tratos en tablero`,
        tone: 'cyan',
        subtext: `${summary.expiredCount} con tasa vencida`,
        targetNav: 'PIPELINE',
      },
      {
        id: 'win-rate',
        label: 'Conversión & Triaje',
        value: `${summary.conversionRatePct}%`,
        deltaLabel: `${openInbox} chats sin leer`,
        tone: 'violet',
        subtext: `${this.filteredConversations().length} hilos omnicanal activos`,
        targetNav: 'INBOX_STUDIO',
      },
      {
        id: 'rails-cap',
        label: 'Salud Rieles Bancarios',
        value: `${fleet.availableCount}/${fleet.totalCount}`,
        deltaLabel: `${fleet.avgUsagePct}% uso cupo`,
        tone: 'amber',
        subtext: `${this.workspaceState().contacts.length} contrapartes registradas`,
        targetNav: 'CONTACTS_RAILS',
      },
    ];
  });

  readonly overviewCashflowColumns = computed<CrmCashflowColumn[]>(() => {
    const kpi = this.kpis();
    const transitTotal = this.periodFilteredDeals()
      .filter((d) => d.stage === 'STAGE_2_TRANSIT' || d.stage === 'STAGE_3_VERIFY')
      .reduce((s, d) => s + d.cryptoAmountUsdt, 0);
    const banksCount = this.scopedBanks().length;
    const totalVes = this.bankFleetSummary().totalVesBalance;

    return [
      {
        id: 'cf-liquidity',
        label: 'Liquidez Rieles',
        valueFormatted: `${this.formatDecimal(totalVes)} VES`,
        sublabel: `${banksCount} cuentas activas`,
      },
      {
        id: 'cf-volume',
        label: 'Volumen Liquidado',
        valueFormatted: `$${this.formatDecimal(kpi.closedVolumeTodayUsdt)}`,
        sublabel: `${kpi.closedTradesCountToday} operaciones`,
      },
      {
        id: 'cf-transit',
        label: 'Reserva Tránsito',
        valueFormatted: `$${this.formatDecimal(transitTotal)}`,
        sublabel: 'Cupo retenido',
        highlighted: transitTotal > 0,
      },
      {
        id: 'cf-receivable',
        label: 'Por Cobrar',
        valueFormatted: `$${this.formatDecimal(kpi.totalReceivablesUsdt)}`,
        sublabel: 'Saldos positivos',
      },
      {
        id: 'cf-net',
        label: 'PnL Neto Hoy',
        valueFormatted: `$${this.formatDecimal(kpi.closedNetProfitTodayUsdt)}`,
        sublabel: this.isTodaySettled() ? 'Transferido 360' : 'Listo para corte',
        highlighted: kpi.closedNetProfitTodayUsdt > 0,
      },
    ];
  });

  readonly overviewVelocityBars = computed<CrmVelocityBarItem[]>(() => {
    const cols = this.kanbanColumnsList();
    const maxVol = Math.max(1, ...cols.map((c) => c.totalUsdt));
    const tones: CrmVelocityBarItem['tone'][] = ['cyan', 'amber', 'danger', 'emerald'];
    return cols.map((col, idx) => ({
      id: col.stage,
      label: `${col.label} (${col.deals.length})`,
      formattedValue: `$${this.formatDecimal(col.totalUsdt)} USDT`,
      ratioPct: col.totalUsdt > 0 ? Math.max(6, Math.round((col.totalUsdt / maxVol) * 100)) : 0,
      tone: tones[idx] ?? 'cyan',
    }));
  });

  readonly overviewFunnelStages = computed(() =>
    this.kanbanColumnsList().map((col) => ({
      label: col.label,
      count: col.deals.length,
      valueLabel: `$${this.formatDecimal(col.totalUsdt)}`,
    })),
  );

  readonly overviewDealsRows = computed<CrmDealsStatusRow[]>(() => {
    const stageToneMap: Record<PipelineStage, { label: string; tone: CrmDealsStatusRow['statusTone'] }> = {
      STAGE_1_NEW: { label: 'Cotizado', tone: 'quoted' },
      STAGE_2_TRANSIT: { label: 'En Tránsito', tone: 'transit' },
      STAGE_3_VERIFY: { label: 'Verificando', tone: 'stuck' },
      STAGE_4_CLOSED: { label: 'Liquidado', tone: 'won' },
    };

    return [...this.periodFilteredDeals()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 8)
      .map((deal) => {
        const mapped = deal.isRateExpired && deal.stage !== 'STAGE_4_CLOSED'
          ? { label: 'Tasa Vencida', tone: 'stuck' as const }
          : stageToneMap[deal.stage];
        const initials = (deal.contactName || 'CL')
          .split(/\s+/)
          .slice(0, 2)
          .map((part) => part[0]?.toUpperCase() ?? '')
          .join('');
        return {
          id: deal.id,
          counterparty: deal.contactName,
          lastContactLabel: new Date(deal.createdAt).toLocaleTimeString('es-VE', {
            hour: '2-digit',
            minute: '2-digit',
          }),
          ownerLabel: deal.bankName || this.activeArmSilo(),
          ownerInitials: initials || 'CL',
          statusLabel: mapped.label,
          statusTone: mapped.tone,
          dealValueFormatted: `$${this.formatDecimal(deal.cryptoAmountUsdt)}`,
          rawDeal: deal,
        };
      });
  });

  readonly overviewAiHealthScore = computed<number>(() => {
    const summary = this.pipelineConversionSummary();
    const fleet = this.bankFleetSummary();
    const pendingHitl = this.armApprovalQueueForSilo().length;
    const gwConnected = this.inboundGateway.status() === 'CONNECTED';

    let score = 62;
    score += Math.min(20, Math.round(summary.conversionRatePct * 0.25));
    score += gwConnected ? 10 : 0;
    score += fleet.totalCount > 0 && fleet.capReachedCount === 0 ? 8 : 0;
    score -= Math.min(18, summary.expiredCount * 6);
    score -= Math.min(10, pendingHitl * 2);
    score -= fleet.capReachedCount * 8;
    return Math.max(15, Math.min(100, Math.round(score)));
  });

  readonly overviewAiRecommendations = computed<CrmHealthRecommendation[]>(() => {
    const recs: CrmHealthRecommendation[] = [];
    const summary = this.pipelineConversionSummary();
    const fleet = this.bankFleetSummary();
    const pendingHitl = this.armApprovalQueueForSilo().length;

    if (summary.expiredCount > 0) {
      recs.push({
        id: 'rec-expired',
        label: `Recotizar ${summary.expiredCount} trato(s) con tasa TTL expirada`,
        impactBadge: 'Protege spread',
        tone: 'amber',
        actionId: 'OPEN_EXPIRED_DEALS',
      });
    }
    if (pendingHitl > 0) {
      recs.push({
        id: 'rec-hitl',
        label: `Revisar ${pendingHitl} aprobación(es) HITL en cola ARM`,
        impactBadge: 'Desbloquea cierre',
        tone: 'blue',
        actionId: 'OPEN_ARM_HITL',
      });
    }
    if (fleet.capReachedCount > 0 || fleet.totalCount === 0) {
      recs.push({
        id: 'rec-rails',
        label:
          fleet.totalCount === 0
            ? 'Configurar tu primer riel bancario para enrutamiento automático'
            : `${fleet.capReachedCount} banco(s) al límite diario — rotar liquidez`,
        impactBadge: 'Anti-bloqueo',
        tone: 'amber',
        actionId: 'OPEN_RAILS',
      });
    }
    if (recs.length === 0) {
      recs.push({
        id: 'rec-ok',
        label: 'Ejecutar escaneo Anti-Ghosting HSM y sincronizar tratos ARM',
        impactBadge: '+Conversión',
        tone: 'emerald',
        actionId: 'SYNC_ARM',
      });
    }
    return recs;
  });

  setScope(scope: WorkspaceScope): void {
    this.activeScope.set(scope);
    this.storage.set(CRM_STORAGE_KEYS.ACTIVE_SCOPE, scope);
    this.activeArmSilo.set(scope);
    const firstCard = this.armKanbanCards().find((c) => c.workspaceId === scope);
    if (firstCard) {
      this.selectedArmLeadId.set(firstCard.id);
    }
    this.selectedContactId.set(null);
    this.persistArmState();
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
    if (view === 'ARM_COMMAND') {
      this.preferredPipelineMode.set('ARM_AUTOPILOT');
    } else if (view === 'KANBAN') {
      this.preferredPipelineMode.set('LEGACY_BOARD');
    } else if (view === 'BANKS') {
      this.contactsRailsSubMode.set('RAILS');
    } else if (view === 'CONTACTS') {
      this.contactsRailsSubMode.set('CONTACTS');
    }
  }

  onPrimaryNavSelect(nav: CrmPrimaryNavId): void {
    switch (nav) {
      case 'OVERVIEW':
        this.setView('DASHBOARD');
        break;
      case 'PIPELINE':
        this.setView(this.preferredPipelineMode() === 'ARM_AUTOPILOT' ? 'ARM_COMMAND' : 'KANBAN');
        break;
      case 'INBOX_STUDIO':
        this.setView('OMNICHANNEL');
        break;
      case 'CONTACTS_RAILS':
        this.setView(this.contactsRailsSubMode() === 'RAILS' ? 'BANKS' : 'CONTACTS');
        break;
      case 'AUDIT_SYSTEM':
        this.setView('ACTIVITIES');
        break;
    }
  }

  onQuickCreateOption(option: 'NEW_DEAL' | 'NEW_CONTACT' | 'NEW_BANK' | 'NEW_CHAT'): void {
    if (option === 'NEW_DEAL') {
      this.openNewDealModal();
      return;
    }
    if (option === 'NEW_CONTACT') {
      this.showAddContactModal.set(true);
      return;
    }
    if (option === 'NEW_BANK') {
      this.showAddBankModal.set(true);
      return;
    }
    this.openNewChatModal();
  }

  onPipelineModeChange(mode: CrmPipelineMode): void {
    this.preferredPipelineMode.set(mode);
    this.setView(mode === 'ARM_AUTOPILOT' ? 'ARM_COMMAND' : 'KANBAN');
  }

  onContactsRailsSubModeChange(mode: ContactsRailsSubMode): void {
    this.contactsRailsSubMode.set(mode);
    this.setView(mode === 'RAILS' ? 'BANKS' : 'CONTACTS');
  }

  onKanbanFilterChange(mode: string): void {
    if (mode === 'ALL' || mode === 'EXPIRED' || mode === 'WITH_REF' || mode === 'HIGH_VALUE') {
      this.kanbanFilterMode.set(mode);
    }
  }

  onPipelineAdvanceDeal(payload: { dealId: string; targetStage: string }): void {
    this.moveDealToStage(payload.dealId, payload.targetStage as PipelineStage);
  }

  onOverviewKpiDrilldown(card: CrmHeroKpiCard): void {
    if (card.targetNav) {
      this.onPrimaryNavSelect(card.targetNav);
    }
  }

  onOverviewAskStrategist(prompt: string): void {
    const kpi = this.kpis();
    const summary = this.pipelineConversionSummary();
    const diagnostic =
      `Diagnóstico "${prompt}": ${summary.totalDeals} tratos activos (${summary.conversionRatePct}% cierre), ` +
      `$${this.formatDecimal(kpi.inTransitVolumeUsdt)} en tránsito, ${summary.expiredCount} tasas vencidas ` +
      `y ${this.armApprovalQueueForSilo().length} ítems en cola HITL.`;
    this.aiStrategistInsight.set(diagnostic);
    this.toast.info(diagnostic, 'AI Strategist');
  }

  onOverviewRecommendationAction(rec: CrmHealthRecommendation): void {
    if (rec.actionId === 'OPEN_EXPIRED_DEALS') {
      this.kanbanFilterMode.set('EXPIRED');
      this.onPipelineModeChange('LEGACY_BOARD');
      return;
    }
    if (rec.actionId === 'OPEN_ARM_HITL') {
      this.onPipelineModeChange('ARM_AUTOPILOT');
      return;
    }
    if (rec.actionId === 'OPEN_RAILS') {
      this.onContactsRailsSubModeChange('RAILS');
      return;
    }
    this.onPipelineModeChange('ARM_AUTOPILOT');
    this.triggerAntiGhostingScanForSilo();
  }

  onOverviewOpenDeal(row: CrmDealsStatusRow): void {
    if (row.rawDeal) {
      this.openOmnichannelForDeal(row.rawDeal);
      return;
    }
    this.onPrimaryNavSelect('PIPELINE');
  }

  onInboxSendMessage(cmd: SendMessageCommand): void {
    if (cmd.mode === 'WHATSAPP_DIRECT') {
      this.openWhatsAppDirectForActiveChat();
      return;
    }
    if (cmd.mode === 'COPY') {
      this.copyFullDraftText();
      return;
    }
    this.sendChatMessage();
  }

  onInboxOcrPaste(payload: File | string): void {
    if (typeof payload === 'string') {
      void this.processReceiptOcr(payload);
      return;
    }
    this.handlePastedImageFile(payload);
  }

  onInboxStudioFieldChange(patch: Record<string, unknown>): void {
    if ('docType' in patch && patch['docType']) {
      this.studioDocType.set(patch['docType'] as CrmDocumentType);
    }
    if ('contactId' in patch) {
      this.studioContactId.set(String(patch['contactId'] ?? ''));
    }
    if ('docNumber' in patch) {
      this.studioDocNumber.set(String(patch['docNumber'] ?? ''));
    }
    if ('fiatCurrency' in patch && patch['fiatCurrency']) {
      this.studioFiatCurrency.set(patch['fiatCurrency'] as FiatCurrency);
    }
    if ('exchangeRate' in patch) {
      this.studioExchangeRate.set(Number(patch['exchangeRate']) || 0);
    }
    if ('discountUsdt' in patch) {
      this.studioDiscountUsdt.set(Number(patch['discountUsdt']) || 0);
    }
    if ('taxPct' in patch) {
      this.studioTaxPct.set(Number(patch['taxPct']) || 0);
    }
    if ('bankAccountId' in patch) {
      this.studioBankAccountId.set(String(patch['bankAccountId'] ?? ''));
    }
    if ('bankRefId' in patch) {
      this.studioBankRefId.set(String(patch['bankRefId'] ?? ''));
    }
    if ('paymentInstructions' in patch) {
      this.studioPaymentInstructions.set(String(patch['paymentInstructions'] ?? ''));
    }
    if ('items' in patch && Array.isArray(patch['items'])) {
      this.studioItems.set(patch['items'] as BillingLineItem[]);
    }
    setTimeout(() => this.renderVoucherCanvas(), 50);
  }

  onInboxExportPng(mode: ExportPngMode): void {
    if (mode === 'COPY') {
      this.copyCanvasImageToClipboard();
      return;
    }
    this.downloadCanvasImage();
  }

  onInboxConfigUpdate(patch: Record<string, unknown>): void {
    for (const [key, val] of Object.entries(patch)) {
      this.updateOmnichannelConfig(key as keyof OmnichannelIntegrationConfig, val);
    }
  }

  onAdjustContactBalance(payload: AdjustBalancePayload): void {
    if (this.selectedContactId() !== payload.contactId) {
      this.selectedContactId.set(payload.contactId);
    }
    if (payload.settleZero) {
      this.adjustContactBalance('ZERO');
      return;
    }
    if (payload.deltaUsdt === 0) return;
    this.contactBalanceAdjustAmount.set(Math.abs(payload.deltaUsdt));
    this.adjustContactBalance(payload.deltaUsdt > 0 ? 'POSITIVE' : 'NEGATIVE');
  }

  onReconcileBank(payload: ReconcileBankPayload): void {
    this.realBankBalanceInput.set(payload.realBalanceFiat);
    this.applyBankReconciliation(payload.bankId);
  }

  onAuditVerifyReference(): void {
    const ref = this.candidateRef().trim();
    if (!ref) return;
    const local = this.referenceCheck();
    if (local.isDuplicate) {
      this.gatewayRefVerifyState.set({
        ref,
        result: {
          checked: true,
          isUnique: false,
          message: `Colisión local detectada en trato #${local.existingDeal?.id ?? 'N/D'}`,
        },
      });
      this.toast.warn(`Referencia #${ref} ya registrada localmente.`, 'Anti-Fraude');
      return;
    }
    if (this.inboundGateway.status() === 'CONNECTED' && this.inboundGateway.verifyReceiptWithGateway) {
      const firstBankId = this.scopedBanks()[0]?.id ?? 'default-rail';
      void this.inboundGateway
        .verifyReceiptWithGateway({
          workspaceId: this.activeArmSilo(),
          bankRailId: firstBankId,
          referenceCode: ref,
        })
        .then((res) => {
          this.gatewayRefVerifyState.set({
            ref,
            result: {
              checked: true,
              isUnique: !res.collision,
              message: res.collision
                ? `Colisión reportada por Gateway/PSQL (${res.existingDealId ?? 'N/D'})`
                : `Referencia #${ref} verificada sin colisiones (${res.mode ?? 'GATEWAY'})`,
            },
          });
        });
      return;
    }
    this.gatewayRefVerifyState.set({
      ref,
      result: {
        checked: true,
        isUnique: true,
        message: `Referencia #${ref} única en bóveda local`,
      },
    });
  }

  onAuditReplacementRateChange(rate: number): void {
    if (Number.isFinite(rate) && rate > 0) {
      this.liveReplacementRate.set(rate);
    }
  }

  private formatDecimal(val: number): string {
    return (Number.isFinite(val) ? val : 0).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
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

    if (typeof window !== 'undefined' && window.electron?.arm?.recordTreasurySettlement) {
      void window.electron.arm.recordTreasurySettlement({
        sourceWorkspace: 'P2P_DESK',
        targetWorkspace: 'FINANCE_360',
        idempotencyKey: payload.settlementId,
        netProfitUsdt: payload.netProfitUsdt,
        settlementDate: payload.dateIso,
        createdAt: payload.timestamp,
      });
    }

    try {
      const availableVaults = this.finance360.assets?.() ?? [];
      const targetVault =
        availableVaults.find(
          (v) => (v.channel === 'crypto' || v.currency === 'USDT') && v.channel !== 'receivable',
        ) ??
        availableVaults.find(
          (v) => v.scope === 'business' && v.currency === 'USD' && v.channel !== 'receivable',
        );

      const bridgeRes = this.finance360.settleP2pProfitToFinance360({
        netProfitUsdt: payload.netProfitUsdt,
        tradesCount: payload.tradesCount,
        dateIso: todayVetIso(new Date(payload.timestamp)),
        settlementId: payload.settlementId,
        vaultId: targetVault?.id,
        scope: 'business',
        title: `Corte Diario P2P Desk (${payload.dateIso})`,
        notes: `Liquidación automática P2P #${payload.settlementId} (${payload.tradesCount} operaciones cerradas).`,
      });

      if (bridgeRes.alreadySettled) {
        this.toast.warn('La ganancia de hoy ya fue transferida a Finanzas 360.', 'Corte Diario');
        return;
      }

      if (!bridgeRes.success) {
        this.toast.warn(
          `No se pudo acreditar el corte #${payload.settlementId} en Finanzas 360.`,
          'Puente Liquidación 360',
        );
        return;
      }

      const vaultLabel = targetVault ? ` en ${targetVault.name}` : '';
      const rateSuffix =
        bridgeRes.bcvRateApplied > 0
          ? ` (BCV ${bridgeRes.bcvRateApplied.toFixed(2)} Bs)`
          : ' (sin tasa BCV en vivo)';
      this.toast.success(
        `+$${payload.netProfitUsdt.toFixed(2)} USDT transferidos a Finanzas 360 (#${payload.settlementId})${vaultLabel}${rateSuffix}.`,
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

  executeCloseDealModal(overrideDuplicate = false): void {
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

      const touchedBank = nextBanks.find((b) => b.id === deal.bankAccountId);
      if (touchedBank) {
        this.syncBankRailToSqlite(touchedBank);
      }
      if (targetRef) {
        if (typeof window !== 'undefined' && window.electron?.arm?.recordPaymentReceipt) {
          void window.electron.arm.recordPaymentReceipt({
            workspaceId: this.activeArmSilo(),
            bankRailId: deal.bankAccountId,
            referenceCode: targetRef,
            amountFiat: deal.totalFiatAmount,
            dealId: deal.id,
            createdAt: now,
          });
        }
        if (this.inboundGateway.status() === 'CONNECTED') {
          void this.inboundGateway.verifyReceiptWithGateway?.({
            workspaceId: this.activeArmSilo(),
            bankRailId: deal.bankAccountId,
            referenceCode: targetRef,
            amountFiat: deal.totalFiatAmount,
            dealId: deal.id,
          });
        }
      }

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
  private syncBankRailToSqlite(bank: CrmBankAccount): void {
    if (typeof window === 'undefined' || !window.electron?.arm?.upsertBankRail) {
      return;
    }
    void window.electron.arm.upsertBankRail({
      id: bank.id,
      workspaceId: bank.scope === 'FINANCE_360' ? 'FINANCE_360' : 'P2P_DESK',
      bankName: bank.bankName,
      currency: bank.currency,
      holderDetails: bank.holderDetailsText,
      currentBalanceFiat: bank.currentBalanceFiat,
      maxDailyCapFiat: bank.maxDailyCapFiat,
      status: 'AVAILABLE',
      updatedAt: Date.now(),
    });
  }

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
    this.syncBankRailToSqlite(newBank);

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
    const updatedBank: CrmBankAccount = { ...bank, currentBalanceFiat: realBalance };

    const nextBanks = this.banks().map((b) =>
      b.id === bankId ? updatedBank : b,
    );
    this.banks.set(nextBanks);
    this.storage.set(CRM_STORAGE_KEYS.BANKS, nextBanks);
    this.syncBankRailToSqlite(updatedBank);
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

    if (
      conv.channel === 'WHATSAPP' &&
      conv.recipientPhoneOrIgId &&
      typeof this.inboundGateway.sendOutboundMessage === 'function'
    ) {
      void this.inboundGateway
        .sendOutboundMessage({
          workspaceId: this.activeArmSilo(),
          recipientPhone: conv.recipientPhoneOrIgId,
          text,
          lastInboundTimestampMs: conv.lastInboundTimestamp || Date.now(),
        })
        .then((res) => {
          if (res.ok && (res.mode === 'LIVE_WHATSAPP_QR' || res.mode === 'LIVE_META_GRAPH')) {
            this.toast.success(
              `Enviado por WhatsApp en vivo (${conv.recipientPhoneOrIgId}).`,
              'WhatsApp Saliente',
            );
          } else if (!res.ok) {
            this.toast.warn(
              `Guardado en Inbox, pero falló envío WhatsApp: ${res.error || 'Sin conexión'}`,
              'WhatsApp Saliente',
            );
          } else {
            this.toast.info('Mensaje registrado en Inbox (modo local).', 'Chat Omnicanal');
          }
        });
      return;
    }

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

    for (const item of Array.from(items)) {
      if (item.type.indexOf('image') !== -1) {
        const file = item.getAsFile();
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
    this.renderVoucherCanvas();
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
    this.renderVoucherCanvas();
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

  saveStudioDocument(createDeal = false): void {
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
    this.importDataJsonFile(input.files[0]);
  }

  importDataJsonFile(file: File): void {
    this.readTextFile(file, (content) => {
      this.applyBackupJsonText(content, this.importStrategy());
    });
  }

  private readTextFile(file: File, onLoaded: (content: string) => void): void {
    const reader = new FileReader();
    reader.onload = () => onLoaded(String(reader.result ?? ''));
    reader.readAsText(file);
  }

  exportCatalogCsv(entity: CrmCsvCatalogEntity = this.csvCatalogTarget()): void {
    const scope = this.activeScope();
    let csvContent: string;
    let prefix: string;

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
    this.importCatalogCsvFile(input.files[0]);
  }

  importCatalogCsvFile(file: File): void {
    this.readTextFile(file, (content) => {
      this.applyCatalogCsvText(
        content,
        this.csvCatalogTarget(),
        this.importStrategy(),
      );
    });
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
  readonly selectedArmLeadId = signal<string>('');
  readonly showArmCommandPalette = signal<boolean>(false);
  readonly armCommandQuery = signal<string>('');

  private static readonly DEMO_ARM_CARD_IDS = new Set([
    'arm-lead-b2b-1',
    'arm-lead-b2b-2',
    'arm-lead-b2b-3',
    'arm-lead-p2p-1',
    'arm-lead-360-1',
  ]);

  private static readonly DEMO_ARM_KANBAN_CARDS: readonly ArmKanbanCardVm[] = [
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
  ];

  // Zero-Seed default: starts at $0.00 / 0% / 0 traces / 0 HITL until real inbound or explicit demo load
  readonly armKanbanCards = signal<ArmKanbanCardVm[]>([]);

  loadArmDemoSeed(): void {
    this.storage.set('p2p.arm.demo_enabled', true);
    this.armKanbanCards.set(
      ComplianceCockpitComponent.DEMO_ARM_KANBAN_CARDS.map((card) => ({
        ...card,
        messages: [...card.messages],
        toolTraces: [...card.toolTraces],
      })),
    );
    this.selectedArmLeadId.set('arm-lead-b2b-1');
    this.persistArmState();
  }

  resetArmToZero(): void {
    this.storage.set('p2p.arm.demo_enabled', false);
    this.armKanbanCards.set([]);
    this.armApprovalQueue.set([]);
    this.armAutonomousFeed.set([]);
    this.armShadowExamples.set([]);
    this.selectedArmLeadId.set('');
    this.persistArmState();
    this.toast.success('CRM / ARM reiniciado en $0.00 (Zero-Seed activo).', 'CRM Limpio');
  }

  private parseArmCardMoney(card: ArmKanbanCardVm): number {
    if (typeof card.estimatedValueNum === 'number' && Number.isFinite(card.estimatedValueNum)) {
      return Math.max(0, card.estimatedValueNum);
    }
    const raw = (card.dealValueLabel || '').replace(/,/g, '');
    const match = raw.match(/\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : 0;
  }

  readonly armExecutiveKpisForSilo = computed<CrmSiloExecutiveKpi[]>(() => {
    const silo = this.activeArmSilo();
    const cards = this.armKanbanCards().filter((c) => c.workspaceId === silo);
    const pendingHitl = this.armApprovalQueue().filter(
      (a) => a.workspaceId === silo && a.status === 'PENDING',
    );
    const feed = this.armAutonomousFeed().filter((f) => f.workspaceId === silo);
    const latencies = [
      ...cards.flatMap((c) => c.toolTraces.map((t) => t.latencyMs)),
      ...feed.map((f) => f.latencyMs),
    ].filter((ms) => Number.isFinite(ms) && ms > 0);
    const avgLatencySec =
      latencies.length > 0
        ? (latencies.reduce((a, b) => a + b, 0) / latencies.length / 1000).toFixed(2)
        : '0.00';

    const qualifiedCount = cards.filter((c) => c.qualificationScore >= 75).length;
    const convPct = cards.length > 0 ? Math.round((qualifiedCount / cards.length) * 1000) / 10 : 0;
    const cardsTotalVal = cards.reduce((sum, c) => sum + this.parseArmCardMoney(c), 0);

    if (silo === 'P2P_DESK') {
      const p2pDeals = this.deals().filter((d) => d.scope === 'P2P_DESK');
      const p2pTransitUsdt = p2pDeals
        .filter((d) => d.stage !== 'STAGE_4_CLOSED')
        .reduce((sum, d) => sum + d.cryptoAmountUsdt, 0);
      const p2pRails = this.banks().filter((b) => b.scope === 'P2P_DESK').length;
      const totalTransitUsdt = Math.round((p2pTransitUsdt + cardsTotalVal) * 100) / 100;

      return [
        {
          label: 'Volumen En Tránsito',
          value: `${this.formatDecimal(totalTransitUsdt)} USDT`,
          sub: `${p2pDeals.length} tratos • ${cards.length} leads`,
        },
        {
          label: 'Conversión Autónoma',
          value: `${convPct.toFixed(1)}%`,
          sub: `${qualifiedCount}/${cards.length} leads calificados`,
        },
        {
          label: 'SLA Respuesta & OCR',
          value: `${avgLatencySec}s`,
          sub: `${latencies.length} trazas medidas`,
        },
        {
          label: 'Escudo Anti-Fraude',
          value: `${pendingHitl.length} HITL`,
          sub: `${p2pRails} rieles • ${feed.length} eventos`,
        },
      ];
    }

    if (silo === 'FINANCE_360') {
      const f360Deals = this.deals().filter((d) => d.scope === 'FINANCE_360');
      const closed360Usd = f360Deals
        .filter((d) => d.stage === 'STAGE_4_CLOSED')
        .reduce((sum, d) => sum + d.cryptoAmountUsdt, 0);
      const open360Usd = f360Deals
        .filter((d) => d.stage !== 'STAGE_4_CLOSED')
        .reduce((sum, d) => sum + d.cryptoAmountUsdt, 0);
      const budgetedUsd = Math.round((open360Usd + cardsTotalVal) * 100) / 100;

      return [
        {
          label: 'Pipeline Presupuestado',
          value: `$${this.formatDecimal(budgetedUsd)} USD`,
          sub: `${cards.length} leads • ${f360Deals.length} tratos 360`,
        },
        {
          label: 'Conversión Autónoma',
          value: `${convPct.toFixed(1)}%`,
          sub: `${pendingHitl.length} aprobaciones HITL`,
        },
        {
          label: 'SLA Respuesta IA',
          value: `${avgLatencySec}s`,
          sub: `${latencies.length} trazas medidas`,
        },
        {
          label: 'Ingresos Facturados 360',
          value: `$${this.formatDecimal(closed360Usd)} USD`,
          sub: 'Sincronizado Gavetas 360',
        },
      ];
    }

    const wonOrScheduledUsd = cards
      .filter((c) => c.stageSlug === 'sesion-agendada' || c.stageSlug === 'ganado' || c.stageSlug === 'propuesta-enviada')
      .reduce((sum, c) => sum + this.parseArmCardMoney(c), 0);

    return [
      {
        label: 'Valor Pipeline (MRR/ARR)',
        value: `$${this.formatDecimal(cardsTotalVal)} MRR`,
        sub: `$${this.formatDecimal(cardsTotalVal * 12)} ARR proyectado`,
      },
      {
        label: 'Tasa Conversión Autónoma',
        value: `${convPct.toFixed(1)}%`,
        sub: `${qualifiedCount}/${cards.length} cuentas BANT >=75`,
      },
      {
        label: 'SLA de Respuesta IA',
        value: `${avgLatencySec}s`,
        sub: `${latencies.length} trazas ejecutadas`,
      },
      {
        label: 'Pipeline Calificado / Cerrado',
        value: `$${this.formatDecimal(wonOrScheduledUsd)} USD`,
        sub: `${cards.length} cuentas • ${pendingHitl.length} cola HITL`,
      },
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
  readonly armTokenCircuitBreakerForSilo = computed(() => {
    const traceCount =
      this.armKanbanCardsForSilo().reduce((sum, c) => sum + c.toolTraces.length, 0) +
      this.armAutonomousFeedForSilo().length;
    return evaluateDealTokenCircuitBreaker({
      workspaceId: this.activeArmSilo(),
      dailyTokensUsed: traceCount * 1_180,
      estimatedTurnTokens: 1_800,
    });
  });
  readonly armReplayComparisonResult = signal<ArmReplayComparisonResult | null>(null);
  readonly armCloserPreCallBriefing = signal<ArmCloserPreCallBriefing | null>(null);

  readonly armCommandActions = [
    { id: 'SILO_B2B', label: 'Cambiar a Silo ARM Comercial B2B', shortcut: '1' },
    { id: 'SILO_P2P', label: 'Cambiar a Silo Mesa P2P & Liquidez', shortcut: '2' },
    { id: 'SILO_360', label: 'Cambiar a Silo Finanzas & PyME 360', shortcut: '3' },
    { id: 'SANDBOX_TURN', label: 'Simular Turno Sandbox ($0 Meta API)', shortcut: 'S' },
    { id: 'REPLAY_DRY_RUN', label: 'Ejecutar Replay Determinista A/B ($0)', shortcut: 'R' },
    { id: 'ANTI_GHOSTING', label: 'Escaneo Anti-Ghosting HSM (72h)', shortcut: 'G' },
    { id: 'PRECALL_BRIEFING', label: 'Generar Briefing 15m Pre-Reunión', shortcut: 'B' },
    { id: 'SYNC_LOCAL', label: 'Sincronizar Tratos Locales hacia Silos', shortcut: 'L' },
    { id: 'APPROVE_FIRST', label: 'Aprobar primer ítem en Approval Queue', shortcut: 'A' },
    { id: 'RESET_ARM_ZERO', label: 'Resetear CRM / ARM a $0.00 (Zero-Seed)', shortcut: '0' },
    { id: 'LOAD_ARM_DEMO', label: 'Cargar Datos Demo Sandbox ARM', shortcut: 'D' },
  ] as const;

  readonly filteredArmCommands = computed(() => {
    const q = this.armCommandQuery().trim().toLowerCase();
    if (!q) return [...this.armCommandActions];
    return this.armCommandActions.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(q) ||
        cmd.id.toLowerCase().includes(q),
    );
  });

  executeArmCommand(cmdId: string): void {
    this.showArmCommandPalette.set(false);
    this.armCommandQuery.set('');
    switch (cmdId) {
      case 'SILO_B2B':
        this.setArmSilo('ARM_B2B');
        break;
      case 'SILO_P2P':
        this.setArmSilo('P2P_DESK');
        break;
      case 'SILO_360':
        this.setArmSilo('FINANCE_360');
        break;
      case 'SANDBOX_TURN':
        this.triggerArmSandboxTurn();
        break;
      case 'REPLAY_DRY_RUN':
        this.triggerArmDeterministicReplayDryRun();
        break;
      case 'ANTI_GHOSTING':
        this.triggerAntiGhostingScanForSilo();
        break;
      case 'PRECALL_BRIEFING':
        this.triggerCloserPreCallBriefingForSilo();
        break;
      case 'SYNC_LOCAL':
        this.syncLocalDealsToArmSilos();
        break;
      case 'APPROVE_FIRST': {
        const first = this.armApprovalQueueForSilo()[0];
        if (first) this.approveArmQueueItem(first.id);
        break;
      }
      case 'RESET_ARM_ZERO':
        this.resetArmToZero();
        break;
      case 'LOAD_ARM_DEMO':
        this.loadArmDemoSeed();
        break;
    }
  }

  executeFirstMatchedArmCommand(): void {
    const first = this.filteredArmCommands()[0];
    if (first) {
      this.executeArmCommand(first.id);
    }
  }

  setArmSilo(silo: ArmWorkspaceId): void {
    this.activeArmSilo.set(silo);
    if (silo === 'P2P_DESK' || silo === 'FINANCE_360') {
      this.activeScope.set(silo);
      this.storage.set(CRM_STORAGE_KEYS.ACTIVE_SCOPE, silo);
    }
    this.selectedContactId.set(null);
    const firstCard = this.armKanbanCards().find((c) => c.workspaceId === silo);
    if (firstCard) {
      this.selectedArmLeadId.set(firstCard.id);
    }
    this.editingApprovalId.set(null);
    this.persistArmState();
  }

  selectArmLeadForInspector(cardId: string): void {
    this.selectedArmLeadId.set(cardId);
  }

  private syncArmCardToSqlite(
    card: Pick<
      ArmKanbanCardVm,
      | 'id'
      | 'workspaceId'
      | 'leadName'
      | 'companyName'
      | 'stageSlug'
      | 'assignedAgentRole'
      | 'qualificationScore'
      | 'painPointSummary'
      | 'dealValueLabel'
    > & { estimatedValueNum?: number },
  ): void {
    if (typeof window === 'undefined' || !window.electron?.arm?.upsertLead) {
      return;
    }
    const currency = (card.dealValueLabel || '').toUpperCase().includes('USDT') ? 'USDT' : 'USD';
    void window.electron.arm.upsertLead({
      id: card.id,
      workspaceId: card.workspaceId,
      fullName: card.leadName,
      companyName: card.companyName,
      phoneWhatsapp: null,
      email: null,
      currentStageSlug: card.stageSlug,
      assignedAgentRole: card.assignedAgentRole,
      qualificationScore: card.qualificationScore,
      bantData: {
        budget: null,
        authority: null,
        need_pain_point: card.painPointSummary,
        timeline: null,
      },
      aiExecutiveSummary: card.painPointSummary,
      estimatedDealValue: this.parseArmCardMoney(card as ArmKanbanCardVm),
      currency,
    });
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
    this.persistArmState();
    const moved = this.armKanbanCards().find((c) => c.id === cardId);
    if (moved) {
      this.syncArmCardToSqlite(moved);
    }
  }

  @HostListener('window:keydown', ['$event'])
  onArmCommandKeydown(event: KeyboardEvent): void {
    const key = (event.key || '').toLowerCase();
    const fromWindowDom = typeof window !== 'undefined' && event.currentTarget === window;

    if ((event.metaKey || event.ctrlKey) && key === 'k') {
      if (fromWindowDom && this.hotkeys) {
        return;
      }
      event.preventDefault();
      if (this.activeView() !== 'ARM_COMMAND') {
        this.setView('ARM_COMMAND');
      }
      this.showArmCommandPalette.update((v) => !v);
      return;
    }

    if (key === 'escape' && this.showArmCommandPalette()) {
      this.showArmCommandPalette.set(false);
      return;
    }

    if (
      this.activeView() !== 'ARM_COMMAND' ||
      this.showArmCommandPalette() ||
      this.editingApprovalId()
    ) {
      return;
    }
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

    if (fromWindowDom && event.defaultPrevented) {
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
      if (typeof window !== 'undefined' && window.electron?.arm) {
        void window.electron.arm.saveApproval(sim.queuedApproval);
      }
    }

    this.persistArmState();
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
    const decision = finalMsg !== proposedMsg ? 'EDITED_AND_APPROVED' : 'APPROVED';

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
              status: decision,
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
    this.persistArmState();

    if (typeof window !== 'undefined' && window.electron?.arm) {
      void window.electron.arm.resolveApproval({
        id,
        status: decision,
        approvedText: finalMsg,
        saveAsExample,
      });
    }
    if (typeof this.inboundGateway.resolveArmApproval === 'function') {
      void this.inboundGateway.resolveArmApproval({
        workspaceId: target.workspaceId,
        approvalId: id,
        decision,
        approvedText: finalMsg,
        saveAsExample,
      });
    }

    this.toast.success(`Acción aprobada y despachada en ${target.workspaceId}.`, 'HITL Aprobado');
  }

  takeoverHumanFromArmQueue(id: string): void {
    const target = this.armApprovalQueue().find((a) => a.id === id);
    if (!target) return;

    this.armApprovalQueue.set(
      this.armApprovalQueue().map((a) => (a.id === id ? { ...a, status: 'REJECTED' } : a)),
    );
    this.persistArmState();

    if (typeof window !== 'undefined' && window.electron?.arm) {
      void window.electron.arm.resolveApproval({ id, status: 'REJECTED' });
    }
    if (typeof this.inboundGateway.resolveArmApproval === 'function') {
      void this.inboundGateway.resolveArmApproval({
        workspaceId: target.workspaceId,
        approvalId: id,
        decision: 'REJECTED',
      });
    }

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
    this.persistArmState();
    if (typeof window !== 'undefined' && window.electron?.arm) {
      void window.electron.arm.saveApproval(res.approvalEntry);
    }
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
      this.persistArmState();
      if (typeof window !== 'undefined' && window.electron?.arm) {
        void window.electron.arm.saveApproval(ghostRes.approvalEntry);
      }
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

  syncLocalDealsToArmSilos(): number {
    const migrated = migrateLocalCrmDealsToArmCards(this.deals());
    const existingIds = new Set(this.armKanbanCards().map((c) => c.id));
    const newCards = migrated
      .filter((m) => !existingIds.has(m.id))
      .map((card) => ({
        ...card,
        estimatedValueNum: this.parseArmCardMoney(card as ArmKanbanCardVm),
      }));
    if (newCards.length > 0) {
      this.armKanbanCards.set([...newCards, ...this.armKanbanCards()]);
      this.persistArmState();
      for (const card of newCards) {
        this.syncArmCardToSqlite(card);
      }
      this.toast.success(
        `${newCards.length} trato(s) locales sincronizados hacia P2P_DESK / FINANCE_360 sin cruce de silos.`,
        'Migración Local ARM',
      );
    }
    return newCards.length;
  }

  private hydrateArmPersistenceState(): void {
    try {
      const savedSilo = this.storage.get<ArmWorkspaceId>('p2p.arm.active_silo');
      if (savedSilo === 'ARM_B2B' || savedSilo === 'P2P_DESK' || savedSilo === 'FINANCE_360') {
        this.activeArmSilo.set(savedSilo);
      }
      const demoEnabled = this.storage.get<boolean>('p2p.arm.demo_enabled') === true;
      const savedCards = this.storage.get<ReturnType<typeof this.armKanbanCards>>('p2p.arm.kanban_cards');
      if (Array.isArray(savedCards)) {
        const filtered = demoEnabled
          ? savedCards
          : savedCards.filter((c) => !ComplianceCockpitComponent.DEMO_ARM_CARD_IDS.has(c.id));
        this.armKanbanCards.set(filtered);
        if (filtered.length !== savedCards.length) {
          this.storage.set('p2p.arm.kanban_cards', filtered);
        }
      }
      const savedQueue = this.storage.get<ArmApprovalQueueItem[]>('p2p.arm.approval_queue');
      if (Array.isArray(savedQueue)) {
        this.armApprovalQueue.set(savedQueue);
      }
      const savedShadow = this.storage.get<ArmShadowExample[]>('p2p.arm.shadow_examples');
      if (Array.isArray(savedShadow)) {
        this.armShadowExamples.set(savedShadow);
      }
    } catch {
      /* fallback safely */
    }
    if (typeof window !== 'undefined' && window.electron?.arm) {
      void this.hydrateFromElectronArmRepo();
    }
  }

  private async hydrateFromElectronArmRepo(): Promise<void> {
    const armApi = window.electron?.arm;
    if (!armApi) return;
    try {
      const silos: ArmWorkspaceId[] = ['ARM_B2B', 'P2P_DESK', 'FINANCE_360'];
      const mergedCards = [...this.armKanbanCards()];
      const cardIndexById = new Map<string, number>();
      mergedCards.forEach((card, idx) => cardIndexById.set(card.id, idx));
      let leadsUpdated = false;

      const mergedApprovals = [...this.armApprovalQueue()];
      const approvalIds = new Set(mergedApprovals.map((a) => a.id));
      const mergedShadow = [...this.armShadowExamples()];
      const shadowIds = new Set(mergedShadow.map((s) => s.id));
      const mergedBanks = [...this.banks()];
      const bankIds = new Set(mergedBanks.map((b) => b.id));
      let banksUpdated = false;

      for (const ws of silos) {
        const remoteLeads = (await armApi.listLeads?.(ws)) as ElectronArmLeadDto[] | undefined;
        for (const lead of remoteLeads || []) {
          if (!lead || !lead.id) continue;
          const existingIdx = cardIndexById.get(lead.id);
          const valueNum = Number(lead.estimatedDealValue ?? 0);
          const formattedVal =
            lead.currency === 'USDT'
              ? `${this.formatDecimal(valueNum)} USDT`
              : `$${this.formatDecimal(valueNum)} ${lead.currency || 'USD'}`;
          const mappedCard: ArmKanbanCardVm = {
            id: lead.id,
            workspaceId: lead.workspaceId ?? ws,
            leadName: lead.fullName || lead.companyName || lead.id,
            companyName: lead.companyName || lead.workspaceId,
            stageSlug: lead.currentStageSlug,
            qualificationScore: Number(lead.qualificationScore ?? 0),
            painPointSummary:
              lead.bantData?.need_pain_point || lead.aiExecutiveSummary || 'Sincronizado SQLite',
            lastMessagePreview: lead.aiExecutiveSummary || 'Hydrated from Electron SQLite',
            assignedAgentRole: lead.assignedAgentRole || 'SDR_QUALIFIER',
            movedByAgentBadge: `SQLite (${lead.assignedAgentRole || 'ARM'})`,
            dealValueLabel: formattedVal,
            estimatedValueNum: valueNum,
            freeWindowLabel: 'SQLite Local-First',
            messages: existingIdx !== undefined ? mergedCards[existingIdx].messages : [],
            toolTraces: existingIdx !== undefined ? mergedCards[existingIdx].toolTraces : [],
          };
          if (existingIdx !== undefined) {
            mergedCards[existingIdx] = { ...mergedCards[existingIdx], ...mappedCard };
          } else {
            cardIndexById.set(lead.id, mergedCards.length);
            mergedCards.push(mappedCard);
          }
          leadsUpdated = true;
        }

        const remoteApprovals = (await armApi.listPendingApprovals(ws)) as ArmApprovalQueueItem[];
        for (const item of remoteApprovals || []) {
          if (item && item.id && !approvalIds.has(item.id)) {
            approvalIds.add(item.id);
            mergedApprovals.push(item);
          }
        }
        const remoteShadows = (await armApi.listShadowExamples({ workspaceId: ws, limit: 20 })) as ArmShadowExample[];
        for (const ex of remoteShadows || []) {
          if (ex && ex.id && !shadowIds.has(ex.id)) {
            shadowIds.add(ex.id);
            mergedShadow.push(ex);
          }
        }

        const remoteRails = await armApi.listBankRails?.(ws);
        for (const rail of remoteRails || []) {
          if (rail && rail.id && !bankIds.has(rail.id)) {
            bankIds.add(rail.id);
            mergedBanks.push({
              id: rail.id,
              scope: rail.workspaceId === 'FINANCE_360' ? 'FINANCE_360' : 'P2P_DESK',
              bankName: rail.bankName,
              currency: (rail.currency as FiatCurrency) || 'VES',
              holderDetailsText: rail.holderDetails || rail.bankName,
              currentBalanceFiat: Number(rail.currentBalanceFiat ?? 0),
              maxDailyCapFiat: Number(rail.maxDailyCapFiat ?? 50000),
              feePct: 0.3,
              maxBurstTxPer15Min: 5,
            });
            banksUpdated = true;
          }
        }
      }

      if (leadsUpdated) {
        this.armKanbanCards.set(mergedCards);
      }
      if (banksUpdated) {
        this.banks.set(mergedBanks);
        this.storage.set(CRM_STORAGE_KEYS.BANKS, mergedBanks);
      }
      if (mergedApprovals.length > this.armApprovalQueue().length) {
        this.armApprovalQueue.set(mergedApprovals);
      }
      if (mergedShadow.length > this.armShadowExamples().length) {
        this.armShadowExamples.set(mergedShadow);
      }
    } catch {
      /* desktop sqlite optional hydration */
    }
  }

  private persistArmState(): void {
    try {
      this.storage.set('p2p.arm.active_silo', this.activeArmSilo());
      this.storage.set('p2p.arm.kanban_cards', this.armKanbanCards());
      this.storage.set('p2p.arm.approval_queue', this.armApprovalQueue());
      this.storage.set('p2p.arm.shadow_examples', this.armShadowExamples());
    } catch {
      /* storage quota fallback */
    }
  }

  private historyHydrated = false;

  private async hydrateWhatsAppHistoryFromGateway(): Promise<void> {
    if (this.historyHydrated || typeof this.inboundGateway.fetchOutboxHistory !== 'function') {
      return;
    }
    this.historyHydrated = true;
    const events = await this.inboundGateway.fetchOutboxHistory(0);
    for (const evt of events) {
      if (evt.eventType === 'message_received') {
        this.ingestLiveWhatsAppMessageEvent(evt, true);
      }
    }
  }

  private handleIncomingArmOutboxEvent(evt: ArmOutboxSseEvent): void {
    if (evt.eventType === 'message_received') {
      this.ingestLiveWhatsAppMessageEvent(evt, false);
    }
    if (evt.eventType === 'approval_requested' && evt.payload['approval']) {
      const approval = evt.payload['approval'] as ArmApprovalQueueItem;
      const exists = this.armApprovalQueue().some((a) => a.id === approval.id);
      if (!exists) {
        this.armApprovalQueue.set([approval, ...this.armApprovalQueue()]);
        this.persistArmState();
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

  private ingestLiveWhatsAppMessageEvent(evt: ArmOutboxSseEvent, silentHistory = false): void {
    const direction = evt.payload['direction'] === 'OUTBOUND' ? 'OUTBOUND' : 'INBOUND';
    const rawPhone = String(
      (direction === 'OUTBOUND' ? evt.payload['recipientPhone'] : evt.payload['senderPhone']) ||
        evt.payload['senderPhone'] ||
        evt.aggregateId ||
        '',
    ).trim();
    const text = String(evt.payload['text'] || '').trim();
    if (!rawPhone || !text) return;

    const senderName = String(evt.payload['senderName'] || rawPhone).trim();
    const digits = rawPhone.replace(/\D/g, '') || rawPhone;
    if (digits.startsWith('120363') && digits.length >= 16) return;
    const timestamp = Number(evt.payload['timestamp'] || evt.timestamp || Date.now());
    const msgId = `sse-wa-${evt.id}`;
    const targetScope: WorkspaceScope =
      evt.workspaceId === 'FINANCE_360' ? 'FINANCE_360' : 'P2P_DESK';

    // 1. Upsert into Omnichannel Inbox conversations
    const existingConvs = this.conversations();
    const existingConv = existingConvs.find(
      (c) => (c.recipientPhoneOrIgId || '').replace(/\D/g, '') === digits,
    );
    const chatMsg: OmnichannelMessage = {
      id: msgId,
      conversationId: existingConv ? existingConv.id : `conv-wa-${digits}`,
      channel: 'WHATSAPP',
      direction,
      senderHandle: direction === 'OUTBOUND' ? 'WhatsApp Business' : rawPhone,
      text,
      timestamp,
    };

    if (existingConv) {
      const alreadyHas = existingConv.messages.some(
        (m) =>
          m.id === msgId ||
          (m.direction === direction &&
            m.text === text &&
            Math.abs(m.timestamp - timestamp) < 15_000),
      );
      if (!alreadyHas) {
        const updated = existingConvs.map((c) =>
          c.id === existingConv.id
            ? {
                ...c,
                contactName:
                  direction === 'INBOUND' &&
                  c.contactName === c.recipientPhoneOrIgId &&
                  senderName !== rawPhone
                    ? senderName
                    : c.contactName,
                lastInboundTimestamp:
                  direction === 'INBOUND'
                    ? Math.max(c.lastInboundTimestamp ?? 0, timestamp)
                    : c.lastInboundTimestamp,
                unreadCount: direction === 'INBOUND' && !silentHistory ? (c.unreadCount || 0) + 1 : c.unreadCount,
                messages: [...c.messages, chatMsg],
              }
            : c,
        );
        this.conversations.set(updated);
        this.saveConversations();
      }
    } else {
      const newConv: OmnichannelConversation = {
        id: `conv-wa-${digits}`,
        scope: targetScope,
        contactId: null,
        contactName: direction === 'INBOUND' ? senderName : rawPhone,
        channel: 'WHATSAPP',
        recipientPhoneOrIgId: rawPhone,
        lastInboundTimestamp: timestamp,
        unreadCount: direction === 'INBOUND' && !silentHistory ? 1 : 0,
        linkedDealId: null,
        messages: [chatMsg],
      };
      this.conversations.set([newConv, ...existingConvs]);
      this.saveConversations();
      if (!this.selectedConversationId()) {
        this.selectedConversationId.set(newConv.id);
      }
    }

    // 2. Upsert into ARM Kanban cards (real lead, $0.00 until quoted)
    const leadId = `wa-lead-${digits}`;
    const existingCards = this.armKanbanCards();
    const existingCard = existingCards.find((c) => c.id === leadId);
    const mediaBadge = `WA QR ${new Date(timestamp).toLocaleTimeString('es-VE', {
      hour: '2-digit',
      minute: '2-digit',
    })}`;
    const cardSender: 'LEAD' | 'AGENT' = direction === 'OUTBOUND' ? 'AGENT' : 'LEAD';

    if (existingCard) {
      const lastExisting = existingCard.messages[existingCard.messages.length - 1];
      const alreadyHas = lastExisting?.sender === cardSender && lastExisting?.text === text;
      if (!alreadyHas) {
        const updatedCards = existingCards.map((c) =>
          c.id === leadId
            ? {
                ...c,
                lastMessagePreview: text.slice(0, 120),
                freeWindowLabel: 'WhatsApp QR En Vivo',
                messages: [
                  ...c.messages,
                  {
                    sender: cardSender,
                    text,
                    mediaBadge,
                  },
                ],
              }
            : c,
        );
        this.armKanbanCards.set(updatedCards);
        this.persistArmState();
      }
    } else {
      const firstStage =
        evt.workspaceId === 'P2P_DESK'
          ? 'orden-p2p-creada'
          : evt.workspaceId === 'FINANCE_360'
            ? 'nuevo-pedido'
            : 'prospecto-entrante';
      const newCard: ArmKanbanCardVm = {
        id: leadId,
        workspaceId: evt.workspaceId,
        leadName: direction === 'INBOUND' ? senderName : rawPhone,
        companyName: rawPhone,
        stageSlug: firstStage,
        qualificationScore: 35,
        painPointSummary: text.slice(0, 120),
        lastMessagePreview: text.slice(0, 120),
        assignedAgentRole: 'SDR_QUALIFIER',
        movedByAgentBadge: 'WhatsApp QR',
        dealValueLabel: '$0.00 USD',
        estimatedValueNum: 0,
        freeWindowLabel: 'WhatsApp QR En Vivo',
        messages: [
          {
            sender: cardSender,
            text,
            mediaBadge,
          },
        ],
        toolTraces: [],
      };
      this.armKanbanCards.set([newCard, ...existingCards]);
      if (!this.selectedArmLeadId()) {
        this.selectedArmLeadId.set(leadId);
      }
      this.persistArmState();
    }

    if (direction === 'INBOUND' && !silentHistory) {
      this.toast.info(`${senderName}: ${text.slice(0, 70)}`, 'WhatsApp Entrante');
    }
  }
}

