import { Injectable, inject, InjectionToken } from '@angular/core';
import { escapeMarkdownV2 } from '@p2p/core';
import { Finance360Service } from '../finance-360.service';
import { VoiceDictationService, type ParsedFinance360VoiceCommand } from '../voice-dictation.service';
import type { ParsedFinancialDocument } from './finance-ai-ingestor.service';
import {
  type CasheaInstallment,
  type CasheaLevel,
  type CasheaPlan,
  type CurrencyCode,
  type ExpenseCategory,
  type FinanceScope,
  type IncomeCategory,
  type PaymentChannel,
  calendarDaysBetween,
  computeTriMonetaryAmount,
  todayVetIso,
} from '../models/finance-360.models';

export interface TelegramParsedAction {
  action: 'expense' | 'income' | 'cashea' | 'summary' | 'unknown';
  success: boolean;
  replyText: string;
}

export interface TelegramAuthContext {
  authorized: boolean;
  chatId?: string | number;
}

export interface TelegramMessenger {
  sendTelegramMessage: (
    token: string,
    chatId: number | string,
    text: string,
  ) => Promise<boolean>;
}

export const TELEGRAM_MESSENGER = new InjectionToken<TelegramMessenger>('TELEGRAM_MESSENGER');

const VALID_CURRENCIES: readonly CurrencyCode[] = ['USD', 'USDT', 'VES', 'EUR'];

function escapeTgText(text: string): string {
  return escapeMarkdownV2(text ?? '').replace(/`/g, '\\`');
}

function escapeTgCode(text: string): string {
  return (text ?? '').replace(/\\/g, '\\\\').replace(/`/g, '\\`');
}

function parseStrictPositiveAmount(raw: string): number {
  const trimmed = (raw ?? '').trim();
  if (!/^\d+(?:[.,]\d+)?$/.test(trimmed)) {
    return Number.NaN;
  }
  const normalized = trimmed.replace(',', '.');
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return Number.NaN;
  }
  return parsed;
}

function parseCurrencyToken(token: string): CurrencyCode | null {
  const upper = (token ?? '').trim().toUpperCase();
  if (upper === 'USD' || upper === '$') return 'USD';
  if (upper === 'USDT') return 'USDT';
  if (upper === 'BS' || upper === 'BS.' || upper === 'VES') return 'VES';
  if (upper === 'EUR' || upper === '€') return 'EUR';
  return null;
}

function resolveChannelForCurrency(
  currency: CurrencyCode,
  vaultHint?: 'zelle' | 'bs_bank' | 'cash' | 'crypto' | 'pyme',
): PaymentChannel {
  if (vaultHint === 'zelle') return 'zelle';
  if (vaultHint === 'bs_bank') return 'bs_bank';
  if (vaultHint === 'crypto') return 'crypto';
  if (vaultHint === 'cash') return 'cash';
  if (currency === 'VES') return 'bs_bank';
  if (currency === 'USDT') return 'crypto';
  return 'cash';
}

function hasExplicitFinancialVoiceIntent(transcript: string): boolean {
  const lower = transcript.toLowerCase();
  const cleanLower = lower.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  const hasVerbOrDomainKeyword =
    /\b(gaste|pague|compre|transferi|abone|cancele|envie|retire|desembolse|egreso|gasto|cobre|recibi|ingres[oe]|entro|gane|vendi|facture|me\s+pagaron|me\s+transfirieron|me\s+depositaron|cashea|cuota|nomina|sueldo|salario|anticipo|presupuesto)\b/i.test(
      cleanLower,
    );
  const hasExplicitCurrency =
    /(\$|€|\b(?:usd|usdt|tether|d[oó]lares|dolares|bol[ií]vares|bs\.?|ves|euros?|eur)\b)/i.test(
      lower,
    );

  return hasVerbOrDomainKeyword || hasExplicitCurrency;
}

function extractInstallmentNumberFromText(text?: string): number | undefined {
  if (!text) return undefined;
  const match =
    text.match(/cuota\s*(?:n[°ºo.]?\s*|#\s*)?(\d{1,2})\b/i) ??
    text.match(/\b(\d{1,2})(?:ra|da|ta|va|na|er|°|º)?\s*cuota\b/i);
  if (!match) return undefined;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 24 ? parsed : undefined;
}

@Injectable({ providedIn: 'root' })
export class FinanceTelegramBridgeService {
  private readonly financeService = inject(Finance360Service);
  private readonly voiceDictation = inject(VoiceDictationService, { optional: true });
  private telegramWorker: TelegramMessenger | null = inject(TELEGRAM_MESSENGER, { optional: true });

  setTelegramWorker(worker: TelegramMessenger): void {
    this.telegramWorker = worker;
  }

  /**
   * Parses incoming Telegram text messages (`#gasto`, `#ingreso`, `#cashea`, `#resumen`, `#360`,
   * `/finanzas`, `/360`) and registers transactions directly into the isolated Finanzas 360 ledger.
   */
  processInboundTelegramCommand(
    text: string,
    auth?: TelegramAuthContext,
  ): TelegramParsedAction {
    if (auth && auth.authorized === false) {
      return this.buildUnauthorizedAction();
    }

    const trimmed = (text ?? '').trim();
    const lower = trimmed.toLowerCase();
    const commandToken = (lower.split(/\s+/)[0] ?? '').split('@')[0];

    if (commandToken === '#gasto') {
      return this.handleExpenseCommand(trimmed);
    }

    if (commandToken === '#ingreso') {
      return this.handleIncomeCommand(trimmed);
    }

    if (commandToken === '#cashea') {
      return this.handleCasheaCommand(trimmed);
    }

    if (
      commandToken === '#resumen' ||
      commandToken === '#360' ||
      commandToken === '/finanzas' ||
      commandToken === '/360'
    ) {
      return this.handleSummaryCommand();
    }

    return {
      action: 'unknown',
      success: false,
      replyText:
        '🤖 *HOMEL 360 Bot*\nComando no reconocido\\. Puedes usar:\n' +
        '• `#gasto [monto] [USD|USDT|Bs|EUR] [descripción] [personal|pyme]`\n' +
        '• `#ingreso [monto] [USD|USDT|Bs|EUR] [descripción] [personal|pyme]`\n' +
        '• `#cashea [monto] [nivel 1-6] [artículo]`\n' +
        '• `#resumen` / `/360` \\(Radiografía de patrimonio y cuotas\\)',
    };
  }

  /**
   * Parses Spanish voice transcripts (e.g., "Gasté 25 dólares en gasolina" or
   * "Cobré 120 USD venta taller pyme") into Finanzas 360 without ever fabricating entries
   * on unrecognized or non-financial audio.
   */
  ingestVoiceTranscript(
    transcript: string,
    auth?: TelegramAuthContext,
  ): TelegramParsedAction {
    if (auth && auth.authorized === false) {
      return this.buildUnauthorizedAction();
    }

    const trimmed = (transcript ?? '').trim();
    if (!trimmed) {
      return {
        action: 'unknown',
        success: false,
        replyText:
          '🎙️ No se recibió texto transcrito de la nota de voz\\. No se registró ningún movimiento\\.',
      };
    }

    const firstToken = trimmed.toLowerCase().split(/\s+/)[0]?.split('@')[0] ?? '';
    if (
      firstToken === '#gasto' ||
      firstToken === '#ingreso' ||
      firstToken === '#cashea' ||
      firstToken === '#resumen' ||
      firstToken === '#360' ||
      firstToken === '/finanzas' ||
      firstToken === '/360'
    ) {
      return this.processInboundTelegramCommand(trimmed, auth);
    }

    if (!hasExplicitFinancialVoiceIntent(trimmed)) {
      return {
        action: 'unknown',
        success: false,
        replyText:
          '🎙️ No se detectó una instrucción financiera válida en el audio\\. Ejemplo: `Gasté 25 dólares en gasolina` o `Cobré 120 USD venta taller pyme`\\.',
      };
    }

    const bcv = this.resolveLiveBcvRate();
    const parallel = this.resolveLiveParallelRate();
    const parsed = this.voiceDictation
      ? this.voiceDictation.parseFinance360Command(trimmed, bcv)
      : this.parseVoiceFallback(trimmed);

    if (!Number.isFinite(parsed.amount) || parsed.amount <= 0) {
      return {
        action: 'unknown',
        success: false,
        replyText:
          '🎙️ No se detectó un monto válido en la nota de voz\\. No se registró ningún movimiento\\.',
      };
    }

    if (parsed.referenceNumber && this.isDuplicateReference(parsed.referenceNumber)) {
      return {
        action: parsed.pillar,
        success: false,
        replyText: `⚠️ *Referencia duplicada:* La referencia \`${escapeTgCode(parsed.referenceNumber)}\` ya existe en Finanzas 360\\.`,
      };
    }

    const today = todayVetIso();
    const vaultId = this.resolveMatchingVaultId(parsed.currency, parsed.scope, parsed.vaultHint);

    if (parsed.pillar === 'expense' && /\bcashea\b/i.test(trimmed)) {
      const installmentNum = extractInstallmentNumberFromText(trimmed);
      const casheaLinked = this.trySettleCasheaInstallment({
        title: parsed.title,
        referenceNumber: parsed.referenceNumber,
        casheaInstallmentNumber: installmentNum,
        vaultId,
        bcv,
        referenceDate: today,
      });
      if (casheaLinked) {
        return casheaLinked;
      }
    }

    const tri = computeTriMonetaryAmount(parsed.amount, parsed.currency, bcv, parallel);
    const channel = resolveChannelForCurrency(parsed.currency, parsed.vaultHint);

    if (parsed.pillar === 'income') {
      this.financeService.addIncome({
        title: parsed.title,
        scope: parsed.scope,
        category: parsed.incomeCategory,
        channel,
        vaultId,
        triMonetary: tri,
        date: today,
        referenceNumber: parsed.referenceNumber,
        notes: 'Registrado automáticamente por nota de voz vía Telegram Bridge',
      });

      const reply =
        `🎙️ *Ingreso por Voz Registrado en Finanzas 360*\n` +
        `📌 *Concepto:* ${escapeTgText(parsed.title)}\n` +
        `💵 *Monto:* \`$${tri.amount_usd.toFixed(2)} USD\` \\(≈ \`Bs ${tri.amount_ves.toFixed(2)}\`\\)\n` +
        `🏢 *Ámbito:* ${escapeTgText(parsed.scope === 'business' ? 'Pyme / Negocio' : 'Personal')}`;

      return { action: 'income', success: true, replyText: reply };
    }

    this.financeService.addExpense({
      title: parsed.title,
      scope: parsed.scope,
      category: parsed.expenseCategory,
      channel,
      vaultId,
      triMonetary: tri,
      date: today,
      referenceNumber: parsed.referenceNumber,
      notes: 'Registrado automáticamente por nota de voz vía Telegram Bridge',
    });

    const reply =
      `🎙️ *Gasto por Voz Registrado en Finanzas 360*\n` +
      `📌 *Concepto:* ${escapeTgText(parsed.title)}\n` +
      `💵 *Monto:* \`$${tri.amount_usd.toFixed(2)} USD\` \\(≈ \`Bs ${tri.amount_ves.toFixed(2)}\`\\)\n` +
      `🏢 *Ámbito:* ${escapeTgText(parsed.scope === 'business' ? 'Pyme / Negocio' : 'Personal')}\n` +
      `🏷️ *Categoría:* ${escapeTgText(parsed.expenseCategory)}`;

    return { action: 'expense', success: true, replyText: reply };
  }

  /**
   * Routes Finanzas 360 / Cashea photo receipts from Telegram directly into the isolated
   * Finanzas 360 ledger (linking active Cashea installments and enforcing duplicate-ref guards).
   */
  ingestPhotoReceipt(
    aiParsed: ParsedFinancialDocument | null,
    caption?: string,
    auth?: TelegramAuthContext,
  ): TelegramParsedAction {
    if (auth && auth.authorized === false) {
      return this.buildUnauthorizedAction();
    }

    const cleanCaption = (caption ?? '').trim();
    const lowerCaption = cleanCaption.toLowerCase();
    const isCasheaPhoto = Boolean(aiParsed?.isCashea) || /#cashea\b/i.test(lowerCaption);

    const bcv = this.resolveLiveBcvRate();
    const parallel = this.resolveLiveParallelRate();
    const today = todayVetIso();
    const entryDate =
      aiParsed?.date && /^\d{4}-\d{2}-\d{2}$/.test(aiParsed.date.trim())
        ? aiParsed.date.trim()
        : today;

    const currency: CurrencyCode =
      aiParsed?.currency && VALID_CURRENCIES.includes(aiParsed.currency)
        ? aiParsed.currency
        : 'VES';

    let scope: FinanceScope = aiParsed?.scope === 'business' ? 'business' : 'personal';
    if (/\b(pyme|negocio)\b/i.test(lowerCaption)) {
      scope = 'business';
    } else if (/\bpersonal\b/i.test(lowerCaption)) {
      scope = 'personal';
    }

    const referenceNumber = aiParsed?.referenceNumber?.trim() || undefined;
    if (referenceNumber && this.isDuplicateReference(referenceNumber)) {
      return {
        action: isCasheaPhoto ? 'cashea' : 'expense',
        success: false,
        replyText: `⚠️ *Comprobante duplicado:* La referencia \`${escapeTgCode(referenceNumber)}\` ya fue registrada en Finanzas 360\\.`,
      };
    }

    const vaultId = this.resolveMatchingVaultId(currency, scope);

    if (isCasheaPhoto) {
      const installmentNum =
        aiParsed?.casheaInstallmentNumber ??
        extractInstallmentNumberFromText(`${cleanCaption} ${aiParsed?.rawText ?? ''}`);

      const linked = this.trySettleCasheaInstallment({
        title: aiParsed?.title,
        entityName: aiParsed?.entityName,
        referenceNumber,
        casheaInstallmentNumber: installmentNum,
        vaultId,
        bcv,
        referenceDate: entryDate,
      });
      if (linked) {
        return linked;
      }
    }

    if (!aiParsed || !Number.isFinite(aiParsed.amount) || aiParsed.amount <= 0) {
      return {
        action: 'unknown',
        success: false,
        replyText:
          '⚠️ No se pudo extraer un monto válido del comprobante para Finanzas 360\\. Verifica la imagen o regístralo manualmente con `#gasto` / `#ingreso`\\.',
      };
    }

    const pillar: 'income' | 'expense' = /#ingreso\b/i.test(lowerCaption)
      ? 'income'
      : /#gasto\b/i.test(lowerCaption)
        ? 'expense'
        : aiParsed.pillar === 'income'
          ? 'income'
          : 'expense';

    const title = aiParsed.title?.trim() || aiParsed.entityName?.trim() || 'Comprobante Telegram 360';
    const tri = computeTriMonetaryAmount(aiParsed.amount, currency, bcv, parallel);
    const channel: PaymentChannel = aiParsed.channel ?? resolveChannelForCurrency(currency);

    if (pillar === 'income') {
      const category: IncomeCategory = aiParsed.incomeCategory ?? 'business_sale';
      this.financeService.addIncome({
        title,
        scope,
        category,
        channel,
        vaultId,
        triMonetary: tri,
        date: entryDate,
        referenceNumber,
        notes: 'Comprobante fotográfico asentado vía Telegram Bridge (aislado de P2P)',
      });

      const reply =
        `📸 *Ingreso Fotográfico Registrado en Finanzas 360*\n` +
        `📌 *Concepto:* ${escapeTgText(title)}\n` +
        `💵 *Monto:* \`$${tri.amount_usd.toFixed(2)} USD\` \\(≈ \`Bs ${tri.amount_ves.toFixed(2)}\`\\)\n` +
        (referenceNumber ? `🔖 *Referencia:* \`${escapeTgCode(referenceNumber)}\`\n` : '') +
        `🏢 *Ámbito:* ${escapeTgText(scope === 'business' ? 'Pyme / Negocio' : 'Personal')}`;

      return { action: 'income', success: true, replyText: reply };
    }

    const category: ExpenseCategory = isCasheaPhoto
      ? 'cashea_installment'
      : (aiParsed.expenseCategory ?? 'other');

    this.financeService.addExpense({
      title,
      scope,
      category,
      channel,
      vaultId,
      triMonetary: tri,
      date: entryDate,
      referenceNumber,
      notes: 'Comprobante fotográfico asentado vía Telegram Bridge (aislado de P2P)',
    });

    const reply =
      `📸 *Gasto Fotográfico Registrado en Finanzas 360*\n` +
      `📌 *Concepto:* ${escapeTgText(title)}\n` +
      `💵 *Monto:* \`$${tri.amount_usd.toFixed(2)} USD\` \\(≈ \`Bs ${tri.amount_ves.toFixed(2)}\`\\)\n` +
      (referenceNumber ? `🔖 *Referencia:* \`${escapeTgCode(referenceNumber)}\`\n` : '') +
      `🏢 *Ámbito:* ${escapeTgText(scope === 'business' ? 'Pyme / Negocio' : 'Personal')}\n` +
      `🏷️ *Categoría:* ${escapeTgText(category)}`;

    return { action: isCasheaPhoto ? 'cashea' : 'expense', success: true, replyText: reply };
  }

  private handleExpenseCommand(text: string): TelegramParsedAction {
    const parts = text.split(/\s+/);
    if (parts.length < 3) {
      return {
        action: 'expense',
        success: false,
        replyText: '⚠️ Formato inválido\\. Ejemplo: `#gasto 15 USD Gasolina para el camión pyme`',
      };
    }

    const amount = parseStrictPositiveAmount(parts[1]);
    if (!Number.isFinite(amount)) {
      return {
        action: 'expense',
        success: false,
        replyText: '⚠️ Monto inválido para el gasto\\.',
      };
    }

    let currency: CurrencyCode = 'USD';
    let startIndex = 2;
    const parsedCurrency = parseCurrencyToken(parts[2]);
    if (parsedCurrency) {
      currency = parsedCurrency;
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

    const bcv = this.resolveLiveBcvRate();
    const parallel = this.resolveLiveParallelRate();
    const tri = computeTriMonetaryAmount(amount, currency, bcv, parallel);
    const vaultId = this.resolveMatchingVaultId(currency, scope);

    let category: ExpenseCategory = 'groceries';
    const lowerTitle = title.toLowerCase();
    if (
      lowerTitle.includes('gasolina') ||
      lowerTitle.includes('transporte') ||
      lowerTitle.includes('taxi')
    ) {
      category = 'transport';
    } else if (
      lowerTitle.includes('sueldo') ||
      lowerTitle.includes('empleado') ||
      lowerTitle.includes('nomina') ||
      lowerTitle.includes('nómina')
    ) {
      category = 'payroll';
    } else if (lowerTitle.includes('alquiler') || lowerTitle.includes('casa')) {
      category = 'housing';
    } else if (
      lowerTitle.includes('luz') ||
      lowerTitle.includes('agua') ||
      lowerTitle.includes('internet')
    ) {
      category = 'services';
    } else if (
      lowerTitle.includes('repuesto') ||
      lowerTitle.includes('pintura') ||
      lowerTitle.includes('proveedor')
    ) {
      category = 'provider_merchandise';
    } else if (lowerTitle.includes('cashea') || lowerTitle.includes('cuota')) {
      category = 'cashea_installment';
    }

    this.financeService.addExpense({
      title,
      scope,
      category,
      channel: resolveChannelForCurrency(currency),
      vaultId,
      triMonetary: tri,
      date: todayVetIso(),
      notes: 'Registrado automáticamente vía Telegram Bridge',
    });

    const reply =
      `✅ *Gasto Registrado en Finanzas 360*\n` +
      `📌 *Concepto:* ${escapeTgText(title)}\n` +
      `💵 *Monto:* \`$${tri.amount_usd.toFixed(2)} USD\` \\(≈ \`Bs ${tri.amount_ves.toFixed(2)}\`\\)\n` +
      `🏢 *Ámbito:* ${escapeTgText(scope === 'business' ? 'Pyme / Negocio' : 'Personal')}\n` +
      `🏷️ *Categoría:* ${escapeTgText(category)}`;

    return { action: 'expense', success: true, replyText: reply };
  }

  private handleIncomeCommand(text: string): TelegramParsedAction {
    const parts = text.split(/\s+/);
    if (parts.length < 3) {
      return {
        action: 'income',
        success: false,
        replyText: '⚠️ Formato inválido\\. Ejemplo: `#ingreso 200 USD Cobro de presupuesto pyme`',
      };
    }

    const amount = parseStrictPositiveAmount(parts[1]);
    if (!Number.isFinite(amount)) {
      return {
        action: 'income',
        success: false,
        replyText: '⚠️ Monto inválido para el ingreso\\.',
      };
    }

    let currency: CurrencyCode = 'USD';
    let startIndex = 2;
    const parsedCurrency = parseCurrencyToken(parts[2]);
    if (parsedCurrency) {
      currency = parsedCurrency;
      startIndex = 3;
    }

    const remaining = parts.slice(startIndex).join(' ');
    let scope: FinanceScope = 'personal';
    let title = remaining || 'Ingreso Telegram';

    if (remaining.toLowerCase().endsWith('pyme') || remaining.toLowerCase().endsWith('negocio')) {
      scope = 'business';
      title = remaining.replace(/(pyme|negocio)$/i, '').trim() || 'Ingreso Comercial';
    } else if (remaining.toLowerCase().endsWith('personal')) {
      scope = 'personal';
      title = remaining.replace(/personal$/i, '').trim() || 'Ingreso Personal';
    }

    const bcv = this.resolveLiveBcvRate();
    const parallel = this.resolveLiveParallelRate();
    const tri = computeTriMonetaryAmount(amount, currency, bcv, parallel);
    const vaultId = this.resolveMatchingVaultId(currency, scope);

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
      channel: resolveChannelForCurrency(currency),
      vaultId,
      triMonetary: tri,
      date: todayVetIso(),
      notes: 'Registrado automáticamente vía Telegram Bridge',
    });

    const reply =
      `💰 *Ingreso Registrado en Finanzas 360*\n` +
      `📌 *Concepto:* ${escapeTgText(title)}\n` +
      `💵 *Monto:* \`$${tri.amount_usd.toFixed(2)} USD\` \\(≈ \`Bs ${tri.amount_ves.toFixed(2)}\`\\)\n` +
      `🏢 *Ámbito:* ${escapeTgText(scope === 'business' ? 'Pyme / Negocio' : 'Personal')}`;

    return { action: 'income', success: true, replyText: reply };
  }

  private handleCasheaCommand(text: string): TelegramParsedAction {
    const parts = text.split(/\s+/);
    if (parts.length < 3) {
      return {
        action: 'cashea',
        success: false,
        replyText: '⚠️ Formato inválido\\. Ejemplo: `#cashea 150 3 Taladro Percutor`',
      };
    }

    const amount = parseStrictPositiveAmount(parts[1]);
    if (!Number.isFinite(amount)) {
      return {
        action: 'cashea',
        success: false,
        replyText:
          '⚠️ Monto inválido para Cashea\\. Usa un valor numérico positivo \\(ej\\.: `#cashea 150 6 Nevera Mabe`\\)\\.',
      };
    }

    if (!/^\d+$/.test(parts[2])) {
      return {
        action: 'cashea',
        success: false,
        replyText:
          '⚠️ Nivel Cashea inválido\\. Usa un nivel entero entre `1` y `6` \\(Nivel 6 Araguaney\\)\\.',
      };
    }

    const levelRaw = Number.parseInt(parts[2], 10);
    if (!Number.isInteger(levelRaw) || levelRaw < 1 || levelRaw > 6) {
      return {
        action: 'cashea',
        success: false,
        replyText:
          '⚠️ Nivel Cashea fuera de rango\\. Los niveles válidos son `1` a `6` \\(Nivel 6 Araguaney\\)\\.',
      };
    }

    const level = levelRaw as CasheaLevel;
    const product = parts.slice(3).join(' ') || 'Compra Cashea';

    const breakdown = this.financeService.calculateCasheaBreakdown(amount, level, 3);
    const bcv = this.resolveLiveBcvRate();

    this.financeService.registerCasheaPlan({
      productName: product,
      storeName: 'Telegram Store',
      scope: 'personal',
      level,
      creditLine: 'principal',
      totalPriceUsd: amount,
      initialPaymentUsd: breakdown.initialPaymentUsd,
      initialPercentage: breakdown.initialPercentage,
      numberOfInstallments: 3,
      installmentAmountUsd: breakdown.installmentAmountUsd,
      installmentFrequencyDays: 14,
      startDate: todayVetIso(),
      installments: breakdown.installments,
      status: 'active',
    });

    const initialVesText =
      bcv > 0 ? ` \\(\`Bs ${(breakdown.initialPaymentUsd * bcv).toFixed(2)}\`\\)` : '';

    const reply =
      `⚡ *Plan Cashea Registrado \\(Nivel ${level}\\)*\n` +
      `🛍️ *Artículo:* ${escapeTgText(product)}\n` +
      `💵 *Total:* \`$${amount.toFixed(2)} USD\`\n` +
      `🟢 *Inicial a pagar hoy:* \`$${breakdown.initialPaymentUsd.toFixed(2)} USD\`${initialVesText}\n` +
      `🗓️ *3 Cuotas quincenales:* \`$${breakdown.installmentAmountUsd.toFixed(2)} USD\` cada 14 días\\.\n` +
      `✓ Cuotas integradas en tus Pasivos de Finanzas 360\\.`;

    return { action: 'cashea', success: true, replyText: reply };
  }

  private handleSummaryCommand(): TelegramParsedAction {
    const netUsd = this.financeService.netWorthUsd();
    const netVes = this.financeService.netWorthVes();
    const bcv = this.resolveLiveBcvRate();
    const assetsUsd = this.financeService.totalAssetsUsd();
    const liabUsd = this.financeService.totalLiabilitiesUsd();
    const health = this.financeService.liquidityHealthStatus();
    const upcoming = this.financeService.upcomingLiabilities7Days();

    let reply =
      `💎 *RESUMEN EJECUTIVO FINANZAS 360*\n\n` +
      `📊 *Patrimonio Neto:* \`$${netUsd.toFixed(2)} USD\` \\(≈ \`Bs ${netVes.toFixed(2)}\`\\)\n` +
      `🟢 *Activos Totales:* \`$${assetsUsd.toFixed(2)} USD\`\n` +
      `🔴 *Pasivos Totales:* \`$${liabUsd.toFixed(2)} USD\`\n` +
      `🏦 *Tasa BCV Oficial:* \`Bs ${bcv.toFixed(2)}\`\n\n` +
      `🚦 *Salud a 14 Días:* ${escapeTgText(health.status.toUpperCase())} \\(${escapeTgText(health.label)}\\)\n`;

    if (upcoming.length > 0) {
      reply += `\n⏳ *Vencimientos en los próximos 7 días:*\n`;
      for (const item of upcoming) {
        reply +=
          `• \`${escapeTgCode(item.dueDate)}\`: \`$${item.remainingAmount.toFixed(2)} USD\` \\- ` +
          `${escapeTgText(item.title)} \\(${escapeTgText(item.creditor)}\\)\n`;
      }
    } else {
      reply += `\n✨ *Cero vencimientos urgentes en los próximos 7 días\\.*`;
    }

    return { action: 'summary', success: true, replyText: reply };
  }

  private trySettleCasheaInstallment(params: {
    title?: string;
    entityName?: string;
    referenceNumber?: string;
    casheaInstallmentNumber?: number;
    vaultId?: string;
    bcv: number;
    referenceDate: string;
  }): TelegramParsedAction | null {
    const stateFn = this.financeService.state;
    const plans: CasheaPlan[] =
      typeof stateFn === 'function' ? (stateFn()?.casheaPlans ?? []) : [];
    const activePlans = plans.filter((p) => p.status === 'active');
    if (activePlans.length === 0) return null;

    const searchNeedle = `${params.title ?? ''} ${params.entityName ?? ''}`.toLowerCase();
    const matchedByName = activePlans.filter(
      (p) =>
        (p.productName && searchNeedle.includes(p.productName.toLowerCase())) ||
        (p.storeName && searchNeedle.includes(p.storeName.toLowerCase())),
    );
    const candidatePlans = matchedByName.length > 0 ? matchedByName : activePlans;

    let selectedPlan: CasheaPlan | null = null;
    let selectedInstallment: CasheaInstallment | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const plan of candidatePlans) {
      const unpaid = plan.installments.filter((i) => i.status !== 'paid');
      if (unpaid.length === 0) continue;

      if (params.casheaInstallmentNumber !== undefined) {
        const exact = unpaid.find((i) => i.number === params.casheaInstallmentNumber);
        if (exact) {
          selectedPlan = plan;
          selectedInstallment = exact;
          break;
        }
      }

      for (const inst of unpaid) {
        const distance = Math.abs(calendarDaysBetween(params.referenceDate, inst.dueDate));
        if (
          distance < bestDistance ||
          (distance === bestDistance &&
            selectedInstallment &&
            inst.dueDate < selectedInstallment.dueDate)
        ) {
          bestDistance = distance;
          selectedPlan = plan;
          selectedInstallment = inst;
        }
      }
    }

    if (!selectedPlan || !selectedInstallment) return null;

    if (typeof this.financeService.markCasheaInstallmentPaid !== 'function') {
      return null;
    }

    const result = this.financeService.markCasheaInstallmentPaid(
      selectedPlan.id,
      selectedInstallment.number,
      params.referenceNumber,
      params.bcv > 0 ? params.bcv : undefined,
      params.vaultId,
    );

    if (result.alreadyPaid) {
      return {
        action: 'cashea',
        success: false,
        replyText:
          `⚠️ *Cuota Cashea ya pagada:* La cuota \`#${selectedInstallment.number}\` de ` +
          `${escapeTgText(selectedPlan.productName)} ya estaba conciliada\\.`,
      };
    }

    if (!result.success) {
      return null;
    }

    const reply =
      `⚡ *Cuota Cashea Conciliada en Finanzas 360*\n` +
      `🛍️ *Plan:* ${escapeTgText(selectedPlan.productName)} \\(${escapeTgText(selectedPlan.storeName)}\\)\n` +
      `🗓️ *Cuota:* \`#${selectedInstallment.number}\` \\(Venc\\.: \`${escapeTgCode(selectedInstallment.dueDate)}\`\\)\n` +
      `💵 *Pagado:* \`$${result.paidAmountUsd.toFixed(2)} USD\`\n` +
      (params.referenceNumber
        ? `🔖 *Referencia:* \`${escapeTgCode(params.referenceNumber)}\`\n`
        : '') +
      `✓ Plan y pasivo actualizados sin duplicar gasto\\.`;

    return { action: 'cashea', success: true, replyText: reply };
  }

  private resolveMatchingVaultId(
    currency: CurrencyCode,
    scope: FinanceScope,
    vaultHint?: 'zelle' | 'bs_bank' | 'cash' | 'crypto' | 'pyme',
  ): string | undefined {
    const assetsFn = this.financeService.assets;
    const assets = typeof assetsFn === 'function' ? assetsFn() : [];
    if (!Array.isArray(assets) || assets.length === 0) return undefined;

    const compatible = assets.filter(
      (v) =>
        v.currency === currency &&
        (scope === 'all' || v.scope === scope || v.scope === 'all'),
    );
    if (compatible.length === 0) return undefined;

    if (vaultHint) {
      const hinted = compatible.find((v) =>
        vaultHint === 'pyme' ? v.scope === 'business' : v.channel === vaultHint,
      );
      if (hinted) return hinted.id;
    }

    const exactScope = compatible.find((v) => v.scope === scope);
    return (exactScope ?? compatible[0]).id;
  }

  private isDuplicateReference(referenceNumber?: string): boolean {
    if (!referenceNumber) return false;
    const checkFn = this.financeService.isDuplicateReference;
    return typeof checkFn === 'function' ? checkFn.call(this.financeService, referenceNumber) : false;
  }

  private resolveLiveBcvRate(): number {
    const rate = this.financeService.currentBcvRate();
    return Number.isFinite(rate) && rate > 0 ? rate : 0;
  }

  private resolveLiveParallelRate(): number {
    const rate = this.financeService.currentParallelRate();
    return Number.isFinite(rate) && rate > 0 ? rate : 0;
  }

  private buildUnauthorizedAction(): TelegramParsedAction {
    return {
      action: 'unknown',
      success: false,
      replyText:
        '⛔ *Acceso denegado en Finanzas 360*\\.\nChat no autorizado para operar sobre el libro contable\\.',
    };
  }

  private parseVoiceFallback(rawTranscript: string): ParsedFinance360VoiceCommand {
    const lower = rawTranscript.toLowerCase();
    const cleanLower = lower.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const isIncome =
      /\b(cobre|recibi|ingres[oe]|entro|gane|vendi|facture|me\s+pagaron|me\s+transfirieron|me\s+depositaron)\b/i.test(
        cleanLower,
      );

    let currency: CurrencyCode = 'USD';
    if (/\b(bol[ií]vares|bs\.?|ves)\b/i.test(lower)) currency = 'VES';
    else if (/\b(usdt|tether)\b/i.test(lower)) currency = 'USDT';
    else if (/\b(euros?|eur)\b|€/i.test(lower)) currency = 'EUR';

    const numMatch = rawTranscript.match(/(\d+(?:[.,]\d+)?)/);
    const amount = numMatch ? parseStrictPositiveAmount(numMatch[1]) : 0;
    const isBusiness = /\b(taller|pyme|negocio|proveedor|repuesto|n[oó]mina|cliente)\b/i.test(lower);

    return {
      rawTranscript,
      pillar: isIncome ? 'income' : 'expense',
      title: rawTranscript.slice(0, 80),
      amount: Number.isFinite(amount) ? amount : 0,
      currency,
      scope: isBusiness ? 'business' : 'personal',
      expenseCategory: /\b(gasolina|transporte|taxi)\b/i.test(lower)
        ? 'transport'
        : /\bcashea\b/i.test(lower)
          ? 'cashea_installment'
          : 'other',
      incomeCategory: /\b(venta|taller|cliente)\b/i.test(lower) ? 'business_sale' : 'salary',
      feeRatePct: 0,
      summaryBadges: [],
    };
  }

  /**
   * Dispatches a daily automated briefing to the configured Telegram chat.
   */
  async sendDailyBriefingToTelegram(token?: string, chatId?: number | string): Promise<boolean> {
    if (!token || !chatId || !this.telegramWorker) {
      return false;
    }
    const summary = this.handleSummaryCommand();
    return await this.telegramWorker.sendTelegramMessage(token, chatId, summary.replyText);
  }
}
