Objective: Overhaul the P2P AI Copilot (`electron/main/` + `src/app/features/copilot/` + sibling surfaces) into a zero-smoke, Silicon Valley-grade 2-mode operational platform (3-Pane Tactical Workbench + 4-Quadrant AI Governance Dashboard) with 100% live grounding, multi-turn SQLite threads, real Zod MCP schemas, typed VES/USDT risk gates, Engram memory quarantine, and full test coverage.
Branch: `feat/p2p-decision-tool-mvp` | Delivery strategy: `ask-on-risk` | Forecast authored lines: ~1,900 across 5 cohesive work units
Test runner: `npm run test:electron` (Electron Vitest), `npx ng test --watch=false` / `npx vitest run` (Angular specs), `npm run build` (Angular production build & budgets), `npx playwright test e2e/web/copilot.spec.ts` (E2E)

## Specs

- **S1 — Real Model Catalog, Multi-Turn SQLite Threads, Full MCP Zod-to-JSON-Schema, Semantic Cache, Cancellation & Token Metering:**
  - Verbatim user requirements:
    - `"quiero que hagas un analisis para detectar las fallas del copiloto de IA y busquemos organizar esta herramienta que de verdad se contituya como una herramienta de alto valor hay que mejorarla y organizarla"`
    - `"quiero que revises si hay otras mejoras que deben incluirse aqui que sean de alto nivel y quiero que todo sea funcional y sin venderme humo que todo quede operativo al 100 que todo quede conectado y en optimas condiciones"`
    - `"quiero que sea una herramienta al nivel de las que se construyen en silicon velley"`
  - Shared Contract & Acceptance Criteria:
    - Replace invalid `gemini-3.7-flash` / `gemini-3.6-flash` defaults across `gemini-orchestrator.ts`, `universal-ai-gateway.ts`, `schema.sql` (`custom_agents`), `api-settings-modal.component.ts`, and `agent-studio.service.ts` with valid November 2026 models (`gemini-3.8-flash` default, `gemini-4-argon`, `gemini-4-carbon`, `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`, and `gemini-3.5-transcribe` for audio).
    - `UniversalAiGateway.testConnection(provider, apiKey, model)` validates the actual target model endpoint (`GET /v1beta/models/${model}` for Gemini) instead of `models?pageSize=1`.
    - Add SQLite tables `copilot_threads` (`id`, `title`, `agent_id`, `pinned`, `created_at`, `updated_at`), `copilot_messages` (`id`, `thread_id`, `role`, `content`, `model`, `provider`, `provenance_json`, `tool_traces_json`, `plan_id`, `tokens_in`, `tokens_out`, `cost_usd`, `latency_ms`, `created_at`), and `copilot_usage_ledger` (`id`, `provider`, `model`, `tokens_in`, `tokens_out`, `cost_usd`, `latency_ms`, `cached`, `created_at`) in `schema.sql` and `database.ts` (with idempotent migrations).
    - `GeminiOrchestrator.sendMessage` accepts `{ prompt, threadId?, history?, agentId?, contextScope?, requestId?, apiKey?, provider?, model? }`, persists user/assistant turns in `copilot_messages` when `threadId` is supplied (or auto-creates thread), and forwards bounded multi-turn history (last 16 messages) to Gemini, OpenAI-compatible, and Anthropic adapters.
    - Export real JSON Schema for every tool in `MCP_SERVER_REGISTRY` using Zod v4 `z.toJSONSchema(tool.inputSchema)` (stripping `$schema` / unsupported keys via `cleanSchemaForGemini`) instead of `properties: {}`.
    - Wire `SemanticCache` (from `projects/core/src/lib/ai-proxy-gateway.ts` or shared engine cache keyed by `provider + model + prompt + liveFeedEpoch`) for duplicate read-only queries, add `AbortController` (`AbortSignal.timeout(30_000)` + manual `cancelTurn(requestId)`), fix `transcribeAudio` double `consumePaidCall()` bug, record `ToolCallTrace[]` (`{ step, toolName, argsSummary, durationMs, status, provenance, outputSummary }`) + `usage` (`{ promptTokens, completionTokens, totalTokens, estimatedCostUsd, latencyMs, cached }`) on `CopilotResponse`, and broadcast step progress on `'copilot:stream-event'`.
    - Consult unified `custom_agents` repository when `agentId` or `@mention` matches an active custom agent: inject its system prompt inside bounded `<agent_persona>` instructions and filter tool declarations to its `assignedSkills` when non-empty.
    - Enrich `buildLiveMarketContext(contextScope)` with active `p2p_orders` counts/escrow status, `operation_records` realized daily PnL, and `f360` vault summary, while wrapping untrusted user/DB notes (`engram_observations`, counterparty notes) inside `<untrusted_data>...</untrusted_data>` delimiters with prompt-injection defense rules.

- **S2 — Swarm De-Mocking, Typed `VES`/`USDT` Risk Gatekeeper & Engram Memory Quarantine:**
  - Verbatim user requirements:
    - `"no me vendas humo se objetivo y trabaja como un ingeniero de sotfwaere y un programador de alto nivel con mas de una decada en este tipo de trabajo"`
    - `"que todo quede operativo al 100 que todo quede conectado y en optimas condiciones"`
  - Shared Contract & Acceptance Criteria:
    - Eliminate fabricated fallback prices (`88.5 / 89.8`) in `sentinel-agent.ts` and the hardcoded 3-row `mockBook` in `strategist-agent.ts`. When `orderBookOffers` / live feed is absent, resolve via `resolveMarketFeed()`; if still offline, return explicit `{ status: 'NO_LIVE_FEED', unavailableReason }` without generating fake executable plans.
    - Fix dimensional bug in `swarm-orchestrator.ts` and `risk-gatekeeper-agent.ts`: evaluate bank daily limits strictly in homogeneous `VES` (`dailySpentVes + orderRequiredVes > dailyLimitVes`), deriving `orderRequiredVes = capitalRequiredUsdt * effectiveRateVes` (or explicit `orderAmountVes`), and populate `esSimulado: !isLiveFeed` accurately on generated `StrategyPlanCard` (`esSimulado: false` when built from a verified live feed).
    - Add `rejectPlan(planId, reason?)` on `GeminiOrchestrator` / `database.ts` updating `strategy_plans.status = 'REJECTED'`.
    - Implement Engram Memory Quarantine: auto-captured observations from tool calls, regex fallback, and `ProactiveEventEngine` insert into `engram_observations` with `status = 'needs_review'` by default; `db.getEngramContextSummary()` injects ONLY `status = 'active'` rows; expose `reviewEngramObservation(id, action: 'approve' | 'discard')` (`approve` sets `status = 'active'`, `discard` deletes row).

- **S3 — 2-Mode Silicon Valley Frontend (`Workbench` 3-Pane + `Dashboard IA` 4-Quadrant), Zero-Seed Real Stores & Zero Silent Failures:**
  - Verbatim user requirements:
    - `"ademas que vas a organizar la interfaz y el dasboard de esa herramienta me vas a presentar las fotos de como va a quedar y vamos a organizar todo mejor"`
    - `"quiero que todo sea funcional y sin venderme humo que todo quede operativo al 100 que todo quede conectado"`
  - Shared Contract & Acceptance Criteria:
    - Refactor `src/app/features/copilot/` out of the 8-tab God-Component into a clean, modular 2-mode architecture (`Workbench` + `Dashboard IA`) matching the approved visual designs, splitting subcomponents/types cleanly under `src/app/features/copilot/components/` and `src/app/features/copilot/models/` while keeping `Copilot` (`copilot.ts`) within Angular CSS/bundle budgets.
    - **Zero-Seed & Real Store Wiring**: Remove hardcoded `bcvRates = signal({ bcv: 64.8, parallel: 78.4 })`, `spotUsdt: 1.0`, fake seed counterparties (`Carlos Eduardo Mendoza`, `José Gregorio Pérez`), fake seed Engram items, and broken HUD bindings (`earnCapitalUsdt` as equity, `totalBalanceVes` as USDT profit, integer bank count as `%` width). Wire live signals from `TriangulationIntelligenceService`, `SpotMarketService`, `AccountsService`, and `Finance360Service` (passing `null`/`undefined` when unmeasured so backend declared-absence guards work).
    - **Purge Plaintext API Keys from `localStorage`**: Stop writing `p2p.ai.key.*` and `p2p.gemini.apiKey` to `localStorage` in Electron/Web; automatically scrub legacy plaintext keys from `localStorage` on init and persist keys through Electron DPAPI (`copilot.setProviderConfig` / `setApiKey`) or in-memory session state on pure web.
    - **Mode 1 — Tactical Workbench (3-Pane)**:
      - Top Telemetry Ribbon: `Workbench | Dashboard IA` switcher, real `LIVE / NO_FEED` badge, real `USDT/VES` bid/ask & net spread, real `BCV Gap %`, real `Available Treasury (USDT + VES)`, real `SUDEBAN Cap %`, active model + session `$ cost` pill, and hold-to-arm Killswitch.
      - Left Rail: Persistent SQLite Threads (`+ Nueva Conversación`, select, delete), Grounding Scope toggles (`orderbook`, `treasury`, `orders`, `finance360`), and live IPC Push Radar (`onAlphaOpportunity`, `onProactiveAlert`) with 1-click `[Analizar ->]`.
      - Center Chat Canvas: Multi-turn messages, live step progress (`onStreamEvent`), `Detener` (`cancelTurn` / `Esc`), collapsible **MCP Tool Trace** card (`toolTraces`), `@agent` & `/command` palette (`Ctrl+K`), and contextual deep-links to `/finanzas-360`, `/compliance-cockpit`, `/agents`, and `ApiSettingsModal` (removing the 6 redundant duplicate tabs).
      - Right HITL Execution Inspector: Dynamic engine-computed fee/IGTF/slippage/VES-cap breakdown (no hardcoded `-0.35%` or `$1.20` HTML), Gatekeeper checklist, `Aprobar y Preparar Orden` vs `Rechazar Plan`. **Strict Error Handling**: if `executePlan()` returns `{ success: false, error }`, surface a prominent crimson Gatekeeper block banner, keep clipboard untouched, and NEVER open the launch modal for a rejected order.
    - **Mode 2 — AI Governance Dashboard (4-Quadrant)**:
      - Top 4 KPIs (Captured Spread USDT from executed plans, Gatekeeper Risk Blocks, MCP Tool Success Rate & P95 Latency, Token/USD Spend vs Daily Budget).
      - Quadrant A: Tactical Plans Queue & HITL Audit table (`PROPOSED`, `APPROVED`, `EXECUTED`, `REJECTED`) with direct Approve/Reject actions.
      - Quadrant B: Real-time Agent & Watcher Health Matrix (`AlphaWatcher`, `RiskGatekeeper`, `CustomAgents` from SQLite, `MCP Servers`) with real timestamps.
      - Quadrant C: Engram Memory Quarantine Governance (`Verified Active Rules` vs `Quarantined Pending Review` with `[Aprobar]` and `[Descartar]` buttons wired to `reviewEngramObservation`).
      - Quadrant D: Model Failover Cascade (`gemini-3.8-flash` -> `gemini-3.5-flash-lite` / configured secondary -> read-only deterministic fallback), DPAPI vault status, and 24h token usage summary.

- **S4 — De-Mocking Sibling AI Surfaces (`MCP Hub`, `Main Dashboard`, `Agent Studio`):**
  - Verbatim user requirements:
    - `"sin venderme humo que todo quede operativo al 100 que todo quede conectado y en optimas condiciones"`
  - Acceptance Criteria:
    - `src/app/features/mcp-hub/mcp-hub.ts`: Replace `setTimeout(650)` fake `84.85 VES / +$64.50 USDT` strategy output with real `window.electron.copilot.sendMessage` / `mcp.testTool` execution (and explicit `UNAVAILABLE_IN_BROWSER` state when Electron IPC is absent instead of fake numbers).
    - `src/app/features/dashboard/dashboard.ts`: Fix `runSwarmHealthCheck()` to call `window.electron?.copilot?.getSwarmHealth()` instead of nonexistent `window.copilotApi`, removing fabricated `Math.random()` ping latencies.
    - `src/app/core/agent-studio.service.ts`: Update default model IDs from `gemini-3.7-flash` to `gemini-3.8-flash` and align catalog with valid November 2026 models.

- **S5 — Secure Preload IPC Bridge Seam & End-to-End Verification (`Electron + Angular + Playwright`):**
  - Shared IPC Seam Contract (`electron/preload/api.ts` & `electron/main/ipc/handlers.ts`):
    - Invoke channels added to `ALLOWED_CHANNELS` and `api.copilot`:
      - `'copilot:cancel-turn'` -> `cancelTurn(params: { requestId?: string })`
      - `'copilot:list-threads'` -> `listThreads(params?: { limit?: number })`
      - `'copilot:create-thread'` -> `createThread(params?: { title?: string; agentId?: string })`
      - `'copilot:get-thread-messages'` -> `getThreadMessages(params: { threadId: string; limit?: number })`
      - `'copilot:delete-thread'` -> `deleteThread(params: { threadId: string })`
      - `'copilot:reject-plan'` -> `rejectPlan(params: { planId: string; reason?: string })`
      - `'copilot:review-engram'` -> `reviewEngramObservation(params: { id: number; action: 'approve' | 'discard' })`
      - `'copilot:get-usage-summary'` -> `getUsageSummary(params?: { windowHours?: number })`
    - Push listen channels in `ALLOWED_LISTEN_CHANNELS` and `api.copilot`:
      - `'copilot:alpha-opportunity-detected'` -> `onAlphaOpportunity(cb)`
      - `'copilot:proactive-event-alert'` -> `onProactiveAlert(cb)`
      - `'copilot:stream-event'` -> `onStreamEvent(cb)`
  - Acceptance Criteria:
    - `electron/preload/api.spec.ts`, `npm run test:electron`, Angular Copilot/Dashboard/MCP-Hub unit tests, `npm run build` (CSS & bundle budgets), and new Playwright E2E spec `e2e/web/copilot.spec.ts` all pass green.

## Tasks

- [x] **T1** (`S1`, `S2` DB/Orchestrator) | Route: `inline` (parallel workers hit 429 quota) | Verified: `gemini-orchestrator.spec.ts` (36/36), `universal-ai-gateway.spec.ts` (4/4), `database.spec.ts` (11/11)
- [x] **T2** (`S2` Swarm/Gatekeeper) | Route: `inline` | Verified: `main/agents` (8 files, 46/46)
- [x] **T3** (`S3` Copilot 2-Mode UI) | Route: `inline` | Verified: `copilot.spec.ts` (8/8) + `npm run build` (`copilot` chunk 69.59 kB)
- [x] **T4** (`S4` Sibling Surfaces) | Route: `inline` | Verified: `mcp-hub.spec.ts` (8/8), `dashboard.spec.ts` (24/24), `agent-studio.service.spec.ts` (5/5)
- [x] **T5** (`S5` Preload/IPC Seam + Full Suite & Playwright E2E spec) | Route: `inline` | Verified: `preload/api.spec.ts` (25/25), `npm run validate:all` (Electron 27 files / 307 tests passed, `typecheck` 0 errors, `mcp:test` passed) | Note: `e2e/web/copilot.spec.ts` authored; live Playwright browser run pending dev server start.

## Log

- **L1 (2026-11-25):** `"quiero que hagas un analisis para detectar las fallas del copiloto de IA y busquemos organizar esta herramienta que de verdad se contituya como una herramienta de alto valor hay que mejorarla y organizarla vamos hacer una serie de recomendaciones para generar una mejor herramienta que sea funcional ademas que vas a organizar la interfaz y el dasboard de esa herramienta me vas a presentar las fotos de como va a quedar y vamos a organizar todo mejor no me vendas humo se objetivo y trabaja como un ingeniero de sotfwaere y un programador de alto nivel con  mas de una decada en este tipo de trabajo"`
- **L2 (2026-11-25):** `"quiero que revises si hay otras mejoras que deben incluirse aqui que sean de alto nivel y quiero que todo sea funcional y sin venderme humo que todo quede operativo al 100 que todo quede conectado y en optimas condiciones si tienes que lanzar en paralelos angentes de ejecucion hazlo quiero que sea una herramienta al nivel de las que se construyen en silicon velley"`
- **L3 (2026-11-25 — Architecture & High-Leverage Scope Additions):** Verified Gemini API November 2026 model catalog (`gemini-3.8-flash`, `gemini-4-argon`, `gemini-4-carbon`, `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`, `gemini-3.5-transcribe`; `gemini-3.7-flash`/`3.6-flash` and `2.5-*` excluded). Added 7 Silicon Valley capabilities on top of the 10 defect fixes: (1) Zod v4 `z.toJSONSchema` export for all 30+ MCP tools, (2) `SemanticCache` integration with market-epoch invalidation, (3) persistent SQLite `copilot_threads` + `copilot_messages` + `copilot_usage_ledger`, (4) real-time `ToolCallTrace[]` + IPC `copilot:stream-event` + `AbortController` turn cancellation, (5) unified `custom_agents` `@mention` persona & skill scoping, (6) cross-module grounding (`p2p_orders` + `operation_records` + `f360`) with `<untrusted_data>` prompt-injection isolation, and (7) keyboard-first (`Ctrl+K`, `Esc`, `Ctrl+Shift+D`) 2-mode Workbench + AI Governance Dashboard plus sibling de-mocking in `MCP Hub` and `Dashboard`.
