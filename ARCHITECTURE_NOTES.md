# Architecture Status & Subsystem Notes

## 1. Executive Summary

This document records the architectural baseline, active boundaries, and precise implementation status of partially developed components in the **P2P Decision Support System** (`proyecto-p2p`).

Per the Copilot v2 evolution roadmap and architectural boundaries, three specialized subsystems remain intentionally partial and stubbed. They must **not** be expanded or wired into live production execution paths without fulfilling their respective prerequisites and passing architectural review.

---

## 2. In-Flight & Partial Subsystems

### 2.1. Dynamic Repricer (`SIMULATED_SUCCESS` Mode)

- **Current Status**: **PARTIAL / SIMULATED**
- **Location**: `electron/main/tools/evaluate_ad_repricing.ts`, `publish_ad_price.ts`, `toggle_ad_status.ts`
- **Current Behavior**:
  - The quantitative repricing algorithms (Avellaneda-Stoikov optimal quote derivation, depth-weighted spread adjustment, and competitor front-running margins) calculate valid target prices.
  - However, when attempting to mutate live Binance P2P advertisements, the engine returns `SIMULATED_SUCCESS` with simulated confirmation IDs.
- **Architectural Rationale**:
  - Live Binance C2C order modification requires signed HMAC SHA256 API credentials or session tokens (`/bapi/c2c/v2/friendly/c2c/adv/update`).
  - To prevent accidental fund exposure, front-running runaway loops, or SUDEBAN/Binance merchant account bans during desktop and mobile testing, all advertisement mutations are strictly barred from issuing live outbound network updates.
- **Prerequisites for Future Completion**:
  1. Secure API key and secret storage verification via the OS Keychain (`secret-store.ts`).
  2. Mandatory execution gatekeeping with the Risk Gatekeeper (`riskScore <= 20`, kill-switch inactive, daily account limits unbreached).
  3. Pre-flight and post-flight orderbook verification to detect slippage and adverse selection.

---

### 2.2. ZK-Market Mesh & Decentralized CRDT Sync (`sync ZK/CRDT`)

- **Current Status**: **STUBBED / DESIGN PROTOTYPE**
- **Location**: `packages/mcp-server/src/tools/consult_zk_market_mesh.ts`, `electron/main/services/crdt-sync.ts` (conceptual)
- **Current Behavior**:
  - The data contracts, state vector interfaces, and ZK payload schemas exist as interfaces and mock providers.
  - No active libp2p, WebRTC gossipsub, or cryptographic zero-knowledge proof generation pipeline is instantiated at runtime.
- **Architectural Rationale**:
  - The project operates primarily as an operator-grade local desktop and mobile workstation backed by SQLite (`decision_journal.db`).
  - Deploying a zero-knowledge market mesh requires compiling client-side proof generation circuits (e.g., Circom/SnarkJS or Noir) and establishing an encrypted peer-to-peer overlay network, which exceeds the scope and resource budget of the single-operator MVP.
- **Prerequisites for Future Completion**:
  1. Integration of an authenticated WebRTC signaling channel or local network gossip protocol.
  2. Verification circuit proving operator balance threshold without revealing bank account identifiers or counterparty details.
  3. Conflict-Free Replicated Data Type (CRDT) merge strategy with deterministic vector clocks for multi-operator desks.

---

### 2.3. Historical Data Lake & Depth Liquidity Heatmap (`data-lake / heatmap`)

- **Current Status**: **PARTIAL / UNCONNECTED IN UI**
- **Location**: `src/app/features/spread-monitor/`, `electron/main/db/`
- **Current Behavior**:
  - SQLite tables capture point-in-time snapshots of spreads, BCV interventions, and trade executions via the Decision Journal.
  - The full analytical Data Lake (continuous Level 2 orderbook tick archive) and high-density 2D liquidity depth heatmap remain unimplemented and disconnected from the main dashboard views.
- **Architectural Rationale**:
  - Streaming tick-by-tick orderbook depth across multiple banks (Banesco, Banco de Venezuela, Mercantil, Pago Móvil) generates heavy I/O and telemetry volume.
  - Writing high-frequency tick streams directly to SQLite in the main process thread risks blocking Electron IPC latency and UI responsiveness.
- **Prerequisites for Future Completion**:
  1. Offloading continuous market depth sampling to an isolated background worker thread or daemon.
  2. Storing raw historical ticks in columnar format (DuckDB or local Parquet partitions).
  3. High-performance GPU-accelerated rendering (Canvas 2D or WebGL) for real-time orderbook density heatmaps.

---

## 3. Operational Guardrails

1. **Gate 0 Provenance**: Simulated plans or outputs derived from stubbed services must **never** be presented to operators as verified live market feeds.
2. **Honest Provenance Badges**: Any component utilizing non-live feeds must maintain `esSimulado: true` / `isSimulated: true` and display the `⚠️ SIMULADO` warning chip.
3. **Strict Validation Pipeline**: All future changes touching these boundaries must pass `npm run validate:all` (vendor check 25/25, MCP tests 257/257, Electron tests 252/252, and TypeScript 0 errors).
