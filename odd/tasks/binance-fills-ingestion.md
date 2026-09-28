# Binance Fills & Ingestion de Órdenes P2P Reales

## Objective
Ingestar, normalizar y verificar trades/fills reales de Binance P2P (vía API C2C HMAC y parser CSV de exportación de Binance) y correlacionarlos con las decisiones registradas en `repricer_decisions`. Esto registra filas reales en `decision_outcomes` con `filledAmountUsdt`, `filledPrice`, `realizedProfitUsdt` y `realizedSpreadPct`, habilitando el cálculo verídico de `realizedCycleFigures` y permitiendo el cierre honesto (`CLOSED`) de los ciclos de decisión (`decision_cycles`).

## Problem / Why
- En la fase actual del Decision Journal (`odd/tasks/decision-journal.md`), el publicador (`mcp-ad-publisher.service.ts`) solo registra el *intento* de publicación (`filledAmountUsdt: 0`, campos realizados en `null`).
- Sin fills reales, `realizedCycleFigures` devuelve invariablemente `null`.
- En consecuencia, ningún ciclo contable puede cerrarse como `CLOSED`: la única salida honesta actual es `ABANDONED`.
- El operador necesita poder conciliar y auditar los trades que efectivamente se ejecutaron en Binance contra las decisiones que tomó el motor.

## Scope
1. **Core domain (`projects/core/src/lib/binance-fills.ts` + `.spec.ts`):**
   - Tipos de datos para órdenes C2C de Binance (`BinanceC2cOrder`, `BinanceC2cOrderStatus`, etc.).
   - Normalizador de payloads de la API Binance (`sapi/v1/c2c/orderMatch/listUserOrderHistory`).
   - Normalizador de CSV exportado desde el portal web de Binance P2P.
   - Motor puro de correlación: mapeo de fills completados (`COMPLETED`) a `repricer_decisions` por `advNo`/`adId`, lado (`BUY`/`SELL`), rango de precio y ventana temporal.
   - Cálculo del profit y spread realizado por fill y generación de `RecordOutcomeInput` con `source = 'BINANCE_MERCHANT' | 'CSV_IMPORT'`.
2. **Exportación core (`projects/core/src/public-api.ts`):**
   - Exponer tipos, normalizadores y correlacionador.
3. **Desktop IPC Bridge (`electron/`):**
   - Nuevo canal allow-listed: `p2p:fetch-binance-c2c-orders`.
   - Manejo de firma HMAC-SHA256 con API Key y Secret en el proceso principal de Electron (usando credenciales seguras).
   - Exposición tipada en `preload/api.ts` y declaración en `electron/shared/types.ts`.
4. **Servicio y UI (`src/app/core/binance-fills.service.ts` + `.spec.ts`):**
   - Coordinación de polling/sincronización bajo demanda e importación de CSV.
   - Ingesta en el `DecisionJournalService` (appendOutcome para cada fill nuevo no duplicado).

## Constraints
- **Idempotencia estricta:** `orderNumber` de Binance debe guardarse en `externalRef`. Un fill ya registrado no debe duplicarse nunca.
- **Fail-safe:** Si una orden no puede correlacionarse con una decisión automática específica (e.g. trade tomado fuera del repricer o manual), debe poder vincularse a la última decisión compatible del ciclo o registrarse con la decisión más cercana en ventana temporal.
- **Seguridad:** API keys y secrets de Binance nunca deben exponerse al renderer; se resuelven o firman en el main process.

## Checklist
- [ ] T1. Core: Tipos de dominio, normalizador de API/CSV de Binance P2P y cálculo de spread/profit realizado (`projects/core/src/lib/binance-fills.ts` + tests).
- [ ] T2. Core: Motor de correlación fills↔decisiones con deduplicación por `orderNumber` (`binance-fills.ts` + tests).
- [ ] T3. Export en `projects/core/src/public-api.ts` + sincronización vendor si aplica.
- [ ] T4. Electron: IPC channel `p2p:fetch-binance-c2c-orders` con firma HMAC y types/preload.
- [ ] T5. Frontend: `BinanceFillsService` en Angular para sincronización periódica/manual y lectura de CSV hacia `DecisionJournalService`.
- [ ] T6. Verificación integral de cierre de ciclo con figuras reales calculadas.

## Acceptance criteria
- Fills de Binance completados (`COMPLETED`) se transforman en `decision_outcomes` con volumen y precio real.
- `realizedCycleFigures(outcomes)` produce valores numéricos reales no-nulos cuando hay fills.
- Tests unitarios completos en core, electron y Angular sin regresiones.
