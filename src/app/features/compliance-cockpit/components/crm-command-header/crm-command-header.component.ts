import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import type {
  ArmWorkspaceId,
  CrmPrimaryNavId,
  CrmUiQuickCreateOption,
} from '../../crm-ui.models';

export const HEADER_POPOVER = {
  OVERFLOW: 'OVERFLOW',
  QUICK_CREATE: 'QUICK_CREATE',
} as const;

type HeaderPopover = (typeof HEADER_POPOVER)[keyof typeof HEADER_POPOVER] | null;

interface SiloOption {
  readonly id: ArmWorkspaceId;
  readonly label: string;
  readonly shortHint: string;
}

interface PrimaryNavItem {
  readonly id: CrmPrimaryNavId;
  readonly label: string;
}

const SILO_OPTIONS: readonly SiloOption[] = [
  { id: 'ARM_B2B', label: 'ARM B2B', shortHint: 'Comercial & Agentes' },
  { id: 'P2P_DESK', label: 'Mesa P2P', shortHint: 'Liquidez & Arbitraje' },
  { id: 'FINANCE_360', label: 'Finanzas 360', shortHint: 'PyME & Tesorería' },
];

const PRIMARY_NAV_ITEMS: readonly PrimaryNavItem[] = [
  { id: 'OVERVIEW', label: 'Overview' },
  { id: 'PIPELINE', label: 'Pipeline' },
  { id: 'INBOX_STUDIO', label: 'Inbox & Studio' },
  { id: 'CONTACTS_RAILS', label: 'Contacts & Rails' },
  { id: 'AUDIT_SYSTEM', label: 'Audit & System' },
];

const QUICK_CREATE_OPTIONS: readonly CrmUiQuickCreateOption[] = [
  { id: 'NEW_DEAL', label: 'Nuevo Trato', hint: 'Cotización o reserva en pipeline' },
  { id: 'NEW_CONTACT', label: 'Nuevo Contacto', hint: 'Contraparte o cliente 360' },
  { id: 'NEW_BANK', label: 'Nuevo Banco', hint: 'Riel de pago y cupo diario' },
  { id: 'NEW_CHAT', label: 'Nuevo Chat', hint: 'Atención WhatsApp / Instagram' },
];

@Component({
  selector: 'app-crm-command-header',
  standalone: true,
  imports: [],
  templateUrl: './crm-command-header.component.html',
  styleUrl: './crm-command-header.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.silo-b2b]': "activeSilo() === 'ARM_B2B'",
    '[class.silo-p2p]': "activeSilo() === 'P2P_DESK'",
    '[class.silo-360]': "activeSilo() === 'FINANCE_360'",
    '[class.privacy-active]': 'privacyMode()',
  },
})
export class CrmCommandHeaderComponent {
  readonly activeSilo = input<ArmWorkspaceId>('P2P_DESK');
  readonly activeNav = input<CrmPrimaryNavId>('OVERVIEW');
  readonly gatewayStatus = input<'CONNECTED' | 'CONNECTING' | 'DISCONNECTED'>('DISCONNECTED');
  readonly privacyMode = input<boolean>(false);
  readonly pipelineCount = input<number>(0);
  readonly inboxCount = input<number>(0);
  readonly pendingApprovalsCount = input<number>(0);
  readonly dailyProfitTodayUsdt = input<number>(0);
  readonly isTodaySettled = input<boolean>(false);
  readonly liveReplacementRate = input<number>(0);
  readonly conversionRatePct = input<number>(0);
  readonly railsSummaryLabel = input<string>('0/0');

  readonly siloChange = output<ArmWorkspaceId>();
  readonly navChange = output<CrmPrimaryNavId>();
  readonly openPalette = output<void>();
  readonly gatewayClick = output<void>();
  readonly quickCreate = output<'NEW_DEAL' | 'NEW_CONTACT' | 'NEW_BANK' | 'NEW_CHAT'>();
  readonly togglePrivacy = output<void>();
  readonly settleProfit = output<void>();

  protected readonly siloOptions = SILO_OPTIONS;
  protected readonly navItems = PRIMARY_NAV_ITEMS;
  protected readonly quickCreateOptions = QUICK_CREATE_OPTIONS;
  protected readonly activePopover = signal<HeaderPopover>(null);

  protected readonly gatewayLabel = computed<string>(() => {
    const status = this.gatewayStatus();
    if (status === 'CONNECTED') return 'Gateway Activo';
    if (status === 'CONNECTING') return 'Reconectando';
    return 'Gateway Off';
  });

  protected readonly formattedReplacementRate = computed<string>(() =>
    this.liveReplacementRate().toFixed(2),
  );

  protected readonly formattedDailyProfit = computed<string>(() =>
    this.dailyProfitTodayUsdt().toFixed(2),
  );

  protected readonly canSettleToday = computed<boolean>(
    () =>
      this.activeSilo() === 'P2P_DESK' &&
      !this.isTodaySettled() &&
      this.dailyProfitTodayUsdt() > 0,
  );

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    this.activePopover.set(null);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target || !target.closest('.popover-anchor')) {
      this.activePopover.set(null);
    }
  }

  protected selectSilo(silo: ArmWorkspaceId): void {
    this.activePopover.set(null);
    this.siloChange.emit(silo);
  }

  protected selectNav(nav: CrmPrimaryNavId): void {
    this.activePopover.set(null);
    this.navChange.emit(nav);
  }

  protected togglePopover(target: Exclude<HeaderPopover, null>): void {
    this.activePopover.update((current) => (current === target ? null : target));
  }

  protected handleQuickCreatePrimary(): void {
    this.activePopover.set(null);
    this.quickCreate.emit('NEW_DEAL');
  }

  protected handleQuickCreateOption(id: CrmUiQuickCreateOption['id']): void {
    this.activePopover.set(null);
    this.quickCreate.emit(id);
  }

  protected handleTogglePrivacy(): void {
    this.activePopover.set(null);
    this.togglePrivacy.emit();
  }

  protected handleSettleProfit(): void {
    if (!this.canSettleToday()) return;
    this.activePopover.set(null);
    this.settleProfit.emit();
  }

  protected navBadgeFor(navId: CrmPrimaryNavId): number {
    if (navId === 'PIPELINE') return this.pipelineCount();
    if (navId === 'INBOX_STUDIO') return this.inboxCount();
    if (navId === 'AUDIT_SYSTEM') return this.pendingApprovalsCount();
    return 0;
  }
}
