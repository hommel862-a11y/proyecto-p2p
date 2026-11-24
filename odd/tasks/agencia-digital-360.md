Objective: Design, structure, and build Agencia Digital 360 (Execution Module) across 5 sequential verified Sprints in `agencia-digital-360/` and `src/app/features/agencia-360/` on `E:\` without saturating `C:\`.
Branch: `feat/p2p-decision-tool-mvp` | Delivery strategy: `ask-on-risk` | Forecast authored lines: ~1,800 across 5 Sprints (~360/sprint)
Test runner: `pytest` (Python backend in `E:\05_Proyectos\proyecto p2p\agencia-digital-360\backend`) & `npx ng test --watch=false` (Angular UI)

## Specs

- **S1 — Repository Structure, Docker Environment, Zero-C-Drive Disk Policy & VET Foundation (Sprint 1):**
  - Verbatim requirements:
    - `"Regla de Ejecución: Trabaja estrictamente por Sprints. Inicia generando la estructura del repositorio, el entorno Docker y el Sprint 1. Al finalizar cada Sprint, detente, entrega un resumen de verificación y espera confirmación antes de pasar al siguiente."`
    - `"agencia-digital-360/ ├── docker-compose.yml # Backend, Redis, Celery Worker, MoneyPrinterTurbo (CPU/RAM limit) ├── .env.example # Claves de Meta, YouTube, TikTok, Gemini, OpenAI, Nano Banana, Telegram, ARM ├── database/ │ └── schema.sql # Tablas independientes (brands, campaigns, creative_briefs, ad_treasury_ledger, etc.)"`
    - `"backend/app/main.py"`, `"backend/app/core/ # Config, seguridad, zona horaria VET (UTC-4)"`, `"docs/arm_webhook_contract.json # Contrato de integración Agencia <-> ARM"`
    - `"Seguridad de Archivos Locales: Para el módulo de Clips Virales desde PC, el worker solo tendrá permisos de lectura en el directorio autorizado E:\Agencia_Inbox\."`
  - Acceptance criteria & checks:
    - All project files, virtual environments, and cache directories reside on `E:\` (`E:\05_Proyectos\proyecto p2p\agencia-digital-360\` and `E:\Agencia_Inbox\`).
    - `docker-compose.yml` defines resource limits (`cpus`, `mem_limit`), `concurrency=1` for the video worker, and `:ro` read-only volume mount for `E:\Agencia_Inbox\`.
    - `database/schema.sql` defines isolated tables (`brands`, `campaigns`, `creative_briefs`, `media_assets`, `ad_treasury_ledger`, `hitl_approvals`, `arm_attribution_events`) with `VET (UTC-4)` timestamps and Row-Level Security (RLS).
    - `docs/arm_webhook_contract.json` defines HMAC-SHA256 outbound (`ad_id`/`campaign_id`) and inbound (`closed_won`) schemas.
    - FastAPI core (`app/main.py`, `app/core/config.py`, `app/core/security.py`) passes unit tests (`pytest`).

- **S2 — Treasury Vault Controller, 4 Specialist AI Agents & Telegram Mobile HITL Bridge (Sprint 2):**
  - Verbatim requirements:
    - `"2. Aislamiento de Activos (Compliance P2P/Comercios): Cada marca/negocio en la tabla brands debe manejar sus propias credenciales, páginas y cuentas publicitarias de forma aislada. Nunca mezclar activos de distintos rubros."`
    - `"3. Stack de IA compatible con Venezuela: Usar exclusivamente Gemini Pro (análisis multimodal de video/audio, auditoría, curaduría de clips y contexto largo), OpenAI / ChatGPT (copys de venta directa) y Nano Banana (generación de base visual para flyers). No depender de APIs bloqueadas en Venezuela."`
    - `"6. Control Human-in-the-Loop: Ningún gasto publicitario ni renderizado masivo se ejecuta sin aprobación previa desde el Dashboard o botones interactivos en Telegram."`
    - `"agents/ # 1. Director Creativo, 2. Auditor/Compliance, 3. Trafficker, 4. Controlador Bóveda"`
    - `"treasury.py # Bóveda de Pauta, spend_cap y alertas 20%"`
  - Acceptance criteria & checks:
    - `treasury.py` enforces `spend_cap`, double-entry reservations, and emits an alert when remaining balance reaches `<= 20%`.
    - All 4 agents and Telegram inline HITL approval callbacks (`Aprobar Pauta`, `Aprobar Render`, `Pausar Campaña`) + voice-note brief ingestion pass unit tests.

- **S3 — Creative Production Pipelines & Isolated Concurrency=1 Celery Workers (Sprint 3):**
  - Verbatim requirements:
    - `"4. Rendimiento sin bloqueo (Concurrencia = 1): Todo procesamiento pesado (renderizado de video, FFmpeg, faster-whisper, scraping de tendencias) debe ejecutarse en workers asíncronos aislados. MoneyPrinterTurbo debe correr en su propio contenedor Docker con límites de CPU/RAM y cola de concurrencia máxima = 1 para no congelar el Backend, el Frontend ni el equipo local."`
    - `"video_pipeline.py # Orquestador Google Flow/Higgsfield -> MoneyPrinterTurbo (voz propia + A/B ganchos)"`
    - `"Motor de Renderizado V1: Contenedor aislado de MoneyPrinterTurbo en modo API REST con parche custom_audio_path (salta TTS para usar voz propia grabada y sincroniza subtítulos con Whisper)."`
    - `"viral_clips.py # Entrada dual (PC Local + YouTube quirúrgico --download-sections + 9:16)"`
    - `"flyer_pipeline.py # Nano Banana + capa de texto/branding"`
  - Acceptance criteria & checks:
    - `video_pipeline.py`, `viral_clips.py` (strictly locked to `E:\Agencia_Inbox\` + `yt-dlp --download-sections` + 9:16 MediaPipe Kalman auto-crop), `flyer_pipeline.py`, and Celery `concurrency=1` worker pass unit tests.

- **S4 — Multi-Platform Ad Integrations & Decoupled ARM Attribution Bridge (Sprint 4):**
  - Verbatim requirements:
    - `"1. Desacoplamiento total del ARM: El sistema ARM de atención al cliente ya existe y está consolidado. NO mezcles bases de datos ni modifiques el núcleo del ARM. Toda comunicación Agencia ↔ ARM ocurre exclusivamente vía Webhooks/REST JSON (atribución de ad_id/campaign_id de salida y notificación de venta cerrada closed_won de retorno)."`
    - `"integrations/ # Meta (Graph, Marketing, Ad Library, CAPI), YouTube Data v3, TikTok, ARM Bridge, Telegram"`
  - Acceptance criteria & checks:
    - Outbound `ad_id`/`campaign_id` webhook to ARM and inbound `closed_won` webhook from ARM -> automatic server-side Meta CAPI / TikTok Events API `Purchase` dispatch pass unit tests.

- **S5 — Angular Zoneless Spatial Liquid Glass Frontend ("Ejecución" 5 Sub-Tabs + Executive Dashboard) (Sprint 5):**
  - Verbatim requirements:
    - `"Frontend (Pestaña "Ejecución"): Angular (Zoneless, TypeScript) con diseño modular de alto contraste y vista previa 9:16."`
    - `"frontend/ # SPA Angular (5 sub-pestañas en "Ejecución" + Dashboard Ejecutivo)"`
    - `"quiero que vaya más o menos con un glass morphing bien organizado"`
  - Acceptance criteria & checks:
    - Spatial Liquid Glass 4-theme component suite (`dark`, `apple-dark`, `light`, `neon-pink`), 0 hardcoded hex colors, 9:16 preview player, scoped `Ctrl+K`, unit tests and Playwright E2E checks pass.

- **S6 — Zero-Seed UI Purge, SQLite Persistence on `E:\` & Per-Brand API Connections Manager (Bloque 1):**
  - Verbatim user feedback:
    - `"Salen unas bóvedas de pauta y salen gastos acumulados y sale ROAS real de atributo atribuido de AMR $2000, o sea, sale otro lado 540, en otro lado sale 2450 en la bóveda de pauta y yo no he puesto sin ningún dinero, no se ha puesto cargar. Aparecen unas tiendas afiliadas a Cashea, una mesa de liquidez y una importadora mayorista de 2B que no debería aparecer allí"`
    - `"no tengo cómo decir cómo conectar las API para para montar los reels o para montar lo que se está trabajando o lo que se empieza a trabajar."`
  - Acceptance criteria & checks:
    - Zero hardcoded demo brands, zero invented balances/ROAS, zero fake hooks/clips/flyers/proposals in `Agencia360Component`. Starts strictly at `0 brands` and `$0.00` with an onboarding wizard (`+ Crear Mi Primera Marca`).
    - Persistent SQLite database on `E:\` (`agencia-digital-360/storage/agencia360.db`) storing brands, encrypted per-brand & global API credentials, uploaded media assets, briefs, render jobs, ledger entries, and HITL proposals.
    - Dedicated **Conexiones & APIs** modal in Angular UI + live `/api/v1/connections` & `/api/v1/connections/test` endpoints verifying real Gemini (`google-genai`), OpenAI, Meta Graph, Telegram, and ARM connectivity.

- **S7 — Real Media Upload Vault, Browser Voice Recorder, Real 9:16 `<video>`/`<img>` Player & Real Gemini 3.8 / Omni 1.2 Flash / Nano Banana 2.1 Execution (Bloque 2):**
  - Verbatim user feedback:
    - `"Donde sale video pipelín, archivo de voz, locutor y tal, eso no no no sé cómo coordinar y no sé cómo hacer para que el video, los videos en verdad se generen, los clips, las imágenes, los flyer. O sea, no no no sé cómo coordinamos eso allí y cómo yo pueda montar mis imágenes y mis videos por aquí."`
    - `"Cómo podemos coordinar que podamos trabajar directamente dentro de Google Flow, ya sea con la API de Google Flow o con el MCP de Google Flow, donde nosotros generemos los videos pasándole la foto o pasándole el prompt"`
  - Acceptance criteria & checks:
    - Real `POST /api/v1/media/upload` (`multipart/form-data` for photos, videos, custom voice audio) and `GET /api/v1/media/files/{brand_slug}/{category}/{filename}` serving real playable files.
    - Real drag & drop Media Vault + browser microphone recorder (`MediaRecorder`) + Watch-Folder `E:\Agencia_Inbox\flow_exports\` for Google Flow exports.
    - Real `google-genai` adapters targeting current 2026 models (`gemini-3.8-flash` multimodal Creative Director & Compliance Auditor, `gemini-nano-banana-2.1` image generation with product reference photos, `gemini-omni-1.2-flash` image-to-video / text-to-video 9:16) + honest local FFmpeg/yt-dlp status telemetry + real HTML5 `<video controls>` / `<img>` preview inside `.phone-frame-916`.

- **S8 — Real Click-to-WhatsApp (CTWA) Meta Marketing API Launcher & Card Mirror Billing Kill-Switch (Bloque 3):**
  - Verbatim user feedback:
    - `"ver cómo nos integramos para que lancemos la propaganda desde allí o las campañas de publicidad desde allí sin entrar al tema de Facebook, sino que lo hagamos por allí mismo o coordinemos con el WhatsApp por ahí mismo y lancemos la propaganda. Quiero ver cómo se va a pagar la propaganda, quiero ver cómo vamos a integrar el tema del pago."`
  - Acceptance criteria & checks:
    - 5-step Meta Marketing API v21.0 CTWA launcher (`advideos` -> `campaigns` -> `adsets` (`WHATSAPP` + `CONVERSATIONS`) -> `adcreatives` (prefilled tracking message) -> `ads` (`PAUSED` until HITL)) + Card Mirror Vault (`card_label`, `card_last4`, `funded_usd`, `meta_amount_spent_usd`, 80% alert, 95% auto-pause kill-switch).

## Tasks

- [x] **T1** (S1) — Route: `inline` — Safe cache cleanup on `C:`/`E:` (+2.07 GB freed on `C:`, 0 bytes added to `C:`) + Sprint 1 foundation (`agencia-digital-360/docker-compose.yml`, `.env.example`, `database/schema.sql`, `docs/arm_webhook_contract.json`, `E:\Agencia_Inbox\`, FastAPI core `app/main.py`, `app/core/config.py`, `app/core/security.py`, `app/core/models.py`, and Sprint 1 `pytest` suite: RED 9/9 failed -> GREEN 9/9 passed) — Commit: `55514e6` (Risk: none — new isolated module directory `agencia-digital-360/`)
- [x] **T2** (S2) — Route: `inline` — Sprint 2: `treasury.py` (`spend_cap` + 20% alert + double-entry reservations + ROAS), 4 Specialist Agents (`creative_director.py`, `compliance_auditor.py`, `trafficker.py`, `vault_controller.py`), Telegram HITL bot (`telegram_bot.py` voice notes + inline buttons) & `pytest` verification (RED 6/6 failed -> GREEN 15/15 passed) — Commit: `bf94697` (Risk: none — isolated `agencia-digital-360/backend`)
- [x] **T3** (S3) — Route: `inline` — Sprint 3: `video_pipeline.py` (`MoneyPrinterTurbo` + `custom_audio_path` + A/B hooks + Whisper sync), `viral_clips.py` (`E:\Agencia_Inbox\` read-only guard + `yt-dlp --download-sections` + 9:16 Kalman auto-crop), `flyer_pipeline.py` (Nano Banana + deterministic Pillow overlay), and Celery `concurrency=1` workers (`celery_app.py`, `tasks.py`) + `pytest` verification (RED 5/5 failed -> GREEN 20/20 passed) — Commit: `6880cca` (Risk: none — isolated `agencia-digital-360/backend`)
- [x] **T4** (S4) — Route: `inline` — Sprint 4: Multi-platform integrations (`meta_ads.py` Graph/Marketing/Ad Library/CAPI SHA-256 hashing, `tiktok_ads.py`, `youtube_v3.py`, `arm_bridge.py` bilateral HMAC webhooks + idempotency + automatic CAPI `Purchase` dispatch) + `pytest` verification (RED 3/3 failed -> GREEN 23/23 passed) — Commit: `e46821f` (Risk: none — isolated `agencia-digital-360/backend`)
- [x] **T5** (S5) — Route: `inline` — Sprint 5: Angular Zoneless Spatial Liquid Glass UI (`src/app/features/agencia-360/` with 5 sub-tabs + Executive Dashboard, 9:16 preview, 4 themes, 0 hardcoded hex, scoped `Ctrl+K`, `/agencia-360` route) + verification (`tsc` 0 errors, `eslint` 0 errors, `ng test` 5/5 passed) — Commit: `768d613` (Risk: none — new lazy route `/agencia-360`)
- [x] **T6** (S1–S5 Integration) — Route: `inline` — Sprint 6: Full FastAPI live routes + CORS + `E:\Agencia_Inbox\` scanner + Angular `Agencia360ApiService` live wiring + Mobile Drawer navigation + `start-agencia360.ps1` Zero-C-Drive launcher + `ng build` (`exit 0`, 0 style warnings) + 4-Theme Playwright E2E verification (`e2e/web/agencia-360.spec.ts`: 2/2 passed across Desktop 1440×900 4 themes & Mobile 9:16 390×844, 0px overflow) — Commit: `f719a34` (Risk: none)
- [x] **T7** (S6) — Route: `inline` — Bloque 1: Zero-Seed purge + SQLite persistence (`backend/app/core/database.py`) + Real Per-Brand/Global API Connections Vault & Live Tester (`/api/v1/connections/*`) + Angular Onboarding Wizard & Connections Drawer — Commit: `80e7929` (Risk: none)
- [x] **T8** (S7) — Route: `inline` — Bloque 2: Real Media Upload (`POST /api/v1/media/upload`) & File Serving + Google Flow Watch-Folder (`E:\Agencia_Inbox\flow_exports\`) + Real `google-genai` 2026 Models (`gemini-3.8-flash`, `gemini-nano-banana-2.1`, `gemini-omni-1.2-flash`) + Real HTML5 `<video>`/`<img>` 9:16 Player & Browser Mic Recorder — Commit: `80e7929` (Risk: none)
- [x] **T9** (S8) — Route: `inline` — Bloque 3: Real Meta Marketing API v21.0 Click-to-WhatsApp (CTWA) 5-Step Campaign Launcher + Card Mirror Billing Kill-Switch (80% alert / 95% auto-pause) + Full Verification (`pytest` 30/30, `tsc` 0, `eslint` 0, `ng test` 4/4, `ng build` exit 0, Playwright 4-theme E2E 2/2) — Commit: `80e7929` (Risk: none)

## Log

- **L1 (2026-11-23):** User initial request verbatim:
  `"# MASTER SPECIFICATION: AGENCIA DIGITAL 360 (Módulo de Ejecución) ... Regla de Ejecución: Trabaja estrictamente por Sprints. Inicia generando la estructura del repositorio, el entorno Docker y el Sprint 1. Al finalizar cada Sprint, detente, entrega un resumen de verificación y espera confirmación antes de pasar al siguiente. ... vas a nalizar esta informacion vas a coordinar un plan para organizar mejor este proyecto y vas a buscar que otras mejoras podemos implementar vas a trabajar como un ingeniero de software especializado en este entorno si tienes que lanzar en paralelo un equipo de agentes hazlo para organizar un mejor desempeno y bueno organisemos una propuesta tambien con el tema del Dashboard. En la UI, el tema de cómo va a ser la interfaz, quiero que me des las imágenes. Quiero que a partir de las imágenes que ya te he pasado para los otros partes de la herramienta como Finanzas 360 o otro tipo de imágenes que tienen los dashboards que nosotros hemos implementado, busques cómo pudiera ser ese dashboard, el dashboard, la UI, la interfaz y quiero que vaya más o menos con un glass morphing bien organizado."`
- **L2 (2026-11-23):** User asked about quota and disk space / Docker impact:
  `"Vamos a orquestarlo con Aragon 4, el orquestador. Sí me alcanza en el disco duro para colocarlo en Docker y organizarlo con Docker, porque no sé cuánto me queda en Docker y en el disco duro. Sí me alcanza para hacerlo como tal. Y si no, buscar la manera de ganar más megabytes borrando archivos basura y borrando caché que esté saturando el disco duro. No tocar los programas ni las configuraciones de las inteligencias artificiales como las tengo configuradas, pero borrar el caché de Google Chrome o otras cosas que se puedan borrar para liberar espacio para poder arrancar con el plan de manera de que no se gaste o se sature el disco. Vamos a hacer ese análisis y empezamos. Después de eso, planteamos a ver si podemos coordinar el plan como tal."`
- **L3 (2026-11-23):** User authorized safe cache cleanup (`~3.51 GB`) and starting Sprint 1 on `E:\`: `"si hazlo "`
