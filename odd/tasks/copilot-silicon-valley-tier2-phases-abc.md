# Copilot & Agents Silicon Valley Tier-2 Overhaul (Phases A, B, C)

- Branch: `feat/p2p-decision-tool-mvp`
- Scope: Full implementation of Phases A, B, and C from the Silicon Valley AI audit (SSE streaming, dynamic tool routing, Daemon-to-HITL bridge, multimodal image paste/attach, `/evaluar` multi-agent consensus with unilateral veto & zero Swarm placeholders, real Decision Journal Win Rate telemetry, and `npm run eval:copilot` production eval suite).

## Specs

- **S1**: "Vamos a implementar las tres fases de una vez. Organicemos todo y dejémoslo committeado con la rama limpia y todo pusheado."
- **S2 (Fase A)**: Dynamic domain tool routing in `gemini-orchestrator.ts` (trims MCP tool payload by domain/intent), real SSE token-by-token streaming (`streamGenerateContent?alt=sse` emitting `phase: 'delta'` events to Copilot UI with graceful JSON fallback), and closed Daemon-to-HITL bridge persisting actionable daemon proposals into `strategy_plans` + pushing live alerts to Copilot.
- **S3 (Fase B)**: Multimodal vision attachments (`Ctrl+V` paste & file attach) in Copilot chat forwarded as `inlineData` to Gemini; `/evaluar` multi-agent consensus pipeline (`arbitrage-strategist` + `treasury-macro-cfo` + `risk-gatekeeper` with unilateral veto); remove hardcoded `FALLBACK_DAILY_VOLUME_USDT = 4500` / `FALLBACK_DAILY_LIMIT_USDT = 15000` placeholders from `swarm-orchestrator.ts` (fail closed).
- **S4 (Fase C)**: Real Decision Journal Win Rate (`modeled vs realized spread`, `winRatePct`, `realizedProfitUsdt`) wired from SQLite `decision_outcomes` into `CopilotUsageSummaryDto` and rendered in the Apple Pro Governance Dashboard; 15-scenario production eval harness runnable via `npm run eval:copilot`.
- **S5**: Full verification (`npm run eval:copilot`, `npm run build`, `tsc -p electron/tsconfig.json`, `npm run build:preload`, `npm run validate:all`, Angular Vitest suites), clean Conventional Commits, push to `origin/feat/p2p-decision-tool-mvp`, and empty `git status`.

## Tasks

- [x] **T1** (S2 | inline): Phase A — Add `delta` streaming support (`shared/types.ts`, `gemini-orchestrator.ts`, `copilot.ts`), dynamic domain tool routing, and Daemon-to-HITL bridge (`daemon-scheduler.ts`, `ipc/handlers.ts`). Commit: backend + UI slices
- [x] **T2** (S3 | inline): Phase B — Remove Swarm placeholders (`swarm-orchestrator.ts`), add multi-agent `/evaluar` consensus with unilateral veto, and add multimodal image `Ctrl+V` / attach in Copilot (`shared/types.ts`, `gemini-orchestrator.ts`, `copilot.{ts,html,scss}`). Commit: backend + UI slices
- [x] **T3** (S4 | inline): Phase C — Wire SQLite `decision_outcomes` Win Rate into `database.ts`, `shared/types.ts`, `governance-dashboard.component.ts`, and create 15-scenario `electron/main/evals/copilot-eval-suite.spec.ts` + `npm run eval:copilot`. Commit: backend + UI slices
- [x] **T4** (S5 | inline): Run full verification (`eval:copilot` 15/15, `build`, `tsc` Electron, `build:preload`, `check:vendor` 25/25, Angular Vitest 12/12), commit cleanly, push, and verify clean git status. Commit: backend + UI slices

## Log

- **L1**: "Con todo lo que hemos hecho en el copiloto de inteligencia artificial, ¿qué recomendaciones me das para elevarlo a otro nivel? ... No me vendas humo y sé muy objetivo a la hora de recomendar las cosas."
- **L2**: "Vamos a implementar las tres fases de una vez. Organicemos todo y dejémoslo committeado con la rama limpia y todo pusheado. Vamos también a organizar que todas las recomendaciones queden bien implementadas y, a su vez, busquemos la manera de ejecutar el plan de manera operativa paso a paso."
