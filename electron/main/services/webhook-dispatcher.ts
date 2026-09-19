/**
 * Institutional Multi-Channel Webhook Dispatcher.
 * Dispatches strategy execution alerts and ledger records to Telegram Sentinel,
 * Google Sheets, and Generic Webhooks (Zapier/Make/Slack) with resilient fail-safe fallbacks.
 */

import type { StrategyPlanCard } from '../../shared/types';
import {
  formatTelegramMessage,
  sendTelegramAlert,
  type TelegramConfig,
  type RuleAlertEvent,
} from '../vendor/p2p-core/webhooks';

export interface WebhookDispatcherConfig {
  telegram?: {
    botToken?: string;
    chatId?: string;
    enabled?: boolean;
  };
  gsheets?: {
    webhookUrl?: string;
    spreadsheetId?: string;
    sheetName?: string;
    serviceAccountKeyJson?: string;
  };
  genericWebhook?: {
    url?: string;
    secret?: string;
  };
  fetchFn?: typeof fetch;
}

export interface PlanDispatchSummary {
  planId: string;
  timestamp: number;
  telegram: {
    sent: boolean;
    messageId?: number;
    error?: string;
  };
  sheets: {
    synced: boolean;
    mode: 'LIVE' | 'SIMULATED';
    updatedRange?: string;
    error?: string;
  };
  genericWebhook?: {
    dispatched: boolean;
    status?: number;
    error?: string;
  };
}

export class WebhookDispatcher {
  private config: WebhookDispatcherConfig;
  private fetchImpl: typeof fetch;

  constructor(config?: WebhookDispatcherConfig) {
    this.config = config || {};
    this.fetchImpl = this.config.fetchFn || globalThis.fetch;
  }

  /**
   * Refreshes credentials from process.env if not explicitly configured.
   */
  private resolveTelegramConfig(): TelegramConfig {
    const envToken = process.env['TELEGRAM_BOT_TOKEN'] || '';
    const envChatId = process.env['TELEGRAM_CHAT_ID'] || '';
    const token = this.config.telegram?.botToken || envToken;
    const chatId = this.config.telegram?.chatId || envChatId;
    const enabled = this.config.telegram?.enabled ?? (Boolean(token) && Boolean(chatId));

    return {
      botToken: token,
      chatId,
      enabled,
      alertsOnRisk: true,
      alertsOnFavorable: true,
      alertsOnAccountLimit: true,
    };
  }

  /**
   * Dispatches execution of an approved strategy plan across all configured channels.
   */
  async dispatchPlanExecution(plan: StrategyPlanCard): Promise<PlanDispatchSummary> {
    const now = Date.now();
    const summary: PlanDispatchSummary = {
      planId: plan.id,
      timestamp: now,
      telegram: { sent: false },
      sheets: { synced: false, mode: 'SIMULATED' },
    };

    // 1. Dispatch Telegram Sentinel Alert
    try {
      summary.telegram = await this.dispatchTelegramPlanAlert(plan);
    } catch (err: any) {
      summary.telegram = {
        sent: false,
        error: err?.message || String(err),
      };
    }

    // 2. Dispatch Google Sheets Ledger Sync
    try {
      summary.sheets = await this.dispatchGoogleSheetsSync(plan);
    } catch (err: any) {
      summary.sheets = {
        synced: false,
        mode: 'SIMULATED',
        error: err?.message || String(err),
      };
    }

    // 3. Dispatch Generic Webhook if configured
    const genericUrl = this.config.genericWebhook?.url || process.env['P2P_WEBHOOK_URL'];
    if (genericUrl) {
      try {
        summary.genericWebhook = await this.dispatchGenericWebhook(genericUrl, {
          event: 'PLAN_APPROVED',
          planId: plan.id,
          title: plan.title,
          route: plan.route,
          capitalRequiredUsdt: plan.capitalRequiredUsdt,
          expectedNetSpreadPct: plan.expectedNetSpreadPct,
          expectedProfitUsdt: plan.expectedProfitUsdt,
          assignedOperator: plan.assignedOperatorName,
          status: plan.status,
          timestamp: now,
        });
      } catch (err: any) {
        summary.genericWebhook = {
          dispatched: false,
          error: err?.message || String(err),
        };
      }
    }

    return summary;
  }

  /**
   * Formats and delivers institutional plan execution alert to Telegram Sentinel.
   */
  async dispatchTelegramPlanAlert(plan: StrategyPlanCard): Promise<{
    sent: boolean;
    messageId?: number;
    error?: string;
  }> {
    const tgConfig = this.resolveTelegramConfig();
    if (!tgConfig.enabled || !tgConfig.botToken || !tgConfig.chatId) {
      return {
        sent: false,
        error: 'Telegram Sentinel no configurado (TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID faltantes)',
      };
    }

    const event: RuleAlertEvent = {
      type: 'plan_approved',
      title: `${plan.title} [${plan.id}]`,
      details: `📍 <b>Ruta:</b> ${plan.route}\n💰 <b>Spread Estimado:</b> +${plan.expectedNetSpreadPct}%\n💵 <b>Ganancia Estimada:</b> $${plan.expectedProfitUsdt} USDT\n👤 <b>Operador:</b> ${plan.assignedOperatorName || 'Mesa Central'}`,
      value: `${plan.capitalRequiredUsdt} USDT`,
      timestamp: new Date().toISOString(),
    };

    const res = await sendTelegramAlert(tgConfig, event, this.fetchImpl);
    return {
      sent: res.success,
      messageId: res.messageId,
      error: res.error,
    };
  }

  /**
   * Syncs trade/plan execution data into Google Sheets Ledger.
   */
  async dispatchGoogleSheetsSync(plan: StrategyPlanCard): Promise<{
    synced: boolean;
    mode: 'LIVE' | 'SIMULATED';
    updatedRange?: string;
    error?: string;
  }> {
    const webhookUrl = this.config.gsheets?.webhookUrl || process.env['GSHEETS_WEBHOOK_URL'];
    const spreadsheetId =
      this.config.gsheets?.spreadsheetId ||
      process.env['GSHEETS_SPREADSHEET_ID'] ||
      '1p2p_Ledger_Master_Spreadsheet';
    const sheetName = this.config.gsheets?.sheetName || 'Ledger Planes P2P';

    const rowData = {
      timestamp: new Date().toISOString(),
      planId: plan.id,
      title: plan.title,
      route: plan.route,
      capitalRequiredUsdt: plan.capitalRequiredUsdt,
      expectedNetSpreadPct: plan.expectedNetSpreadPct,
      expectedProfitUsdt: plan.expectedProfitUsdt,
      operator: plan.assignedOperatorName || 'Mesa Central',
      status: plan.status,
    };

    // If a Google Apps Script / custom webhook URL is configured:
    if (webhookUrl) {
      try {
        const response = await this.fetchImpl(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            spreadsheetId,
            sheetName,
            action: 'APPEND_PLAN',
            data: rowData,
          }),
          signal: AbortSignal.timeout(5000),
        });

        if (response.ok) {
          return {
            synced: true,
            mode: 'LIVE',
            updatedRange: `'${sheetName}'!A:H`,
          };
        }

        return {
          synced: false,
          mode: 'SIMULATED',
          error: `HTTP ${response.status} desde webhook de Google Sheets`,
        };
      } catch (err: any) {
        return {
          synced: false,
          mode: 'SIMULATED',
          error: err?.message || 'Error de red en Google Sheets webhook',
        };
      }
    }

    // Deterministic simulation fallback
    return {
      synced: true,
      mode: 'SIMULATED',
      updatedRange: `'${sheetName}'!A2:H2`,
    };
  }

  /**
   * Dispatches payload to external generic HTTP POST endpoint (Zapier, Make, Slack).
   */
  private async dispatchGenericWebhook(
    url: string,
    payload: Record<string, unknown>,
  ): Promise<{ dispatched: boolean; status?: number; error?: string }> {
    try {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.genericWebhook?.secret
            ? { 'X-P2P-Signature': this.config.genericWebhook.secret }
            : {}),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      });

      return {
        dispatched: response.ok,
        status: response.status,
        error: response.ok ? undefined : `HTTP ${response.status}`,
      };
    } catch (err: any) {
      return {
        dispatched: false,
        error: err?.message || 'Error enviando webhook genérico',
      };
    }
  }
}
