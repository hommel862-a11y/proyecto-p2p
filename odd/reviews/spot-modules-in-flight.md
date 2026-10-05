# Revisión: módulos financieros en vuelo (sin commitear)

Revisión de solo lectura sobre 9 módulos nuevos en `projects/core/src/lib/`, 10 herramientas MCP en
`packages/mcp-server/src/tools/`, los cambios en `src/app/core/mcp/mcp-fallbacks.ts` y
`projects/core/src/lib/agent-skills.ts`. No se modificó ninguna línea.

## Lo que está bien

- **Cero I/O en los 9 módulos core.** Sin `fetch`, `axios`, WebSocket, HMAC, `api/v3/order`,
  `asset/transfer`, `withdraw` ni `clientOrderId`. Son funciones puras, no tocan dinero real.
- **El boundary está limpio.** Ningún módulo nuevo importa desde `src/app` ni `electron`. Core sigue
  siendo core.

## 1. `synthetic-stable-arbitrage.ts` duplica `triangular-arbitrage.ts` con menos capacidad

`triangular-arbitrage.ts` ya existe commiteado, con 580 líneas. El módulo nuevo tiene 131.

Lo que el commiteado ya tiene y el nuevo no:

| Capacidad | `triangular-arbitrage.ts` | `synthetic-stable-arbitrage.ts` |
| --- | --- | --- |
| Slippage guard | `evaluateTriangularSlippageRisk` | ausente |
| Fricción bancaria | `bankingFeePct`, `bankingFixedFee` | ausente |
| Riesgo | `LOW` a `CRITICAL` | booleano |
| Fee P2P | por leg | `0.1` hardcodeado (línea 52) |
| Capital | por config | default `1000` (línea 50) |
| Base | profundidad / notional | precios mid |

Además calcula sobre precios mid, sin profundidad de libro, así que el spread que reporta no es
ejecutable.

**Pedido:** eliminar el módulo nuevo y extender el existente, o justificar por qué la duplicación
existe. Si la razón es una forma de entrada distinta, que sea un adaptador sobre
`calculateTriangularArbitrage`, no una segunda implementación.

## 2. `mcp-fallbacks.ts` fabrica resultados financieros

Este es el punto más serio. Los fallbacks emiten veredictos financieros con datos inventados:

```ts
// línea 629, verify_inbound_transfer
const ref = String((args as any)?.referenceNumber ?? '984721');
  status: 'MATCH_FOUND_VERIFIED',
  senderCedulaValidated: true,
  senderPhoneValidated: true,
  recommendation: 'SAFE_TO_RELEASE_CRYPTO',
```

Una verificación bancaria que no ocurrió, recomendando liberar cripto. Y:

```ts
// línea 580, fetch_cross_exchange_spread
spreadPct: 2.02, 2.73, 1.51, 3.35,
isViable: true,
estimatedProfitPer1000Usdt: 33.5,
```

Otros del mismo tipo: `verdict: 'SAFE_TO_EXECUTE'` (línea 103), `recommendation: 'APPROVE_TRANSFER'`
(562), `privacyGuaranteed: true` (117), `netProfitUsdt: trade.netProfitUsdt ?? 1.5` (532),
`spreadsheetId: '1p2p_Ledger_Master_Spreadsheet'` (520), `currentSpread: 1.25` hardcodeado en
`evaluate_trade_risk` (65).

El envelope lleva `simulated: true`, lo cual ayuda, pero los campos internos están fabricados y las
directivas (`SAFE_TO_RELEASE_CRYPTO`, `APPROVE_TRANSFER`) son lo que un agente ejecutor actúa.

`agent-skills.ts` expone todo esto como Function Calling de Gemini, o sea que lo fabricado entra
directo como instrucción al modelo.

**Pedido:** cuando no hay dato, devolver ausencia. El repo ya tiene el patrón en
`JournalAvailability { degraded, reason }` con la causa en la capa de datos
(`IN_MEMORY_JOURNAL_REASON`) y la declaración en la capa de presentación. Ningún fallback debería
emitir `isViable`, `SAFE_TO_*` ni `APPROVE_*` sin evidencia.

## 3. Ausencia asumida como cero, en el término que más infla el resultado

```ts
otc-darkpool-aggregator.ts:78   transferOrCashFrictionPct ?? 0
otc-darkpool-aggregator.ts:77   takerFeePct ?? 0.1
orderbook-sniper.ts:58          maxTakerFeePct ?? 0.1
synthetic-stable-arbitrage.ts:51  spotFeePct ?? 0
```

La primera es la grave: fricción de transferencia desconocida asumida en cero, dentro de un módulo
cuyo propósito es calcular arbitraje. El edge se infla justo con el término que falta.

**Pedido:** que la ausencia de un término de fricción vuelva el resultado no accionable, no cero.

## 4. Bug en el arbitrage cross-exchange del fallback

```ts
// líneas 619-620
buyOn: 'KuCoin P2P',
sellOn: 'KuCoin P2P',
```

Comprar y vender en el mismo venue no es arbitraje cross-exchange. La ruta se genera con
`venues[i]` y `venues[j]` (líneas 65-66), pero el resultado del fallback está escrito a mano y no
pasa por esa lógica.

## 5. Constantes de mercado escritas como inteligencia

```ts
macro-bcv-intelligence.ts:48-49
const isInterventionDay = input.currentDayOfWeek === 1 || input.currentDayOfWeek === 4; // Lunes o Jueves
const isInterventionHour = input.currentHourOfDayUtcMinus4 >= 9 && input.currentHourOfDayUtcMinus4 <= 13;

smart-treasury-yield.ts:45
const apy = params.flexibleApyPct && params.flexibleApyPct > 0 ? params.flexibleApyPct : 10.5;
```

El calendario de intervención del BCV y un APY del 10,5% están fijos en el código, no vienen de una
fuente.

**Pedido:** que estos valores vengan de input o de una fuente con procedencia, igual que el feed P2P
(`LIVE` / `CACHE` con `liveFetchedAt`).

## Lo que falta y sigue siendo el trabajo real

No hay ningún feed de Spot en la capa app. De 65 servicios en `src/app/core/`, ninguno tiene spot,
orderbook o depth en el nombre. Y no existe un tipo genérico de disponibilidad de fuente de datos:
`JournalAvailability` solo cubre la persistencia del journal.

Sin fuente real, la capa de cálculo no tiene entrada. Y con la fricción asumida en cero, produce
números que parecen accionables y no lo son.

## Orden sugerido

1. Poner `mcp-fallbacks.ts` en modo ausencia en vez de fabricar veredictos. Es lo único que está
   conectado a un LLM.
2. Corregir el `buyOn` / `sellOn` del mismo venue.
3. Resolver la fricción desconocida (debe bloquear, no asumir cero).
4. Decidir duplicado vs extensión en `triangular-arbitrage.ts`.
5. Mover las constantes de mercado a input o fuente con procedencia.
6. Después, y no antes, el feed de Spot con su tipo de disponibilidad.
