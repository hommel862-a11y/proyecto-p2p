# Triangulación: solo brechas ejecutables

- **Rama:** `feat/p2p-decision-tool-mvp`
- **Alcance:** la tabla de triangulación de `SpreadMonitor` y su alerta.
- **Fuera de alcance:** `/bcv` y el predictor de intervención (no se tocan).

## El defecto

El payload real de `GET https://api.cotizave.com/v1/fx/rates` (con `X-API-Key`)
devuelve, por tasa, **solo `mid`**:

```json
{ "country": "VE", "currency": "USD", "base": "VES",
  "rates": [ { "market": "bitget", "type": "p2p", "base": "USDT", "mid": 959.2,
               "updated_at": "...", "effective_date": "..." } ],
  "index": { "value": ..., "components": { "bcv": ..., "p2p": ..., "paralelo": ... },
             "p2p_median": ..., "p2p_count": ... },
  "fetched_at": "..." }
```

No hay `ask` ni `bid` en ninguna parte, y las entradas `type: "p2p"` tampoco
traen `base`.

`spread-monitor.ts` comparaba contra `rate.bid`, que siempre es `undefined`, así
que `computeTriangulationGap` devolvía `{gapVes:null, gapPct:null}` para toda
fila. La tabla renderizaba `bitget---- --  -- Sin brecha` y no había ninguna
brecha en pantalla. Peor: el guard `if (!depth) return []` borraba la tabla
entera cuando faltaba el libro de Binance, arrastrando los mids que sí eran
ciertos.

Latentemente peor que el `--`: `BybitP2pService.buyPrice` y `sellPrice` arrancan
en **808.5 y 813.0**, constantes de demo escritas a mano. El arreglo "natural"
—restar esos dos números contra el libro de Binance— habría producido brechas
en vivo a partir de un número que nadie cotizó.

## La regla

> Una brecha se emite únicamente cuando los dos lados son libros de órdenes
> reales. Todo lo demás es un ancla indicativa: número y etiqueta, sin brecha.

Un `mid` es **un** número. No describe oferta ni demanda, no tiene spread y no
tiene profundidad. Restarle dos mids produce un número con apariencia de brecha
que nadie puede ejecutar, y esta app informa decisiones de trade con plata real.

## Diseño

Módulo puro nuevo, `executable-gaps.ts`, con la regla de oro en un solo lugar:

| pieza | responsabilidad |
|---|---|
| `resolveBybitBook` | ¿es la pata de Bybit un libro real? Devuelve el libro **o el motivo**. |
| `computeExecutableGaps` | Las dos brechas del par, o ninguna. |
| `buildTriangulationRow` | Clasifica la fila y aplica `NO_GAP` a todo lo no ejecutable. |

### El gate de Bybit

Lee el precio **dentro de la oferta** (`bestSellOffer.price`,
`bestBuyOffer.price`), nunca de `buyPrice`/`sellPrice`. Los `bestXOffer` solo los
escribe el camino que ya validó un libro real y quedan en `null` hasta entonces,
así que el default de demo **deja de ser alcanzable por construcción**: no es una
condición que haya que recordar, es una ruta que no existe.

`mode === 'live'` y `lastFetched` son la segunda red, no la primera: `mode` se
activa al guardar credenciales (antes de cotizar) y `lastFetched` solo lo escribe
un `refresh()` exitoso. Cada falta devuelve un motivo distinto.

`bestSellOffer` = lo que se **paga** en Bybit. `bestBuyOffer` = lo que se
**recibe**.

### Convención de `computeTriangulationGap`

La convención de core (`projects/core/src/lib/cotizave.ts`) es `bid` = lo que se
**paga** y `ask` = lo que se **recibe**, documentada en el propio módulo. Por eso
se le pasa `payPrice` como `bid` y `receivePrice` como `ask`:

- `gapForward` = paga en Binance, recibe en Bybit.
- `gapReverse` = paga en Bybit, recibe en Binance.

Falta cualquiera de los dos libros → `NO_GAP` en **ambos** sentidos. Una brecha a
medias no es una brecha.

### Clasificación de filas

| fila | clase | gaps |
|---|---|---|
| `bybit` con ambos libros | `executable` | los dos, calculados |
| `bybit` sin uno de los dos | `anchor` + motivo | ninguno |
| `bitget`, `okx`, `bingx`, `mexc`, `saldo`, `eur_reference` | `anchor` | ninguno |
| `oficial` (BCV), `parallel` | `reference` | ninguno |

`oficial` y `parallel` son tasas únicas. El diferencial entre ellas es la señal
regulatoria de `calculateBcvGap` (core) que consume el comando `/bcv` de
Telegram: es una señal real y valiosa, pero **no es arbitraje** —no hay nada que
ejecutar— así que aquí no se le inventa ninguna brecha. Se mantiene separada y
sin tocar.

`binance` se filtra de la tabla: no es un venue a comparar, es el libro contra el
que se mide todo lo demás, y ahora se declara arriba con sus dos puntas.

### La tabla ya no se vacía

Las filas se construyen aunque no exista profundidad de Binance. Los mids de
Cotizave son ciertos; lo que no hay es con quién cruzarlos. Cada fila lleva
además `provenance`, `fetchedAt` y `dataAge`, porque `rate.updated_at` es el
sello del upstream **por tasa** y no dice cuándo se hizo el fetch.

### La alerta

`triangulationAlert` filtra por `row.kind === 'executable'`. Segunda red: una
ancla o una tasa de referencia no encienden la señal ni aunque un bug futuro les
fabricara un número.

## Counterfactual (RED antes del arreglo)

Los tests se escribieron primero contra el código sin arreglar, usando solo la
superficie pública, y fallaron por la razón correcta:

```
Tests  7 failed | 3 passed (10)
```

| caso | fallo literal |
|---|---|
| brecha hacia adelante | `expected null to be 1` |
| brecha inversa | `expected null to be 10` |
| fila Bybit en demo | `expected 'bybit---- --  -- Sin brecha' to match /demo/i` |
| fila bitget | `expected 'bitget---- --  -- Sin brecha' to contain '959,20'` |
| BCV | `expected 'oficial---- --  -- Sin brecha' to match /referencia/i` |
| único venue con brecha | `expected [] to deeply equal [ 'bybit' ]` |
| sin libro de Binance | `expected undefined to be null` (la tabla entera no existía) |

F3, F5 y F9 pasaban de casualidad: el código anterior no emitía ninguna brecha,
así que "no hay brecha" era cierto por la razón equivocada. Quedan como guardas
contra regresión.

## Verificación

| comando | resultado |
|---|---|
| `npx ng test p2p --include='**/spread-monitor.spec.ts' --watch=false` | 23 passed (12 previos + 11 nuevos), exit 0 |
| `npx ng test p2p --include='**/cotizave.service.spec.ts' --watch=false` | exit 0 |
| `npx ng test p2p --include='**/binance-p2p.service.spec.ts' --watch=false` | exit 0 |
| `npx ng test p2p --include='**/bybit-p2p.service.spec.ts' --watch=false` | exit 0 |
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` | `All files pass linting` en `p2p` y en `core`, exit 0 |

## Hallazgo colateral (NO corregido)

`src/app/core/triangulation-intelligence.service.ts:317-322` lee
`cotizaveRates['paralelo']` y `cotizaveRates['bcv']`. Con el payload real esas
claves **no existen**: `normalizeMarketKey` produce `parallel` y `oficial`
(alias declarado en `KNOWN_MARKET_ALIASES`). Ambos accesos dan `undefined`, y el
`if (...?.mid && ...mid > 0)` los descarta en silencio. Está fuera del alcance
de este cambio y queda reportado para una ODD propia.

## Archivos

- `src/app/features/spread-monitor/executable-gaps.ts` — nuevo, regla de oro.
- `src/app/features/spread-monitor/spread-monitor.ts` — inyecta Bybit, gate,
  filas, alerta.
- `src/app/features/spread-monitor/spread-monitor.html` — columnas y etiquetas
  honestas, patas del cruce, motivo por fila.
- `src/app/features/spread-monitor/spread-monitor.scss` — estilos nuevos.
- `src/app/features/spread-monitor/spread-monitor.spec.ts` — 11 tests nuevos.

Sin tocar: `projects/core/src/lib/cotizave.ts`, `bybit-p2p.service.ts`,
`binance-p2p.service.ts`, `bcv-intervention-predictor.ts`.
