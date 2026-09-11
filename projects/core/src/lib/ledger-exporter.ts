/**
 * Exportador Contable Ejecutivo y Conciliación Automática (Multi-Format Ledger Exporter)
 * Proyecto: P2P Decisor - Nivel Avanzado
 * 
 * Funcionalidad:
 - Generación de reportes limpios y estructurados en CSV y JSON
 - Encriptación opcional AES-256 para JSON export
 - Métricas institucionales: PnL neto, comisiones, APR real, volumen de rotación
 - Filtros por fecha, banco, operador, tipo de operación
 - Formato compatible con Excel/Google Sheets y sistemas contables
 */

import type { Operation } from './log';
import type { BankAccount } from './accounts';
import { encryptBackupAES256, decryptBackupAES256 } from './backup-encryption';

export type ExportFormat = 'csv' | 'json' | 'json-encrypted';
export type ExportScope = 'operations' | 'accounts' | 'summary' | 'full';

export interface ExportConfig {
  format: ExportFormat;
  scope: ExportScope;
  dateFrom?: string;      // ISO date
  dateTo?: string;        // ISO date
  bankId?: string;
  operatorId?: string;
  operationTypes?: ('buy' | 'sell' | 'assign')[];
  includeHeaders: boolean;
  password?: string;      // For json-encrypted
  timezone: string;       // e.g., 'America/Caracas'
}

export interface InstitutionalMetrics {
  period: { from: string; to: string };
  totalOperations: number;
  totalVolumeUsdt: number;
  totalVolumeVes: number;
  netPnlVes: number;
  netPnlUsdt: number;
  totalFeesVes: number;
  totalFeesUsdt: number;
  aprRealPct: number;           // APR anualizado real
  turnoverRatio: number;        // Volumen / Capital promedio
  winRatePct: number;           // % operaciones ganadoras
  avgSpreadPct: number;         // Spread promedio ponderado
  maxDrawdownPct: number;       // Máxima caída desde pico
  sharpeRatio: number;          // Ratio riesgo-retorno
  bestOperation: { id: string; pnlVes: number } | null;
  worstOperation: { id: string; pnlVes: number } | null;
  byBank: Record<string, { volumeVes: number; count: number; pnlVes: number }>;
  byOperator: Record<string, { volumeVes: number; count: number; pnlVes: number }>;
  byType: Record<string, { volumeVes: number; count: number; pnlVes: number }>;
  dailyPnl: Array<{ date: string; pnlVes: number; volumeVes: number }>;
}

export interface ExportedReport {
  metadata: {
    generatedAt: string;
    generatedBy: string;
    format: ExportFormat;
    scope: ExportScope;
    filters: ExportConfig;
    recordCount: number;
  };
  metrics?: InstitutionalMetrics;
  operations?: Operation[];
  accounts?: BankAccount[];
  summary?: InstitutionalMetrics;
}

/**
 * Convierte operaciones a filas CSV
 */
export function operationsToCsv(operations: Operation[], includeHeaders = true): string {
  const headers = [
    'ID', 'Fecha', 'Tipo', 'Par', 'Monto VES', 'Monto USDT', 'Precio',
    'Comerciante', 'Comisiones VES', 'Comisiones USDT', 'Notas',
    'Error Free', 'Operador ID', 'Operador Nombre', 'Spread %', 'PnL VES'
  ];
  
  const rows = operations.map(op => [
    op.id,
    op.timestamp,
    op.type.toUpperCase(),
    op.pair,
    op.vesAmount.toFixed(2),
    op.usdtAmount.toFixed(4),
    op.price.toFixed(2),
    op.merchantNote || '',
    op.fees?.toFixed(2) || '0',
    (op.fees ? (op.fees / op.price) : 0).toFixed(4) || '0',
    (op.notes || '').replace(/"/g, '""'),
    op.errorFree ? 'SI' : 'NO',
    op.operatorId || '',
    op.operatorName || '',
    op.type === 'buy' || op.type === 'sell' ? calculateSpreadPct(op).toFixed(2) : '',
    op.type === 'sell' ? calculateOpPnL(op).toFixed(2) : '',
  ]);
  
  let csv = '';
  if (includeHeaders) csv += headers.join(',') + '\n';
  csv += rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  return csv;
}

/**
 * Convierte cuentas bancarias a CSV
 */
export function accountsToCsv(accounts: BankAccount[], includeHeaders = true): string {
  const headers = [
    'ID', 'Banco', 'Código', 'Rail', 'Número Enmascarado',
    'Límite Diario VES', 'Límite Mensual VES', 'Saldo Inicial VES'
  ];
  
  const rows = accounts.map(acc => [
    acc.id,
    acc.bankName,
    acc.bankCode,
    acc.rail,
    acc.accountNumberMasked,
    acc.dailyLimitVes?.toFixed(2) || '0',
    acc.monthlyLimitVes?.toFixed(2) || '0',
    acc.initialBalanceVes?.toFixed(2) || '0',
  ]);
  
  let csv = '';
  if (includeHeaders) csv += headers.join(',') + '\n';
  csv += rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  return csv;
}

/**
 * Calcula spread % de una operación
 */
function calculateSpreadPct(op: Operation): number {
  if (!op.price || op.price <= 0) return 0;
  // Simplified: spread vs reference price (would need market price in real impl)
  return 0;
}

/**
 * Calcula PnL de una operación individual
 */
function calculateOpPnL(op: Operation): number {
  // Simplified PnL calculation
  return op.vesAmount - (op.usdtAmount * op.price);
}

/**
 * Genera métricas institucionales completas
 */
export function computeInstitutionalMetrics(
  operations: Operation[],
  accounts: BankAccount[],
  config: ExportConfig
): InstitutionalMetrics {
  const filtered = filterOperations(operations, config);
  const dateFrom = config.dateFrom ? new Date(config.dateFrom) : null;
  const dateTo = config.dateTo ? new Date(config.dateTo) : null;
  
  let totalVolumeUsdt = 0;
  let totalVolumeVes = 0;
  let netPnlVes = 0;
  let netPnlUsdt = 0;
  let totalFeesVes = 0;
  let totalFeesUsdt = 0;
  let buyCount = 0, sellCount = 0;
  let winCount = 0;
  let spreadSum = 0;
  let spreadWeightedSum = 0;
  let spreadWeightedWeight = 0;
  const dailyMap = new Map<string, { pnl: number; volume: number }>();
  const byBank: Record<string, { volumeVes: number; count: number; pnlVes: number }> = {};
  const byOperator: Record<string, { volumeVes: number; count: number; pnlVes: number }> = {};
  const byType: Record<string, { volumeVes: number; count: number; pnlVes: number }> = {};
  
  let bestOp: { id: string; pnlVes: number } | null = null;
  let worstOp: { id: string; pnlVes: number } | null = null;
  let maxPnl = -Infinity;
  let minPnl = Infinity;
  
  for (const op of filtered) {
    const opDate = op.timestamp.split('T')[0];
    const pnlVes = calculateOpPnL(op);
    const volumeVes = Math.abs(op.vesAmount);
    const volumeUsdt = Math.abs(op.usdtAmount);
    const feeVes = op.fees || 0;
    const feeUsdt = feeVes / (op.price || 1);
    
    totalVolumeUsdt += volumeUsdt;
    totalVolumeVes += volumeVes;
    netPnlVes += pnlVes;
    netPnlUsdt += pnlVes / (op.price || 1);
    totalFeesVes += feeVes;
    totalFeesUsdt += feeUsdt;
    
    if (op.type === 'buy') buyCount++;
    if (op.type === 'sell') sellCount++;
    if (pnlVes > 0) winCount++;
    
    const spread = calculateSpreadPct(op);
    spreadSum += spread;
    spreadWeightedSum += spread * volumeVes;
    spreadWeightedWeight += volumeVes;
    
    if (pnlVes > maxPnl) { maxPnl = pnlVes; bestOp = { id: op.id, pnlVes }; }
    if (pnlVes < minPnl) { minPnl = pnlVes; worstOp = { id: op.id, pnlVes }; }
    
    // Daily aggregation
    const day = dailyMap.get(opDate) || { pnl: 0, volume: 0 };
    day.pnl += pnlVes;
    day.volume += volumeVes;
    dailyMap.set(opDate, day);
    
    // By bank
    const bankKey = op.merchantNote || 'UNKNOWN';
    byBank[bankKey] = byBank[bankKey] || { volumeVes: 0, count: 0, pnlVes: 0 };
    byBank[bankKey].volumeVes += volumeVes;
    byBank[bankKey].count++;
    byBank[bankKey].pnlVes += pnlVes;
    
    // By operator
    const opKey = op.operatorId || 'UNKNOWN';
    byOperator[opKey] = byOperator[opKey] || { volumeVes: 0, count: 0, pnlVes: 0 };
    byOperator[opKey].volumeVes += volumeVes;
    byOperator[opKey].count++;
    byOperator[opKey].pnlVes += pnlVes;
    
    // By type
    byType[op.type] = byType[op.type] || { volumeVes: 0, count: 0, pnlVes: 0 };
    byType[op.type].volumeVes += volumeVes;
    byType[op.type].count++;
    byType[op.type].pnlVes += pnlVes;
  }
  
  // APR calculation (simplified)
  const daysInPeriod = dateFrom && dateTo ? 
    Math.max(1, (dateTo.getTime() - dateFrom.getTime()) / (1000 * 60 * 60 * 24)) : 30;
  const avgCapital = accounts.reduce((sum, a) => sum + (a.initialBalanceVes || 0), 0) / Math.max(1, accounts.length);
  const aprRealPct = avgCapital > 0 ? (netPnlVes / avgCapital) * (365 / daysInPeriod) * 100 : 0;
  
  // Turnover ratio
  const turnoverRatio = avgCapital > 0 ? totalVolumeVes / avgCapital : 0;
  
  // Win rate
  const winRatePct = filtered.length > 0 ? (winCount / filtered.length) * 100 : 0;
  
  // Avg spread
  const avgSpreadPct = spreadWeightedWeight > 0 ? spreadWeightedSum / spreadWeightedWeight : 0;
  
  // Max drawdown (simplified)
  let peak = 0;
  let maxDrawdown = 0;
  let running = 0;
  for (const op of filtered.sort((a, b) => a.timestamp.localeCompare(b.timestamp))) {
    running += calculateOpPnL(op);
    if (running > peak) peak = running;
    const dd = peak - running;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }
  const maxDrawdownPct = peak > 0 ? (maxDrawdown / peak) * 100 : 0;
  
  // Sharpe (simplified)
  const returns = filtered.map(op => calculateOpPnL(op));
  const avgReturn = returns.reduce((a, b) => a + b, 0) / Math.max(1, returns.length);
  const stdDev = Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / Math.max(1, returns.length));
  const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;
  
  return {
    period: { 
      from: dateFrom?.toISOString() || filtered[0]?.timestamp || new Date().toISOString(),
      to: dateTo?.toISOString() || filtered[filtered.length - 1]?.timestamp || new Date().toISOString()
    },
    totalOperations: filtered.length,
    totalVolumeUsdt: Math.round(totalVolumeUsdt * 100) / 100,
    totalVolumeVes: Math.round(totalVolumeVes * 100) / 100,
    netPnlVes: Math.round(netPnlVes * 100) / 100,
    netPnlUsdt: Math.round(netPnlUsdt * 100) / 100,
    totalFeesVes: Math.round(totalFeesVes * 100) / 100,
    totalFeesUsdt: Math.round(totalFeesUsdt * 100) / 100,
    aprRealPct: Math.round(aprRealPct * 100) / 100,
    turnoverRatio: Math.round(turnoverRatio * 100) / 100,
    winRatePct: Math.round(winRatePct * 100) / 100,
    avgSpreadPct: Math.round(avgSpreadPct * 100) / 100,
    maxDrawdownPct: Math.round(maxDrawdownPct * 100) / 100,
    sharpeRatio: Math.round(sharpeRatio * 100) / 100,
    bestOperation: bestOp,
    worstOperation: worstOp,
    byBank,
    byOperator,
    byType,
    dailyPnl: Array.from(dailyMap.entries()).map(([date, data]) => ({
      date, pnlVes: Math.round(data.pnl * 100) / 100, volumeVes: Math.round(data.volume * 100) / 100
    })).sort((a, b) => a.date.localeCompare(b.date)),
  };
}

/**
 * Filtra operaciones según configuración
 */
function filterOperations(operations: Operation[], config: ExportConfig): Operation[] {
  return operations.filter(op => {
    const opDate = op.timestamp.split('T')[0];
    if (config.dateFrom && opDate < config.dateFrom.split('T')[0]) return false;
    if (config.dateTo && opDate > config.dateTo.split('T')[0]) return false;
    if (config.bankId && op.merchantNote !== config.bankId) return false;
    if (config.operatorId && op.operatorId !== config.operatorId) return false;
    if (config.operationTypes?.length && !config.operationTypes.includes(op.type)) return false;
    return true;
  });
}

/**
 * Exporta reporte completo según configuración
 */
export async function exportLedgerReport(
  operations: Operation[],
  accounts: BankAccount[],
  config: ExportConfig
): Promise<{ content: string; filename: string; mimeType: string }> {
  const metrics = computeInstitutionalMetrics(operations, accounts, config);
  const filteredOps = filterOperations(operations, config);
  
  const report: ExportedReport = {
    metadata: {
      generatedAt: new Date().toISOString(),
      generatedBy: 'P2P Decisor Export Engine',
      format: config.format,
      scope: config.scope,
      filters: config,
      recordCount: filteredOps.length,
    },
    metrics,
    operations: config.scope === 'operations' || config.scope === 'full' ? filteredOps : undefined,
    accounts: config.scope === 'accounts' || config.scope === 'full' ? accounts : undefined,
    summary: config.scope === 'summary' || config.scope === 'full' ? metrics : undefined,
  };
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  
  if (config.format === 'csv') {
    const csvParts: string[] = [];
    if (config.scope === 'operations' || config.scope === 'full') {
      csvParts.push('# OPERACIONES');
      csvParts.push(operationsToCsv(filteredOps, config.includeHeaders));
    }
    if (config.scope === 'accounts' || config.scope === 'full') {
      csvParts.push('\n# CUENTAS BANCARIAS');
      csvParts.push(accountsToCsv(accounts, config.includeHeaders));
    }
    if (config.scope === 'summary' || config.scope === 'full') {
      csvParts.push('\n# MÉTRICAS INSTITUCIONALES');
      csvParts.push(metricsToCsv(metrics, config.includeHeaders));
    }
    return {
      content: csvParts.join('\n'),
      filename: `p2p-ledger-${config.scope}-${timestamp}.csv`,
      mimeType: 'text/csv; charset=utf-8',
    };
  }
  
  if (config.format === 'json' || config.format === 'json-encrypted') {
    const json = JSON.stringify(report, null, 2);
    
    if (config.format === 'json-encrypted') {
      if (!config.password) throw new Error('Password required for encrypted export');
      const encrypted = await encryptBackupAES256(config.password, json);
      const encryptedJson = JSON.stringify(encrypted, null, 2);
      return {
        content: encryptedJson,
        filename: `p2p-ledger-${config.scope}-${timestamp}.json.enc`,
        mimeType: 'application/json',
      };
    }
    
    return {
      content: json,
      filename: `p2p-ledger-${config.scope}-${timestamp}.json`,
      mimeType: 'application/json',
    };
  }
  
  throw new Error(`Formato no soportado: ${config.format}`);
}

/**
 * Convierte métricas a CSV
 */
function metricsToCsv(metrics: InstitutionalMetrics, includeHeaders: boolean): string {
  const rows = [
    ['Métrica', 'Valor'],
    ['Total Operaciones', metrics.totalOperations.toString()],
    ['Volumen Total USDT', metrics.totalVolumeUsdt.toFixed(4)],
    ['Volumen Total VES', metrics.totalVolumeVes.toFixed(2)],
    ['PnL Neto VES', metrics.netPnlVes.toFixed(2)],
    ['PnL Neto USDT', metrics.netPnlUsdt.toFixed(4)],
    ['Comisiones Totales VES', metrics.totalFeesVes.toFixed(2)],
    ['Comisiones Totales USDT', metrics.totalFeesUsdt.toFixed(4)],
    ['APR Real %', metrics.aprRealPct.toFixed(2)],
    ['Ratio Rotación', metrics.turnoverRatio.toFixed(2)],
    ['Win Rate %', metrics.winRatePct.toFixed(2)],
    ['Spread Promedio %', metrics.avgSpreadPct.toFixed(2)],
    ['Max Drawdown %', metrics.maxDrawdownPct.toFixed(2)],
    ['Sharpe Ratio', metrics.sharpeRatio.toFixed(2)],
    ['Mejor Operación', metrics.bestOperation ? `${metrics.bestOperation.id}: ${metrics.bestOperation.pnlVes.toFixed(2)} VES` : 'N/A'],
    ['Peor Operación', metrics.worstOperation ? `${metrics.worstOperation.id}: ${metrics.worstOperation.pnlVes.toFixed(2)} VES` : 'N/A'],
  ];
  
  let csv = '';
  if (includeHeaders) csv += rows[0].join(',') + '\n';
  csv += rows.slice(1).map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  
  // Add byBank, byOperator, byType sections
  for (const [section, data] of [
    ['POR BANCO', metrics.byBank],
    ['POR OPERADOR', metrics.byOperator],
    ['POR TIPO', metrics.byType],
  ] as const) {
    csv += `\n# ${section}\n`;
    csv += (includeHeaders ? 'Clave,Volumen VES,Operaciones,PnL VES\n' : '');
    for (const [key, val] of Object.entries(data)) {
      csv += `"${key}",${val.volumeVes.toFixed(2)},${val.count},${val.pnlVes.toFixed(2)}\n`;
    }
  }
  
  return csv;
}

/**
 * Descarga reporte en navegador/Electron
 */
export function downloadReport(
  content: string,
  filename: string,
  mimeType: string
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export { metricsToCsv };