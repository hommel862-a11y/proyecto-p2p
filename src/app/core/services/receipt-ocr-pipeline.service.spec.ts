import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import type { BankReceiptRecord } from '@p2p/core';
import { IndexedDbStorageService } from '../indexed-db-storage.service';
import {
  ReceiptOcrPipelineService,
  OCR_SESSION_STORAGE_KEY,
  MAX_PERSISTED_SESSION_ITEMS,
  MAX_THUMBNAIL_CHARS,
  type PersistedOcrSessionItem,
} from './receipt-ocr-pipeline.service';

function makeReceipt(overrides: Partial<BankReceiptRecord> = {}): BankReceiptRecord {
  return {
    id: overrides.id ?? 'rcpt-1',
    reference: overrides.reference ?? '00123456',
    amount: overrides.amount ?? 1500,
    currency: overrides.currency ?? 'VES',
    bank: overrides.bank ?? 'BANESCO',
    bankDisplayName: overrides.bankDisplayName ?? 'Banesco Banco Universal',
    rawText: overrides.rawText ?? 'Pago Movil Banesco Ref 00123456 Bs 1500,00',
    confidenceScore: overrides.confidenceScore ?? 0.92,
    ...overrides,
  };
}

function makeSessionItem(overrides: Partial<PersistedOcrSessionItem> = {}): PersistedOcrSessionItem {
  return {
    receipt: overrides.receipt ?? makeReceipt(),
    aiMeta: overrides.aiMeta ?? null,
    thumbnailDataUrl: overrides.thumbnailDataUrl ?? 'data:image/jpeg;base64,/9j/4AAQ',
    imageHash: overrides.imageHash ?? 'a'.repeat(64),
    settledP2p: overrides.settledP2p ?? false,
    settledF360: overrides.settledF360 ?? false,
    driveBackedUp: overrides.driveBackedUp ?? false,
    savedAt: overrides.savedAt ?? '2026-11-23T14:00:00.000Z',
    ...overrides,
  };
}

describe('ReceiptOcrPipelineService', () => {
  let storageMap: Map<string, unknown>;
  let mockStorage: {
    whenReady: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
  let service: ReceiptOcrPipelineService;

  beforeEach(() => {
    storageMap = new Map<string, unknown>();
    mockStorage = {
      whenReady: vi.fn().mockResolvedValue(undefined),
      get: vi.fn((key: string) => (storageMap.has(key) ? storageMap.get(key) : null)),
      set: vi.fn((key: string, value: unknown) => {
        storageMap.set(key, value);
      }),
      remove: vi.fn((key: string) => {
        storageMap.delete(key);
      }),
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        ReceiptOcrPipelineService,
        { provide: IndexedDbStorageService, useValue: mockStorage },
      ],
    });
    service = TestBed.inject(ReceiptOcrPipelineService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('computeSha256', () => {
    it('computes standard lowercase SHA-256 hex digest for string, Uint8Array, and ArrayBuffer', async () => {
      const expectedHello = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
      const fromString = await service.computeSha256('hello');
      const bytes = new TextEncoder().encode('hello');
      const fromUint8 = await service.computeSha256(bytes);
      const fromArrayBuffer = await service.computeSha256(bytes.buffer.slice(0));

      expect(fromString).toBe(expectedHello);
      expect(fromUint8).toBe(expectedHello);
      expect(fromArrayBuffer).toBe(expectedHello);
    });

    it('falls back to a deterministic 64-char lowercase hex hash when crypto.subtle is unavailable', async () => {
      vi.stubGlobal('crypto', undefined);

      const h1 = await service.computeSha256('receipt-payload-alpha');
      const h2 = await service.computeSha256('receipt-payload-alpha');
      const h3 = await service.computeSha256('receipt-payload-beta');

      expect(h1).toMatch(/^[0-9a-f]{64}$/);
      expect(h1).toBe(h2);
      expect(h1).not.toBe(h3);
    });

    it('falls back cleanly if crypto.subtle.digest rejects', async () => {
      vi.stubGlobal('crypto', {
        subtle: {
          digest: vi.fn().mockRejectedValue(new Error('Not allowed in insecure context')),
        },
      });

      const hash = await service.computeSha256('fallback-test');
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('preprocessReceiptImage', () => {
    const sampleDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';

    it('degrades gracefully without throwing when canvas 2d context is unavailable', async () => {
      const origCreateElement = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
        if (tagName.toLowerCase() === 'canvas') {
          return { getContext: () => null } as unknown as HTMLCanvasElement;
        }
        return origCreateElement(tagName);
      });

      const result = await service.preprocessReceiptImage(sampleDataUrl);

      expect(result.canvasApplied).toBe(false);
      expect(result.processedDataUrl).toBe(sampleDataUrl);
      expect(result.thumbnailDataUrl).toBe(sampleDataUrl);
      expect(result.originalDataUrl).toBe(sampleDataUrl);
      expect(result.width).toBe(0);
      expect(result.height).toBe(0);
      expect(result.wasDarkModeInverted).toBe(false);
      expect(result.sha256Hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('reads File inputs into DataURL and degrades gracefully when canvas is unavailable', async () => {
      const origCreateElement = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
        if (tagName.toLowerCase() === 'canvas') {
          return { getContext: () => null } as unknown as HTMLCanvasElement;
        }
        return origCreateElement(tagName);
      });

      const file = new File(['fake-png-bytes'], 'receipt.png', { type: 'image/png' });
      const result = await service.preprocessReceiptImage(file);

      expect(result.canvasApplied).toBe(false);
      expect(result.originalDataUrl.startsWith('data:image/png;base64,')).toBe(true);
      expect(result.processedDataUrl).toBe(result.originalDataUrl);
      expect(result.sha256Hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('upscales small images 2x, auto-inverts dark-mode screenshots, stretches contrast, and creates compressed thumbnail', async () => {
      // Simulate a dark-mode 400x300 screenshot (RGB = 20, 20, 20 => luminance = 20 < 110)
      class MockImage {
        naturalWidth = 400;
        naturalHeight = 300;
        width = 400;
        height = 300;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_val: string) {
          queueMicrotask(() => this.onload?.());
        }
      }
      vi.stubGlobal('Image', MockImage);

      const pixelData = new Uint8ClampedArray([
        20, 20, 20, 255, // dark background -> inverted to 235 -> stretched > 235
        220, 220, 220, 255, // bright text -> inverted to 35 -> stretched < 35
        10, 10, 10, 255, // dark background
        15, 15, 15, 255, // dark background
      ]);

      const mainCtx = {
        imageSmoothingEnabled: false,
        imageSmoothingQuality: 'low',
        drawImage: vi.fn(),
        getImageData: vi.fn(() => ({ data: pixelData, width: 2, height: 2 })),
        putImageData: vi.fn(),
      };
      const thumbCtx = {
        imageSmoothingEnabled: false,
        imageSmoothingQuality: 'low',
        drawImage: vi.fn(),
      };

      const createdCanvases: {
        width: number;
        height: number;
        toDataURL: ReturnType<typeof vi.fn>;
        getContext: ReturnType<typeof vi.fn>;
      }[] = [];

      const origCreateElement = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
        if (tagName.toLowerCase() === 'canvas') {
          const isMain = createdCanvases.length === 0;
          const canvasMock = {
            width: 0,
            height: 0,
            getContext: vi.fn(() => (isMain ? mainCtx : thumbCtx)),
            toDataURL: vi.fn((mime?: string) =>
              mime === 'image/jpeg'
                ? 'data:image/jpeg;base64,THUMBMOCK'
                : 'data:image/png;base64,PROCESSEDMOCK',
            ),
          };
          createdCanvases.push(canvasMock);
          return canvasMock as unknown as HTMLCanvasElement;
        }
        return origCreateElement(tagName);
      });

      const result = await service.preprocessReceiptImage(sampleDataUrl);

      expect(result.canvasApplied).toBe(true);
      expect(result.width).toBe(800);
      expect(result.height).toBe(600);
      expect(result.wasDarkModeInverted).toBe(true);
      expect(result.processedDataUrl).toBe('data:image/png;base64,PROCESSEDMOCK');
      expect(result.thumbnailDataUrl).toBe('data:image/jpeg;base64,THUMBMOCK');
      expect(mainCtx.putImageData).toHaveBeenCalledTimes(1);

      // Pixel 0 was 20 -> inverted to 235 -> (235 - 128) * 1.35 + 128 = 272.45 -> clamped 255
      expect(pixelData[0]).toBe(255);
      expect(pixelData[1]).toBe(255);
      expect(pixelData[2]).toBe(255);
      // Pixel 1 was 220 -> inverted to 35 -> (35 - 128) * 1.35 + 128 = 2.45 -> 2
      expect(pixelData[4]).toBe(2);

      // Thumbnail canvas capped at 480px (400x300 stays 400x300) and encoded as JPEG 0.72
      expect(createdCanvases[1].width).toBe(400);
      expect(createdCanvases[1].height).toBe(300);
      expect(createdCanvases[1].toDataURL).toHaveBeenCalledWith('image/jpeg', 0.72);
    });

    it('caps upscaled dimensions at maxDimension and skips dark-mode inversion when disabled or light image', async () => {
      class MockLargeImage {
        naturalWidth = 850;
        naturalHeight = 850;
        width = 850;
        height = 850;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_val: string) {
          queueMicrotask(() => this.onload?.());
        }
      }
      vi.stubGlobal('Image', MockLargeImage);

      const darkPixels = new Uint8ClampedArray([30, 30, 30, 255, 40, 40, 40, 255]);
      const mainCtx = {
        imageSmoothingEnabled: false,
        imageSmoothingQuality: 'low',
        drawImage: vi.fn(),
        getImageData: vi.fn(() => ({ data: darkPixels, width: 2, height: 1 })),
        putImageData: vi.fn(),
      };
      const thumbCtx = {
        imageSmoothingEnabled: false,
        imageSmoothingQuality: 'low',
        drawImage: vi.fn(),
      };

      const createdCanvases: { width: number; height: number }[] = [];
      const origCreateElement = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
        if (tagName.toLowerCase() === 'canvas') {
          const isMain = createdCanvases.length === 0;
          const canvasMock = {
            width: 0,
            height: 0,
            getContext: vi.fn(() => (isMain ? mainCtx : thumbCtx)),
            toDataURL: vi.fn(() => 'data:image/png;base64,OK'),
          };
          createdCanvases.push(canvasMock);
          return canvasMock as unknown as HTMLCanvasElement;
        }
        return origCreateElement(tagName);
      });

      const result = await service.preprocessReceiptImage(sampleDataUrl, {
        maxDimension: 1200,
        autoInvertDarkMode: false,
      });

      expect(result.canvasApplied).toBe(true);
      expect(result.width).toBe(1200);
      expect(result.height).toBe(1200);
      expect(result.wasDarkModeInverted).toBe(false);
      // Thumbnail scaled down to max 480px
      expect(createdCanvases[1].width).toBe(480);
      expect(createdCanvases[1].height).toBe(480);
    });

    it('degrades gracefully when Image fails to load', async () => {
      class BrokenImage {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_val: string) {
          queueMicrotask(() => this.onerror?.());
        }
      }
      vi.stubGlobal('Image', BrokenImage);

      const origCreateElement = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
        if (tagName.toLowerCase() === 'canvas') {
          return {
            width: 0,
            height: 0,
            getContext: vi.fn(() => ({})),
          } as unknown as HTMLCanvasElement;
        }
        return origCreateElement(tagName);
      });

      const result = await service.preprocessReceiptImage(sampleDataUrl);
      expect(result.canvasApplied).toBe(false);
      expect(result.processedDataUrl).toBe(sampleDataUrl);
      expect(result.width).toBe(0);
    });
  });

  describe('session persistence', () => {
    it('caps saved session at 50 items and strips oversized thumbnails > 120_000 chars', () => {
      const items: PersistedOcrSessionItem[] = Array.from({ length: 65 }, (_, i) =>
        makeSessionItem({
          receipt: makeReceipt({ id: `rcpt-${i}`, reference: `REF-${i}` }),
          thumbnailDataUrl:
            i === 0 ? 'x'.repeat(MAX_THUMBNAIL_CHARS + 500) : 'data:image/jpeg;base64,small',
        }),
      );

      service.saveSession(items);

      expect(mockStorage.set).toHaveBeenCalledTimes(1);
      expect(mockStorage.set).toHaveBeenCalledWith(OCR_SESSION_STORAGE_KEY, expect.any(Array));
      const saved = storageMap.get(OCR_SESSION_STORAGE_KEY) as PersistedOcrSessionItem[];
      expect(saved).toHaveLength(MAX_PERSISTED_SESSION_ITEMS);
      expect(saved[0].receipt.id).toBe('rcpt-0');
      expect(saved[0].thumbnailDataUrl).toBeUndefined();
      expect(saved[1].thumbnailDataUrl).toBe('data:image/jpeg;base64,small');
      expect(saved[49].receipt.id).toBe('rcpt-49');
    });

    it('awaits storage.whenReady() in loadSession and filters malformed stored entries', async () => {
      const validItem = makeSessionItem({ receipt: makeReceipt({ id: 'valid-1' }) });
      storageMap.set(OCR_SESSION_STORAGE_KEY, [
        validItem,
        null,
        'corrupt-string',
        { savedAt: '2026-11-23T00:00:00Z' }, // missing receipt
        { receipt: { reference: '123' }, savedAt: '2026-11-23T00:00:00Z' }, // missing receipt.id
        { receipt: makeReceipt({ id: 'no-date' }), savedAt: '' }, // empty savedAt
      ]);

      const loaded = await service.loadSession();

      expect(mockStorage.whenReady).toHaveBeenCalledTimes(1);
      expect(loaded).toHaveLength(1);
      expect(loaded[0].receipt.id).toBe('valid-1');
    });

    it('returns empty array safely when stored value is not an array or whenReady fails', async () => {
      mockStorage.whenReady.mockRejectedValueOnce(new Error('IDB blocked'));
      storageMap.set(OCR_SESSION_STORAGE_KEY, { notAnArray: true });

      const loaded = await service.loadSession();
      expect(loaded).toEqual([]);
    });

    it('clears persisted session via storage.remove', () => {
      storageMap.set(OCR_SESSION_STORAGE_KEY, [makeSessionItem()]);
      service.clearSession();
      expect(mockStorage.remove).toHaveBeenCalledWith(OCR_SESSION_STORAGE_KEY);
      expect(storageMap.has(OCR_SESSION_STORAGE_KEY)).toBe(false);
    });
  });

  describe('findDuplicateByHash', () => {
    it('finds an existing session item matching sha256Hash case-insensitively', () => {
      const hash = 'abcdef0123456789'.repeat(4);
      const target = makeSessionItem({
        receipt: makeReceipt({ id: 'dup-1' }),
        imageHash: hash,
      });
      const items = [makeSessionItem({ receipt: makeReceipt({ id: 'other' }), imageHash: '1'.repeat(64) }), target];

      const found = service.findDuplicateByHash(items, `  ${hash.toUpperCase()}  `);
      expect(found).toBe(target);
    });

    it('returns undefined for empty or unmatched hashes', () => {
      const items = [makeSessionItem({ imageHash: 'a'.repeat(64) })];
      expect(service.findDuplicateByHash(items, '')).toBeUndefined();
      expect(service.findDuplicateByHash(items, '   ')).toBeUndefined();
      expect(service.findDuplicateByHash(items, 'b'.repeat(64))).toBeUndefined();
    });
  });
});
