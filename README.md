# P2P Decisor — Herramienta de Decisión para Arbitraje P2P en Venezuela

[![CI](https://github.com/hommel862-a11y/proyecto-p2p/actions/workflows/ci.yml/badge.svg)](https://github.com/hommel862-a11y/proyecto-p2p/actions/workflows/ci.yml)

Herramienta de apoyo a la decisión para operaciones de arbitraje P2P en Binance (USDT/VES/EUR), diseñada para el contexto venezolano. Combina un **panel manual** (cálculo de spread, ingresos, riesgo, estadísticas y registro de operaciones) con **conectividad en vivo**: orden y prueba de depósito Binance P2P, rates Cotizave, un bot de Telegram (Sentinel) y un servidor MCP para agentes de IA.

## Características

| Módulo                      | Función                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Dashboard**               | Resumen del estado P2P: kill-switch, exposición, veredicto de riesgo y acciones rápidas                                  |
| **Monitor de Spread**       | Follow de order books Binance P2P (buy/sell USDT/VES/EUR), spread real y neto, alertas de oportunidad                    |
| **Calculadora de Ingresos** | Convierte un objetivo de ingreso diario en USD a capital requerido, con tabla de disciplina por APR                      |
| **Registro de Operaciones** | Ledger CRUD de operaciones buy/sell con PnL, exposición, racha de errores, exportación CSV y respaldo JSON               |
| **Reglas de Riesgo**        | 6 barreras de seguridad configurables (spread mínimo, operaciones máximas, límites de pérdida, etc.) + Telegram Sentinel |
| **Triangulación**           | Rates Cotizave por mercado (ADMC/p2p), spread calculado y auto-refresh configurable                                      |
| **Estadísticas**            | Agregación por día/mes/trimestre (UTC), filtrable por par, con métricas de volumen y fees                                |
| **Escáner de Recibos**      | OCR (Tesseract.js) de recibos bancarios + escudo anti-fraude (evaluación de riesgo del comprobante)                      |
| **Guía de Uso**             | Documentación de cada módulo + consejos de disciplina y rentabilidad                                                     |
| **Copilot**                 | Asistente con IA integrado en el shell de escritorio (chat, planes de acción y learnings)                                |

## Arquitectura

```
┌─────────────────────────────────────────────┐
│              Deployment Targets             │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐ │
│  │  Angular  │  │ Capacitor │  │  Electron │ │
│  │  Web App  │  │ (Android) │  │ (Desktop) │ │
│  └─────┬────┘  └─────┬────┘  └─────┬─────┘ │
│        │             │              │        │
│        └─────────────┼──────────────┘        │
│                      │                       │
│              ┌───────┴───────┐               │
│              │  @p2p/core    │               │
│              │  (pure logic) │               │
│              └───────────────┘               │
└─────────────────────────────────────────────┘
         │                          │
   ┌─────▼─────────────┐    ┌───────▼──────────┐
   │  Browser/Fetch    │    │ Electron main    │
   │  (Binance,        │    │ IPC + SQLite +   │
   │   Cotizave)       │    │ DPAPI vault +    │
   │                   │    │ Gemini copilot   │
   └───────────────────┘    └──────────────────┘
        └───────────────┬────────────────┘
                        ▼
              ┌─────────────────────┐
              │  MCP server (stdio/ │
              │  SSE) — 8 tools, 17 │
              │  resources, 5 prom. │
              └─────────────────────┘
```

### `@p2p/core` — Lógica de Negocio Framework-Agnóstica

Librería pura, determinista, sin dependencias de Angular/Node/red:

- `spread.ts` — Cálculo de spread round-trip USDT/VES con comisión
- `income.ts` — Conversión de objetivo de ingreso a capital requerido
- `rules.ts` — Motor de 6 reglas de seguridad (ALLOW/DENY/PAUSE)
- `storage.ts` — Puerto de persistencia + adaptador WebStorage
- `log.ts` — Resumen del ledger de operaciones (PnL, exposición, racha)
- `stats.ts` — Agregación por períodos con filtrado por par
- `money.ts` — Guardas contra NaN/Infinity/negativos
- `repricer.ts`, `compliance.ts`, `breakeven.ts`, `delta-neutral-hedge.ts` — motores auxiliares de repricing, cumplimiento, break-even y cobertura delta-neutral

### Integraciones en vivo

- **Binance P2P** — Order books y prueba de depósito (fetch directo en web; canal `p2p:fetch-binance` en el shell de escritorio).
- **Cotizave** — API key registrada por el usuario; rates por mercado. En escritorio viaja por `p2p:fetch-cotizave`.
- **Telegram Bot API** — Telegram Sentinel 2.0: worker 24/7 con follow de spreads, kill-switch, estados y auditoría de recibos. Credenciales (token + chat id) encriptadas.
- **Electron DB (SQLite)** — Órdenes FSM y eventos bancarios con deduplicación (30 días) en el shell de escritorio (`p2p:db-*`).
- **Copilot** — Canales `copilot:*` en el shell (chat, planes, learnings, conexión con Gemini).
- **MCP Server** — Exposición de motores cuantitativos y de riesgo a agentes (ver sección MCP).

### Stack

- **Angular 22** — Zoneless, signals, standalone components, lazy loading
- **TypeScript ~6** — OnPush change detection, computed signals
- **Vitest 4** — Unit tests
- **Playwright 1.62** — E2E (web + Electron)
- **Capacitor 8** — Android (notificaciones nativas)
- **Electron 44** — Desktop (contextIsolation, sandbox, IPC estrecho)
- **MCP** — `@modelcontextprotocol/sdk` (stdio + SSE)
- **Tesseract.js 7** — OCR de recibos; **Zod 4** — validación de schemas MCP
- **SCSS** — Variables CSS con temas dark/light

## MCP Server

Servidor **p2p-mcp-server v1.0.0** (`packages/mcp-server`) que expone la lógica a agentes/IDEs vía **stdio** (canal principal) y **SSE** opcional (puerto `51858`, activa con `MCP_ENABLE_SSE=true`, configurable con `MCP_SSE_PORT`).

- **8 tools**: `calculate_spread`, `evaluate_trade_risk`, `simulate_trade_impact`, `consult_zk_market_mesh`, `forecast_volatility_window`, `calculate_delta_neutral_hedge`, `trigger_killswitch`, `add_operation_entry`
- **17 resources**: market (6), ledger (5), risk (6)
- **5 prompts**: auditoría diaria, pre-trade checklist y más

Seguridad: validación **Zod** en cada input, **rate limiting** por tool (60 llamadas/min) y **audit trail** con hashes SHA-256 de inputs/outputs. La config de `.mcp.json` apunta al server compilado (`packages/mcp-server/dist/index.js`).

## Seguridad

- **Electron:** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- **IPC:** API de renderer limitada a una lista blanca (`EXPOSED_API_KEYS` en `electron/preload/api.ts`), validada por tests. Fail-closed.
- **Credenciales encriptadas:** El token de Telegram (bot + chat id) y la API key de Cotizave se guardan **cifrados** mediante `SecureVaultService`:
  - **Electron:** cifrado del sistema (DPAPI) vía puente `crypto:encrypt`/`crypto:decrypt` del preload.
  - **Web:** WebCrypto (AES-GCM) con fallback in-memory.
  - Las claves legacy en claro (`p2p.telegram_config`, `p2p.cotizave.apiKey`) se migran automáticamente a la bóveda (`p2p.secure.*`, prefijo `p2p_sec_vault:`) y se eliminan solo cuando el cifrado tuvo éxito (fail-closed).
- **Sin secrets en el repo:** El MCP server lee `COTIZAVE_API_KEY` exclusivamente de `process.env`; ninguna credencial real vive en el código.

## Inicio Rápido

### Requisitos

- Node.js **22+**
- npm 11+
- JDK 21 + Android SDK (solo para build Android)

### Desarrollo

```bash
# Instalar dependencias
npm install

# Servidor de desarrollo
npm start
# → http://localhost:4200

# Tests unitarios
npx ng test p2p --no-watch     # Angular app (ver nota de tests)
npx ng test core --no-watch    # @p2p/core
npm run test:electron          # Electron shell
npm run mcp:test               # MCP server

# MCP server local (externos: agents/IDEs lo necesitan compilado)
npm run mcp:build && npm run mcp:dev

# E2E
npm run e2e                   # Web (Playwright)
npm run e2e:electron          # Electron (requiere build previo)

# Electron
npm run electron:dev          # dev con build de preload
npm run electron:build        # empaquetado Windows
```

### Build

```bash
# Web bundle
npm run build

# Android (requiere SDK)
npx cap sync android
npx cap build android

# Electron desktop
npm run electron:build
```

## Tests

Números verificados con corridas reales (cierre de trabajo sobre la bóveda de credenciales):

| Suite                      | Resultado                                                         | Comando                       |
| -------------------------- | ----------------------------------------------------------------- | ----------------------------- |
| Aplicación Angular (`p2p`) | **109/110** — 20 archivos                                         | `npx ng test p2p --no-watch`  |
| `@p2p/core`                | **426/426** — 49 archivos                                         | `npx ng test core --no-watch` |
| Electron shell             | **64/64** — 10 archivos (100%)                                    | `npm run test:electron`       |
| MCP server suite           | **51/51** — 4 archivos (100%)                                     | `npm run mcp:test`            |
| Motores Vendored Core      | **23/23** — SHA-256 byte a byte                                   | `npm run check:vendor`        |
| Bóveda de credenciales     | **6/6** — `credential-store.service.spec.ts` (incluidos en `p2p`) | `npx ng test p2p`             |
| E2E Web                    | 6 specs Playwright (requieren build + servidor)                   | `npm run e2e`                 |
| E2E Electron               | 1 script (`e2e/electron/e2e.mjs`, requiere build previo)          | `npm run e2e:electron`        |

> ⚠️ **Único fallo conocido (pre-existente, ajeno a credenciales):** `app.spec.ts` espera 9 enlaces de navegación (`should render a nav with 9 feature links`), pero la app tiene 10 características. La aserción quedó desactualizada al añadirse la décima vista.

## Respaldo de Datos

El registro de operaciones se almacena en `localStorage`. Para evitar pérdida:

1. **Exportar:** Botón "Exportar respaldo" en Registro de Operaciones → descarga JSON
2. **Importar:** Botón "Importar respaldo" → carga y valida el archivo JSON
3. **CSV:** Botón "Exportar CSV" → descarga para análisis en Excel/hojas de cálculo

> ⚠️ **Importante:** Al desinstalar la app o limpiar datos del navegador, se pierde el registro y la bóveda de credenciales. Haz respaldos periódicos.

## Estructura del Proyecto

```
├── src/app/                    # Angular application (Signals, Standalone, Zoneless)
│   ├── core/                   # Infraestructura (storage, bóveda de credenciales,
│   │                           #  vault cifrado, mcp.service desacoplado, Telegram worker…)
│   │   └── mcp/                # Catálogo modular mcp-catalog.ts y emulación mcp-fallbacks.ts
│   └── features/               # Feature components (10 vistas)
├── projects/core/              # @p2p/core — lógica pura framework-agnostic (23 motores)
├── packages/mcp-server/        # MCP server suite — 37 tools en 10 servidores temáticos
│   └── src/tools/              # Clasificación por dominio y arranque individual vía --server
├── electron/                   # Electron shell (main, preload, IPC, SQLite, vault DPAPI)
│   └── main/
│       ├── agents/             # Swarm de 4 Agentes: Sentinel, Strategist, Risk Gatekeeper, Dispute Auditor
│       ├── skills/             # 43 habilidades modulares (Macro, Trading, Risk, Earn, Operations)
│       └── vendor/             # Motores puros byte-idénticos para cumplir con rootDir de Electron
├── e2e/                        # Playwright E2E (web + Electron)
├── legacy/                     # Prototipos Python históricos y documentos exploratorios archivados
└── .github/workflows/ci.yml   # GitHub Actions CI
```

## CI/CD

GitHub Actions ejecuta automáticamente:

1. Tests unitarios (app + core + electron)
2. Build del bundle web
3. E2E con Playwright
4. Build del APK Android (debug)

## Licencia

Uso personal — desarrollado como herramienta de apoyo a la decisión, NO como asesor financiero. Las operaciones de arbitraje conllevan riesgo de pérdida.
