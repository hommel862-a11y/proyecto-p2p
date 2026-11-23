# Agencia Digital 360 — Frontend (Angular Zoneless · Spatial Liquid Glass)

The **Agencia Digital 360 ("Ejecución")** frontend is integrated directly into the Angular 21 Zoneless workspace under:

- **Route:** `/#/agencia-360` (`src/app/app.routes.ts`)
- **Component & Models:** `src/app/features/agencia-360/`
  - `agencia-360.component.ts` / `.html` / `.scss` / `.spec.ts`
  - `agencia-360.models.ts`
  - `styles/_ag360-glass-tokens.scss` (4-theme Spatial Liquid Glass tokens: `dark`, `apple-dark`, `light`, `neon-pink`, 0 hardcoded hex colors, Apple HIG 2-layer discipline)

## Sub-Tabs Included
1. `00. Overview & Bóveda` — Executive dashboard, isolated brand vaults (`brands`), ROAS from ARM `closed_won`, and 20% low-balance alerts.
2. `01. Brief & Director IA` — Gemini 1.5 Pro + OpenAI GPT-4o + Nano Banana creative brief studio and A/B/C hook matrix.
3. `02. Video Pipeline 9:16` — `MoneyPrinterTurbo` orchestrator with `custom_audio_path` override and `faster-whisper` subtitle sync.
4. `03. Clips Virales Dual` — Local read-only sandbox (`E:\Agencia_Inbox\`) and surgical YouTube (`yt-dlp --download-sections`) with MediaPipe Kalman 9:16 auto-crop.
5. `04. Nano Banana Flyers` — 2-layer commercial flyer generator (Nano Banana visual base + deterministic vector branding overlay).
6. `05. Trafficker & Telegram HITL` — Pre-flight compliance auditor, multi-platform ad launcher, and Human-in-the-Loop approval controls.
