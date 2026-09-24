# Telegram Bot Operativo — Dejar el bot vinculable y operativo

## Objective
Dejar operativo el flujo de Telegram de punta a punta: el usuario abre el bot, presiona `/start`, "Detectar Chat ID" lo captura, guarda la config y envía una alerta de prueba con éxito (sin "chat not found").

## Problem / Why
- Error reportado: `Telegram rechazó el envío (chat not found)`. Los bots no pueden iniciar chats: requieren que el usuario abra el bot y presione `/start`, y que el Chat ID correcto quede guardado.
- Una sesión previa dejó un trabajo a medio camino (sin commitear): handler `/start` en `telegram-sentinel.ts`, `detectChatIdFromUpdates`/`getBotInfo` en `telegram-worker.service.ts`, botones "Abrir Bot"/"Detectar Chat ID" y manejo de "chat not found" en `risk-rules.ts/.html`, y `lastInboundChat`. Está sin verificar, sin tests nuevos y con riesgos concretos.

## Scope
- projects/core/src/lib/telegram-sentinel.ts (+ spec)
- src/app/core/telegram-worker.service.ts (+ spec NUEVO si no existe)
- src/app/features/risk-rules/risk-rules.ts / .html (+ spec)
- Verificación integrada: ng build, tsc --noEmit, test:electron, ng test

## Constraints
- Respetar y COMPLETAR el trabajo existente en el working tree (no rehacerlo desde cero, no borrar lo ya escrito).
- NO tocar `scratch/`, ni archivos ajenos (electron/main/index.ts, odd/tasks/desktop-frontend-repair-audit.md ya commiteados quedan igual; risk-rules/telegram-worker/telegram-sentinel SÍ se modifican).
- Cambios retrocompatibles; no alterar fórmulas de arbitraje ni lógica de negocio.
- `projects/core` se emite hacia electron (integridad byte-idéntica verificada por gemini-skills.spec): cualquier cambio debe mantener esa coherencia (tipos exportados, funciones puras).

## Riesgos técnicos conocidos (dar prioridad)
1. **escapeMarkdownV2 en `/start`**: la respuesta usa escapes manuales (`\\.`, `\\-`). Cualquier carácter especial de MarkdownV2 sin escapar (puntos, paréntesis, `!`, `+`, `=`) en el texto genera 400 `can't parse entities`. Verificar que la respuesta parsea SIEMPRE.
2. **`getUpdates?limit=20` sin offset puede devolver 409 Conflict** si el long-polling (`startPolling`) está corriendo con un offset propio. La detección debe convivir con el polling.
3. **`lastInboundChat` vive en memoria**: solo se llena si el worker procesa updates mientras la app está abierta. La detección directa vía `getUpdates` debe ser la vía fiable; `lastInboundChat` es un atajo opcional.
4. **Tipos**: `TelegramInboundUpdate` debe cubrir `message.chat`, `message.from`, `callback_query.message.chat`, `callback_query.from` según se usa.
5. **Guard de polling**: detectar Chat ID desde la UI mientras el polling está activo con un offset distinto puede tragarse/reescribir updates (`currentOffset`).

## Checklist
- [x] T1. telegram-sentinel.ts: `/start` responde SIEMPRE con Chat ID y mensaje que parsea en MarkdownV2 (escapar todo o usar escapeMarkdownV2). Acceso denegado informa el Chat ID. Tests en telegram-sentinel.spec.ts.
- [x] T2. telegram-worker.service.ts: getBotInfo + detectChatIdFromUpdates robustos (409, red, token inválido, sin mensajes); lastInboundChat capturado al procesar updates entrantes; respuesta a `/start`; envío al chat no autorizado. Spec nuevo (o ampliar existente) con fetch mockeado.
- [x] T3. risk-rules: detectChatId con retry razonable, guarda config y dispara prueba automática; manejo diferenciado de "chat not found" (mensaje con "Abrir Bot" + "Detectar Chat ID"); botUsername mostrado. Tests en risk-rules.spec.ts.
- [x] T4. Verificación integrada: `npx tsc --noEmit`, `npm run build` (ng), `npm run test:electron`, `npm test -- --watch=false` (ng test). Sin advertencias nuevas de budget.
- [x] T5. Documentar en este doc la causa raíz y el flujo verificado; commit de work unit + push (autorizado por el usuario).

## Acceptance criteria
- El usuario puede: abrir bot desde la app → `/start` en Telegram → "Detectar Chat ID" → se guarda el Chat ID → alerta de prueba llega SIN "chat not found".
- Si el Chat ID guardado no inició el bot, el error orienta con "Abrir Bot" e "Iniciar" en vez de un error genérico.
- Todos los tests pasan; build sin warnings.

## Verification evidence
Resultados del 24/09/2026 (verificación integrada, commit `TBD`):
- `npx tsc --noEmit` (root) → OK. `npx tsc -p electron/tsconfig.json --noEmit` → OK.
- `npm run test:electron` → 12 files / 81 tests passed.
- `npm test -- --watch=false` (ng test) → 52 files / 497 tests passed.
- `npm run build` → OK (22.7s), solo warnings CommonJS pre-existentes (tesseract.js, qrcode), sin warnings de budget nuevos.
- `node scripts/sync-vendor-core.cjs --check` → 24/24 idénticos.

## Next step
- Commit de work unit + push de la rama `feat/p2p-decision-tool-mvp` (autorizado por el usuario).

## Route
- Delegado directo: agentes en paralelo (frentes disjuntos por archivo). ODD (no SDD).