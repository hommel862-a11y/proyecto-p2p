import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToastService } from './toast.service';

describe('ToastService', () => {
  let service: ToastService;

  beforeEach(() => {
    service = new ToastService();
  });

  it('adds toasts with appropriate types and auto-generates ids', () => {
    const id = service.success('Operación exitosa', 'Éxito');
    expect(service.toasts().length).toBe(1);
    expect(service.toasts()[0].id).toBe(id);
    expect(service.toasts()[0].type).toBe('success');
    expect(service.toasts()[0].title).toBe('Éxito');
    expect(service.toasts()[0].message).toBe('Operación exitosa');
  });

  it('supports error, warn, and info methods', () => {
    service.error('Mensaje de error');
    service.warn('Mensaje de advertencia');
    service.info('Mensaje informativo');
    expect(service.toasts().length).toBe(3);
    expect(service.toasts()[0].type).toBe('error');
    expect(service.toasts()[1].type).toBe('warning');
    expect(service.toasts()[2].type).toBe('info');
  });

  it('dismisses a toast by id', () => {
    const id1 = service.info('Toast 1');
    const id2 = service.info('Toast 2');
    expect(service.toasts().length).toBe(2);

    service.dismiss(id1);
    expect(service.toasts().length).toBe(1);
    expect(service.toasts()[0].id).toBe(id2);
  });

  it('clearAll removes all active toasts', () => {
    service.info('Toast 1');
    service.info('Toast 2');
    service.clearAll();
    expect(service.toasts().length).toBe(0);
  });
});
