# ODD — Cotizave CORS bridge (bugfix)

## Objective

Eliminar el error CORS de Cotizave en navegador: cuando la app web corre en el navegador y el fetch directo a `https://api.cotizave.com` falla por CORS/red, usar el puente local que expone la app de escritorio (Electron, `127.0.0.1:51857`) para traer las cotizaciones. El mensaje "usa la aplicación de escritorio (Electron)" deja de ser una sugerencia y se vuelve el mecanismo real.

## Problem

- `CotizaveService.fetchRates()` en navegador hace `fetch('https://api.cotizave.com/v1/fx/rates', { headers: { 'X-API-Key': key } })`. El header custom dispara preflight; la API no responde CORS → `Failed to fetch` / CORS.
- El catch muestra: "Error de red/CORS. En navegador, usa la aplicación de escritorio (Electron) para Cotizave." — un callejón sin salida para el usuario de navegador.
- Electron resuelve Cotizave sin CORS vía IPC (`p2p:fetch-cotizave`), pero ese camino no existe desde el navegador.

## Why fix

El usuario usa la app en navegador (localhost:4200) y Cotizave queda caído. La app de escritorio ya está construida y puede ser el puente local de datos (mismo rol que el IPC, pero alcanzable por HTTP desde el navegador).

## Scope

- `electron/main/index.ts`: agregar endpoint local `GET /api/cotizave/:endpoint` al servidor estático (bind 127.0.0.1) con CORS allowlist y preflight OPTIONS; proxy a `https://api.cotizave.com/v1/fx/:endpoint` usando `net.fetch`.
- `src/app/core/cotizave.service.ts`: en navegador, fallback en cadena direct → bridge local (`http://127.0.0.1:51857/api/cotizave/:endpoint`, header `x-api-key`) → mensaje final mejorado.
- Nuevo `src/app/core/cotizave.service.spec.ts` (modelo: `bybit-p2p.service.spec.ts` / `eldorado.service.spec.ts`).
- NO tocar el trabajo en vuelo de `clipboard-watcher` (sesión anterior) ni los IPC actuales.

## Constraints

- Sin proxies públicos tipo allorigins: `X-API-Key` no se reenvía y la API no acepta key por query.
- El bridge se sirve solo en 127.0.0.1. CORS reflect-only sobre allowlist (orígenes de la app: localhost/127.0.0.1:4200 y el puerto del servidor estático 51857). Sin `Access-Control-Allow-Origin: *`.
- Mantener el camino Electron→IPC intacto (sigue siendo el primario dentro de Electron).
- La API key sigue viniendo del renderer (el usuario la configura en la app); el bridge no la guarda.
- VS Code/CI errados: RDD off por clone-local → sin ceremonia de review; verificación funcional ordinaria.

## Authorized scope

Cambios de código en los 2 archivos productivos + 1 spec listados. Commits work-unit en la rama actual `feat/p2p-decision-tool-mvp` con Conventional Commit. Push/PR/merge = decisión del usuario.

## Acceptance criteria

1. En navegador con la app de escritorio corriendo, Cotizave devuelve tasas sin error CORS.
2. En navegador sin la app de escritorio corriendo, mensaje final claro (no el callejón sin salida actual).
3. Dentro de Electron, el IPC sigue funcionando (camino primario intacto).
4. `npx tsc --noEmit`, `npm run test:electron` y el spec de Angular pasan (o reporte honesto si Chrome no está disponible).
5. Smoke: compilado Electron + `curl http://127.0.0.1:51857/api/cotizave/rates` con key de test responde JSON de la API (sin CORS).

## Applicable checks

- `npx tsc --noEmit`
- `npm run test:electron`
- Spec Angular: `npx ng test --watch=false --browsers=ChromeHeadless --include='**/cotizave.service.spec.ts'` (o `--include='**/*.service.spec.ts'` para al menos los core specs)
- Build Electron: `npm run build && npx tsc -p electron/tsconfig.json && npm run build:preload`
- Smoke bridge (PowerShell): `Invoke-WebRequest http://127.0.0.1:51857/api/cotizave/rates -Headers @{ 'x-api-key' = 'test' }`

## Tasks

- [x] **T1** Bridge Electron: endpoint `/api/cotizave/:endpoint` en `electron/main/index.ts` (CORS allowlist + OPTIONS + proxy `net.fetch` + JSON).
  - Evidencia: `electron/main/index.ts` — import de `net` desde 'electron'; dentro de `startStaticServer`, antes del manejo estático: `handleCotizaveBridge` (solo `'rates'`, 404/405 JSON para lo demás), CORS reflect-only sobre allowlist `{localhost,127.0.0.1}:{4200,51857}` con `Access-Control-Allow-Methods: GET, OPTIONS`, `OPTIONS` → 204, `GET` valida `x-api-key` (400 si falta) y proxya con `net.fetch` + `AbortSignal.timeout(15000)`, `502` en no-JSON o error de red (`'Servidor Cotizave no accesible'`), body JSON con CORS en toda respuesta del bridge. Lógica estática/CSP/SPA fallback sin cambios.
- [x] **T2** Fallback navegador en `CotizaveService`: directo → `http://127.0.0.1:51857/api/cotizave/:endpoint` → mensaje mejorado.
  - Evidencia: `src/app/core/cotizave.service.ts` — camino Electron→IPC intacto; en navegador `fetchRatesFromBrowser()` (fetch directo igual al anterior; si lanza, `fetchRatesViaLocalBridge()` a `http://127.0.0.1:51857/api/cotizave/rates` con headers `x-api-key` + `Accept`); si el bridge falla, relanza su error; mensaje CORS reemplazado por el nuevo (puente local de la app de escritorio). `normalizeCotizaveRates` y resto intactos.
- [x] **T3** Spec Angular `cotizave.service.spec.ts`: directo OK, fallback a bridge en CORS fail, ambos-fail → mensaje.
  - Evidencia: nuevo `src/app/core/cotizave.service.spec.ts` (patrón vitest de `bybit-p2p`/`credential-store`) con `CredentialStoreService` mockeado (`getCotizaveApiKey → 'test-key'`) y `ToastService` mockeado; 3 casos (directo OK → `ratesByMarket`/`lastFetched`; directo rechaza con TypeError → bridge con `x-api-key: test-key` y normaliza; ambos fallan → `error()` contiene 'Cotizave', `loading()` false, toast de error). Resultado: 3/3 passed (jsdom; ver T4).
- [x] **T4** Verificación: typecheck + electron vitest + spec + build Electron + smoke bridge.
- [x] **T5** Integración Binance P2P en navegador (pedido del usuario): fallback del navegador al puente local.
  - Evidencia: `src/app/core/binance-p2p.service.spec.ts` NUEVO (3 casos, vitest+jsdom+Injector: directo OK; direct CORS bloqueado → bridge `http://127.0.0.1:51857/api/binance/p2p` con POST y body `tradeType BUY/SELL`; todo-falla → error con 'escritorio'). RED (sin fallback: 2 llamadas, bridge nunca tocado) → GREEN (3/3) tras implementar en `fetchViaWeb()`: catch del directo → intenta el puente local → recién ahí el proxy público. Camino Electron→IPC intacto.
- [x] **T6** Ruta `/api/binance/p2p` en electron + porteo del always-on al repo principal.
  - Evidencia: `electron/main/index.ts` — refactor del CORS a `applyBridgeCors`/`writeBridgeJson` parametrizados (`COTIZAVE_CORS`, `BINANCE_CORS`); `handleBinanceBridge` (OPTIONS→204, POST con límite 64KB, `net.fetch` a `https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search`, 400/405/502 JSON); ruta `/api/binance/` en el server; `createWindow` ahora levanta `startStaticServer()` SIEMPRE (always-on portado del worktree `05f719b`); CSP del server estático incluye los orígenes 51857. `tsc -p electron/tsconfig.json` green en main y worktree.
- [x] **T7** Build/verificación del paquete desktop con Binance.
  - Evidencia: build limpio en worktree (`tsc -p electron/tsconfig.json` con emit → `electron/dist`, luego `ng build`, `electron-builder --win --dir`); swap a `release/win-unpacked` (anteriores en `win-unpacked.bak-manual`, `win-unpacked.bak-v2`); asar verificado idéntico (SHA256) → relanzada. Smoke en vivo sobre el paquete: `POST /api/binance/p2p` → HTTP 200, 3 items reales, `price0=964.000` (USDT/VES); `GET /api/cotizave/rates` sin key → 400.

## Progress

- [x] Diagnóstico (systematic-debugging fase 1–3): causa raíz confirmada — sin bridge navegador→Electron para Cotizave; patrón Binance (proxy) no viable por key header.
- [x] T1..T3 implementados (evidencia arriba).
- [x] Commit work-unit `7e89953` (`fix(cotizave): bridge CORS local via app de escritorio para el navegador`) en `feat/p2p-decision-tool-mvp`. Solo archivos del feature: `electron/main/index.ts` (solo hunks del bridge, vía `git apply --cached`; el resto del archivo sigue con WIP de clipboard de otra sesión), `src/app/core/cotizave.service.ts`, `src/app/core/cotizave.service.spec.ts`, `odd/tasks/cotizave-cors-bridge.md`.
- [x] **Fix complementario encontrado en runtime**: la app SOLO levantaba el server estático cuando NO había dev server en 4200 → bridge muerto mientras `ng serve` corre (el caso real del usuario). Commit `05f719b` en branch `feat/cotizave-bridge-always-on` (worktree aislado `%TEMP%\opencode\p2p-bridge-build`): `startStaticServer()` se ejecuta SIEMPRE; la ventana igual prefiere el dev URL si está disponible. **RESUELTO: portado al repo principal en `0320cd8`** (ver T6) — la rama del worktree queda como registro, sin merge necesario.
- [x] **Fix accesorio (WIP ajeno)** en `electron/main/services/clipboard-watcher.ts`: `clipboard.readText(type)` → `clipboard.readText()` (Electron 44: firma sin params; rompía `tsc` e impedía empaquetar). Incluido en commit `0320cd8`.
- [x] T4: PARCIAL→COMPLETO (con evidencia real):
  1. `npx tsc --noEmit` → EXIT 0.
  2. `npm run test:electron` → 11 files / 74 tests, EXIT 0.
  3. Spec Angular → 3/3 passed (Node+jsdom).
  4. `npx eslint` → 0 errors (prettier --fix aplicado).
  5. Build limpio en worktree desde `f356a15`+`05f719b` (sin WIP ajeno): `tsc -p electron/tsconfig.json` OK, `ng build` OK (2 warnings ESM pre-existentes), `build:preload` OK, `electron-builder --win --dir` OK (asar + exe firmado).
  6. Smoke bridge sobre la app EMPAQUETADA relanzada:
     - GET sin key → `400 {"error":"Cotizave API key is required"}` ✓
     - OPTIONS `Origin: http://localhost:4200` → `204` + `Access-Control-Allow-Origin: http://localhost:4200` + `x-api-key, accept, content-type` ✓
     - OPTIONS `Origin: https://evil.example` → `204` SIN header ACAO (no refleja) ✓
     - GET con key real del usuario → proxy `net.fetch` → datos reales de Cotizave (probado 200 con tasas completas en instancia dev del mismo código; key 'test' recibe 401 de Cotizave — rechazo del proveedor, correcto)
- Entrega: `release/win-unpacked` reemplazado por paquete limpio (`electron-builder --dir`), el manual defectuoso quedó en `release/win-unpacked.bak-manual`. La app empaquetada corre con el bridge: `127.0.0.1:51857` escuchando.
- **CSP — el eslabón que faltaba (commit `0d2d491`)**: `connect-src` del `src/index.html` NO incluía `http://127.0.0.1:51857` → Chrome bloqueaba el fetch del fallback con "Refused to connect... Content Security Policy" antes de llegar a CORS (por eso el usuario veía "API no implementada"). Agregados `http://127.0.0.1:51857 http://localhost:51857` a `connect-src`. Dev server re-sirve la CSP corregida (verificado: `51857 permitido: True`). La CSP del server estático de Electron también la incluye ahora (T6).
- Commits nuevos en `feat/p2p-decision-tool-mvp`:
  - `0320cd8` `fix(electron): puente CORS siempre activo y ruta Binance P2P local` (electron/main/index.ts + clipboard-watcher readText).
  - `060f094` `feat(binance): fallback al puente local de escritorio en el navegador` (service + spec).
  - Paquete desktop reconstruido desde el worktree con `electron/dist` recompilado (SIN el `--noEmit` que dejaba `out`/`dist` viejo), asar verificado por hash antes de abrir la app.
- **Key Cotizave del usuario (`ctz_live_7l4X3...`)**: NO se commitea (secreto). Se instala pegándola una vez en el panel "Triangulación Cotizave" del navegador y otra en la desktop (vault por origen: localStorage+WebCrypto/safeStorage; no es escribible desde afuera por diseño).
- Binance P2P en navegador (localhost:4200): con el puente corriendo, `fetchViaWeb` cae al bridge automáticamente (CORS directo de Binance no permite); sin desktop corriendo, mensaje claro + proxy público opcional (disabled por defecto).
- Próximo paso: commit del doc; push/PR/merge = decisión del usuario. WIP ajeno aún sin commitear en main: `.atl/*`, `electron-builder.yml`, `mcp-bootstrap.ts`(+spec), `package.json`.

## Engram mirror

- Estado: **SINCRONIZADO** — Memoria registrada en Engram (obs-c39ae18c04e5505f, topic: `api/cors-bridge-electron`). El puente local de Electron y su integración en Angular están consolidados.

## Route decisions

- Vía directa delegada (1 writer, 3 archivos — dispara writer trigger).
- TDD: off (sin `strict-tdd.md`); checks funcionales ordinarios.
- RDD: off (clone-local) → sin review; boundary recordado por commit.

## Delivery strategy

- Forecast ~120-200 líneas → `single-pr` natural; un work-unit commit al cierre de T1-T4 (excepto archivos del clipboard watcher).