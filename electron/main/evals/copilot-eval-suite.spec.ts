/**
 * Production Eval Harness (`npm run eval:copilot`) — 15 Frozen Institutional Scenarios.
 *
 * Validates safety invariants, zero hallucination under missing feeds, unilateral RiskGatekeeper
 * veto in `/evaluar`, dynamic domain tool routing, Gemini 3.x/4.x `thoughtSignature` preservation,
 * transient 503 graceful fallback, multimodal image attachment forwarding, streaming delta events,
 * and SQLite Decision Journal Win Rate telemetry.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { P2PDatabaseService } from '../db/database';
import { GeminiOrchestrator, resolveDomainToolAllowlist } from '../gemini-orchestrator';
import { resetKillswitch, triggerKillswitch } from '../ipc/killswitch-state';
import { setTreasurySnapshot, clearTreasurySnapshot } from '../ipc/treasury-snapshot';
import {
  clearFinancialSkillMarketData,
  seedFinancialSkillMarketData,
  clearBcvRate,
  seedBcvRate,
} from '../skills/market-state';
import type { CopilotStreamEvent } from '../../shared/types';

describe('Copilot Production Eval Suite (15 Frozen Institutional Scenarios)', () => {
  let dbPath: string;
  let db: P2PDatabaseService;
  let orchestrator: GeminiOrchestrator;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `p2p-eval-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
    db = new P2PDatabaseService(dbPath);
    orchestrator = new GeminiOrchestrator(db);
    resetKillswitch();
    clearTreasurySnapshot();
    clearFinancialSkillMarketData();
    clearBcvRate();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetKillswitch();
    clearTreasurySnapshot();
    clearFinancialSkillMarketData();
    clearBcvRate();
    db.close();
    try {
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    } catch {
      // Ignore Windows temp file lock
    }
  });

  it('Eval 01: Killswitch active blocks sendMessage with 0 network calls', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    triggerKillswitch('USDT depeg critical', 'EVAL');
    const orch = new GeminiOrchestrator(db, 'AIzaFakeKeyEval01');
    await expect(orch.sendMessage({ prompt: 'Evalúa spread ahora' })).rejects.toThrow(
      /KILLSWITCH_ACTIVE/,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('Eval 02: Killswitch active blocks executePlan with 0 dispatch', async () => {
    db.saveStrategyPlan({
      id: 'EVAL-PLAN-02',
      title: 'Plan live',
      route: 'BUY -> SELL',
      capitalRequiredUsdt: 1000,
      expectedNetSpreadPct: 0.85,
      expectedProfitUsdt: 8.5,
      riskLevel: 'LOW',
      rationale: 'Live book',
      status: 'PROPOSED',
      esSimulado: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    triggerKillswitch('Emergency', 'EVAL');
    const res = await orchestrator.executePlan('EVAL-PLAN-02');
    expect(res.success).toBe(false);
    expect(res.error?.toLowerCase()).toContain('kill-switch');
  });

  it('Eval 03: Simulated plan (esSimulado: true) is strictly refused by executePlan', async () => {
    db.saveStrategyPlan({
      id: 'EVAL-PLAN-03',
      title: 'Plan simulado',
      route: 'BUY -> SELL',
      capitalRequiredUsdt: 1000,
      expectedNetSpreadPct: 0.9,
      expectedProfitUsdt: 9,
      riskLevel: 'HIGH',
      rationale: 'Sin feed',
      status: 'PROPOSED',
      esSimulado: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const res = await orchestrator.executePlan('EVAL-PLAN-03');
    expect(res.success).toBe(false);
    expect(res.error?.toLowerCase()).toContain('referencia');
  });

  it('Eval 04: /evaluar consensus VETOS when live Binance P2P feed is absent (Zero-Seed fail-closed)', async () => {
    const res = await orchestrator.sendMessage({ prompt: '/evaluar 1000 USDT Banesco' });
    expect(res.reply).toContain('VETADO');
    expect(res.suggestedPlan).toBeUndefined();
  });

  it('Eval 05: /evaluar consensus VETOS when live spread is below 0.50% Golden Rule', async () => {
    seedFinancialSkillMarketData({
      buyOffers: [{ advNo: 'B1', price: 94.5, tradableQuantity: 5000, minSingleTransAmount: 50, maxSingleTransAmount: 5000, nickName: 'M1', monthOrderCount: 200, monthFinishRate: 0.99, payMethods: ['Banesco'] }],
      sellOffers: [{ advNo: 'S1', price: 94.7, tradableQuantity: 5000, minSingleTransAmount: 50, maxSingleTransAmount: 5000, nickName: 'M2', monthOrderCount: 200, monthFinishRate: 0.99, payMethods: ['Banesco'] }],
    });
    const res = await orchestrator.sendMessage({ prompt: '/evaluar 1000 USDT Banesco' });
    expect(res.reply).toContain('VETADO');
    expect(res.reply).toContain('0.50%');
    expect(res.suggestedPlan).toBeUndefined();
  });

  it('Eval 06: /evaluar consensus VETOS when SUDEBAN treasury is over-limit or saturated', async () => {
    seedFinancialSkillMarketData({
      buyOffers: [{ advNo: 'B1', price: 94.0, tradableQuantity: 5000, minSingleTransAmount: 50, maxSingleTransAmount: 5000, nickName: 'M1', monthOrderCount: 200, monthFinishRate: 0.99, payMethods: ['Banesco'] }],
      sellOffers: [{ advNo: 'S1', price: 95.5, tradableQuantity: 5000, minSingleTransAmount: 50, maxSingleTransAmount: 5000, nickName: 'M2', monthOrderCount: 200, monthFinishRate: 0.99, payMethods: ['Banesco'] }],
    });
    setTreasurySnapshot({
      totalBalanceVes: 500_000,
      totalDailyLimitVes: 1_000_000,
      totalSpentTodayVes: 1_050_000,
      overLimitCount: 1,
      nearLimitCount: 0,
      disabledCount: 0,
      saturatedCount: 0,
      activeAccountsCount: 1,
      timestamp: Date.now(),
    });
    const res = await orchestrator.sendMessage({ prompt: '/evaluar 1000 USDT Banesco' });
    expect(res.reply).toContain('VETADO');
    expect(res.reply).toContain('Tesorería VES crítica');
    expect(res.suggestedPlan).toBeUndefined();
  });

  it('Eval 07: /evaluar consensus APPROVES and persists live HITL plan when spread >= 0.50% and treasury is clean', async () => {
    seedFinancialSkillMarketData({
      buyOffers: [{ advNo: 'B1', price: 94.0, tradableQuantity: 5000, minSingleTransAmount: 50, maxSingleTransAmount: 5000, nickName: 'M1', monthOrderCount: 200, monthFinishRate: 0.99, payMethods: ['Banesco'] }],
      sellOffers: [{ advNo: 'S1', price: 95.4, tradableQuantity: 5000, minSingleTransAmount: 50, maxSingleTransAmount: 5000, nickName: 'M2', monthOrderCount: 200, monthFinishRate: 0.99, payMethods: ['Banesco'] }],
    });
    seedBcvRate({ usd: 78.5, source: 'cotizave' });
    setTreasurySnapshot({
      totalBalanceVes: 1_500_000,
      totalDailyLimitVes: 2_000_000,
      totalSpentTodayVes: 400_000,
      overLimitCount: 0,
      nearLimitCount: 0,
      disabledCount: 0,
      saturatedCount: 0,
      activeAccountsCount: 2,
      timestamp: Date.now(),
    });
    const res = await orchestrator.sendMessage({ prompt: '/evaluar 1500 USDT Banesco' });
    expect(res.reply).toContain('APROBADO PARA HITL');
    expect(res.suggestedPlan).toBeDefined();
    expect(res.suggestedPlan?.esSimulado).toBe(false);
    expect(res.suggestedPlan?.capitalRequiredUsdt).toBe(1500);
  });

  it('Eval 08: Dynamic Tool Router trims unrelated ARM CRM tools on pure P2P spread prompts', () => {
    const allowlist = resolveDomainToolAllowlist('Calcula spread neto USDT/VES en Binance P2P', {
      orderbook: true,
      treasury: true,
      orders: true,
      finance360: false,
    });
    expect(allowlist?.has('calculate_spread')).toBe(true);
    expect(allowlist?.has('audit_ad_competitiveness')).toBe(true);
    expect(allowlist?.has('route_conversation')).toBe(false);
    expect(allowlist?.has('f360_analyze_cashea_capacity')).toBe(false);
  });

  it('Eval 09: Dynamic Tool Router auto-enables OCR & blacklist tools when image attachment is present', () => {
    const allowlist = resolveDomainToolAllowlist('Revisa esto por favor', undefined, undefined, true);
    expect(allowlist?.has('audit_payment_proof_ocr')).toBe(true);
    expect(allowlist?.has('verify_inbound_transfer')).toBe(true);
    expect(allowlist?.has('check_counterparty_blacklist')).toBe(true);
  });

  it('Eval 10: Dynamic Tool Router enables Finance 360 & Cashea tools on treasury/Cashea prompts', () => {
    const allowlist = resolveDomainToolAllowlist('Audita mis cuotas Cashea y el runway 14D en Finanzas 360');
    expect(allowlist?.has('f360_get_treasury_summary')).toBe(true);
    expect(allowlist?.has('f360_analyze_cashea_capacity')).toBe(true);
    expect(allowlist?.has('f360_audit_overdue_and_runway')).toBe(true);
  });

  it('Eval 11: Dynamic Tool Router respects explicit agent skill allowlist override', () => {
    const explicit = new Set(['get_bcv_rates']);
    const allowlist = resolveDomainToolAllowlist('Quiero revisar Cashea y fraude OCR', undefined, explicit, true);
    expect(Array.from(allowlist ?? [])).toEqual(['get_bcv_rates']);
  });

  it('Eval 12: Preserves Gemini 3.x/4.x thoughtSignature verbatim across ReAct Pass 1 -> Pass 2', async () => {
    const capturedBodies: Array<Record<string, unknown>> = [];
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      capturedBodies.push(JSON.parse(String(init?.body ?? '{}')));
      if (capturedBodies.length === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [
                    { text: 'internal reasoning', thought: true },
                    {
                      functionCall: { name: 'evaluate_golden_spread', args: { buyPrice: 94, sellPrice: 95.5 } },
                      thoughtSignature: 'SIG_GEMINI_38_PRESERVED_XYZ',
                    },
                  ],
                },
              },
            ],
          }),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  { text: 'hidden thought', thought: true },
                  { text: 'Veredicto final limpio con firma preservada.' },
                ],
              },
            },
          ],
        }),
      } as unknown as Response;
    });

    const orch = new GeminiOrchestrator(db, 'AIzaFakeKeyEval12');
    const res = await orch.sendMessage({ prompt: 'Audita spread 94 vs 95.5' });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(res.reply).toBe('Veredicto final limpio con firma preservada.');

    const pass2Contents = (capturedBodies[1]['contents'] as Array<{ role: string; parts: Array<Record<string, unknown>> }>) ?? [];
    const modelTurn = pass2Contents.find((c) => c.role === 'model');
    const fcPart = modelTurn?.parts.find((p) => Boolean(p['functionCall']));
    expect(fcPart?.['thoughtSignature']).toBe('SIG_GEMINI_38_PRESERVED_XYZ');
  });

  it('Eval 13: Transient HTTP 503 UNAVAILABLE falls back cleanly to local strategist without blaming API key', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => JSON.stringify({ error: { code: 503, status: 'UNAVAILABLE', message: 'high demand' } }),
    } as unknown as Response);

    const orch = new GeminiOrchestrator(db, 'AIzaFakeKeyEval13');
    const res = await orch.sendMessage({ prompt: 'Resumen rápido de mercado' });
    expect(res.reply).toContain('HTTP 503');
    expect(res.reply).not.toContain('verifica tu API Key');
  }, 20000);

  it('Eval 14: Multimodal image attachment is forwarded as inlineData in Gemini contents', async () => {
    let sentBody: Record<string, unknown> = {};
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      sentBody = JSON.parse(String(init?.body ?? '{}'));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: 'Comprobante Banesco verificado.' }] } }],
        }),
      } as unknown as Response;
    });

    const orch = new GeminiOrchestrator(db, 'AIzaFakeKeyEval14');
    const res = await orch.sendMessage({
      prompt: 'Verifica este comprobante Pago Móvil',
      attachments: [{ mimeType: 'image/png', base64: 'iVBORw0KGgo=', name: 'pago.png' }],
    });
    expect(res.reply).toContain('Comprobante Banesco verificado');
    const contents = sentBody['contents'] as Array<{ role: string; parts: Array<Record<string, unknown>> }>;
    const userParts = contents[contents.length - 1]?.parts ?? [];
    const imgPart = userParts.find((p) => Boolean(p['inlineData']));
    expect(imgPart?.['inlineData']).toEqual({ mimeType: 'image/png', data: 'iVBORw0KGgo=' });
  });

  it('Eval 15: Emits streaming phase=delta events and returns honest Zero-Seed Decision Journal Win Rate', async () => {
    const events: CopilotStreamEvent[] = [];
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'Respuesta en streaming progresivo para el operador P2P.' }] } }],
      }),
    } as unknown as Response);

    const orch = new GeminiOrchestrator(db, 'AIzaFakeKeyEval15');
    orch.setStreamEmitter((ev) => events.push(ev));
    await orch.sendMessage({ prompt: 'Dame estado del libro' });

    const deltaEvents = events.filter((e) => e.phase === 'delta');
    expect(deltaEvents.length).toBeGreaterThan(0);
    expect(deltaEvents.map((e) => e.delta).join('')).toContain('Respuesta en streaming');

    const usage = db.getCopilotUsageSummary(24);
    expect(usage.winRate).toBeDefined();
    expect(usage.winRate?.totalDecisions).toBe(0);
    expect(usage.winRate?.winRatePct).toBeNull();
  });
});
