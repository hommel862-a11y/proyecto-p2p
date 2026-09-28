# Decision Journal: memoria de decisiones y resultados

## Objective

Cerrar la tercera capa del sistema: **verificar si se gana**. Hoy `strategy_plans` guarda `expected_net_spread_pct` y `expected_profit_usdt`, y su status puede llegar a `EXECUTED` sin registrar un solo campo de qué pasó realmente. El schema tiene expectativas sin memoria de la realidad.

Este workstream agrega un journal append-only que registra qué decidió el motor, qué vio cuando decidió, y qué pasó después.

## Problem / Why

- `McpAdPublisherService implements RepricerAdPublisher` ya existe y `enablePublishing()` lleva el repricer a modo `PUBLISHING`. **El usuario está por obtener escritura real de anuncios en Binance.**
- `ad-auto-composer` automatiza la composición de anuncios. Publicación automática + sin auditoría = operar a ciegas con plata real.
- `McpAdPublisherService.successfulPublishesCount` es un counter acumulado: pierde historia y **pierde los fallos**. Un publish fallido hoy no lo detecta nadie.
- Sin historial no se puede responder "¿estoy ganando?", "¿cuántas decisiones son verificables?" ni "¿decido con datos viejos?".

## Why now

El publisher y el compositor automáticos ya están en vuelo (snapshot `44e686d`). El journal es lo que convierte publicación automática en operación medible. Cada día sin journal es un día de publicación sin auditoría.

## Decisiones tomadas (locked)

1. **Payload crudo de `adv/search`: NO.** Se guarda un **snapshot normalizado** con los derivados que OBI necesita, para recalcular sin guardar ~40 KB de JSON por fila.
2. **Retención:** `market_snapshots`, `repricer_decisions`, `decision_outcomes` y `decision_cycles` **para siempre**. Solo `market_snapshots` es podable, a 90 días. Precedente: `audit_logs` ya declara retención ilimitada.
3. **`cycle_id` explícito:** SÍ, con tabla `decision_cycles`. El operador P2P piensa en ciclos cerrados, no en spreads sueltos.
4. **Origen explícito:** AMBOS. `origin CHECK IN ('OPERATOR','AUTO_ENGINE','MCP_AGENT','STRATEGY_PLAN')`. Con automatización en vuelo, distinguir decisión humana de automática es obligatorio.

**Decisión adicional (FK):** `account_id` y `plan_id` son **soft references** (TEXT indexado, SIN constraint FK). Las entidades viven en core y su persistencia SQLite todavía se está cableando; un FK duro sobre entidades no persistidas rechazaría inserts válidos. `cycle_id`, `decision_id` y `snapshot_id` sí llevan FK duro porque sus tablas son nuevas y siempre del mismo schema.

## Schema (append-only)

Cinco objetos nuevos en `electron/main/db/schema.sql`, en el estilo del archivo (`IF NOT EXISTS`, `idx_<tabla>_<col>`, `CHECK` en enums, `INTEGER` epoch):

1. **`market_snapshots`** — observación normalizada del libro. `obi`, `bid_usd`, `ask_usd`, `n_bids`, `n_asks`, `stale`, `fetched_at`. Única tabla podable (90 días).
2. **`decision_cycles`** — ciclo contable. `status IN ('OPEN','CLOSED','ABANDONED')`, capital reservado, profit realizado, `close_reason`.
3. **`repricer_decisions`** — la decisión + el mercado que vio. `side`, `decision_price`, `origin`, `execution_mode`, `snapshot_id`, contexto observado denormalizado, `account_id`/`plan_id` soft.
4. **`decision_outcomes`** — resultado realizado, **1:N por decisión** (un fill parcial es otra fila, nunca un UPDATE). `source IN ('LOCAL_SIGNAL','BINANCE_MERCHANT','CSV_IMPORT','MANUAL')`.
5. **`decision_performance`** — VIEW read model que hace el LEFT JOIN decisiones↔outcomes.

**Ninguna tabla es mutable salvo `decision_cycles`** (que cambia de estado mientras el ciclo está abierto). Decisiones y outcomes son append-only puro: un journal que se actualiza pierde la propiedad que lo hace honesto.

## Reparto sin solapamiento

| Tabla | Responde |
|---|---|
| `strategy_plans` | qué se **planea** hacer |
| `repricer_decisions` | qué decidió el motor, y **qué vio** |
| `decision_outcomes` | qué pasó **después** |
| `operation_records` | qué movimientos de banco se hicieron |

## Scope

- `projects/core/src/lib/decision-journal.ts` + `.spec.ts` — tipos de dominio puros.
- `projects/core/src/lib/decision-journal-repository.ts` + `.spec.ts` — puerto + `InMemoryDecisionJournalRepository`, siguiendo el patrón de `accounts-repository.ts` (port + InMemory + WebStorage).
- `projects/core/src/public-api.ts` — export (solo F1 edita este archivo).
- `electron/main/db/schema.sql` — 5 objetos.
- `electron/main/db/*` — adaptador SQLite.
- `src/app/core/binance-repricer.service.ts` — instrumentar decisiones + consumir OBI.
- `src/app/core/mcp-ad-publisher.service.ts` — feed de outcomes (éxito **y** fallo).
- `src/app/core/telegram-worker.service.ts` + core formatter — métrica de verificación en el panel.

## Constraints

- **Honestidad, no negociable:** el journal registra `execution_mode` real. Nunca infiere publicación desde un counter. Un publish fallido se registra como outcome fallido, no se pierde.
- **Consumir OBI, no reimplementarlo:** `calculateOrderBookImbalance` ya existe en `projects/core/src/lib/orderbook-imbalance.ts`. El journal guarda su salida; no recalcula.
- **Core puro:** sin Angular, sin fetch, sin SQLite. El puerto va en `projects/core`; los adapters, en electron.
- **No tocar** `publish_ad_price.ts`, `toggle_ad_status.ts`, `ad-auto-composer.ts` ni `bracket-scanner.ts`: son trabajo concurrente ya committeado.
- MarkdownV2 en todo texto de Telegram. `escapeMarkdownV2` en todo valor dinámico.
- Work-unit commits Conventional Commit. **Sin push.**

## Out of scope

- Importador de CSV (el journal nativo lo vuelve innecesario por ahora).
- Alertas de precio (siguiente workstream, no bloqueado por este).
- Modificar el publisher para que escriba al journal: se integra por puerto, no se invasoriza.
- Cualquier feature de `Skalix`.

## Fases y topología

| Fase | Qué | Agentes | Depende |
|---|---|---|---|
| F1 | Contrato en core: tipos + puerto + InMemory + export | **1, secuencial** | — |
| F2a | `schema.sql` + adaptador SQLite | 1 | F1 |
| F2b | Instrumentar repricer + consumir OBI | 1 | F1 |
| F2c | Outcome feed desde el publisher | 1 | F1 |
| F3 | Read model + self-audit + tests de integración | 1 | F2 |
| F4 | Métrica de verificación en panel Telegram | 1 | F3 |

**F1 va sola y primero a propósito:** es el contrato. Lanzar F2a/b/c en paralelo sin el contrato cerrado es la causa de que los tres inventen tipos distintos.

## Checklist

- [ ] T1 (F1). Tipos de dominio + `DecisionJournalRepository` + `InMemoryDecisionJournalRepository` + export en `public-api.ts`.
- [ ] T2 (F2a). 5 objetos en `schema.sql` + adaptador SQLite + spec.
- [ ] T3 (F2b). Repricer escribe `market_snapshots` + `repricer_decisions`; consume `calculateOrderBookImbalance`.
- [ ] T4 (F2c). Publisher escribe `decision_outcomes` en éxito **y** en fallo.
- [ ] T5 (F3). Read model + 3 self-audit queries + tests de integración.
- [ ] T6 (F4). Métrica de verificación en el panel Telegram + `/status`.

## Acceptance criteria

- Una decisión con `execution_mode='PUBLISHING'` y un outcome fallido queda registrada como fallida. Nada se pierde en silencio.
- Se puede responder, con query: median modeled vs realized spread por lado; ratio de decisiones verificables; % de decisiones con `observed_stale=1`.
- `origin` permite separar winrate humano de automático.
- Un ciclo abierto acumula decisiones; al cerrarse, `realized_profit_usdt` y `realized_spread_pct` reflejan sus outcomes.
- Core sigue sin Angular ni SQLite.
- Suite verde, `tsc --noEmit` limpio, `ng build` AOT verde.

## TDD

- **Modo: no configurado explicitamente.** Runner: `npx ng test` / `npx ng build`.
- El puerto de core se testea con el `InMemory` adapter: es barato, rápido y verifica el contrato antes de que exista SQLite.

## Delivery

- **Forecast**: ~600-800 authored changed lines. **Excede el presupuesto de ~400**: dos work units, no uno.
- **Estrategia**: 2 work-unit commits (F1+F2 y F3+F4). Push y PR son decisiones del usuario.

## Route

Delegado directo ODD (no SDD). Un agente por fase, 3 en paralelo en F2.

## Verification evidence

Pendiente.
