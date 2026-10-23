import '@angular/compiler';
import { Injector, signal } from '@angular/core';
import { Router } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ComplianceCockpitComponent } from './compliance-cockpit.component';
import { StorageService } from '../../core/storage';
import { ToastService } from '../../core/toast.service';
import { Finance360Service } from '../../core/finance-360.service';
import { CRM_STORAGE_KEYS, type PipelineDeal, type CrmContact, type CrmBankAccount } from '@p2p/core';

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
  };
  let routerMock: {
    navigate: ReturnType<typeof vi.fn>;
  };
  let finance360Mock: {
    recordExternalSettlement: ReturnType<typeof vi.fn>;
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
    };

    routerMock = {
      navigate: vi.fn(),
    };

    finance360Mock = {
      recordExternalSettlement: vi.fn().mockResolvedValue(true),
    };

    const injector = Injector.create({
      providers: [
        { provide: StorageService, useValue: storageMock },
        { provide: ToastService, useValue: toastMock },
        { provide: Router, useValue: routerMock },
        { provide: Finance360Service, useValue: finance360Mock },
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
});
