import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { P2P_STORAGE } from '../../../../core/storage';
import { MemoryStorage } from '../../../../core/memory-storage';
import {
  DEFAULT_WORKFLOW_RAIL_ORDER,
  DashboardLayoutService,
} from '../../services/dashboard-layout.service';
import {
  SankeyRailsFlowComponent,
  SankeyRailNodeDto,
} from './sankey-rails-flow.component';

const MOCK_RAILS: readonly SankeyRailNodeDto[] = [
  {
    id: 'BANESCO',
    label: 'Banesco Panamá / VE',
    balanceVes: 125000,
    consumedPct: 42,
    statusLabel: 'Operativo',
    health: 'optimal',
    bankNameForOperate: 'Banesco',
  },
  {
    id: 'PAGO_MOVIL',
    label: 'Pago Móvil P2P',
    balanceVes: 75000,
    consumedPct: 78,
    statusLabel: 'Atención Cupo',
    health: 'warn',
    bankNameForOperate: 'Pago Móvil',
  },
  {
    id: 'PROVINCIAL',
    label: 'BBVA Provincial',
    balanceVes: 0,
    consumedPct: 95,
    statusLabel: 'Crítico / Límite',
    health: 'danger',
    bankNameForOperate: 'Provincial',
  },
  {
    id: 'MERCANTIL',
    label: 'Mercantil Banco',
    balanceVes: 45000,
    consumedPct: 30,
    statusLabel: 'Operativo',
    health: 'optimal',
    bankNameForOperate: 'Mercantil',
  },
  {
    id: 'BINANCE_SPOT',
    label: 'Binance USDT Spot',
    balanceVes: 220000,
    consumedPct: 15,
    statusLabel: 'Óptimo',
    health: 'optimal',
    bankNameForOperate: 'Binance P2P',
  },
];

@Component({
  standalone: true,
  imports: [SankeyRailsFlowComponent],
  template: `
    <app-sankey-rails-flow
      [rails]="rails()"
      [netProfitUsdt]="netProfitUsdt()"
      [netProfitVes]="netProfitVes()"
      [roiPct]="roiPct()"
      (operateRail)="onOperate($event)"
      (injectLiquidity)="onInject()"
    />
  `,
})
class TestHostComponent {
  readonly rails = signal<readonly SankeyRailNodeDto[]>(MOCK_RAILS);
  readonly netProfitUsdt = signal<number>(145.8);
  readonly netProfitVes = signal<number>(7580);
  readonly roiPct = signal<number>(5.2);

  lastOperatedRail: string | null = null;
  injectLiquidityCalled = false;

  onOperate(bankName: string): void {
    this.lastOperatedRail = bankName;
  }

  onInject(): void {
    this.injectLiquidityCalled = true;
  }
}

describe('SankeyRailsFlowComponent', () => {
  let memStorage: MemoryStorage;
  let layoutService: DashboardLayoutService;

  beforeEach(() => {
    memStorage = new MemoryStorage();
    TestBed.configureTestingModule({
      imports: [SankeyRailsFlowComponent, TestHostComponent],
      providers: [
        { provide: P2P_STORAGE, useValue: memStorage },
        DashboardLayoutService,
      ],
    });
    layoutService = TestBed.inject(DashboardLayoutService);
  });

  describe('Component Initialization & Default State', () => {
    it('creates component with default inputs and clean state', () => {
      const fixture = TestBed.createComponent(SankeyRailsFlowComponent);
      const component = fixture.componentInstance;
      fixture.detectChanges();

      expect(component).toBeTruthy();
      expect(component.rails()).toEqual([]);
      expect(component.netProfitUsdt()).toBe(0);
      expect(component.netProfitVes()).toBe(0);
      expect(component.roiPct()).toBe(0);
      expect(component.activeRailId()).toBeNull();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('.sankey-rails-cockpit')).toBeTruthy();
      expect(el.querySelector('.sankey-canvas')).toBeTruthy();
      expect(el.querySelector('.orbital-profit-ring')).toBeTruthy();
    });
  });

  describe('Movable & Persisted Rail Workflow Nodes', () => {
    let hostFixture: ComponentFixture<TestHostComponent>;
    let hostComponent: TestHostComponent;

    beforeEach(() => {
      hostFixture = TestBed.createComponent(TestHostComponent);
      hostComponent = hostFixture.componentInstance;
      hostFixture.detectChanges();
    });

    it('orders rail cards based on layoutService.workflowRailOrder()', () => {
      const railCards = hostFixture.nativeElement.querySelectorAll('.rail-node-card');
      expect(railCards.length).toBe(MOCK_RAILS.length);

      // Default order starts with BANESCO then PAGO_MOVIL
      const firstLabel = railCards[0].querySelector('.rail-label')?.textContent?.trim();
      expect(firstLabel).toContain('Banesco');

      // Now move BINANCE_SPOT to top
      layoutService.moveRailNode('BINANCE_SPOT', 'BANESCO');
      hostFixture.detectChanges();

      const updatedCards = hostFixture.nativeElement.querySelectorAll('.rail-node-card');
      const updatedFirstLabel = updatedCards[0].querySelector('.rail-label')?.textContent?.trim();
      expect(updatedFirstLabel).toContain('Binance');
    });

    it('provides accessible reorder buttons (move up / down) and disables boundary buttons', () => {
      const railCards = hostFixture.nativeElement.querySelectorAll('.rail-node-card');
      const firstCard = railCards[0];
      const upBtnFirst = firstCard.querySelector('.btn-reorder-up') as HTMLButtonElement;
      const downBtnFirst = firstCard.querySelector('.btn-reorder-down') as HTMLButtonElement;

      expect(upBtnFirst.disabled).toBe(true);
      expect(downBtnFirst.disabled).toBe(false);

      // Clicking down moves first rail down
      downBtnFirst.click();
      hostFixture.detectChanges();

      expect(layoutService.workflowRailOrder()[1]).toBe('BANESCO');
    });

    it('supports drag-and-drop workflow node reordering', () => {
      const comp = hostFixture.debugElement.children[0].componentInstance as SankeyRailsFlowComponent;
      const mockDataTransfer = {
        data: {} as Record<string, string>,
        setData(format: string, data: string) {
          this.data[format] = data;
        },
        getData(format: string) {
          return this.data[format] || '';
        },
        effectAllowed: 'move',
        dropEffect: 'move',
      };

      const startEvent = { dataTransfer: mockDataTransfer } as unknown as DragEvent;
      comp.onDragStart(startEvent, 'BANESCO');
      expect(comp.draggedRailId()).toBe('BANESCO');

      const overEvent = {
        preventDefault: vi.fn(),
        dataTransfer: mockDataTransfer,
      } as unknown as DragEvent;
      comp.onDragOver(overEvent, 'PROVINCIAL');
      expect(overEvent.preventDefault).toHaveBeenCalled();
      expect(comp.dragOverRailId()).toBe('PROVINCIAL');

      const dropEvent = {
        preventDefault: vi.fn(),
        dataTransfer: mockDataTransfer,
      } as unknown as DragEvent;
      comp.onDrop(dropEvent, 'PROVINCIAL');

      expect(layoutService.workflowRailOrder()).toContain('BANESCO');
      expect(comp.draggedRailId()).toBeNull();
      expect(comp.dragOverRailId()).toBeNull();
    });

    it('shows reset button when order differs from default and restores defaults when clicked', () => {
      const comp = hostFixture.debugElement.children[0].componentInstance as SankeyRailsFlowComponent;
      expect(comp.isCustomOrder()).toBe(false);

      // Reorder to make it custom
      layoutService.moveRailNode('PROVINCIAL', 'BANESCO');
      hostFixture.detectChanges();
      expect(comp.isCustomOrder()).toBe(true);

      const resetBtn = hostFixture.nativeElement.querySelector('.btn-reset-order') as HTMLButtonElement;
      expect(resetBtn).toBeTruthy();

      resetBtn.click();
      hostFixture.detectChanges();

      expect(comp.isCustomOrder()).toBe(false);
      expect(layoutService.workflowRailOrder()).toEqual(DEFAULT_WORKFLOW_RAIL_ORDER);
    });
  });

  describe('Center Animated Bezier Sankey Streams', () => {
    let hostFixture: ComponentFixture<TestHostComponent>;
    let comp: SankeyRailsFlowComponent;

    beforeEach(() => {
      hostFixture = TestBed.createComponent(TestHostComponent);
      hostFixture.detectChanges();
      comp = hostFixture.debugElement.children[0].componentInstance as SankeyRailsFlowComponent;
    });

    it('dynamically computes valid cubic Bezier paths (M... C...) for each rail node', () => {
      const streams = comp.sankeyStreams();
      expect(streams.length).toBe(MOCK_RAILS.length);

      streams.forEach((stream) => {
        expect(stream.path).toMatch(/^M\s*[\d.]+,[\d.]+\s*C\s*[\d.]+,[\d.]+\s*[\d.]+,[\d.]+\s*[\d.]+,[\d.]+$/);
        expect(stream.strokeWidth).toBeGreaterThan(0);
        expect(Number.isNaN(stream.strokeWidth)).toBe(false);
      });
    });

    it('guarantees thin hairline stream for zero balance rails without NaN or broken coordinates', () => {
      const provincialStream = comp.sankeyStreams().find((s) => s.railId === 'PROVINCIAL');
      expect(provincialStream).toBeDefined();
      expect(provincialStream!.strokeWidth).toBeGreaterThanOrEqual(2);
      expect(provincialStream!.path).not.toContain('NaN');
    });

    it('renders SVG path elements in template with dashoffset flow animation classes', () => {
      const paths = hostFixture.nativeElement.querySelectorAll('.sankey-stream-path');
      expect(paths.length).toBe(MOCK_RAILS.length);

      const energyPulses = hostFixture.nativeElement.querySelectorAll('.sankey-energy-pulse');
      expect(energyPulses.length).toBe(MOCK_RAILS.length);
    });
  });

  describe('Interactive Focus & Tactical Action Popover', () => {
    let hostFixture: ComponentFixture<TestHostComponent>;
    let hostComponent: TestHostComponent;
    let comp: SankeyRailsFlowComponent;

    beforeEach(() => {
      hostFixture = TestBed.createComponent(TestHostComponent);
      hostComponent = hostFixture.componentInstance;
      hostFixture.detectChanges();
      comp = hostFixture.debugElement.children[0].componentInstance as SankeyRailsFlowComponent;
    });

    it('highlights active stream and dims non-active streams on hover/click', () => {
      const firstCard = hostFixture.nativeElement.querySelector('.rail-node-card') as HTMLElement;
      firstCard.click();
      hostFixture.detectChanges();

      expect(comp.activeRailId()).toBe('BANESCO');

      const activePaths = hostFixture.nativeElement.querySelectorAll('.sankey-stream-group.is-active');
      const dimmedPaths = hostFixture.nativeElement.querySelectorAll('.sankey-stream-group.is-dimmed');

      expect(activePaths.length).toBe(1);
      expect(dimmedPaths.length).toBe(MOCK_RAILS.length - 1);
    });

    it('opens tactical popover showing balance, cupo and 1-click operate button', () => {
      comp.selectRail('PAGO_MOVIL');
      hostFixture.detectChanges();

      const popover = hostFixture.nativeElement.querySelector('.rail-popover');
      expect(popover).toBeTruthy();
      expect(popover.textContent).toContain('Pago Móvil');
      expect(popover.textContent).toContain('78%');

      const operateBtn = popover.querySelector('.btn-operate-rail') as HTMLButtonElement;
      expect(operateBtn).toBeTruthy();
      operateBtn.click();
      hostFixture.detectChanges();

      expect(hostComponent.lastOperatedRail).toBe('Pago Móvil');
    });

    it('closes popover and resets active stream when close button is clicked', () => {
      comp.selectRail('MERCANTIL');
      hostFixture.detectChanges();
      expect(comp.activeRailId()).toBe('MERCANTIL');

      const closeBtn = hostFixture.nativeElement.querySelector('.btn-close-popover') as HTMLButtonElement;
      closeBtn.click();
      hostFixture.detectChanges();

      expect(comp.activeRailId()).toBeNull();
      expect(hostFixture.nativeElement.querySelector('.rail-popover')).toBeNull();
    });
  });

  describe('Orbital Profit Neto Ring & Liquidity Action', () => {
    let hostFixture: ComponentFixture<TestHostComponent>;
    let hostComponent: TestHostComponent;

    beforeEach(() => {
      hostFixture = TestBed.createComponent(TestHostComponent);
      hostComponent = hostFixture.componentInstance;
      hostFixture.detectChanges();
    });

    it('renders orbital ring with formatted net profit and ROI', () => {
      const ring = hostFixture.nativeElement.querySelector('.orbital-profit-ring');
      expect(ring).toBeTruthy();
      expect(ring.textContent).toContain('PROFIT NETO');
      expect(ring.textContent).toContain('+145.80');
      expect(ring.textContent).toContain('5.2%');
    });

    it('emits injectLiquidity when injection button is clicked', () => {
      const injectBtn = hostFixture.nativeElement.querySelector('.btn-inject-liquidity') as HTMLButtonElement;
      expect(injectBtn).toBeTruthy();

      injectBtn.click();
      hostFixture.detectChanges();

      expect(hostComponent.injectLiquidityCalled).toBe(true);
    });
  });
});
