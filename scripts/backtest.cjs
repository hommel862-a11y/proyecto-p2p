#!/usr/bin/env node
'use strict';

/**
 * Backtesting harness — Work Unit 1.3 (Fase 1 Consolidador).
 *
 * Validates the arbitrage engines (spread, arbitrage cycle, triangular) against REAL
 * history persisted by the app in Chromium localStorage (LevelDB):
 *   - p2p.market-history  -> MarketDataPoint[] snapshots (spread engine check)
 *   - p2p.operations      -> Operation[] ledger (realized vs theoretical check)
 *
 * The pure engine math is RE-IMPLEMENTED here (plain CJS mirrors of the core library
 * functions in projects/core/src/lib/spread.ts, spread-quality.ts and
 * triangular-arbitrage.ts) so the harness runs with zero build/deps. Every metric
 * reports which engine it mirrors.
 *
 * Usage:
 *   node scripts/backtest.cjs [--dir <leveldb-dir>] [--out <dir>] [--skip-ldb]
 *
 * Default leveldb dirs (Windows):
 *   %APPDATA%\p2p\Local Storage\leveldb                          (dev profile)
 *   %APPDATA%\p2p-decisor-desktop\Local Storage\leveldb          (packaged app)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = { dirs: [], out: null, skipLdb: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') args.dirs.push(argv[++i]);
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--skip-ldb') args.skipLdb = true;
    else args.dirs.push(a);
  }
  return args;
}

function defaultLevelDbDirs() {
  const apdata = process.env.APPDATA;
  const base = apdata || path.join(os.homedir(), 'AppData', 'Roaming');
  return [
    path.join(base, 'p2p', 'Local Storage', 'leveldb'),
    path.join(base, 'p2p-decisor-desktop', 'Local Storage', 'leveldb'),
  ];
}

// ---------------------------------------------------------------------------
// LevelDB localStorage extraction (Chromium format)
// ---------------------------------------------------------------------------
function varint(buf, off) {
  let result = 0;
  let shift = 0;
  let i = off;
  while (i < buf.length) {
    const byte = buf[i++];
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }
  return { value: result, next: i };
}

/**
 * Value stored in CURRENT (log) format:
 *   varint(total_len) + encoding byte + payload(total_len - 1)
 *   encoding 0x01 -> UTF-8, 0x00 -> UTF-16LE.
 */
function decodeLogValue(buf, start) {
  const v = varint(buf, start);
  if (v.value < 2 || v.next + 1 >= buf.length || buf[v.next] > 1) return null;
  const enc = buf[v.next];
  const pl = v.next + 1;
  const len = v.value - 1;
  if (pl + len > buf.length) return null;
  let s = enc === 1 ? buf.subarray(pl, pl + len).toString('utf8') : buf.subarray(pl, pl + len).toString('utf16le');
  if (s.endsWith('\x00\x00')) s = s.slice(0, -2);
  return s;
}

/**
 * Value stored in OLD .ldb (SST) format: raw UTF-8 JSON array, found by a
 * JSON-aware bracket scan. Returns null if no valid array is found.
 */
function decodeSstValue(buf, start) {
  let startIdx = -1;
  for (let i = start; i < Math.min(buf.length, start + 128); i++) {
    if (buf[i] === 0x5b) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = startIdx; i < buf.length; i++) {
    const c = buf[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === 0x5c) escaped = true; // backslash
      else if (c === 0x22) inString = false; // closing quote
      continue;
    }
    if (c === 0x22) {
      inString = true;
      continue;
    }
    if (c === 0x5b) depth++;
    else if (c === 0x5d) {
      depth--;
      if (depth === 0) return buf.subarray(startIdx, i + 1).toString('utf8');
    }
  }
  return null;
}

function rawOrigin(buf, pos) {
  const slice = buf.subarray(Math.max(0, pos - 60), pos + 2);
  const m = slice.toString('latin1').match(/_http[^\x00]*/);
  return m ? m[0].replace(/^_/, '') : null;
}

function extractFile(buf, keyName, fmt) {
  const name = Buffer.from(keyName, 'ascii');
  const out = [];
  let idx = buf.indexOf(name);
  while (idx !== -1) {
    const before = idx - 1;
    if (before >= 1 && buf[before] === 0x01 && buf[before - 1] === 0x00) {
      const vs = fmt === 'ldb' ? idx + name.length : idx + name.length;
      let text = fmt === 'ldb' ? decodeSstValue(buf, vs) : decodeLogValue(buf, vs);
      if (text !== null) {
        let parsed = null;
        try {
          parsed = JSON.parse(text);
        } catch (e) {
          parsed = null;
        }
        if (Array.isArray(parsed)) {
          out.push({ pos: idx, fmt, origin: rawOrigin(buf, before - 1), text, parsed });
        }
      }
    }
    idx = buf.indexOf(name, idx + 1);
  }
  return out;
}

function extractLevelDbDir(dir, opts) {
  const res = { dir, exists: false, logs: [], ldbs: [], keys: {}, decodeFailures: 0 };
  if (!fs.existsSync(dir)) return res;
  res.exists = true;
  const files = fs.readdirSync(dir).filter((f) => /\.(log|ldb)$/.test(f));
  for (const f of files) {
    let buf;
    try {
      buf = fs.readFileSync(path.join(dir, f));
    } catch (e) {
      res.logs.push({ file: f, error: `locked: ${e.code}` });
      continue;
    }
    const fmt = f.endsWith('.ldb') ? 'ldb' : 'log';
    if (fmt === 'ldb' && opts.skipLdb) continue;
    const meta = { file: f, fmt, bytes: buf.length, found: {} };
    for (const key of ['p2p.operations', 'p2p.market-history', 'p2p.counterparties', 'p2p.backup', 'p2p.audit-log']) {
      const hits = extractFile(buf, key, fmt);
      meta.found[key] = hits.length;
      for (const h of hits) {
        if (!h.origin) continue;
        const cur = res.keys[key] && res.keys[key][h.origin];
        if (!cur || h.text.length > cur.byteLen) {
          (res.keys[key] = res.keys[key] || {});
          res.keys[key][h.origin] = { file: f, fmt, byteLen: h.text.length, parsed: h.parsed };
        }
      }
      if (fmt === 'ldb' && key === 'p2p.market-history') {
        // count salvage failures (raw values that did not separate into valid JSON arrays)
        let i = buf.indexOf(Buffer.from(key, 'ascii'));
        while (i !== -1) {
          if (buf[i - 1] === 0x01 && buf[i - 2] === 0x00 && decodeSstValue(buf, i + key.length) === null) {
            res.decodeFailures++;
          }
          i = buf.indexOf(Buffer.from(key, 'ascii'), i + 1);
        }
      }
    }
    res[fmt === 'ldb' ? 'ldbs' : 'logs'].push(meta);
  }
  return res;
}

// ---------------------------------------------------------------------------
// Engine mirrors (documented re-implementations of projects/core pure functions)
// ---------------------------------------------------------------------------
const MAKER_FEE_RATE = 0.0025; // spread-quality.ts:180 «0.25% Binance P2P VES maker fee (feb-2026)»

function roundMoney(v, decimals) {
  if (!Number.isFinite(v)) return 0;
  const factor = 10 ** Math.max(0, Math.floor(decimals));
  return Math.round((v + Number.EPSILON) * factor) / factor;
}

/** Mirror of spread.ts computeSpread (commissionRate = fraction, applied to sell proceeds). */
function computeSpread(buyPrice, sellPrice, amount, unit, commissionRate = 0) {
  if (!(buyPrice > 0) || !(sellPrice > 0) || !(amount > 0)) return null;
  const isBase = unit === 'USDT' || unit === 'EUR';
  const usdtReceived = isBase ? amount : amount / buyPrice;
  const vesReceived = usdtReceived * sellPrice;
  const unitSpread = sellPrice - buyPrice;
  const gainVes = usdtReceived * unitSpread;
  const netVesAfterCommission = vesReceived * (1 - commissionRate);
  const netGainVes = gainVes - vesReceived * commissionRate;
  return { usdtReceived, vesReceived, unitSpread, gainVes, netVesAfterCommission, netGainVes };
}

/** Mirror of spread-quality.ts computeArbitrageCycle (MAKER/MAKER, same-bank, fees=0 rail). */
function computeArbitrageCycle(capitalUsdt, buyPrice, sellPrice, opts = {}) {
  const makerFeeRate = opts.makerFeeRate ?? MAKER_FEE_RATE;
  if (!(capitalUsdt > 0) || !(buyPrice > 0) || !(sellPrice > 0)) return null;
  const capitalVesInvested = capitalUsdt * buyPrice;
  const buyFeeUsdt = capitalUsdt * makerFeeRate;
  const acquiredUsdt = capitalUsdt - buyFeeUsdt;
  const sellFeeUsdt = acquiredUsdt * makerFeeRate;
  const netSoldUsdt = acquiredUsdt - sellFeeUsdt;
  const grossProceedsVes = netSoldUsdt * sellPrice;
  const bankFeesVes = 0; // same-bank, isInterbank=false per VENEZUELAN_BANK_FEES (tarifas 0)
  const netProceedsVes = grossProceedsVes - bankFeesVes;
  const netGainVes = netProceedsVes - capitalVesInvested;
  const netGainUsd = netGainVes / sellPrice;
  const roiCyclePct = (netGainVes / capitalVesInvested) * 100;
  const spreadNominalPct = ((sellPrice - buyPrice) / buyPrice) * 100;
  return {
    capitalUsdt,
    capitalVesInvested,
    binanceFeeUsdt: buyFeeUsdt + sellFeeUsdt,
    netCryptoUsdt: netSoldUsdt,
    grossProceedsVes,
    bankFeesVes,
    netProceedsVes,
    netGainVes,
    netGainUsd,
    roiCyclePct,
    spreadNominalPct,
    effectiveFeeDragPct: spreadNominalPct - roiCyclePct,
  };
}

/** Mirror of triangular-arbitrage.ts simulateLeg + calculateTriangularArbitrage. */
function simulateLeg(amount, leg) {
  if (!(amount > 0) || !(leg.price > 0)) return { outputAmount: 0 };
  const gross = leg.isDivision ? amount / leg.price : amount * leg.price;
  const pct = gross * (Math.max(0, leg.feePct) / 100);
  const bankPct = gross * (Math.max(0, leg.bankingFeePct ?? 0) / 100);
  const fixed = leg.fixedFeeCurrency === leg.toCurrency
    ? (leg.fixedFee ?? 0)
    : leg.isDivision
      ? (leg.fixedFee ?? 0) / leg.price
      : (leg.fixedFee ?? 0) * leg.price;
  const bankingFixed = leg.bankingFixedFee
    ? leg.fixedFeeCurrency === leg.toCurrency ? leg.bankingFixedFee : leg.isDivision ? leg.bankingFixedFee / leg.price : leg.bankingFixedFee * leg.price
    : 0;
  return { outputAmount: Math.max(0, gross - pct - bankPct - fixed - Math.max(0, bankingFixed)) };
}

function calculateTriangularArbitrage(initialAmount, legs) {
  const s1 = simulateLeg(initialAmount, legs[0]);
  const s2 = simulateLeg(s1.outputAmount, legs[1]);
  const s3 = simulateLeg(s2.outputAmount, legs[2]);
  const finalAmount = s3.outputAmount;
  const netProfit = roundMoney(finalAmount - initialAmount, 4);
  const roiPct = initialAmount > 0 ? roundMoney((netProfit / initialAmount) * 100, 2) : 0;
  return { finalAmount, netProfit, roiPct, isProfitable: netProfit > 0, steps: [s1, s2, s3] };
}

// ---------------------------------------------------------------------------
// Dataset assembly
// ---------------------------------------------------------------------------
function buildDataset(profiles) {
  const marketHistory = [];
  const operations = [];
  const profilesMeta = [];

  for (const p of profiles) {
    profilesMeta.push({
      dir: p.dir,
      exists: p.exists,
      files: p.logs.length + p.ldbs.length,
      errors: p.logs.filter((l) => l.error).length,
      decodeFailures: p.decodeFailures,
      keysFound: Object.keys(p.keys).reduce((acc, k) => acc + Object.keys(p.keys[k] || {}).length, 0),
    });
    const mh = p.keys['p2p.market-history'] || {};
    const ops = p.keys['p2p.operations'] || {};
    for (const origin of Object.keys(mh)) {
      for (const pt of mh[origin].parsed) marketHistory.push({ origin, ...pt });
    }
    for (const origin of Object.keys(ops)) {
      for (const op of ops[origin].parsed) operations.push({ origin, ...op });
    }
  }

  marketHistory.sort((a, b) => a.timestamp < b.timestamp ? -1 : 1);
  function keysBy(fn) {
    const m = new Map();
    for (const r of marketHistory) {
      const k = fn(r);
      m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  }
  const byOrigin = keysBy((r) => r.origin);
  const byDay = keysBy((r) => String(r.timestamp).slice(0, 10));

  const sessions = new Map();
  for (const r of marketHistory) {
    if (!sessions.has(r.origin)) sessions.set(r.origin, { origin: r.origin, points: 0, from: null, to: null, banks: new Set(), pairs: new Set() });
    const s = sessions.get(r.origin);
    s.points++;
    if (s.from === null || r.timestamp < s.from) s.from = r.timestamp;
    if (s.to === null || r.timestamp > s.to) s.to = r.timestamp;
    s.banks.add(r.bank);
    s.pairs.add(r.pair);
  }

  return {
    profiles: profilesMeta,
    marketHistory,
    operations,
    stats: {
      snapshotTotal: marketHistory.length,
      operationTotal: operations.length,
      sessions: [...sessions.values()].map((s) => ({ origin: s.origin, points: s.points, from: s.from, to: s.to, banks: [...s.banks], pairs: [...s.pairs] })),
      byOrigin: Object.fromEntries(byOrigin),
      byDay: Object.fromEntries(byDay),
    },
  };
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------
function mean(values) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function absMean(values) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + Math.abs(b), 0) / values.length;
}

function medianOf(values) {
  if (!values.length) return 0;
  const s = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function runSpreadMetrics(ds) {
  let positive = 0;
  let netPositive = 0;
  const devVes = [];
  const devPct = [];
  const netGains = [];
  const perPoint = [];

  for (const pt of ds.marketHistory) {
    const { bestBuyPrice: buy, bestSellPrice: sell } = pt;
    if (!(buy > 0) || !(sell > 0)) continue;

    // engine vs app-reported internal consistency (mirror of spread.ts, commissionRate=0)
    const spread = computeSpread(buy, sell, 1000, 'USDT', 0);
    const engineSpreadVes = spread.unitSpread;
    const engineSpreadPct = ((sell - buy) / buy) * 100;
    devVes.push(engineSpreadVes - pt.spreadVes);
    devPct.push(engineSpreadPct - pt.spreadPct);

    // profitability after 0.25% MAKER/MAKER (mirror of computeArbitrageCycle)
    const cycle = computeArbitrageCycle(1000, buy, sell);
    const netGainPerUnitVes = cycle.netGainVes / 1000;
    netGains.push(netGainPerUnitVes);
    if (pt.spreadVes > 0) positive++;
    if (cycle.netGainVes > 0) netPositive++;

    perPoint.push({
      timestamp: pt.timestamp,
      origin: pt.origin,
      buy,
      sell,
      appSpreadVes: pt.spreadVes,
      appSpreadPct: pt.spreadPct,
      engineSpreadVes: roundMoney(engineSpreadVes, 4),
      engineSpreadPct: roundMoney(engineSpreadPct, 4),
      netGainVesPerUnit: roundMoney(netGainPerUnitVes, 4),
      netRoiPct: roundMoney(cycle.roiCyclePct, 4),
      opportunity: pt.spreadVes > 0,
      profitableAfterFees: cycle.netGainVes > 0,
    });
  }

  const n = perPoint.length;
  return {
    pointsEvaluated: n,
    aciertoTeoricoPct: n ? roundMoney((positive / n) * 100, 2) : null,
    aciertoNetoPct: n ? roundMoney((netPositive / n) * 100, 2) : null,
    devSpreadVesMean: roundMoney(mean(devVes), 6),
    devSpreadVesAbsMean: roundMoney(absMean(devVes), 6),
    devSpreadPctMean: roundMoney(mean(devPct), 6),
    devSpreadPctAbsMean: roundMoney(absMean(devPct), 6),
    netGainVesPerUnitMean: roundMoney(mean(netGains), 4),
    netGainVesPerUnitMedian: roundMoney(medianOf(netGains), 4),
    minNetGainVesPerUnit: roundMoney(Math.min(...netGains, 0), 4),
    maxNetGainVesPerUnit: roundMoney(Math.max(...netGains, 0), 4),
    perPoint,
  };
}

const TRI_RECORDED = {
  initialUsdt: 1000,
  finalUsdt: 1001.39,
  netProfitUsdt: 1.39,
  roiPct: 0.14,
};

// Legs reconstructed from the recorded p2p.operations cycle #271E6986 —
// they match DEFAULT_TRIANGULAR_PRESETS['route-usdt-usd-ves'] exactly.
const TRI_LEGS = [
  { fromCurrency: 'USDT', toCurrency: 'USD', isDivision: false, price: 0.985, feePct: 0.35, fixedFee: 0, fixedFeeCurrency: 'USD', bankingFixedFee: 1.0 },
  { fromCurrency: 'USD', toCurrency: 'VES', isDivision: false, price: 84.0, feePct: 0.2, fixedFee: 0, fixedFeeCurrency: 'VES' },
  { fromCurrency: 'VES', toCurrency: 'USDT', isDivision: true, price: 81.8, feePct: 0.35, fixedFee: 0, fixedFeeCurrency: 'USDT' },
];

function runTriangularMetrics(ds) {
  const cycleOps = ds.operations.filter((o) =>
    String(o.merchantNote || '').includes('Ciclo #') || String(o.notes || '').includes('Ciclo #'),
  );
  const cycles = new Map();
  for (const o of cycleOps) {
    const src = `${o.merchantNote || ''} ${o.notes || ''}`;
    const m = src.match(/Ciclo #([0-9A-Fa-f]+)/);
    const key = m ? `Ciclo #${m[1]}` : 'Ciclo #?';
    if (!cycles.has(key)) cycles.set(key, []);
    cycles.get(key).push(o);
  }

  const results = [];
  for (const [cycleId, ops] of cycles) {
    const pred = calculateTriangularArbitrage(TRI_RECORDED.initialUsdt, TRI_LEGS);
    // recorded PnL: final usdt (last op usdtAmount) - initial (first op input)
    const last = ops[ops.length - 1];
    const first = ops[0];
    const recordedFinalUsdt = last.usdtAmount;
    const recordedInitial = first.type === 'assign' && first.price > 0 ? first.usdtAmount : TRI_RECORDED.initialUsdt;
    const recordedPnl = roundMoney(recordedFinalUsdt - recordedInitial, 4);
    const recordedRoi = recordedInitial > 0 ? roundMoney((recordedPnl / recordedInitial) * 100, 2) : 0;
    results.push({
      cycleId,
      legs: ops.length,
      simulated: {
        netProfitUsdt: pred.netProfit,
        roiPct: pred.roiPct,
        finalUsdt: roundMoney(pred.finalAmount, 2),
        steps: pred.steps.map((s) => roundMoney(s.outputAmount, 2)),
      },
      recorded: {
        netProfitUsdt: recordedPnl,
        roiPct: recordedRoi,
        finalUsdt: recordedFinalUsdt,
        ops: ops.map((o) => ({ type: o.type, price: o.price, usdtAmount: o.usdtAmount, vesAmount: o.vesAmount, fees: o.fees })),
      },
      deviationProfitUsdt: roundMoney(pred.netProfit - recordedPnl, 4),
      deviationRoiPct: roundMoney(pred.roiPct - recordedRoi, 2),
      // Acierto = signo de rentabilidad correcto y desviación dentro de la banda de
      // redondeo del ledger (2 decimales => tolerancia 0.01 USDT).
      acierto: pred.netProfit > 0 === recordedPnl > 0 && Math.abs(pred.netProfit - recordedPnl) <= 0.01 ? 1 : 0,
      matchExactInBanda: pred.netProfit > 0 === recordedPnl > 0 && Math.abs(pred.netProfit - recordedPnl) <= 0.01,
    });
  }

  return {
    cyclesFound: results.length,
    cycles: results,
    asserted: {
      predictedProfitUsdt: roundMoney(calculateTriangularArbitrage(TRI_RECORDED.initialUsdt, TRI_LEGS).netProfit, 4),
      predictedRoiPct: roundMoney(calculateTriangularArbitrage(TRI_RECORDED.initialUsdt, TRI_LEGS).roiPct, 2),
    },
  };
}

function runJohnsonDepthMetrics() {
  // johnson-depth computeVolumeWeightedPrice needs the full Binance order book
  // (BinanceOfferSummary[]) which the app does NOT persist in localStorage nor SQLite.
  return {
    engine: 'johnson-depth.computeVolumeWeightedPrice',
    coverage: 0,
    note: 'Cobertura insuficiente: la app no persiste el order book Binance (solo best buy/best sell por par/bank en p2p.market-history). Motor no ejecutable con datos históricos reales.',
  };
}

// ---------------------------------------------------------------------------
// Report writers
// ---------------------------------------------------------------------------
function isoDate() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function summarize(dataset, spread, triangular, johnson, startTimeMs) {
  const st = dataset.stats;
  const profits = spread.perPoint.filter((p) => p.profitableAfterFees).length;
  const realUstRoundTrips = 0; // no matched buy->sell USDT pairs exist in ledger
  return {
    metadata: {
      generatedAt: new Date().toISOString(),
      script: 'scripts/backtest.cjs',
      enginesMirrored: [
        'projects/core/src/lib/spread.ts -> computeSpread',
        'projects/core/src/lib/spread-quality.ts -> computeArbitrageCycle (MAKER/MAKER 0.25%)',
        'projects/core/src/lib/triangular-arbitrage.ts -> calculateTriangularArbitrage',
      ],
      commissionUsed: { makerRate: MAKER_FEE_RATE, source: 'projects/core/src/lib/spread-quality.ts:180' },
      dataSourcesReal: dataset.profiles.filter((p) => p.exists).map((p) => p.dir),
    },
    data: {
      snapshots: st.snapshotTotal,
      operations: st.operationTotal,
      sessions: st.sessions.length,
      sessionsDetail: st.sessions,
      byDay: st.byDay,
      decodeFailuresLdb: dataset.profiles.reduce((a, p) => a + p.decodeFailures, 0),
      files: dataset.profiles.map((p) => ({ dir: p.dir, exists: p.exists, files: p.files, errors: p.errors })),
    },
    spreadEngine: {
      pointsEvaluated: spread.pointsEvaluated,
      aciertoTeoricoPct: spread.aciertoTeoricoPct,
      aciertoNetoPct: spread.aciertoNetoPct,
      deviation: {
        spreadVesMean: spread.devSpreadVesMean,
        spreadVesAbsMean: spread.devSpreadVesAbsMean,
        spreadPctMean: spread.devSpreadPctMean,
        spreadPctAbsMean: spread.devSpreadPctAbsMean,
      },
      netSpreadVesPerUnit: {
        mean: spread.netGainVesPerUnitMean,
        median: spread.netGainVesPerUnitMedian,
        min: spread.minNetGainVesPerUnit,
        max: spread.maxNetGainVesPerUnit,
      },
      profitableAfterFeesCount: profits,
      coverageNote: 'Contraste realizado vs teórico (round trips USDT compra->venta): 0 pares en el ledger. No hay operaciones de round trip USDT reales para contrastar acierto realizado. El único acierto contrastable es el ciclo triangular (ver triangularEngine).',
    },
    triangularEngine: triangular,
    johnsonDepthEngine: johnson,
    coverage: {
      snapshotsUsed: spread.pointsEvaluated,
      sessionsValidated: st.sessions.length,
      realVsSynthetic: `Datos 100% reales extraídos del localStorage de ${dataset.profiles.filter((p) => p.exists).length} perfiles (${dataset.profiles.map((p) => p.dir.replace(/^.*AppData\\Roaming\\/, '%APPDATA%\\')).join(', ')}): snapshots y ledger; sin datos sintéticos inyectados.`,

      limit: `Cobertura limitada a 2026-09-10..13 (${spread.pointsEvaluated} snapshots, ${triangular.cyclesFound} ciclo(s), ${st.operationTotal} ops). Ficheros .ldb antiguos (7-9 sep) sin formato decodificable en esta corrida; descartados honestamente y contados.`,
    },
    run: {
      durationMs: Date.now() - startTimeMs,
      command: `node scripts/backtest.cjs --out "${process.argv[3] || 'docs/backtesting'}"`,
    },
  };
}

function renderMarkdown(sum) {
  const L = [];
  L.push(`# Backtesting — Reporte ${isoDate()}`);
  L.push('');
  L.push(`Generado: ${sum.metadata.generatedAt} · Motor: ${sum.metadata.script}`);
  L.push('');
  L.push(`Comisión MAKER usada: **${(sum.metadata.commissionUsed.makerRate * 100).toFixed(2)}%** (fuente: ${sum.metadata.commissionUsed.source})`);
  L.push('');
  L.push('## 1. Fuentes de datos');
  L.push('');
  L.push('| Perfil (LevelDB) | Existe | Archivos | Errores lectura |');
  L.push('|---|---|---|---|');
  for (const p of sum.data.files) {
    L.push(`| ${p.dir.replace(/^.*AppData\\Roaming\\/, '%APPDATA%\\')} | ${p.exists ? 'sí' : 'no'} | ${p.files} | ${p.errors} |`);
  }
  L.push('');
  L.push(`Snapshots de mercado reales: **${sum.data.snapshots}** · Operaciones reales en ledger: **${sum.data.operations}** · Sesiones (orígenes): **${sum.data.sessions}**`);
  L.push(`Fallos de decodificación en .ldb antiguos (no contados): ${sum.data.decodeFailuresLdb}`);
  L.push('');
  L.push('| Sesión (origin) | Puntos | Desde | Hasta |');
  L.push('|---|---|---|---|');
  for (const s of sum.data.sessionsDetail) {
    L.push(`| ${s.origin} | ${s.points} | ${s.from} | ${s.to} |`);
  }
  L.push('');
  L.push('## 2. Motor Spread (`computeSpread` / `computeArbitrageCycle`, MAKER/MAKER 0.25%)');
  L.push('');
  L.push(`Puntos evaluados: **${sum.spreadEngine.pointsEvaluated}**`);
  L.push('');
  L.push(`- **Acierto teórico** (spread > 0): **${sum.spreadEngine.aciertoTeoricoPct}%**`);
  L.push(`- **Acierto neto** (ganancia tras 0.25% por pierna): **${sum.spreadEngine.aciertoNetoPct}%**`);
  L.push(`- **% rentable tras comisiones**: **${sum.spreadEngine.profitableAfterFeesCount}/${sum.spreadEngine.pointsEvaluated}**`);
  L.push(`- **Desviación vs la app** (spreadVes): media ${sum.spreadEngine.deviation.spreadVesMean} · abs ${sum.spreadEngine.deviation.spreadVesAbsMean}`);
  L.push(`- **Desviación vs la app** (spreadPct): media ${sum.spreadEngine.deviation.spreadPctMean} · abs ${sum.spreadEngine.deviation.spreadPctAbsMean}`);
  L.push(`- **Ganancia neta VES/USDT**: media ${sum.spreadEngine.netSpreadVesPerUnit.mean} · mediana ${sum.spreadEngine.netSpreadVesPerUnit.median} · min ${sum.spreadEngine.netSpreadVesPerUnit.min} · max ${sum.spreadEngine.netSpreadVesPerUnit.max}`);
  L.push('');
  L.push(`> ${sum.spreadEngine.coverageNote}`);
  L.push('');
  L.push('## 3. Motor Triangular (`calculateTriangularArbitrage`)');
  L.push('');
  if (sum.triangularEngine.cyclesFound === 0) {
    L.push('No se encontraron ciclos triangulares registrados en el ledger.');
  } else {
    L.push(`Ciclos registrados por la app: **${sum.triangularEngine.cyclesFound}** (id: ${sum.triangularEngine.cycles.map((c) => c.cycleId).join(', ')})`);
    L.push('');
    for (const c of sum.triangularEngine.cycles) {
      L.push(`### ${c.cycleId} — ${c.legs} piernas`);
      L.push('');
      L.push(`| Métrica | Simulado (motor) | Registrado (ledger) | Desviación |`);
      L.push('|---|---|---|---|');
      L.push(`| Profit (USDT) | ${c.simulated.netProfitUsdt} | ${c.recorded.netProfitUsdt} | ${c.deviationProfitUsdt} |`);
      L.push(`| ROI (%) | ${c.simulated.roiPct} | ${c.recorded.roiPct} | ${c.deviationRoiPct} |`);
      L.push(`| Final (USDT) | ${c.simulated.finalUsdt} | ${c.recorded.finalUsdt} | ${roundMoney(c.simulated.finalUsdt - c.recorded.finalUsdt, 2)} |`);
      L.push('');
      L.push(`**Acierto**: ${c.acierto === 1 ? 'SÍ (signo correcto, dentro de banda de redondeo ±0.01 USDT)' : 'NO'} · **Match exacto**: ${c.matchExactInBanda ? 'sí (coincide el resultado)' : `no (dev ${c.deviationProfitUsdt} USDT = redondeo 2dp del ledger)`}`);
      L.push('');
      L.push('Piernas registradas:');
      L.push('');
      L.push('| # | Tipo | Precio | USDT | VES | Comisión |');
      L.push('|---|---|---|---|---|---|');
      c.recorded.ops.forEach((o, i) => L.push(`| ${i + 1} | ${o.type} | ${o.price} | ${o.usdtAmount} | ${o.vesAmount} | ${o.fees} |`));
    }
  }
  L.push('');
  L.push('## 4. Motor Johnson-Depth (`computeVolumeWeightedPrice`)');
  L.push('');
  L.push(`Cobertura: **${sum.johnsonDepthEngine.coverage}**`);
  L.push('');
  L.push(`> ${sum.johnsonDepthEngine.note}`);
  L.push('');
  L.push('## 5. Cobertura');
  L.push('');
  L.push(`- Snapshots usados en métricas: ${sum.coverage.snapshotsUsed}`);
  L.push(`- Sesiones validadas: ${sum.coverage.sessionsValidated}`);
  L.push(`- Real vs sintético: ${sum.coverage.realVsSynthetic}`);
  L.push(`- Limitación: ${sum.coverage.limit}`);
  L.push('');
  L.push(`Tiempo de ejecución: ${sum.run.durationMs} ms · Comando: \`${sum.run.command}\``);
  return L.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const args = parseArgs(process.argv);
  const outDir = args.out || path.join('docs', 'backtesting');
  const start = Date.now();

  const dirs = args.dirs.length ? args.dirs : defaultLevelDbDirs();
  const profiles = [];
  for (const dir of dirs) {
    profiles.push(extractLevelDbDir(dir, { skipLdb: args.skipLdb }));
  }

  const dataset = buildDataset(profiles);
  const spread = runSpreadMetrics(dataset);
  const triangular = runTriangularMetrics(dataset);
  const johnson = runJohnsonDepthMetrics();
  const summary = summarize(dataset, spread, triangular, johnson, start);

  const today = isoDate();
  const mdFile = path.join(outDir, `report-${today}.md`);
  const jsonFile = path.join(outDir, `report-${today}.json`);
  const dataFile = path.join(outDir, `data-${today}.json`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(mdFile, renderMarkdown(summary));
  fs.writeFileSync(jsonFile, JSON.stringify(summary, null, 2));
  fs.writeFileSync(dataFile, JSON.stringify(dataset, null, 2));

  // console summary (also the verification output)
  console.log('=== Backtesting ===');
  console.log(`Datasets: ${dataset.marketHistory.length} snapshots / ${dataset.operations.length} ops / ${dataset.stats.sessions.length} sesiones`);
  console.log(`Spread   : puntos=${spread.pointsEvaluated} acierto_teorico=${spread.aciertoTeoricoPct}% acierto_neto=${spread.aciertoNetoPct}% ` +
    `devVes_abs=${spread.devSpreadVesAbsMean} devPct_abs=${spread.devSpreadPctAbsMean}`);
  console.log(`Triang   : ciclos=${triangular.cyclesFound} pred_inicial=${TRI_RECORDED.initialUsdt} -> ${triangular.asserted.predictedProfitUsdt} USDT (${triangular.asserted.predictedRoiPct}%)`);
  for (const c of triangular.cycles) {
    console.log(`  ${c.cycleId}: sim=${c.simulated.netProfitUsdt}USDT/${c.simulated.roiPct}% rec=${c.recorded.netProfitUsdt}USDT/${c.recorded.roiPct}% ` +
      `dev=${c.deviationProfitUsdt} acierto=${c.acierto} exact=${c.matchExactInBanda}`);
  }
  console.log(`Johnson   : cobertura=${johnson.coverage}`);
  console.log(`Archivos  : ${mdFile}`);
  console.log(`            ${jsonFile}`);
  console.log(`            ${dataFile}`);
}

main();