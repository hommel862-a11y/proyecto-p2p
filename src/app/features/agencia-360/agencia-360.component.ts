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
  type Ag360InboxFileEntry,
} from './agencia-360-api.service';
import {
  AG360_CLIP_SOURCE,
  AG360_SUB_TAB,
  AG360_VERTICAL,
  type Ag360BrandVault,
  type Ag360ClipSource,
  type Ag360CommandItem,
  type Ag360FlyerAsset,
  type Ag360HitlProposal,
  type Ag360HookVariant,
  type Ag360SubTab,
  type Ag360SubTabDescriptor,
  type Ag360ViralClipJob,
} from './agencia-360.models';

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

  readonly backendOnline = signal<boolean>(false);
  readonly inboxFiles = signal<Ag360InboxFileEntry[]>([]);

  readonly SUB_TAB = AG360_SUB_TAB;
  readonly CLIP_SOURCE = AG360_CLIP_SOURCE;
  readonly workerConcurrencyLimit = 1;
  readonly authorizedInboxDir = 'E:\\Agencia_Inbox\\';

  readonly subTabs: readonly Ag360SubTabDescriptor[] = [
    { id: AG360_SUB_TAB.OVERVIEW, code: '00', label: 'Overview & Bóveda', badge: 'ROAS' },
    { id: AG360_SUB_TAB.BRIEF_STUDIO, code: '01', label: 'Brief & Director IA', badge: 'VE-IA' },
    { id: AG360_SUB_TAB.VIDEO_PIPELINE, code: '02', label: 'Video Pipeline 9:16', badge: 'MPT' },
    { id: AG360_SUB_TAB.VIRAL_CLIPS, code: '03', label: 'Clips Virales Dual', badge: '9:16' },
    { id: AG360_SUB_TAB.FLYER_STUDIO, code: '04', label: 'Nano Banana Flyers', badge: '2-CAPAS' },
    { id: AG360_SUB_TAB.TRAFFICKER_HITL, code: '05', label: 'Trafficker & Telegram HITL', badge: 'HITL' },
  ];

  readonly activeSubTab = signal<Ag360SubTab>(AG360_SUB_TAB.OVERVIEW);

  readonly brands = signal<Ag360BrandVault[]>([
    {
      id: 'brd_cashea_01',
      slug: 'tienda-aliada-cashea-ve',
      displayName: 'Tienda Aliada Cashea VE',
      vertical: AG360_VERTICAL.CASHEA_ALLY,
      metaAdAccountId: 'act_44198201',
      metaPixelId: 'px_902184',
      tiktokAdvertiserId: 'tt_991204',
      youtubeChannelId: 'yt_ch_881',
      vaultBalanceUsd: 2450,
      spendCapUsd: 1000,
      accumulatedSpendUsd: 540,
      reservedSpendUsd: 60,
      attributedRevenueUsd: 2619,
      closedWonCount: 118,
      alertThresholdPct: 20,
    },
    {
      id: 'brd_p2p_02',
      slug: 'mesa-liquidez-finanzas',
      displayName: 'Mesa Liquidez & Finanzas',
      vertical: AG360_VERTICAL.FINTECH_P2P,
      metaAdAccountId: 'act_88210449',
      metaPixelId: 'px_104992',
      tiktokAdvertiserId: 'tt_331098',
      youtubeChannelId: 'yt_ch_204',
      vaultBalanceUsd: 1820,
      spendCapUsd: 600,
      accumulatedSpendUsd: 210,
      reservedSpendUsd: 0,
      attributedRevenueUsd: 980,
      closedWonCount: 42,
      alertThresholdPct: 20,
    },
    {
      id: 'brd_b2b_03',
      slug: 'importadora-mayorista-b2b',
      displayName: 'Importadora & Mayorista B2B',
      vertical: AG360_VERTICAL.B2B_SERVICES,
      metaAdAccountId: 'act_77102938',
      metaPixelId: 'px_551209',
      tiktokAdvertiserId: 'tt_610442',
      youtubeChannelId: 'yt_ch_912',
      vaultBalanceUsd: 310,
      spendCapUsd: 1500,
      accumulatedSpendUsd: 1210,
      reservedSpendUsd: 0,
      attributedRevenueUsd: 4950,
      closedWonCount: 64,
      alertThresholdPct: 20,
    },
  ]);

  readonly selectedBrandId = signal<string>('brd_cashea_01');

  readonly activeBrand = computed<Ag360BrandVault>(() => {
    const id = this.selectedBrandId();
    return this.brands().find((b) => b.id === id) ?? this.brands()[0];
  });

  readonly activeBrandRoas = computed<number>(() => {
    const b = this.activeBrand();
    if (b.accumulatedSpendUsd <= 0) return 0;
    return Number((b.attributedRevenueUsd / b.accumulatedSpendUsd).toFixed(2));
  });

  readonly remainingSpendCapRatioPct = computed<number>(() => {
    const b = this.activeBrand();
    const used = b.accumulatedSpendUsd + b.reservedSpendUsd;
    const rem = Math.max(0, b.spendCapUsd - used);
    return Number(((rem / b.spendCapUsd) * 100).toFixed(1));
  });

  readonly isLowBalanceAlert20Pct = computed<boolean>(() => {
    return this.remainingSpendCapRatioPct() <= this.activeBrand().alertThresholdPct;
  });

  readonly customAudioPatchEnabled = signal<boolean>(true);
  readonly customAudioFilename = signal<string>('locutor_caracas_brief042_hookA.wav');

  readonly hookVariants = signal<Ag360HookVariant[]>([
    {
      variant: 'HOOK_A',
      title: 'Gancho A · Dolor & Liquidez BCV',
      script3s: '¿Querés equipar tu local hoy sin descapitalizarte en dólares y pagando a tasa BCV?',
      brollSource: 'Google Flow 9:16 · Close-up Producto + Caja',
      retentionScore: 94,
    },
    {
      variant: 'HOOK_B',
      title: 'Gancho B · Prueba Social Caracas',
      script3s: 'Más de 180 comercios en Caracas ya están llevando este combo con solo 40% de inicial.',
      brollSource: 'Higgsfield 9:16 · Entrega en Tienda Física',
      retentionScore: 89,
    },
    {
      variant: 'HOOK_C',
      title: 'Gancho C · Oferta Directa Flash',
      script3s: 'Llevátelo hoy desde $18 de inicial y despacho inmediato en toda la Gran Caracas.',
      brollSource: 'Google Flow 9:16 · Unboxing Rápido',
      retentionScore: 85,
    },
  ]);

  readonly selectedHookVariantId = signal<'HOOK_A' | 'HOOK_B' | 'HOOK_C'>('HOOK_A');

  readonly selectedHook = computed<Ag360HookVariant>(() => {
    const id = this.selectedHookVariantId();
    return this.hookVariants().find((h) => h.variant === id) ?? this.hookVariants()[0];
  });

  readonly viralClipSourceMode = signal<Ag360ClipSource>(AG360_CLIP_SOURCE.PC_LOCAL_INBOX);
  readonly youtubeSurgicalUrl = signal<string>('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  readonly youtubeSurgicalRange = signal<string>('00:18:10-00:19:05');

  readonly surgicalYtDlpPreviewCommand = computed<string>(() => {
    return `yt-dlp --no-playlist --download-sections "*${this.youtubeSurgicalRange()}" --force-keyframes-at-cuts "${this.youtubeSurgicalUrl()}"`;
  });

  readonly viralClipJobs = signal<Ag360ViralClipJob[]>([
    {
      id: 'clip_loc_01',
      title: 'Podcast Comercios Caracas Ep. 14',
      sourceMode: AG360_CLIP_SOURCE.PC_LOCAL_INBOX,
      sourceLocator: 'E:\\Agencia_Inbox\\podcast_ep14.mp4',
      sectionRange: '00:04:12 - 00:05:04 (52s)',
      viralityScore: 96,
      faceConfidencePct: 98.4,
      aspectRatio: '9:16',
      status: 'COMPLETED',
    },
    {
      id: 'clip_yt_02',
      title: 'Entrevista Estrategia Cashea & BCV',
      sourceMode: AG360_CLIP_SOURCE.YOUTUBE_SURGICAL,
      sourceLocator: 'youtube.com/watch?v=ve_commerce_2026',
      sectionRange: '*00:18:10-00:19:05 (55s · 14 MB)',
      viralityScore: 92,
      faceConfidencePct: 97.1,
      aspectRatio: '9:16',
      status: 'CURATED',
    },
  ]);

  readonly flyerAssets = signal<Ag360FlyerAsset[]>([
    {
      id: 'fly_cashea_916',
      brandId: 'brd_cashea_01',
      aspectRatio: '9:16',
      headline: 'EQUIPA TU NEGOCIO HOY',
      priceBadge: 'INICIAL $48 USD + 3 CUOTAS CASHEA',
      ctaText: 'ESCRIBINOS POR WHATSAPP · TASA BCV',
      textDensityPct: 14.2,
      complianceStatus: 'APPROVED',
      publicHttpsUrl: 'https://cdn.agencia360.ve/public/brands/tienda-aliada-cashea-ve/flyers/fly_916.png',
    },
    {
      id: 'fly_cashea_45',
      brandId: 'brd_cashea_01',
      aspectRatio: '4:5',
      headline: 'CATÁLOGO MAYORISTA 2026',
      priceBadge: 'DESDE $18 INICIAL · 0% INTERÉS',
      ctaText: 'SOLICITAR COTIZACIÓN INMEDIATA',
      textDensityPct: 15.8,
      complianceStatus: 'APPROVED',
      publicHttpsUrl: 'https://cdn.agencia360.ve/public/brands/tienda-aliada-cashea-ve/flyers/fly_45.png',
    },
  ]);

  readonly hitlProposals = signal<Ag360HitlProposal[]>([
    {
      approvalId: 'hitl_ag360_01',
      campaignId: 'cmp_ve_cashea_q4',
      brandId: 'brd_cashea_01',
      platform: 'META_ADS',
      campaignName: 'Meta Reels 9:16 · Cashea Caracas Q4',
      hookVariant: 'HOOK_A',
      dailyBudgetUsd: 45,
      originalCopy: 'Equipa tu comercio hoy en cuotas sin interés a tasa BCV.',
      approvedCopy: 'Equipa tu comercio hoy en cuotas sin interés a tasa BCV.',
      complianceStatus: 'APPROVED',
      riskScorePct: 3,
      hitlStatus: 'APPROVED',
      campaignStatus: 'ACTIVE',
    },
    {
      approvalId: 'hitl_ag360_02',
      campaignId: 'cmp_tt_comercios_ve',
      brandId: 'brd_cashea_01',
      platform: 'TIKTOK_ADS',
      campaignName: 'TikTok Spark 9:16 · Clip Quirúrgico #1',
      hookVariant: 'HOOK_B',
      dailyBudgetUsd: 60,
      originalCopy: 'Cambia tus USDT sin comisiones y equipa tu tienda hoy.',
      approvedCopy: 'Optimiza la gestión de cobros y equipa tu tienda hoy con soporte en tiempo real.',
      complianceStatus: 'REWRITTEN_APPROVED',
      riskScorePct: 4,
      hitlStatus: 'PENDING',
      campaignStatus: 'DRAFT_PENDING_HITL',
    },
  ]);

  readonly pendingHitlCount = computed<number>(() => {
    return this.hitlProposals().filter((p) => p.hitlStatus === 'PENDING').length;
  });

  /* Scoped Ctrl+K Command Palette */
  readonly scopedPaletteOpen = signal<boolean>(false);
  readonly paletteQuery = signal<string>('');

  readonly commands: readonly Ag360CommandItem[] = [
    {
      id: 'cmd_overview',
      label: 'Ir a 00. Overview Ejecutivo & Bóveda de Pauta',
      category: 'Navegación',
      shortcut: 'Alt+0',
      tabTarget: AG360_SUB_TAB.OVERVIEW,
    },
    {
      id: 'cmd_brief',
      label: 'Ir a 01. Brief & Director Creativo IA (Gemini + GPT-4o)',
      category: 'Ejecución',
      shortcut: 'Alt+1',
      tabTarget: AG360_SUB_TAB.BRIEF_STUDIO,
    },
    {
      id: 'cmd_video',
      label: 'Ir a 02. Video Pipeline 9:16 (MoneyPrinterTurbo + custom_audio_path)',
      category: 'Ejecución',
      shortcut: 'Alt+2',
      tabTarget: AG360_SUB_TAB.VIDEO_PIPELINE,
    },
    {
      id: 'cmd_clips',
      label: 'Ir a 03. Extractor Quirúrgico de Clips Virales (E:\\Agencia_Inbox\\ + YouTube)',
      category: 'Ejecución',
      shortcut: 'Alt+3',
      tabTarget: AG360_SUB_TAB.VIRAL_CLIPS,
    },
    {
      id: 'cmd_flyers',
      label: 'Ir a 04. Estudio de Flyers Nano Banana (2 Capas)',
      category: 'Ejecución',
      shortcut: 'Alt+4',
      tabTarget: AG360_SUB_TAB.FLYER_STUDIO,
    },
    {
      id: 'cmd_trafficker',
      label: 'Ir a 05. Trafficker Multi-Plataforma & Centro Telegram HITL',
      category: 'Ejecución',
      shortcut: 'Alt+5',
      tabTarget: AG360_SUB_TAB.TRAFFICKER_HITL,
    },
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
    this.backendOnline.set(health !== null && health.status === 'ok');
  }

  async scanAuthorizedInbox(): Promise<void> {
    const res = await this.api.listAuthorizedInbox();
    if (res) {
      this.inboxFiles.set(res.files);
      this.backendOnline.set(true);
    }
  }

  selectSubTab(tab: Ag360SubTab): void {
    this.activeSubTab.set(tab);
  }

  selectBrand(brandId: string): void {
    this.selectedBrandId.set(brandId);
  }

  selectHookVariant(variant: 'HOOK_A' | 'HOOK_B' | 'HOOK_C'): void {
    this.selectedHookVariantId.set(variant);
  }

  setViralClipSourceMode(mode: Ag360ClipSource): void {
    this.viralClipSourceMode.set(mode);
  }

  approveHitlProposal(approvalId: string): void {
    this.hitlProposals.update((list) =>
      list.map((item) =>
        item.approvalId === approvalId
          ? { ...item, hitlStatus: 'APPROVED', campaignStatus: 'ACTIVE' }
          : item,
      ),
    );
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
    if (this.scopedPaletteOpen()) {
      this.scopedPaletteOpen.set(false);
      this.paletteQuery.set('');
      return true;
    }
    return false;
  }

  executeCommand(cmd: Ag360CommandItem): void {
    if (cmd.tabTarget) {
      this.selectSubTab(cmd.tabTarget);
    }
    this.scopedPaletteOpen.set(false);
    this.paletteQuery.set('');
  }
}
