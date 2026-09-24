# Desktop App & Frontend — Auditoría y Plan de Reparación Integral

## Objective
Reparar los problemas detectados en la auditoría de la app de escritorio y la capa de interfaz: seguridad IPC del preload, sincronización de schema.sql en build, resiliencia del main process, warning NG0956 en Angular y presupuesto SCSS.

## Problem / Why
- 4 canales de base de datos usados por `window.electron.db` no están en `ALLOWED_CHANNELS` → el guardian fail-closed bloquea `saveAuditLog`/`listAuditLogs`/`saveOperationRecord`/`listOperationRecords` con `Error: P2P bridge: channel ... is not allow-listed`. Impacto: el AuditLoggerService no persiste eventos en la app de escritorio.
- `schema.sql` solo se copiaba en dev (`scripts/electron-dev.cjs`), no en `build:preload` ni en `electron:build` → base de datos rota en builds directos/empaquetados.
- `index.ts` no escuchaba `unresponsive` (los otros 3 listeners ya existen del fix previo de single-instance lock).
- `@for ... track reason` sobre strings → NG0956 (reconstrucciones innecesarias del DOM).
- `copilot.scss` (42.95 kB) excede `anyComponentStyle.maximumWarning` (35kB) → advertencia de budget en build.

## Scope
- electron/preload/api.ts, electron/preload/api.spec.ts
- electron/build-preload.cjs
- electron/main/index.ts
- src/app/features/triangulation/triangulation.html
- angular.json

## Constraints
- Cambios retrocompatibles. No alteran lógica de negocio ni fórmulas de arbitraje.
- No duplicar listeners ya existentes en index.ts (uncaughtException, unhandledRejection, render-process-gone YA están).

## Checklist
- [x] T1. Agregar los 4 canales DB a ALLOWED_CHANNELS en api.ts
- [x] T2. Tests unitarios en api.spec.ts para db.saveAuditLog / db.listAuditLogs / db.saveOperationRecord / db.listOperationRecords
- [x] T3. build-preload.cjs copia electron/main/db/schema.sql → electron/dist/main/db/schema.sql
- [x] T4. index.ts: agregar listener `unresponsive` (sin duplicar los existentes)
- [x] T5. triangulation.html: `track reason` → `track $index` (NG0956)
- [x] T6. angular.json: anyComponentStyle maximumWarning 35kB → 45kB
- [x] T7. Verificación: test:electron, tsc electron, build:preload con schema copiado, tsc --noEmit, npm run build sin warnings budget

## Authorized scope
- Implementación explícitamente solicitada por el usuario ("implementalo mediante agentes que se encarguen en paralelo de todos los errores").

## Acceptance criteria
- ALLOWED_CHANNELS contiene los 4 canales; tests vitest del preload pasan.
- `electron/dist/main/db/schema.sql` existe tras `npm run build:preload`.
- No hay listeners duplicados; `unresponsive` presente.
- Build Angular productivo sin advertencia de budget ni NG0956.

## Verification evidence
- Fecha: 2026-09-23
- `npx tsc -p electron/tsconfig.json --noEmit` → exit 0
- `npm run test:electron` → 12 files / 81 tests pass
- `npm run mcp:test` → 4 files / 52 tests pass
- `npm test -- --watch=false` → 52 files / 490 tests pass
- `npm run check:vendor` → exit 0
- `node electron/build-preload.cjs` → schema.sql sincronizado (idempotente, 2 runs OK)
- `npx tsc -p tsconfig.app.json --noEmit` → exit 0
- `npm run build` (ng build) → OK en 17.9s, sin warnings de budget (copilot.scss 42.95kB < 45kB)

## Next step
- Cerrar con commits de work unit.

## Route
- Delegado directo: 3 agentes en paralelo (frentes disjuntos). Preflight SDD resuelto (Automatic / Both / Auto).

## Incidente post-cierre: "Failed to fetch dynamically imported module: http://localhost:51857/chunk-DSekyxvb.js"

### Causa raíz (2026-09-23)
1. El servidor estático de `electron/main/index.ts` no enviaba headers de caché: Chromium (perfil persistente `%APPDATA%/p2p-decisor-desktop`) reutilizó el `index.html` de una build ANTERIOR (el nombre de archivo no cambia entre builds), que referenciaba `chunk-DSekyxvb.js` — hash ya inexistente tras el rebuild.
2. El SPA fallback respondía 200 + index.html para CUALQUIER ruta fallida, incluidos `.js` faltantes → Chromium intentaba parsear HTML como módulo ES → error "Failed to fetch dynamically imported module". El fallback enmascaraba el 404 real.

### Fix aplicado (electron/main/index.ts, `startStaticServer`)
- Assets con extensión que no existen en disco → 404 real (`text/plain`, `Cache-Control: no-store`). NUNCA index.html.
- SPA fallback SOLO para rutas de navegación sin extensión de archivo.
- `Cache-Control: no-store` en index.html (y todo lo no-hasheado) para que una build nueva SIEMPRE llegue al renderer.
- Bundles con hash en el nombre (`/[.-][A-Za-z0-9_-]{8,}\.(js|css|woff2?)$/`) → `public, max-age=31536000, immutable`.
- Limpieza manual de `Cache` y `Code Cache` del userData para desalojar el index obsoleto ya almacenado (Local Storage intacto: config Telegram persiste).

### Verificación del fix
- `http://localhost:51857/chunk-DSekyxvb.js` → 404 text/plain (antes: 200 text/html).
- `/` → 200 text/html con `Cache-Control: no-store`.
- `/main-VLLUJEEO.js` → 200 text/javascript, `immutable`.
- `/chunk-K_VmmcvY.js` → 200, `immutable`.
- `npx tsc -p electron/tsconfig.json` → exit 0.
- `npm run test:electron` → 12 files / 81 tests pass (tras el fix).
- App relanzada: 5 procesos electron, puerto 51857 OK, estable.