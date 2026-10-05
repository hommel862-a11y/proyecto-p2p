import { Injectable } from '@angular/core';
import {
  Capacitor,
  CapacitorHttp,
  type HttpOptions,
  type HttpResponse,
} from '@capacitor/core';

export interface NativeHttpRequestOptions {
  headers?: Record<string, string>;
  params?: Record<string, string | string[]>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * Universal HTTP Service for P2P Mobile & Web.
 *
 * When running in native Capacitor (Android/iOS), requests are delegated to
 * {@link CapacitorHttp} which communicates via the native OS networking stack.
 * This completely bypasses Chromium WebView CORS restrictions, eliminates the need
 * for local desktop bridges, and prevents routing sensitive trade data through
 * unencrypted public CORS proxies.
 *
 * When running in standard web browsers or Electron, it cleanly falls back
 * to standard browser `fetch()`.
 */
@Injectable({ providedIn: 'root' })
export class NativeHttpService {
  /**
   * True if running on an actual mobile device runtime (Capacitor Android / iOS).
   */
  readonly isNative: boolean = Capacitor.isNativePlatform();

  async get<T>(url: string, options?: NativeHttpRequestOptions): Promise<T> {
    return this.request<T>('GET', url, undefined, options);
  }

  async post<T>(
    url: string,
    body?: unknown,
    options?: NativeHttpRequestOptions,
  ): Promise<T> {
    return this.request<T>('POST', url, body, options);
  }

  async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
    url: string,
    body?: unknown,
    options?: NativeHttpRequestOptions,
  ): Promise<T> {
    if (this.isNative) {
      return this.requestNative<T>(method, url, body, options);
    }
    return this.requestWeb<T>(method, url, body, options);
  }

  private async requestNative<T>(
    method: string,
    url: string,
    body?: unknown,
    options?: NativeHttpRequestOptions,
  ): Promise<T> {
    const capOptions: HttpOptions = {
      url,
      method,
      headers: options?.headers,
      params: options?.params,
      data: body,
      connectTimeout: options?.timeoutMs ?? 15000,
      readTimeout: options?.timeoutMs ?? 15000,
    };

    const response: HttpResponse = await CapacitorHttp.request(capOptions);
    if (response.status >= 200 && response.status < 300) {
      return response.data as T;
    }
    throw new Error(`Native HTTP Error ${response.status} from ${url}`);
  }

  private async requestWeb<T>(
    method: string,
    url: string,
    body?: unknown,
    options?: NativeHttpRequestOptions,
  ): Promise<T> {
    const headers: Record<string, string> = {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(options?.headers ?? {}),
    };

    let fetchUrl = url;
    if (options?.params) {
      const searchParams = new URLSearchParams();
      for (const [key, val] of Object.entries(options.params)) {
        if (Array.isArray(val)) {
          val.forEach((v) => searchParams.append(key, v));
        } else {
          searchParams.append(key, val);
        }
      }
      const qs = searchParams.toString();
      if (qs) {
        fetchUrl += (fetchUrl.includes('?') ? '&' : '?') + qs;
      }
    }

    const res = await fetch(fetchUrl, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: options?.signal,
    });

    if (!res.ok) {
      throw new Error(`HTTP Error ${res.status} from ${fetchUrl}`);
    }

    return (await res.json()) as T;
  }
}
