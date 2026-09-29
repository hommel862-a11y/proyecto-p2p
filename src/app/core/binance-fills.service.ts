import { Injectable, inject, signal } from '@angular/core';
import { ToastService } from './toast.service';
import { DecisionJournalService } from './decision-journal.service';
import { CredentialStoreService } from './credential-store.service';
import {
  parseBinanceCsvFills,
  normalizeBinanceApiOrders,
  correlateFillsToDecisions,
  type BinanceC2cFill,
  type BinanceRawC2cOrder,
} from '@p2p/core';

export interface FillsSyncSummary {
  readonly recordedCount: number;
  readonly skippedCount: number;
  readonly unmatchedCount: number;
}

@Injectable({
  providedIn: 'root',
})
export class BinanceFillsService {
  private readonly toast = inject(ToastService);
  private readonly journal = inject(DecisionJournalService);
  private readonly credentials = inject(CredentialStoreService);

  readonly isSyncing = signal<boolean>(false);
  readonly lastSyncTimestamp = signal<string | null>(null);
  readonly lastSyncStats = signal<FillsSyncSummary | null>(null);
  readonly error = signal<string | null>(null);

  /**
   * Imports completed P2P trade fills from a Binance CSV export string and
   * writes corresponding verified outcomes into the Decision Journal.
   */
  async importCsv(csvContent: string, cycleId?: string): Promise<FillsSyncSummary> {
    this.isSyncing.set(true);
    this.error.set(null);

    try {
      const fills = parseBinanceCsvFills(csvContent);
      if (fills.length === 0) {
        throw new Error('El archivo CSV no contiene registros P2P válidos o reconocibles.');
      }

      const summary = await this.processAndRecordFills(fills, cycleId);
      this.lastSyncStats.set(summary);
      this.lastSyncTimestamp.set(new Date().toISOString());

      this.toast.success(
        `Importación CSV completada: ${summary.recordedCount} fills registrados, ${summary.skippedCount} existentes omitidos.`,
        'Fills de Binance P2P',
      );
      return summary;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.error.set(msg);
      this.toast.error(msg, 'Fills de Binance P2P');
      return { recordedCount: 0, skippedCount: 0, unmatchedCount: 0 };
    } finally {
      this.isSyncing.set(false);
    }
  }

  /**
   * Connects to Binance C2C API via the Electron desktop bridge to fetch recent
   * completed orders and correlates them with the Decision Journal.
   */
  async syncFromApi(tradeType: 'BUY' | 'SELL' = 'BUY', cycleId?: string): Promise<FillsSyncSummary> {
    this.isSyncing.set(true);
    this.error.set(null);

    try {
      const creds = await this.credentials.getBinanceCredentials();
      if (!creds?.apiKey || !creds?.apiSecret) {
        throw new Error(
          'Credenciales de Binance no configuradas. Por favor ingresa API Key y Secret en el almacén de seguridad.',
        );
      }

      const electron = (globalThis as unknown as {
        electron?: {
          fetchBinanceC2cOrders?: (req: unknown) => Promise<unknown>;
        };
      })?.electron;

      if (!electron?.fetchBinanceC2cOrders) {
        throw new Error(
          'El puente nativo de Electron no está disponible para consultar el historial de órdenes C2C.',
        );
      }

      const response = (await electron.fetchBinanceC2cOrders({
        apiKey: creds.apiKey,
        apiSecret: creds.apiSecret,
        tradeType,
        page: 1,
        rows: 100,
      })) as { data?: BinanceRawC2cOrder[]; success?: boolean; message?: string } | null;

      const rawOrders = response?.data;
      if (!Array.isArray(rawOrders)) {
        throw new Error(
          response?.message || 'Respuesta inválida recibida del servidor de Binance C2C.',
        );
      }

      const fills = normalizeBinanceApiOrders(rawOrders);
      const summary = await this.processAndRecordFills(fills, cycleId);

      this.lastSyncStats.set(summary);
      this.lastSyncTimestamp.set(new Date().toISOString());

      this.toast.success(
        `Sincronización API exitosa: ${summary.recordedCount} fills procesados (${summary.skippedCount} omitidos por duplicidad).`,
        'Fills de Binance P2P',
      );
      return summary;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.error.set(msg);
      this.toast.error(msg, 'Fills de Binance P2P');
      return { recordedCount: 0, skippedCount: 0, unmatchedCount: 0 };
    } finally {
      this.isSyncing.set(false);
    }
  }

  private async processAndRecordFills(
    fills: readonly BinanceC2cFill[],
    targetCycleId?: string,
  ): Promise<FillsSyncSummary> {
    // 1. Resolve decisions to correlate against
    let decisions = targetCycleId ? await this.journal.listDecisionsByCycle(targetCycleId) : [];

    if (decisions.length === 0) {
      const openCycles = await this.journal.listCycles({ status: 'OPEN' });
      if (openCycles.length > 0) {
        const decisionsInOpenCycles = await Promise.all(
          openCycles.map((c) => this.journal.listDecisionsByCycle(c.id)),
        );
        decisions = decisionsInOpenCycles.flat();
      }
    }

    // 2. Fetch existing outcomes to ensure idempotency
    const existingOutcomes = (
      await Promise.all(decisions.map((d) => this.journal.listOutcomesByDecision(d.id)))
    ).flat();

    // 3. Correlate
    const correlation = correlateFillsToDecisions({
      fills,
      decisions,
      existingOutcomes,
    });

    // 4. Persist outcomes into DecisionJournal
    for (const outcome of correlation.outcomesToRecord) {
      await this.journal.appendOutcome(outcome);
    }

    return {
      recordedCount: correlation.outcomesToRecord.length,
      skippedCount: correlation.skippedExistingFills.length,
      unmatchedCount: correlation.unmatchedFills.length,
    };
  }
}
