# Panel editable de Telegram con refresco en el lugar

## Objective

Un unico mensaje de Telegram que se edita en el lugar, con boton `🔄 Refrescar`, que muestre el estado real del terminal. Hoy cada comando envia un mensaje NUEVO: cero ocurrencias de `editMessageText` en el worker. En el telefono eso es un muro de texto que hay que scrollear para saber si el bot esta activo o el libro esta fresco.

## Problem / Why

- `src/app/core/telegram-worker.service.ts` tiene `sendTelegramMessage` (soporta `reply_markup`, linea ~1282) pero **ningun** `editMessageText`. Verificado: cero ocurrencias.
- Cada `/status`, `/spreads`, `/macro` genera un mensaje nuevo. Con 10 comandos y uso frecuente, el chat del operador se vuelve inutilizable como referencia de estado.
- El operador no tiene forma de "mirar el tablero" sin generar ruido.
- Precedente: el workstream `honestificar-modo-repricer` ya expuso `executionModeLabel()` / `executionModeDetail()` / `executionMode` en el repricer. Ese trabajo deja de ser util si el panel no lo muestra: la verdad de ejecucion tiene que ser visible desde el telefono.

## Why now

Es el siguiente workstream de la secuencia acordada (honestificar verdad de ejecucion -> panel que la muestre -> toggle por lado / guard anti-doble-toque). La verdad de ejecucion ya es honesta y esta expuesta; este workstream la hace visible sin agregar ruido.

## Scope

- `projects/core/src/lib/telegram-sentinel.ts` (+ spec) — accion `PANEL`, comando `/panel`, callback `PANEL_REFRESH`, y formatter puro `formatPanelTelegramMessage(...)` con escape MarkdownV2. Sigue el patron `format*` ya establecido.
- `src/app/core/telegram-worker.service.ts` (+ spec) — ability de editar mensaje in situ; wiring de `PANEL`; y que las acciones disparadas desde el teclado del panel re-rendericen el panel en el lugar en vez de emitir mensajes nuevos.
- `src/app/features/*` — sin cambios. El panel vive en Telegram, no en la app.

## Diseno clave: el panel no necesita estado

`update.callback_query.message.message_id` **es** el panel. Telegram lo entrega en cada callback. Consecuencia: NO hace falta `panelMessageId` por chat, ni store, ni sincronizacion.

- Callback desde el panel -> editar `callback_query.message`.
- Si ese mensaje fue borrado -> `editMessageText` falla 400 "message to edit not found" -> fallback: enviar panel nuevo.
- Sin estado, sin drift entre lo que el panel dice y lo que el sistema recuerda.

## Failure modes de Telegram a manejar (no son opcionales)

1. **`message is not modified`** — Telegram devuelve 400 cuando texto+markup son identicos a los actuales. Un operario que toca `🔄 Refrescar` sin cambios ve el error. Debe tratarse como exito silencioso. Es el gotcha clasico de `editMessageText` y es lo que separa una implementacion que funciona de una que molesta al operador cada 5 segundos.
2. **`message to edit not found`** — mensaje borrado -> fallback a enviar panel nuevo.
3. **Respuesta de edicion vacia / sin `message`** — manejar sin romper.
4. **`answerCallbackQuery` antes de la edicion** — ack inmediato del toque, siempre.

## Constraints

- **H Honestidad, no negociable**: el panel DEBE mostrar `executionModeLabel()` / `executionModeDetail()` del repricer. Nada de "EN VIVO" sobre publicacion. Este workstream no puede reintroducir la mentira que se acaba de eliminar.
- **Frescura explicita**: el panel muestra timestamp de los datos. Sin depth disponible NO muestra ceros: dice que no hay datos, como ya hace `/spreads` y `/macro`.
- **No romper el contrato existente**: `/status` sigue siendo `/status` con su texto actual. El panel es un comando NUEVO. La constraint del workstream V2 fue explicita: los comandos existentes no cambian su contrato.
- `projects/core` sigue siendo libreria pura: sin Angular, sin servicios, sin fetch.
- MarkdownV2: `escapeMarkdownV2` en todo valor dinamico.
- Work-unit commit Conventional Commit en `feat/p2p-decision-tool-mvp`. **Sin push**.

## Out of scope

- Toggle por lado (Compra/Venta independientes). Requiere la capa de escritura que no existe; hoy seria otro boton mentiroso.
- Rate limit / debounce global del worker.
- Editar el panel desde la app Electron.
- Backtest y demas: no forman parte del panel salvo que el estado que ya existe sea trivial de exponer.

## Checklist

- [x] T1. Core: accion `PANEL`, comando `/panel`, callbacks `PANEL_REFRESH` / `PANEL_REPRICER_STOP` / `PANEL_REPRICER_START`, `formatPanelTelegramMessage` puro + `buildPanelKeyboard()` + `isPanelCallbackData()`.
- [x] T2. Worker: `editTelegramMessage` con outcome tipado `EDITED | UNCHANGED | NOT_FOUND | FAILED`.
- [x] T3. Worker: `/panel` envia el panel; todo callback del teclado del panel re-renderiza el MISMO mensaje.
- [x] T4. Panel honesto: modo de ejecucion real via `executionModeLabel`/`Detail`, frescura con timestamp, `n/d` en vez de ceros.
- [x] T5. Tests: los 4 failure modes + que el panel nunca afirme publicacion en vivo + pin de contrato de `/status`.
- [x] T6. Verificacion integrada + work-unit commit `b8e2cb6`.

### Decisiones que tomo el writer (y valida el orquestador)

- **Los botones del panel usan `PANEL_*` y NO reutilizan los `BOT_*`.** Los `BOT_*` emiten mensajes nuevos al chat; si el panel los reusara, cada toque volveria a ensuciar el hilo. Los callbacks del panel son propios justamente para poder re-renderizar in situ.
- **`editTelegramMessage` devuelve un outcome tipado, no un booleano.** Un booleano obliga a un `if` que tiene que adivinar *por que* fallo; el outcome tipado hace que cada 400 exija su respuesta en el unico lugar que decide.
- **`UNCHANGED` se cuenta como exito silencioso** y `NOT_FOUND` dispara panel nuevo.
- Sin store de estado: `update.callback_query.message.message_id` ES el panel.

## Acceptance criteria

- `/panel` envia UN mensaje con teclado: `🔄 Refrescar` mas las acciones de control pertinentes.
- Tocar cualquier boton del panel re-renderiza el MISMO mensaje, sin emitir mensajes nuevos al chat.
- Tocar `🔄 Refrescar` sin cambios de estado no produce error visible.
- Si el mensaje fue borrado, el siguiente toque envia un panel nuevo en vez de fallar.
- El panel nunca afirma "en vivo" sobre publicacion; muestra el modo real del repricer.
- `/status` conserva su contrato actual.
- Suite verde, `tsc --noEmit` limpio, `ng build` AOT verde.

## TDD

- **Modo: no configurado explicitamente** (sin eleccion del usuario ni `sdd-init`; que existan specs NO habilita TDD). Runner: `npx ng test` / `npx ng build`.
- **Aplicacion pragmatica declarada**: test-junto-a-comportamiento. T5 cubre explicitamente los 4 failure modes, que es donde un panel de Telegram se rompe en produccion.

## Delivery

- **Forecast**: ~200-280 authored changed lines. **Por debajo del presupuesto de ~400**, asi que no hace falta split ni `size:exception`. Sin prisa de cadena.
- **Estrategia**: `single-pr` implicito (un work unit, un commit). Push y PR son decisiones del usuario bajo politica ordinaria del repo.

## Route

Delegado directo ODD (no SDD): un unico writer (core + worker acoplados por el mismo contrato de formatter/accion). Verificacion integrada por el orquestador.

## Verification evidence

Commit: `b8e2cb6` — `feat(telegram): add an editable terminal panel that never lies about the engine`
4 archivos, +948/-3, sin push. Desglose: `telegram-sentinel.ts` +155, `telegram-sentinel.spec.ts` +208, `telegram-worker.service.ts` +202, `telegram-worker.service.spec.ts` +386.

**594 de las 948 inserciones son tests** (208+386). Codigo de produccion: 357 lineas. El overshoot contra mi forecast de 200-280 es casi todo volumen de pruebas, no complejidad de diseno.

### Ejecutado por el writer (reportado)

- `npx tsc --noEmit` → exit 0
- `npx ng build` → `Application bundle generation complete` (AOT, 14.8s)
- spec de sentinel focalizado → 76 passing (antes 63)
- spec de worker focalizado → 65 passing (antes 42)
- `npx ng test core --watch=false` → 53 archivos, 586 passing
- `npx ng test p2p --watch=false` → 33 archivos, 278 passing
- `npm run check:vendor` → `24/24 identicos`
- **Mutation check**: romper la clasificacion de 400 y el fallback de NOT_FOUND fallo exactamente los 3 tests esperados. Los tests muerden.

### Re-ejecutado independientemente por el orquestador

- `npx tsc --noEmit` → `TSC_EXIT_0`
- `git show --stat HEAD` → los 4 archivos son exactamente los del alcance
- Lectura directa de `formatPanelTelegramMessage`: modo de ejecucion viene de `report.executionModeLabel`/`Detail` escapado; bloque `⚠️ Libro sin datos` explicito cuando falta profundidad; timestamp + flag `marketStale`; footer que explica que el mensaje se actualiza en el lugar.
- Lectura directa de `editTelegramMessage`: `readTelegramErrorDescription` + `telegramErrorMentions` clasifican `message is not modified` → `UNCHANGED` y `message to edit not found` → `NOT_FOUND`, con fallback a `sendTelegramMessage` en el segundo caso. `answerCallbackQuery` precede a toda edicion.

## Desviaciones y riesgos

- **Trabajo ajeno sin commitear en el arbol** (NO lo toque, NO lo commiteo): durante la verificacion aparecieron `projects/core/src/lib/accounts-repository.ts` + `.spec.ts` (untracked) y `projects/core/src/lib/public-api.ts` (modificado). Es trabajo en vuelo de otra sesion. Staged: solo mis archivos. Mismo patron que el incidente `4a67379`.
- **No se corrio prettier.** El repo ya estaba sucio (`repricer.ts` y `binance-repricer.service.ts` fallan) y no hay format gate; `--write` habria agregado churn ajeno a este cambio. Decision del writer, reasonable.
- **Presupuesto de review excedido.** El running count de la rama quedo en ~1386 authored changed lines (435 del workstream anterior + 951 de este), muy por encima del presupuesto de ~400. `delivery_strategy` no fue elegida por el usuario para esta feature. Como RDD esta `off` no hay gate de revision que dispare, y push/PR es decision suya; lo dejo expuesto, no bloqueado.
- `check:vendor` (24/24) NO cubre `telegram-sentinel.ts`: sigue fuera de `VENDOR_NAMES`. Deuda ya registrada.
