import {
  ProcessRemoteSentinelCommandInputSchema,
  type ProcessRemoteSentinelCommandInput,
} from '../schemas/index.js';

export const processRemoteSentinelCommandTool = {
  name: 'process_remote_sentinel_command',
  description:
    'Procesa comandos remotos de texto o voz (ej. "Registra compra de 500 USDT a 41.50 en Banesco" o /killswitch) ingresando de forma determinística la operación al Ledger contable.',
  inputSchema: ProcessRemoteSentinelCommandInputSchema,
  execute: (input: ProcessRemoteSentinelCommandInput) => {
    const raw = input.rawText.trim();
    const lower = raw.toLowerCase();

    // 1. Check for standard sentinel slash commands
    if (lower.startsWith('/killswitch')) {
      return {
        commandType: 'SYSTEM_COMMAND',
        action: 'TRIGGER_KILLSWITCH',
        status: 'EXECUTED_SUCCESSFULLY',
        ledgerImpact: false,
        summary: 'Directiva de parada de emergencia activada remotamente.',
        rawText: raw,
        timestamp: new Date().toISOString(),
      };
    }

    if (lower.startsWith('/status') || lower.startsWith('/spreads') || lower.startsWith('/bcv')) {
      return {
        commandType: 'SYSTEM_QUERY',
        action: 'QUERY_MARKET_TELEMETRY',
        status: 'RESPONDED',
        ledgerImpact: false,
        summary: 'Telemetría del sistema y tasas consultadas con éxito.',
        rawText: raw,
        timestamp: new Date().toISOString(),
      };
    }

    // 2. Parse operational NLP commands (voice transcription or text message)
    // Pattern: "Registra (compra|venta) de (monto) (usdt|cripto) a (tasa) en (banco)"
    const sideMatch = lower.includes('compra') ? 'buy' : lower.includes('venta') ? 'sell' : null;

    // Extract numbers: volume and rate
    // e.g. "500 usdt a 41.50" or "compra de 500 a 41.50"
    const numberMatches = raw.match(/(\d+(?:[.,]\d+)?)/g);

    if (sideMatch && numberMatches && numberMatches.length >= 2) {
      const volumeUsdt = parseFloat(numberMatches[0]!.replace(',', '.'));
      const ratePrice = parseFloat(numberMatches[1]!.replace(',', '.'));
      const amountVes = Number((volumeUsdt * ratePrice).toFixed(2));

      // Extract bank if mentioned
      let bankName = 'Pago Móvil';
      if (lower.includes('banesco')) bankName = 'Banesco';
      else if (lower.includes('venezuela') || lower.includes('bdv'))
        bankName = 'Banco de Venezuela';
      else if (lower.includes('mercantil')) bankName = 'Mercantil';
      else if (lower.includes('provincial')) bankName = 'Provincial';
      else if (lower.includes('bancamiga')) bankName = 'Bancamiga';

      const entryId = `LEDGER-REMOTE-${Date.now()}`;

      return {
        commandType: 'LEDGER_TRANSACTION',
        action: 'ADD_OPERATION_ENTRY',
        status: 'PROCESSED_AND_SETTLED',
        ledgerImpact: true,
        transactionDetail: {
          ledgerId: entryId,
          side: sideMatch,
          usdtAmount: volumeUsdt,
          ratePrice,
          vesTotal: amountVes,
          bank: bankName,
          channelOrigin: input.channel,
          authorizedBy: input.senderId,
          recordedAt: new Date().toISOString(),
        },
        summary: `Operación remota registrada: ${sideMatch.toUpperCase()} ${volumeUsdt} USDT a ${ratePrice} VES (${amountVes.toLocaleString('es-VE')} VES) en ${bankName}.`,
        rawText: raw,
      };
    }

    return {
      commandType: 'UNRECOGNIZED_COMMAND',
      action: 'NONE',
      status: 'NEEDS_CLARIFICATION',
      ledgerImpact: false,
      summary:
        'No se pudo interpretar la instrucción. Formato sugerido: "Registra compra de 500 USDT a 41.50 en Banesco" o comandos /killswitch, /status.',
      rawText: raw,
      timestamp: new Date().toISOString(),
    };
  },
};
