# P2P Core — Vendoring controlado para el build de Electron

Copia **byte-idéntica** (pin técnico) de los motores de dominio de
`projects/core/src/lib/*.ts` requeridos por `electron/main/gemini-skills.ts`.

## ¿Por qué existe esta copia?

- `electron/tsconfig.json` usa `rootDir: "."`, así que `tsc` NO permite importar
  TypeScript fuera de `electron/` (error comprobado `TS6059`).
- `@p2p/core` no está publicado como paquete consumible (no hay `node_modules/@p2p`,
  ni `dist/` compilado).
- `packages/mcp-server/dist/index.js` es un bundle ESM que NO exporta los motores, y
  `executeFinancialSkill` debe permanecer **síncrona** (lo exige `gemini-orchestrator`),
  por lo que un `import()` dinámico en runtime es inviable.

=> Solución: los motores puros se COMPILAN como parte del build de Electron (tsc) y
se resuelven por `require` relativo en `electron/dist/main/vendor/p2p-core/...`. Esto
mantiene `tsc`, Vitest y el runtime correctos **sin modificar el árbol de build ni
scripts de compilación**.

## Regla de oro

**NO editar estos archivos a mano.** Si cambia `projects/core/src/lib/<X>.ts`,
re-sincronizar la copia byte-idéntica. El spec `electron/main/gemini-skills.spec.ts`
verifica la integridad copia↔original.

## Archivos incluidos (grafo de cierre completo)

money, log, operator-manager, accounts, johnson-depth, orderbook-microstructure,
binance-p2p, backup-encryption, triangular-arbitrage, bcv-intervention-predictor,
delta-neutral-hedge, volatility-forecaster, zk-market-mesh, fsm, receipt-ocr,
fraud-shield, dispute-copilot, trade-impact-simulator, spread-quality.

## Cómo re-sincronizar

Tres comandos npm gestionan la copia (script `scripts/sync-vendor-core.cjs`):

- `npm run sync:vendor` — re-copia byte-idéntico origen→destino (solo los 19 archivos; no-op si el hash ya coincide).
- `npm run check:vendor` — compara SHA-256 de cada par sin escribir; salida 0 solo si los 19 son idénticos.
- `npm run sync:vendor -- --update-readme` — actualiza la sección `## Estado de sincronización` de este README (fecha local + fingerprint SHA-256).

El spec `electron/main/gemini-skills.spec.ts` verifica la integridad copia↔original en los tests.

## Estado de sincronizacion

- Ultima verificacion: 2026-09-15 02:18 (local)
- Fingerprint SHA-256 (contenido concatenado de los 20 archivos vendored): `c0bc1c3e6ec18026834ed439054a5dd5158ab06fc31037ad63fd6ec5249e28d3`
- Recordatorio: `npm run check:vendor` compara copia vs original; `npm run sync:vendor` re-copia.
