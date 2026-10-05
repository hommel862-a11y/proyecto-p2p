# Fase 2: Motor Contable Institucional (FIFO / Costeo de Inventario)

## Objective

Reemplazar la fórmula simplista de flujo de caja (`sellVes - buyVes - fees`) por un motor de costeo de inventario por lotes FIFO (First-In, First-Out), distinguiendo con rigor contable entre:
1. **Realized PnL (Ganancia o Pérdida Realizada):** Calculada sobre el volumen efectivamente cerrado/liquidado en bolívares y moneda extranjera.
2. **Capital Deployed / Cash Flow:** Flujo de caja neto de tesorería (dinero que salió vs dinero que entró).
3. **Open Inventory & Cost Basis:** Inventario remanente en custodia con su costo de adquisición ponderado en balance.

## Problem / Why

- En `projects/core/src/lib/log.ts:106`, `pnlVes` se calculaba como `sellVes - buyVes - fees`.
- Si un operador compra 1.000 USDT a 900 VES (gasta 900.000 VES) y vende 500 USDT a 950 VES (ingresa 475.000 VES), la ganancia real es de **+25.000 VES** con 500 USDT aún en inventario.
- Sin embargo, la fórmula anterior arrojaba `-425.000 VES`, asustando al operador con una pérdida catastrófica ficticia.
- En `projects/core/src/lib/ledger-exporter.ts:163`, `calculateOpPnL` calculaba `op.vesAmount - op.usdtAmount * op.price`, lo cual producía `0` o invertía el signo del deslizamiento (slippage).

## Scope

- `projects/core/src/lib/inventory-accounting.ts` (Nuevo):
  - Motor puro de costeo por lotes FIFO para arbitraje P2P (`computeFifoAccounting`).
  - Cobertura de posiciones long y rotaciones maker (short inventory sell-first).
  - Cálculo de PnL realizado neto, volumen cerrado, inventario abierto y tasa de acierto (win rate).
- `projects/core/src/lib/inventory-accounting.spec.ts` (Nuevo):
  - Pruebas exhaustivas de casos de compra total, venta parcial, lotes múltiples y slippage.
- `projects/core/src/lib/log.ts`:
  - Enriquecer `computeLogSummary` con el motor FIFO, preservando `capitalDeployed` para flujo de caja y exponiendo métricas de inventario abierto.
- `projects/core/src/lib/ledger-exporter.ts`:
  - Conectar el cálculo de PnL a la atribución FIFO de operaciones cerradas.
- Sincronización:
  - Ejecutar `npm run sync:vendor` para mantener `electron/main/vendor/p2p-core` byte-idéntico.
- Pruebas y TypeScript:
  - Validación completa con Vitest, Angular Test Runner y type-checks.
