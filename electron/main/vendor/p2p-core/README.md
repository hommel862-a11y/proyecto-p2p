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