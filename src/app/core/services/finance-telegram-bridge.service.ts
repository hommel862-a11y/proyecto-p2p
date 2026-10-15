import { Injectable, inject } from '@angular/core';
import { Finance360Service } from '../finance-360.service';
import {
  type CurrencyCode,
  type FinanceScope,
  type ExpenseCategory,
  type IncomeCategory,
  computeTriMonetaryAmount,
} from '../models/finance-360.models';

export interface TelegramParsedAction {
  action: 'expense' | 'income' | 'cashea' | 'summary' | 'unknown';
  success: boolean;
  replyText: string;
}

export interface TelegramMessenger {
  sendTelegramMessage: (
    token: string,
    chatId: number | string,
    text: string,
  ) => Promise<boolean>;
}

@Injectable({ providedIn: 'root' })
export class FinanceTelegramBridgeService {
  private readonly financeService: Finance360Service;
  private telegramWorker: TelegramMessenger | null = null;

  constructor(
    financeService?: Finance360Service,
    telegramWorker?: TelegramMessenger,
  ) {
    if (financeService) {
      this.financeService = financeService;
    } else {
      try {
        this.financeService = inject(Finance360Service);
      } catch {
        this.financeService = null as unknown as Finance360Service;
      }
    }
    this.telegramWorker = telegramWorker ?? null;
  }

  setTelegramWorker(worker: TelegramMessenger): void {
    this.telegramWorker = worker;
  }

  /**
   * Intelligently parses incoming Telegram text messages with hashtags (#gasto, #ingreso, #cashea, #resumen)
   * and directly registers transactions into the isolated Finance 360 ledger.
   */
  processInboundTelegramCommand(text: string): TelegramParsedAction {
    const trimmed = text.trim();
    const lower = trimmed.toLowerCase();

    if (lower.startsWith('#gasto')) {
      return this.handleExpenseCommand(trimmed);
    }

    if (lower.startsWith('#ingreso')) {
      return this.handleIncomeCommand(trimmed);
    }

    if (lower.startsWith('#cashea')) {
      return this.handleCasheaCommand(trimmed);
    }

    if (lower.startsWith('#resumen') || lower.startsWith('#360') || lower.startsWith('/finanzas')) {
      return this.handleSummaryCommand();
    }

    return {
      action: 'unknown',
      success: false,
      replyText:
        '🤖 *HOMEL 360 Bot*\nComando no reconocido. Puedes usar:\n' +
        '• `#gasto [monto] [USD|Bs] [descripción] [personal|pyme]`\n' +
        '• `#ingreso [monto] [USD|Bs] [descripción] [personal|pyme]`\n' +
        '• `#cashea [monto] [nivel 1-5] [artículo]`\n' +
        '• `#resumen` (Radiografía de patrimonio y cuotas)',
    };
  }

  private handleExpenseCommand(text: string): TelegramParsedAction {
    // Example: #gasto 25 USD Gasolina pyme
    const parts = text.split(/\s+/);
    if (parts.length < 3) {
      return {
        action: 'expense',
        success: false,
        replyText: '⚠️ Formato inválido. Ejemplo: `#gasto 15 USD Gasolina para el camión pyme`',
      };
    }

    const amount = parseFloat(parts[1]);
    if (isNaN(amount) || amount <= 0) {
      return {
        action: 'expense',
        success: false,
        replyText: '⚠️ Monto inválido para el gasto.',
      };
    }

    let currency: CurrencyCode = 'USD';
    let startIndex = 2;
    const secondToken = parts[2].toUpperCase();
    if (secondToken === 'USD' || secondToken === '$' || secondToken === 'USDT') {
      currency = 'USD';
      startIndex = 3;
    } else if (secondToken === 'BS' || secondToken === 'VES') {
      currency = 'VES';
      startIndex = 3;
    }

    const remaining = parts.slice(startIndex).join(' ');
    let scope: FinanceScope = 'personal';
    let title = remaining || 'Gasto Telegram';

    if (remaining.toLowerCase().endsWith('pyme') || remaining.toLowerCase().endsWith('negocio')) {
      scope = 'business';
      title = remaining.replace(/(pyme|negocio)$/i, '').trim() || 'Gasto Comercial';
    } else if (remaining.toLowerCase().endsWith('personal')) {
      scope = 'personal';
      title = remaining.replace(/personal$/i, '').trim() || 'Gasto Personal';
    }

    const bcv = this.financeService.currentBcvRate();
    const parallel = this.financeService.currentParallelRate();
    const tri = computeTriMonetaryAmount(amount, currency, bcv, parallel);

    // Auto-categorize
    let category: ExpenseCategory = 'groceries';
    const lowerTitle = title.toLowerCase();
    if (lowerTitle.includes('gasolina') || lowerTitle.includes('transporte') || lowerTitle.includes('taxi')) {
      category = 'transport';
    } else if (lowerTitle.includes('sueldo') || lowerTitle.includes('empleado') || lowerTitle.includes('nomina')) {
      category = 'payroll';
    } else if (lowerTitle.includes('alquiler') || lowerTitle.includes('casa')) {
      category = 'housing';
    } else if (lowerTitle.includes('luz') || lowerTitle.includes('agua') || lowerTitle.includes('internet')) {
      category = 'services';
    } else if (lowerTitle.includes('repuesto') || lowerTitle.includes('pintura') || lowerTitle.includes('proveedor')) {
      category = 'provider_merchandise';
    }

    this.financeService.addExpense({
      title,
      scope,
      category,
      channel: currency === 'VES' ? 'bs_bank' : 'cash',
      triMonetary: tri,
      date: new Date().toISOString().split('T')[0],
      notes: 'Registrado automáticamente vía Telegram Bridge',
    });

    const reply =
      `✅ *Gasto Registrado en Finanzas 360*\n` +
      `📌 *Concepto:* ${title}\n` +
      `💵 *Monto:* $${tri.amount_usd.toFixed(2)} USD (≈ Bs ${tri.amount_ves.toFixed(2)})\n` +
      `🏢 *Ámbito:* ${scope === 'business' ? 'Pyme / Negocio' : 'Personal'}\n` +
      `🏷️ *Categoría:* ${category}`;

    return { action: 'expense', success: true, replyText: reply };
  }

  private handleIncomeCommand(text: string): TelegramParsedAction {
    // Example: #ingreso 150 USD Venta de repuestos pyme
    const parts = text.split(/\s+/);
    if (parts.length < 3) {
      return {
        action: 'income',
        success: false,
        replyText: '⚠️ Formato inválido. Ejemplo: `#ingreso 200 USD Cobro de presupuesto pyme`',
      };
    }

    const amount = parseFloat(parts[1]);
    if (isNaN(amount) || amount <= 0) {
      return {
        action: 'income',
        success: false,
        replyText: '⚠️ Monto inválido para el ingreso.',
      };
    }

    let currency: CurrencyCode = 'USD';
    let startIndex = 2;
    const secondToken = parts[2].toUpperCase();
    if (secondToken === 'USD' || secondToken === '$' || secondToken === 'USDT') {
      currency = 'USD';
      startIndex = 3;
    } else if (secondToken === 'BS' || secondToken === 'VES') {
      currency = 'VES';
      startIndex = 3;
    }

    const remaining = parts.slice(startIndex).join(' ');
    let scope: FinanceScope = 'personal';
    let title = remaining || 'Ingreso Telegram';

    if (remaining.toLowerCase().endsWith('pyme') || remaining.toLowerCase().endsWith('negocio')) {
      scope = 'business';
      title = remaining.replace(/(pyme|negocio)$/i, '').trim() || 'Ingreso Comercial';
    }

    const bcv = this.financeService.currentBcvRate();
    const parallel = this.financeService.currentParallelRate();
    const tri = computeTriMonetaryAmount(amount, currency, bcv, parallel);

    let category: IncomeCategory = 'salary';
    const lowerTitle = title.toLowerCase();
    if (lowerTitle.includes('venta') || lowerTitle.includes('cobro')) {
      category = 'business_sale';
    } else if (lowerTitle.includes('anticipo') || lowerTitle.includes('presupuesto')) {
      category = 'quote_advance';
    } else if (lowerTitle.includes('freelance') || lowerTitle.includes('honorario')) {
      category = 'freelance';
    }

    this.financeService.addIncome({
      title,
      scope,
      category,
      channel: currency === 'VES' ? 'bs_bank' : 'cash',
      triMonetary: tri,
      date: new Date().toISOString().split('T')[0],
      notes: 'Registrado automáticamente vía Telegram Bridge',
    });

    const reply =
      `💰 *Ingreso Registrado en Finanzas 360*\n` +
      `📌 *Concepto:* ${title}\n` +
      `💵 *Monto:* $${tri.amount_usd.toFixed(2)} USD (≈ Bs ${tri.amount_ves.toFixed(2)})\n` +
      `🏢 *Ámbito:* ${scope === 'business' ? 'Pyme / Negocio' : 'Personal'}`;

    return { action: 'income', success: true, replyText: reply };
  }

  private handleCasheaCommand(text: string): TelegramParsedAction {
    // Example: #cashea 180 3 Nevera Mabe
    const parts = text.split(/\s+/);
    if (parts.length < 3) {
      return {
        action: 'cashea',
        success: false,
        replyText: '⚠️ Formato inválido. Ejemplo: `#cashea 150 3 Taladro Percutor`',
      };
    }

    const amount = parseFloat(parts[1]);
    const levelRaw = parseInt(parts[2], 10);
    const level = (levelRaw >= 1 && levelRaw <= 5 ? levelRaw : 3) as any;
    const product = parts.slice(3).join(' ') || 'Compra Cashea';

    const breakdown = this.financeService.calculateCasheaBreakdown(amount, level, 3);
    const bcv = this.financeService.currentBcvRate();

    const plan = this.financeService.registerCasheaPlan({
      productName: product,
      storeName: 'Telegram Store',
      totalPriceUsd: amount,
      initialPaymentUsd: breakdown.initialPaymentUsd,
      initialPercentage: breakdown.initialPercentage,
      numberOfInstallments: 3,
      installmentAmountUsd: breakdown.installmentAmountUsd,
      installmentFrequencyDays: 14,
      startDate: new Date().toISOString().split('T')[0],
      installments: breakdown.installments,
      status: 'active',
    });

    const reply =
      `⚡ *Plan Cashea Registrado (Nivel ${level})*\n` +
      `🛍️ *Artículo:* ${product}\n` +
      `💵 *Total:* $${amount.toFixed(2)} USD\n` +
      `🟢 *Inicial a pagar hoy:* $${breakdown.initialPaymentUsd.toFixed(2)} USD (Bs ${(breakdown.initialPaymentUsd * bcv).toFixed(2)})\n` +
      `🗓️ *3 Cuotas quincenales:* $${breakdown.installmentAmountUsd.toFixed(2)} USD cada 14 días.\n` +
      `✓ Cuotas integradas en tus Pasivos de Finanzas 360.`;

    return { action: 'cashea', success: true, replyText: reply };
  }

  private handleSummaryCommand(): TelegramParsedAction {
    const netUsd = this.financeService.netWorthUsd();
    const netVes = this.financeService.netWorthVes();
    const bcv = this.financeService.currentBcvRate();
    const assetsUsd = this.financeService.totalAssetsUsd();
    const liabUsd = this.financeService.totalLiabilitiesUsd();
    const health = this.financeService.liquidityHealthStatus();
    const upcoming = this.financeService.upcomingLiabilities7Days();

    let reply =
      `💎 *RESUMEN EJECUTIVO FINANZAS 360*\n\n` +
      `📊 *Patrimonio Neto:* $${netUsd.toFixed(2)} USD (≈ Bs ${netVes.toFixed(2)})\n` +
      `🟢 *Activos Totales:* $${assetsUsd.toFixed(2)} USD\n` +
      `🔴 *Pasivos Totales:* $${liabUsd.toFixed(2)} USD\n` +
      `🏦 *Tasa BCV Oficial:* Bs ${bcv.toFixed(2)}\n\n` +
      `🚦 *Salud a 14 Días:* ${health.status.toUpperCase()} (${health.label})\n`;

    if (upcoming.length > 0) {
      reply += `\n⏳ *Vencimientos en los próximos 7 días:*\n`;
      for (const item of upcoming) {
        reply += `• ${item.dueDate}: $${item.remainingAmount.toFixed(2)} USD - ${item.title} (${item.creditor})\n`;
      }
    } else {
      reply += `\n✨ *Cero vencimientos urgentes en los próximos 7 días.*`;
    }

    return { action: 'summary', success: true, replyText: reply };
  }

  /**
   * Dispatches a daily automated briefing to the configured Telegram chat.
   */
  async sendDailyBriefingToTelegram(token?: string, chatId?: number | string): Promise<boolean> {
    if (!token || !chatId) {
      return false;
    }
    const summary = this.handleSummaryCommand();
    return await this.telegramWorker.sendTelegramMessage(token, chatId, summary.replyText);
  }
}
