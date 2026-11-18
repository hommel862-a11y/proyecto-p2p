import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { CrmContactsRailsComponent } from './crm-contacts-rails.component';
import type {
  BankLiveTelemetry,
  CrmBankAccount,
  CrmContact,
  PipelineDeal,
} from '../../crm-ui.models';

describe('CrmContactsRailsComponent', () => {
  let fixture: ComponentFixture<CrmContactsRailsComponent>;
  let component: CrmContactsRailsComponent;

  const sampleContacts: CrmContact[] = [
    {
      id: 'CT-1',
      scope: 'P2P_DESK',
      name: 'Elena Rivas',
      documentId: 'V-18123456',
      phoneOrContact: '04141112233',
      category: 'VIP_OTC',
      paymentDetailsText: 'Mercantil\nV-18123456\n04141112233',
      creditLimitUsdt: 10_000,
      pendingBalanceUsdt: 350.5,
      maxPendingExposureUsdt: 2000,
      isDebtIndexedToUsdt: true,
      verifiedReferences: ['112233', '445566'],
      createdAt: 1_700_000_000_000,
    },
    {
      id: 'CT-2',
      scope: 'P2P_DESK',
      name: 'Distribuidora Sur',
      documentId: 'J-40111222',
      phoneOrContact: '04123334455',
      category: 'CLIENT_P2P',
      paymentDetailsText: 'Banesco',
      creditLimitUsdt: 3000,
      pendingBalanceUsdt: 0,
      maxPendingExposureUsdt: 1000,
      isDebtIndexedToUsdt: true,
      verifiedReferences: [],
      createdAt: 1_700_000_000_000,
    },
  ];

  const sampleDeals: PipelineDeal[] = [
    {
      id: 'DL-10',
      scope: 'P2P_DESK',
      title: 'OTC Elena #1',
      contactId: 'CT-1',
      contactName: 'Elena Rivas',
      bankAccountId: 'BK-1',
      bankName: 'Mercantil',
      stage: 'STAGE_4_CLOSED',
      fiatCurrency: 'VES',
      cryptoAmountUsdt: 1000,
      appliedRate: 85,
      replacementRate: 83,
      totalFiatAmount: 85_000,
      paidFiatAmount: 85_000,
      netProfitUsdt: 24,
      bankReferenceId: '112233',
      quoteTtlMinutes: 15,
      quotedAt: 1_700_000_000_000,
      isRateExpired: false,
      timeline: [],
      createdAt: 1_700_000_000_000,
      closedAt: 1_700_000_100_000,
    },
    {
      id: 'DL-11',
      scope: 'P2P_DESK',
      title: 'OTC Elena #2',
      contactId: 'CT-1',
      contactName: 'Elena Rivas',
      bankAccountId: 'BK-1',
      bankName: 'Mercantil',
      stage: 'STAGE_2_TRANSIT',
      fiatCurrency: 'VES',
      cryptoAmountUsdt: 800,
      appliedRate: 86,
      replacementRate: 84,
      totalFiatAmount: 68_800,
      paidFiatAmount: 0,
      netProfitUsdt: 18.6,
      bankReferenceId: '',
      quoteTtlMinutes: 15,
      quotedAt: 1_700_000_200_000,
      isRateExpired: false,
      timeline: [],
      createdAt: 1_700_000_200_000,
      closedAt: null,
    },
  ];

  const sampleBanks: CrmBankAccount[] = [
    {
      id: 'BK-1',
      scope: 'P2P_DESK',
      bankName: 'Mercantil',
      currency: 'VES',
      holderDetailsText: 'Mercantil\nV-18123456\n04141112233',
      currentBalanceFiat: 250_000,
      maxDailyCapFiat: 1_000_000,
      feePct: 0.25,
      maxBurstTxPer15Min: 5,
    },
  ];

  const sampleTelemetry: BankLiveTelemetry[] = [
    {
      bankAccountId: 'BK-1',
      bankName: 'Mercantil',
      currency: 'VES',
      currentBalanceFiat: 250_000,
      maxDailyCapFiat: 1_000_000,
      dailyClosedFiat: 300_000,
      dailyInTransitFiat: 150_000,
      dailyTotalUsedFiat: 450_000,
      dailyUsagePct: 45,
      recent15MinTxCount: 2,
      maxBurstTxPer15Min: 5,
      status: 'AVAILABLE',
      isRecommended: true,
    },
  ];

  const setup = (
    overrides: Partial<{
      subMode: 'CONTACTS' | 'RAILS';
      selectedContact: CrmContact | null;
      contactSearch: string;
      contactFilter: string;
      vectorMemories: string[];
      privacyMode: boolean;
    }> = {},
  ) => {
    TestBed.configureTestingModule({
      imports: [CrmContactsRailsComponent],
    });
    fixture = TestBed.createComponent(CrmContactsRailsComponent);
    component = fixture.componentInstance;

    fixture.componentRef.setInput('activeSilo', 'P2P_DESK');
    fixture.componentRef.setInput('subMode', overrides.subMode ?? 'CONTACTS');
    fixture.componentRef.setInput('contacts', sampleContacts);
    fixture.componentRef.setInput(
      'selectedContact',
      overrides.selectedContact === undefined
        ? sampleContacts[0]
        : overrides.selectedContact,
    );
    fixture.componentRef.setInput('selectedContactDeals', sampleDeals);
    fixture.componentRef.setInput('selectedContactLtvUsdt', 1800);
    fixture.componentRef.setInput(
      'vectorMemories',
      overrides.vectorMemories ?? ['Prefiere Pago Móvil Mercantil', 'Liquida lotes > 500 USDT'],
    );
    fixture.componentRef.setInput('contactSearch', overrides.contactSearch ?? '');
    fixture.componentRef.setInput('contactFilter', overrides.contactFilter ?? 'ALL');
    fixture.componentRef.setInput('banks', sampleBanks);
    fixture.componentRef.setInput('bankTelemetry', sampleTelemetry);
    fixture.componentRef.setInput('totalBankCapacityFiat', 1_000_000);
    fixture.componentRef.setInput('availableRailsCount', 1);
    fixture.componentRef.setInput('privacyMode', overrides.privacyMode ?? false);

    fixture.detectChanges();
    return { fixture, component };
  };

  it('renders 4 .crm-kpi-aura mini-KPI cards and mode toggle pill', () => {
    const { fixture, component } = setup();
    const kpiCards = fixture.nativeElement.querySelectorAll('.crm-kpi-aura');
    expect(kpiCards.length).toBe(4);

    const emitted: string[] = [];
    component.subModeChange.subscribe((m) => emitted.push(m));

    const modeButtons = fixture.nativeElement.querySelectorAll(
      '[data-testid="contacts-rails-mode"]',
    ) as NodeListOf<HTMLButtonElement>;
    expect(modeButtons.length).toBe(2);
    modeButtons[1].click();
    expect(emitted).toEqual(['RAILS']);
  });

  it('filters contacts by search & category filter and displays Expediente 360 with pgvector memories & deal table', () => {
    const { fixture } = setup({ contactFilter: 'WITH_BALANCE' });
    const rows = fixture.nativeElement.querySelectorAll(
      '[data-testid="contact-list-item"]',
    ) as NodeListOf<HTMLButtonElement>;
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('Elena Rivas');

    const dossier = fixture.nativeElement.querySelector(
      '[data-testid="expediente-360"]',
    ) as HTMLElement;
    expect(dossier).toBeTruthy();
    expect(dossier.textContent).toContain('Prefiere Pago Móvil Mercantil');
    expect(dossier.textContent).toContain('#DL-10');
    expect(dossier.textContent).toContain('1,800.00');
  });

  it('emits adjustBalance payloads (+ abonar, - cargar, saldar cero) and dossier quick actions', () => {
    const { fixture, component } = setup();
    const adjustments: { contactId: string; deltaUsdt: number; settleZero?: boolean }[] = [];
    component.adjustBalance.subscribe((p) => adjustments.push(p));

    const amtInput = fixture.nativeElement.querySelector(
      '[data-testid="balance-adjust-input"]',
    ) as HTMLInputElement;
    amtInput.value = '50';
    amtInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    (
      fixture.nativeElement.querySelector('[data-testid="btn-adjust-plus"]') as HTMLButtonElement
    ).click();

    amtInput.value = '25';
    amtInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    (
      fixture.nativeElement.querySelector('[data-testid="btn-adjust-minus"]') as HTMLButtonElement
    ).click();

    (
      fixture.nativeElement.querySelector('[data-testid="btn-adjust-zero"]') as HTMLButtonElement
    ).click();

    expect(adjustments).toEqual([
      { contactId: 'CT-1', deltaUsdt: 50 },
      { contactId: 'CT-1', deltaUsdt: -25 },
      { contactId: 'CT-1', deltaUsdt: 0, settleZero: true },
    ]);

    let waSent = false;
    let chatContactName = '';
    let dealContactName = '';
    let copiedPay = '';
    component.sendWaStatement.subscribe(() => (waSent = true));
    component.openChatForContact.subscribe((c) => (chatContactName = c.name));
    component.newDealForContact.subscribe((c) => (dealContactName = c.name));
    component.copyPaymentDetails.subscribe((t) => (copiedPay = t));

    (fixture.nativeElement.querySelector('[data-testid="btn-wa-statement"]') as HTMLButtonElement).click();
    (fixture.nativeElement.querySelector('[data-testid="btn-open-chat"]') as HTMLButtonElement).click();
    (fixture.nativeElement.querySelector('[data-testid="btn-new-deal-contact"]') as HTMLButtonElement).click();
    (fixture.nativeElement.querySelector('[data-testid="btn-copy-payment-details"]') as HTMLButtonElement).click();

    expect(waSent).toBe(true);
    expect(chatContactName).toBe('Elena Rivas');
    expect(dealContactName).toBe('Elena Rivas');
    expect(copiedPay).toContain('Mercantil');
  });

  it('renders full Bank Rails fleet in RAILS mode and emits copyBankDetails, reconcileBank, deleteBank, newBank', () => {
    const { fixture, component } = setup({ subMode: 'RAILS' });
    const bankCards = fixture.nativeElement.querySelectorAll('[data-testid="bank-rail-card"]');
    expect(bankCards.length).toBe(1);
    expect(bankCards[0].textContent).toContain('Mercantil');
    expect(bankCards[0].textContent).toContain('45.0%');

    let createdBank = false;
    let copiedBankId = '';
    let deletedBankId = '';
    const reconciled: { bankId: string; realBalanceFiat: number }[] = [];

    component.newBank.subscribe(() => (createdBank = true));
    component.copyBankDetails.subscribe((id) => (copiedBankId = id));
    component.deleteBank.subscribe((id) => (deletedBankId = id));
    component.reconcileBank.subscribe((r) => reconciled.push(r));

    (fixture.nativeElement.querySelector('[data-testid="btn-new-bank"]') as HTMLButtonElement).click();
    (fixture.nativeElement.querySelector('[data-testid="btn-copy-bank"]') as HTMLButtonElement).click();
    (fixture.nativeElement.querySelector('[data-testid="btn-open-reconcile"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    const recInput = fixture.nativeElement.querySelector(
      '[data-testid="reconcile-balance-input"]',
    ) as HTMLInputElement;
    recInput.value = '275000';
    recInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('[data-testid="btn-confirm-reconcile"]') as HTMLButtonElement).click();
    (fixture.nativeElement.querySelector('[data-testid="btn-delete-bank"]') as HTMLButtonElement).click();

    expect(createdBank).toBe(true);
    expect(copiedBankId).toBe('BK-1');
    expect(reconciled).toEqual([{ bankId: 'BK-1', realBalanceFiat: 275_000 }]);
    expect(deletedBankId).toBe('BK-1');
  });
});
