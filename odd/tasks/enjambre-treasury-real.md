# Feature: Enjambre con tesorería real — puente IPC, veto enforced y rotador multicuenta

## Objetivo
Implementar el puente entre la tesorería real del renderer (AccountsService) y el enjambre del main
process: eliminar literales hardcodeados de límites, validar veto/killswitch en la ejecución, cerrar el
bypass de alpha-watcher y agregar los gaps del rotador multicuenta (target_bank, estado DISABLED,
límite de transacciones por cuenta). Solo con lo que ya existe en el repo, sin APIs bancarias, sin LLM
en el pipeline.

## Problema
- `swarm-orchestrator.ts:108-109` inyecta `dailyVolumeProcessedUsdt: 4500` / `dailyLimitUsdt: 15000` literales.
- `risk-gatekeeper-agent.ts:90-91` usa defaults hardcodeados `4200` / `15000` cuando falta contexto.
- El main process NO puede leer las cuentas: viven solo en localStorage del renderer (`p2p.bank-accounts`), no hay tabla SQLite ni canal IPC.
- `copilot.ts:678-693` pinta Treasury HUD hardcodeado (`12500`, `88/12`, `142.5`, `14min`); el toggle kill-switch (L777-791) es cosmético.
- `alpha-watcher.ts:153` persiste planes `ALPHA-` directo a SQLite SIN pasar por el Gatekeeper.
- `gemini-orchestrator.ts:1795-1835` `executePlan` solo valida que el plan exista: NO valida veto ni killswitch.
- `killswitchState` (`ipc/handlers.ts:685-702`) no tiene consumidores de producción.
- Los gaps del rotador: `getRotationRecommendation` no filtra por banco destino; no existe estado DISABLED; el tope de 15 tx/día es global, no por cuenta.

## Alcance y restricciones
- Cuentas en `p2p.bank-accounts` localStorage del renderer (NO migrar a SQLite en esta fase).
- Byte-identidad vendor ↔ core para `accounts.ts` (VENDOR_NAMES). `account-velocity.ts` NO está vendorizado.
- No tocar archivos con cambios móviles sin commitear del usuario (android/, copilot.scss, triangulation.scss, api-settings-modal.*, app.scss, app.html, app.ts, binance-p2p.service.ts, styles.scss, angular.json, package.json).
- Comandos: `npm run check:vendor`, `npx ng test core`, `npm run test:electron`, `npm test` (angular), `npx ng test --include <spec>` (renderer).
- Work-unit commits con Conventional Commit, stagear SOLO los archivos propios de cada tarea.

## Tareas

- [ ] **T1 — Gaps del dominio de cuentas (core)** → Workstream A
  - `projects/core/src/lib/accounts.ts` + mirror vendor (byte-idéntico vía `npm run sync:vendor`):
    - `BankAccount.status?: 'ACTIVE' | 'DISABLED'`
    - `BankAccount.maxDailyTransactions?: number`
    - `recommendAccountForTrade(accounts, requiredVes, todayOps, targetBankCode?)` param opcional
  - `projects/core/src/lib/account-velocity.ts`:
    - `getRotationRecommendation(accounts, ops, requiredVes?, thresholds?, targetBankCode?)`
    - excluir cuentas DISABLED de rotación
    - `maxDailyTransactions` por cuenta override del global 15
  - Specs ampliadas en `accounts.spec.ts` y `account-velocity.spec.ts`.
  - Verificación: `npx ng test core` + `npm run check:vendor` + commit.

- [ ] **T2 — Puente IPC + gatekeeper con tesorería real (renderer→main)** → Workstream B
  - `src/app/core/accounts.service.ts`: método `buildTreasurySnapshot()` (DTO serializable).
  - `electron/preload/api.ts`: canal `p2p:treasury-announce` (send) en allow-list.
  - `electron/main/ipc/handlers.ts`: handler `p2p:treasury-announce` que cachea el snapshot; `copilot:run-swarm-analysis` acepta params reales.
  - `electron/main/agents/swarm-orchestrator.ts`: leer snapshot cacheado, pasar volumen/límite reales y datos de velocidad/rotación al gatekeeper; fallback a literales actuales si no hay snapshot.
  - `electron/main/agents/risk-gatekeeper-agent.ts`: `context.treasurySnapshot?`; reglas reales: cuenta DISABLED → veto, overLimit → veto, SATURATED → veto, nearLimit → warning/penaliza; fallback compat con defaults si falta snapshot.
  - Spec NUEVA `risk-gatekeeper-agent.spec.ts` + ampliar `swarm-orchestrator.spec.ts`.
  - Verificación: `npm run test:electron` + commit.

- [ ] **T3 — Ejecución protegida (veto/killswitch) + Treasury HUD real + cerrar bypass** → Workstream C (después de B)
  - `electron/main/gemini-orchestrator.ts` `executePlan(planId)`: rechazar si `killswitchState.isTriggered`; rechazar/reportar si el plan es ALPHA- no evaluado o el snapshot real indica overLimit/DISABLED.
  - `electron/main/alpha-watcher.ts`: inyectar RiskGatekeeperAgent, evaluar antes de persistir; si VETOED → no guardar plan, registrar observación y notificar.
  - `src/app/features/copilot/copilot.ts`: `runSwarmAnalysis()` pasa snapshot real; Treasury HUD derivado de AccountsService; toggle conecta a `p2p:killswitch-trigger` (+ status real).
  - Respetar cambios móviles pendientes del usuario en copilot.ts (edits quirúrgicos).
  - Verificación: `npm run test:electron` + `ng test --include copilot` + commit selectivo.

## Notas de entrega
- 3 workstreams, 3 work-unit commits. Forecast ~600+ líneas → al cierre se decide estrategia de PR (ask-on-risk pendiente). Sin push ni PR en esta ejecución.
- Next: decisión de PR chain con el usuario.

## Progreso
- 2026-09-26: mapa verificado (explore agent). T1,T2 pendientes; lanzar A+B en paralelo.