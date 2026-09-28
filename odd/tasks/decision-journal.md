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

- [x] T1 (F1). Tipos de dominio + `DecisionJournalRepository` + `InMemoryDecisionJournalRepository` + export en `public-api.ts`. → `b81a8fd`
- [x] T2 (F2a). 5 objetos en `schema.sql` + adaptador SQLite + spec. → `9be69ee`
- [x] T3 (F2b). Repricer escribe `market_snapshots` + `repricer_decisions`; consume `calculateOrderBookImbalance`. → `fdb3579`, corregido en `33133e6`
- [x] T4 (F2c). Publisher escribe `decision_outcomes` en éxito **y** en fallo. → `8266cd3`
- [x] T5 (F3). Read model + 3 self-audit queries + tests de integración. → `be759ed`, corrección de agregación en `fcd701e`
- [x] T6 (F4). Métrica de verificación en el panel Telegram + `/status`. → `57165f1`

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

Delegado directo ODD (no SDD). Un agente por fase. **F2 quedó en 2, no en 3:** la correlación decisión→publicación atraviesa el puerto, el repricer y el publisher, así que F2c se serializó detrás de F2b. Paralelismo declarado donde la dependencia es real, no donde es nominal.

## Verification evidence

**Spot check del orquestador (corrido por mí, no reportado):**

| Gate | Resultado |
|---|---|
| `cd electron && npx vitest run` | **177/177 passed**, exit 0 |
| `npx ng test core` | 691 passed / 1 failed — el fallo es `pdf-invoice-generator.spec.ts` (cross-realm `instanceof` bajo Node 25), **preexistente** |
| `git status` | 0 archivos sucios, 12 commits ahead de origin, sin push |

**Resultado por tarea:**

- [x] T1 (F1). `b81a8fd` — tipos, puerto, InMemory, export. 38 tests nuevos. `tsc` core exit 0.
- [x] T2 (F2a). `9be69ee` — 5 objetos en `schema.sql`, adapter SQLite, IPC/preload, facade Angular. Electron 168/168.
- [x] T3 (F2b). `fdb3579` + `33133e6` — snapshots, decisiones, consumo de OBI, `execution_mode` real. El fix de ciclo fue un work unit aparte porque `fdb3579` solo no auditaba nada.
- [x] T4 (F2c). `8266cd3` — todo intento de publicación escribe outcome, exitoso o fallido. 6 mutaciones, cada una detectada.
- [x] T5 (F3). `be759ed` — cierre de ciclo con figuras calculadas, self-audit, integración SQLite real. Electron 177/177.
- [x] T6 (F4). `57165f1` — métrica de auditoría en el panel Telegram. Core +12 tests, p2p +6, cero regresiones.

**Correcciones de diseño aplicadas durante la ejecución:**

- **Sin columnas `asset`/`fiat`** en las tablas del journal: el contrato de core es single-market y el puerto no tiene esos campos.
- **`decision_cycles` es la única tabla mutable.** Decisiones y outcomes son append-only, sin update ni delete en el puerto.
- **`realizedSpreadPct` cae a media simple** cuando todos los outcomes que reportan llenaron nocional 0, y es `null` cuando ninguno reporta. El InMemory devolvía 0: un journal que reportaba 0% de spread realizado sobre trades que decían 1.0% y 2.0%.
- **`filledAmountUsdt: 0` con los tres campos realizados omitidos** en un publish. Un publish no es un fill.

**Dos fallos de producción que la suite en verde no detectaba:**

1. `cycleId: 'PENDING_CYCLE_TRACKING'` contra la FK dura: el journal no registraba **ninguna** decisión del motor. El spec usaba un `FakeDecisionJournal` que aceptaba cualquier `cycleId`, así que verificaba la secuencia de llamadas, no su validez. Resuelto con `resolveJournalCycle()`: lookup `OPEN`, reutilizar o abrir, cachear.
2. La divergencia de agregación entre core y el adapter SQLite, fijada por un test "KNOWN DIVERGENCE" que mantenía la suite verde con el bug vivo. Resuelto, y el test ahora afirma paridad.

## Known gaps — no resueltos por diseño, no por olvido

- **No hay registro de fills realizados.** El publisher registra el *intento* de publicación con `filledAmountUsdt: 0`. Mientras tanto `realizedCycleFigures` devuelve `null` y **todos los ciclos son incerrables**: `ABANDONED` es la única salida honesta. Cerrar con ceros afirmaría un break-even que nadie midió. La verificación de fills de Binance es el próximo workstream y sin ella el journal audita intención, no resultado.
- **`verifiedDecisions` significa "tiene al menos un intento registrado"**, no "tiene un trade real". Rotulado en el panel y protegido por un test que falla si el wording deriva.
- **El ciclo se resuelve con `listCycles` en cada arranque**, cacheado solo en memoria. Aceptable; un restart vuelve a preguntar.
- `capitalReservedUsdt: 0` es verdad técnica: el motor cotiza, no modela capital. El operador lo concilia al cerrar.
- `account_id` y `plan_id` son soft references sin FK. Las entidades viven en core y su persistencia SQLite todavía no está cableada; un FK duro rechazaría inserts válidos.

## Repo debt tocado por este workstream

- `projects/core/src/lib/ad-auto-composer.spec.ts:7` importaba `BinanceP2pMarketDepth` de `./repricer.js`, que solo lo importa. Era el único archivo del repo con ese path y dejaba `ng test core` rojo. Arreglado en `808f67b`.
- `electron/main/db/decision-journal.repository.ts` arrastraba un comentario que afirmaba una divergencia ya corregida. Eliminado en `84ea6e5`.

## Deuda preexistente, NO resuelta

- `npx ng test p2p`: **22 fallos**, y el conjunto incluye un flap cross-file de `TestBed` que cae en un archivo distinto cada corrida. Verificado en árbol limpio: es preexistente. `ng test p2p` no es una señal confiable hasta que se aísle el `TestBed` por archivo. Workstream aparte.
- `pdf-invoice-generator.spec.ts`: `instanceof Uint8Array` cross-realm bajo Node 25. Los bytes son correctos (`%PDF`).
- `ElectronAPI.copilot` está stale: faltan `transcribeAudio`, `runMonteCarlo` y 8 más.
- `electron/tsconfig.json` incluye solo `main/**` y `shared/**`: **`preload/` nunca se typechequea.** Un `tsc` de electron en verde no dice nada de los specs.
- `ng lint` cubre solo el proyecto `p2p`. Electron y `projects/core` no tienen lint en la práctica.
- No hay rama base en el remoto: la feature branch es el trunk de facto.
- `gentle-ai review assess` no es ejecutable: RAR rechaza el path por tipo de filesystem no local. RDD está `off`.
