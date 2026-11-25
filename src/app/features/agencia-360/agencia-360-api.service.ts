import { Injectable } from '@angular/core';

export interface Ag360ApiHealthResponse {
  status: string;
  version: string;
  timezone: string;
  video_worker_concurrency: number;
  arm_decoupled: boolean;
  ffmpeg_installed: boolean;
  local_inbox_dir: string;
  persistence_mode: string;
  genai_models_2026: Record<string, string>;
}

export interface Ag360InboxFileEntry {
  filename: string;
  size_mb: number;
  extension: string;
}

export interface Ag360FlowExportEntry {
  filename: string;
  local_path: string;
  size_mb: number;
  source: string;
}

export interface Ag360PersistedBrandDto {
  brand_id: string;
  slug: string;
  display_name: string;
  industry_vertical: string;
  card_label: string;
  card_last4: string;
  vault_balance_usd: number;
  spend_cap_usd: number;
  accumulated_spend_usd: number;
  reserved_spend_usd: number;
  attributed_revenue_usd: number;
  closed_won_count: number;
  alert_threshold_pct?: number;
}

export interface Ag360ConnectionTestResult {
  ok: boolean;
  provider: string;
  status_code: number;
  latency_ms: number;
  detail: string;
}

export interface Ag360PersistedConnectionDto {
  scope_id: string;
  provider: string;
  configured: boolean;
  metadata: Record<string, string>;
  last_test_status: string;
  last_tested_at?: string | null;
  updated_at_vet?: string;
}

export interface Ag360PersistedMediaAssetDto {
  asset_id: string;
  brand_id: string;
  brand_slug: string;
  category: 'photos' | 'videos' | 'voices' | 'flyers' | 'renders';
  filename: string;
  relative_url: string;
  size_bytes: number;
}

export interface Ag360GeneratedHookDto {
  variant: 'HOOK_A' | 'HOOK_B' | 'HOOK_C';
  script_3s: string;
  visual_cue_916: string;
  predicted_retention_score: number;
}

export interface Ag360GeneratedBriefResponse {
  brief_id: string;
  brand_id: string;
  direct_response_copy: string;
  nano_banana_flyer_prompt: string;
  hooks: Ag360GeneratedHookDto[];
}

export interface Ag360CardKillswitchResponse {
  card_funded_usd: number;
  meta_amount_spent_usd: number;
  remaining_usd: number;
  consumed_pct: number;
  action: 'SAFE' | 'ALERT_RECHARGE_CARD' | 'AUTO_PAUSE_KILLSWITCH' | 'UNFUNDED_PAUSED';
  should_alert_telegram: boolean;
  should_pause_active_adsets: boolean;
}

@Injectable({ providedIn: 'root' })
export class Agencia360ApiService {
  readonly baseUrl = 'http://127.0.0.1:8090/api/v1';

  async checkHealth(): Promise<Ag360ApiHealthResponse | null> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, { method: 'GET' });
      if (!res.ok) return null;
      return (await res.json()) as Ag360ApiHealthResponse;
    } catch {
      return null;
    }
  }

  async listBrands(): Promise<Ag360PersistedBrandDto[] | null> {
    try {
      const res = await fetch(`${this.baseUrl}/treasury/brands`, { method: 'GET' });
      if (!res.ok) return null;
      const body = (await res.json()) as { brands: Ag360PersistedBrandDto[] };
      return body.brands;
    } catch {
      return null;
    }
  }

  async createBrand(payload: {
    brand_id: string;
    slug: string;
    display_name: string;
    industry_vertical: string;
    spend_cap_usd: number;
    initial_vault_usd: number;
    card_label: string;
    card_last4: string;
  }): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/treasury/brands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async topupBrandVault(brandId: string, amountUsd: number, note: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/treasury/topup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand_id: brandId, amount_usd: amountUsd, note }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async listConnections(scopeId?: string): Promise<Ag360PersistedConnectionDto[] | null> {
    try {
      const qs = scopeId ? `?scope_id=${encodeURIComponent(scopeId)}` : '';
      const res = await fetch(`${this.baseUrl}/connections${qs}`, { method: 'GET' });
      if (!res.ok) return null;
      const body = (await res.json()) as { connections: Ag360PersistedConnectionDto[] };
      return body.connections;
    } catch {
      return null;
    }
  }

  async saveConnection(payload: {
    scope_id: string;
    provider: string;
    secret_token: string;
    metadata: Record<string, string>;
  }): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/connections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async testConnection(scopeId: string, provider: string): Promise<Ag360ConnectionTestResult | null> {
    try {
      const res = await fetch(`${this.baseUrl}/connections/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope_id: scopeId, provider }),
      });
      if (!res.ok) return null;
      return (await res.json()) as Ag360ConnectionTestResult;
    } catch {
      return null;
    }
  }

  async uploadMedia(
    brandId: string,
    brandSlug: string,
    category: 'photos' | 'videos' | 'voices',
    file: File,
  ): Promise<{ asset_id: string; relative_url: string; filename: string } | null> {
    try {
      const form = new FormData();
      form.append('brand_id', brandId);
      form.append('brand_slug', brandSlug);
      form.append('category', category);
      form.append('file', file);
      const res = await fetch(`${this.baseUrl}/media/upload`, {
        method: 'POST',
        body: form,
      });
      if (!res.ok) return null;
      return (await res.json()) as { asset_id: string; relative_url: string; filename: string };
    } catch {
      return null;
    }
  }

  async listAuthorizedInbox(): Promise<Ag360InboxFileEntry[] | null> {
    try {
      const res = await fetch(`${this.baseUrl}/sandbox/list-inbox`, { method: 'GET' });
      if (!res.ok) return null;
      const body = (await res.json()) as { files: Ag360InboxFileEntry[] };
      return body.files;
    } catch {
      return null;
    }
  }

  async listGoogleFlowExports(): Promise<Ag360FlowExportEntry[] | null> {
    try {
      const res = await fetch(`${this.baseUrl}/media/flow-exports`, { method: 'GET' });
      if (!res.ok) return null;
      const body = (await res.json()) as { exports: Ag360FlowExportEntry[] };
      return body.exports;
    } catch {
      return null;
    }
  }

  async generateBrief(payload: {
    brand_id: string;
    product_or_offer: string;
    target_audience_ve: string;
  }): Promise<Ag360GeneratedBriefResponse | null> {
    try {
      const res = await fetch(`${this.baseUrl}/agents/briefs/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) return null;
      return (await res.json()) as Ag360GeneratedBriefResponse;
    } catch {
      return null;
    }
  }

  async evaluateCardKillswitch(
    cardFundedUsd: number,
    metaAmountSpentUsd: number,
  ): Promise<Ag360CardKillswitchResponse | null> {
    try {
      const res = await fetch(`${this.baseUrl}/billing/card-killswitch/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          card_funded_usd: cardFundedUsd,
          meta_amount_spent_usd: metaAmountSpentUsd,
        }),
      });
      if (!res.ok) return null;
      return (await res.json()) as Ag360CardKillswitchResponse;
    } catch {
      return null;
    }
  }

  async approveHitl(approvalId: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/hitl/${encodeURIComponent(approvalId)}/approve`, {
        method: 'POST',
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async rejectHitl(approvalId: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/hitl/${encodeURIComponent(approvalId)}/reject`, {
        method: 'POST',
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async generateLiveFlyer(payload: {
    brand_id: string;
    brand_slug: string;
    headline: string;
    price_badge: string;
    cta_text: string;
    nano_banana_prompt: string;
    aspect_ratio: '9:16' | '4:5';
  }): Promise<{ asset_id: string; relative_url: string; text_area_ratio_pct: number } | null> {
    try {
      const res = await fetch(`${this.baseUrl}/flyers/generate-live`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) return null;
      return (await res.json()) as {
        asset_id: string;
        relative_url: string;
        text_area_ratio_pct: number;
      };
    } catch {
      return null;
    }
  }

  async importFlowExport(payload: {
    brand_id: string;
    brand_slug: string;
    filename: string;
  }): Promise<{ asset_id: string; relative_url: string; filename: string } | null> {
    try {
      const res = await fetch(`${this.baseUrl}/video/import-flow-export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) return null;
      return (await res.json()) as { asset_id: string; relative_url: string; filename: string };
    } catch {
      return null;
    }
  }

  async listMediaAssets(brandId: string): Promise<Ag360PersistedMediaAssetDto[] | null> {
    try {
      const res = await fetch(`${this.baseUrl}/media/list/${encodeURIComponent(brandId)}`, {
        method: 'GET',
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { assets: Ag360PersistedMediaAssetDto[] };
      return body.assets;
    } catch {
      return null;
    }
  }

  async renderLocalReel(payload: {
    brand_id: string;
    brand_slug: string;
    voice_script: string;
    duration_sec?: number;
  }): Promise<{ asset_id: string; relative_url: string; filename: string; engine: string } | null> {
    try {
      const res = await fetch(`${this.baseUrl}/video/render-local-reel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) return null;
      return (await res.json()) as {
        asset_id: string;
        relative_url: string;
        filename: string;
        engine: string;
      };
    } catch {
      return null;
    }
  }
}
