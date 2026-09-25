import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import {
  GlobalErrorHandler,
  CHUNK_RELOAD_STORAGE_KEY,
  CHUNK_RELOAD_THROTTLE_MS,
} from './error-handler';
import { ToastService } from './toast.service';
import { AuditLoggerService } from './audit-logger.service';

describe('GlobalErrorHandler', () => {
  let handler: GlobalErrorHandler;
  let toastMock: { error: ReturnType<typeof vi.fn> };
  let auditMock: { log: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    toastMock = { error: vi.fn() };
    auditMock = { log: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        GlobalErrorHandler,
        { provide: ToastService, useValue: toastMock },
        { provide: AuditLoggerService, useValue: auditMock },
      ],
    });

    handler = TestBed.inject(GlobalErrorHandler);
    window.sessionStorage.clear();
  });

  afterEach(() => {
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('notifies user via toast and logs to audit on general errors', () => {
    const error = new Error('Test generic business exception');
    handler.handleError(error);

    expect(auditMock.log).toHaveBeenCalledWith(
      'SYSTEM_ERROR',
      'Excepción no controlada',
      expect.objectContaining({ message: 'Test generic business exception' }),
      'error',
    );
    expect(toastMock.error).toHaveBeenCalledWith(
      'Test generic business exception',
      'Error en el sistema',
    );
  });

  it('detects Vite/Chromium chunk import failures', () => {
    expect(
      handler.isChunkLoadError(
        'Failed to fetch dynamically imported module: http://localhost:51857/chunk-D1wI8Rnc.js',
      ),
    ).toBe(true);
    expect(handler.isChunkLoadError('Importing a module script failed.')).toBe(true);
    expect(handler.isChunkLoadError('error loading dynamically imported module')).toBe(true);
    expect(handler.isChunkLoadError('Loading chunk 42 failed.')).toBe(true);
    expect(handler.isChunkLoadError('ReferenceError: foo is not defined')).toBe(false);
  });

  it('auto-reloads the page when a chunk load error occurs and no recent reload is recorded', () => {
    const reloadSpy = vi.spyOn(handler, 'reloadPage').mockImplementation(() => {});
    const chunkError = new TypeError(
      'Failed to fetch dynamically imported module: http://localhost:51857/chunk-D1wI8Rnc.js',
    );

    handler.handleError(chunkError);

    // Logs the bundle mismatch warning to audit
    expect(auditMock.log).toHaveBeenCalledWith(
      'SYSTEM_ERROR',
      'Desincronización de bundle detectada (chunk desactualizado)',
      expect.objectContaining({ message: chunkError.message }),
      'warn',
    );

    // Triggers reload
    expect(reloadSpy).toHaveBeenCalledTimes(1);

    // Records timestamp in sessionStorage to prevent loops
    const savedTimestamp = window.sessionStorage.getItem(CHUNK_RELOAD_STORAGE_KEY);
    expect(savedTimestamp).toBeTruthy();
    expect(Number(savedTimestamp)).toBeGreaterThan(0);

    // Toast error is suppressed so user doesn't see a scary error modal
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it('suppresses reload loop and notifies via toast if a reload already happened recently', () => {
    const reloadSpy = vi.spyOn(handler, 'reloadPage').mockImplementation(() => {});
    const recentTimestamp = String(Date.now() - 2_000); // 2 seconds ago (< 15s)
    window.sessionStorage.setItem(CHUNK_RELOAD_STORAGE_KEY, recentTimestamp);

    const chunkError = new TypeError(
      'Failed to fetch dynamically imported module: http://localhost:51857/chunk-D1wI8Rnc.js',
    );

    handler.handleError(chunkError);

    // Does NOT trigger another reload to avoid infinite cycle
    expect(reloadSpy).not.toHaveBeenCalled();

    // Falls through to toast and system error audit
    expect(toastMock.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to fetch dynamically imported module'),
      'Error en el sistema',
    );
  });

  it('allows reload again once the throttle window has passed', () => {
    const reloadSpy = vi.spyOn(handler, 'reloadPage').mockImplementation(() => {});
    const oldTimestamp = String(Date.now() - (CHUNK_RELOAD_THROTTLE_MS + 1_000));
    window.sessionStorage.setItem(CHUNK_RELOAD_STORAGE_KEY, oldTimestamp);

    const chunkError = new TypeError(
      'Failed to fetch dynamically imported module: http://localhost:51857/chunk-D1wI8Rnc.js',
    );

    handler.handleError(chunkError);

    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(toastMock.error).not.toHaveBeenCalled();
  });
});
