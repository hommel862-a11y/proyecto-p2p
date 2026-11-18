import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { formatFiatNumber } from '@p2p/core';
import type {
  ArmWorkspaceId,
  BankLiveTelemetry,
  CrmBankAccount,
  CrmContact,
  PipelineDeal,
} from '../../crm-ui.models';

type DealStage = PipelineDeal['stage'];

export const CONTACTS_RAILS_SUB_MODE = {
  CONTACTS: 'CONTACTS',
  RAILS: 'RAILS',
} as const;

export type ContactsRailsSubMode =
  (typeof CONTACTS_RAILS_SUB_MODE)[keyof typeof CONTACTS_RAILS_SUB_MODE];

export interface AdjustBalancePayload {
  contactId: string;
  deltaUsdt: number;
  settleZero?: boolean;
}

export interface ReconcileBankPayload {
  bankId: string;
  realBalanceFiat: number;
}

const CAPACITY_SEGMENT_INDICES: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7];

@Component({
  selector: 'app-crm-contacts-rails',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './crm-contacts-rails.component.html',
  styleUrl: './crm-contacts-rails.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.silo-b2b]': "activeSilo() === 'ARM_B2B'",
    '[class.silo-p2p]': "activeSilo() === 'P2P_DESK'",
    '[class.silo-360]': "activeSilo() === 'FINANCE_360'",
    '[class.privacy-active]': 'privacyMode()',
  },
})
export class CrmContactsRailsComponent {
  readonly activeSilo = input<ArmWorkspaceId>('P2P_DESK');
  readonly subMode = input<ContactsRailsSubMode>('CONTACTS');
  readonly contacts = input<CrmContact[]>([]);
  readonly selectedContact = input<CrmContact | null>(null);
  readonly selectedContactDeals = input<PipelineDeal[]>([]);
  readonly selectedContactLtvUsdt = input<number>(0);
  readonly vectorMemories = input<string[]>([]);
  readonly contactSearch = input<string>('');
  readonly contactFilter = input<string>('ALL');
  readonly banks = input<CrmBankAccount[]>([]);
  readonly bankTelemetry = input<BankLiveTelemetry[]>([]);
  readonly totalBankCapacityFiat = input<number>(0);
  readonly availableRailsCount = input<number>(0);
  readonly privacyMode = input<boolean>(false);

  readonly subModeChange = output<ContactsRailsSubMode>();
  readonly selectContact = output<string>();
  readonly contactSearchChange = output<string>();
  readonly contactFilterChange = output<string>();
  readonly newContact = output<void>();
  readonly adjustBalance = output<AdjustBalancePayload>();
  readonly sendWaStatement = output<void>();
  readonly openChatForContact = output<CrmContact>();
  readonly newDealForContact = output<CrmContact>();
  readonly copyPaymentDetails = output<string>();
  readonly newBank = output<void>();
  readonly copyBankDetails = output<string>();
  readonly reconcileBank = output<ReconcileBankPayload>();
  readonly deleteBank = output<string>();

  readonly adjustAmountDraft = signal<number | null>(null);
  readonly reconcilingBankId = signal<string | null>(null);
  readonly reconcileBalanceDraft = signal<number | null>(null);
  readonly capacitySegments = CAPACITY_SEGMENT_INDICES;

  readonly filteredContacts = computed<CrmContact[]>(() => {
    const query = this.contactSearch().trim().toLowerCase();
    const filter = this.contactFilter();
    return this.contacts().filter((c) => {
      if (filter === 'WITH_BALANCE' && Math.abs(c.pendingBalanceUsdt) < 0.01) {
        return false;
      }
      if (filter !== 'ALL' && filter !== 'WITH_BALANCE' && c.category !== filter) {
        return false;
      }
      if (!query) return true;
      return (
        c.name.toLowerCase().includes(query) ||
        c.documentId.toLowerCase().includes(query) ||
        c.phoneOrContact.toLowerCase().includes(query)
      );
    });
  });

  readonly dossierStats = computed(() => {
    const contact = this.selectedContact();
    const deals = this.selectedContactDeals();
    if (!contact) {
      return {
        totalDeals: 0,
        closedDeals: 0,
        inTransitUsdt: 0,
        exposurePct: 0,
        lifetimeProfitUsdt: 0,
      };
    }

    let closedDeals = 0;
    let inTransitUsdt = 0;
    let lifetimeProfitUsdt = 0;
    for (const deal of deals) {
      if (deal.stage === 'STAGE_4_CLOSED') {
        closedDeals++;
        lifetimeProfitUsdt += deal.netProfitUsdt;
      } else {
        inTransitUsdt += deal.cryptoAmountUsdt;
      }
    }

    const maxExp = contact.maxPendingExposureUsdt > 0 ? contact.maxPendingExposureUsdt : 1;
    const exposurePct = Math.min(100, Math.round((inTransitUsdt / maxExp) * 100));

    return {
      totalDeals: deals.length,
      closedDeals,
      inTransitUsdt: Math.round(inTransitUsdt * 100) / 100,
      exposurePct,
      lifetimeProfitUsdt: Math.round(lifetimeProfitUsdt * 100) / 100,
    };
  });

  readonly banksById = computed<Map<string, CrmBankAccount>>(() => {
    const map = new Map<string, CrmBankAccount>();
    for (const bank of this.banks()) {
      map.set(bank.id, bank);
    }
    return map;
  });

  readonly categoryOptions = computed<{ id: string; label: string }[]>(() => {
    if (this.activeSilo() === 'FINANCE_360') {
      return [
        { id: 'ALL', label: 'Todos' },
        { id: 'WITH_BALANCE', label: 'Con Saldo' },
        { id: 'SUPPLIER_360', label: 'Proveedor' },
        { id: 'CLIENT_360', label: 'Cliente 360' },
      ];
    }
    return [
      { id: 'ALL', label: 'Todos' },
      { id: 'WITH_BALANCE', label: 'Con Saldo' },
      { id: 'VIP_OTC', label: 'VIP OTC' },
      { id: 'CLIENT_P2P', label: 'Cliente P2P' },
    ];
  });

  getInputValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  onAdjustAmountInput(event: Event): void {
    const parsed = Number(this.getInputValue(event));
    this.adjustAmountDraft.set(Number.isFinite(parsed) && parsed > 0 ? parsed : null);
  }

  emitBalanceAdjustment(sign: 1 | -1 | 0): void {
    const contact = this.selectedContact();
    if (!contact) return;
    if (sign === 0) {
      this.adjustBalance.emit({ contactId: contact.id, deltaUsdt: 0, settleZero: true });
      return;
    }
    const amt = this.adjustAmountDraft();
    if (!amt || amt <= 0) return;
    this.adjustBalance.emit({ contactId: contact.id, deltaUsdt: sign * amt });
    this.adjustAmountDraft.set(null);
  }

  openReconcile(bankId: string, currentBalanceFiat: number): void {
    this.reconcilingBankId.set(bankId);
    this.reconcileBalanceDraft.set(currentBalanceFiat);
  }

  onReconcileInput(event: Event): void {
    const parsed = Number(this.getInputValue(event));
    this.reconcileBalanceDraft.set(Number.isFinite(parsed) ? parsed : null);
  }

  confirmReconcile(bankId: string): void {
    const val = this.reconcileBalanceDraft();
    if (val === null || !Number.isFinite(val)) return;
    this.reconcileBank.emit({ bankId, realBalanceFiat: val });
    this.reconcilingBankId.set(null);
  }

  isSegmentFilled(usagePct: number, segmentIndex: number): boolean {
    const threshold = (segmentIndex + 1) * 12.5;
    return usagePct >= threshold - 6;
  }

  stageToneClass(stage: DealStage): string {
    if (stage === 'STAGE_4_CLOSED') return 'tone-won';
    if (stage === 'STAGE_3_VERIFY') return 'tone-quoted';
    return 'tone-transit';
  }

  formatFiat(amount: number): string {
    return formatFiatNumber(amount);
  }
}
