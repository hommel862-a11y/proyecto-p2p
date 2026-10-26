import '@angular/compiler';
import { Injector, signal } from '@angular/core';
import { Router } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ComplianceCockpitComponent } from './compliance-cockpit.component';
import { Subject } from 'rxjs';
import { StorageService } from '../../core/storage';
import { ToastService } from '../../core/toast.service';
import { Finance360Service } from '../../core/finance-360.service';
import { InboundGatewayService } from '../../core/services/inbound-gateway.service';
import {
  CRM_STORAGE_KEYS,
  type PipelineDeal,
  type CrmContact,
  type CrmBankAccount,
  type InboundReceiptEvent,
} from '@p2p/core';

describe('ComplianceCockpitComponent', () => {
  let component: ComplianceCockpitComponent;
  let storageMap: Map<string, unknown>;
  let storageMock: {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
  };
  let toastMock: {
    success: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    warning: ReturnType<typeof vi.fn>;
  };
  let routerMock: {
    navigate: ReturnType<typeof vi.fn>;
  };
  let finance360Mock: {
    recordExternalSettlement: ReturnType<typeof vi.fn>;
  };
  let inboundReceiptSubject: Subject<InboundReceiptEvent>;
  let inboundGatewayMock: {
    receipt$: Subject<InboundReceiptEvent>;
    status: ReturnType<typeof signal>;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    getGatewayUrl: ReturnType<typeof vi.fn>;
    setGatewayUrl: ReturnType<typeof vi.fn>;
    testConnection: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    storageMap = new Map();
    storageMock = {
      get: vi.fn(<T>(key: string): T | null => (storageMap.get(key) as T) ?? null),
      set: vi.fn(<T>(key: string, val: T): void => {
        storageMap.set(key, val);
      }),
    };

    toastMock = {
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      warning: vi.fn(),
    };

    routerMock = {
      navigate: vi.fn(),
    };

    finance360Mock = {
      recordExternalSettlement: vi.fn().mockResolvedValue(true),
    };

    inboundReceiptSubject = new Subject<InboundReceiptEvent>();
    inboundGatewayMock = {
      receipt$: inboundReceiptSubject,
      status: signal('CONNECTED'),
      connect: vi.fn(),
      disconnect: vi.fn(),
      getGatewayUrl: vi.fn().mockReturnValue('http://127.0.0.1:3030'),
      setGatewayUrl: vi.fn(),
      testConnection: vi.fn().mockResolvedValue({ ok: true, status: 'UP' }),
    };

    const injector = Injector.create({
      providers: [
        { provide: StorageService, useValue: storageMock },
        { provide: ToastService, useValue: toastMock },
        { provide: Router, useValue: routerMock },
        { provide: Finance360Service, useValue: finance360Mock },
        { provide: InboundGatewayService, useValue: inboundGatewayMock },
        ComplianceCockpitComponent,
      ],
    });

    component = injector.get(ComplianceCockpitComponent);
  });

  describe('Zero-Seed Policy & Initialization', () => {
    it('initializes with zero seed records when storage is empty', () => {
      expect(component).toBeTruthy();
      expect(component.deals()).toEqual([]);
      expect(component.contacts()).toEqual([]);
      expect(component.banks()).toEqual([]);
      expect(component.activities()).toEqual([]);
      expect(component.kpis().closedNetProfitTodayUsdt).toBe(0);
      expect(component.kpis().closedVolumeTodayUsdt).toBe(0);
    });

    it('defaults to P2P_DESK scope with 4 Kanban columns', () => {
      expect(component.activeScope()).toBe('P2P_DESK');
      const cols = component.kanbanColumnsList();
      expect(cols).toHaveLength(4);
      expect(cols[0].stage).toBe('STAGE_1_NEW');
      expect(cols[0].label).toContain('Cotizado');
      expect(cols[3].stage).toBe('STAGE_4_CLOSED');
    });

    it('toggles scope to FINANCE_360 and updates column labels', () => {
      component.activeScope.set('FINANCE_360');
      const cols = component.kanbanColumnsList();
      expect(cols).toHaveLength(4);
      expect(cols[0].label).toContain('Presupuesto');
      expect(cols[3].label).toContain('Pagado');
    });
  });

  describe('Pipeline Stage Transitions & Reference Enforcement', () => {
    const mockDeal: PipelineDeal = {
      id: 'DL-001001',
      scope: 'P2P_DESK',
      title: 'Venta USDT Arbitraje',
      contactId: 'CT-01',
      contactName: 'Carlos VIP',
      bankAccountId: 'BK-01',
      bankName: 'Banesco',
      stage: 'STAGE_1_NEW',
      fiatCurrency: 'VES',
      cryptoAmountUsdt: 1000,
      appliedRate: 85.0,
      replacementRate: 83.0,
      totalFiatAmount: 85000,
      paidFiatAmount: 0,
      netProfitUsdt: 23.53,
      bankReferenceId: '',
      quotedAt: Date.now(),
      quoteTtlMinutes: 15,
      isRateExpired: false,
      timeline: [],
      createdAt: Date.now(),
      closedAt: null,
    };

    beforeEach(() => {
      component.deals.set([mockDeal]);
    });

    it('moves deal from STAGE_1_NEW to STAGE_2_TRANSIT', () => {
      component.moveDealToStage('DL-001001', 'STAGE_2_TRANSIT');
      const updated = component.deals().find((d) => d.id === 'DL-001001');
      expect(updated?.stage).toBe('STAGE_2_TRANSIT');
      expect(toastMock.info).toHaveBeenCalled();
    });

    it('intercepts transition to STAGE_4_CLOSED when bankReferenceId is missing with non-blocking prompt modal', () => {
      component.moveDealToStage('DL-001001', 'STAGE_4_CLOSED');
      const modal = component.promptClosingDeal();
      expect(modal).toBeTruthy();
      expect(modal?.deal.id).toBe('DL-001001');
      expect(component.deals()[0].stage).toBe('STAGE_1_NEW'); // Not closed yet
    });

    it('liquidates deal into STAGE_4_CLOSED once reference is provided via modal', () => {
      component.moveDealToStage('DL-001001', 'STAGE_4_CLOSED');
      component.updateCloseDealRef('REF-987654');
      component.executeCloseDealModal();

      const updated = component.deals().find((d) => d.id === 'DL-001001');
      expect(updated?.stage).toBe('STAGE_4_CLOSED');
      expect(updated?.bankReferenceId).toBe('REF-987654');
      expect(component.promptClosingDeal()).toBeNull();
      expect(toastMock.success).toHaveBeenCalled();
    });
  });

  describe('Kanban Keyboard & Accessibility Navigation (Phase 5)', () => {
    const mockDeal: PipelineDeal = {
      id: 'DL-KEY-01',
      scope: 'P2P_DESK',
      title: 'Trato Teclado',
      contactId: 'CT-01',
      contactName: 'Juan Perez',
      bankAccountId: 'BK-01',
      bankName: 'Mercantil',
      stage: 'STAGE_1_NEW',
      fiatCurrency: 'VES',
      cryptoAmountUsdt: 500,
      appliedRate: 85.0,
      replacementRate: 83.0,
      totalFiatAmount: 42500,
      paidFiatAmount: 0,
      netProfitUsdt: 11.76,
      bankReferenceId: '',
      quotedAt: Date.now(),
      quoteTtlMinutes: 15,
      isRateExpired: false,
      timeline: [],
      createdAt: Date.now(),
      closedAt: null,
    };

    beforeEach(() => {
      component.deals.set([mockDeal]);
    });

    it('advances stages sequentially on ArrowRight', () => {
      const event = { key: 'ArrowRight', preventDefault: vi.fn() } as unknown as KeyboardEvent;
      component.onCardKeyDown(event, component.deals()[0]);
      expect(event.preventDefault).toHaveBeenCalled();
      expect(component.deals()[0].stage).toBe('STAGE_2_TRANSIT');

      component.onCardKeyDown(event, component.deals()[0]);
      expect(component.deals()[0].stage).toBe('STAGE_3_VERIFY');

      // Moving from STAGE_3_VERIFY to STAGE_4_CLOSED prompts for reference
      component.onCardKeyDown(event, component.deals()[0]);
      expect(component.promptClosingDeal()?.deal.id).toBe('DL-KEY-01');
    });

    it('moves stages backwards on ArrowLeft', () => {
      const inVerify = { ...mockDeal, stage: 'STAGE_3_VERIFY' as const };
      component.deals.set([inVerify]);

      const event = { key: 'ArrowLeft', preventDefault: vi.fn() } as unknown as KeyboardEvent;
      component.onCardKeyDown(event, inVerify);
      expect(event.preventDefault).toHaveBeenCalled();
      expect(component.deals()[0].stage).toBe('STAGE_2_TRANSIT');

      component.onCardKeyDown(event, component.deals()[0]);
      expect(component.deals()[0].stage).toBe('STAGE_1_NEW');
    });

    it('jumps directly to stage with numeric keys 1, 2, 3', () => {
      const event2 = { key: '2', preventDefault: vi.fn() } as unknown as KeyboardEvent;
      component.onCardKeyDown(event2, component.deals()[0]);
      expect(component.deals()[0].stage).toBe('STAGE_2_TRANSIT');

      const event3 = { key: '3', preventDefault: vi.fn() } as unknown as KeyboardEvent;
      component.onCardKeyDown(event3, component.deals()[0]);
      expect(component.deals()[0].stage).toBe('STAGE_3_VERIFY');

      const event1 = { key: '1', preventDefault: vi.fn() } as unknown as KeyboardEvent;
      component.onCardKeyDown(event1, component.deals()[0]);
      expect(component.deals()[0].stage).toBe('STAGE_1_NEW');
    });

    it('triggers delete confirmation modal on Delete / Backspace key', () => {
      const eventDel = { key: 'Delete', preventDefault: vi.fn() } as unknown as KeyboardEvent;
      component.onCardKeyDown(eventDel, component.deals()[0]);
      expect(eventDel.preventDefault).toHaveBeenCalled();
      const modal = component.confirmModal();
      expect(modal).toBeTruthy();
      expect(modal?.title).toContain('Eliminar Trato');
      expect(modal?.isDestructive).toBe(true);
    });
  });

  describe('Inbound Gateway Real-Time Receipt Streaming', () => {
    it('automatically ingests an incoming receipt event into STAGE_1_NEW of the active vault', () => {
      const receipt: InboundReceiptEvent = {
        eventId: 'evt-webhook-8800',
        channel: 'WHATSAPP',
        sender: { id: '584145551234', name: 'Carlos OTC', channel: 'WHATSAPP' },
        parsed: {
          rawText: 'Transferencia Banesco Ref: 99881122 por Bs 50.000,00',
          referenceId: '99881122',
          amountFiat: 50000,
          currency: 'VES',
          detectedBank: 'Banesco',
        },
        scope: 'P2P_DESK',
        receivedAt: Date.now(),
        rawText: 'Transferencia Banesco Ref: 99881122 por Bs 50.000,00',
        status: 'AUTO_MATCHED',
      };

      inboundReceiptSubject.next(receipt);

      const deals = component.deals();
      expect(deals.length).toBe(1);
      const newDeal = deals[0];
      expect(newDeal.stage).toBe('STAGE_1_NEW');
      expect(newDeal.contactName).toBe('Carlos OTC');
      expect(newDeal.bankReferenceId).toBe('99881122');
      expect(newDeal.totalFiatAmount).toBe(50000);
      expect(newDeal.scope).toBe('P2P_DESK');
      expect(toastMock.success).toHaveBeenCalledWith(
        expect.stringContaining('99881122'),
        'Pipeline Operativo',
      );
    });

    it('rejects duplicate receipt reference and triggers anti-fraud warning without inserting deal', () => {
      const existing: PipelineDeal = {
        id: 'EXISTING-01',
        title: 'Trato anterior',
        scope: 'P2P_DESK',
        contactId: 'c1',
        contactName: 'Cliente',
        bankAccountId: 'b1',
        bankName: 'Banesco',
        stage: 'STAGE_2_TRANSIT',
        fiatCurrency: 'VES',
        cryptoAmountUsdt: 100,
        appliedRate: 50,
        replacementRate: 50,
        totalFiatAmount: 5000,
        paidFiatAmount: 5000,
        netProfitUsdt: 2,
        bankReferenceId: '99881122',
        quoteTtlMinutes: 15,
        quotedAt: Date.now(),
        isRateExpired: false,
        timeline: [],
        createdAt: Date.now(),
        closedAt: null,
      };
      component.deals.set([existing]);

      const duplicateReceipt: InboundReceiptEvent = {
        eventId: 'evt-dup-99',
        channel: 'INSTAGRAM',
        sender: { id: 'ig_user_1', channel: 'INSTAGRAM' },
        parsed: {
          rawText: 'Pago recibido Ref 99881122',
          referenceId: '99881122',
          amountFiat: 5000,
          currency: 'VES',
          detectedBank: 'Banesco',
        },
        scope: 'P2P_DESK',
        receivedAt: Date.now(),
        rawText: 'Pago recibido Ref 99881122',
        status: 'DUPLICATE_FLAGGED',
      };

      inboundReceiptSubject.next(duplicateReceipt);

      expect(component.deals().length).toBe(1);
      expect(toastMock.warn).toHaveBeenCalledWith(
        expect.stringContaining('Comprobante duplicado'),
        'Alerta de Colisión',
      );
    });

    it('ignores receipts destined for another vault/scope', () => {
      expect(component.activeScope()).toBe('P2P_DESK');

      const finance360Receipt: InboundReceiptEvent = {
        eventId: 'evt-fin360',
        channel: 'GMAIL',
        sender: { id: 'admin@finance.com', channel: 'GMAIL' },
        parsed: {
          rawText: 'Pago Ref: 12345678 por Bs 10.000',
          referenceId: '12345678',
          amountFiat: 10000,
          currency: 'VES',
          detectedBank: 'Mercantil',
        },
        scope: 'FINANCE_360',
        receivedAt: Date.now(),
        rawText: 'Pago Ref: 12345678',
        status: 'AUTO_MATCHED',
      };

      inboundReceiptSubject.next(finance360Receipt);

      expect(component.deals().length).toBe(0);
    });
  });

  describe('Omnichannel CRM, AI Triage & Studio Engine', () => {
    it('initializes with zero-seed empty collections for conversations and invoices', () => {
      expect(component.conversations()).toEqual([]);
      expect(component.invoicesOrQuotes()).toEqual([]);
      expect(component.omnichannelConfig().aiMode).toBe('COPILOT_DRAFT');
    });

    it('creates a new conversation and persists to storage', () => {
      component.newChatChannel.set('WHATSAPP');
      component.newChatRecipient.set('584141234567');
      component.newChatName.set('Cliente VIP');
      component.createNewConversation();

      expect(component.conversations().length).toBe(1);
      const conv = component.conversations()[0];
      expect(conv.contactName).toBe('Cliente VIP');
      expect(conv.recipientPhoneOrIgId).toBe('584141234567');
      expect(component.selectedConversationId()).toBe(conv.id);
      expect(storageMock.set).toHaveBeenCalledWith(CRM_STORAGE_KEYS.CONVERSATIONS, expect.any(Array));
    });

    it('sends an outbound chat message and clears draft', () => {
      component.newChatRecipient.set('584141234567');
      component.createNewConversation();

      component.chatDraftText.set('Buenas tardes, tasa en 84.50');
      component.sendChatMessage();

      const conv = component.activeConversation();
      expect(conv?.messages.length).toBe(2);
      expect(conv?.messages[1].text).toBe('Buenas tardes, tasa en 84.50');
      expect(conv?.messages[1].direction).toBe('OUTBOUND');
      expect(component.chatDraftText()).toBe('');
    });

    it('simulates inbound customer message with AI Triage in Copilot mode', () => {
      component.newChatRecipient.set('584141234567');
      component.createNewConversation();

      component.testInboundText.set('Hola, ¿a qué tasa tienen el USDT por Pago Móvil?');
      component.simulateIncomingCustomerMessage();

      const triage = component.activeAiTriage();
      expect(triage).not.toBeNull();
      expect(triage?.detectedIntent).toBe('P2P_EXCHANGE');
      expect(triage?.recommendedKanbanAction).toBe('CREATE_P2P_DEAL');
      expect(component.chatDraftText()).toContain('USDT');
    });

    it('loads 3 copyable bank bubbles into chat draft', () => {
      const bank: CrmBankAccount = {
        id: 'BNK-TEST',
        scope: 'P2P_DESK',
        bankName: 'Mercantil',
        currency: 'VES',
        holderDetailsText: 'Juan Pérez\nV-26123456\nPago Móvil: 04141234567\nCuenta: 01050001000012345678',
        currentBalanceFiat: 5000,
        maxDailyCapFiat: 100000,
        feePct: 0.3,
        maxBurstTxPer15Min: 5,
      };
      component.banks.set([bank]);

      component.newChatRecipient.set('584141234567');
      component.createNewConversation();

      component.sendBankBubblesToChat(bank.id);
      expect(component.chatDraftText()).toContain('DATOS DE PAGO');
      expect(component.chatDraftText()).toContain('V26123456');
      expect(component.chatDraftText()).toContain('04141234567');
    });

    it('saves a studio quote and pushes a new deal to Kanban', () => {
      component.studioDocType.set('PRESUPUESTO_QUOTE');
      component.studioDocNumber.set('PRE-0099');
      component.studioExchangeRate.set(80);
      component.saveStudioDocument(true);

      expect(component.invoicesOrQuotes().length).toBe(1);
      expect(component.invoicesOrQuotes()[0].docNumber).toBe('PRE-0099');
      expect(component.deals().length).toBe(1);
      expect(component.deals()[0].stage).toBe('STAGE_1_NEW');
      expect(component.activeView()).toBe('KANBAN');
      expect(storageMock.set).toHaveBeenCalledWith(CRM_STORAGE_KEYS.INVOICES_OR_QUOTES, expect.any(Array));
    });

    it('supports cross-module shortcut openOmnichannelForDeal', () => {
      const deal: PipelineDeal = {
        id: 'DEAL-88',
        scope: 'P2P_DESK',
        title: 'Operación P2P Carlos',
        contactId: 'CNT-99',
        contactName: 'Carlos Gómez',
        bankAccountId: 'BNK-1',
        bankName: 'Banesco',
        stage: 'STAGE_1_NEW',
        fiatCurrency: 'VES',
        cryptoAmountUsdt: 100,
        appliedRate: 80,
        replacementRate: 80,
        totalFiatAmount: 8000,
        paidFiatAmount: 0,
        netProfitUsdt: 2,
        bankReferenceId: '',
        quoteTtlMinutes: 15,
        quotedAt: Date.now(),
        isRateExpired: false,
        timeline: [],
        createdAt: Date.now(),
        closedAt: null,
      };

      component.openOmnichannelForDeal(deal);

      expect(component.activeView()).toBe('OMNICHANNEL');
      expect(component.omnichannelSubTab()).toBe('INBOX');
      expect(component.activeConversation()?.contactName).toBe('Carlos Gómez');
      expect(component.chatDraftText()).toContain('DEAL-88');
    });
  });
});
