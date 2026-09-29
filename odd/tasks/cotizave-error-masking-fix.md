# ODD — Cotizave: el error real se descarta y la cache no existe (bugfix)

## Objective

Que `CotizaveService.fetchRates()` deje de mentir. Hoy el usuario de escritorio ve `Cotizave no disponible y sin caché previa`, un mensaje que no dice qué pasó ni qué hacer. Este workstream quita el enmascaramiento: el breaker deja de ganar la carrera contra el transporte, el fallback siempre declara la causa real, y la "caché" que el fallback promete pasa a existir después de un reinicio.

## Problem

Tres defectos se combinan en `src/app/core/cotizave.service.ts` y producen exactamente ese mensaje:

- **D1 — inversión de timeouts (el detonante).** El `CircuitBreaker` se construye sin `requestTimeoutMs`, así que usa el default `10_000` ms (`projects/core/src/lib/circuit-breaker.ts:92`). El transporte que envuelve da **más** tiempo: el handler IPC de Electron usa `AbortSignal.timeout(15000)` (`electron/main/ipc/handlers.ts:206`). El breaker corre la operación contra su propio timeout (`executeWithTimeout`, circuit-breaker.ts:238), así que **gana la carrera 5 segundos antes de que exista el error real**. Cuando el upstream está en modo tarpit, el breaker expira solo, con `lastError === null`.
- **D2 — `lastError` se pierde.** `let lastError: unknown = null` (línea ~69) solo se asigna dentro del `catch` de `executeNetworkCall`. Por D1, el fallback corre mientras la llamada IPC sigue en vuelo → `lastError` sigue `null` → `lastMsg === ''` → las ramas 401 (línea ~99) y 403 (línea ~105) se saltan y se cae en el `throw` genérico. La misma pérdida ocurre en el fast-fail de circuito OPEN (circuit-breaker.ts:139-147): `execute()` devuelve el fallback **sin invocar nunca la operación**, así que el mismo genérico se repite durante los 25 s completos de cooldown.
- **D3 — la cache que el fallback promete no puede existir.** `readonly ratesByMarket = signal<Record<string, CotizaveRate>>({})` (línea ~17) es una signal en memoria pura, jamás persistida. Después de cualquier reinicio es `{}` y la rama de rescate de la línea ~94 nunca puede disparar. "sin caché previa" es **siempre** cierto después de un reinicio. El repo ya trae `StorageService` (`src/app/core/storage.ts`) con `get<T>/set<T>` **síncronos**.

**Defecto relacionado (d):** `normalizeCotizaveRates(result)` devuelve `{}` para una forma de payload no reconocida, y el código hace `this.ratesByMarket.set({})` y reporta **éxito**. Eso borra la caché en silencio y convierte el siguiente fallo en "sin caché previa" aunque una llamada anterior haya sido exitosa.

### Evidencia medida del upstream (no es nuestro bug, pero tampoco se esconderá)

Sondas contra `https://api.cotizave.com/v1/fx/rates` desde esta máquina:

| Escenario                             | Resultado observado                                      |
| ------------------------------------- | -------------------------------------------------------- |
| Sin `X-API-Key`                       | `403` + `text/html` (página de bloqueo de Cloudflare)    |
| Con `X-API-Key` válido                | `200` + JSON de rates, rápido                            |
| Con `X-API-Key` (inválido/sospechoso) | tarpit: la respuesta no llega hasta que dispara el abort |

Upstream no es confiable y no es el objetivo. El objetivo es que la app **no tire el diagnóstico a la basura** y que la cache del fallback sea real.

## Why fix

La app es una herramienta de apoyo a decisiones sobre plata real. Un mensaje de error que oculta la causa hace que el usuario persiga la causa equivocada: "sin caché previa" invita a reiniciar la app, cuando el problema real es una key inválida (401), un plan que no incluye `/v1/fx` (403), un upstream inalcanzable, o un circuito que ya está protegiendo el servicio. Cada una de esas causas tiene una acción distinta. Además, una caché que solo vive en memoria es peor que no tener caché: promete datos y después de un reinicio no puede sostener la promesa, así que la app se contradice a sí misma.

## Scope

- `src/app/core/cotizave.service.ts` — D1 (`requestTimeoutMs: 20_000`), D2 (fallback honesto: circuito OPEN, causa real, red/timeout, genérico accionable), D3 (persistencia vía `StorageService` + helper de edad en español), (d) guarda de payload vacío.
- `src/app/core/cotizave.service.spec.ts` — 6 tests nuevos (guarda de inversión, error real no tragado, circuito OPEN honesto, hidratación de cache persistida, fallback usa la cache persistida con edad, payload vacío es fallo). Los 5 tests existentes se mantienen intactos.
- `odd/tasks/cotizave-error-masking-fix.md` — este documento.

## Out of scope

- Arreglar el comportamiento de Cotizave/Cloudflare upstream. No es controlable desde la app.
- Hardcodear cualquier API key.
- Tocar `electron/main/ipc/handlers.ts`, `electron/main/index.ts`, `projects/core/src/lib/circuit-breaker.ts` o `projects/core/src/lib/cotizave.ts`. El `CircuitBreaker` es compartido con `binance-p2p.service.ts`; cambiar core compartido para este fix es fuera de alcance.
- `npm run sync:vendor` y cualquier cosa bajo `electron/main/vendor/`.
- Cambios en la rama: el commit va en `feat/p2p-decision-tool-mvp`.

## Constraints

- El breaker debe **superar** el timeout del transporte (15 000 ms) o el diagnóstico real vuelve a perderse. La guarda que lo fija es un test.
- Las ramas 401 y 403 se conservan tal cual: tienen test de regresión y son el diagnóstico correcto.
- La edad de la caché se muestra siempre que el fallback sirva datos cacheados: una caché vieja nunca se presenta como fresca. Por eso el camino de fallback **no** actualiza `lastFetched()`.
- Un payload que normaliza a `{}` es un **fallo**, no un éxito: no se pisa la caché ni se persiste una caché vacía.
- Persistencia síncrona en el constructor (`StorageService.get` es síncrono); el `hydrate()` asíncrono de la API key queda intacto.
- Clave de storage con la convención del repo: `p2p.cotizave.rates`.
- TDD estricto: los tests se escriben y se ven fallar antes de la implementación.
- Work-unit commit único en la rama actual, sin atribución de IA, sin trailer `Co-Authored-By`.
- Cambios preexistentes ajenos en el working tree (`electron/main/vendor/p2p-core/money.ts`, `projects/core/src/lib/money.ts`, `src/app/app.scss`, `electron-launch.log`, `docs/backtesting/*`, `odd/reviews/`, `odd/tasks/codebase-remediation.md`): **nunca** stagear, revertir ni commitear.

## Authorized scope

Los 3 archivos listados arriba. Un commit work-unit en `feat/p2p-decision-tool-mvp`. Push/PR/merge = decisión del usuario.

## Acceptance criteria

1. `svc.circuitBreaker.options.requestTimeoutMs > 15_000` (un test lo fija; una regresión de la inversión rompe la suite).
2. Un rechazo real del IPC de Electron aparece **dentro** de `error()`, no reemplazado por un genérico. Un rechazo lento (más lento que el breaker) también cuenta.
3. Con el circuito OPEN y sin caché, el error menciona el circuito abierto y **no** dice "no disponible y sin caché".
4. Las ramas 401 y 403 siguen mostrando su diagnóstico (test de regresión existente).
5. Tras un reinicio (servicio nuevo, mismo storage), `ratesByMarket()` ya está poblado **antes** de cualquier llamada de red, y `lastFetched()` conserva la marca original.
6. El fallback con caché persistida mantiene `ratesByMarket()` poblado y advierte con la **edad** de esa caché.
7. Un 200 JSON de forma no reconocida deja `error()` no nulo, no borra la caché previa y no persiste una caché vacía.
8. `npx tsc --noEmit` limpio, `npm run lint` sin fallos nuevos, spec completo verde.

## Applicable checks

- `npx ng test p2p --include='**/cotizave.service.spec.ts' --watch=false` (scoped; `ng test` sin `p2p` también intenta el target de `core` con el mismo `--include` y aborta con "No tests found", así que el scoping por proyecto es obligatorio)
- `npm test` (suite completa, para descartar regresiones fuera del spec)
- `npx tsc --noEmit`
- `npm run lint`
- `git diff -- src/app/core/cotizave.service.ts src/app/core/cotizave.service.spec.ts odd/tasks/cotizave-error-masking-fix.md`

## Tasks

- [x] **T1** Tests RED: guarda de inversión (D1), error real no tragado (D2), circuito OPEN honesto (D2), hidratación de caché persistida (D3), fallback usa la caché persistida con edad (D3), payload vacío es fallo (d).
  - Evidencia: 6 tests nuevos agregados al spec. RED observado con `npx ng test p2p --include='**/cotizave.service.spec.ts' --watch=false` → `Test Files 1 failed (1)` / `Tests 6 failed | 5 passed (11)`, exit 1. Fallos literales: `expected 10000 to be greater than 15000`; `expected 'Cotizave no disponible y sin caché pr…' to contain 'Servidor Cotizave no accesible (sin c…'`; `expected 'cotizave no disponible y sin caché pr…' to contain 'circuito'`; `expected 0 to be greater than 0` (×2, hidratación y fallback); `expected null not to be null` (payload vacío). Los 5 tests preexistentes quedaron verdes en la corrida RED.
- [x] **T2** D1: `requestTimeoutMs: 20_000` explícito en el `CircuitBreaker` + comentario en español explicando por qué el breaker tiene que durar más que el transporte.
  - Evidencia: `src/app/core/cotizave.service.ts` — `requestTimeoutMs: 20_000` con el comentario de la carrera contra `AbortSignal.timeout(15000)` del handler IPC.
- [x] **T3** D2: fallback honesto — rama de circuito OPEN, rama de red/timeout, causa real embebida, genérico accionable; 401/403 intactas.
  - Evidencia: `stateBefore = this.circuitBreaker.getState()` se captura antes de `execute()`; con `stateBefore === 'OPEN'` y sin caché se lanza `Circuito de Cotizave abierto: … en protección por 25 s … Reintentá en un momento.`; el patrón `NETWORK_CAUSE` agrega `Servidor Cotizave no accesible: <real>. …`; cualquier otra causa real sale como `Cotizave no disponible: <real>`; el genérico sobreviviente se volvió accionable. Los dos `throw` 401/403 quedaron byte a byte como estaban. La distinción "el breaker cortó la llamada" vs "la llamada corrió y falló" es lo que hace honesto el mensaje de circuito abierto: en la 3ª falla el breaker acaba de abrirse, y decir "protección" ahí sería falso.
- [x] **T4** D3: `StorageService` inyectado, hidratación síncrona en el constructor, persistencia en cada éxito, helper de edad en español, clave `p2p.cotizave.rates`, y el camino de fallback no refresca `lastFetched()`.
  - Evidencia: `private readonly storage = inject(StorageService)`; `hydrateRatesFromStorage()` + `readPersistedRates()` (a prueba de un storage que lanza) se corren en el constructor antes de `void this.hydrate()`; `persistRates()` guarda `{ rates, fetchedAt }` en `p2p.cotizave.rates` en cada `set(rates)` exitoso, envuelto en `try/catch` (best-effort); `formatCacheAge()` produce `hace menos de 1 min` / `hace N min` / `hace N h` / `hace N d`; el flag `servedFromCache` impide que el camino de fallback toque `lastFetched`.
- [x] **T5** (d) guarda de payload vacío: `{}` normalizado es fallo, sin pisar ni persistir caché.
  - Evidencia: `if (Object.keys(rates).length === 0) throw new Error('Cotizave devolvió una respuesta sin datos reconocibles (HTTP 200 con payload inesperado). Se conserva la caché anterior.')`, colocado **después** de normalizar y **antes** de cualquier `set`/`persist`.
- [x] **T6** Verificación: spec scoped, suite completa, `tsc --noEmit`, `lint`, relectura del diff propio.
  - Evidencia: ver "Verificación" abajo.
- [x] **T7** Commit work-unit único en `feat/p2p-decision-tool-mvp` con solo los 3 archivos del feature.
  - Evidencia: `fix(cotizave): conserva el error real y persiste la cache de rates` — 3 archivos, 461 inserciones / 4 eliminaciones. Los cambios preexistentes del árbol (`money.ts` en vendor y core, `app.scss`, `electron-launch.log`, `gemini-orchestrator.ts`, `docs/backtesting/*`, `odd/reviews/`, `codebase-remediation.md`) quedaron fuera del staging.

## Verificación

Runner: `ng test` (Angular 22 + vitest 4.1.11). **`ng test` sin nombre de proyecto no sirve para el filtro**: corre el target de `p2p` (ok) y después el de `core` con el mismo `--include`, que no matchea nada y aborta con `No tests found matching the following patterns: - Included: **/cotizave.service.spec.ts` (exit 1). El scoping correcto es `npx ng test p2p --include=…`.

| Check                            | Comando                                                                              | Resultado observado                                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Línea base (antes de tocar nada) | `npx ng test p2p --include='**/cotizave.service.spec.ts' --watch=false`              | `Test Files 1 passed (1)` / `Tests 5 passed (5)`, exit 0                                                                |
| RED (T1)                         | ídem                                                                                 | `Tests 6 failed \| 5 passed (11)`, exit 1                                                                               |
| GREEN                            | ídem                                                                                 | `Test Files 1 passed (1)` / `Tests 11 passed (11)`, exit 0 (re-verificado 2 veces, incl. después de `prettier --write`) |
| Typecheck                        | `npx tsc --noEmit`                                                                   | exit 0                                                                                                                  |
| Lint                             | `npm run lint`                                                                       | exit 1 con `21 problems (21 errors, 0 warnings)` — **0 en los archivos de este workstream**                             |
| Formato                          | `npx prettier --check` (los 3 archivos)                                              | `All matched files use Prettier code style!`                                                                            |
| Diff propio                      | `git diff -- src/app/core/cotizave.service.ts src/app/core/cotizave.service.spec.ts` | 328 líneas, solo los 3 defectos + la guarda de payload vacío; ningún cambio ajeno                                       |

### Los 21 errores de lint y los 6 tests rojos de la suite completa son preexistentes

- **Lint**: los 21 errores viven en `accounts.service.ts`, `mcp-ad-publisher.service.ts`, `telegram-worker.service.spec.ts`, `dashboard.html`, `invoice-modal.component.ts` y `remittances.component.html`. `git diff --name-only HEAD -- <esas 6 rutas>` devuelve **vacío**: están exactamente como en HEAD, así que sus errores de lint no pueden venir de este cambio. (Había un 22º error propio —`no-useless-assignment` en `cotizave.service.ts:74`, causado por un `let persisted = null` reescrito a un helper— y se corrigió antes de commitear.)
- **Suite completa** (`npm test -- --watch=false`): `p2p` → `3 failed | 36 passed (39)` archivos, `5 failed | 386 passed (391)` tests; `core` → `1 failed | 73 passed (74)` archivos. Los 6 tests rojos son `app.spec.ts` (espera 11 links de nav y hay 12), `ad-composer.service.spec.ts` (×3) y `mcp-hub.spec.ts` (`UNVERIFIED_OFFLINE` vs `LOW_RISK`), más `pdf-invoice-generator.spec.ts` en core.
  **Verificado empíricamente como preexistente**: con mis dos archivos guardados en un stash (`git stash push -- src/app/core/cotizave.service.ts src/app/core/cotizave.service.spec.ts`) y el árbol por lo tanto en el estado previo al fix, la corrida de esos 3 specs falla con **exactamente los mismos 5 tests** (`Test Files 3 failed (3)`). Stash restaurado con `git stash pop`; la corrida scoped volvió a 11/11. Ninguno de esos archivos toca Cotizave.
  Esto coincide con la deuda ya registrada en `odd/tasks/decision-journal.md` ("`npx ng test p2p`: 22 fallos … verificado en árbol limpio: es preexistente").

## Progress

- [x] Línea base medida antes de tocar nada: `npx ng test p2p --include='**/cotizave.service.spec.ts' --watch=false` → `Test Files 1 passed (1)` / `Tests 5 passed (5)`, exit 0.
- [x] Descifrado el orden real de la carrera: `CircuitBreaker.execute()` llama a `recordFailure()` **antes** de invocar el fallback (circuit-breaker.ts:172-178), así que cada `fetchRates()` fallido cuenta una falla del circuito — 3 llamadas fallidas abren el circuito con `failureThreshold: 3`.
- [x] Detectado un cuarto defecto en el mismo camino: cuando el fallback devuelve la caché, `fetchRates()` hacía `lastFetched.set(new Date())` igual, así que una caché vieja se anunciaba como fresca. Corregido en T4 (el camino cacheado no refresca la marca).
- [x] Determinismo de los tests: `StorageService` consulta `IndexedDbStorageService` (L1 memoria + espejo a `localStorage`) **antes** del adapter. En jsdom, `localStorage` es global y sobrevive entre tests y entre archivos (`--isolate` en `false`), así que un `set` de un test anterior envenenaría la caché de un test nuevo. Los tests proveen un stub explícito de `IndexedDbStorageService` que devuelve `null` y el `P2P_STORAGE` real sobre `MemoryStorage`: el contrato de persistencia se ejercita sobre el `WebStorageAdapter` real sin depender de `localStorage`.
- [x] T1: RED observado (6/6 fallan por la razón correcta, incluido el síntoma exacto reportado).
- [x] T2..T5: implementados (evidencia arriba). T3, T4 y T5 los fijan los tests nuevos; T2 lo fija la guarda de inversión.
- [x] T6: verificación completa (tabla arriba), incluida la demostración de que lint y suite completa fallan igual sin este cambio.
- [x] T7: commit work-unit único con los 3 archivos del feature.

## Next step

Push / PR / merge = decisión del usuario. La deuda preexistente (21 errores de lint, 5 tests rojos en p2p, 1 en core) queda registrada en `odd/tasks/codebase-remediation.md` y fuera de este workstream.

---

# Workstream 2 — La app dice que tiene dato fresco cuando no lo tiene

Continuación del bugfix de arriba, sobre el mismo commit base. El workstream 1 arregló
**por qué** el mensaje era falso; este arregla **qué** se afirma cuando el mensaje es cierto:
una tasa puede llevar días guardada y las tres superficies que la muestran la presentan
como recién descargada.

## Objective

Que ninguna superficie (dashboard, triangulación, Telegram) pueda afirmar que un número de
Cotizave está al día sin que el reloj y la procedencia del dato voyageen con él, y que la app
deje de tirar el diagnóstico real a la basura cuando el transporte y el breaker cuentan la misma falla.

## Problem

- **W1 — la caché persistida no caduca.** D3 grudó la persistencia, pero `readPersistedRates()`
  hidrata lo que encuentre en `p2p.cotizave.rates` sin mirar la edad. Una entrada de hace 400
  días hidrata igual que una de hace un minuto: la app arranca mostrando una brecha cambiaria
  calculada con datos de hace más de un año como si fuera operable.
- **W2 — no existe el concepto de procedencia.** `lastFetched()` dice _cuándo_ se recogió el
  dato, no _de dónde_ salió. Un `restore` del disco y un fetch en vivo producen el mismo estado
  observable, así que el consumidor no puede diferenciarlos ni aunque quiera.
- **W3 — los tres consumidores mienten o calculan el reloj sobre el dato equivocado.** El
  dashboard no muestra ninguna edad para la brecha; el snapshot de
  `TriangulationIntelligenceService` se estampa con `new Date()` en cada llamada, así que
  restaurar del disco genera un número con timestamp de "recién cotizado"; y el reporte `/bcv`
  de Telegram fecha el dato de BCV con `this.binance.lastFetched()`.
- **W4 — el diagnóstico clasificado se pisa.** El patrón `NETWORK_CAUSE` matchea el substring
  `Failed to fetch` sobre el mensaje del `catch`, así que también matchea el `Failed to fetch`
  que ya viaja **dentro** del diagnóstico clasificado y lo reemplaza por el texto genérico de
  CORS/puente local. La causa real se descarta exactamente cuando se la clasificó bien.
- **W5 — el payload vacío se cuenta como éxito del breaker.** La guarda de (d) corre fuera de la
  operación, después de que `execute()` ya llamó `recordSuccess()`. Tres 200 con forma no
  reconocida dejan el breaker en `totalSuccesses: 3` / `totalFailures: 0`: el circuito nunca abre
  para el modo de fallo que más de una app en producción ve.
- **W6 — el corte por `AbortSignal` del puente no se distingue de un timeout.** Sin el cambio
  upstream, la app no puede decir "cortado" vs "venció".

## Scope

- `src/app/core/cotizave.service.ts` — TTL de 15 min, `ratesProvenance`, descarte con aviso,
  helpers compartidos de edad y procedencia, clasificación de errores, guarda de payload
  vacío adentro del breaker, comentario de la limitación de cancelación.
- `src/app/core/cotizave.service.spec.ts` — regresiones permanentes de W1, W2, W4 y W5, y
  actualización de los 2 tests preexistentes que sembraban una caché de 2 h.
- `src/app/core/triangulation-intelligence.service.ts` + `.spec.ts` (nuevo) — reloj del dato y
  procedencia en el snapshot (W3).
- `src/app/core/telegram-worker.service.ts` + `.spec.ts` — reloj y procedencia del dato de BCV,
  con el reloj de Binance conservado y etiquetado como lo que es (W3).
- `src/app/features/dashboard/dashboard.ts` / `.html` / `.spec.ts` — edad y procedencia de las
  tasas que alimentan la brecha (W3).
- `odd/tasks/cotizave-error-masking-fix.md` — este documento.

## Out of scope

- Todo lo del workstream 1: `requestTimeoutMs`, ramas 401/403, `stateBefore`, persistencia.
- `electron/main/ipc/handlers.ts`: la distinción cancelación/timeout del puente se documenta, no
  se implementa (W6).
- `src/app/features/triangulation/triangulation.ts`: este workstream arregla de dónde viene el
  reloj del snapshot, no su presentación.
- Tocar `LiveMarketRatesSnapshot.timestamp` más allá del servicio que lo produce.

## Constraints

- El TTL se declara con una constante exportada: 15 min no es un número mágico y 15_000 sería
  indistinguible del `requestTimeoutMs` de 20 ms del workstream 1.
- Servir la caché en el fallback **no** cambia la procedencia a `live`: no hubo red.
- La procedencia se declara solo si se puede probar. `none` con tasas en pantalla es un estado
  inconsistente y la respuesta honesta es omitirla, no promoverla a `live`.
- El texto genérico de CORS/puente local **no se borra**: se conserva dentro del diagnóstico
  clasificado, que es donde el operador lo necesita y donde antes quedaba tapado.
- `formatCotizaveDataAge` y `describeCotizaveProvenance` viven en el servicio y se importan en
  los tres consumidores: "restaurado del disco" tiene que significar lo mismo en las tres
  superficies.
- La edad y la procedencia se derivan de las **mismas** signals que usa el número al que se
  atribuyen, en el mismo `computed`.
- TDD estricto por ítem: reproducción observada en rojo antes de tocar la implementación.

## Tasks

- [x] **T8** W1 + W2: `COTIZAVE_CACHE_MAX_AGE_MS` (15 min), descarte con borrado de la entrada
      persistida, `ratesProvenance` y los dos helpers compartidos.
  - Evidencia RED: throwaway `cotizave.repro.spec.ts` → `Test Files 1 failed (1)` /
    `Tests 4 failed (4)`; W1 `expected [ 'binance' ] to have a length of +0 but got 1`; W2
    `TypeError: s.ratesProvenance is not a function`. GREEN: `Tests 4 passed (4)`, exit 0.
- [x] **T9** W4: el diagnóstico clasificado gana en el `catch`; el genérico queda como red de
      seguridad para un fallo de transporte **sin clasificar**.
  - Evidencia RED: `expected 'Error de red/CORS al conectar con Cotizave. Abrí la app de
escritorio…' to contain 'Servidor Cotizave no accesible'`. GREEN: el mensaje contiene
    `Servidor Cotizave no accesible` **y** `Failed to fetch` **y** `puente local de cotizaciones`,
    y ya no arranca con `Error de red/CORS al conectar`.
- [x] **T10** W5: la guarda de payload vacío corre dentro de la operación del breaker.
  - Evidencia RED: con tres 200 de forma irreconocible, `totalFailures` era `0` y
    `totalSuccesses` `3`. GREEN: `totalFailures: 3`, `totalSuccesses: 0`, `state: 'OPEN'`, y la
    cuarta llamada no toca la red.
- [x] **T11** W3 RED: 5 tests del snapshot de mercado, 1 del dashboard y 2 de Telegram.
  - Evidencia RED: `Tests 6 failed | 83 passed (89)`, exit 1. Fallos literales: `expected '3:29:34
p. m.' to be '8:30:00 a. m.'`; `expected undefined to be 'restored'`; `expected undefined to
be 'live'`; `expected 'Centro de ControlApple Pro EditionTer…' to contain 'hace 20 min'`;
    `expected '🏛️ *INTELIGENCIA CAMBIARIA BCV* 🏛️…' to contain '08:05'` y el de `09:00`. **0
    regresiones**: los 83 restantes pasaron en la misma corrida.
- [x] **T12** W3 GREEN: reloj del dato + procedencia en los tres consumidores.
  - Evidencia: `Tests 104 passed (104)` en los 4 specs afectados.
- [x] **T13** W6: comentario en el camino del puente registrando que `AbortSignal` no distingue
      cancelación de timeout y que el corte se lee como timeout.
- [x] **T14** Verificación completa y commit work-unit único.

## Verificación (workstream 2)

| Check                    | Comando                                                               | Resultado observado                                                                                 |
| ------------------------ | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Baseline antes de editar | `npx ng test p2p --include='**/cotizave.service.spec.ts' …`           | `Tests 11 passed (11)`, exit 0                                                                      |
| RED core (T8-T10)        | `npx ng test p2p --include='**/cotizave.repro.spec.ts' --watch=false` | `Tests 4 failed (4)`, exit 1                                                                        |
| GREEN core (T8-T10)      | ídem                                                                  | `Tests 4 passed (4)`, exit 0                                                                        |
| RED consumidores (T11)   | 3 `--include` (triangulation, dashboard, telegram)                    | `Tests 6 failed \| 83 passed (89)`, exit 1                                                          |
| GREEN final (T12)        | 4 `--include` (cotizave, triangulation, dashboard, telegram)          | `Test Files 4 passed (4)` / `Tests 104 passed (104)`, exit 0                                        |
| Typecheck                | `npx tsc --noEmit`                                                    | exit 0                                                                                              |
| Formato                  | `npx prettier --check` (los 9 archivos del workstream)                | `All matched files use Prettier code style!`                                                        |
| Lint                     | `npm run lint`                                                        | `21 problems (21 errors, 0 warnings)` — **distribución idéntica a la línea base**: 0 errores nuevos |

### Los 2 tests preexistentes que hubo que cambiar, y por qué

`hydrates the rates from the persisted cache…` y `serves the persisted cache when the network
path fails…` sembraban `fetchedAt` con **2 horas** de antigüedad y el segundotcassertaba
`toContain('hace 2 h')`. Con W1 esos dos tests describen un comportamiento que el fix prohíbe a
propósito: sembrar una caché expirada y esperar que la app la use. Se cambiaron a 4 min
(dentro del TTL) y la aserción a `hace 4 min`. La cobertura que antes probaba "una caché vieja se
sirve igual" ahora la cubre el test nuevo de descarte, que es la garantía correcta.

### 3 tests que pasan en rojo y por qué están igual

Dos del snapshot ("usa la hora actual solo cuando Cotizave no aportó" y "no fecha en el futuro un
reloj adelantado") más el de que la procedencia no se declara cuando no se puede probar: fijan
comportamiento que ya era correcto y que este workstream no cambia. Se dejaron como guarda contra
una regresión futura, no como prueba de un defecto.

### La red de seguridad genérica quedó muerta por diseño

Con W4, todo lo que llega al `catch` pasa por el fallback y sale clasificado, así que la rama del
texto genérico de CORS no es alcanzable hoy. Se conserva a propósito (una ruta futura que lance
un fallo de transporte sin clasificar la encontraría) y el comentario lo dice explícitamente en
lugar de fingir que está viva.

### Ruido preexistente en la corrida

`node.exe : + FullyQualifiedErrorId : NativeCommandError` aparece en la salida de `ng test` en
todas las corridas, incluida la línea base: es ruido de PowerShell sobre el aviso de Node, no un
fallo.

## Cambios preexistentes del working tree

Además de los ya registrados en el workstream 1, el árbol trae `electron/main/gemini-orchestrator.spec.ts`
modificado. Sigue siendo ajeno a este trabajo: nunca stageado, revertido ni commiteado.

## Next step (workstream 2)

Push / PR / merge = decisión del usuario. Sigue abierta y **fuera** de scope: la distinción
cancelación/timeout del puente IPC (W6), que requiere el cambio upstream en
`electron/main/ipc/handlers.ts`.

---

# Workstream 3 — El TTL era solo una puerta de arranque (D1–D7)

Workstream 1/legalgó **por qué** el mensaje era falso; el 2 **qué** se afirma cuando el mensaje
es cierto. Este cierra los siete huecos que quedaron: el TTL solo se evaluaba al arrancar, la
bóveda de credenciales es asíncrona y nadie lo esperaba, y tres superficies seguían atribuuyendo
un número a Cotizave sin declarar su reloj.

## Objective

Que ninguna tasa de Cotizave pueda alimentar la app fuera de su ventana de 15 min —**tampoco
después de haber estado abierta seis horas**— y que la procedencia de un número viaje con él hasta
la última superficie que lo muestra.

## Problem

- **D1 — el TTL era solo una puerta de arranque.** `readPersistedRates()` miraba la edad al
  hidratar y ahí terminaba. Una app abierta a las 09:00 seguía sirviendo a las 15:00 el mismo
  `restored` como si fuera operable. El descarte existía; la caducidad en vivo no.
- **D2 — el auto-refresh nunca arrancaba con la key guardada.** `SpreadMonitor.ngOnInit()` hacía
  `if (this.cotizave.apiKey())`. Pero `apiKey` se hidrata **asíncronamente** desde la bóveda de
  credenciales, así que en `ngOnInit` vale `''` aunque el operador tenga la key guardada. La
  decisión era una carrera contra el microtask: se ganaba o se perdía, y **perder significaba
  auto-refresh apagado para toda la sesión** — con la cache envejeciendo en silencio, que es
  exactamente lo que D1 dejaba pasar.
- **D3 — `/macro` no declaraba ni reloj ni procedencia.** `/bcv` ya fechaba con Cotizave;
  `/macro` armaba la misma inteligencia sin ninguna de las dos. Una caché restaurada entraba al
  pronóstico de 2 h como lectura de mercado vigente. Además llevaba
  `this.cotizave.fetchRates().catch(() => undefined)`: `fetchRates()` **nunca rechaza** (reporta
  por `error()` y por toast), así que el `.catch()` era código muerto que aparentaba ser una red
  de seguridad. Mismo defecto en `/bcv`.
- **D4 — la triangulación no decía de dónde salía el número.** Los gaps se calculan sobre
  `ratesByMarket()`, que no dice nada del origen. La única marca por fila era `rate.updated_at`,
  que es el sello del upstream **por tasa** y llega `undefined` cuando Cotizave lo omite. Un fetch
  de hace una hora puede traer tasas "actualizadas" al segundo: son dos relojes distintos y la
  tabla mostraba el equivocado.
- **D5 — el panel rotulaba un número que no era de Cotizave.** `bcvIntelligence()` cae a
  `manualBcvRate()`/`manualParallelRate()` (**685 / 815**, constantes fijas) cuando no hay MCP ni
  Cotizave. Con la línea de procedencia al lado, el panel afirmaba linaje de Cotizave sobre dos
  números literales.
- **D6 — el guard era vacuo.** `@if (cotizaveDataAge())` con un helper que devuelve
  `'una sesión anterior'` para `lastFetched() === null` **siempre era verdadero**. La condición no
  filtraba nada; el texto sí.
- **D7 — el snapshot mezclaba relojes sin declararlo.** `LiveMarketRatesSnapshot` es una MEZCLA
  (piernas de Binance por MCP, de Cotizave del servicio de rates, defaults). `timestamp` sin
  calificar ponía el reloj de Cotizave encima de un número de Binance: esa pierna quedaba fechada
  y las otras se leían igual de frescas.

## Scope

- `src/app/core/cotizave.service.ts` — temporizador de vencimiento revalidado contra `Date.now()`.
- `src/app/core/cotizave.service.spec.ts` — regresiones permanentes de D1 y tabla de
  `formatCotizaveDataAge`.
- `src/app/features/spread-monitor/spread-monitor.ts` / `.html` — D2 (efecto reactivo) y D4
  (procedencia + edad en la tabla).
- `src/app/features/spread-monitor/spread-monitor.spec.ts` — regresiones de D2 y D4.
- `src/app/core/telegram-worker.service.ts` / `.spec.ts` — D3 (reloj + procedencia en `/macro`,
  `.catch()` muerto fuera de `/macro` y `/bcv`).
- `src/app/features/dashboard/dashboard.ts` / `.html` — D5 y D6 (guard sobre la procedencia real).
- `src/app/features/dashboard/dashboard.spec.ts` — regresión de D5/D6.
- `src/app/core/triangulation-intelligence.service.ts` / `.spec.ts` — D7 (`timestampSource`).
- `odd/tasks/cotizave-error-masking-fix.md` — este documento.

## Out of scope

- `src/app/core/binance-p2p.service.ts`: D2 arregla la decisión en el componente, no la fuente.
- Cambiar el default de 5 min del auto-refresh: 300 000 ms contra 900 000 ms de TTL ya deja tres
  ventanas de margen, y el comentario lo dice.
- Cancelar el TTL desde afuera: el servicio es dueño de su reloj.
- Todo lo del workstream 1 y del 2.

## Constraints

- El vencimiento se implementa con un **temporizador revalidado** contra `Date.now()`, no con una
  vista derivada: la app tiene que **dejar de poder leer** el dato, no solo dejar de mostrarlo.
  Una vista derivada habría dejado `ratesByMarket()`Readable y el `error()` sano.
- Al vencer se borra rates, procedencia y reloj, y se deja un error honesto: el operador tiene que
  ver por qué la pantalla se vació.
- La copia persistida se borra **solo si es la misma** que se está sirviendo, para no pisar un
  fetch concurrente que ya escribió rates frescos.
- El temporizador se limpia en `ngOnDestroy()`: un `setTimeout` vivo en un servicio destruido
  escribe sobre señales de una instancia muerta.
- D2 no puede consultar la key una vez. Un `effect` sobre la señal no pierde la carrera.
- La procedencia se declara solo si se puede probar: `none` con tasas en pantalla no se promueve.
- `timestampSource` es **obligatorio**, no opcional: omitir la calificación en un snapshot mezclado
  es el defecto mismo.
- TDD estricto: cada D se reprodujo en rojo con un throwaway antes de tocar la implementación.
  Los throwaways se borran; las aserciones viven en los specs canónicos.

## Tasks

- [x] **T15** D1 RED: throwaway `cotizave-ttl-repro.spec.ts` → `Tests 3 failed (3)`, exit 1.
  - Fallos literales: `expected [ 'binance', 'oficial' ] to have a length of +0 but got 2`; el
    mismo en la ruta de fetch en vivo; y `ngOnDestroy` sin temporizador que limpiar.
- [x] **T16** D1 GREEN: `expiryTimer` + `armExpiry()` / `clearExpiry()` / `expireRatesAt()` /
  `removePersistedRatesIfSameFetch()`.
  - Evidencia: `hydrateRatesFromStorage()` y el `fetchRates()` exitoso arman el vencimiento; al
    vencer quedan `ratesByMarket()` vacío, `provenance: 'none'`, `lastFetched(): null`, un error
    que menciona los 15 min y la entrada persistida borrada. `ngOnDestroy` deja
    `vi.getTimerCount() === 0`.
- [x] **T17** D2 RED: throwaway `spread-monitor-cotizave-repro.spec.ts` → `Tests 4 failed (4)`,
  exit 1. Literal: `expected "startAutoRefresh" to be called at least once`.
- [x] **T18** D2 GREEN: `effect` sobre `apiKey()` + `activeMode()`; sin key, `stopAutoRefresh()`.
  - Evidencia: la aserción clave mira `expect(cotizave.apiKey()).toBe('')` en el primer
    `detectChanges()` para **documentar la carrera** antes de que la bóveda resuelva.
- [x] **T19** D4 GREEN: `provenance`, `fetchedAt` y `dataAge` por fila + `triangulationLineage` para
  la línea de la plantilla.
- [x] **T20** D3 RED: `Tests 1 failed | 78 passed (79)`, exit 1. Literal: `/macro` sin `08:05` ni
  `restaurada del disco`.
- [x] **T21** D3 GREEN: reloj y procedencia de Cotizave en `/macro`; `.catch()` muerto eliminado de
  `/macro` y `/bcv` con el motivo en el comentario.
- [x] **T22** D5/D6 RED: throwaway `dashboard-lineage-repro.spec.ts` → `Tests 2 failed (2)`, exit 1.
  Literal: el DOM contenía `una sesión anterior · Cotizave sin datos` sin un solo dato de Cotizave.
- [x] **T23** D5/D6 GREEN: `cotizaveDataAge()` devuelve `null` con `provenance === 'none'`, así que
  el guard deja de ser vacuo; el comentario de la plantilla aclara que con Cotizave real la línea
  **sí** es obligatoria.
- [x] **T24** D7 RED: `TS2339: Property 'timestampSource' does not exist`, y con casts
  temporales `Tests 2 failed | 5 passed (7)`, exit 1. Literales: `expected undefined to be
  'cotizave'`; `expected undefined to be 'panel'`.
- [x] **T25** D7 GREEN: `timestampSource: 'cotizave' | 'panel'` obligatorio, más `timestampSource:
  'panel'` en el estado inicial (constantes de arranque, sin fetch detrás). Casts temporales
  eliminados.
- [x] **T26** Cobertura de `formatCotizaveDataAge`: tabla de 10 casos (sub-minuto, minutos, el
  corte 59 min → 1 h, horas, el corte 23 h → 1 d, días) con `now` explícito, reloj adelantado y
  `null`/`undefined`/`Invalid Date`. Se **eliminó** `expect(COTIZAVE_CACHE_MAX_AGE_MS).toBe(15 *
  60_000)`: tautología, no probaba nada.
- [x] **T27** Throwaways borrados; las aserciones viven en los specs canónicos.
- [x] **T28** Verificación completa y commit work-unit único.

## Verificación (workstream 3)

| Check                    | Comando                                                                              | Resultado observado                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Baseline antes de editar | `npx ng test p2p --include='**/cotizave.service.spec.ts' --watch=false`              | `Tests 15 passed (15)`, exit 0                                                                |
| RED D1 (T15)             | `npx ng test p2p --include='**/cotizave-ttl-repro.spec.ts' --watch=false`           | `Tests 3 failed (3)`, exit 1                                                                  |
| GREEN D1 (T16)           | ídem                                                                                 | `Tests 3 passed (3)`, exit 0                                                                  |
| RED D2/D4 (T17)          | `npx ng test p2p --include='**/spread-monitor-cotizave-repro.spec.ts' …`            | `Tests 4 failed (4)`, exit 1                                                                  |
| GREEN D2/D4              | ídem                                                                                 | `Tests 4 passed (4)`, exit 0                                                                  |
| RED D5/D6 (T22)          | `npx ng test p2p --include='**/dashboard-lineage-repro.spec.ts' …`                  | `Tests 2 failed (2)`, exit 1                                                                  |
| GREEN D5/D6              | ídem                                                                                 | `Tests 2 passed (2)`, exit 0                                                                  |
| RED D3 (T20)             | `npx ng test p2p --include='**/telegram-worker.service.spec.ts' …`                   | `Tests 1 failed \| 78 passed (79)`, exit 1                                                   |
| RED D7 (T24)             | `npx ng test p2p --include='**/triangulation-intelligence.service.spec.ts' …`        | `TS2339` (compilación); con casts, `Tests 2 failed \| 5 passed (7)`, exit 1                 |
| GREEN `cotizave.service` | `npx ng test p2p --include='**/cotizave.service.spec.ts' --watch=false`              | `Test Files 1 passed (1)` / `Tests 32 passed (32)`, exit 0                                   |
| GREEN `spread-monitor`   | `npx ng test p2p --include='**/spread-monitor.spec.ts' --watch=false`                | `Test Files 1 passed (1)` / `Tests 12 passed (12)`, exit 0                                   |
| GREEN `triangulation`    | `npx ng test p2p --include='**/triangulation-intelligence.service.spec.ts' …`       | `Test Files 1 passed (1)` / `Tests 7 passed (7)`, exit 0                                     |
| GREEN `telegram-worker`  | `npx ng test p2p --include='**/telegram-worker.service.spec.ts' …`                  | `Test Files 1 passed (1)` / `Tests 79 passed (79)`, exit 0                                    |
| GREEN `dashboard`        | `npx ng test p2p --include='**/dashboard.spec.ts' --watch=false`                    | `Test Files 1 passed (1)` / `Tests 7 passed (7)`, exit 0                                     |
| GREEN `binance-p2p`      | `npx ng test p2p --include='**/binance-p2p.service.spec.ts' --watch=false`          | `Test Files 1 passed (1)` / `Tests 6 passed (6)`, exit 0                                     |
| Typecheck                | `npx tsc --noEmit`                                                                    | exit 0                                                                                       |
| Lint                     | `npm run lint`                                                                        | exit 1, `21 problems` (core) + `37 problems` (app) — **idéntico con el workstream stash-archivado** |
| Throwaways               | `Get-ChildItem -Recurse -Filter '*repro*.spec.ts'`                                    | `REMAINING=0`                                                                                |
| Formato                  | `npx prettier --check` (los 13 archivos)                                              | `Code style issues found in 13 files` — **preexistente**, ver abajo                             |

### Los errores de lint y su distribución

`npm run lint` corre **dos** targets (el de `core` y el de `app`) y cada uno imprime su propio
total: **21** en `core` y **37** en `app`. Los dos son **preexistentes** y se comprobaron
empíricamente, no por inspección:

- Con los 12 archivos de este workstream en un stash
  (`git stash push -m "cotizave-d1-d7" -- <12 rutas>`) y el árbol por lo tanto en el estado previo
  al fix, la corrida da **exactamente los mismos dos totales**: 21 y 37. Stash restaurado con
  `git stash pop`.
- Los únicos errores de lint en archivos que este workstream toca son
  `consistent-type-definitions` en `telegram-worker.service.spec.ts` (4 ocurrencias, las mismas
  cuatro en HEAD) y `label-has-associated-control` en `dashboard.html` (2 ocurrencias, las mismas
  dos en HEAD). Ninguno cae en una línea agregada por este cambio.
- Un error propio sí apareció y se corrigió antes de commitear:
  `array-type` en `cotizave.service.spec.ts:515` por `ReadonlyArray<T>`, reemplazado por
  `readonly T[]`.

### Un test_canónico quedó con el nombre del comando equivocado

`BCV dice "en vivo" cuando Cotizave vino de la red` despacha `/bcv`; el título decía `MACRO`. Se
corrigió el título. Vale registrarlo porque un título mentiroso en un spec de regresión es
precisamente la clase de defecto que este workstream existe para eliminar.

### `prettier --check` falla en los 13 archivos, y es preexistente

`npx prettier --check` marca los 13 archivos de este workstream. **No se corrió `--write`**, y
la razón es que el incumplimiento no lo introduce este cambio: con los 13 archivos en un stash y
el árbol en el estado de HEAD, `prettier --check` marca **los mismos 13**. Stash restaurado con
`git stash pop`. Además `src/app/features/operation-log/invoice-modal.component.ts`, que este
workstream no toca, también falla el check.

`prettier --write` habría reescrito líneas ajenas a este trabajo en los 12 archivos de código,
mezclando un reformateo masivo con un fix de correctitud: el diff dejaría de ser revisable. El
contrato de este workstream es "cambios mínimos y dirigidos", así que el formato queda como deuda
preexistente y registrada, no como algo que se "cuela" en el commit.

De los 13, tres ya salen formateados si se compara la salida de `prettier` contra el archivo:
`triangulation-intelligence.service.ts`, `triangulation-intelligence.service.spec.ts` y
`spread-monitor.ts`.

### `ng test` con varios `--include` no funciona

`--include='a,b'` no matchea nada en este runner: hay que pasar **un patrón por corrida**. Además
`ng test` sin nombre de proyecto intenta el target de `core` con el mismo `--include` y aborta con
`No tests found matching the following patterns`, así que el scoping `npx ng test p2p --include=…`
es obligatorio.

### La prueba de D4 falla si el sub-tab no se abre

La tabla de triangulación vive dentro de `@else if (analyticsSubTab() === 'triangulation')`, y el
sub-tab arranca en `microstructure`. Una aserción de DOM sobre esa tabla tiene que **abrir el
sub-tab**: si no, el `textContent` está completo y verde, y el test pasa por la razón equivocada.

### El estado imposible `provenance: 'none'` con tasas en pantalla

El primer borrador del test de D4 sembraba `ratesByMarket()` con una tasa y `ratesProvenance()` en
`none` a la vez, y fallaba. Ese estado no existe en el servicio real: `none` significa cache
vacía. El test se corrigió para sembrar `noData: true` (sin tasas y sin reloj). La moraleja: un
stub que se contradice prueba el stub, no el componente.

## Cambios preexistentes del working tree

Además de los ya registrados, el árbol trae `angular.json` modificado (un target `lint` para
`projects/core`), `electron/main/gemini-orchestrator.spec.ts`, `electron/shared/types.ts` y
`projects/core/src/lib/agent-skills.ts`. Todos ajenos a este trabajo: nunca stageados, revertidos
ni commiteados. `npx ng test` escribe en `angular.json` durante las corridas, así que su estado se
verificó justo antes del staging.

## Next step (workstream 3)

Push / PR / merge = decisión del usuario. Sigue abierta y **fuera** de scope: la distinción
cancelación/timeout del puente IPC (W6), que requiere el cambio upstream en
`electron/main/ipc/handlers.ts`.
