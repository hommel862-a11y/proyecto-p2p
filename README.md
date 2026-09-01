# P2P Decisor — Herramienta de Decisión para Arbitraje P2P en Venezuela

Herramienta de apoyo a la decisión para operaciones de arbitraje P2P en Binance, diseñada para el contexto venezolano. Opera **100% en modo manual**, sin conexión a APIs de exchange — el usuario ingresa las cotizaciones y la herramienta calcula spread, ingresos, riesgo y estadísticas.

## Características

| Módulo | Función |
|--------|---------|
| **Monitor de Spread** | Analiza spread de compra→venta USDT/VES, calcula ganancia neta después de comisión, alerta nativa cuando el spread es favorable |
| **Calculadora de Ingresos** | Convierte un objetivo de ingreso diario en USD a capital requerido, con tabla de disciplina por APR |
| **Registro de Operaciones** | Ledger CRUD de operaciones buy/sell con PnL, exposición, racha de errores, exportación CSV y respaldo JSON |
| **Reglas de Riesgo** | 6 barreras de seguridad configurables (spread mínimo, operaciones máximas, límites de pérdida, etc.) con veredicto en vivo |
| **Estadísticas** | Agregación por día/mes/trimestre (UTC), filtrable por par, con métricas de volumen y fees |
| **Guía de Uso** | Documentación de cada módulo + consejos de disciplina y rentabilidad |

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

### Stack

- **Angular 22** — Zoneless, signals, standalone components, lazy loading
- **TypeScript 6** — OnPush change detection, computed signals
- **Vitest** — Unit tests (99 tests pasando)
- **Playwright** — E2E (web + Electron)
- **Capacitor 8** — Android (notificaciones nativas)
- **Electron 44** — Desktop (contextIsolation, sandbox, IPC estrecho)
- **SCSS** — Variables CSS con temas dark/light

## Inicio Rápido

### Requisitos

- Node.js 22+
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
npm test                    # Angular app
npm run test:electron       # Electron shell

# E2E
npm run e2e                 # Web (Playwright)
npm run e2e:electron        # Electron (requiere build previo)
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

### Tests

```bash
# Todos los tests (app + core + electron)
npx ng test p2p --no-watch
npx ng test core --no-watch
npm run test:electron
```

## Seguridad

- **Electron:** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
- **IPC:** Solo un canal (`app:get-version`), API fail-closed validada por tests
- **Persistencia:** localStorage con degradación a MemoryStorage en entornos restringidos
- **Sin secrets:** No hay claves de API — la herramienta opera en modo manual

## Respaldo de Datos

El registro de operaciones se almacena en `localStorage`. Para evitar pérdida:

1. **Exportar:** Botón "Exportar respaldo" en Registro de Operaciones → descarga JSON
2. **Importar:** Botón "Importar respaldo" → carga y valida el archivo JSON
3. **CSV:** Botón "Exportar CSV" → descarga para análisis en Excel/hojas de cálculo

> ⚠️ **Importante:** Al desinstalar la app o limpiar datos del navegador, se pierde el registro. Haz respaldos periódicos.

## Estructura del Proyecto

```
├── src/app/                    # Angular application
│   ├── core/                   # Infrastructure (storage, format pipes, rules service)
│   └── features/               # Feature components (6 módulos)
├── projects/core/              # @p2p/core — lógica pura framework-agnostic
├── electron/                   # Electron shell (main, preload, IPC)
├── e2e/                        # Playwright E2E tests
├── anty/                       # Prototipos Python (exploración histórica, no integrados)
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
