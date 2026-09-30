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

---

# Segunda vuelta: precios, libro y anuncios

El inventario de arriba señalaba 13 sitios del mismo patrón en `mcp-fallbacks.ts` y
dejaba el más grave, `calculate_spread`, sin tocar. Esta vuelta cierra los 13 y
encuentra que el problema era bastante más amplio de lo que decía el conteo.

## Por qué faltaban 13 y eran 17

El conteo inicial venía de un grep de defaults de **tasa**. Las herramientas que
fabrican **precios, profundidades de libro, quotes de venues y anuncios** no
aparecían, porque sus defaults no se llamaban `bcvRate`. El barrido se repitió por
categoría de lectura, y por eso el alcance real fue 17 herramientas y no 13:

| Categoría de lectura | Herramientas |
| --- | --- |
| Precios de mercado | `calculate_spread`, `detect_usdt_depeg` |
| Profundidad de libro | `forecast_volatility_window`, `analyze_orderbook_pressure`, `recommend_competitive_pricing` |
| Quotes de venues | `fetch_cross_exchange_spread`, `scan_synthetic_stable_arbitrage`, `audit_distressed_liquidity_sniper`, `query_otc_darkpool_spread` |
| Anuncios P2P | `evaluate_ad_repricing`, `publish_ad_price`, `audit_ad_competitiveness` |
| Liquidación y contraparte | `route_fintech_payroll_settlement`, `recommend_counterparty_yield_price` |
| Texto al cliente | `process_concierge_inquiry` |
| Clasificación macro | `predict_bcv_macro_regime` |
| Ledger | `add_operation_entry` |

## Los tres casos que cambian el criterio

**1. Publicar un precio inventado no es un default: es una escritura confirmada.**
`publish_ad_price` con `dryRun: false` devolvía `status: 'PUBLISHED_LIVE'` desde el
navegador. No había publicación, pero la respuesta afirmaba que la había, y el
`adId` que inventaba (`'AD-1001'`) no es un default inocuo: es el identificador de
un anuncio real. El default `newPrice: 78.85` además entraba al recibo firmado. Ahora
`newPrice` es obligatorio (como en `PublishAdPriceInputSchema`), y **con** precio
la respuesta sigue siendo `SIMULATED_SUCCESS` / `merchantConfirmed: false`. La
función no publica en el exchange; no debe decirlo nunca.

**2. El concierge era el peor caso de la familia.** `process_concierge_inquiry` no
inventaba un número en un panel: lo metía **dentro del texto que se le mandaba al
cliente**. Con `deskRatePerUsd` ausente respondía "USD/VES Exchange Rate: 87.00
VES" a una persona. Un default inventado que llega al usuario final no es un
problema de datos, es un problema de confianza con el usuario. Ahora, sin tasa, no
se redacta respuesta: se devuelve el inquiry parseado para que un operador lo
conteste.

**3. Defaults de contrato ≠ supuestos.** La revisión contra los schemas encontró
dos defaults del bloque que contradecían el contrato real:

| Campo | Default del fallback | Default del schema | Efecto |
| --- | --- | --- | --- |
| `evaluate_ad_repricing.targetRank` | `TOP_1` | `TOP_2` | Apuntaba al líder cuando el daemon iba a apuntar al segundo: dos filas de distancia entre el precio simulado y el que se publicaría. |
| `route_fintech_payroll_settlement.clientTier` | `RECURRENT_REMOTE` | `STANDARD` | Comisión de mesa distinta a la del bridge. |
| `route_fintech_payroll_settlement.isVerifiedContractor` | `true` | `false` | **Apagaba la clasificación de riesgo.** Una nómina de 10.000 USDT de un contratista sin verificar salía `chargebackRiskTier: 'LOW'`, `holdHoursRequired: 0` y el texto *"Liquidación Inmediata: Sí (Fondos Verificados)"*. |

El tercero es el peor default de todo este trabajo, y no era una tasa: era una
afirmación de cumplimiento. **Fabricar una verificación KYC no es un default, es
una mentira con consecuencias regulatorias.**

La regla que sale de acá: cuando el schema declara un default, se copia el del
schema; cuando no lo declara, el campo es obligatorio y la ausencia se declara. Un
supuesto propio donde hay contrato es un default disfrazado de decisión.

## Qué se replica del daemon y qué no

`evaluate_ad_repricing` ahora replica los circuit breakers del daemon
(`accountSaturationPct >= 100` → `PAUSE_AD`, `bcvInterventionActive` →
`HOLD_OR_WIDEN`) y el filtro anti-spoofing, para que la simulación sea la misma
decisión que ejecutaría el bridge y no una tercera versión inventada.

Con una salvedad deliberada: **`accountSaturationPct` se devuelve en `null` cuando
el llamante no lo informa.** El estado de saturación de una cuenta bancaria y el
estado de una intervención del BCV son hechos externos; el fallback no puede
observarlos. Replicar el default del schema es necesario para no divergir de la
decisión del bridge, pero **reportar `0%` de saturación sería afirmar un hecho que
nadie midió**. La divergencia se acepta a propósito en una sola dirección: el
fallback puede subestimar un freno, nunca anunciarlo.

## El error espejo de esta vuelta: ausencia parcial

La primera vuelta documenta `rateStatus: 'UNAVAILABLE_NO_LIVE_SOURCE'` para
ausencia total. El barrido de precios reveló el caso contrario: respuestas
que **sí** traen lecturas reales y aun así no pueden afirmar un campo derivado.

`forecast_volatility_window` con las dos tasas reales pero sin libro de órdenes:
la brecha **sí** es medible (`gapPct`), y `suggestedAction` no. Declarar
`UNAVAILABLE_NO_LIVE_SOURCE` ahí sería afirmar que no hay dato de mercado cuando la
tasa está en la misma respuesta, y el LMC descartaría la brecha real. Se agregó
`missingReadingFields()`, que emite `unavailableReason`, `expectedSource` y
`actionable: false` **sin `rateStatus`**. Declarar ausencia de más rompe tan fuerte
como declarar de menos.

## Qué sobrevive, y por qué es legítimo

Quedan ~55 defaults numéricos en el archivo. Ninguno es una lectura de mercado:

- **Capital de cuenta**: `usdtCapital ?? 8000`, `vesCapital ?? 160000`,
  `tradeAmountUsdt ?? 500`. Son la cartera de la mesa, no el mercado. Son lo
  primero que se configura en una cuenta nueva.
- **Parámetros de política**: fees del exchange (`makerFeePct ?? 0.35`), umbrales
  dorados (`0.5`), ventanas anti-spoofing (`finishRate >= 90`), capital de
  seguridad, APY flexible del exchange. El schema los declara con default, así que
  son contrato.
- **Contexto temporal**: `daysSinceLastIntervention ?? 4`, `currentDayOfWeek ?? 1`,
  `hourlyTransactionCount ?? 4`. No son mercado; son el reloj y la carga de la
  cuenta. La fecha sí viaja en el args.
- **Métricas de contraparte**: `completedTradesCount ?? 120`, `monthlyVolumeUsd ??
  30000`, `disputeCount ?? 0`. Defaults declarados por
  `calculateDynamicCounterpartyPricing`. La **base** sí era lectura y se corrigió.

El criterio para separarlos: *¿el número describe el mundo externo o la
configuración de quien opera?* Si es el mundo, ausente. Si es la configuración,
default documentado.

Un resto menor quedó marcado pero no se tocó: `finishRate ?? 1` y
`surplusAmount ?? 9999` en el filtro anti-spoofing (líneas ~1520) coinciden con el
daemon, y tratarlos exigiría cambiar el schema. Queda anotado.

## Verificación de esta vuelta

| Comando | Resultado |
| --- | --- |
| `mcp-fallbacks.spec.ts` | **73/73** |
| `tsc -p tsconfig.app.json --noEmit` | exit `0` |
| `tsc -p tsconfig.spec.json --noEmit` | exit `0` |
| `eslint mcp-fallbacks.ts mcp-fallbacks.spec.ts` | exit `0` |
| `prettier --check` (ambos) | exit `0` |

Las 73 pruebas cubren cada herramienta del barrido en dos direcciones: **sin dato**
el campo dependiente va en `null` y el veredicto no se emite, y **con el dato
real** el número real sale. La segunda mitad es la que importa: sin ella, "arreglar"
el bug apagando la herramienta entera también daría verde.

Además hay dos redes de contención sobre las 17 herramientas con el input vacío,
con la lista acumulativa de los ~48 números que el archivo solía emitir
(`NUMEROS_INVENTADOS`). Usan regex con límite numérico: `:8000` no matchea
`:80000`, que es el `unhedgedVesAmount` legítimo que sale del capital de cuenta.

## Fuera de alcance, y sigue vivo

Nada de esto se modificó:

| Ubicación | Default | Nota |
| --- | --- | --- |
| `packages/mcp-server/src/tools/scan_synthetic_stable_arbitrage.ts` | `defaultQuotes` | Curva sintética completa en el daemon. |
| `packages/mcp-server/src/tools/query_otc_darkpool_spread.ts` | `defaultVenues` | 3 venues P2P ficticias. |
| `packages/mcp-server/src/tools/evaluate_trade_risk.ts` | `counterpartyScore ?? 98` | Sobreviviente puntual. |
| `projects/core/src/lib/fintech-settlement-routing.ts` (línea 89) | `85.0` | El fallback ya no depende de él: se pasa `undefined` explícito para rails sin VES. |
| `projects/core/src/lib/agent-skills.ts` | ~24 defaults con `\|\|` | Sin cambios. El `\|\|` además traga ceros legítimos. |

El primero y el segundo son los serios: son curvas y venues enteras provistas,
no un número suelto.
