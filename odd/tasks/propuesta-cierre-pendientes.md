# Propuesta: cerrar lo que queda de "sin dato antes que dato inventado"

> Estado: **ejecutada**. Los bloques A, B y C están cerrados y verificados.
> D y E siguen abiertos y no son decisiones de código.
>
> Fecha de la propuesta: 2026-10-01 UTC
> Fecha de cierre: 2026-10-01 UTC · Autorizado a ejecutar

---

## Resumen de cómo terminó

La propuesta era de 7 unidades. Se ejecutaron, pero **el plan resultó estar mal en
dos cosas**, y eso importa más que la lista de commits:

**1. Dos de los cinco bloques ya estaban cerrados cuando se escribió la propuesta.**
El bloque B (las 11 tasas inventadas de Electron) se había cerrado en `3bfea3a`, y
el bloque C (`as const` + los dos errores TS) ya no estaba. Verificar el estado
antes de proponer siete unidades habría ahorrado la propuesta entera.

**2. Las rutas anotadas estaban mal.** El propio documento lo decía y aun así
planificó sobre ellas: `gemini-orchestrator.ts` y `alpha-watcher.ts` están en
`electron/main/`, no en subdirectorios. Lo que sí era cierto es que `baseUrl` y
`paths` del tsconfig de mcp-server estaban muertos y nadie los había revisado en
seis vueltas de barrido.

### Estado final por bloque

| Bloque | Qué era | Estado | Commit |
| --- | --- | --- | --- |
| **A** | Tests dependientes del reloj de pared | **Cerrado** | `010456c` |
| **B** | 11 tasas inventadas en Electron | **Cerrado** (antes, en `3bfea3a`) | `3bfea3a` |
| **C** | Typecheck del paquete mcp-server | **Cerrado** | `d9ee7fe` |
| **D** | `initElectronSync` mergea `DEFAULT_ACCOUNTS` | **Abierto — decisión tuya** | — |
| **E** | `interventionProbabilityPct` sin modelo | **Abierto — falta el modelo** | — |

---

## A. La bomba de reloj — cerrado en `010456c`

`getTodayOperations` ya tenía el reloj inyectado (`todayDateKey` como parámetro
trailing). `computeAccountUsage` no: leía `new Date()` por dentro para `monthKey`.

El spec previo lo esquivaba anclando los fixtures al mes UTC **en curso**, con
helpers que se adaptan al reloj. Eso desactiva el flake sin eliminar el defecto: el
test sigue sin poder fijar una fecha, así que nada verifica la semántica de fin de
mes.

Se aplicó el patrón que el propio archivo ya tenía dos líneas más arriba.
`computeTreasurySummary` reparte el mismo mes a todas las cuentas.

`recommendAccountForTrade` **no** recibió el parámetro, y hay un test que lo
custodia. Se le agregó por simetría y el test lo desmintió: su filtro lee límite
diario y saldo, y `todayOps` llega ya filtrado, así que el mes no puede alterar el
resultado. Un parámetro que no cambia la salida es un contrato publicado que no
existe.

Verificación: core 79/952, electron 21/224, `tsc` app y spec exit 0, vendor 24/24.

---

## B. Las tasas inventadas de Electron — cerrado en `3bfea3a`

Las 11 sitios están cerrados. Verificado sobre el árbol actual:

| Búsqueda | Resultado |
| --- | --- |
| `= 72.0;` `= 65.5;` `= 1.0;` (constantes incondicionales) | **0** |
| `bcvRate ?? 72.0` `parallelRate ?? 88.5` `?? '22.9'` | **0** |

Todos los sitios pasaron a `?? null`, y cada archivo lleva un spec que documenta el
estado anterior. El `?? '22.9'` de `strategist-agent.ts` merece atención aparte: no
es un número, es un **string**, así que un barrido de números nunca lo encuentra.
Sólo aparece porque el `??` lleva comillas.

`gemini-orchestrator.ts` y `alpha-watcher.ts` están en `electron/main/`, no en
subdirectorios. El comentario `"Reference anchor"` que etiquetaba el `65.5` inventado
como ancla de referencia ya no está.

---

## C. Typecheck del paquete mcp-server — cerrado en `d9ee7fe`

TypeScript 6.0.3 deprecaba `baseUrl` y lo elimina en 7.0. El typecheck del paquete
no corría: **TS5101 antes de compilar una sola línea**.

Podía silenced con `ignoreDeprecations`, que es deuda con fecha. Pero `baseUrl` y
`paths` estaban **muertos**: ningún archivo importa por `@p2p/mcp-server/*`, y sin
`paths` que resolver no hay nada que `baseUrl` aporte. Se borraron.

Vale la pena lo que esto destapa: el `tsc` de la raíz tiene `"files": []`, así que
da verde sobre cualquier cosa. El de este paquete era el único que cubría de verdad
ese código, y llevaba tiempo sin poder ejecutarse — o sea que **seis vueltas de
barrido declararon un typecheck verde que no se estaba ejecutando**.

---

## D. `DEFAULT_ACCOUNTS` — decisión tuya, sigue abierta

`initElectronSync` mergea cuentas por defecto en el estado de SQLite, en **cuatro**
sitios (`accounts.service.ts:236`, `:268`, `:528`, `:537`). El spec del actor
concurrente ahora acepta 17 cuentas donde antes exigía 1.

Aviso honesto: **el verde ahí es el problema, no la solución.** Es el mismo delito
de esta tarea movido un archivo — 16 cuentas bancarias inventadas en la tesorería
de un usuario real.

La pregunta de producto sigue sin responder: ¿SQLite es autoritativo, o las cuentas
por defecto son sólo semilla de una instalación nueva?

---

## E. `interventionProbabilityPct` — sigue abierta, y no es código

No hay modelo BCV calibrado. Lo que se hizo fue lo único honesto posible sin el
modelo: la probabilidad **debe aportarla el llamante** (`requiredNumber`), viaja
etiquetada con `probabilityBasis: 'HEURISTIC_UNCALIBRATED'`,
`isVerifiedIntervention: false` y `actionable: false`, y el texto ya no afirma
ninguna intervención.

O sea: la API sigue exponiendo un número que el sistema no puede calcular. Eso es
superficie de contrato, no un default, y cerrarlo requiere el modelo.

---

## Pendientes de infraestructura, anotados

| Pendiente | Por qué no lo toqué |
| --- | --- |
| `COTIZAVE_API_KEY` | No existe. Sin ella `get_bcv_rates` declara ausencia; el camino está probado con fixtures, no contra la API real. |
| Puente vault → daemon | `SecretStoreService` no habla con el daemon. Hay `electron/main/db/secret-store.ts` sin commitear del actor concurrente, que puede ser el comienzo. |
| Segundo venue live | Requiere credenciales Bybit / El Dorado. Sin él `dispersionPct` queda `null`, que es lo correcto. |
| `evaluateUsdtDepegEvent` dormido | Nunca invocado; necesita ticker real de `USDTUSD`. |

---

## Lo que sigue vivo del barrido

- **`packages/mcp-server/src/schemas/index.ts`**: `currentCapitalUsdt: 5000`,
  `currentExposureUsdt: 0`, `maxDailyExposureLimitUsdt: 2000`,
  `targetHedgePct: 100`. Los tres primeros son mediciones; `targetHedgePct` es
  política. Se corrigió `forecast_volatility_window` en `ff1067c` y quedó el resto
  del archivo.
- **Defaults de Electron en specs**: ninguno vivo.
- **`interventionProbabilityPct`**: ver E.
- **`packages/mcp-server/dist/index.js`**: sin regenerar.
