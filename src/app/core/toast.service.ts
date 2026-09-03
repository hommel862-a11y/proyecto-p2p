import { Injectable, signal } from '@angular/core';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastMessage {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
  timestamp: number;
  durationMs: number;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<ToastMessage[]>([]);

  show(
    type: ToastType,
    message: string,
    options?: { title?: string; durationMs?: number },
  ): string {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const durationMs = options?.durationMs ?? (type === 'error' ? 6000 : 4000);

    const toast: ToastMessage = {
      id,
      type,
      title: options?.title,
      message,
      timestamp: Date.now(),
      durationMs,
    };

    this.toasts.update((current) => [...current, toast]);

    if (durationMs > 0) {
      setTimeout(() => {
        this.dismiss(id);
      }, durationMs);
    }

    return id;
  }

  success(message: string, title?: string): string {
    return this.show('success', message, { title });
  }

  error(message: string, title?: string): string {
    return this.show('error', message, { title });
  }

  warn(message: string, title?: string): string {
    return this.show('warning', message, { title });
  }

  info(message: string, title?: string): string {
    return this.show('info', message, { title });
  }

  dismiss(id: string): void {
    this.toasts.update((current) => current.filter((t) => t.id !== id));
  }

  clearAll(): void {
    this.toasts.set([]);
  }
}
