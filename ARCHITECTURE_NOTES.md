# Architecture Status & Subsystem Notes

## 1. Executive Summary

This document records the architectural baseline, active boundaries, and precise implementation status of partially developed or non-integrated components in the **P2P Decision Support System** (`proyecto-p2p`).

Per the Copilot v2 evolution roadmap and architectural boundaries, three specialized subsystems remain intentionally constrained to safe operational boundaries. They must **not** be wired into live outbound production execution paths without fulfilling their respective prerequisites and passing architectural review.

---

## 2. In-Flight & Subsystem States

### 2.1. Dynamic Repricer (`SIMULATED_SUCCESS` Mode)

- **Current Status**: **SAFE GUARDRAIL / SIMULATED BACKEND**
- **Location**:
  - MCP Tools: `packages/mcp-server/src/tools/evaluate_ad_repricing.ts`, `packages/mcp-server/src/tools/publish_ad_price.ts`, `packages/mcp-server/src/tools/toggle_ad_status.ts`
  - Domain Port: `src/app/core/binance-repricer.service.ts` (`RepricerAdPublisher`, line 90)
  - Publisher Implementation: `src/app/core/mcp-ad-publisher.service.ts` (`McpAdPublisherService`, line 86)
- **Current Behavior**:
  - The quantitative repricing algorithms (Avellaneda-Stoikov optimal quote derivation, depth-weighted spread adjustment, and competitor front-running margins) calculate valid target prices.
  - The domain port `RepricerAdPublisher` is implemented by `McpAdPublisherService`, dispatching to the MCP publisher tools.
  - When attempting to mutate live Binance P2P advertisements, the MCP tools intentionally return `SIMULATED_SUCCESS` with simulated confirmation IDs.
- **Architectural Rationale**:
  - Live Binance C2C order modification requires signed HMAC SHA256 API credentials or session tokens (`/bapi/c2c/v2/friendly/c2c/adv/update`).
  - To prevent accidental fund exposure, front-running runaway loops, or SUDEBAN/Binance merchant account bans during desktop and mobile testing, all advertisement mutations are strictly barred from issuing live outbound network updates.
- **Prerequisites for Future Completion**:
  1. Secure API key and secret storage verification via the OS Keychain (`electron/main/db/secret-store.ts`).
  2. Mandatory execution gatekeeping with the Risk Gatekeeper (`riskScore <= 20`, kill-switch inactive, daily account limits unbreached).
  3. Pre-flight and post-flight orderbook verification to detect slippage and adverse selection.

---

### 2.2. ZK-Market Mesh & Decentralized CRDT Sync (`sync ZK/CRDT`)

- **Current Status**: **COMPLETE BACKEND & DOMAIN ENGINE / PENDING ANGULAR CLIENT CONNECTION**
- **Location**:
  - CRDT Engine: `projects/core/src/lib/sync-hub.ts` (`SyncHubEngine`)
  - Server Store: `packages/telegram-daemon/src/sync-store.ts` (`EncryptedSyncStore`)
  - Angular Client Stub: `src/app/core/telegram-worker.service.ts` (line 1296)
  - MCP Mesh Tool: `packages/mcp-server/src/tools/consult_zk_market_mesh.ts`
- **Current Behavior**:
  - The pure domain CRDT engine (`SyncHubEngine`) is **complete, fully implemented and tested**, providing multi-device opaque AES-256-GCM encrypted record synchronization, vector clocks, and deterministic Last-Write-Wins (LWW) conflict resolution.
  - The VPS daemon server store (`EncryptedSyncStore`) is **complete, fully implemented and tested**, persisting encrypted sync payloads to disk and managing client push/pull deltas.
  - The client side in Angular (`src/app/core/telegram-worker.service.ts:1296`) currently fabricates `SyncHubStats` locally rather than polling or pushing to the live daemon sync endpoint.
- **Architectural Rationale**:
  - Core domain logic and server persistence are validated, while the Angular client transport layer was deferred to preserve desktop/mobile MVP focus on the local decision journal and risk gates.
- **Prerequisites for Future Completion**:
  1. Connecting the Angular service to live HTTP/WebSocket endpoints exposed by `EncryptedSyncStore`.
  2. End-to-end device onboarding flow with key derivation from operator passphrase.

---

### 2.3. Historical Data Lake & Depth Liquidity Heatmap (`data-lake / heatmap`)

- **Current Status**: **COMPLETE ANALYTICAL ENGINES / PENDING ANGULAR UI VIEW**
- **Location**:
  - Microstructure Data Lake: `packages/telegram-daemon/src/data-lake.ts` (`MicrostructureDataLake`)
  - Heatmap Matrix Engine: `projects/core/src/lib/heatmap-calculator.ts` (`computeHeatmapMatrix`)
- **Current Behavior**:
  - The underlying analytical engines are **complete, fully implemented and tested**:
    - `MicrostructureDataLake` captures and persists market ticks (`.data_lake_ticks.json`), manages memory caps, and slices historical liquidity windows.
    - `computeHeatmapMatrix` calculates the full 7x24 (168 cells) seasonality matrix, identifying peak spread windows, liquidity scores, and golden spread ratios.
  - What remains pending is solely the dedicated Angular dashboard component to visually render the interactive 2D matrix in the desktop/mobile UI.
- **Architectural Rationale**:
  - Backend calculation and Telegram daemon reporting pipelines are operational; frontend visualization requires dedicated charting/grid UI work.
- **Prerequisites for Future Completion**:
  1. Dedicated Angular heatmap component/canvas view.
  2. IPC / service wire to stream calculated matrix cells into the renderer.

---

## 3. Operational Guardrails

1. **Gate 0 Provenance**: Simulated plans or outputs derived from stubbed services must **never** be presented to operators as verified live market feeds.
2. **Honest Provenance Badges**: Any component utilizing non-live feeds must maintain `esSimulado: true` / `isSimulated: true` and display the `⚠️ SIMULADO` warning chip.
3. **Strict Validation Pipeline**: All future changes touching these boundaries must pass `npm run validate:all` (vendor check 25/25, MCP tests 257/257, Electron tests 252/252, and TypeScript 0 errors).
