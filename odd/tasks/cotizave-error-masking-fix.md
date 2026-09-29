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
