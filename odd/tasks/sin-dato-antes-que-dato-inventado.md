# Sin dato antes que dato inventado

## Objective

Un sistema que razona sobre el mercado no puede devolver un número de mercado que no midió. Este documento registra un incidente de esa clase, el arreglo, y —lo más importante— **el patrón systemic que queda vivo** y que este cambio no cubre.

La regla que queda: **la ausencia se propaga como ausencia**. Un `null` declarado es información. Un default inventado es una orden de trading disfrazada de dato.

## El incidente

Con el daemon MCP caído, `simulateMcpTool` respondía tasas:

| Herramienta | Default inventado | Tasa real observada | Error |
| --- | --- | --- | --- |
| `get_bcv_rates` | `72.45` | `857.8876` | **−91.5%** |
| `get_parallel_rates` | `84.12` | `958.580188` | **−91.2%** |
| brecha implícita | `+16.11%` | `+11.74%` | clasificación distinta |

Un operador —o un LMC— lee "72.45 BCV / 84.12 paralelo" y entiende que hay una brecha de 16.11%. **La brecha no existía.**

Y no eran defaults tolerables ni redondeos: los defaults estaban **más de 10× lejos** del mercado real. No describían un mercado con un error de redondeo; describían un mercado que no existe. Para un sistema que calcula "comprar barato, vender caro", eso no es un default, es una **oportunidad de entrada falsa**.

El mismo archivo emitía `51.3` como `copPerVes` (COP/VES), que es exactamente `4250 / 82.85` redondeado — un número derivado de otro default inventado, y de paso la razón matemática por la que la app "veía" 51.3.

## Causa raíz: no había un contrato de lectura

No era un typo. Era una decisión de diseño ausente. El patrón era:

```ts
const bcv = Number((args as any)?.bcvRate ?? 72.45);
```

Ese `?? 72.45` es la frase "`bcv` es obligatorio". El autor no pretendía inventar: pretendía que el caso "viene vacío" no rompiera el cálculo. El resultado es que el caso "no sé" se volvió indistinguible del caso "vale 72.45", y el sistema eligió responder lo peor posible: adivinar.

La pieza que faltaba no era un default mejor. Era un **tipo que representa la ausencia**:

```ts
export interface MarketRateReading {
  readonly value: number | null;
  readonly reason: string | null;      // por qué no hay valor
  readonly expectedSource: string;     // de dónde habría salido
}
```

Con ese tipo, "no sé" ya no es un número, así que no puede filtrarse al cálculo por accidente.

## Reglas que se aplican

1. **Una tasa de nivel nunca es `0`.** Si llega `0`, no es una tasa: es un dato corrupto. Se degrada a ausencia.
2. **Un delta sí puede ser `0`.** Una brecha medida de `0.00%` (paralelo exactamente en el oficial) es un dato legítimo, y es justamente el caso que el operador necesita distinguir de "no sé". Aplicar la regla 1 a deltas destruye el único caso en que se puede afirmar que no hay brecha.
   - Esta distinción la detectó una prueba, no la revisión: el guard `> 0` que protegía a los niveles estaba degradando la brecha real de 0 a `null`.
3. **La ausencia se declara una sola vez y en un lugar.** `rateStatus`, `unavailableReason`, `expectedSource`, `actionable: false`. El `actionable: false` es lo que impide que un LMC ejecute un plan de trading que nadie midió.
4. **La ausencia se declara SOLO cuando hay ausencia.** Declarar `UNAVAILABLE_NO_LIVE_SOURCE` incondicionalmente es el error espejo: el LMC descarta una tasa real porque el envelope dice "no hay dato". Una prueba lo detectó.
5. **Un campo derivado de un dato ausente también va ausente.** `copPerVes` sin `copPerUsdt` real no es `51.3`: es desconocido.
6. **Un tramo sin tasa no se reescribe.** `ExchangeLeg.price` es `number` y no puede representar "no hay dato". Escribir `null` rompe la matemática del arbitraje; escribir un default publica un precio. La respuesta correcta es no tocar el tramo y que conserve el valor declarado del preset, que al menos no se viste de "en vivo".
7. **Una prueba que verifica "devuelve un número" no sirve.** Sirven dos: que sin dato el campo sea `null`, y que **con el dato real** valga el número real. La segunda es la que impide "arreglar" el bug apagando la herramienta entera.

## Herramientas corregidas

`forecast_volatility_window`, `calculate_delta_neutral_hedge`, `get_bcv_rates`, `get_parallel_rates`, `calculate_rate_gap`, `autofill_trade_reference`, `recommend_competitive_pricing`, `get_binance_p2p_orderbook`, `stress_test_portfolio`, `rebalance_capital_allocation`, `project_compound_runway`.

`get_binance_p2p_orderbook` merece nota aparte: un **libro de órdenes inventado no es contexto, es la afirmación** "estas son las ofertas del mercado ahora". Y `recommend_competitive_pricing` compite contra ese libro. Era el peor caso de la familia, y por eso se corrigió aunque no estuviera en el alcance original.

## Verificación

Todo ejecutado, sin red:

| Comando | Resultado |
| --- | --- |
| `npx tsc --noEmit` | exit `0` — **pero es un no-op**: el tsconfig raíz tiene `"files": []` |
| `npx tsc -p tsconfig.app.json --noEmit` | exit `0` |
| `npx tsc -p tsconfig.spec.json --noEmit` | exit `0` |
| `triangulation-intelligence.service.spec.ts` | **18/18** |
| `mcp-fallbacks.spec.ts` | **28/28** |
| `cotizave.service.spec.ts` (no tocado) | **32/32** |
| `spread-monitor.spec.ts` (no tocado) | **23/23** |

El `tsc` raíz da verde sobre cualquier cosa: no compila nada. Un type-check que no puede fallar no es evidencia. Los dos `-p` son los que importan.

## Hallazgo pendiente: el patrón sigue vivo en `agent-skills.ts`

`projects/core/src/lib/agent-skills.ts` (3.360 líneas) tiene **el mismo defecto, y peor**, porque usa `||` en vez de `??` — un `?? <número>` no lo encuentra ni un grep.

Además `||` tiene un segundo defecto: `Number(args['x'] || 85.0)` reemplaza un `0` legítimo por `85.0`, así que ni siquiera distingue "no vino" de "vino cero".

Tasas de mercado inventadas detectadas (**solo lectura, sin modificar**):

| Línea | Variable | Default |
| --- | --- | --- |
| 1767 | `currentParallelRate` | `1` |
| 1926 | `midPrice` | `85.0` |
| 1971 | `currentMidPrice` | `85.0` |
| 2042 | `spotParallelRate` | `85.0` |
| 2064 | `currentFundingRate8hPct` | `0.01` |
| 2143 | `myCurrentPrice` | `85.0` |
| 2188 / 2189 | `currentSpotPrice` / `strikePrice` | `65000` / `68000` |
| 2250 | `estimatedTokenListingPriceUsdt` | `2.0` |
| 2328 | `bnbPriceUsdt` | `600` |
| 2446 | `currentParallelRate` | `85.0` |
| 2469 | `currentBcvGapPct` | `20.0` |
| 2489 | `ourCurrentPrice` | `85.0` |
| 2637 | `exchangeRate` | `85.0` |
| 2793 | `vesRatePerUsd` | `85.0` |
| 2816 | `baseMarketRate` | `85.0` |
| 2848 | `deskRatePerUsd` | `87.0` |
| 2872 | `bcvOfficialRate` | `80.0` |
| 2873 | `parallelMarketRate` | `85.0` |
| 2941 | `midPrice` | `85.0` |
| 3008 | `currentPrice` | `85.0` |
| 3110 | `activeRate` | `85.0` |

`85.0` contra un paralelo real de `958.58` es un error de **11.3×**. `bcvOfficialRate = 80.0` contra `857.8876` es **10.7×**.

En `mcp-fallbacks.ts` quedan 13 sitios del mismo patrón fuera del alcance original. El más grave es `calculate_spread`, líneas 112–113:

```ts
const buyPrice  = Number((args as any)?.buyPrice  ?? 78.5);
const sellPrice = Number((args as any)?.sellPrice ?? 79.8);
```

Eso fabrica un spread de **+1.65%** y devuelve `isGoldenSpread: true` con `recommendation: 'VIABLE_INSTITUCIONAL'`. Un veredicto de viabilidad institucional sobre precios que nadie cotizó.

**Esto no se corrigió porque estaba fuera del alcance pedido. Queda escrito para que sea una decisión, no un olvido.**

## Lo que este cambio NO arregla

- Los 24 defaults de `agent-skills.ts` y los 13 de `mcp-fallbacks.ts`.
- `cotizave.service.ts` y la normalización de claves viven en `projects/core/src/lib/cotizave.ts`, fuera de este cambio.
- El patrón puede reaparecer: la defensa es la convención (`readMarketRate` + `rateUnavailableFields`) y una revisión que busque `\|\|` y `??` sobre variables de tasa, no solo `??`.
- Un default "razonable" (digamos 950) seguiría mintiendo. **Las pruebas deben usar tasas reales**, o no están probando nada.
