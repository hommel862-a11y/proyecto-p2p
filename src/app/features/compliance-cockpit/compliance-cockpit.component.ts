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
} from '@p2p/core';

export type CrmModuleView =
  | 'DASHBOARD'
  | 'KANBAN'
  | 'CONTACTS'
  | 'BANKS'
  | 'ACTIVITIES'
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

  constructor() {
    this.gatewaySubscription = this.inboundGateway.receipt$.subscribe((receipt) => {
      this.handleInboundReceipt(receipt);
    });
  }

  ngOnDestroy(): void {
    this.gatewaySubscription?.unsubscribe();
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
    safeHydrateCrmCollection<DailyNetProfitTransferPayload>(this.storage.get(CRM_STORAGE_KEYS.SETTLEMENTS)),
  );

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

  // ---------------------------------------------------------------------------
  // 3. CLIPBOARD SMS PARSER & ANTI-FRAUDE VERIFIER STATE
  // ---------------------------------------------------------------------------
  readonly candidateRef = signal<string>('');
  readonly rawClipboardInput = signal<string>('');

  readonly referenceCheck = computed(() => {
    return verifyReferenceCollision(this.deals(), this.candidateRef());
  });

  readonly parsedClipboard = computed<ClipboardParseResult>(() => {
    return parseBankSmsClipboard(this.rawClipboardInput());
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

  readonly filteredContacts = computed<CrmContact[]>(() => {
    const q = this.contactSearchQuery().trim().toLowerCase();
    const list = this.workspaceState().contacts;
    if (!q) return list;
    return list.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.documentId.toLowerCase().includes(q) ||
        c.phoneOrContact.toLowerCase().includes(q),
    );
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

  moveDealToStage(dealId: string, targetStage: PipelineStage): void {
    const deal = this.deals().find((d) => d.id === dealId);
    if (!deal) return;

    if (targetStage === 'STAGE_4_CLOSED' && !deal.bankReferenceId.trim()) {
      this.promptClosingDeal.set({
        deal,
        reference: '',
        isDuplicate: false,
      });
      return;
    }

    this.executeStageTransition(deal, targetStage, deal.bankReferenceId);
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
  exportDataJson(): void {
    const backup = {
      version: '2.4',
      timestamp: Date.now(),
      scope: this.activeScope(),
      deals: this.deals(),
      contacts: this.contacts(),
      banks: this.banks(),
      activities: this.activities(),
      settlements: this.settlements(),
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

  importDataJson(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = JSON.parse(reader.result as string);
        const report = validateAndSanitizeCrmBackupPayload(raw, this.activeScope());

        if (!report.valid) {
          this.toast.error(report.errors[0] || 'Formato de archivo inválido.', 'Error de Importación');
          return;
        }

        const { deals, contacts, banks, activities, settlements } = report.sanitizedPayload;
        this.deals.set(deals);
        this.contacts.set(contacts);
        this.banks.set(banks);
        this.activities.set(activities);
        this.settlements.set(settlements);

        this.storage.set(CRM_STORAGE_KEYS.DEALS, deals);
        this.storage.set(CRM_STORAGE_KEYS.CONTACTS, contacts);
        this.storage.set(CRM_STORAGE_KEYS.BANKS, banks);
        this.storage.set(CRM_STORAGE_KEYS.ACTIVITIES, activities);
        this.storage.set(CRM_STORAGE_KEYS.SETTLEMENTS, settlements);

        if (report.quarantinedCount > 0) {
          this.toast.warn(
            `Base de datos restaurada (${deals.length} tratos, ${contacts.length} contactos). Se omitieron ${report.quarantinedCount} registros corruptos o sin ámbito.`,
            'Importación con Advertencias',
          );
        } else {
          this.toast.success(
            `Base de datos restaurada correctamente (${deals.length} tratos, ${contacts.length} contactos, ${banks.length} bancos).`,
            'Importación Exitosa',
          );
        }
      } catch {
        this.toast.error('No se pudo procesar el archivo JSON.', 'Error');
      }
    };
    reader.readAsText(file);
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
}
