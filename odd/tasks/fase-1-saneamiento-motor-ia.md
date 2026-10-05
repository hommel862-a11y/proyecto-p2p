# Fase 1: Saneamiento del Motor de IA y Modelos Reales

## Objective

Restaurar la veracidad y operatividad del motor de Inteligencia Artificial (Gemini) en Electron (desktop) y en la aplicación móvil (Capacitor/Web):
1. Reemplazar los modelos inexistentes hardcodeados en el orquestador de Electron (`gemini-3.5-flash-lite`, etc.) por modelos vigentes de Google Gemini (`gemini-2.0-flash`, `gemini-2.5-flash`, `gemini-1.5-flash`).
2. En la aplicación móvil y web (`src/app/features/copilot/copilot.ts`), inyectar el snapshot de datos de mercado en vivo (tasas Binance P2P, BCV, paralelo, brecha cambiaria y límites reales de tesorería bancaria) en el prompt del sistema antes de llamar a Gemini, actualizando la procedencia de forma honesta.

## Problem / Why

- En `electron/main/gemini-orchestrator.ts:244`, `getCandidateModels()` devuelve `['gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-3.1-flash-lite']`. Ninguno de estos modelos existe en la API oficial de Google (`v1beta`). Por ende, toda llamada de Function Calling falla con 404 y cae silenciosamente a un motor heurístico de 19 plantillas fijas de texto. La IA real nunca razona en Desktop.
- En `src/app/features/copilot/copilot.ts:703`, el modelo de referencia está seteado como `'gemini-3.6-flash'`.
- En modo móvil/web (`copilot.ts:1331-1425`), Copilot llama directamente a Gemini pero **sin contexto de mercado**. No envía libro de Binance, ni tasa BCV, ni saldos de cuentas. La IA está ciega respecto al mercado venezolano actual y el sistema estampa `marketFeedReason: 'NO_BOOK'`.

## Scope

- `electron/main/gemini-orchestrator.ts`:
  - `getCandidateModels()`: actualizar a `['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-1.5-flash']`.
  - `testConnection()`: usar `candidateModels[0] ?? 'gemini-2.0-flash'`.
- `src/app/features/copilot/copilot.ts`:
  - Corregir modelo de referencia a `'gemini-2.0-flash'`.
  - Inyectar `TriangulationIntelligenceService` y `AccountsService` para construir un bloque estructurado de contexto de mercado en vivo (`formatLiveMarketContextForCopilot`).
  - Incorporar dicho contexto en el `system_instruction` de la llamada directa a Gemini.
  - Actualizar `provenance` para reflejar con honestidad si hubo tasas en vivo disponibles (`liveMarketFeedConnected: true` o `false` con razón).
- Specs de Electron y Frontend: verificar que las suites pasen al 100%.

## Verification Plan

- `npm run test:electron`
- `npx tsc -p tsconfig.app.json --noEmit`
- `npx tsc -p tsconfig.spec.json --noEmit`
