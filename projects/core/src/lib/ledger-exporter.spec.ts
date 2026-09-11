import { describe, it, expect, vi } from 'vitest';
import {
  operationsToCsv,
  accountsToCsv,
  computeInstitutionalMetrics,
  exportLedgerReport,
  metricsToCsv,
  type ExportConfig,
  type InstitutionalMetrics,
} from './ledger-exporter';
import type { Operation } from './log';
import type { BankAccount } from './accounts';

describe('ledger-exporter', () => {
  const mockOps: Operation[] = [
    {
      id: 'OP-001',
      timestamp: '2026-09-08T10:00:00.000Z',
      type: 'buy',
      pair: 'USDT',
      vesAmount: 20000,
      usdtAmount: 25,
      price: 800,
      merchantNote: 'Banesco',
      fees: 50,
      notes: 'Compra estándar',
      errorFree: true,
      operatorId: 'op-alpha',
      operatorName: 'Ana',
    },
    {
      id: 'OP-002',
      timestamp: '2026-09-08T11:00:00.000Z',
      type: 'sell',
      pair: 'USDT',
      vesAmount: 18000,
      usdtAmount: 22.5,
      price: 800,
      merchantNote: 'Mercantil',
      fees: 45,
      notes: 'Venta estándar',
      errorFree: true,
      operatorId: 'op-beta',
      operatorName: 'Carlos',
    },
    {
      id: 'OP-003',
      timestamp: '2026-09-09T10:00:00.000Z',
      type: 'buy',
      pair: 'USDT',
      vesAmount: 40000,
      usdtAmount: 50,
      price: 800,
      merchantNote: 'Banesco',
      fees: 100,
      notes: 'Compra grande',
      errorFree: true,
      operatorId: 'op-alpha',
      operatorName: 'Ana',
    },
  ];

  const mockAccounts: BankAccount[] = [
    {
      id: 'acc-1',
      bankName: 'Banesco',
      bankCode: 'BANESCO',
      rail: 'PAGO_MOVIL',
      accountNumberMasked: '0412-***1234',
      dailyLimitVes: 50000,
      monthlyLimitVes: 500000,
      initialBalanceVes: 100000,
    },
    {
      id: 'acc-2',
      bankName: 'Mercantil',
      bankCode: 'MERCANTIL',
      rail: 'TRANSFERENCIA',
      accountNumberMasked: '0105-***5678',
      dailyLimitVes: 30000,
      monthlyLimitVes: 300000,
      initialBalanceVes: 50000,
    },
  ];

  const baseConfig: ExportConfig = {
    format: 'csv',
    scope: 'full',
    includeHeaders: true,
    timezone: 'America/Caracas',
  };

  describe('operationsToCsv', () => {
    it('genera CSV con headers correctos', () => {
      const csv = operationsToCsv(mockOps, true);
      expect(csv).toContain('ID,Fecha,Tipo,Par,Monto VES');
      expect(csv).toContain('OP-001');
      expect(csv).toContain('25.0000');
    });

    it('omite headers cuando includeHeaders=false', () => {
      const csv = operationsToCsv(mockOps, false);
      expect(csv).not.toContain('ID,Fecha,Tipo');
      expect(csv).toContain('OP-001');
    });

    it('escapa comillas en notas', () => {
      const opsWithQuotes: Operation[] = [{
        ...mockOps[0],
        notes: 'Nota con "comillas"',
      }];
      const csv = operationsToCsv(opsWithQuotes, true);
      expect(csv).toContain('""comillas""');
    });
  });

  describe('accountsToCsv', () => {
    it('genera CSV de cuentas con todos los campos', () => {
      const csv = accountsToCsv(mockAccounts, true);
      expect(csv).toContain('ID,Banco,Código,Rail');
      expect(csv).toContain('Banesco');
      expect(csv).toContain('500000.00'); // monthlyLimitVes
    });
  });

  describe('computeInstitutionalMetrics', () => {
    it('calcula métricas básicas correctamente', () => {
      const metrics = computeInstitutionalMetrics(mockOps, mockAccounts, baseConfig);
      
      expect(metrics.totalOperations).toBe(3);
      expect(metrics.totalVolumeVes).toBeGreaterThan(0);
      expect(metrics.netPnlVes).toBeDefined();
      expect(metrics.winRatePct).toBeGreaterThanOrEqual(0);
    });

    it('filtra por rango de fechas', () => {
      const config = { ...baseConfig, dateFrom: '2026-09-09', dateTo: '2026-09-09' };
      const metrics = computeInstitutionalMetrics(mockOps, mockAccounts, config);
      expect(metrics.totalOperations).toBe(1);
      expect(metrics.totalVolumeVes).toBe(40000);
    });

    it('filtra por banco', () => {
      const config = { ...baseConfig, bankId: 'Mercantil' };
      const metrics = computeInstitutionalMetrics(mockOps, mockAccounts, config);
      expect(metrics.totalOperations).toBe(1);
      expect(metrics.byBank['Mercantil']).toBeDefined();
    });

    it('filtra por operador', () => {
      const config = { ...baseConfig, operatorId: 'op-beta' };
      const metrics = computeInstitutionalMetrics(mockOps, mockAccounts, config);
      expect(metrics.totalOperations).toBe(1);
      expect(metrics.byOperator['op-beta'].count).toBe(1);
    });

    it('calcula APR real basado en capital promedio', () => {
      const metrics = computeInstitutionalMetrics(mockOps, mockAccounts, baseConfig);
      expect(metrics.aprRealPct).toBeDefined();
      expect(typeof metrics.aprRealPct).toBe('number');
    });

    it('calcula Sharpe ratio', () => {
      const metrics = computeInstitutionalMetrics(mockOps, mockAccounts, baseConfig);
      expect(metrics.sharpeRatio).toBeDefined();
    });

    it('calcula max drawdown', () => {
      const metrics = computeInstitutionalMetrics(mockOps, mockAccounts, baseConfig);
      expect(metrics.maxDrawdownPct).toBeGreaterThanOrEqual(0);
    });

    it('agrupa por banco, operador y tipo', () => {
      const metrics = computeInstitutionalMetrics(mockOps, mockAccounts, baseConfig);
      expect(Object.keys(metrics.byBank).length).toBeGreaterThan(0);
      expect(Object.keys(metrics.byOperator).length).toBeGreaterThan(0);
      expect(Object.keys(metrics.byType).length).toBeGreaterThan(0);
    });

    it('incluye dailyPnl ordenado', () => {
      const metrics = computeInstitutionalMetrics(mockOps, mockAccounts, baseConfig);
      expect(metrics.dailyPnl.length).toBeGreaterThan(0);
      // Verificar orden ascendente
      for (let i = 1; i < metrics.dailyPnl.length; i++) {
        expect(metrics.dailyPnl[i].date >= metrics.dailyPnl[i-1].date).toBe(true);
      }
    });
  });

  describe('metricsToCsv', () => {
    it('genera CSV de métricas con secciones', () => {
      const metrics = computeInstitutionalMetrics(mockOps, mockAccounts, baseConfig);
      const csv = metricsToCsv(metrics, true);
      
      expect(csv).toContain('Métrica,Valor');
      expect(csv).toContain('Total Operaciones');
      expect(csv).toContain('POR BANCO');
      expect(csv).toContain('POR OPERADOR');
      expect(csv).toContain('POR TIPO');
    });
  });

  describe('exportLedgerReport', () => {
    it('exporta CSV completo', async () => {
      const result = await exportLedgerReport(mockOps, mockAccounts, baseConfig);
      
      expect(result.mimeType).toBe('text/csv; charset=utf-8');
      expect(result.filename).toContain('.csv');
      expect(result.content).toContain('OP-001');
      expect(result.content).toContain('Banesco');
    });

    it('exporta solo operaciones', async () => {
      const config = { ...baseConfig, scope: 'operations' as const };
      const result = await exportLedgerReport(mockOps, mockAccounts, config);
      
      expect(result.content).toContain('OPERACIONES');
      expect(result.content).not.toContain('CUENTAS BANCARIAS');
    });

    it('exporta JSON', async () => {
      const config = { ...baseConfig, format: 'json' as const };
      const result = await exportLedgerReport(mockOps, mockAccounts, config);
      
      expect(result.mimeType).toBe('application/json');
      expect(result.filename).toContain('.json');
      const parsed = JSON.parse(result.content);
      expect(parsed.metadata).toBeDefined();
      expect(parsed.operations).toHaveLength(3);
    });

    it('exporta JSON encriptado', async () => {
      const config = { ...baseConfig, format: 'json-encrypted' as const, password: 'test123' };
      const result = await exportLedgerReport(mockOps, mockAccounts, config);
      
      expect(result.filename).toContain('.json.enc');
      const parsed = JSON.parse(result.content);
      expect(parsed.format).toBe('p2p-encrypted-v1');
      expect(parsed.ciphertext).toBeDefined();
    });

    it('lanza error si json-encrypted sin password', async () => {
      const config = { ...baseConfig, format: 'json-encrypted' as const };
      
      await expect(exportLedgerReport(mockOps, mockAccounts, config)).rejects.toThrow('Password required');
    });
  });
});