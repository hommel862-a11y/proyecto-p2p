import { Injectable, inject, signal } from '@angular/core';
import { StorageService } from './storage';
import { AuditLoggerService } from './audit-logger.service';
import type { TradingSession } from '@p2p/core';

const SESSIONS_KEY = 'p2p.sessions';
const ACTIVE_SESSION_KEY = 'p2p.active-session';

@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly storage = inject(StorageService);
  private readonly audit = inject(AuditLoggerService);

  readonly sessions = signal<TradingSession[]>(this.loadSessions());
  readonly activeSession = signal<TradingSession | null>(this.loadActiveSession());

  startSession(params?: { targetOps?: number; notes?: string }): TradingSession {
    // If an active session is already running, return it
    const current = this.activeSession();
    if (current) return current;

    const newSession: TradingSession = {
      id: crypto.randomUUID(),
      startTime: new Date().toISOString(),
      targetOps: params?.targetOps,
      notes: params?.notes,
    };

    const updatedSessions = [newSession, ...this.sessions()];
    this.storage.set(SESSIONS_KEY, updatedSessions);
    this.storage.set(ACTIVE_SESSION_KEY, newSession);

    this.sessions.set(updatedSessions);
    this.activeSession.set(newSession);

    this.audit.log(
      'CONFIG_CHANGE',
      'Sesión de trading iniciada',
      { id: newSession.id, targetOps: newSession.targetOps },
      'info',
    );

    return newSession;
  }

  closeSession(params?: { disciplineRating?: number; notes?: string }): TradingSession | null {
    const active = this.activeSession();
    if (!active) return null;

    const closed: TradingSession = {
      ...active,
      endTime: new Date().toISOString(),
      disciplineRating: params?.disciplineRating ?? active.disciplineRating,
      notes: params?.notes
        ? `${active.notes ? active.notes + ' | ' : ''}${params.notes}`
        : active.notes,
    };

    const updated = this.sessions().map((s) => (s.id === closed.id ? closed : s));
    this.storage.set(SESSIONS_KEY, updated);
    this.storage.remove(ACTIVE_SESSION_KEY);

    this.sessions.set(updated);
    this.activeSession.set(null);

    this.audit.log(
      'CONFIG_CHANGE',
      'Sesión de trading finalizada',
      { id: closed.id, disciplineRating: closed.disciplineRating },
      'info',
    );

    return closed;
  }

  private loadSessions(): TradingSession[] {
    const list = this.storage.get<TradingSession[]>(SESSIONS_KEY);
    return Array.isArray(list) ? list : [];
  }

  private loadActiveSession(): TradingSession | null {
    return this.storage.get<TradingSession>(ACTIVE_SESSION_KEY) ?? null;
  }
}
