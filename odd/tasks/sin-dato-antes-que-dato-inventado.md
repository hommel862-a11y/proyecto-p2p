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

# Tercera vuelta: el motor macro y la superficie del LMC

## Por qué esta vuelta casi no se hizo

Las dos primeras atacaron el **número**. Esta ataca el **default**, y el default
es peor: no hace falta tocar el número falso para que el sistema lo fabrique.
Basta con que el llamador omita un argumento.

Tres instancias, y las tres producían una cifra sin fuente:

| Ubicación | Default | Qué afirmaba |
| --- | --- | --- |
| `packages/mcp-server/src/schemas/index.ts` | `z.number().positive().default(50000000)` | "El BCV inyecta $50M por semana" |
| `src/app/core/mcp/mcp-fallbacks.ts:2074` | `?? 50000000` | idem |
| `projects/core/src/lib/agent-skills.ts:2871-2872` | `\|\| 80.0` y `\|\| 85.0` | "BCV 80.0, paralelo 85.0" |

La primera es la que más me preocupa, y no por la cifra: por el mecanismo. Un
default de Zod es **invisible**. No hay `if` que leer, ni rama que auditar, ni
llamada que rastrear. El llamador no pasa nada, el schema lo rellena, y la
directiva lo imprime como si fuera observado.

## La cadena completa, en `agent-skills.ts`

Esta es la que hay que ver junta, porque ningún eslabón se ve culpable solo:

```
LMC pide régimen macro sin tasas
  -> bcvOfficialRate = 80.0        (inventado)
  -> parallelMarketRate = 85.0     (inventado)
  -> rateGapPct = 6.25%            (aritmética correcta sobre datos falsos)
  -> interventionProbabilityPct    (pesos arbitrarios, clamp [5,95])
  -> "Drenar bolívares a USDT de inmediato"   (directiva financiera)
```

Cada eslabón individual parece razonable. El conjunto miente. Y el resultado
final no es un dato dudoso: es una **instrucción de venta** emitida con la
confianza de un número.

Ese es el patrón que esta vuelta establece: **no basta con que cada valor sea
correcto si la cadena completa no tiene ninguna fuente.** El `6.25%` está bien
calculado. Calculado sobre nada.

## Qué cambió

- `agent-skills.ts`: `predict_bcv_macro_regime` falla cerrado sin tasas reales.
  Devuelve `success: false`, `data: null`, `unavailableReason`, `expectedSource`,
  `actionable: false`. Se añadió esos cuatro campos a `FinancialSkillResult`,
  que no los tenía: el tipo no tenía forma de expresar una negativa.
- Se eliminaron los tres defaults. `estimatedWeeklyBcvInjectionUsd` queda
  opcional y sin valor inventado.
- `evaluateMacroBcvRegime` (MCP) ya no cae a `'50'` cuando falta la cifra:
  menciona la inyección sólo si el llamador entregó una medida.
- La directiva dejó de afirmar *"Inyección inminente estimada en $50M USD"*.
  Ahora dice que es una heurística sin calibrar.
- `probabilityBasis: 'HEURISTIC_UNCALIBRATED'` acompaña siempre a la
  probabilidad, para que ningún consumidor la lea como medición.

## Lo que dejé vivo, y por qué

`interventionProbabilityPct` sigue emitiendo un número. No es una decisión
inconsistente: es una superficie de API que `agent-skills.ts:1635` declara
**obligatoria** para el LMC, con tests que asertan `> 50` y `>= 70`. Nullarla
cambia el contrato de herramientas del agente, y eso es una decisión de producto,
no una corrección de honestidad.

Mientras tanto, el número viaja etiquetado. Si mañana alguien lo consume como
medición, el campo que lo delata está a su lado.

## Verificación de esta vuelta

| Suite | Resultado |
| --- | --- |
| `projects/core` | 74 archivos / **775** tests (774 + 1 nuevo) |
| `packages/mcp-server` | 10 archivos / **142** tests (139 + 3 nuevos) |
| `electron` | 18 archivos / **215** tests |
| `tsc --noEmit` | exit 0 |
| `npm run check:vendor` | 24/24 idénticos (0 copiados: `agent-skills.ts` no está en el set gestionado) |
| `npm run build` | exit 0 (advertencia de budget preexistente, 606.03 kB) |

Dos mutaciones, ambas revertidas:

1. Reintroducir `usd: 68.45` + `source: 'BCV_OFFICIAL_FEED'` → **7 tests** caen.
2. Reintroducir `|| 80.0` / `|| 85.0` en `agent-skills.ts` → **1 test** cae.

## Cuarta vuelta: los defaults de medición

El barrido de `||` en `agent-skills.ts` encontró **~130 sites**, no ~20. No
todos son el mismo defecto, y esa distinción es la que hace el trabajo
manejable:

| Clase | Qué es | Veredicto |
| --- | --- | --- |
| Medición faltante (`\|\| 85.0`, `\|\| 75`, `\|\| 99.5`) | Afirmación sobre el mundo sin fuente | **Defecto** |
| Umbral de política (`\|\| 0.25`, `\|\| 0.15`) | Decisión del operador, no un hecho | Legítimo |
| `\|\| 0` sobre saldo | Ausencia convertida en cero | Riesgo medio,Separate |

### La forma del arreglo: un helper, no 130 ediciones

En vez de tocar cada sitio, el fail-closed se puso en **un** lugar:

```
requiredNumber(args, claves, expectedSource)   → lanza MissingEvidenceError
policyNumber(args, clave, defaultDePolítica)   → ?? en vez de ||
catch central                                → convierte el lanzamiento en negativa
```

El `catch` ya existía. Eso volvió cada sitio en **una línea**, y la forma de la
negativa quedó centralizada: `success: false`, `data: null`, `expectedSource`,
`actionable: false`, `unavailableReason: missing_evidence:<campo>`.

`requiredNumber` acepta claves alias, así que
`args['x'] || args['y'] || 20000` colapsa a una llamada. Y usa `Number.isFinite`
en vez de `||`, así que **un `0` legítimo sobrevive**: el `||` viejo
reemplazaba un cero real por el default.

### Los seis que se corrigieron

Ordenados por daño, no por archivo:

1. **`execute_preemptive_bcv_drain`** — el peor del archivo. `|| 80` producía
   `drainRatio = 0.90` y la directiva *"Drenar 90% del balance comprando USDT
   de inmediato antes del cierre de mesa BCV"*. Un default fabricarado
   ordenando liquidar el efectivo del operador. Ahora la probabilidad es
   obligatoria, y aun provista viaja con `probabilityBasis:
   'HEURISTIC_UNCALIBRATED'`, `isVerifiedIntervention: false`,
   `actionable: false`, y laaction se reformuló como escenario que **no** afirma
   cierre de mesa.
2. **`optimize_capital_allocation_kelly`** — `winRatePct || 75`. Kelly
   **amplifica** el edge asumido: si el win rate es inventado, el tamaño de
   posición es inventado, y mueve capital real.
3. **`monitor_service_health_and_fallback`** — `bankApiUptimePct || 99.5`,
   `dbQueryResponseTimeMs || 15`, `webSocketLatencyMs || 120`. Un monitor de
   salud que siempre reporta sano es peor que no tener monitor: da falsa
   garantía sobre los sistemas que mueven el dinero.
4. **`optimize_treasury_idle_yield`** — `flexibleApyPct || 10.5`. Un APY
   inventado produce una directiva de inversión sobre rendimiento fabricado.
   `minimumSafetyBufferUsd` sí es umbral de política → `policyNumber`.
5. **`forecast_central_bank_liquidity_drain`** — `|| 40` (USD millones)
   fabricaba la inyección del BCV para operar un pronóstico de liquidez.
6. **`monitor_fiat_flight_and_dollarization_velocity`** — inflación mensual
   `|| 35`, aceptación mercantil `|| 80`, tenencia `|| 30`.

### El test que no podía fallar

La primera verificación dio **775/775 verde** tras el cambio. Eso no fue buena
noticia: significaba que **nada ejercitaba el camino de negativa**. Los tests
preexistentes de esos skills pasaban todos los argumentos, y
`execute_preemptive_bcv_drain` tenía un test que seguía pasando con el `|| 80`
restaurado. Cero cobertura sobre el defecto.

Se escribieron 7 tests nuevos (`describe('ausencia de evidencia…')`) que
afirman la negativa, el `expectedSource`, el `unavailableReason`, y que un `0`
legítimo no se confunde con ausencia.

**Mutación:** reintroducir `|| 80` mata exactamente 1 test, el nuevo. El
preexistente sigue verde. Eso es la prueba de que el test sirve.

### Hallazgo colateral: un flake preexistente

Durante la verificación, `mcp-fallbacks.spec.ts` falló ~1 de cada 5 runs. No
lo caused este trabajo —el spec no estaba modificado— pero bloqueaba la
verificación.

Causa: `fintech-settlement-routing.ts` mete **dos campos derivados del reloj**
en `quote`:

```ts
settlementId: `SETTLE-${req.platform}-${Date.now().toString(36).toUpperCase()}`,
timestamp: new Date().toISOString(),
```

El test comparaba dos `quote` por igualdad profunda. Misma entrada, distinta
salida: no cachea, no se diffea, no se compara. Es el mismo principio de esta
tarea aplicado a la determinismo — *misma entrada debe dar misma salida*.

El arreglo fue en el test: excluir los dos campos de reloj y afirmar aparte que
el `settlementId` tiene forma real. **5/5 runs verdes** después.

### Verificación de esta vuelta

| Suite | Resultado |
| --- | --- |
| `p2p` | 41 archivos / **524** tests (× 5 runs consecutivos) |
| `core` | 74 archivos / **782** tests (775 + 7 nuevos) |
| `electron` | 18 archivos / **215** tests |
| `packages/mcp-server` | 10 archivos / **142** tests |
| `check:vendor` | 24/24 idénticos |
| `ng build` | exit 0 (budget: 607.03 kB, +1 kB por los mensajes de error) |

## Lo que sigue vivo

### Los ~110 defaults restantes de medición

La misma clase de defecto, sin corregir. Los de mayor riesgo:

| Site | Default | Por qué importa |
| --- | --- | --- |
| `fetch_cross_exchange_spread` / varios `\|\| 85.0` | tasa de mercado | fabricated quote |
| `\|\| 65000`, `\|\| 68000` | spot y strike | base de la opción |
| `\|\| 600` | precio BNB | valor de activo |
| `\|\| 2.5`, `\|\| 7.0`, `\|\| 10.0`, `\|\| 12.0` | APR/APY de earn y launchpools | rendimiento fabricado |
| `\|\| 100`, `\|\| 100000` | trades completados, volumen mensual | track record de competencia |

Son mecánicos: mismo helper, mismo patrón. ~110 líneas. No se hicieron en esta
vuelta porque son un work unit propio y cada uno necesita su `expectedSource`
correcto — un `expectedSource` genérico sería peor que ninguno.

### `\|\| 0` sobre saldos

Ausencia convertida en cero. Clase distinta: no fabrica un hecho positivo,
declara "nada" donde corresponde "desconocido". Riesgo medio, volumen alto.

### Los defaultQuotes y defaultVenues intactos

Fuera de alcance desde el inicio, sin cambios:
`scan_synthetic_stable_arbitrage`, `query_otc_darkpool_spread`,
`evaluate_trade_risk`, y ~24 defaults `\|\|` más en `agent-skills.ts`.

## Fuera de alcance, y sigue vivo

Nada de esto se modificó:

| Ubicación | Default | Nota |
| --- | --- | --- |
| `packages/mcp-server/src/tools/scan_synthetic_stable_arbitrage.ts` | `defaultQuotes` | Curva sintética completa en el daemon. |
| `packages/mcp-server/src/tools/query_otc_darkpool_spread.ts` | `defaultVenues` | 3 venues P2P ficticias. |
| `packages/mcp-server/src/tools/evaluate_trade_risk.ts` | `counterpartyScore ?? 98` | Sobreviviente puntual. |
| `projects/core/src/lib/fintech-settlement-routing.ts` (línea 89) | `85.0` | El fallback ya no depende de él: se pasa `undefined` explícito para rails sin VES. |
| `projects/core/src/lib/agent-skills.ts` | ~110 defaults de medición | Ver "Lo que sigue vivo". Reducido de ~130. |

El primero y el segundo son los serios: son curvas y venues enteras provistas,
no un número suelto.

# Quinta vuelta: la fase (a) — feeds reales en el daemon

## Por qué esta vuelta es la que faltaba

Las cuatro vueltas anteriores dejaron el contrato correcto: si no hay dato,
`null` con `expectedSource`. Pero un sistema que sólo sabe decir "no tengo dato"
no es un sistema de precios — es un sistema que no funciona. La fase (a) era
convertir ausencia declarada en **observación real**.

## `get_bcv_rates`: Cotizave, y el endpoint sí es credentialed

El comentario original decía "endpoint público". Era falso y lo corregí:
`src/app/core/cotizave.service.ts` envía `X-API-Key` y trata `401` (key inválida)
y `403` (plan sin endpoint) por separado. `BCV_EXPECTED_SOURCE` ahora declara el
endpoint credentialed y los mercados que corresponden a cada moneda.

`packages/mcp-server/src/tools/cotizave-official-reader.ts` trae un parser puro y
el transporte:

- `parseCotizaveOfficialReading(payload)` — puro, sin I/O.
- `fetchCotizaveOfficialReading()` — `COTIZAVE_API_KEY`, `AbortSignal.timeout(10_000)`.
- Sin key, HTTP no-2xx, payload parcial o error: `null`. Nunca un número inventado.
- `reference`/`bcv` → USD; `eur_reference` → EUR; **CNY/RUB quedan `null`** porque
  no hay evidencia de que el payload los traiga.

## El hueco que encontró el test end-to-end

Escribí primero los 19 tests del parser (todos verdes) y luego el test que
recorre `getBcvRatesTool.execute()` con una lectura real. Falló:

```
expected 'Tasa oficial BCV no disponible (SIN_FUENTE_BCV_EN_VIVO)...'
to contain 'N/D'
```

La rama de **ausencia** no enumeraba las monedas: el `N/D` sólo aparecía en la
rama `LIVE`. Un consumidor no podía distinguir "sin dato" de "campo omitido".
Corregido: la descripción enumera las monedas en ambos caminos.

Vale la pena por qué importa: el parser era correcto y el tool igual. El defecto
era del **contrato de salida**, y sólo apareció al probar el cable entero, no la
función. Un test de la unidad no lo habría encontrado.

## `get_parallel_rates`: Binance P2P real, reutilizando el lector de T1

`fetchParallelLiveReadings()` devolvía `[]` mientras el comentario de arriba
afirmaba que Binance estaba conectado. El comentario era la documentación de un
deseo. Ahora delega en `fetchBinanceLiveRates()`, el mismo lector que usa
`fetch_cross_exchange_spread` — un solo cliente de Binance, no dos.

### La orientación de los lados

`getParallelRatesFeed` calcula `spreadPct = (ask - bid) / bid`. En Binance,
`tradeType BUY` son makers **vendiendo**: el mínimo es lo que pagaríamos, o sea
nuestro **ask**. `tradeType SELL` son makers **comprando**: el máximo es lo que
recibiríamos, nuestro **bid**. Invirtirlos publicaría un spread negativo.

Verificado contra el endpoint crudo en el momento de la corrida:

| Lado | Rango real | Extremo usado |
| --- | --- | --- |
| `BUY` (nuestro ask) | 953 – 954.18 | **min = 953** |
| `SELL` (nuestro bid) | 951.2 – 953 | **max = 953** |

Salió `ask === bid === 953`. Antes de aceptarlo lo contrasté con la respuesta
cruda: los dos extremos **de verdad** coinciden en ese instante. El `spreadPct: 0`
es una observación, no un aplanamiento. Esa comprobación era obligatoria: un
lector que promedia los dos lados habría manufactured un spread limpio sin
decirnos que se lo inventó.

### El guard de libro cruzado

`bestBinanceRates` toma `min` y `max` de **dos requests distintos**, así que en
un libro fino el ask puede quedar debajo del bid. Con la fórmula de arriba eso
publica una dispersión negativa que se lee como arbitraje real. `toParallelReading`
rechaza el caso; un número que describe un mercado imposible es peor que ningún
número.

### El hallazgo colateral: `dispersionPct: 0` con un solo monitor

La corrida en vivo devolvió `dispersionPct: 0` con **un** venue, porque
`highestAsk === lowestBid === mid`. La fórmula da cero y el resultado afirma
"todos los monitores coinciden perfectamente" a partir de **N=1**. Es el mismo
defecto que los `||` de la cuarta vuelta, con otro disfraz: no es un default, es
una conclusión manufactured por aritmética sobre una ausencia.

Ahora `dispersionPct` exige `mids.length >= 2`. Mutado el guard a `averageMid > 0`
(el estado anterior) muere `mes null con un solo monitor leído`.

## Verificación de esta vuelta

| Suite | Resultado |
| --- | --- |
| `packages/mcp-server` | 12 archivos / **179** tests (142 + 37 nuevos) |
| `p2p` | 41 archivos / **524** tests |
| `core` | 74 archivos / **782** tests |
| `electron` | 18 archivos / **215** tests |
| `check:vendor` | 24/24 idénticos |
| `tsc --noEmit` | sin errores |
| `ng build` | exit 0 (budget: 607.03 kB, +7.03 kB sobre 600, preexistente) |

### Un flake preexistente, reportado y no escondido

Una corrida de `ng test` falló en
`src/app/features/copilot/copilot.spec.ts > renders the HUD from buildTreasurySnapshot`.
La siguiente corrida dio 41/524 verde, con el mismo stderr
`[Copilot] Treasury announce failed: Error: not allow-listed` presente **también**
en la corrida que pasa. Es timing: el announce es asíncrono y el test afirma
antes del render. No lo toqué y no lo cuento como resuelto.

## Lo que sigue vivo tras esta vuelta

- **Cotizave sin `COTIZAVE_API_KEY`**: `get_bcv_rates` sigue declarando ausencia.
  El camino está probado con fixtures y con el contrato, no contra la API real.
- **CNY/RUB**: sin evidencia en el payload. No hay de dónde sacarlas.
- **Un solo venue paralelo**: Binance P2P. La dispersión queda `null` hasta que
  exista un segundo monitor realmente leído — que es lo correcto.
- **`ratesResources`**: sigue consume readers síncronos sin readings.
- **Los ~110 defaults de medición** y los `|| 0` sobre saldos: sin corregir.
- **`interventionProbabilityPct`**: sigue siendo un número heurístico con
  contrato obligatorio; la decisión de producto (null vs. mantener) está abierta.
- **Defaults de Electron**: `bcvRate = 72.0` en `gemini-orchestrator.ts` y
  `sentinel-agent.ts`, `?? 65.5` en `handlers.ts`, `?? '22.9'` en `strategist-agent.ts`.
- **`packages/mcp-server/dist/index.js`**: sin regenerar.

# Sexta vuelta: el barrido de los defaults que quedaban

## La clasificación, antes de tocar una línea

~130 defaults `||` no son la misma cosa, y tratarlos como si lo fueran habría
sido el error. Cada sitio se clasificó antes de editar:

| Clase | Qué es | Qué se hizo |
| --- | --- | --- |
| **Medición** | Un hecho del mundo: tasa, precio, saldo, APR, volumen, track record | `requiredNumber` — sin dato, ausencia |
| **Política** | Una decisión del operador: umbral, horizonte, duración | `policyNumber` — default legítimo, pero declarado como política |
| **Sintético** | Curvas y venues ficticias | Fuera de alcance desde el inicio |

La diferencia importa. `hedgeRatioPct || 100` es una política: alguien decidió
cubrir el 100%. `completedTradesCount || 100` es una **afirmación sobre un tercero**
que el sistema se inventaba para decidir a quién se le paga.

Resultado: **118 `requiredNumber` + 26 `policyNumber`** sobre 122 sitios.

## Los 8 `||` numéricos que sobreviven, y por qué

Ninguno es una medición:

| Línea | Código | Por qué queda |
| --- | --- | --- |
| 2110-2113 | `queuePositionIndex \|\| 0`, `queueAheadVolumeUsdt \|\| 0`, `recentFillVelocityPerMinuteUsdt \|\| 100` | Modelo de cola. Requieren decisión de modelado, no un default honesto |
| 2964 | `fairMarketRate \|\| 0` | Centinela; el filtro de dislocación lo trata aparte |
| 2971-2974 | `a.price \|\| 0`, `availableAmount*`, `min/maxLimitFiat` | Normalización de venues: descartar, no medir |

## El hallazgo que rompe el método: `||` no es el único indicio

Invertí el barrido buscando el patrón correcto y aparecieron dos tasasinventadas
que **ningún grep de `||` puede ver**:

```ts
// 3500 — compile_fast_dispute_evidence
orderAmountCrypto: claimedAmount / 85.0,
// 3564 — quote_instant_remittance_corridor
destCryptoRate: 85.0,
```

Un `85.0` hardcodeado es **exactamente el mismo defecto** que un `|| 85.0`:
produce el mismo número inventado. El segundo es peor, porque arma el mensaje de
WhatsApp que el cliente lee, con un payout VES prometido sobre una tasa que nadie
midió.

La fuente se razonó, no se inventó:

- `compile_fast_dispute_evidence` → **paralelo**, no oficial: una disputa P2P se
  resuelve contra el libro, no contra el BCV.
- `quote_instant_remittance_corridor` → `SRC_DESK_SELL_RATE`, el patrón que el
  archivo ya usa para toda tasa prometida a un cliente.

**La regla que sale de esto:** el barrido tiene que buscar **divisiones y
multiplicaciones por literal flotante**, no sólo operadores `||`. Un operador es
una forma de escribir un literal; el literal es el defecto.

## La lección metodológica sobre los tests

La mutación de `claimedAmount || 0` murió en 1 test. La de `claimedAmount / 85.0`
murió en **2**. El segundo es el que importa:

> El test de negación ("no debe tener éxito sin `parallelRate`") es necesario pero
> **no suficiente** para cazar un literal hardcodeado. Necesitás además el test
> positivo que demuestra que el *output cambia* con la entrada.

Con sólo el test de negación, el `85.0` fijo habría pasado la suite mientras
seguía inventando la tasa. Un test que prueba que algo falla no prueba que el
número sea el que creés.

## Verificación de esta vuelta

| Suite | Antes | Después |
| --- | --- | --- |
| `core` | 74 / 782 | 74 / **869** (+87) |
| `p2p` | 41 / 527 | 41 / **527** |
| `electron` | 18 / 215 | 18 / **215** |
| `packages/mcp-server` | 12 / 179 | 12 / **179** |
| `check:vendor` | 25/25 idénticos | 25/25 idénticos |
| `tsc --noEmit` | exit 0 | exit 0 |
| `ng build` | exit 0 | exit 0 (608.36 kB, +8.36 sobre budget, preexistente y en crecimiento) |

### Un TS2339 preexistente que bloqueaba la verificación

`ng test p2p` no compilaba: `src/app/core/accounts.service.ts:457` fallaba con
`TS2339: Property 'announceTreasury' does not exist on type 'false | {...}'`. La
causa era `typeof window !== 'undefined' && (...).p2p`, que por el operador `&&`
produce el literal `false` en el tipo. Corregido con un ternario: mismo
comportamiento en runtime, sin la Unión inválida. Ese archivo es trabajo
concurrente sin commitear; sólo se tocó esa línea.

### Un defecto del actor concurrente, reportado y no arreglado

`accounts.service.spec.ts > synchronizes accounts from Electron SQLite...` falló
**3 de 3 corridas** (esperaba 1 cuenta, había 17). La causa está en su código:

```ts
const missing = DEFAULT_ACCOUNTS.filter((d) => !existingIds.has(d.id)); // 16
const merged = [...records, ...missing];                                 // 1 + 16 = 17
```

`initElectronSync` ahora hace merge de `DEFAULT_ACCOUNTS` en vez de adoptar el
estado de SQLite. En el contexto de esta tarea eso es exactamente el delito: **16
cuentas bancarias inventadas de vuelta en la tesorería real de un usuario**. No
se tocó — es feature en vuelo de otro actor y la decisión de si el estado de
SQLite debe incluir cuentas por defecto es de producto, no mía.

## El contrato equivocado: el bug más caro que dejó el barrido

Después de cerrar las 7 unidades quedaron 2 errores TS de `tsc` en
`packages/mcp-server`. Eran la punta de algo más grande.

`ScanSyntheticStableArbitrageInputSchema` describía un **engine de pares de
divisa**:

```ts
{ sourceAsset, targetAsset, exchangeRate, feePct, reverseExchangeRate, reverseFeePct }
```

pero `scanSyntheticStableCurves` consume `StableCrossQuote`:

```ts
{ targetAsset, spotPair, spotRate, p2pUsdtRateFiat, p2pTargetRateFiat, ... }
```

El único campo en común es `targetAsset`. `reverseExchangeRate`/`reverseFeePct`
no pertenecen a este dominio: es un copy-paste de otra herramienta.

Como `pairs` era `optional`, una curva fantasma pasaba la frontera y el motor leía
`spotRate` y `p2pUsdtRateFiat` como `undefined`:

| Lectura | Resultado |
| --- | --- |
| `syntheticCostFiat = spotRate * p2pUsdtRateFiat` | `NaN` |
| `spreadRouteA` / `spreadRouteB` | `0` / `0` |
| `direction` | `NO_OPPORTUNITY` |
| `bestGrossSpread` | `0` |
| `netSpreadPct` | `null` |
| `isActionable` | `false` |

Un veredicto "no hay oportunidad, spread cero" sobre una ruta **nunca medida**. Un
`as StableCrossQuote[]` ocultaba el desajuste entero: el compilador aceptaba una
promesa falsa en lugar de reportar el conflicto.

Nadie en el repo enviaba jamás la forma fantasma. El único contrato que los
llamantes reales usan es `StableCrossQuote` — el spec de producción ya pasaba esa
forma exacta y el schema la rechazaba. El boundary estaba invertido.

### La segunda mitad, que el propio repo ya había marcado

`src/app/core/mcp/mcp-fallbacks.ts` tenía este comentario:

> DIVERGENCIA CONOCIDA (fuera de alcance de este barrido): el daemon tiene sus
> propios `defaultQuotes` … ese default debe caer por separado.

No era divergencia ni estaba fuera de alcance: era **el mismo bug visto desde el
otro lado**. El fallback del renderer ya se negaba a escanear sin `pairs`, mientras
el daemon corría el scan sobre su propia copia de la curva fija USDC/VES
(85.5 / 86.8) y reportaba `opportunitiesCount` sobre ella. Dos mitigaciones
independientes del mismo defecto, con la mitad del servidor sin cubrir.

### Un test que afirmaba el bug

`high-impact-suite.spec.ts` tenía:

```ts
const res = scanSyntheticStableArbitrageTool.execute({ minNetSpreadPct: 0.1 });
expect(res.success).toBe(true);
expect(res.opportunitiesCount).toBeGreaterThan(0);
```

Sin `pairs`. O sea: **exigía que el scan corriera sobre la curva inventada**. No
era un test faltante — era el bug escrito con assertions. Un test puede ratificar
un comportamiento equivocado igual que un código; la pregunta correcta no es
"¿el test pasa?" sino "¿qué está afirmando este test?".

Reescrito para afirmar lo contrario, más un caso positivo que envía una curva
medida y sí espera conteo.

### La lección que generaliza

Borrar el número inventado no alcanza cuando el **consumidor** tiene su propia
defensa laxa. El orden correcto es:

1. Alinear el contrato del boundary con lo que el motor lee (aca: el schema).
2. Quitar el default inventado del tool.
3. Cerrar el borde donde la ausencia se vuelve número (`|| 0`, `?? 50000000`).

Hacer sólo (2) deja el sistemaльного(1) abierto: cualquier payload con la forma
equivisoca entra igual y produce `NaN` → `0`. Este es el mismo patrón del
`calculateBcvGap` que devolvía `gapPct: 0, zone: 'NORMAL'` ante una tasa no
positiva — y el mismo criterio de "el conteo de una búsqueda que no ocurrió va
en `null`, porque `0` afirma que se escaneó y no se halló nada".

## Verificación final

| Suite | Antes de esta sesión | Ahora |
| --- | --- | --- |
| `p2p` | 41 / 528 | 41 / **529** |
| `core` | 74 / 869 | 74 / **869** |
| `electron` | 21 / 236 | 21 / **236** |
| `packages/mcp-server` | 12 / 188 | 14 / **197** |
| `tsc --noEmit` (root) | exit 0 | exit 0 |
| `tsc --noEmit` (mcp-server) | **2 errores preexistentes** | **0 errores** |

Los 2 errores TS que se dejaron rojos a propósito están resueltos de raíz, no
forzados con `as unknown`:

| Error | Causa | Resolución |
| --- | --- | --- |
| `core/index.ts:2955` TS2532 | `noUncheckedIndexedAccess` ensancha el grupo de captura a `string \| undefined` | Se estrecha con una variable en vez de un default |
| `scan_synthetic_stable_arbitrage.ts:16` TS2352 | El schema describía otro tipo | Schema realigned con `StableCrossQuote` |

### Mutaciones aplicadas a este contrato

| # | Mutación | Resultado |
| --- | --- | --- |
| M1 | Schema vuelve a la forma fantasma | 2 tests en rojo |
| M2 | `p2pUsdtRateFiat` → `optional` | 1 test en rojo |
| M3 | `defaultQuotes` reinstalados en el tool | 2 tests en rojo |
| M4 | `defaultQuotes` reinstalados con specs ya corregidos | 3 tests en rojo |

M3 y M4 importan por una razón específica: reinstalar el `85.5` deja rojo el
conteo, así que el test caza el default inventado — no sólo el cambio de tipo.

Las mutaciones de la vuelta siete están en su propia sección: M1/M2/M3 sobre
`forecast_volatility_window`, y la que casi no prueba nada — borrar el parámetro
en vez de ignorar su valor.

# Septima vuelta: el typecheck que nunca se ejecutó

Esta vuelta tiene un origen distinto a las seis anteriores. Las anteriores buscaban
**números inventados**. Esta salió de un `tsc` que **no compilaba**, y terminó
descubriendo que el typecheck "verde" que reporté seis veces no se estaba
ejecutando.

## Un default que anunciaba un dato que no existía

`ForecastVolatilityWindowInputSchema` declaraba:

```ts
currentSpreadPct: z.number().default(1.2),   // announcement, not measurement
askDepthUsdt: z.number().default(5000),
bidDepthUsdt: z.number().default(4500),
```

El patrón es el mismo de siempre, con una diferencia que lo hace peor: el campo se
**publicaba en el schema** y el motor nunca lo leía. No era un default que caía
dentro de un cálculo; era un default que caía dentro de un contrato. Un cliente que
leyera el schema asumiría que `currentSpreadPct` era un dato de entrada, y el
resultado de la herramienta lo seguiría confirmando con un ratio derivado de
`askDepth`/`bidDepth` inventados.

`depthRatio` con ambos lados inventados produce un número con la forma correcta y
cero información: `5000 / 4500 = 1.111`. Un ratio de libro que se ve plausible es
peor que `null`, porque `null` se ve raro y `1.111` no.

### La rama que faltaba no era un default

Agregar `depthRatio: null` no alcanzaba. El motor **ya tenía** la rama de
ausencia, y el default la alcanzaba con números:

```ts
const depthRatio = bidDepthUsdt > 0 ? askDepthUsdt / bidDepthUsdt : null;
```

Con ambos defaults, `bidDepthUsdt > 0` siempre era cierto. La rama de `null` no se
activaba nunca. Es el patrón de `?? 78.5` invertido: el default no caía en el
cálculo, **desactivaba la defensa**.

### El test que exige `actionable`

```ts
const actionable = gapPct !== null && depthRatio !== null && spreadDynamic !== 'UNAVAILABLE';
```

Con los defaults puestos, `actionable` era `true` con datos inventados. Ahora sin
profundidad medida: `depthRatio = null`, `unavailableReason =
'missing_evidence:bookDepth'`, `actionable = false`. El `unavailableReason` no es
decorativo — es lo que le dice al llamador **qué medir** para desbloquear la
próxima llamada.

## El typecheck que llevaba tiempo sin poder correr

`tsc -p packages/mcp-server/tsconfig.json --noEmit` fallaba con **TS5101 antes de
compilar una sola línea**:

```
Option 'baseUrl' is deprecated and will stop functioning in TypeScript 7.0.
```

TypeScript 6.0.3. El tsconfig del paquete llevaba `baseUrl` y `paths` de una era
en que el alias `@p2p/mcp-server/*` se usaba. Hoy:

| Campo | Quién lo usa |
| --- | --- |
| `paths` | **Nadie.** Cero archivos importan por `@p2p/mcp-server/*` |
| `baseUrl` | Sin `paths` que resolver, y sin imports bare salvo paquetes npm reales |

Así que la tentación era `ignoreDeprecations: "5.0"`, que es la respuesta que
funciona hoy y deuda con fecha dentro de dos versiones. Se borraron los dos
campos.

### Lo que esto destapa

El `tsconfig.json` de la raíz tiene `"files": []`. Su `tsc` da verde sobre
cualquier cosa — un archivo con 400 errores de tipo compila, porque no hay archivos
que compilar. Seis rondas de barrido, seis reportes de `tsc --noEmit` exit 0, y el
único typecheck que cubría de verdad este código era el que no arrancaba.

Esa es la lección: **un typecheck verde es evidencia del typecheck que corrió, no
del código.** Un check que no puede fallar no verifica nada, y su verde es
indistinguible del verde de uno que sí corrió.

### Mutaciones

| # | Mutación | Resultado |
| --- | --- | --- |
| M1 | Se repone `currentSpreadPct: 1.2` | 2 tests en rojo |
| M2 | Se repone `askDepthUsdt`/`bidDepthUsdt` | 4 tests en rojo |
| M3 | `actionable` vuelve a ignorar `depthRatio` | 3 tests en rojo |

## La septima mutación que casi no prueba nada

Primer intento de M1 en esta vuelta: **borrar** el parámetro del default.

```
Test Files  1 failed (1)
     Tests  no tests
```

Cero tests ejecutados. La mutación rompió la compilación del archivo entero, así
que Vitest no pudo correr nada. Un "rojo" que en realidad es un archivo que no
compila **no es una prueba de nada** — es el mismo falso verde de siempre,
del lado contrario: parece que la mutación funcionó porque algo se puso rojo, pero
lo que se puso rojo fue el compilador.

La mutación útil era otra: **conservar la firma y descartar el valor**:

```ts
monthKey: string = new Date().toISOString().slice(0, 7),  // mutant: firma intacta
const monthKey = new Date().toISOString().slice(0, 7);    // el cuerpo lo ignora
```

Esa sí la cazan 4 tests, y es exactamente la forma que el defecto toma en
producción: la API acepta el parámetro, el cuerpo lo ignora, nadie lo nota porque
la firma dice lo contrario.

## El parámetro decorativo que el test desmintió

El mes se inyectó en `computeAccountUsage` y `computeTreasurySummary`. Se lo puse
también a `recommendAccountForTrade` por simetría, y escribí el test:

```ts
const enMarzo = recommendAccountForTrade([cuenta], 40_000, ops, undefined, '2026-03');
expect(computeAccountUsage(cuenta, ops, '2026-03').remainingLimitVes).toBe(50_000);
expect(computeAccountUsage(cuenta, ops, '2026-04').remainingLimitVes).toBe(100_000);
```

Falló. Y el fallo enseñó el modelo real: `remainingLimitVes` sale de `spentTodayVes`,
que sale de `todayOps`, y `todayOps` llega **ya filtrado por el llamante**. El mes
no puede cambiar la recomendación. El parámetro no podía hacer nada.

Se quitó de la firma, y quedó un test que lo custodia:

```ts
expect(recommendAccountForTrade.length).toBe(4);
```

Un parámetro que no altera la salida es un contrato publicado que no existe — la
misma familia que `currentSpreadPct`: un valor que se anuncia y se descarta en
silencio. Y acá el test lo descubrió, no yo: yo lo agregué por simetría y la
asimetría era la pista.

## Qué queda vivo, y por qué es legítimo

| Default | Por qué sobrevive |
| --- | --- |
| `currentCapitalUsdt: 5000` | **Medición inventada.** Default de schema, sin cerrar. |
| `currentExposureUsdt: 0` | **Medición inventada.** `0` afirma "no tenés exposición". |
| `maxDailyExposureLimitUsdt: 2000` | **Medición inventada.** Es política del usuario, no un hecho. |
| `targetHedgePct: 100` | **Política, no medición.** El default "cubrir todo" es una decisión legítima si se declara como tal. Distinto de los tres anteriores. |
| `stakedAsset`, `dailyInstantQuotaUsdt`, `availableSubaccountsCount` | **Ya cerrados** con `?: number \| null` + `missingInputs`. No son residuales. |

Los tres primeros son el mismo defecto de `ff1067c`, en el mismo archivo, sin
cerrar. Y esa es la asimetría que importa: la vuelta siete continuará, porque el
mismo patrón sigue produce defaults de medición en `schemas/index.ts` y nadie
miró ese archivo desde el primer barrido.

## Verificación de esta vuelta

| Suite | Antes | Ahora |
| --- | --- | --- |
| `packages/mcp-server` | 12 / 197 | 14 / **206** |
| `projects/core` | 74 / 869 | 79 / **952** |
| `electron` | 21 / 236 | 21 / **224** |
| `tsc -p tsconfig.app` | — | exit 0 |
| `tsc -p tsconfig.spec` | — | exit 0 |
| `tsc -p packages/mcp-server` | **TS5101, no compilaba** | **exit 0** |
| `check:vendor` | 23/24 (desfasado) | **24/24 idénticos** |

`electron` bajó de 236 a 224: es el actor concurrente editando sus specs, no una
regresión mía. Los archivos de `src/app` y `electron/main/db` no se tocaron.

## Estado final

Commits de esta sesión, en orden de unidad de trabajo:

```
f430566  fail closed en todo el servidor — sin dato, no hay número
01c5e20  exigir la medicion antes de derivar una decision
32e57d6  quita el as const redundante que rompia el typecheck
c572491  ancla las fixtures de cuentas al reloj, no a septiembre
3bfea3a  eliminar las tasas inventadas del proceso principal
e830987  el contrato de la curva era de otro engine
6ebb719  los sidecars de SQLite y node_modules no son fuente
ff1067c  no inventar spread ni profundidad en forecast_volatility_window
d9ee7fe  quitar baseUrl y paths muertos que rompian el typecheck
010456c  el mes de consumo se fija, no se hereda del reloj
```

### Lo que queda abierto, y no es mío

| Pendiente | Por qué |
| --- | --- |
| `DEFAULT_ACCOUNTS` en `initElectronSync` | Decisión de producto: ¿SQLite es autoritativo? |
| `interventionProbabilityPct` | No hay modelo BCV calibrado; sólo puede quedar `null` |
| `currentCapitalUsdt` / `currentExposureUsdt` / `maxDailyExposureLimitUsdt` | Defaults de medición en `schemas/index.ts`; mismo patrón que `ff1067c`, sin cerrar |
| `bcvStatus` reactivo | `VenezuelaClock` lo vuelve testeable, pero sigue siendo un `computed` sin tick: no reacciona al paso del tiempo |
| `evaluateUsdtDepegEvent` dormido | Nunca invocado; necesita ticker real de `USDTUSD` |
| `gemini-orchestrator.ts` sin commitear | 11 líneas del actor (`esSimulado`→`esSimulated`) + 13 mías, inseparables sin cirugía de hunks |
| Puente vault → daemon | `COTIZAVE_API_KEY` no existe; no hay bridge desde `SecretStoreService` |
| Segundo venue live | Requiere credenciales Bybit/El Dorado |

Un detalle de higiene que apareció de paso: el actor concurrente corrigió por su
cuenta el `?? 50000000` (una inyección BCV semanal de $50M afirmada sin fuente) en
`mcp-fallbacks.ts:2075`, dejándolo en `undefined` y propagándolo al resultado.
El fix es correcto y no se tocó. Queda anotado acá porque es la misma doctrina
que este barrido, aplicada de forma independiente.

---

# Octava vuelta: autorizaciones, reloj y defaults del nucleo

Esta vuelta cierra los tres defaults de medicion que la vuelta anterior dejo
escritos, y despues dos defectos que ninguno de los barridos anteriores habria
podido encontrar: el espejo de la app seguia authorizing sobre datos inventados
despues de que el servidor dejara de hacerlo, y la ventana BCV envejacia en
silencio.

## 9200a4f — el servidor deja de autorizar sobre lo que nadie midio

Los tres defaults de medicion que quedaron vivos (`currentCapitalUsdt: 5000`,
`currentExposureUsdt: 0`, `maxDailyExposureLimitUsdt: 2000`) eran el mismo
defecto de `ff1067c`, en el mismo archivo, sin cerrar. Se cerraron los tres, pero
el hallazgo real no fue aritmetico: **los tres defaults convertian la ausencia en
una autorizacion**.

`currentExposureUsdt: 0` es el peor de los tres, y no por su magnitud. Un `0`
aqui no es "no hay dato": es la afirmacion de que la mesa no tiene exposicion. Con
ese `0` y `maxDailyExposureLimitUsdt: 2000`, cualquier orden por debajo de 2000
pasaba el limite y salia `SIMULATED_WITHIN_LIMITS`. No era un default
inconservador: era un permiso de mover dinero emitido por el silencioso.

La correccion separa dos cosas que los defaults mezclaban. Una exposicion o un
limite ausentes producen `limitExceeded: null` y `verdict: UNAVAILABLE`; lo que
queda sin medir va en `unmeasuredInputs`, y `actionable: false` impide que un LMC
lea un `null` como margen disponible. Un `null` en `limitExceeded` ya no puede
leerse como `false`, que era la lectura que el default inducía.

En `evaluate_trade_risk` el cierre es mas directo: `isCounterpartyAcceptable`
podia salir `true` con `counterpartyScore` ausente, porque el schema lo declaraba
en 98 y `98 >= 70` siempre. Ausente ahora es `null` y el veredicto es
`UNAVAILABLE` con `missing_evidence:counterpartyScore`.

26 pruebas nuevas en `packages/mcp-server/src/no-invented-trade-authorizations.spec.ts`
cubren cada rama en dos direcciones: ausente da `null`, y presente da el numero
real.

## d581297 — la ventana BCV deja de envejecer en silencio

Este defecto no era de datos inventados, pero es el mismo fallo de honestidad con
otra forma: **`VenezuelaClock.now` era un metodo que leia el reloj una vez**.

`bcvStatus` es un `computed` que deriva una ventana de 7 dias sobre la lectura
BCV. Con `clock.now()` como metodo, ese `computed` se evaluaba cuando sus
dependenciasSignal cambian, y como no tenian ninguna — el reloj no era un signal
— la ventana se calculaba una vez y se quedaba congelada para siempre. El mismo
operador, cuatro minutos despues, veía exactamente los mismos dias de ventana.

La lectura era correcta; lo que estaba mal era el momento en que se tomaba. Un
`computed` sin tick no es un valor calculado: es una fotografia.

El fix fue volver `now` un `Signal<Date>` readonly y agregar un intervalo de
`VENEZELESIA_CLOCK_REFRESH_MS` que lo actualiza, con `ngOnDestroy` limpiandolo.
El `computed` ahora depende de una dependencia real, asi que el paso del tiempo
es una entrada legitima al recalculo.

El punto para el que queda escrita la regla: **un valor derivado de un reloj debe
suscribirse al reloj.** Si un `computed` lee la hora, la hora tiene que ser una
Signal; si no, el valor no esta derivado, esta congelado, y la diferencia entre
esas dos cosas no se ve en los tests hasta que alguien mira el reloj.

## 0fefaef — el espejo de la app no hereda la honestidad del servidor

Este es el hallazgo mas importante de la vuelta, y no lo encontro revisando el
servidor. Lo encontro el stage.

`mcp-fallbacks.ts` es el espejo de `packages/mcp-server` para el modo web de la
app. Cuando `9200a4f` cerro los defaults de medicion en el servidor, el espejo
siguio intacto — y con defaults que **no coincidian con los que el servidor ya
nadie defendia**. Mientras el servidor decia 2000 y 5000, el espejo decia 2500,
500, 400 y 600. La razon no era una decision de diseno: era deriva. Nadie estaba
mirando ese archivo porque el trabajo oficial estaba en el servidor.

Peor por la forma. El servidor ahora declara `unmeasuredInputs` y sus defaults
de riesgo son `number | null`. El espejo seguia aplicando `Number(x ?? default)`
en las mismas ramas, con el `actionable: false` puesto en toda la rama, asi que
el defecto no seesia grave: **encerraba la autorizacion pero publicaba la
afirmacion**. `tradeRiskPct: 10.0` calculado sobre una tesoreria que nadie
reporto, y `isCounterpartyAcceptable: true` porque 98 >= 70.

La funcion nueva es `numeroODeferenciaAusente`:

```ts
function numeroODeferenciaAusente(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
```

`Number(undefined)` da `NaN` — pero `Number(args.x ?? 5000)` sobre un ausente no
llega ahi, porque el `??` ya lo reemplazo por 5000 antes de que `Number` lo viera.
Ese era el error real: los defaults no fallaban en la aritmetica, se aplicaban
antes. Y por eso `0` es un valor legitimo que esta funcion preserva: una
exposicion medida en cero es un hecho, y `consecutiveLosses: 0` es el conteo
observable del contador, no una medicion de mercado. El servidor tambien lo
declara con `.default(0)`.

En `simulate_trade_impact` la correccion distingue lo que no se puede calcular de
lo que si se puede affirmar. Si falta el limite, `projectedExposureUsdt` queda
`null` — porque `currentExposure + proposedTrade` sin limite sigue siendo un
calculo valido y reportarlo es informacion. Lo que se pierde es
`exposureUtilizationPct`, que es una division por un numero que nadie eligio. Y
una regla conocida sobre datos medidos no se suprime por el hecho de que falte
otro: `consecutiveLosses >= 3` sigue produciendo `REQUIRES_REDUCTION` aunque el
limite no exista. `REQUIRES_REDUCTION` es una orden de no crecer, que es la
direccion segura, asi que sobre-corregirla habria quitado una proteccion real.

## El patron que estos tres commits comparten

Los tres casos son la misma doctrina aplicada a tres capas distintas: el
**servidor**, la **app espejo** y el **reloj**. En cada una, el defecto era que un
valor no observaba su propia ausencia:

- El servidor: `Number(x ?? default)` convertia unSchema Optional en
  autorizacion.
- El espejo: repetia el mismo patron sobre defaults que ya nadie defendia.
- El reloj: un `computed` derivaba de una hora que no era un signal, y por eso
  no se recalculaba.

El denominador comun es que **el valor no tenia un canal por el cual decir "no
se"**. Un `null` tipado, un `Signal<Date>`, un `unmeasuredInputs` explicito: tres
formas de darle ese canal. Un `?? default` y un metodo `now()` no lo tienen, y
por eso ambos pueden mentir sin que nada los contradiga.

## Verificacion de esta vuelta

| Suite | Antes | Ahora |
| --- | --- | --- |
| `packages/mcp-server` | 14 / 206 | 16 / **232** |
| `src/app` (proyecto `p2p`) | 47 / 566 | 48 / **582** |
| `projects/core` | 79 / 952 | 79 / **952** |
| `electron` | 21 / 224 | 22 / **244** |
| `tsc -p packages/mcp-server` | exit 0 | exit 0 |
| `tsc -p tsconfig.app` | exit 0 | exit 0 |
| `tsc -p tsconfig.spec` | exit 0 | exit 0 |
| `tsc -p projects/core/tsconfig.lib` | exit 0 | exit 0 |
| `tsc -p projects/core/tsconfig.spec` | exit 0 | exit 0 |

Las tres suites nuevas (`mcp-fallbacks-trade-authorization` 16,
`triangulation-bcv-status-window-reactivity` 7, `no-invented-trade-authorizations`
26) pasan con la suite completa, no aisladas: la que importa es la que corre junto
a las 566 que ya existian.

Electron subio de 224 a 244 por el actor concurrente; no es una regresion de esta
vuelta.

### Nota de alcance: el espejo y `RuleContext` — CORREGIDA

> **Correccion.** Esta nota estaba mal y su conclusion era comoda. Decia que
> `minSpread: 0.5`, `openOps: 1` y `dailyLossPct: 0` eran "politica, no medicion" y
> que quedaba "como decision pendiente, no bug".
>
> Solo `minSpread` es politica. `openOps: 1` afirma que hay una posicion abierta y
> `dailyLossPct: 0` afirma que el dia va limpio: son mediciones, exactamente el mismo
> crimen que `currentExposureUsdt: 0` en `simulate_trade_impact`. Clasificarlas como
> politica fue mi manera de no tener que tocar el motor determinista de riesgo.
>
> La novena vuelta lo demuestra: con esas constantes, las reglas 2 a 5 no podian
> dispararse.

`0fefaef` cierra los defaults de medicion del espejo. El `RuleContext` del servidor
queda fuera de ese commit y se resuelve en `aaf14e2` — ver la novena vuelta.

## Estado de los pendientes

Commits de esta vuelta, en orden de unidad de trabajo:

```
9200a4f  el servidor deja de autorizar sobre capital, contraparte y limite que nadie midio
d581297  la ventana BCV se recalcula con el reloj en vez de envejecer en silencio
0fefaef  el espejo de la app deja de inventar defaults de riesgo y exposicion
```

### Lo que queda abierto

| Pendiente | Por que |
| --- | --- |
| `DEFAULT_ACCOUNTS` en `initElectronSync` | Decision de producto: ¿SQLite es autoritativo o las cuentas son solo semilla? |
| `interventionProbabilityPct` | No hay modelo BCV calibrado; solo puede quedar `null` |
| `RuleContext` del espejo | `openOps: 1` y `dailyLossPct: 0` siguen como constantes; son medicion. Cerrado en el servidor por `aaf14e2`, no en el espejo |
| `evaluateUsdtDepegEvent` dormido | Nunca invocado; necesita ticker real de `USDTUSD` |
| `COTIZAVE_API_KEY` ausente | No hay puente desde `SecretStoreService` al daemon |
| Segundo venue live | Requiere credenciales Bybit/El Dorado |
| Worktree `p2p-bridge-build` | Figura `prunable`; no limpiar sin confirmar que no tiene trabajo sin commitear |

# Novena vuelta: los frenos que no podian dispararse

La octava cerro con una nota que decia que las constantes de `RuleContext` eran
politica y no medicion. Era falso, y la forma en que era falso es el hallazgo.

## Como se encontro

El resumen de la vuelta anterior dejaba `RuleContext` como "pendiente de
investigar". Investigation fue leer el motor, no el tool:

```
packages/mcp-server/src/core/index.ts
  L118  evaluate(ctx)
  L125  tradeRiskPct > 20      -> DENY     regla 1, la unica con dato real
  L134  dailyLossPct >= 10     -> PAUSE    regla 2
  L143  consecutiveErrors >= 3 -> DENY     regla 3
  L152  currentSpread < 0.5    -> PAUSE    regla 4
  L161  openOps >= 3           -> PAUSE    regla 5
```

Y lo que la tool le pasaba:

```
currentSpread: 1.25     contra un piso de 0.5     -> nunca dispara
dailyLossPct: 0         contra un tope de 10       -> nunca dispara
consecutiveErrors: score < 50 ? 2 : 0   contra 3  -> nunca dispara
openOps: 1              contra un tope de 3        -> nunca dispara
```

Cada constante caia **del lado seguro de su propio umbral**. Eso no las hacia
arbitrarias: las hacia inalcanzables. Las reglas 2 a 5 no eran incorrectas, no
existian. La tool solo podia devolver `ALLOW` o un `DENY` de la regla 1.

## El sintoma, medido

Un throwaway con `counterpartyScore: 0`, el peor valor que el schema acepta:

```json
{
  "decision": "ALLOW",
  "reason": "Todos los parametros dentro de umbrales seguros",
  "tradeRiskPct": 0.2,
  "isCounterpartyAcceptable": false,
  "violations": [],
  "unmeasuredInputs": ["currentSpread","minSpread","openOps","dailyLossPct"],
  "actionable": true
}
```

Auto-contradiccion en un mismo objeto: "tu contraparte no es aceptable" junto a
"todo dentro de umbrales seguros" y `actionable: true`. `violations` vacio hacia que
nada que el llamador evaluara lo frenara — un `ALLOW` que solo se podia refutar
leyendo un campo decorativo al lado. `dailyLossPct: 0` sobre un dia que habia
perdido 40% es el mismo crimen que `currentExposureUsdt: 0` en la vuelta septima,
a una escala peor: no es un default improbable, es el freno desconectado.

## La linea que lo delataba

```ts
consecutiveErrors: counterpartyScore < 50 ? 2 : 0,
```

Tope 2 contra umbral 3. Quien escribio eso intento meter la contraparte al motor y
no pudo: el valor nunca alcanza el umbral. La contraparte **nunca estuvo conectada
al veredicto**; el gate existia como campo informativo al lado de un `ALLOW`.

## Decision

Se le llevo al usuario con la evidencia, no con una recomendacion de formato. Elgio
la contenida: anadir los tres (cuatro) estados como inputs opcionales, alinear el
servidor con el espejo, y que sin estado medido no haya `ALLOW`.

Lo que se descarto y por que:

| Opcion | Por que no |
| --- | --- |
| Cambiar `RuleContext` a `number \| null` con `skippedRules[]` | Correcta y mas limpia, pero es un cambio de contrato en un core de 3359 lineas con casi-duplicado en `projects/core/src/lib/rules.ts`. Radio de blast innecesario para este defecto |
| Arreglar solo `reason` y `actionable` | Dejaba emitiendo `ALLOW` para una contraparte con score 0. Es lo que mas duele |

## aaf14e2 — el servidor se niega a correr el motor sin estado

- Schema: `currentSpreadPct`, `openOps`, `dailyLossPct` y `consecutiveErrors` pasan
  a ser inputs opcionales declarados por el llamador, sin defaults. Son estado.
  `minSpread` y `maxRiskPerTradePct` siguen como constantes y ahora estan nombradas
  `POLICY_*`.
- **La contraparte manda.** Score bajo 70 produce `DENY` con violacion y
  `actionable: true`. Precede a `INSUFFICIENT_DATA`: esconder un score de 30 detras de
  telemetria faltante esconderia un hecho conocido.
- **Sin estado no hay veredicto.** `INSUFFICIENT_DATA`, `actionable: false`,
  `violations: []`. `evaluate()` no puede representar "no medido" — toda comparacion
  contra un campo ausente es falsa, asi que un `0` o un `NaN` responderian `ALLOW`
  igual que las constantes que este commit elimina.
- `unmeasuredInputs` deja de ser una constante con las mismas cuatro ausencias y pasa
  a ser la lista real de lo que falta en esta llamada.
- `recommendedSizeUsdt` es `null` si el motor no corrio. `tradeRiskPct` sigue real: es
  un ratio entre numeros medidos y no necesita estado.

## La migracion de tests

Cinco tests afirmaban el comportamiento defectuoso, asi que hubo que migrarlos en vez
de ajustarlos. Uno merecio atencion: *"rechaza un trade grande con capital medido"*
usaba `counterpartyScore: 40` y su propio comentario decia que probaba la regla 1
(50% de capital contra el tope de 20%). Con la puerta nueva, un 40 cortocircuitaba en
contraparte y la regla 1 quedaba sin probar. Subido a 95: el test ahora prueba lo que
su comentario dice que prueba. Bajar el score habria sido mas facil y habria dejado
la regla 1 a oscuras.

## Mutacion

Restauradas las constantes viejas, **12 de 15** tests nuevos quedan en rojo:

- los tres de la puerta de contraparte
- los cuatro de "sin estado no hay `ALLOW`"
- los cinco de "las reglas 2 a 5 ahora disparan"

Los 3 que siguen verdes son las propiedades que ya eran ciertas y deben seguir
siendo: contraparte exactamente en el piso de 70, el ratio de riesgo real, y la
regla 1 funcionando. Un mutacion que pone todo en rojo no demuestra nada; esta
demuestra que los tests discriminan exactamente el defecto.

## Verificacion de esta vuelta

```
mcp-server        248/248 en 17 archivos   (antes 232)
p2p app           584/584 en 48 archivos
typecheck         exit 0 en los cinco proyectos
build del bundle  exit 0, dist 2.2mb
mutacion          12 de 15 en rojo al restaurar el defecto
```

**Flake registrado, no escondido.** `add_operation_entry escribe el asiento con los
montos y el precio reales` fallo en una corrida completa de la suite de la app, y paso
aislada (73/73) y en dos corridas completas siguientes. Intermitente, en el mismo
archivo donde ya se excluyo `timestamp`/`settlementId` de comparaciones byte a byte.
No lo introduce `aaf14e2`: la app no importa `packages/mcp-server`.

## La leccion

Anotar algo como "politica, no medicion" fue mi manera de no tocar el motor de riesgo.
La distincion era correcta para `minSpread: 0.5` y para `targetHedgePct: 100`, y la
reutilice a un caso donde no correspondia. **Clasificar un default como decision
legitima es la forma mas comoda de no arreglarlo** — y por eso hay que exigir el
umbral, no solo la etiqueta: si una constante esta del lado seguro de su propio
comparador, no es politica, es un freno desconectado.

## Estado de los pendientes

Commits de esta vuelta:

```
aaf14e2  evaluate_trade_risk deja de responder ALLOW sobre frenos que nunca corrieron
```

| Pendiente | Por que |
| --- | --- |
| `DEFAULT_ACCOUNTS` en `initElectronSync` | Decision de producto: ¿SQLite es autoritativo o las cuentas son solo semilla? |
| `interventionProbabilityPct` | No hay modelo BCV calibrado; solo puede quedar `null` |
| `evaluateUsdtDepegEvent` dormido | Nunca invocado; necesita ticker real de `USDTUSD` |
| Segundo venue live | Requiere credenciales Bybit/El Dorado |
| Worktree `p2p-bridge-build` | Figura `prunable`; no limpiar sin confirmar que no tiene trabajo sin commitear |

`packages/mcp-server/dist/index.js` salio de la lista de pendientes: esta gitignored
(`packages/mcp-server/.gitignore:5`) y es artefacto de build, no versionado. El build
corre y sale limpio; no era un commit pendiente sino una suposicion mia incorrecta.

# Décima vuelta: el espejo se alinea con el servidor y cae el flake misterioso

La novena vuelta cerró las constantes inalcanzables en `packages/mcp-server`. Esta vuelta
lleva esa misma honestidad al espejo de la app en `mcp-fallbacks.ts`, cierra el flake
histórico de `add_operation_entry`, y corrige la proyección de velocidad en el borde de
medianoche.

## Qué se corrigió

1. **Espejo de `evaluate_trade_risk` sin constantes seguras**:
   - `mcp-fallbacks.ts` ya no inyecta `openOps: 1`, `dailyLossPct: 0` ni `consecutiveErrors: score < 50 ? 2 : 0`.
   - Sin estado del motor (`currentSpreadPct`, `openOps`, `dailyLossPct`, `consecutiveErrors`), responde `INSUFFICIENT_DATA` y lista las ausencias en `unmeasuredInputs`.
   - Contraparte con score menor a 70 deniega de inmediato (`DENY` con `COUNTERPARTY_BELOW_MIN_SCORE_70`) antes de evaluar el motor.
   - Las reglas 2 a 5 ahora sí disparan en el espejo cuando se suministra el estado completo.
   - 6 tests nuevos agregados a `mcp-fallbacks-trade-authorization.spec.ts` (subiendo de 16 a 22).

2. **Diagnóstico y fin del flake de `add_operation_entry`**:
   - El test verificaba `expect(JSON.stringify(result)).not.toContain('82')` para evitar el viejo precio inventado `82.85`.
   - Al buscar la subcadena `'82'` en el JSON completo, fallaba aleatoriamente cuando el hash criptográfico generado (`cryptographicReceiptHash`) o el `orderId` contenían "82" (ej. `"hash_82plcb"`).
   - Corregido para comprobar que `result['price']` no sea el default inventado y usar el matcher estructurado `expectNoInventedNumbers`.

3. **Borde de medianoche en `Copilot`**:
   - En `copilot.ts`, a las 23:59 `minutesLeft` daba < 1 minuto y `Math.round(minutesLeft / remainingTransactions)` redondeaba a 0 minutos por ciclo. Se fijó con `Math.max(1, ...)`.

## Verificación de esta vuelta

- `mcp:test`: 248/248 tests en 17 archivos.
- `ng test p2p`: 595/595 tests en 49 archivos.
- `ng test core`: 952/952 tests en 79 archivos.
- `test:electron`: 244/244 tests en 22 archivos.
- Typechecks `tsconfig.app` y `tsconfig.spec`: exit 0.

# Undécima vuelta: el puente seguro de COTIZAVE_API_KEY hacia el daemon MCP

En la quinta vuelta conectamos `cotizave-official-reader.ts` al endpoint oficial del BCV en
`https://api.cotizave.com/v1/fx/rates`, el cual requiere la cabecera `X-API-Key` leída desde
`process.env['COTIZAVE_API_KEY']`. Sin embargo, la app Angular almacenaba y enviaba la clave
al backend de Electron en cada llamada IPC (`p2p:fetch-cotizave`), pero el proceso principal
no la inyectaba en el entorno del proceso ni la persistía de forma segura para el daemon MCP.

## Qué se corrigió

1. **Inyección en runtime para el daemon**:
   - En `electron/main/ipc/handlers.ts`, el handler `p2p:fetch-cotizave` normaliza y valida `req.apiKey`,
     e inyecta inmediatamente `process.env['COTIZAVE_API_KEY'] = trimmedKey`.
   - Con esto, tanto el daemon MCP embebido (`loadMcpModule()`) como cualquier subproceso
     heredan la credencial comercial en vivo y `fetchCotizaveOfficialReading()` puede obtener
     la tasa oficial real del BCV.

2. **Persistencia protegida por el SO (`safeStorage`)**:
   - Si el almacén criptográfico del sistema operativo está disponible (`isSecretStorageAvailable()`),
     la clave se cifra con DPAPI / Keychain y se almacena en SQLite (`app_config_kv`) bajo el esquema
     `safeStorage:v1`.
   - Si `safeStorage` no está disponible, no se escribe texto plano en el disco.
   - Al inicio de la aplicación en `registerIpcHandlers()`, se verifica si existe `cotizave_api_key`
     cifrada en `app_config_kv`. Si existe y el esquema coincide, se descifra e hidrata
     `process.env['COTIZAVE_API_KEY']` inmediatamente para que el servidor MCP arranque listo
     desde el primer segundo.

3. **Pruebas unitarias**:
   - 5 tests nuevos añadidos a `electron/main/ipc/handlers.spec.ts` (subiendo de 5 a 10 tests):
     - Rechazo ante clave ausente o en blanco.
     - Rechazo ante endpoint inválido.
     - Inyección en `process.env['COTIZAVE_API_KEY']` con normalización `trim`.
     - Cifrado y persistencia en `app_config_kv` con `safeStorage:v1`.
     - Hidratación automática en `registerIpcHandlers()` desde el almacenamiento seguro.

## Verificación de esta vuelta

- `test:electron`: **249/249** tests en 22 archivos (10/10 en `handlers.spec.ts`).
- `mcp:test`: **248/248** tests en 17 archivos.
- Typechecks `electron/tsconfig.json`: exit 0.