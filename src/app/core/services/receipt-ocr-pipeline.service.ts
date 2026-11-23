import { Injectable, inject } from '@angular/core';
import type { BankReceiptRecord } from '@p2p/core';
import { IndexedDbStorageService } from '../indexed-db-storage.service';
import type { ParsedFinancialDocument } from './finance-ai-ingestor.service';

export const OCR_SESSION_STORAGE_KEY = 'p2p.receipt_scanner.session.v1';
export const MAX_PERSISTED_SESSION_ITEMS = 50;
export const MAX_THUMBNAIL_CHARS = 120_000;

const DEFAULT_UPSCALE_FACTOR = 2;
const UPSCALE_THRESHOLD_PX = 900;
const DEFAULT_MAX_DIMENSION_PX = 1800;
const DARK_MODE_LUMINANCE_THRESHOLD = 110;
const DEFAULT_CONTRAST_BOOST = 1.35;
const THUMBNAIL_MAX_DIMENSION_PX = 480;
const THUMBNAIL_JPEG_QUALITY = 0.72;
const IMAGE_LOAD_TIMEOUT_MS = 2500;

export interface OcrPreprocessOptions {
  upscaleFactor?: number;
  autoInvertDarkMode?: boolean;
  contrastBoost?: number;
  maxDimension?: number;
}

export interface OcrPreprocessResult {
  processedDataUrl: string;
  thumbnailDataUrl: string;
  originalDataUrl: string;
  width: number;
  height: number;
  wasDarkModeInverted: boolean;
  sha256Hash: string;
  canvasApplied: boolean;
}

export interface PersistedOcrSessionItem {
  receipt: BankReceiptRecord;
  aiMeta?: ParsedFinancialDocument | null;
  thumbnailDataUrl?: string;
  imageHash?: string;
  settledP2p?: boolean;
  settledF360?: boolean;
  driveBackedUp?: boolean;
  driveFileUrl?: string;
  savedAt: string;
}

function toByteArray(data: ArrayBuffer | Uint8Array | string): Uint8Array<ArrayBuffer> {
  if (typeof data === 'string') {
    if (typeof TextEncoder !== 'undefined') {
      const encoded = new TextEncoder().encode(data);
      const copy = new Uint8Array(new ArrayBuffer(encoded.byteLength));
      copy.set(encoded);
      return copy;
    }
    const copy = new Uint8Array(new ArrayBuffer(data.length));
    for (let i = 0; i < data.length; i++) {
      copy[i] = data.charCodeAt(i) & 0xff;
    }
    return copy;
  }

  if (data instanceof Uint8Array) {
    const copy = new Uint8Array(new ArrayBuffer(data.byteLength));
    copy.set(data);
    return copy;
  }

  const view = new Uint8Array(data);
  const copy = new Uint8Array(new ArrayBuffer(view.byteLength));
  copy.set(view);
  return copy;
}

function bufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Deterministic 256-bit (64 lowercase hex chars) FNV-1a + avalanche mix fallback
 * used only when Web Crypto `crypto.subtle` is unavailable (non-secure HTTP or minimal DOM).
 */
function deterministicFallbackHash256(bytes: Uint8Array): string {
  const seeds = [
    0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35,
    0x27d4eb2f, 0x165667b1, 0xd3a2646c, 0xfd7046c5,
  ];
  const state = new Uint32Array(seeds);

  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    for (let lane = 0; lane < 8; lane++) {
      let h = state[lane] ^ ((b + lane * 31 + i) & 0xff);
      h = Math.imul(h, 0x01000193);
      h ^= h >>> 13;
      state[lane] = h >>> 0;
    }
  }

  let out = '';
  for (let lane = 0; lane < 8; lane++) {
    let h = state[lane] ^ bytes.length;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h = (h ^ (h >>> 16)) >>> 0;
    out += h.toString(16).padStart(8, '0');
  }
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...slice);
  }
  return typeof globalThis.btoa === 'function' ? globalThis.btoa(binary) : '';
}

async function readFileAsDataUrl(file: File): Promise<string> {
  if (typeof FileReader !== 'undefined') {
    const viaReader = await new Promise<string | null>((resolve) => {
      try {
        const reader = new FileReader();
        reader.onload = () => {
          resolve(typeof reader.result === 'string' ? reader.result : null);
        };
        reader.onerror = () => resolve(null);
        reader.onabort = () => resolve(null);
        reader.readAsDataURL(file);
      } catch {
        resolve(null);
      }
    });
    if (viaReader !== null) {
      return viaReader;
    }
  }

  try {
    const buf = await file.arrayBuffer();
    const mime = file.type || 'application/octet-stream';
    const b64 = bytesToBase64(new Uint8Array(buf));
    return `data:${mime};base64,${b64}`;
  } catch {
    return '';
  }
}

function loadImageElement(src: string, timeoutMs: number): Promise<HTMLImageElement | null> {
  if (typeof Image === 'undefined') {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    let settled = false;
    const img = new Image();

    const finish = (result: HTMLImageElement | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
      resolve(result);
    };

    const timer = setTimeout(() => finish(null), timeoutMs);
    img.onload = () => finish(img);
    img.onerror = () => finish(null);

    try {
      img.src = src;
    } catch {
      finish(null);
    }
  });
}

function isValidSessionItem(value: unknown): value is PersistedOcrSessionItem {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (typeof record['savedAt'] !== 'string' || record['savedAt'].trim().length === 0) {
    return false;
  }
  const receipt = record['receipt'];
  if (typeof receipt !== 'object' || receipt === null || Array.isArray(receipt)) {
    return false;
  }
  const receiptRecord = receipt as Record<string, unknown>;
  return (
    typeof receiptRecord['id'] === 'string' &&
    receiptRecord['id'].trim().length > 0 &&
    typeof receiptRecord['reference'] === 'string'
  );
}

function sanitizeSessionItem(item: PersistedOcrSessionItem): PersistedOcrSessionItem {
  if (item.thumbnailDataUrl && item.thumbnailDataUrl.length > MAX_THUMBNAIL_CHARS) {
    const clone: PersistedOcrSessionItem = { ...item };
    delete clone.thumbnailDataUrl;
    return clone;
  }
  return item;
}

/**
 * Hybrid OCR Pipeline Service:
 * - Pure-Canvas receipt pre-processing (2x upscale, dark-mode auto-inversion, grayscale contrast stretch)
 * - Compressed thumbnail generation for fast UI preview and low-quota persistence
 * - SHA-256 content fingerprinting with deterministic fallback
 * - IndexedDB-backed session persistence (capped at 50 items with thumbnail quota guard)
 */
@Injectable({ providedIn: 'root' })
export class ReceiptOcrPipelineService {
  private readonly storage = inject(IndexedDbStorageService);

  /**
   * Computes a lowercase 64-char SHA-256 hex digest using Web Crypto `crypto.subtle`,
   * falling back to a deterministic 256-bit hash when `crypto.subtle` is unavailable.
   */
  async computeSha256(data: ArrayBuffer | Uint8Array | string): Promise<string> {
    const bytes = toByteArray(data);
    const subtle = globalThis.crypto?.subtle;

    if (subtle && typeof subtle.digest === 'function') {
      try {
        const digest = await subtle.digest('SHA-256', bytes);
        return bufferToHex(digest);
      } catch {
        // Fall through to deterministic fallback hash
      }
    }

    return deterministicFallbackHash256(bytes);
  }

  /**
   * Pre-processes a receipt image (File or DataURL) on an offscreen 2D Canvas to improve
   * Tesseract OCR accuracy on mobile/dark-mode screenshots, and generates a lightweight thumbnail.
   * Degrades gracefully in headless/jsdom environments without throwing or hanging.
   */
  async preprocessReceiptImage(
    fileOrDataUrl: File | string,
    options?: OcrPreprocessOptions,
  ): Promise<OcrPreprocessResult> {
    const originalDataUrl =
      typeof fileOrDataUrl === 'string' ? fileOrDataUrl : await readFileAsDataUrl(fileOrDataUrl);
    const sha256Hash = await this.computeSha256(originalDataUrl);

    const fallback: OcrPreprocessResult = {
      processedDataUrl: originalDataUrl,
      thumbnailDataUrl: originalDataUrl,
      originalDataUrl,
      width: 0,
      height: 0,
      wasDarkModeInverted: false,
      sha256Hash,
      canvasApplied: false,
    };

    if (!originalDataUrl || typeof document === 'undefined' || typeof Image === 'undefined') {
      return fallback;
    }

    try {
      const mainCanvas = document.createElement('canvas');
      const mainCtx =
        mainCanvas && typeof mainCanvas.getContext === 'function'
          ? mainCanvas.getContext('2d')
          : null;
      if (!mainCtx) {
        return fallback;
      }

      const img = await loadImageElement(originalDataUrl, IMAGE_LOAD_TIMEOUT_MS);
      if (!img) {
        return fallback;
      }

      const srcWidth = img.naturalWidth || img.width;
      const srcHeight = img.naturalHeight || img.height;
      if (srcWidth <= 0 || srcHeight <= 0) {
        return fallback;
      }

      const maxDimension = Math.max(100, options?.maxDimension ?? DEFAULT_MAX_DIMENSION_PX);
      const upscaleFactor = Math.max(1, options?.upscaleFactor ?? DEFAULT_UPSCALE_FACTOR);
      const maxSide = Math.max(srcWidth, srcHeight);
      const baseScale = maxSide < UPSCALE_THRESHOLD_PX ? upscaleFactor : 1;
      const scale = Math.min(baseScale, maxDimension / maxSide);

      const targetWidth = Math.max(1, Math.round(srcWidth * scale));
      const targetHeight = Math.max(1, Math.round(srcHeight * scale));

      mainCanvas.width = targetWidth;
      mainCanvas.height = targetHeight;
      mainCtx.imageSmoothingEnabled = true;
      mainCtx.imageSmoothingQuality = 'high';
      mainCtx.drawImage(img, 0, 0, targetWidth, targetHeight);

      const thumbnailDataUrl = this.buildThumbnail(img, srcWidth, srcHeight, originalDataUrl);

      const imageData = mainCtx.getImageData(0, 0, targetWidth, targetHeight);
      const pixels = imageData.data;
      const pixelCount = Math.floor(pixels.length / 4);

      let luminanceSum = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        luminanceSum += 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
      }
      const avgLuminance = pixelCount > 0 ? luminanceSum / pixelCount : 255;

      const shouldInvert =
        options?.autoInvertDarkMode !== false && avgLuminance < DARK_MODE_LUMINANCE_THRESHOLD;
      const contrastBoost = options?.contrastBoost ?? DEFAULT_CONTRAST_BOOST;

      for (let i = 0; i < pixels.length; i += 4) {
        let r = pixels[i];
        let g = pixels[i + 1];
        let b = pixels[i + 2];

        if (shouldInvert) {
          r = 255 - r;
          g = 255 - g;
          b = 255 - b;
        }

        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        const stretched = Math.min(255, Math.max(0, Math.round((gray - 128) * contrastBoost + 128)));

        pixels[i] = stretched;
        pixels[i + 1] = stretched;
        pixels[i + 2] = stretched;
      }

      mainCtx.putImageData(imageData, 0, 0);
      const processedDataUrl = mainCanvas.toDataURL('image/png') || originalDataUrl;

      return {
        processedDataUrl,
        thumbnailDataUrl,
        originalDataUrl,
        width: targetWidth,
        height: targetHeight,
        wasDarkModeInverted: shouldInvert,
        sha256Hash,
        canvasApplied: true,
      };
    } catch {
      return fallback;
    }
  }

  /**
   * Loads persisted OCR session items after IndexedDB hydration, filtering malformed entries.
   */
  async loadSession(): Promise<PersistedOcrSessionItem[]> {
    try {
      await this.storage.whenReady();
    } catch {
      // Proceed with best-effort L1/localStorage read
    }

    const raw = this.storage.get<unknown>(OCR_SESSION_STORAGE_KEY);
    if (!Array.isArray(raw)) {
      return [];
    }

    const valid: PersistedOcrSessionItem[] = [];
    for (const entry of raw) {
      if (isValidSessionItem(entry)) {
        valid.push(sanitizeSessionItem(entry));
        if (valid.length >= MAX_PERSISTED_SESSION_ITEMS) {
          break;
        }
      }
    }
    return valid;
  }

  /**
   * Persists the most recent 50 OCR session items while stripping oversized thumbnails.
   */
  saveSession(items: readonly PersistedOcrSessionItem[]): void {
    const bounded = items
      .slice(0, MAX_PERSISTED_SESSION_ITEMS)
      .map((item) => sanitizeSessionItem(item));
    this.storage.set(OCR_SESSION_STORAGE_KEY, bounded);
  }

  /**
   * Clears the persisted OCR session from storage.
   */
  clearSession(): void {
    this.storage.remove(OCR_SESSION_STORAGE_KEY);
  }

  /**
   * Returns an existing session item matching the provided SHA-256 image hash, if any.
   */
  findDuplicateByHash(
    items: readonly PersistedOcrSessionItem[],
    sha256Hash: string,
  ): PersistedOcrSessionItem | undefined {
    const normalized = sha256Hash.trim().toLowerCase();
    if (!normalized) {
      return undefined;
    }
    return items.find((item) => item.imageHash?.trim().toLowerCase() === normalized);
  }

  private buildThumbnail(
    img: HTMLImageElement,
    srcWidth: number,
    srcHeight: number,
    fallbackDataUrl: string,
  ): string {
    try {
      const thumbCanvas = document.createElement('canvas');
      const thumbCtx =
        thumbCanvas && typeof thumbCanvas.getContext === 'function'
          ? thumbCanvas.getContext('2d')
          : null;
      if (!thumbCtx) {
        return fallbackDataUrl;
      }

      const thumbScale = Math.min(1, THUMBNAIL_MAX_DIMENSION_PX / Math.max(srcWidth, srcHeight));
      const thumbWidth = Math.max(1, Math.round(srcWidth * thumbScale));
      const thumbHeight = Math.max(1, Math.round(srcHeight * thumbScale));

      thumbCanvas.width = thumbWidth;
      thumbCanvas.height = thumbHeight;
      thumbCtx.imageSmoothingEnabled = true;
      thumbCtx.imageSmoothingQuality = 'medium';
      thumbCtx.drawImage(img, 0, 0, thumbWidth, thumbHeight);

      return thumbCanvas.toDataURL('image/jpeg', THUMBNAIL_JPEG_QUALITY) || fallbackDataUrl;
    } catch {
      return fallbackDataUrl;
    }
  }
}
