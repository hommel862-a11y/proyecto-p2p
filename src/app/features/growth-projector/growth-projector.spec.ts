import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GrowthProjectorComponent } from './growth-projector';
import { AccountsService } from '../../core/accounts.service';
import { CotizaveService } from '../../core/cotizave.service';
import { BinanceP2pService } from '../../core/binance-p2p.service';
import { McpService } from '../../core/mcp.service';
import { ToastService } from '../../core/toast.service';
import { signal } from '@angular/core';

describe('GrowthProjectorComponent', () => {
  let component: GrowthProjectorComponent;
  let fixture: ComponentFixture<GrowthProjectorComponent>;

  const mockAccountsService = {
    accounts: signal([
      { id: 'acc-1', bankName: 'Banesco', bankCode: 'BANESCO', rail: 'PAGO_MOVIL', dailyLimitVes: 50000 },
      { id: 'acc-2', bankName: 'Mercantil', bankCode: 'MERCANTIL', rail: 'TRANSFERENCIA', dailyLimitVes: 200000 },
    ]),
    treasurySummary: signal({
      totalBalanceVes: 100000,
      totalSpentTodayVes: 25000,
      totalReceivedTodayVes: 30000,
      totalSpentThisMonthVes: 120000,
      accountsUsage: [],
      nearLimitCount: 0,
      overLimitCount: 0,
      nearMonthlyLimitCount: 0,
      overMonthlyLimitCount: 0,
    }),
  };

  const mockCotizaveService = {
    ratesByMarket: signal({
      parallel: { market: 'parallel', type: 'parallel', mid: 65.5, updatedAt: new Date().toISOString() },
      bcv: { market: 'bcv', type: 'reference', mid: 58.2, updatedAt: new Date().toISOString() },
    }),
    fetchRates: vi.fn().mockResolvedValue({}),
    refreshIfStale: vi.fn().mockResolvedValue({}),
  };

  const mockBinanceService = {
    marketDepth: signal({
      asset: 'USDT',
      fiat: 'VES',
      bestBuyPrice: 65.0,
      bestSellPrice: 65.75,
      spreadVes: 0.75,
      spreadPct: 1.15,
      buyOffers: [],
      sellOffers: [],
      updatedAt: new Date().toISOString(),
    }),
    fetchMarketDepth: vi.fn().mockResolvedValue({
      asset: 'USDT',
      fiat: 'VES',
      bestBuyPrice: 65.0,
      bestSellPrice: 65.75,
      spreadVes: 0.75,
      spreadPct: 1.15,
      buyOffers: [],
      sellOffers: [],
      updatedAt: new Date().toISOString(),
    }),
  };

  const mockMcpService = {
    projectCompoundRunway: vi.fn().mockResolvedValue({
      success: true,
      result: {
        executiveSummary: 'Proyección institucional aprobada: capital proyectado viable.',
      },
    }),
    getBinanceP2pOrderbook: vi.fn().mockResolvedValue({
      success: true,
      result: {
        spreadPct: 1.25,
      },
    }),
  };

  const mockToast = {
    info: vi.fn(),
    warn: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GrowthProjectorComponent],
      providers: [
        { provide: AccountsService, useValue: mockAccountsService },
        { provide: CotizaveService, useValue: mockCotizaveService },
        { provide: BinanceP2pService, useValue: mockBinanceService },
        { provide: McpService, useValue: mockMcpService },
        { provide: ToastService, useValue: mockToast },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(GrowthProjectorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('debe crearse correctamente e inicializar en 90 días con $1,000 USDT', () => {
    expect(component).toBeTruthy();
    expect(component.initialCapitalUsdt()).toBe(1000);
    expect(component.operationalDays()).toBe(90);
    expect(component.reinvestmentRatePct()).toBe(100);
  });

  it('debe calcular la proyección matemática pura de crecimiento compuesto a 90 días', () => {
    const result = component.simulationResult();
    expect(result.initialCapitalUsdt).toBe(1000);
    expect(result.dailyProjection.length).toBe(90);
    expect(result.finalWorkingCapitalUsdt).toBeGreaterThan(1000);
    expect(result.totalReturnPct).toBeGreaterThan(0);
    expect(result.milestones.day30CapitalUsdt).toBeGreaterThan(1000);
    expect(result.milestones.day60CapitalUsdt).toBeGreaterThan(result.milestones.day30CapitalUsdt);
    expect(result.milestones.day90CapitalUsdt).toBeGreaterThan(result.milestones.day60CapitalUsdt);
  });

  it('debe reflejar cambios en la política de reinversión vs cosecha (50/50)', () => {
    component.setReinvestmentPolicy(50);
    const result = component.simulationResult();

    expect(component.reinvestmentRatePct()).toBe(50);
    expect(result.totalHarvestedUsdt).toBeGreaterThan(0);
    expect(result.finalWorkingCapitalUsdt).toBeLessThan(component.simulationResult().totalPortfolioValueUsdt);
  });

  it('debe proyectar en modo libre sin generar alertas de saturación bancaria por defecto', () => {
    // Modo libre por defecto: el capital que introduce el usuario manda de forma soberana
    component.initialCapitalUsdt.set(50000);
    const result = component.simulationResult();

    expect(component.checkBankingWall()).toBe(false);
    expect(result.bankingWallAlert).toBeUndefined();
    expect(component.bankingWallX()).toBeNull();
  });

  it('debe detectar el Muro Bancario SUDEBAN cuando el usuario activa la verificación explícitamente', () => {
    // Cuando el usuario activa la verificación explícita de límites bancarios
    component.initialCapitalUsdt.set(50000);
    component.checkBankingWall.set(true);
    const result = component.simulationResult();

    expect(result.bankingWallAlert).toBeDefined();
    expect(result.bankingWallAlert?.firstDayExceeded).toBe(1);
    expect(component.bankingWallX()).not.toBeNull();
  });

  it('debe permitir cargar el saldo de tesorería opcionalmente al presionar el botón de caja', () => {
    // mockAccountsService tiene 100,000 VES / tasa 65.5 = ~1526.72 USDT
    expect(component.treasuryBalanceUsdt()).toBeGreaterThan(0);
    component.loadFromTreasury();
    expect(component.initialCapitalUsdt()).toBe(component.treasuryBalanceUsdt());
    expect(mockToast.info).toHaveBeenCalledWith(
      expect.stringContaining('Capital inicial fijado al saldo de tesorería'),
      'Tesorería Sincronizada'
    );
  });

  it('debe generar las coordenadas SVG nativas para el gráfico interactivo', () => {
    const points = component.chartPoints();
    expect(points.length).toBe(90);
    expect(component.capitalAreaPath()).toContain('M');
    expect(component.capitalLinePath()).toContain('M');

    // Simular hover sobre el primer punto
    component.onPointHover(points[0]);
    expect(component.hoveredPoint()).toEqual(points[0].point);
    expect(component.hoveredCoords()).toEqual({ x: points[0].x, y: points[0].yCapital });

    component.onMouseLeaveChart();
    expect(component.hoveredPoint()).toBeNull();
  });

  it('debe sincronizar el spread neto con Binance P2P en vivo', async () => {
    await component.applyLiveNetMargin();
    // 1.15 spreadPct - 0.35 comisión = 0.80%
    expect(component.netMarginPctPerCycle()).toBe(0.8);
    expect(mockToast.success).toHaveBeenCalled();
  });

  it('debe invocar la auditoría institucional con el servidor MCP', async () => {
    await component.runMcpInstitutionalAudit();
    expect(mockMcpService.projectCompoundRunway).toHaveBeenCalledWith(expect.objectContaining({
      initialCapitalUsdt: component.initialCapitalUsdt(),
      netMarginPctPerCycle: component.netMarginPctPerCycle(),
    }));
    expect(component.mcpVerdict()).toContain('Proyección institucional aprobada');
    expect(mockToast.success).toHaveBeenCalled();
  });

  it('debe permitir alternar la expansión de la tabla diaria', () => {
    expect(component.isTableExpanded()).toBe(false);
    component.toggleTable();
    expect(component.isTableExpanded()).toBe(true);
  });

  it('debe calcular la cobertura de Runway de gastos fijos mensuales', () => {
    component.monthlyFixedExpensesUsdt.set(200);
    const coverage = component.monthlyRunwayCoverageMonths();
    expect(coverage).toBeGreaterThan(0);
  });
});
