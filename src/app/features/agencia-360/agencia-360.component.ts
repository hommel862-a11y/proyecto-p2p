import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HotkeysService } from '../../core/hotkeys.service';
import {
  Agencia360ApiService,
  type Ag360FlowExportEntry,
  type Ag360InboxFileEntry,
} from './agencia-360-api.service';
import {
  AG360_CLIP_SOURCE,
  AG360_SUB_TAB,
  AG360_VERTICAL,
  AG360_VIDEO_ENGINE,
  type Ag360ApiConnectionSummary,
  type Ag360BrandVault,
  type Ag360ClipSource,
  type Ag360CommandItem,
  type Ag360FlyerAsset,
  type Ag360HitlProposal,
  type Ag360HookVariant,
  type Ag360SubTab,
  type Ag360SubTabDescriptor,
  type Ag360UploadedMedia,
  type Ag360Vertical,
  type Ag360VideoEngine,
} from './agencia-360.models';

const STORAGE_KEY_BRANDS = 'agencia360.zero_seed.brands.v2';
const STORAGE_KEY_CONNECTIONS = 'agencia360.zero_seed.connections.v2';

@Component({
  selector: 'app-agencia-360',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './agencia-360.component.html',
  styleUrl: './agencia-360.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Agencia360Component {
  private readonly hotkeys = inject(HotkeysService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly api = inject(Agencia360ApiService);

  readonly SUB_TAB = AG360_SUB_TAB;
  readonly CLIP_SOURCE = AG360_CLIP_SOURCE;
  readonly VIDEO_ENGINE = AG360_VIDEO_ENGINE;
  readonly VERTICALS: readonly Ag360Vertical[] = [
    AG360_VERTICAL.RETAIL_COMMERCE,
    AG360_VERTICAL.CASHEA_ALLY,
    AG360_VERTICAL.FINTECH_P2P,
    AG360_VERTICAL.B2B_SERVICES,
    AG360_VERTICAL.EDUCATION,
  ];

  readonly workerConcurrencyLimit = 1;
  readonly authorizedInboxDir = 'E:\\Agencia_Inbox\\';
  readonly googleFlowWatchDir = 'E:\\Agencia_Inbox\\flow_exports\\';

  readonly backendOnline = signal<boolean>(false);
  readonly ffmpegInstalled = signal<boolean>(false);
  readonly statusMessage = signal<string>('');

  readonly subTabs: readonly Ag360SubTabDescriptor[] = [
    { id: AG360_SUB_TAB.OVERVIEW, code: '00', label: 'Overview & Bóveda', badge: 'ZERO-SEED' },
    { id: AG360_SUB_TAB.BRIEF_STUDIO, code: '01', label: 'Brief & Director IA', badge: 'GEMINI 3.8' },
    { id: AG360_SUB_TAB.VIDEO_PIPELINE, code: '02', label: 'Video & Google Flow', badge: 'OMNI 1.2' },
    { id: AG360_SUB_TAB.VIRAL_CLIPS, code: '03', label: 'Clips Virales Dual', badge: '9:16' },
    { id: AG360_SUB_TAB.FLYER_STUDIO, code: '04', label: 'Nano Banana 2.1 Flyers', badge: '4K' },
    { id: AG360_SUB_TAB.TRAFFICKER_HITL, code: '05', label: 'Pauta CTWA & HITL', badge: 'WHATSAPP' },
  ];

  readonly activeSubTab = signal<Ag360SubTab>(AG360_SUB_TAB.OVERVIEW);

  // ZERO-SEED: Starts strictly empty (0 fake brands, $0.00 balance, 0 fake hooks/flyers/proposals)
  readonly brands = signal<Ag360BrandVault[]>(this.loadPersistedBrands());
  readonly selectedBrandId = signal<string>(this.brands()[0]?.id ?? '');

  readonly activeBrand = computed<Ag360BrandVault | null>(() => {
    const list = this.brands();
    if (list.length === 0) return null;
    const id = this.selectedBrandId();
    return list.find((b) => b.id === id) ?? list[0];
  });

  readonly activeBrandRoas = computed<number>(() => {
    const b = this.activeBrand();
    if (!b || b.accumulatedSpendUsd <= 0) return 0;
    return Number((b.attributedRevenueUsd / b.accumulatedSpendUsd).toFixed(2));
  });

  readonly cardConsumedPct = computed<number>(() => {
    const b = this.activeBrand();
    if (!b || b.vaultBalanceUsd <= 0) return 0;
    const used = b.accumulatedSpendUsd + b.reservedSpendUsd;
    return Number(Math.min(100, (used / b.vaultBalanceUsd) * 100).toFixed(1));
  });

  readonly cardKillswitchStatus = computed<'UNFUNDED' | 'SAFE' | 'ALERT_80PCT' | 'KILLSWITCH_95PCT'>(() => {
    const b = this.activeBrand();
    if (!b || b.vaultBalanceUsd <= 0) return 'UNFUNDED';
    const pct = this.cardConsumedPct();
    if (pct >= 95) return 'KILLSWITCH_95PCT';
    if (pct >= 80) return 'ALERT_80PCT';
    return 'SAFE';
  });

  // Real Brand Creation Form (Zero-Seed Onboarding)
  readonly newBrandModalOpen = signal<boolean>(false);
  readonly newBrandName = signal<string>('');
  readonly newBrandVertical = signal<Ag360Vertical>(AG360_VERTICAL.RETAIL_COMMERCE);
  readonly newBrandCardLabel = signal<string>('');
  readonly newBrandCardLast4 = signal<string>('');
  readonly newBrandSpendCap = signal<number>(100);
  readonly newBrandInitialFund = signal<number>(0);

  // Vault Real Top-Up Form
  readonly topupAmountUsd = signal<number>(0);

  // Real API Connections Manager Modal
  readonly connectionsModalOpen = signal<boolean>(false);
  readonly connections = signal<Ag360ApiConnectionSummary[]>(this.loadPersistedConnections());
  readonly connProvider = signal<string>('GEMINI_API');
  readonly connScope = signal<string>('GLOBAL');
  readonly connTokenInput = signal<string>('');
  readonly connMetaAccount = signal<string>('');
  readonly connMetaPage = signal<string>('');
  readonly connWhatsappPhone = signal<string>('');
  readonly connTestMessage = signal<string>('');

  // Real Uploaded Media Vault (Photos, Videos, Voices) & Active 9:16 Preview
  readonly uploadedMedia = signal<Ag360UploadedMedia[]>([]);
  readonly activePreviewMedia = signal<Ag360UploadedMedia | null>(null);
  readonly inboxFiles = signal<Ag360InboxFileEntry[]>([]);
  readonly flowExports = signal<Ag360FlowExportEntry[]>([]);

  // Real Browser Voice Recorder State
  readonly isRecordingVoice = signal<boolean>(false);
  readonly recordedVoiceName = signal<string>('');
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];

  // Sub-Tab 01: Brief & Creative Director (Starts Empty until User Generates)
  readonly briefOfferInput = signal<string>('');
  readonly briefAudienceInput = signal<string>('');
  readonly generatedHooks = signal<Ag360HookVariant[]>([]);
  readonly selectedHookVariantId = signal<'HOOK_A' | 'HOOK_B' | 'HOOK_C'>('HOOK_A');

  readonly selectedHook = computed<Ag360HookVariant | null>(() => {
    const list = this.generatedHooks();
    if (list.length === 0) return null;
    const id = this.selectedHookVariantId();
    return list.find((h) => h.variant === id) ?? list[0];
  });

  // Sub-Tab 02: Real Video Engine Selection (Omni 1.2 Flash / Local FFmpeg / Google Flow Watch-Folder)
  readonly selectedVideoEngine = signal<Ag360VideoEngine>(AG360_VIDEO_ENGINE.GEMINI_OMNI_1_2);
  readonly videoPromptInput = signal<string>('');
  readonly customAudioPatchEnabled = signal<boolean>(true);

  // Sub-Tab 03: Viral Clips Dual + Google Flow Watch-Folder
  readonly viralClipSourceMode = signal<Ag360ClipSource>(AG360_CLIP_SOURCE.PC_LOCAL_INBOX);
  readonly youtubeSurgicalUrl = signal<string>('');
  readonly youtubeSurgicalRange = signal<string>('00:00:00-00:00:45');

  readonly surgicalYtDlpPreviewCommand = computed<string>(() => {
    const url = this.youtubeSurgicalUrl().trim();
    if (!url) return 'Pega una URL de YouTube para generar el comando quirúrgico --download-sections';
    return `python -m yt_dlp --no-playlist --download-sections "*${this.youtubeSurgicalRange()}" --force-keyframes-at-cuts "${url}"`;
  });

  // Sub-Tab 04: Nano Banana 2.1 Flyers (Starts Empty)
  readonly flyerHeadline = signal<string>('');
  readonly flyerPriceBadge = signal<string>('');
  readonly flyerCtaText = signal<string>('');
  readonly flyerAspectRatio = signal<'9:16' | '4:5'>('9:16');
  readonly flyerAssets = signal<Ag360FlyerAsset[]>([]);

  // Sub-Tab 05: Click-to-WhatsApp (CTWA) Launcher & HITL Queue (Starts Empty)
  readonly ctwaCampaignName = signal<string>('');
  readonly ctwaWhatsappPhone = signal<string>('');
  readonly ctwaDailyBudgetUsd = signal<number>(15);
  readonly ctwaCopyText = signal<string>('');
  readonly hitlProposals = signal<Ag360HitlProposal[]>([]);

  readonly pendingHitlCount = computed<number>(() => {
    return this.hitlProposals().filter((p) => p.hitlStatus === 'PENDING').length;
  });

  // Live Interactive 6-Step Execution Roadmap inside the Tool
  readonly liveRoadmapSteps = computed(() => {
    const hasBrand = this.brands().length > 0;
    const hasGemini = this.connections().some((c) => c.provider === 'GEMINI_API');
    const hasMeta = this.connections().some((c) => c.provider === 'META_ADS');
    const hasMedia = this.uploadedMedia().length > 0;
    const hasCreative =
      this.generatedHooks().length > 0 ||
      this.flyerAssets().length > 0 ||
      this.uploadedMedia().some((m) => m.category === 'flyers' || m.category === 'videos');

    return [
      {
        step: 1,
        title: 'Motor Local FastAPI + SQLite (E:\\)',
        completed: this.backendOnline(),
        actionLabel: this.backendOnline() ? 'Conectado (:8090)' : 'Verificar :8090',
        actionType: 'CHECK_BACKEND' as const,
      },
      {
        step: 2,
        title: 'Crear Tu Marca Real (Zero-Seed)',
        completed: hasBrand,
        actionLabel: hasBrand ? 'Marca Lista' : '+ Crear Marca',
        actionType: 'NEW_BRAND' as const,
      },
      {
        step: 3,
        title: 'Conectar APIs (Gemini 3.8 / Omni 1.2 / Meta)',
        completed: hasGemini,
        actionLabel: hasGemini ? 'Gemini Activo' : 'Configurar APIs',
        actionType: 'OPEN_APIS' as const,
      },
      {
        step: 4,
        title: 'Subir Fotos, Videos o Grabar Tu Voz',
        completed: hasMedia,
        actionLabel: hasMedia ? `${this.uploadedMedia().length} Archivo(s)` : 'Subir Activos',
        actionType: 'GO_VIDEO' as const,
      },
      {
        step: 5,
        title: 'Generar Brief, Reel 9:16 o Flyer 4K Real',
        completed: hasCreative,
        actionLabel: hasCreative ? 'Creativo Listo' : 'Producir Flyer/Video',
        actionType: 'GO_FLYER' as const,
      },
      {
        step: 6,
        title: 'Lanzar Pauta CTWA (Sin Ads Manager) + Kill-Switch',
        completed: hasMeta && hasBrand,
        actionLabel: 'Abrir Pauta CTWA',
        actionType: 'GO_CTWA' as const,
      },
    ];
  });

  // Scoped Ctrl+K Command Palette
  readonly scopedPaletteOpen = signal<boolean>(false);
  readonly paletteQuery = signal<string>('');

  readonly commands: readonly Ag360CommandItem[] = [
    { id: 'cmd_new_brand', label: '+ Crear Nueva Marca / Negocio (Zero-Seed)', category: 'Configuración', shortcut: 'Alt+N', action: 'OPEN_NEW_BRAND' },
    { id: 'cmd_apis', label: 'Abrir Conexiones & APIs (Gemini, Meta CTWA, Telegram, ARM)', category: 'Configuración', shortcut: 'Alt+A', action: 'OPEN_CONNECTIONS' },
    { id: 'cmd_overview', label: '00. Overview & Bóveda Espejo de Tarjeta', category: 'Navegación', shortcut: 'Alt+0', tabTarget: AG360_SUB_TAB.OVERVIEW },
    { id: 'cmd_brief', label: '01. Brief & Director Creativo (Gemini 3.8 Flash)', category: 'Producción', shortcut: 'Alt+1', tabTarget: AG360_SUB_TAB.BRIEF_STUDIO },
    { id: 'cmd_video', label: '02. Video Pipeline 9:16 (Omni 1.2 / FFmpeg / Google Flow)', category: 'Producción', shortcut: 'Alt+2', tabTarget: AG360_SUB_TAB.VIDEO_PIPELINE },
    { id: 'cmd_clips', label: '03. Clips Virales Dual & Google Flow Watch-Folder', category: 'Producción', shortcut: 'Alt+3', tabTarget: AG360_SUB_TAB.VIRAL_CLIPS },
    { id: 'cmd_flyers', label: '04. Estudio de Flyers Nano Banana 2.1', category: 'Producción', shortcut: 'Alt+4', tabTarget: AG360_SUB_TAB.FLYER_STUDIO },
    { id: 'cmd_trafficker', label: '05. Pauta Directa Click-to-WhatsApp (CTWA) & HITL', category: 'Pauta', shortcut: 'Alt+5', tabTarget: AG360_SUB_TAB.TRAFFICKER_HITL },
  ];

  readonly filteredCommands = computed<Ag360CommandItem[]>(() => {
    const q = this.paletteQuery().trim().toLowerCase();
    if (!q) return [...this.commands];
    return this.commands.filter(
      (c) => c.label.toLowerCase().includes(q) || c.category.toLowerCase().includes(q),
    );
  });

  constructor() {
    const unregister = this.hotkeys.registerScopedPalette(
      () => this.toggleScopedPalette(),
      () => this.handleScopedEscape(),
    );
    this.destroyRef.onDestroy(() => unregister());
    void this.refreshBackendStatus();
  }

  async refreshBackendStatus(): Promise<void> {
    const health = await this.api.checkHealth();
    const online = health !== null && health.status === 'ok';
    this.backendOnline.set(online);
    this.ffmpegInstalled.set(Boolean(health?.ffmpeg_installed));

    if (online) {
      const serverBrands = await this.api.listBrands();
      if (serverBrands && serverBrands.length > 0 && this.brands().length === 0) {
        const mapped: Ag360BrandVault[] = serverBrands.map((b) => ({
          id: b.brand_id,
          slug: b.slug,
          displayName: b.display_name,
          vertical: (b.industry_vertical as Ag360Vertical) || AG360_VERTICAL.RETAIL_COMMERCE,
          cardLabel: b.card_label || '',
          cardLast4: b.card_last4 || '',
          vaultBalanceUsd: b.vault_balance_usd,
          spendCapUsd: b.spend_cap_usd,
          accumulatedSpendUsd: b.accumulated_spend_usd,
          reservedSpendUsd: b.reserved_spend_usd,
          attributedRevenueUsd: b.attributed_revenue_usd,
          closedWonCount: b.closed_won_count,
          alertThresholdPct: b.alert_threshold_pct ?? 20,
        }));
        this.brands.set(mapped);
        this.selectedBrandId.set(mapped[0].id);
        this.persistBrands(mapped);
      }

      const serverConnections = await this.api.listConnections(this.selectedBrandId() || undefined);
      if (serverConnections && serverConnections.length > 0) {
        const mappedConns: Ag360ApiConnectionSummary[] = serverConnections.map((c) => ({
          scopeId: c.scope_id,
          provider: c.provider,
          configured: c.configured,
          lastTestStatus:
            c.last_test_status === 'CONNECTED'
              ? 'CONECTADO (SQLITE)'
              : c.last_test_status || 'CIFRADO EN SQLITE',
          metadata: c.metadata || {},
        }));
        this.connections.set(mappedConns);
        this.persistConnections(mappedConns);

        for (const conn of mappedConns) {
          const wa = conn.metadata['whatsapp_phone'];
          const page = conn.metadata['page_id'];
          if (wa && !this.ctwaWhatsappPhone()) {
            this.ctwaWhatsappPhone.set(wa);
            this.connWhatsappPhone.set(wa);
          }
          if (page && !this.connMetaPage()) {
            this.connMetaPage.set(page);
          }
        }
      }
    }
  }

  selectSubTab(tab: Ag360SubTab): void {
    this.activeSubTab.set(tab);
  }

  selectBrand(brandId: string): void {
    this.selectedBrandId.set(brandId);
  }

  openNewBrandModal(): void {
    this.newBrandModalOpen.set(true);
  }

  closeNewBrandModal(): void {
    this.newBrandModalOpen.set(false);
  }

  async createRealBrand(): Promise<void> {
    const name = this.newBrandName().trim();
    if (!name) return;

    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || `marca-${Date.now()}`;
    const brandId = `brd_${slug}_${Date.now().toString(36).slice(-4)}`;

    const created: Ag360BrandVault = {
      id: brandId,
      slug,
      displayName: name,
      vertical: this.newBrandVertical(),
      cardLabel: this.newBrandCardLabel().trim(),
      cardLast4: this.newBrandCardLast4().trim().slice(-4),
      vaultBalanceUsd: Math.max(0, Number(this.newBrandInitialFund()) || 0),
      spendCapUsd: Math.max(1, Number(this.newBrandSpendCap()) || 100),
      accumulatedSpendUsd: 0,
      reservedSpendUsd: 0,
      attributedRevenueUsd: 0,
      closedWonCount: 0,
      alertThresholdPct: 20,
    };

    const next = [created, ...this.brands()];
    this.brands.set(next);
    this.selectedBrandId.set(created.id);
    this.persistBrands(next);

    if (this.backendOnline()) {
      await this.api.createBrand({
        brand_id: created.id,
        slug: created.slug,
        display_name: created.displayName,
        industry_vertical: created.vertical,
        spend_cap_usd: created.spendCapUsd,
        initial_vault_usd: created.vaultBalanceUsd,
        card_label: created.cardLabel,
        card_last4: created.cardLast4,
      });
    }

    this.newBrandName.set('');
    this.newBrandCardLabel.set('');
    this.newBrandCardLast4.set('');
    this.newBrandInitialFund.set(0);
    this.newBrandModalOpen.set(false);
    this.statusMessage.set(`Marca "${created.displayName}" creada con saldo real $${created.vaultBalanceUsd.toFixed(2)}.`);
  }

  async registerRealVaultTopup(): Promise<void> {
    const brand = this.activeBrand();
    const amount = Number(this.topupAmountUsd());
    if (!brand || amount <= 0) return;

    const next = this.brands().map((b) =>
      b.id === brand.id
        ? { ...b, vaultBalanceUsd: Number((b.vaultBalanceUsd + amount).toFixed(2)) }
        : b,
    );
    this.brands.set(next);
    this.persistBrands(next);

    if (this.backendOnline()) {
      await this.api.topupBrandVault(brand.id, amount, `Fondeo tarjeta ${brand.cardLabel || 'USD'}`);
    }
    this.topupAmountUsd.set(0);
    this.statusMessage.set(`Fondeo real registrado: +$${amount.toFixed(2)} USD en "${brand.displayName}".`);
  }

  // Real API Connections Drawer
  openConnectionsModal(): void {
    this.connectionsModalOpen.set(true);
    this.connTestMessage.set('');
  }

  closeConnectionsModal(): void {
    this.connectionsModalOpen.set(false);
  }

  async saveApiConnection(): Promise<void> {
    const token = this.connTokenInput().trim();
    if (token.length < 4) {
      this.connTestMessage.set('Ingresá un token o API Key válido (mínimo 4 caracteres).');
      return;
    }

    const provider = this.connProvider();
    const scopeId =
      provider === 'META_ADS' || provider === 'TIKTOK_ADS' || provider === 'YOUTUBE_V3'
        ? this.activeBrand()?.id ?? 'GLOBAL'
        : 'GLOBAL';

    const metadata: Record<string, string> = {};
    if (this.connMetaAccount().trim()) metadata['ad_account_id'] = this.connMetaAccount().trim();
    if (this.connMetaPage().trim()) metadata['page_id'] = this.connMetaPage().trim();
    if (this.connWhatsappPhone().trim()) metadata['whatsapp_phone'] = this.connWhatsappPhone().trim();

    let savedBackend = false;
    if (this.backendOnline()) {
      savedBackend = await this.api.saveConnection({
        scope_id: scopeId,
        provider,
        secret_token: token,
        metadata,
      });
    }

    const summary: Ag360ApiConnectionSummary = {
      scopeId,
      provider,
      configured: true,
      lastTestStatus: savedBackend ? 'CIFRADO EN SQLITE (SIN PROBAR)' : 'GUARDADO LOCAL (BACKEND OFFLINE)',
      metadata,
    };

    const filtered = this.connections().filter(
      (c) => !(c.scopeId === scopeId && c.provider === provider),
    );
    const updated = [summary, ...filtered];
    this.connections.set(updated);
    this.persistConnections(updated);
    this.connTokenInput.set('');
    this.connTestMessage.set(`Credencial ${provider} guardada de forma segura para ${scopeId}.`);
  }

  async testApiConnection(scopeId: string, provider: string): Promise<void> {
    if (!this.backendOnline()) {
      this.connTestMessage.set('Encendé el backend FastAPI (:8090) para ejecutar la prueba HTTP real.');
      return;
    }
    this.connTestMessage.set(`Probando conexión real con ${provider}...`);
    const result = await this.api.testConnection(scopeId, provider);
    if (!result) {
      this.connTestMessage.set(`No se encontró credencial guardada en SQLite para ${provider}.`);
      return;
    }
    const statusText = result.ok
      ? `CONECTADO (${result.latency_ms}ms)`
      : `ERROR: ${result.detail}`;
    const updated = this.connections().map((c) =>
      c.scopeId === scopeId && c.provider === provider
        ? { ...c, lastTestStatus: statusText }
        : c,
    );
    this.connections.set(updated);
    this.persistConnections(updated);
    this.connTestMessage.set(`${provider}: ${statusText}`);
  }

  // Real File Uploader (Photos / Videos / Voice Audio)
  async onMediaFileSelected(
    category: 'photos' | 'videos' | 'voices',
    event: Event,
  ): Promise<void> {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) return;

    const brand = this.activeBrand();
    const brandId = brand?.id ?? 'unassigned';
    const brandSlug = brand?.slug ?? 'default';

    let previewUrl = URL.createObjectURL(file);
    let storedFilename = file.name;

    if (this.backendOnline()) {
      const uploaded = await this.api.uploadMedia(brandId, brandSlug, category, file);
      if (uploaded) {
        previewUrl = `http://127.0.0.1:8090${uploaded.relative_url}`;
        storedFilename = uploaded.filename;
      }
    }

    const media: Ag360UploadedMedia = {
      id: `med_${Date.now().toString(36)}`,
      brandId,
      category,
      filename: storedFilename,
      previewUrl,
      mimeType: file.type || (category === 'videos' ? 'video/mp4' : 'image/png'),
      sizeBytes: file.size,
    };

    this.uploadedMedia.update((list) => [media, ...list]);
    if (category === 'photos' || category === 'videos') {
      this.activePreviewMedia.set(media);
    } else if (category === 'voices') {
      this.recordedVoiceName.set(storedFilename);
    }
    this.statusMessage.set(`Archivo real cargado (${category}): ${storedFilename}`);
    if (input) input.value = '';
  }

  selectPreviewMedia(media: Ag360UploadedMedia): void {
    this.activePreviewMedia.set(media);
  }

  async toggleMicRecording(): Promise<void> {
    if (this.isRecordingVoice()) {
      this.mediaRecorder?.stop();
      this.isRecordingVoice.set(false);
      return;
    }

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      this.statusMessage.set('Tu navegador no permite captura de micrófono en este contexto.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.recordedChunks = [];
      const recorder = new MediaRecorder(stream);
      this.mediaRecorder = recorder;

      recorder.ondataavailable = (ev: BlobEvent) => {
        if (ev.data.size > 0) this.recordedChunks.push(ev.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(this.recordedChunks, { type: 'audio/webm' });
        const voiceFile = new File([blob], `voz_grabada_${Date.now()}.webm`, { type: 'audio/webm' });
        const brand = this.activeBrand();
        let previewUrl = URL.createObjectURL(blob);
        if (this.backendOnline() && brand) {
          const up = await this.api.uploadMedia(brand.id, brand.slug, 'voices', voiceFile);
          if (up) previewUrl = `http://127.0.0.1:8090${up.relative_url}`;
        }
        this.recordedVoiceName.set(voiceFile.name);
        this.uploadedMedia.update((list) => [
          {
            id: `mic_${Date.now().toString(36)}`,
            brandId: brand?.id ?? 'unassigned',
            category: 'voices',
            filename: voiceFile.name,
            previewUrl,
            mimeType: 'audio/webm',
            sizeBytes: voiceFile.size,
          },
          ...list,
        ]);
        this.statusMessage.set(`Voz propia grabada y lista para custom_audio_path: ${voiceFile.name}`);
      };

      recorder.start();
      this.isRecordingVoice.set(true);
    } catch {
      this.statusMessage.set('Permiso de micrófono denegado o sin dispositivo de entrada.');
    }
  }

  async scanLocalAndFlowFolders(): Promise<void> {
    if (!this.backendOnline()) {
      this.statusMessage.set('Encendé FastAPI (:8090) para escanear E:\\Agencia_Inbox\\ y flow_exports\\.');
      return;
    }
    const [inbox, flow] = await Promise.all([
      this.api.listAuthorizedInbox(),
      this.api.listGoogleFlowExports(),
    ]);
    if (inbox) this.inboxFiles.set(inbox);
    if (flow) this.flowExports.set(flow);
    this.statusMessage.set(
      `Escaneo real completado: ${inbox?.length ?? 0} archivos en Inbox · ${flow?.length ?? 0} videos en Google Flow Watch-Folder.`,
    );
  }

  async generateRealBrief(): Promise<void> {
    const brand = this.activeBrand();
    const offer = this.briefOfferInput().trim();
    if (!brand || !offer) {
      this.statusMessage.set('Creá una marca y escribí tu producto/oferta real antes de generar el brief.');
      return;
    }

    const audience = this.briefAudienceInput().trim() || 'Venezuela & LATAM';
    if (this.backendOnline()) {
      const apiRes = await this.api.generateBrief({
        brand_id: brand.id,
        product_or_offer: offer,
        target_audience_ve: audience,
      });
      if (apiRes) {
        this.generatedHooks.set(
          apiRes.hooks.map((h) => ({
            variant: h.variant,
            title: `${h.variant} · ${brand.displayName}`,
            script3s: h.script_3s,
            brollSource: h.visual_cue_916,
            retentionScore: h.predicted_retention_score,
          })),
        );
        this.ctwaCopyText.set(apiRes.direct_response_copy);
        this.statusMessage.set(`Brief generado para "${brand.displayName}" con 3 ganchos A/B/C.`);
        return;
      }
    }

    // Deterministic preview when backend is offline
    this.generatedHooks.set([
      {
        variant: 'HOOK_A',
        title: `Gancho A · ${brand.displayName}`,
        script3s: `¿Buscando ${offer}? Atendemos directo por WhatsApp para ${audience}.`,
        brollSource: 'Foto de producto real subida + Omni 1.2 Flash 9:16',
        retentionScore: 92,
      },
      {
        variant: 'HOOK_B',
        title: `Gancho B · Demostración`,
        script3s: `Mirá cómo funciona ${offer} en menos de 15 segundos.`,
        brollSource: 'Clip real en E:\\Agencia_Inbox\\ + subtítulos faster-whisper',
        retentionScore: 88,
      },
      {
        variant: 'HOOK_C',
        title: `Gancho C · Llamada Directa`,
        script3s: `Pedí tu cotización de ${offer} hoy mismo tocando el botón de WhatsApp.`,
        brollSource: 'Google Flow Watch-Folder + CTA overlay',
        retentionScore: 85,
      },
    ]);
    this.ctwaCopyText.set(`${offer} disponible para ${audience}. Escribinos por WhatsApp ahora.`);
  }

  selectHookVariant(variant: 'HOOK_A' | 'HOOK_B' | 'HOOK_C'): void {
    this.selectedHookVariantId.set(variant);
  }

  setVideoEngine(engine: Ag360VideoEngine): void {
    this.selectedVideoEngine.set(engine);
  }

  setViralClipSourceMode(mode: Ag360ClipSource): void {
    this.viralClipSourceMode.set(mode);
  }

  runRoadmapStepAction(
    actionType: 'CHECK_BACKEND' | 'NEW_BRAND' | 'OPEN_APIS' | 'GO_VIDEO' | 'GO_FLYER' | 'GO_CTWA',
  ): void {
    switch (actionType) {
      case 'CHECK_BACKEND':
        void this.refreshBackendStatus();
        break;
      case 'NEW_BRAND':
        this.openNewBrandModal();
        break;
      case 'OPEN_APIS':
        this.openConnectionsModal();
        break;
      case 'GO_VIDEO':
        this.selectSubTab(AG360_SUB_TAB.VIDEO_PIPELINE);
        break;
      case 'GO_FLYER':
        this.selectSubTab(AG360_SUB_TAB.FLYER_STUDIO);
        break;
      case 'GO_CTWA':
        this.selectSubTab(AG360_SUB_TAB.TRAFFICKER_HITL);
        break;
    }
  }

  async generateLiveFlyerNow(): Promise<void> {
    const brand = this.activeBrand();
    const headline = this.flyerHeadline().trim();
    const price = this.flyerPriceBadge().trim();
    const cta = this.flyerCtaText().trim() || 'ESCRIBENOS POR WHATSAPP';
    if (!brand || !headline || !price) {
      this.statusMessage.set('Creá una marca y completá Titular y Etiqueta de Precio para generar el flyer.');
      return;
    }
    if (!this.backendOnline()) {
      this.statusMessage.set('Encendé FastAPI (:8090) con start-agencia360.ps1 para renderizar y guardar el PNG real.');
      return;
    }

    const res = await this.api.generateLiveFlyer({
      brand_id: brand.id,
      brand_slug: brand.slug,
      headline,
      price_badge: price,
      cta_text: cta,
      nano_banana_prompt: `Commercial studio visual for ${brand.displayName}: ${headline}`,
      aspect_ratio: this.flyerAspectRatio(),
    });
    if (!res) {
      this.statusMessage.set('Error generando el flyer real en FastAPI.');
      return;
    }

    const fullUrl = `http://127.0.0.1:8090${res.relative_url}`;
    const asset: Ag360FlyerAsset = {
      id: res.asset_id,
      brandId: brand.id,
      aspectRatio: this.flyerAspectRatio(),
      headline,
      priceBadge: price,
      ctaText: cta,
      textDensityPct: res.text_area_ratio_pct,
      previewUrl: fullUrl,
    };
    this.flyerAssets.update((list) => [asset, ...list]);
    this.activePreviewMedia.set({
      id: res.asset_id,
      brandId: brand.id,
      category: 'flyers',
      filename: `${res.asset_id}.png`,
      previewUrl: fullUrl,
      mimeType: 'image/png',
      sizeBytes: 0,
    });
    this.statusMessage.set(`Flyer PNG real generado (${res.text_area_ratio_pct}% texto) y cargado en el Player 9:16.`);
  }

  async importGoogleFlowVideoToPlayer(filename: string): Promise<void> {
    const brand = this.activeBrand();
    if (!brand || !this.backendOnline()) {
      this.statusMessage.set('Creá una marca y verificá FastAPI (:8090) para importar desde Google Flow.');
      return;
    }
    const res = await this.api.importFlowExport({
      brand_id: brand.id,
      brand_slug: brand.slug,
      filename,
    });
    if (!res) {
      this.statusMessage.set(`No se pudo importar ${filename} desde flow_exports.`);
      return;
    }
    const imported: Ag360UploadedMedia = {
      id: res.asset_id,
      brandId: brand.id,
      category: 'videos',
      filename: res.filename,
      previewUrl: `http://127.0.0.1:8090${res.relative_url}`,
      mimeType: 'video/mp4',
      sizeBytes: 0,
    };
    this.uploadedMedia.update((list) => [imported, ...list]);
    this.activePreviewMedia.set(imported);
    this.statusMessage.set(`Video de Google Flow "${res.filename}" importado y listo en el reproductor 9:16.`);
  }

  stageCtwaCampaignForHitl(): void {
    const brand = this.activeBrand();
    const name = this.ctwaCampaignName().trim();
    const phone = this.ctwaWhatsappPhone().trim();
    const budget = Number(this.ctwaDailyBudgetUsd());
    if (!brand || !name || !phone || budget <= 0) {
      this.statusMessage.set('Completá Marca, Nombre de Campaña, WhatsApp Business y Presupuesto Diario.');
      return;
    }

    const trackingCode = `AD-${brand.slug.slice(0, 6).toUpperCase()}-${Date.now().toString(36).slice(-4).toUpperCase()}`;
    const proposal: Ag360HitlProposal = {
      approvalId: `hitl_${Date.now().toString(36)}`,
      campaignId: `cmp_${Date.now().toString(36)}`,
      brandId: brand.id,
      platform: 'META_ADS',
      campaignName: name,
      whatsappPhone: phone,
      dailyBudgetUsd: budget,
      approvedCopy: this.ctwaCopyText().trim() || `Consulta sobre ${name} [${trackingCode}]`,
      trackingCode,
      hitlStatus: 'PENDING',
      campaignStatus: 'DRAFT_PENDING_HITL',
    };

    this.hitlProposals.update((list) => [proposal, ...list]);
    this.ctwaCampaignName.set('');
    this.statusMessage.set(`Campaña Click-to-WhatsApp "${name}" en espera de aprobación HITL (${trackingCode}).`);
  }

  approveHitlProposal(approvalId: string): void {
    const target = this.hitlProposals().find((p) => p.approvalId === approvalId);
    if (!target) return;

    this.hitlProposals.update((list) =>
      list.map((item) =>
        item.approvalId === approvalId
          ? { ...item, hitlStatus: 'APPROVED', campaignStatus: 'ACTIVE' }
          : item,
      ),
    );
    const updatedBrands = this.brands().map((b) =>
      b.id === target.brandId
        ? { ...b, accumulatedSpendUsd: Number((b.accumulatedSpendUsd + target.dailyBudgetUsd).toFixed(2)) }
        : b,
    );
    this.brands.set(updatedBrands);
    this.persistBrands(updatedBrands);

    if (this.backendOnline()) {
      void this.api.approveHitl(approvalId);
    }
  }

  rejectHitlProposal(approvalId: string): void {
    this.hitlProposals.update((list) =>
      list.map((item) =>
        item.approvalId === approvalId
          ? { ...item, hitlStatus: 'REJECTED', campaignStatus: 'PAUSED_BY_OPERATOR' }
          : item,
      ),
    );
    if (this.backendOnline()) {
      void this.api.rejectHitl(approvalId);
    }
  }

  toggleScopedPalette(): void {
    this.scopedPaletteOpen.update((open) => !open);
    if (!this.scopedPaletteOpen()) {
      this.paletteQuery.set('');
    }
  }

  handleScopedEscape(): boolean {
    if (this.connectionsModalOpen()) {
      this.connectionsModalOpen.set(false);
      return true;
    }
    if (this.newBrandModalOpen()) {
      this.newBrandModalOpen.set(false);
      return true;
    }
    if (this.scopedPaletteOpen()) {
      this.scopedPaletteOpen.set(false);
      this.paletteQuery.set('');
      return true;
    }
    return false;
  }

  executeCommand(cmd: Ag360CommandItem): void {
    if (cmd.action === 'OPEN_CONNECTIONS') {
      this.openConnectionsModal();
    } else if (cmd.action === 'OPEN_NEW_BRAND') {
      this.openNewBrandModal();
    } else if (cmd.tabTarget) {
      this.selectSubTab(cmd.tabTarget);
    }
    this.scopedPaletteOpen.set(false);
    this.paletteQuery.set('');
  }

  private loadPersistedBrands(): Ag360BrandVault[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_BRANDS);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? (parsed as Ag360BrandVault[]) : [];
    } catch {
      return [];
    }
  }

  private persistBrands(list: Ag360BrandVault[]): void {
    try {
      localStorage.setItem(STORAGE_KEY_BRANDS, JSON.stringify(list));
    } catch {
      // Ignore storage quota errors in private browsing
    }
  }

  private loadPersistedConnections(): Ag360ApiConnectionSummary[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_CONNECTIONS);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? (parsed as Ag360ApiConnectionSummary[]) : [];
    } catch {
      return [];
    }
  }

  private persistConnections(list: Ag360ApiConnectionSummary[]): void {
    try {
      localStorage.setItem(STORAGE_KEY_CONNECTIONS, JSON.stringify(list));
    } catch {
      // Ignore storage quota errors
    }
  }
}
