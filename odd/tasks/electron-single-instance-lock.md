# Feature: App de escritorio no abre (single-instance lock zombie)

## Estado
- Fecha: 2026-09-23
- Rama: `feat/p2p-decision-tool-mvp`
- Estado: COMPLETADO

## Objective
Que `npm run electron:start` / el acceso directo de escritorio abra SIEMPRE la app P2P Decisor aunque exista una instancia previa zombie o con renderer caído. Hoy la app "no abre" en silencio (exit code 0, sin ventana) cuando otra instancia tiene el lock.

## Problem (evidencia recogida)
1. Lanzamiento de `electron .` con main instrumentado:
   - `main-index evaluated` ✓
   - `setName done, app.isReady=false` ✓
   - **`lock=false`** ← `app.requestSingleInstanceLock()` rechaza la nueva instancia
   - Proceso sale con código 0 a los ~1.0-1.5s, sin ningún error en stderr/stdout
2. Existía una instancia de Electron viva (PID 9148 + children: gpu/network/renderer/audio) arrancada a las 19:04 con el lock tomado.
3. El log `electron-launch.log` solo muestra errores de GPU cache (ruido no fatal, Chromium).
4. Cambio reciente sin commitear (electron/main/index.ts): `app.disableHardwareAcceleration()` con comentario "Renderer crashes reportados en Windows (Electron 44, Chromium 140) tras ~30-70s de vida" — correlaciona con el escenario: el renderer de la instancia vieja crasheó/colgó, la ventana quedó inservible o invisible, pero el proceso principal siguió vivo tomando el lock.
5. El manejador `second-instance` actual solo hace show/focus SI `mainWindow` existe. Si la ventana murió (`mainWindow === null`) o el renderer crasheó, la segunda instancia no revive nada: se cierra silenciosa.

## Why
El single-instance lock es correcto (evita dos renderers polling el mismo bot), pero el flujo de recuperación es incompleto: sin auto-recovery del renderer y sin recrear la ventana en `second-instance`, cualquier instancia zombie prolongada convierte la app en "no abre".

## Scope
- `electron/main/index.ts` — recuperación del ciclo de vida (único archivo a mutar).
- No tocar mcp-bootstrap ni el WIP sin commitear del empaquetado .asar.
- No tocar la build Angular dist (el fallback a servidor estático ya funciona).

## Constraints
- Mantener `requestSingleInstanceLock()` como guarda (no eliminar).
- Mantener `app.disableHardwareAcceleration()` (fix previo pendiente de commit, se conserva).
- Sin cambios de comportamiento en MCP bootstrap ni preload.

## Checklist

### T1. Auto-recovery del renderer
- [x] En `app.on('render-process-gone')`: si `details.reason` es `crashed`/`killed`/`oom`, recargar el `webContents` o recrear la ventana vía `ensureMainWindow()`.
- [x] `ensureMainWindow()`: si la ventana vive pero el webContents está crasheado/destruido, recarga; si la ventana no existe, la recrea con `createWindow()`.
- [x] Handlers globales `uncaughtException`/`unhandledRejection` registran errores en consola para no morir en silencio.

### T2. second-instance revive la ventana
- [x] En `app.on('second-instance')`: se llama `ensureMainWindow()` siempre — revivir si existe, recrear si no. Ya no queda inerte cuando `mainWindow` es null.

### T3. Verificación
- [x] `npx tsc -p electron/tsconfig.json --noEmit` → exit 0.
- [x] `npm run test:electron` → 79/79 pasan (2 corridas consecutivas; hubo 1 flake previo transitorio que no se replicó).
- [x] Prueba de reproducción: con una instancia zombie tomando el lock (`lock=false`), cualquier lanzamiento moría en ~1.5s sin ventana. Tras matar el zombie y aplicar el fix, el primer lanzamiento quedó vivo.
- [x] Prueba con la app abierta (PID 4668): segundo lanzamiento registró `[p2p] second-instance: revivir ventana principal` — el handler nuevo se ejecutó en producción, no solo en tests.
- [x] Ventana principal verificada: `MainWindowHandle` válido, título "Risk Rules", `Responding=True`, renderer vivo, servidor CORS/puente escuchando en 127.0.0.1:51857.

## Verification evidence
- Fecha: 2026-09-23
- `npx tsc -p electron/tsconfig.json --noEmit` → 0
- `npm run test:electron` → 79/79 pass
- App de escritorio abierta y respondiendo (PID principal 4668, renderer 23476)

## Next step
- NINGUNO pendiente para este feature. Queda pendiente del WIP previo (no tocado): commitear el refactor MCP .asar + `disableHardwareAcceleration` + fix de lock en una sola unidad coherente, bajo decisión del usuario.

## Route
- T1/T2: direct inline (un solo archivo, cambio mecánico ya entendido, sin diseño pendiente).