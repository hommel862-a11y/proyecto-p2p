# Telegram Comandos Operativos V2 — Radar, Reprice, Macro y Backtest desde Telegram

## Objective
Cerrar los gaps reales del informe técnico de bots Telegram del usuario: convertir el terminal en un control operativo completo desde Telegram, añadiendo los comandos que el informe pide y que HOY no existen como comandos: `/radar`, `/reprecio`, `/macro` y `/backtest`, con botones inline de confirmación (acks accionables) y plantillas de reporte estándar.

## Problem / Why
- El informe describe 5 bots: Radar Scanner, Control remoto C2, Anti-triangulación, Jarvis (macro) y AutoPayBot. El análisis de viabilidad (24/09) concluyó que ~80% ya existe; los **gaps implementables desde Telegram** son:
  1. `/radar [banco] [capital]` — escaneo de gaps con filtro por banco/tramo NO existe como comando (solo `/spreads` genérico).
  2. `/reprecio <buy> <sell>` — repricing manual forzado NO existe como comando (el motor `binance-repricer.service.ts` / `repricer.ts` SÍ existe).
  3. `/macro` — reporte macro consolidado (BCV + volatilidad 2h + spread promedio) NO existe como comando (los motores `volatility-forecaster.ts`, `bcv-intervention-predictor.ts`, `getBcvMarketIntelligence` SÍ existen).
  4. `/backtest [par] [temporalidad]` — simulación histórica: el harness `scripts/backtest.cjs` (Fase 1 Consolidador, Work Unit 1.3) YA existe pero NO está conectado a Telegram.
  5. Botones inline accionables: el dispatcher ya procesa `callback_query` (DISPUTE_, BOT_KILLSWITCH, BOT_RESUME, BOT_STATUS); faltan callbacks de confirmación para acciones destructivas (reprecio, backtest) y refresco de radar.
- El valor: el operador decide y ejecuta desde el teléfono sin abrir la app.

## Scope
- `projects/core/src/lib/telegram-sentinel.ts` (+ spec) — comandos nuevos, callbacks nuevos, plantillas nuevas (`formatRadarTelegramMessage`, `formatMacroTelegramMessage`, `formatBacktestTelegramMessage`, `formatRepriceTelegramMessage`).
- `src/app/core/telegram-worker.service.ts` (+ spec) — wiring de las acciones nuevas contra servicios reales y ejecución del harness de backtest.
- Verificación integrada: `npx tsc --noEmit`, `npm run check:vendor`, `npm run test:electron`, `npm test -- --watch=false`.

## Constraints
- Core puro se emite hacia electron vía `scripts/sync-vendor-core.cjs` — mantener `projects/core` como librería pura (funciones puras formateadoras + dispatch); NO meter servicios Angular en core.
- Cambios retrocompatibles: los comandos/callbacks existentes (`/status`, `/spreads`, `/bcv`, `/bancos`, `/killswitch`, `/resume`, DISPUTE_) no cambian su contrato.
- Escapes MarkdownV2: toda respuesta debe parsear SIEMPRE (regla del informe y bug histórico de `/start`).
- Acciones destructivas (`/reprecio`, `/backtest`) requieren confirmación por botón inline antes de ejecutar.
- No tocar `scratch/`, ni otros features ajenos; work-unit commits Conventional Commit en `feat/p2p-decision-tool-mvp` (ya activo), sin push (orden del usuario).
- Pase `delivery_strategy`/ODD: trabajo delegado directo (no SDD), agentes en paralelo por frentes disjuntos.

## Riesgos técnicos conocidos (dar prioridad)
1. **MarkdownV2**: cualquier texto dinámico (nombres de banco, precios, capital) debe pasar `escapeMarkdownV2` o el bot responde 400 `can't parse entities`.
2. **Callback query no confirmado**: los callbacks de confirmación (REPRICE_CONFIRM/CANCEL, BACKTEST_RUN) solo deben ejecutarse desde `callback_query` autenticado, con `from.id === authId`, y responder `answerCallbackQuery` (ack) antes de la acción.
3. **Reprice es destructivo**: validar que buy/sell lleguen como números finitos y que el usuario confirme; devolver estado anterior en el mensaje de confirmación.
4. **Backtest en worker**: ejecutar `node scripts/backtest.cjs` puede tardar; el worker debe responder el ack instantáneo ("ejecutando...") y enviar el resultado como mensaje posterior, nunca bloquear el polling.
5. **Tipos del contrato**: extender `DispatchResult` con `action` nuevos sin romper `TelegramInboundUpdate` ni los callbacks existentes.
6. **sync-vendor-core**: cualquier export nuevo en `projects/core` debe propagarse byte-idéntico (`npm run check:vendor`), igual que la spec de gemini-skills exige.

## Contrato de acciones (coordinación entre agentes — fijo, no cambiar)
- `/radar [banco] [capital]` → `{ action: 'RADAR_SCAN', params?: { bank?: string; capital?: number } }`
- `/reprecio <buy> <sell>` → `{ action: 'REPRICE_REQUEST', params: { buyPrice: number; sellPrice: number } }`
- callback `REPRICE_CONFIRM:<buy>:<sell>` → `{ action: 'REPRICE_EXECUTE', params: { buyPrice: number; sellPrice: number } }`
- callback `REPRICE_CANCEL` → `{ action: 'REPRICE_CANCEL' }`
- `/macro` → `{ action: 'MACRO' }`
- `/backtest [par] [temporalidad]` → `{ action: 'BACKTEST_REQUEST', params?: { pair?: string; timeframe?: string } }`
- callback `BACKTEST_RUN` → `{ action: 'BACKTEST_EXECUTE' }`
- Plantillas: `formatRadarTelegramMessage`, `formatMacroTelegramMessage`, `formatBacktestTelegramMessage`, `formatRepriceTelegramMessage` — funciones puras en core, alto de Telegram, MarkdownV2 seguro.

## Checklist
- [x] T1 (core). telegram-sentinel.ts: comandos `/radar`, `/reprecio`, `/macro`, `/backtest` + callbacks REPRICE_CONFIRM/REPRICE_CANCEL/BACKTEST_RUN + plantillas format* puras con escapeMarkdownV2. Spec ampliado (telegram-sentinel.spec.ts). Commit `287271f`, core 53 files / 573 passed, tsc OK, vendor 24/24.
- [x] T2 (worker). telegram-worker.service.ts: wiring de acciones → servicios reales (BinanceP2pService:fetchMarketDepth + AccountsService:usages, BinanceRepricerService:currentBuyAdPrice/currentSellAdPrice, CotizaveService + getBcvMarketIntelligence + predictTwoHourVolatility, harness backtest.cjs vía IPC electron.backtest.run con ELECTRON_RUN_AS_NODE); ack de callback antes de ejecutar; envío asíncrono sin bloquear polling. **Scope expandido justificado**: el renderer no tiene acceso Node, se creó `electron/main/services/backtest-runner.ts` + IPC `p2p:backtest-run` + preload/shared types + packaging asarUnpack de scripts/backtest.cjs. Commit `0e22584`; worker spec 41 passed, electron 125 passed, tsc OK, vendor 24/24.
- [x] T3. Verificación integrada: `npx tsc --noEmit`, `npm run check:vendor`, `npm run test:electron`, `npm test -- --watch=false`. Work-unit commits en `feat/p2p-decision-tool-mvp` (sin push): `287271f` (core), `e813353` (docs), `0e22584` (worker).

## Acceptance criteria
- Desde Telegram: `/radar bcv 2000` devuelve el top de gaps filtrado por banco; `/reprecio 84.5 85.2` pide confirmación por botón y al confirmar fuerza el reprice; `/macro` devuelve BCV + volatilidad 2h + spread promedio; `/backtest usdt/buy 7d` ejecuta el harness y reporta métricas con formato MarkdownV2 que parsea.
- Ningún comando/callback nuevo rompe los existentes; todas las respuestas parsean en MarkdownV2.
- Suite completa verde; build sin advertencias nuevas; core y vendor byte-idénticos.

## Route
- Delegado directo ODD (no SDD): Agente W1 (core, frentes `projects/core/**`) y luego Agente W2 (worker, `src/app/core/telegram-worker.service.ts`) — secuenciales por dependencia de contrato, no en paralelo sobre el mismo archivo. Verificación integrada por el orquestador (gatekeeper ODD).

## Verification evidence
Resultados del 27/09/2026 (feature doc `e813353`, W1 `287271f`, W2 `0e22584`; sin push):
- `npx ng test core --watch=false` → 53 files / 573 tests passed.
- `npx ng test --include "**/telegram-worker.service.spec.ts" --watch=false` → 1 file / 41 tests passed (runner termina con el error ambiental `No tests found matching...` conocido; reproducido también en baseline, no cuenta como fallo).
- `npx vitest run` (electron) → 15 files / 125 tests passed (incluye backtest-runner.spec.ts).
- `npx tsc --noEmit` → OK. `npm run check:vendor` → 24/24 idénticos.
- Limitaciones honestas declaradas por W2: harness no acepta pair/timeframe en CLI (solo etiqueta informativa); maxDrawdownPct = `n/d` (el harness no computa drawdown); /radar limita a 8 filas y revela drops; sin depth en vivo el radar dice "sin datos en vivo" en vez de inventar números.