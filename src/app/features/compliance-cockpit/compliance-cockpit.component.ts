import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { StorageService } from '../../core/storage';
import { ToastService } from '../../core/toast.service';
import { Finance360Service } from '../../core/finance-360.service';
import { computeTriMonetaryAmount } from '../../core/models/finance-360.models';
import {
  compileLiveDeskState,
  verifyReferenceCollision,
  calculateBankReconciliationAdjustment,
  calculateDirectCommercialQuote,
  buildClientWhatsAppStatement,
  createFinance360ProfitSettlement,
  type WorkspaceScope,
  type FiatCurrency,
  type CrmContactCategory,
  type OperationalBankAccount,
  type RealTimeTradeEntry,
  type CrmContactLedger,
  type DailyNetProfitTransferPayload,
  type CompiledDeskState,
  type DirectCommercialQuote,
} from '@p2p/core';

const STORAGE_KEYS = {
  TRADES: 'p2p.compliance.trades',
  BANKS: 'p2p.compliance.banks',
  CONTACTS: 'p2p.compliance.contacts',
  SETTLEMENTS: 'p2p.compliance.settlements',
  ACTIVE_SCOPE: 'p2p.compliance.active-scope',
  PRIVACY_MODE: 'p2p.compliance.privacy-mode',
} as const;

@Component({
  selector: 'app-compliance-cockpit',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './compliance-cockpit.html',
  styleUrls: ['./compliance-cockpit.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ComplianceCockpitComponent {
  private readonly storage = inject(StorageService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly finance360 = inject(Finance360Service);

  // ---------------------------------------------------------------------------
  // 1. DUAL-VAULT SCOPE & PRIVACY STATE (ZERO-SEED POLICY)
  // ---------------------------------------------------------------------------
  readonly activeScope = signal<WorkspaceScope>(
    (this.storage.get<WorkspaceScope>(STORAGE_KEYS.ACTIVE_SCOPE) ?? 'P2P_DESK') === 'FINANCE_360'
      ? 'FINANCE_360'
      : 'P2P_DESK',
  );

  readonly privacyMode = signal<boolean>(
    this.storage.get<boolean>(STORAGE_KEYS.PRIVACY_MODE) ?? false,
  );

  // Clean persistent signals (initialized strictly as empty arrays if no user data exists)
  readonly trades = signal<RealTimeTradeEntry[]>(
    this.storage.get<RealTimeTradeEntry[]>(STORAGE_KEYS.TRADES) ?? [],
  );

  readonly banks = signal<OperationalBankAccount[]>(
    this.storage.get<OperationalBankAccount[]>(STORAGE_KEYS.BANKS) ?? [],
  );

  readonly contacts = signal<CrmContactLedger[]>(
    this.storage.get<CrmContactLedger[]>(STORAGE_KEYS.CONTACTS) ?? [],
  );

  readonly settlements = signal<DailyNetProfitTransferPayload[]>(
    this.storage.get<DailyNetProfitTransferPayload[]>(STORAGE_KEYS.SETTLEMENTS) ?? [],
  );

  // Clock tick for live 15-min burst cooldown calculations
  readonly clockTick = signal<number>(Date.now());

  // ---------------------------------------------------------------------------
  // 2. COMPILED LIVE DESK STATE
  // ---------------------------------------------------------------------------
  readonly deskState = computed<CompiledDeskState>(() => {
    return compileLiveDeskState(
      this.trades(),
      this.banks(),
      this.contacts(),
      this.activeScope(),
      this.clockTick(),
    );
  });

  readonly deskKpis = computed(() => this.deskState().kpis);

  readonly activeBanks = computed<OperationalBankAccount[]>(() => {
    const scope = this.activeScope();
    return this.banks().filter((b) => b.scope === scope);
  });

  readonly bankCards = computed(() => {
    const telemetryMap = new Map(this.deskState().bankTelemetry.map((t) => [t.bankAccountId, t]));
    return this.activeBanks().map((b) => ({
      account: b,
      telemetry: telemetryMap.get(b.id) ?? {
        bankAccountId: b.id,
        bankName: b.bankName,
        currency: b.currency,
        currentBalanceFiat: b.currentBalanceFiat,
        maxDailyCapFiat: b.maxDailyCapFiat,
        dailyUsedFiat: 0,
        dailyUsagePct: 0,
        recent15MinTxCount: 0,
        maxBurstTxPer15Min: b.maxBurstTxPer15Min,
        status: 'AVAILABLE' as const,
        isRecommended: false,
      },
    }));
  });

  // Today's date ISO format (YYYY-MM-DD)
  readonly todayDateIso = computed<string>(() => {
    const d = new Date(this.clockTick());
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  });

  // Check if today's profit is already settled into Finance 360
  readonly isTodaySettled = computed<boolean>(() => {
    const todaySettlementId = `SETTLE-${this.todayDateIso()}`;
    return this.settlements().some((s) => s.settlementId === todaySettlementId);
  });

  // ---------------------------------------------------------------------------
  // 3. OPERATIONAL TOOLBAR: REFERENCE COLLISION VERIFIER & TRADE REGISTRATION
  // ---------------------------------------------------------------------------
  readonly candidateRef = signal<string>('');

  readonly referenceCheck = computed(() => {
    return verifyReferenceCollision(this.trades(), this.candidateRef());
  });

  // Quick trade registration form signals
  readonly tradeClientSelect = signal<string>('');
  readonly tradeClientNameInput = signal<string>('');
  readonly tradeClientDocInput = signal<string>('');
  readonly tradeBankId = signal<string>('');
  readonly tradeAmountUsdt = signal<number | null>(null);
  readonly tradeAppliedRate = signal<number | null>(null);
  readonly tradeReplacementRate = signal<number | null>(null);
  readonly tradeReferenceId = signal<string>('');

  // ---------------------------------------------------------------------------
  // 4. BANK MANAGEMENT & RECONCILIATION MODAL STATE
  // ---------------------------------------------------------------------------
  readonly showAddBankModal = signal<boolean>(false);
  readonly newBankName = signal<string>('');
  readonly newBankCurrency = signal<FiatCurrency>('VES');
  readonly newBankHolderName = signal<string>('');
  readonly newBankDocId = signal<string>('');
  readonly newBankPhone = signal<string>('');
  readonly newBankAccountNumber = signal<string>('');
  readonly newBankInitialBalance = signal<number | null>(0);
  readonly newBankDailyCap = signal<number | null>(50000);
  readonly newBankFeePct = signal<number | null>(0.3);
  readonly newBankBurstMax = signal<number | null>(5);

  // Bank reconciliation inline state
  readonly reconcilingBankId = signal<string | null>(null);
  readonly realBankBalanceInput = signal<number | null>(null);

  // ---------------------------------------------------------------------------
  // 5. CRM CONTACT MANAGEMENT STATE
  // ---------------------------------------------------------------------------
  readonly showAddContactModal = signal<boolean>(false);
  readonly newContactName = signal<string>('');
  readonly newContactDocId = signal<string>('');
  readonly newContactCategory = signal<CrmContactCategory>('CLIENT_P2P');
  readonly contactSearchQuery = signal<string>('');
  readonly selectedContactId = signal<string | null>(null);

  readonly selectedContact = computed<CrmContactLedger | null>(() => {
    const id = this.selectedContactId();
    if (!id) return null;
    return this.deskState().contacts.find((c) => c.clientId === id) ?? null;
  });

  readonly filteredContacts = computed<CrmContactLedger[]>(() => {
    const q = this.contactSearchQuery().trim().toLowerCase();
    const list = this.deskState().contacts;
    if (!q) return list;
    return list.filter(
      (c) =>
        c.clientName.toLowerCase().includes(q) ||
        c.clientDocId.toLowerCase().includes(q),
    );
  });

  // ---------------------------------------------------------------------------
  // 6. AUDIT LOG FILTERS
  // ---------------------------------------------------------------------------
  readonly tradeSearchQuery = signal<string>('');
  readonly filterBankId = signal<string>('');
  readonly filterClientId = signal<string>('');

  readonly displayedTrades = computed<RealTimeTradeEntry[]>(() => {
    let list = this.deskState().filteredTrades;
    const q = this.tradeSearchQuery().trim().toLowerCase();
    const bankId = this.filterBankId();
    const clientId = this.filterClientId();

    if (q) {
      list = list.filter(
        (t) =>
          t.clientName.toLowerCase().includes(q) ||
          t.clientDocId.toLowerCase().includes(q) ||
          t.bankReferenceId.toLowerCase().includes(q) ||
          t.bankName.toLowerCase().includes(q),
      );
    }

    if (bankId) {
      list = list.filter((t) => t.bankAccountId === bankId);
    }

    if (clientId) {
      list = list.filter((t) => t.clientId === clientId);
    }

    return [...list].sort((a, b) => b.timestamp - a.timestamp);
  });

  // ---------------------------------------------------------------------------
  // 7. DIRECT COMMERCIAL CALCULATOR
  // ---------------------------------------------------------------------------
  readonly calcAmountUsdt = signal<number | null>(1000);
  readonly calcReplacementRate = signal<number | null>(82.0);
  readonly calcClientRate = signal<number | null>(84.5);
  readonly calcBankFeePct = signal<number | null>(0.3);

  readonly commercialQuote = computed<DirectCommercialQuote>(() => {
    return calculateDirectCommercialQuote(
      this.calcAmountUsdt() ?? 0,
      this.calcReplacementRate() ?? 0,
      this.calcClientRate() ?? 0,
      this.calcBankFeePct() ?? 0,
    );
  });

  // Running account adjustment input
  readonly contactBalanceAdjustAmount = signal<number | null>(null);

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
  // ACTIONS: VAULT SCOPE & FINANCE 360 BRIDGE
  // ---------------------------------------------------------------------------
  setScope(scope: WorkspaceScope): void {
    this.activeScope.set(scope);
    this.storage.set(STORAGE_KEYS.ACTIVE_SCOPE, scope);
    this.filterClientId.set('');
    this.filterBankId.set('');
    this.selectedContactId.set(null);
    this.toast.info(
      scope === 'P2P_DESK'
        ? 'Bóveda P2P / OTC activada.'
        : 'Bóveda CRM & Finanzas 360 activada.',
      'Aislamiento de Bóveda',
    );
  }

  togglePrivacyMode(): void {
    const next = !this.privacyMode();
    this.privacyMode.set(next);
    this.storage.set(STORAGE_KEYS.PRIVACY_MODE, next);
    this.toast.info(
      next ? 'Modo Privacidad [ACTIVO] (cifras ocultas)' : 'Modo Privacidad [DESACTIVADO]',
      'Vista Operativa',
    );
  }

  navigateToFinance360(): void {
    void this.router.navigate(['/finanzas-360']);
  }

  transferDailyProfitToFinance360(): void {
    const todayTrades = this.deskState().todayTrades;
    const dateIso = this.todayDateIso();
    const existingSettlements = this.settlements();

    const result = createFinance360ProfitSettlement(todayTrades, dateIso, existingSettlements);

    if (!result.success || !result.payload) {
      if (result.error === 'SETTLEMENT_ALREADY_EXISTS') {
        this.toast.warn('La ganancia de hoy ya fue transferida a Finanzas 360.', 'Corte Diario');
      } else if (result.error === 'NO_POSITIVE_PROFIT_TO_TRANSFER') {
        this.toast.warn('No hay ganancia neta positiva acumulada hoy para transferir.', 'Corte Diario');
      } else {
        this.toast.warn('No hay operaciones registradas hoy en la mesa P2P.', 'Corte Diario');
      }
      return;
    }

    const payload = result.payload;

    // 1. Update internal settlement history
    const nextSettlements = [...existingSettlements, payload];
    this.settlements.set(nextSettlements);
    this.storage.set(STORAGE_KEYS.SETTLEMENTS, nextSettlements);

    // 2. Direct Bridge into Finance 360 ledger
    try {
      this.finance360.addIncome({
        title: `Corte Diario P2P Desk (${payload.dateIso})`,
        scope: 'business',
        category: 'p2p_profit',
        channel: 'crypto',
        triMonetary: computeTriMonetaryAmount(payload.netProfitUsdt, 'USDT', 1, 1),
        date: payload.dateIso,
        referenceNumber: payload.settlementId,
        notes: `Transferencia automática de ganancia P2P. Liquidación #${payload.settlementId} (${payload.tradesCount} operaciones verificadas).`,
        p2pBridgeMetadata: {
          operationsCount: payload.tradesCount,
          realizedPnlVes: 0,
          realizedPnlUsdt: payload.netProfitUsdt,
          importedAt: new Date(payload.timestamp).toISOString(),
        },
      });

      this.toast.success(
        `💰 +$${payload.netProfitUsdt.toFixed(2)} USDT transferidos con éxito a Finanzas 360 (#${payload.settlementId}).`,
        'Puente Liquidación 360',
      );
    } catch {
      this.toast.warn(
        `Liquidación #${payload.settlementId} registrada localmente. Verifique Finanzas 360.`,
        'Liquidación P2P',
      );
    }
  }

  // ---------------------------------------------------------------------------
  // ACTIONS: TRADE REGISTRATION & VERIFICATION
  // ---------------------------------------------------------------------------
  onClientSelectChange(clientId: string): void {
    this.tradeClientSelect.set(clientId);
    if (clientId) {
      const contact = this.deskState().contacts.find((c) => c.clientId === clientId);
      if (contact) {
        this.tradeClientNameInput.set(contact.clientName);
        this.tradeClientDocInput.set(contact.clientDocId);
      }
    }
  }

  registerTrade(): void {
    const scope = this.activeScope();
    const amountUsdt = this.tradeAmountUsdt();
    const appliedRate = this.tradeAppliedRate();
    const replacementRate = this.tradeReplacementRate() ?? appliedRate ?? 0;
    const bankId = this.tradeBankId();
    const ref = this.tradeReferenceId().trim();

    if (!amountUsdt || amountUsdt <= 0) {
      this.toast.warn('Ingrese un monto válido en USDT mayor a 0.', 'Formulario Incompleto');
      return;
    }
    if (!appliedRate || appliedRate <= 0) {
      this.toast.warn('Ingrese la tasa aplicada al cliente.', 'Formulario Incompleto');
      return;
    }
    if (!bankId) {
      this.toast.warn('Seleccione una cuenta bancaria operativa.', 'Formulario Incompleto');
      return;
    }

    // Check reference collision
    if (ref) {
      const collision = verifyReferenceCollision(this.trades(), ref);
      if (collision.isDuplicate && collision.existingEntry) {
        const confirmDup = window.confirm(
          `⚠️ ALERTA DE COLISIÓN:\nLa referencia "${ref}" ya fue registrada previamente en la operación #${collision.existingEntry.id} (${collision.existingEntry.clientName} por ${collision.existingEntry.fiatAmount} ${collision.existingEntry.fiatCurrency}).\n\n¿Desea asentar esta operación de todos modos?`,
        );
        if (!confirmDup) return;
      }
    }

    const bank = this.banks().find((b) => b.id === bankId);
    if (!bank) {
      this.toast.error('Banco seleccionado no encontrado.', 'Error');
      return;
    }

    // Resolve client
    let clientId = this.tradeClientSelect();
    let clientName = this.tradeClientNameInput().trim();
    let clientDoc = this.tradeClientDocInput().trim();

    if (!clientName) {
      clientName = `Cliente-${ref || Date.now().toString().slice(-4)}`;
    }

    if (!clientId) {
      // Find existing contact by document or name
      const existing = this.contacts().find(
        (c) =>
          c.scope === scope &&
          ((clientDoc && c.clientDocId === clientDoc) ||
            c.clientName.toLowerCase() === clientName.toLowerCase()),
      );

      if (existing) {
        clientId = existing.clientId;
      } else {
        // Auto-register new CRM contact
        clientId = `CLI-${Date.now().toString().slice(-6)}`;
        const newContact: CrmContactLedger = {
          clientId,
          scope,
          clientName,
          clientDocId: clientDoc,
          category: scope === 'P2P_DESK' ? 'CLIENT_P2P' : 'SUPPLIER_360',
          pendingBalanceUsdt: 0,
          pendingBalanceFiat: 0,
          lifetimeVolumeUsdt: 0,
          lifetimeNetPnlUsdt: 0,
          verifiedReferences: ref ? [ref] : [],
          lastActivityTimestamp: Date.now(),
        };
        const nextContacts = [...this.contacts(), newContact];
        this.contacts.set(nextContacts);
        this.storage.set(STORAGE_KEYS.CONTACTS, nextContacts);
      }
    }

    // Financial calculations
    const fiatAmount = Math.round(amountUsdt * appliedRate * 100) / 100;
    const frictionFiat = Math.round(fiatAmount * (bank.feePct / 100) * 100) / 100;
    const netFiatProfit =
      Math.round((fiatAmount - frictionFiat - amountUsdt * replacementRate) * 100) / 100;
    const netPnlUsdt =
      replacementRate > 0 ? Math.round((netFiatProfit / replacementRate) * 100) / 100 : 0;

    const newTrade: RealTimeTradeEntry = {
      id: `TRD-${Date.now().toString().slice(-6)}`,
      timestamp: Date.now(),
      scope,
      clientId,
      clientName,
      clientDocId: clientDoc,
      bankAccountId: bank.id,
      bankName: bank.bankName,
      bankReferenceId: ref,
      fiatCurrency: bank.currency,
      fiatAmount,
      cryptoAmountUsdt: amountUsdt,
      appliedRate,
      replacementRate,
      netPnlUsdt,
      frictionFiat,
    };

    // 1. Insert trade
    const nextTrades = [newTrade, ...this.trades()];
    this.trades.set(nextTrades);
    this.storage.set(STORAGE_KEYS.TRADES, nextTrades);

    // 2. Update bank balance
    const nextBanks = this.banks().map((b) => {
      if (b.id === bank.id) {
        return {
          ...b,
          currentBalanceFiat: Math.round((b.currentBalanceFiat + fiatAmount) * 100) / 100,
        };
      }
      return b;
    });
    this.banks.set(nextBanks);
    this.storage.set(STORAGE_KEYS.BANKS, nextBanks);

    // Reset inputs
    this.tradeAmountUsdt.set(null);
    this.tradeAppliedRate.set(null);
    this.tradeReplacementRate.set(null);
    this.tradeReferenceId.set('');
    this.candidateRef.set('');

    this.toast.success(
      `⚡ Operación #${newTrade.id} registrada (+${newTrade.netPnlUsdt.toFixed(2)} USDT PnL).`,
      'Operación Asentada',
    );
  }

  deleteTrade(tradeId: string): void {
    const trade = this.trades().find((t) => t.id === tradeId);
    if (!trade) return;

    const confirmDel = window.confirm(
      `¿Eliminar la operación #${trade.id} (${trade.cryptoAmountUsdt} USDT - ${trade.clientName}) de la bitácora?`,
    );
    if (!confirmDel) return;

    const nextTrades = this.trades().filter((t) => t.id !== tradeId);
    this.trades.set(nextTrades);
    this.storage.set(STORAGE_KEYS.TRADES, nextTrades);
    this.toast.info(`Operación #${tradeId} eliminada.`, 'Bitácora');
  }

  // ---------------------------------------------------------------------------
  // ACTIONS: BANK MANAGEMENT
  // ---------------------------------------------------------------------------
  saveNewBank(): void {
    const name = this.newBankName().trim();
    if (!name) {
      this.toast.warn('Ingrese el nombre del banco o riel.', 'Campo Requerido');
      return;
    }

    const newBank: OperationalBankAccount = {
      id: `BNK-${Date.now().toString().slice(-6)}`,
      scope: this.activeScope(),
      bankName: name,
      currency: this.newBankCurrency(),
      holderDetails: {
        holderName: this.newBankHolderName().trim() || name,
        documentId: this.newBankDocId().trim(),
        phone: this.newBankPhone().trim(),
        accountNumber: this.newBankAccountNumber().trim(),
      },
      currentBalanceFiat: this.newBankInitialBalance() ?? 0,
      maxDailyCapFiat: this.newBankDailyCap() ?? 50000,
      feePct: this.newBankFeePct() ?? 0.3,
      maxBurstTxPer15Min: this.newBankBurstMax() ?? 5,
    };

    const nextBanks = [...this.banks(), newBank];
    this.banks.set(nextBanks);
    this.storage.set(STORAGE_KEYS.BANKS, nextBanks);

    this.showAddBankModal.set(false);
    this.resetNewBankForm();
    this.toast.success(`Banco "${newBank.bankName}" agregado con éxito.`, 'Escudo Bancario');
  }

  private resetNewBankForm(): void {
    this.newBankName.set('');
    this.newBankHolderName.set('');
    this.newBankDocId.set('');
    this.newBankPhone.set('');
    this.newBankAccountNumber.set('');
    this.newBankInitialBalance.set(0);
    this.newBankDailyCap.set(50000);
    this.newBankFeePct.set(0.3);
    this.newBankBurstMax.set(5);
  }

  copyBankDetails(bank: OperationalBankAccount): void {
    const text = `🏦 *DATOS BANCARIOS — ${bank.bankName}*
Titular: ${bank.holderDetails.holderName}
Documento: ${bank.holderDetails.documentId}
Teléfono / Pago Móvil: ${bank.holderDetails.phone}
Nro de Cuenta: ${bank.holderDetails.accountNumber}
Moneda: ${bank.currency}`;

    void navigator.clipboard.writeText(text);
    this.toast.info(`Datos de ${bank.bankName} copiados al portapapeles.`, '1-Click Copy');
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

    const nextBanks = this.banks().map((b) => {
      if (b.id === bankId) {
        return { ...b, currentBalanceFiat: realBalance };
      }
      return b;
    });

    this.banks.set(nextBanks);
    this.storage.set(STORAGE_KEYS.BANKS, nextBanks);
    this.reconcilingBankId.set(null);

    this.toast.success(
      `Saldo de ${bank.bankName} ajustado a ${realBalance.toFixed(2)} ${bank.currency} (Ajuste: ${adj.formattedDrift}).`,
      'Cuadre Bancario',
    );
  }

  deleteBank(bankId: string): void {
    const bank = this.banks().find((b) => b.id === bankId);
    if (!bank) return;

    const confirmDel = window.confirm(
      `¿Eliminar la cuenta bancaria "${bank.bankName}" (${bank.currency})?`,
    );
    if (!confirmDel) return;

    const nextBanks = this.banks().filter((b) => b.id !== bankId);
    this.banks.set(nextBanks);
    this.storage.set(STORAGE_KEYS.BANKS, nextBanks);
    this.toast.info(`Banco "${bank.bankName}" eliminado.`, 'Escudo Bancario');
  }

  // ---------------------------------------------------------------------------
  // ACTIONS: CRM CONTACTS & RUNNING ACCOUNT
  // ---------------------------------------------------------------------------
  saveNewContact(): void {
    const name = this.newContactName().trim();
    if (!name) {
      this.toast.warn('Ingrese el nombre del contacto o cliente.', 'Campo Requerido');
      return;
    }

    const newContact: CrmContactLedger = {
      clientId: `CLI-${Date.now().toString().slice(-6)}`,
      scope: this.activeScope(),
      clientName: name,
      clientDocId: this.newContactDocId().trim(),
      category: this.newContactCategory(),
      pendingBalanceUsdt: 0,
      pendingBalanceFiat: 0,
      lifetimeVolumeUsdt: 0,
      lifetimeNetPnlUsdt: 0,
      verifiedReferences: [],
      lastActivityTimestamp: Date.now(),
    };

    const nextContacts = [...this.contacts(), newContact];
    this.contacts.set(nextContacts);
    this.storage.set(STORAGE_KEYS.CONTACTS, nextContacts);

    this.showAddContactModal.set(false);
    this.newContactName.set('');
    this.newContactDocId.set('');
    this.selectedContactId.set(newContact.clientId);
    this.toast.success(`Contacto "${newContact.clientName}" registrado con éxito.`, 'Padrón CRM');
  }

  selectContact(clientId: string): void {
    this.selectedContactId.set(clientId);
    this.tradeClientSelect.set(clientId);
    this.onClientSelectChange(clientId);
  }

  adjustContactBalance(mode: 'POSITIVE' | 'NEGATIVE' | 'ZERO'): void {
    const contact = this.selectedContact();
    if (!contact) return;

    if (mode === 'ZERO') {
      const confirmZero = window.confirm(
        `¿Saldar la cuenta de ${contact.clientName} a $0.00 USDT?`,
      );
      if (!confirmZero) return;

      const nextContacts = this.contacts().map((c) => {
        if (c.clientId === contact.clientId) {
          return { ...c, pendingBalanceUsdt: 0, pendingBalanceFiat: 0 };
        }
        return c;
      });
      this.contacts.set(nextContacts);
      this.storage.set(STORAGE_KEYS.CONTACTS, nextContacts);
      this.toast.success(`Cuenta de ${contact.clientName} saldada a $0.00.`, 'Cuenta Corriente');
      return;
    }

    const amount = this.contactBalanceAdjustAmount();
    if (!amount || amount <= 0) {
      this.toast.warn('Ingrese un monto válido a ajustar.', 'Monto Inválido');
      return;
    }

    const delta = mode === 'POSITIVE' ? amount : -amount;
    const newBalUsdt = Math.round((contact.pendingBalanceUsdt + delta) * 100) / 100;

    const nextContacts = this.contacts().map((c) => {
      if (c.clientId === contact.clientId) {
        return { ...c, pendingBalanceUsdt: newBalUsdt };
      }
      return c;
    });

    this.contacts.set(nextContacts);
    this.storage.set(STORAGE_KEYS.CONTACTS, nextContacts);
    this.contactBalanceAdjustAmount.set(null);

    this.toast.success(
      `Saldo de ${contact.clientName} actualizado a ${newBalUsdt.toFixed(2)} USDT.`,
      'Cuenta Corriente',
    );
  }

  copyWhatsAppStatement(): void {
    const contact = this.selectedContact();
    if (!contact) return;

    const statement = buildClientWhatsAppStatement(
      contact,
      this.deskState().filteredTrades,
      false, // Never leak operator internal profit to the client
    );

    void navigator.clipboard.writeText(statement);
    this.toast.success(
      `Estado de cuenta de ${contact.clientName} copiado al portapapeles.`,
      'WhatsApp CRM',
    );
  }

  filterBySelectedContact(): void {
    const contact = this.selectedContact();
    if (contact) {
      this.filterClientId.set(contact.clientId);
      this.toast.info(`Bitácora filtrada por "${contact.clientName}".`, 'Filtro Activo');
    }
  }

  clearContactFilter(): void {
    this.filterClientId.set('');
    this.toast.info('Filtro de cliente limpiado.', 'Filtro Desactivado');
  }
}
