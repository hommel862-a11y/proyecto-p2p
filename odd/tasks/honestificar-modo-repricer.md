# Honestificar el modo de ejecución del Repricer

## Objective

Que el sistema no pueda afirmar "Modo En Vivo" cuando no existe capa de publicación en Binance. Hoy el flag `isDryRun` es un booleano controlable por el operador cuyo unico efecto observable es un prefijo de log y un badge: no existe ningun endpoint de escritura, asi que seleccionar "En Vivo" produce una garantia falsa.

## Problem / Why

- `src/app/core/binance-repricer.service.ts:27` declara `isDryRun = signal<boolean>(true)`.
- `setDryRun()` (linea 95) **si tiene callers**: `src/app/features/spread-monitor/spread-monitor.html:892` — `<select>` con `(change)="repricer.setDryRun(...)"`.
- El operador puede elegir `⚡ En Vivo (Binance Merchant API)` (linea 894). Eso produce, en simultaneo:
  - badge verde `ACTIVO (EN VIVO)` (linea 851),
  - toast `Modo En Vivo` (linea 54),
  - prefijo de log `[EN VIVO]` (linea 137).
- No existe capa de escritura: el unico endpoint Binance del proyecto es `adv/search` (lectura de mercado) en `src/app/core/binance-p2p.service.ts:183`. Busquedas de `bapi/composite`, `private/adv`, `adv/update`, `adv/online`, `editAdv`, `merchant/self` en `src/**/*.ts` → cero resultados.
- `isDryRun` esta declarado en `RepricerConfig` (`projects/core/src/lib/repricer.ts:29`) y **nunca se lee** en el engine. Es un campo muerto.
- Consecuencia: un operador razonable que selecciona "En Vivo" cree que sus anuncios se estan moviendo. No se mueven. Dinero real, confianza real, garantia falsa.

## Why now

Se analyzo una propuesta Python de control remoto por Telegram que asumia un backend de "encender/apagar anuncio" inexistente. La propuesta no era el problema: revelo el problema. La casa ya tiene precedente honesto ("Fixed lying treasury HUD labels in copilot.html", "C3: labels HUD copilot honestos"); este workstream es el mismo patron aplicado al repricer.

## Scope

- `projects/core/src/lib/repricer.ts` — eliminar `isDryRun` de `RepricerConfig` (campo muerto, nunca leido).
- `projects/core/src/lib/repricer.spec.ts` — ajustar fixture (linea 85).
- `src/app/core/binance-repricer.service.ts` — borrar `isDryRun` signal y `setDryRun()`; introducir una fuente de verdad honesta y derivada del modo real de ejecucion; derivar de ella el toast de activacion y el prefijo de log, de modo que `[EN VIVO]` quede inalcanzable por construccion.
- `src/app/features/spread-monitor/spread-monitor.html` — reemplazar el `<select>` enganoso (lineas 890-896) y corregir el badge (lineas 850-851) para que no pueda afirmar "EN VIVO".
- `src/app/core/telegram-worker.service.ts` — `/status` debe reportar el modo real, para que el operador lo vea tambien desde el telefono.
- Specs afectadas: `binance-repricer.service.spec.ts` (si existe), `telegram-worker.service.spec.ts`.

## Constraints

- **No tocar los badges "EN VIVO" que SI son honestos**: `spread-monitor.html:1011` ("En Vivo (Binance P2P)" = lectura de ticker), `cross-exchange-matrix.component.html:226,270,317` (Bybit / elDorado = lecturas de API). Son datos de mercado reales. Este workstream es solo sobre la capacidad de *publicar*.
- `projects/core` es libreria pura, sin dependencias de Angular ni servicios. Mantener esa frontera.
- Todo export nuevo en `projects/core` debe propagarse byte-identico (`npm run check:vendor`).
- Respuestas de Telegram: MarkdownV2 con `escapeMarkdownV2` en todo valor dinamico.
- Sin push. Work-unit commits Conventional Commit en `feat/p2p-decision-tool-mvp` (rama ya activa, working tree limpio).
- Route: delegado directo ODD. No SDD.

## Out of scope (deliberadamente)

- Implementar la capa de escritura de Binance Merchant API. Es trabajo mayor (API key de merchant, idempotencia, limites de tasa, dinero real) y requiere su propia feature y su propia autorizacion.
- El panel editable de Telegram (`editMessageText`) y el toggle por lado. Son el siguiente workstream, pero dependen de que la verdad de ejecucion este primero.
- Guard anti-doble-toque / rate limit en el worker de Telegram.

## Checklist

- [x] T1. `repricer.ts`: `isDryRun` eliminado de `RepricerConfig` y del fixture de `repricer.spec.ts`.
- [x] T2. `binance-repricer.service.ts`: `isDryRun` y `setDryRun()` eliminados. Reemplazados por `REPRICER_EXECUTION_MODES` + registro `adPublisher` + `executionMode` como `computed` derivado. Sin setter booleano.
- [x] T3. `spread-monitor.html`: badge derivado de `executionModeLabel()`; el `<select>` quedo `disabled`, de una sola opcion, sin `(change)` y sin la opcion "En Vivo".
- [x] T4. `telegram-worker.service.ts`: `/status` reporta el modo real con `escapeMarkdownV2` sobre el valor dinamico.
- [x] T5. `binance-repricer.service.spec.ts` nuevo (13 tests), con asercion explicita de que el modo no puede reportarse en vivo sin publicador real.
- [x] T6. Verificacion integrada + work-unit commit `3748d07`.

## Acceptance criteria

- No existe en el codigo ninguna ruta por la cual el sistema afirme "Modo En Vivo" / `[EN VIVO]` / "ACTIVO (EN VIVO)" mientras no exista un publicador real.
- El badge del repricer y `/status` de Telegram comunican explicitamente que el bot calcula y loguea precios pero **no publica** en Binance.
- No se degrada el comportamiento existente: ciclo de precios, PAUSE por regla de seguridad, kill-switch, F5, Esc, BCV, radar, macro, backtest, auditoria forense.
- Suite verde, `tsc --noEmit` limpio, vendor byte-identico.

## TDD

- **Modo resuelto: no configurado explicitamente** (no hay eleccion del usuario ni `sdd-init` en este proyecto; que existan specs NO habilita TDD por si solo).
- **Runner conocido**: `npx ng test` (Angular/Karma) y `npx vitest run` (electron). Comandos tomados de la evidencia de `odd/tasks/telegram-comandos-operativos-v2.md`.
- **Aplicacion pragmatica declarada**: varias tareas son *eliminacion de codigo muerto* (T1, T2), donde un test RED previo no tiene semantica. La regla aplicada es test-junto-a-comportamiento: toda afirmacion nueva o modificada queda cubierta por spec, y T5 agrega la cobertura de que el modo no puede reportarse "en vivo" sin publicador real. No se inventa un modo TDD que el proyecto no configuro.

## Route

Delegado directo ODD (no SDD): un unico writer sobre `projects/core/**` + `src/app/**` (frentes acoplados por el mismo concepto, no paralelizables sin conflicto). Verificacion integrada por el orquestador.

## Verification evidence

Commit `3748d07` — `fix(repricer): el modo de ejecucion se deriva de si existe un publicador real`. 7 archivos, 405 inserciones / 30 borraciones. Sin push.

### Reportado por el writer (observado)
- `npx tsc --noEmit` → exit 0.
- `npm run check:vendor` → exit 0, `24/24 identicos`.
- `npx ng test p2p --watch=false --include=**/binance-repricer.service.spec.ts --include=**/telegram-worker.service.spec.ts --include=**/hotkeys.service.spec.ts` → exit 0, 3 archivos / 58 tests.
- `npx ng test core --watch=false` → exit 0, 53 archivos / 573 tests.
- `npx ng test p2p --watch=false` (suite completa) → exit 0, 33 archivos / 255 tests.
- `npx ng build` → exit 0 (AOT; agregado porque `tsc --noEmit` no type-chquea templates y se toco HTML).

### Verificado independientemente por el orquestador
- `npx tsc --noEmit` → **exit 0** (spot check propio, exit code 0 confirmado).
- `git show --stat HEAD` → los 7 archivos son exactamente los del scope. Nada fuera de scope, nada staged de mas.
- Lectura del codigo nuevo vía `git show`: `executionMode` es un `computed` derivado de `adPublisher()`; no existe setter booleano. Modo inalcanzable por construccion, como pedia el criterio.
- `grep` de `EN VIVO|En Vivo|en vivo` en `src/**` → las 49 coincidencias restantes son todas lecturas de datos de mercado, textos de estado "Demo" de credenciales no configuradas, o el codigo honesto nuevo. **Ninguna ruta afirma publicacion en vivo.**
- Badges protegidos intactos: `cross-exchange-matrix.component.html:226,270,317` y `spread-monitor.html:1014`. Strings de `/spreads` (`telegram-worker.service.ts:657`) y `/macro` (`:870`) sin tocar.

### Limitaciones honestas (no resueltas aqui)
1. **`check:vendor` no cubre estos modulos.** `VENDOR_NAMES` (`scripts/sync-vendor-core.cjs:37`) es una lista cerrada descrita como "Grafo de cierre del copiloto de Electron", y **ni `repricer.ts` ni `telegram-sentinel.ts` estan en ella**. Verificado por el orquestador. El constraint "todo export nuevo debe propagarse byte-identico" era vacuo para este alcance: el `24/24` verde no dice nada sobre estos dos archivos. Deuda real, contrato propio, fuera de alcance.
2. **Flake pre-existente reportado, no re-verificado por el orquestador.** El writer观察到 `copilot.spec.ts:230` (`avgCycleVelocityMinutes`) fallo en dos corridas y afirma haberlo reproducido en HEAD limpio con su trabajo stasheado, pasando en las 3 corridas siguientes. No lo toco ni lo debilio. El orquestador no re-verifico ese flake puntual: queda declarado, no absuelto.
3. **Comentarios HTML residuales.** `spread-monitor.html:1447` y `:1510` dicen "Decisiones en Vivo" / "Registro de Decisiones en Vivo". Son comentarios de fuente, invisibles al operador, y hablan del registro de decisiones, no de publicar. Se dejaron intactos por no sobre-alcanzar. Ajuste de una linea si se quiere.

## Next step (propuesto, no ejecutado)

Siguiente workstream recomendado: el panel editable de Telegram (`editMessageText`) con `🔄 Refrescar`, que hoy no existe (cero ocurrencias en el worker) y es la mejora de UX de mayor retorno en el telefono. Depende de que la verdad de ejecucion este expuesta y honesta, que es exactamente lo que este commit dejo hecho.
