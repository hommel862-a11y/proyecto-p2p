# Codebase remediation: inventario honesto, en ondas

## Objective

Convertir el pedido "arreglar los problemas existentes" en un backlog **verificado y ejecutable**, orden por valor, sin inventar alcance. Este documento es la fuente de verdad del esfuerzo: qué se midió, qué no, qué se arregla y en qué orden, y qué se deja escrito como pendiente.

## Verified inventory (2026-09-28)

Todo lo de abajo fue medido sobre el árbol, no estimado:

| Señal | Valor | Cómo se midió |
| --- | --- | --- |
| `ng lint` proyecto p2p | **21** | `npx ng lint` |
| Marcadores de deuda | **3** | 2 `TODO` + 1 `eslint-disable`, 0 `FIXME`/`HACK`/`ts-ignore` |
| Tests en rojo | **10** | 9 p2p + 1 core |
| Escala | 390 `.ts` (127 specs), 63.077 líneas | `Get-ChildItem` |
| Calidad externa | **ninguna** | sin Sonar / CodeClimate / Codecov / Lighthouse |

Tests en rojo, por archivo:

- `binance-fills.service.spec.ts` — **4** (archivo nuevo de la sesión paralela, sin trackear)
- `ad-composer.service.spec.ts` — **3** (deuda vieja: el fake no tiene la forma nueva del publicador)
- `app.spec.ts` — **1** (deuda vieja: espera 11 links, hay 10)
- `telegram-worker.service.spec.ts` — **1** (**es la prueba de un defecto real**, ver T1)
- `pdf-invoice-generator.spec.ts` — **1** (cross-realm `TextEncoder`, preexistente en core)

**Total real y defendible: ~45 ítems.** No 500.

## Why the "500" is not real

Se buscó el origen antes de planificar. No existe en ninguna señal estándar de este repo. Lo más cercano a 500 son 390 archivos `.ts` y 3.412 archivos totales — ninguno de los dos es "problemas". No hay escáner externo configurado que haya podido producir ese conteo.

Correr `eslint` sobre las áreas sin cobertura con el config de p2p produciría un número enorme y **falso** (cada archivo se quejaría de `parserOptions`). Se prefirió reportar el hueco antes que medirlo con una vara equivocada.

## Tooling blind spots

`ng lint` solo corre sobre el proyecto por defecto. El resto del código **no está lintado**:

| Área | ¿Linter la ve? | Dónde vive lo crítico |
| --- | --- | --- |
| `p2p` | Sí, 21 problemas | rutas de render |
| `projects/core` | **No. Sin target de lint** | `decision-journal-repository.ts`, `binance-p2p.ts` |
| `electron/` | **No. No es proyecto** | adapter SQLite, IPC |
| `packages/mcp-server` | **No. No es proyecto** | `publish_ad_price.ts` |

El "21" no es el total del repo: es el total del único lugar donde alguien miró. Todo el dominio que decide si un ciclo es terminal o si un fill es verificado vive en las tres áreas ciegas.

## Constraints

1. **Sesión paralela activa.** Escribe `binance-fills.*`, `electron/preload/api.*`, `electron/shared/types.ts`, `projects/core/src/public-api.ts`, `credential-store.service.ts`. No tocar esos archivos sin revisar `git status`.
2. **`.git/index` es un recurso compartido — y el `GIT_INDEX_FILE` privado tiene su propia trampa.** Ya нема上和星级上 andar hoy: W1 casi tragó 5 archivos ajenos (otra sesión corrió `git add` entre su `add` y su `commit`). Correr `git add`/`git commit` a través de un índice privado resuelve eso, **pero deja el índice real con los blobs previos al commit**: los paths quedan en `MM` y un `git commit` corriente de la otra sesión revierte el trabajo en silencio. Ya pasó dos veces. Recipe completo: `GIT_INDEX_FILE` privado para commitear, y después reparar el índice real con `git add` sobre **solo los paths propios**, y verificar con `git status --porcelain` que los archivos de la otra sesión siguen en ` M` / `??`.
3. **No borrar datos.** La DB real es `%APPDATA%\p2p-decisor-desktop\antigravity_p2p.sqlite`. Prohibido recrearla, migrarla destructivamente o hacer `drop`.
4. **Cero push.** Todo queda local hasta que el usuario lo diga.
5. **Honestidad antes que estilo.** Un número mentiroso en pantalla es peor que una pantalla rota. Lint va al final, no al principio.

## Task checklist

### Wave 1 — defectos de honestidad (primero: son los que mienten sobre el dinero)

- [x] **T1** — El journal degrada en silencio. `resolveJournalBridge()` hacía `console.warn` y devolvía un bridge en memoria plenamente funcional, **contradiciendo su propio contrato escrito** en la línea 264: *"A missing bridge throws rather than degrading to a no-op: a journal that cannot write must not look like a journal that decided not to."* **HECHO en dos commits: `21fe1e9` + `86cafea`.** El panel ahora declara `⚠️ *Journal de decisiones:* <razón>` en `/status` y en el panel, en ambas superficies.
- [ ] **T2** — El bridge se resuelve en el constructor (`private readonly bridge = resolveJournalBridge()`, línea 74). Si `window.p2p` todavía no está inyectado cuando se construye el service, la app corre **toda la sesión** en memoria. *Hipótesis, DEBILITADA por la verificación de `21fe1e9`*: en la app empaquetada el bridge es incondicional (`electron/main/index.ts:411`, `preload/index.ts:30-31`, `preload/api.ts:83-85`, `ipc/handlers.ts:469-471`), así que la carrera NO explica los 0 filas de la DB real. Falta otra explicación; no tocar hasta tenerla.
- [x] **T3** — `McpAdPublisherService.executionMode()` y la etiqueta de UI: atenuada la etiqueta en `binance-repricer.service.ts` y en `mcp-ad-publisher.service.ts` para no prometer falsamente una integración de escritura directa con la API de merchant de Binance que no existe. **HECHO en commit `19a0e1b`**.
- [x] **T4** — `PAUSE` durabilidad en el journal: verificado que ya se encuentra preservado en `binance-repricer.service.ts` y `@p2p/core`, discriminando `VERIFIABLE_DECISION_ACTIONS` (`UPDATE`) para el denominador de verificación sin descartar la evidencia de detención. **HECHO**.

### Wave 2 — tests en rojo

- [x] **T5** — 9 p2p: 3 de `ad-composer` y 1 de `app.spec` corregidos; 1 de `telegram-worker` resuelto en T1; 4 de `binance-fills` pertenecen a la sesión paralela. **HECHO en commit `9deb9f9`**.
- [x] **T6** — 1 core: `pdf-invoice-generator.spec.ts`, cross-realm `TextEncoder` normalizado con `ArrayBuffer.isView`. **HECHO en commit `9deb9f9`**.

### Wave 3 — cobertura de tooling

- [x] **T7** — Target de lint para `projects/core` configurado en `angular.json` y 37 errores resueltos. **HECHO en commit `23304bc`**.
- [ ] **T8** — ESLint para `electron/` y `packages/mcp-server` con config compartida y `tsconfig` propio. (Pendiente).
- [x] **T9** — 22 problemas de lint en `p2p` resueltos (0 errores, 0 warnings). **HECHO en commit `23304bc`**.

### Wave 4 — deuda documentada

- [x] **T10** — 2 `TODO` + 1 `eslint-disable`: 0 `TODO`s restantes en el árbol; el único `eslint-disable` en `electron/main/mcp-bootstrap.ts` verificado y justificado (eval de import dinámico ESM en entorno empaquetado Electron CommonJS). **HECHO**.

## Acceptance criteria

- T1: `telegram-worker.service.spec.ts > declares the audit unavailable instead of taking the worker down` en verde, y el panel nunca emite `0/0`, `NaN` ni `Infinity` cuando el journal no persiste.
- T2: verificado con evidencia, no por hipótesis. Si la carrera existe, hay test que la reproduce.
- T3: la UI no afirma una integración que no existe.
- T5/T6: cero tests rojos que no sean de la sesión paralela.
- T7/T8: `core`, `electron/` y `packages/` lintados, con el conteo real registrado acá.
- Invariante general: ninguna cifra en pantalla se inventa. Un journal que no persiste se declara, no se simula.

## Checks

```
npx tsc --noEmit -p projects/core/tsconfig.lib.json
npx ng test core --watch=false
npx ng test p2p --watch=false
Push-Location electron; npx vitest run; Pop-Location
npx ng lint
```

Baseline a no empeorar: core 710/711, p2p 365/9, electron 195/195, lint 21.

## Progress

- **Ola 0 — baseline: HECHA.** Inventario medido, tooling ciego identificado, 500 descartado con evidencia.
- **T1 — HECHA.** Dos commits: `21fe1e9` (núcleo) + `86cafea` (la razón llega al operador). 8 archivos en total, sin push.
  - **Lo que era:** `resolveJournalBridge()` degradaba a un journal en memoria funcional con un simple `console.warn`, contradiciendo el contrato escrito 58 líneas más arriba. El panel pintaba como si hubiera persistencia en SQLite.
  - **Lo que están ahora:** el service expone `JournalAvailability { degraded, reason }`; el panel declara `⚠️ *Journal de decisiones:* <razón>` en las dos superficies; un journal sano y vacío sigue diciendo "sin decisiones registradas todavía" (no se confunde "no hay datos" con "estoy perdiendo datos"); `0/0`, `NaN` e `Infinity` no llegan al operador.
  - **El alcance era mayor de lo que seemed:** el `try/catch` que vigilaba este defecto no estaba muerto solo "por su razón declarada" — `DecisionJournalService` es `providedIn: 'root'`, así que `inject()` no puede lanzar, y la rama `!this.journal` tampoco era alcanzable en producción. Se eliminó el helper entero y se adoptó `inject(..., { optional: true })`, que es el idioma que ya usa `binance-repricer.service.ts:136` en el mismo token.
  - **Verificación:** padre — índice compartido limpio, cero rutas ajenas, 2/2 specs en verde. Revisor independiente adversarial — sin bloqueantes, sin mentira nueva (mi hipótesis de que el guard fabricaba un "no disponible" falso era **incorrecta**; el formatter ya distingue los dos casos con una cadena separada y un test lo prueba). Mutation check del escritor: neutralizar `journalDegradedNotice()` rompe exactamente 3 tests, o sea que los tests muerden de verdad.
  - **Decisiones del escritor que contradijeron mi brief, con razón:** (a) el doc de `isPrintableAudit` estaba mal, no el guard — `formatMetric` ya devuelve `n/d` para no-finitos, y exigir `staleRate` en el guard habría tirado a la basura conteos reales; (b) `inject(..., { optional: true })` en vez del `try/catch`.
  - **Pendiente de Wave 3, no de T1:** 4 de los 21 problemas de lint viven en `telegram-worker.service.spec.ts` (`type`→`interface`), preexistentes.
