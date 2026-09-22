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
- [ ] **T4** Verificación: typecheck + electron vitest + spec + build Electron + smoke bridge.

## Progress

- [x] Diagnóstico (systematic-debugging fase 1–3): causa raíz confirmada — sin bridge navegador→Electron para Cotizave; patrón Binance (proxy) no viable por key header.
- [x] T1..T3 implementados (evidencia arriba). T4 parcialmente corrido: `npx tsc --noEmit` OK (root `files:[]`), `npm run test:electron` OK (74 tests), spec Angular 3/3 en jsdom; PENDIENTE por bloqueo pre-existente (sesión anterior): `npm run build` falla por `clipboard-payment.service.ts(68)` TS2345 ('compliance' ∉ AuditCategory) y `tsc -p electron/tsconfig.json` falla por `clipboard-watcher.ts(50)` TS2554 — ambos archivos fuera de scope/vetados. `build:preload` OK. ChromeHeadless no disponible (faltan `@vitest/browser-*`). Smoke bridge → orquestador.

## Engram mirror

- Estado: **PENDIENTE** — `mem_save` falla con `repository_binding_unavailable` (binding del repo no creable; revisar `.engram/config.json`). El archivo local es la fuente de verdad. Resincronizar cuando esté disponible.

## Route decisions

- Vía directa delegada (1 writer, 3 archivos — dispara writer trigger).
- TDD: off (sin `strict-tdd.md`); checks funcionales ordinarios.
- RDD: off (clone-local) → sin review; boundary recordado por commit.

## Delivery strategy

- Forecast ~120-200 líneas → `single-pr` natural; un work-unit commit al cierre de T1-T4 (excepto archivos del clipboard watcher).