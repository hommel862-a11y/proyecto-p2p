import { Injectable } from '@angular/core';

export interface Ag360ApiHealthResponse {
  status: string;
  timezone: string;
  video_worker_concurrency: number;
  arm_decoupled: boolean;
  local_inbox_dir: string;
}

export interface Ag360InboxFileEntry {
  filename: string;
  size_mb: number;
  extension: string;
}

export interface Ag360InboxListResponse {
  authorized_inbox_dir: string;
  mode: string;
  files: Ag360InboxFileEntry[];
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

export interface Ag360GeneratedFlyerResponse {
  flyer_id: string;
  aspect_ratio: '9:16' | '4:5';
  text_area_ratio_pct: number;
  public_https_url: string;
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

  async listAuthorizedInbox(): Promise<Ag360InboxListResponse | null> {
    try {
      const res = await fetch(`${this.baseUrl}/sandbox/list-inbox`, { method: 'GET' });
      if (!res.ok) return null;
      return (await res.json()) as Ag360InboxListResponse;
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

  async generateFlyer(payload: {
    brand_id: string;
    brand_slug: string;
    headline: string;
    price_badge: string;
    cta_text: string;
    nano_banana_prompt: string;
    aspect_ratio: '9:16' | '4:5';
  }): Promise<Ag360GeneratedFlyerResponse | null> {
    try {
      const res = await fetch(`${this.baseUrl}/flyers/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) return null;
      return (await res.json()) as Ag360GeneratedFlyerResponse;
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
}
