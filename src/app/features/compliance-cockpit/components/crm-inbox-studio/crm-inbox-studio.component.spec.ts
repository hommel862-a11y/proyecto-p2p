import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { CrmInboxStudioComponent } from './crm-inbox-studio.component';
import type {
  AiTriageResult,
  CrmBankAccount,
  CrmBillingDocument,
  CrmContact,
  GeminiOcrParsedResult,
  OmnichannelConversation,
} from '../../crm-ui.models';

describe('CrmInboxStudioComponent', () => {
  let fixture: ComponentFixture<CrmInboxStudioComponent>;
  let component: CrmInboxStudioComponent;

  const sampleContact: CrmContact = {
    id: 'CT-1',
    scope: 'P2P_DESK',
    name: 'Carlos Mendoza',
    documentId: 'V-19823456',
    phoneOrContact: '04141234567',
    category: 'VIP_OTC',
    paymentDetailsText: 'Banesco\nV-19823456\n04141234567',
    creditLimitUsdt: 5000,
    pendingBalanceUsdt: 120,
    maxPendingExposureUsdt: 2500,
    isDebtIndexedToUsdt: true,
    verifiedReferences: ['991122'],
    createdAt: 1_700_000_000_000,
  };

  const sampleBank: CrmBankAccount = {
    id: 'BK-1',
    scope: 'P2P_DESK',
    bankName: 'Banesco',
    currency: 'VES',
    holderDetailsText: 'Banesco\nV-20111222\n04149998877',
    currentBalanceFiat: 120_000,
    maxDailyCapFiat: 500_000,
    feePct: 0.3,
    maxBurstTxPer15Min: 6,
  };

  const sampleConversations: OmnichannelConversation[] = [
    {
      id: 'conv-1',
      scope: 'P2P_DESK',
      contactId: 'CT-1',
      contactName: 'Carlos Mendoza',
      channel: 'WHATSAPP',
      recipientPhoneOrIgId: '584141234567',
      lastInboundTimestamp: Date.now() - 60_000,
      unreadCount: 2,
      linkedDealId: 'DL-101',
      messages: [
        {
          id: 'msg-1',
          conversationId: 'conv-1',
          channel: 'WHATSAPP',
          direction: 'INBOUND',
          senderHandle: '584141234567',
          text: 'Hola, necesito cotizar 500 USDT por Pago Móvil',
          timestamp: Date.now() - 60_000,
          detectedIntent: 'P2P_EXCHANGE',
        },
      ],
    },
    {
      id: 'conv-2',
      scope: 'P2P_DESK',
      contactId: null,
      contactName: 'Tienda Norte',
      channel: 'INSTAGRAM',
      recipientPhoneOrIgId: '@tiendanorte',
      lastInboundTimestamp: Date.now() - 100_000_000,
      unreadCount: 0,
      linkedDealId: null,
      messages: [],
    },
  ];

  const sampleDoc: CrmBillingDocument = {
    id: 'doc-1',
    docNumber: 'PRE-2026-01',
    scope: 'P2P_DESK',
    docType: 'PRESUPUESTO_QUOTE',
    contactId: 'CT-1',
    contactName: 'Carlos Mendoza',
    contactDocId: 'V-19823456',
    fiatCurrency: 'VES',
    exchangeRate: 85,
    items: [
      {
        id: 'it-1',
        description: 'Servicio Liquidez USDT',
        quantity: 2,
        unitPriceUsdt: 250,
        category: 'P2P_EXCHANGE',
      },
    ],
    subtotalUsdt: 500,
    discountUsdt: 0,
    taxOrFeeUsdt: 0,
    totalUsdt: 500,
    totalFiat: 42_500,
    paymentInstructionsText: 'Pago Móvil Banesco',
    bankReferenceId: '884422',
    status: 'DRAFT',
    createdAt: 1_700_000_000_000,
  };

  const setup = (
    overrides: Partial<{
      subTab: 'INBOX' | 'STUDIO' | 'CONFIG';
      conversations: OmnichannelConversation[];
      selectedConversation: OmnichannelConversation | null;
      chatSearch: string;
      chatDraft: string;
      testInboundText: string;
      aiTriage: AiTriageResult | null;
      selectedBankIdForBubbles: string;
      isAnalyzingOcr: boolean;
      ocrResult: GeminiOcrParsedResult | null;
      freeWindowIsOpen: boolean;
      freeWindowRemainingLabel: string;
      privacyMode: boolean;
    }> = {},
  ) => {
    TestBed.configureTestingModule({
      imports: [CrmInboxStudioComponent],
    });
    fixture = TestBed.createComponent(CrmInboxStudioComponent);
    component = fixture.componentInstance;

    fixture.componentRef.setInput('activeSilo', 'P2P_DESK');
    fixture.componentRef.setInput('subTab', overrides.subTab ?? 'INBOX');
    fixture.componentRef.setInput('conversations', overrides.conversations ?? sampleConversations);
    fixture.componentRef.setInput(
      'selectedConversation',
      overrides.selectedConversation === undefined
        ? sampleConversations[0]
        : overrides.selectedConversation,
    );
    fixture.componentRef.setInput('chatSearch', overrides.chatSearch ?? '');
    fixture.componentRef.setInput('chatDraft', overrides.chatDraft ?? '');
    fixture.componentRef.setInput('testInboundText', overrides.testInboundText ?? '');
    fixture.componentRef.setInput('aiTriage', overrides.aiTriage ?? null);
    fixture.componentRef.setInput('banks', [sampleBank]);
    fixture.componentRef.setInput('contacts', [sampleContact]);
    fixture.componentRef.setInput(
      'selectedBankIdForBubbles',
      overrides.selectedBankIdForBubbles ?? 'BK-1',
    );
    fixture.componentRef.setInput('isAnalyzingOcr', overrides.isAnalyzingOcr ?? false);
    fixture.componentRef.setInput('ocrResult', overrides.ocrResult ?? null);
    fixture.componentRef.setInput('invoicesOrQuotes', [sampleDoc]);
    fixture.componentRef.setInput('omnichannelConfig', {
      aiMode: 'COPILOT_DRAFT',
      businessDisplayName: 'Mesa Quant Caracas',
      welcomeTemplateP2p: 'Hola P2P',
      welcomeTemplate360: 'Hola 360',
      geminiApiKey: '',
      whatsappPhoneNumberId: '1009988',
      instagramAccountId: 'ig_99',
      metaAccessToken: '',
    });
    fixture.componentRef.setInput('studioState', {
      docType: 'PRESUPUESTO_QUOTE',
      contactId: 'CT-1',
      docNumber: 'PRE-2026-01',
      fiatCurrency: 'VES',
      exchangeRate: 85,
      discountUsdt: 10,
      taxPct: 0,
      bankAccountId: 'BK-1',
      bankRefId: '884422',
      paymentInstructions: 'Pago Móvil Banesco',
      items: sampleDoc.items,
      totalUsdt: 490,
      totalFiat: 41_650,
    });
    fixture.componentRef.setInput(
      'freeWindowIsOpen',
      overrides.freeWindowIsOpen ?? true,
    );
    fixture.componentRef.setInput(
      'freeWindowRemainingLabel',
      overrides.freeWindowRemainingLabel ?? '23h 59m ($0.00)',
    );
    fixture.componentRef.setInput('privacyMode', overrides.privacyMode ?? false);

    fixture.detectChanges();
    return { fixture, component };
  };

  it('renders 3 segmented sub-tab pills (INBOX, STUDIO, CONFIG) and emits subTabChange', () => {
    const { fixture, component } = setup();
    const tabs = fixture.nativeElement.querySelectorAll(
      '[data-testid="inbox-subtab"]',
    ) as NodeListOf<HTMLButtonElement>;
    expect(tabs.length).toBe(3);

    const emitted: string[] = [];
    component.subTabChange.subscribe((tab) => emitted.push(tab));

    tabs[1].click();
    tabs[2].click();
    expect(emitted).toEqual(['STUDIO', 'CONFIG']);
  });

  it('renders desktop 3-column split in INBOX mode with thread list, active chat & live studio HD preview', () => {
    const { fixture } = setup();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="inbox-thread-list"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="inbox-active-chat"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="live-studio-preview"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="studio-qr-placeholder"]')).toBeTruthy();
    expect(el.textContent).toContain('23h 59m ($0.00)');
    expect(el.textContent).toContain('PRE-2026-01');
  });

  it('filters conversation threads by chatSearch and emits selectConversation / newChat', () => {
    const { fixture, component } = setup({ chatSearch: 'Tienda' });
    const threadButtons = fixture.nativeElement.querySelectorAll(
      '[data-testid="thread-item"]',
    ) as NodeListOf<HTMLButtonElement>;
    expect(threadButtons.length).toBe(1);
    expect(threadButtons[0].textContent).toContain('Tienda Norte');

    let selectedId = '';
    component.selectConversation.subscribe((id) => (selectedId = id));
    threadButtons[0].click();
    expect(selectedId).toBe('conv-2');

    let createdChat = false;
    component.newChat.subscribe(() => (createdChat = true));
    const newBtn = fixture.nativeElement.querySelector(
      '[data-testid="btn-new-chat"]',
    ) as HTMLButtonElement;
    newBtn.click();
    expect(createdChat).toBe(true);
  });

  it('displays AI Triage Copilot inline banner and emits applyTriageAction and dismissTriage', () => {
    const triage: AiTriageResult = {
      targetScope: 'P2P_DESK',
      detectedIntent: 'PAYMENT_PROOF',
      extractedReferenceId: '77665544',
      extractedAmount: 500,
      isDuplicateReference: false,
      suggestedReplyText: 'Referencia recibida, verificando en Banesco.',
      recommendedKanbanAction: 'ATTACH_PAYMENT_REF',
      confidence: 0.94,
    };
    const { fixture, component } = setup({ aiTriage: triage });
    const banner = fixture.nativeElement.querySelector(
      '[data-testid="ai-triage-banner"]',
    ) as HTMLElement;
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain('77665544');
    expect(banner.textContent).toContain('94%');

    let applied = false;
    let dismissed = false;
    component.applyTriageAction.subscribe(() => (applied = true));
    component.dismissTriage.subscribe(() => (dismissed = true));

    (
      banner.querySelector('[data-testid="btn-apply-triage"]') as HTMLButtonElement
    ).click();
    (
      banner.querySelector('[data-testid="btn-dismiss-triage"]') as HTMLButtonElement
    ).click();

    expect(applied).toBe(true);
    expect(dismissed).toBe(true);
  });

  it('emits generateBankBubbles, insertDocInChat and sendMessage modes cleanly', () => {
    const { fixture, component } = setup({
      chatDraft: 'Buenas tardes, adjunto datos.',
      selectedBankIdForBubbles: 'BK-1',
    });

    let bubbleBankId = '';
    component.generateBankBubbles.subscribe((id) => (bubbleBankId = id));
    (
      fixture.nativeElement.querySelector(
        '[data-testid="btn-generate-bubbles"]',
      ) as HTMLButtonElement
    ).click();
    expect(bubbleBankId).toBe('BK-1');

    const sentModes: string[] = [];
    component.sendMessage.subscribe((payload) => sentModes.push(payload.mode));
    (
      fixture.nativeElement.querySelector(
        '[data-testid="btn-send-dispatch"]',
      ) as HTMLButtonElement
    ).click();
    (
      fixture.nativeElement.querySelector(
        '[data-testid="btn-send-wa-direct"]',
      ) as HTMLButtonElement
    ).click();
    (
      fixture.nativeElement.querySelector(
        '[data-testid="btn-send-copy"]',
      ) as HTMLButtonElement
    ).click();

    expect(sentModes).toEqual(['DISPATCH', 'WHATSAPP_DIRECT', 'COPY']);
  });

  it('renders OCR badge when isAnalyzingOcr or ocrResult is present and emits ocrPasteFile', () => {
    const { fixture, component } = setup({
      isAnalyzingOcr: false,
      ocrResult: {
        bank: 'Banesco',
        reference: '44556677',
        amount: 42500,
        currency: 'VES',
        date: '2026-11-18',
        rawNotes: 'OK',
      },
    });
    const ocrBanner = fixture.nativeElement.querySelector(
      '[data-testid="ocr-result-chip"]',
    ) as HTMLElement;
    expect(ocrBanner.textContent).toContain('44556677');
    expect(ocrBanner.textContent).toContain('Banesco');

    const emitted: (File | string)[] = [];
    component.ocrPasteFile.subscribe((val) => emitted.push(val));

    const fileInput = fixture.nativeElement.querySelector(
      '[data-testid="ocr-file-input"]',
    ) as HTMLInputElement;
    const fakeFile = new File(['abc'], 'receipt.png', { type: 'image/png' });
    Object.defineProperty(fileInput, 'files', { value: [fakeFile] });
    fileInput.dispatchEvent(new Event('change'));
    expect(emitted[0]).toBe(fakeFile);
  });

  it('renders STUDIO editor, emits studioFieldChange, addStudioItem, removeStudioItem, saveStudioDoc, exportStudioPng', () => {
    const { fixture, component } = setup({ subTab: 'STUDIO' });

    const fieldChanges: Record<string, unknown>[] = [];
    component.studioFieldChange.subscribe((chg) => fieldChanges.push(chg));

    const docNumberInput = fixture.nativeElement.querySelector(
      '[data-testid="studio-doc-number"]',
    ) as HTMLInputElement;
    docNumberInput.value = 'FAC-999';
    docNumberInput.dispatchEvent(new Event('input'));
    expect(fieldChanges).toContainEqual({ docNumber: 'FAC-999' });

    let added = false;
    component.addStudioItem.subscribe(() => (added = true));
    (
      fixture.nativeElement.querySelector(
        '[data-testid="btn-add-studio-item"]',
      ) as HTMLButtonElement
    ).click();
    expect(added).toBe(true);

    let removedId = '';
    component.removeStudioItem.subscribe((id) => (removedId = id));
    (
      fixture.nativeElement.querySelector(
        '[data-testid="btn-remove-studio-item"]',
      ) as HTMLButtonElement
    ).click();
    expect(removedId).toBe('it-1');

    const saves: boolean[] = [];
    component.saveStudioDoc.subscribe((toKanban) => saves.push(toKanban));
    (
      fixture.nativeElement.querySelector(
        '[data-testid="btn-studio-save-history"]',
      ) as HTMLButtonElement
    ).click();
    (
      fixture.nativeElement.querySelector(
        '[data-testid="btn-studio-save-kanban"]',
      ) as HTMLButtonElement
    ).click();
    expect(saves).toEqual([false, true]);

    const exports: string[] = [];
    component.exportStudioPng.subscribe((mode) => exports.push(mode));
    (
      fixture.nativeElement.querySelector(
        '[data-testid="btn-studio-copy-png"]',
      ) as HTMLButtonElement
    ).click();
    (
      fixture.nativeElement.querySelector(
        '[data-testid="btn-studio-download-png"]',
      ) as HTMLButtonElement
    ).click();
    expect(exports).toEqual(['COPY', 'DOWNLOAD']);
  });

  it('renders CONFIG view and emits updateConfig on Meta & Gemini inputs', () => {
    const { fixture, component } = setup({ subTab: 'CONFIG' });
    const updates: Record<string, unknown>[] = [];
    component.updateConfig.subscribe((chg) => updates.push(chg));

    const nameInput = fixture.nativeElement.querySelector(
      '[data-testid="config-business-name"]',
    ) as HTMLInputElement;
    nameInput.value = 'Caracas Treasury Pro';
    nameInput.dispatchEvent(new Event('input'));
    expect(updates).toContainEqual({ businessDisplayName: 'Caracas Treasury Pro' });

    const modeSelect = fixture.nativeElement.querySelector(
      '[data-testid="config-ai-mode"]',
    ) as HTMLSelectElement;
    modeSelect.value = 'AUTOPILOT';
    modeSelect.dispatchEvent(new Event('change'));
    expect(updates).toContainEqual({ aiMode: 'AUTOPILOT' });
  });
});
