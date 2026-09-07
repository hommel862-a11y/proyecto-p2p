import { Injectable, inject, signal } from '@angular/core';
import { StorageService } from './storage';

const STORAGE_KEY = 'p2p.audio-muted';

@Injectable({ providedIn: 'root' })
export class AudioAlertsService {
  private readonly storage = inject(StorageService);
  private audioCtx: AudioContext | null = null;

  readonly isMuted = signal<boolean>(this.storage.get<boolean>(STORAGE_KEY) ?? false);

  toggleMute(): void {
    const next = !this.isMuted();
    this.isMuted.set(next);
    try {
      this.storage.set(STORAGE_KEY, next);
    } catch {
      /* ignore storage failure */
    }
  }

  playOpportunityAlert(): void {
    if (this.isMuted() || typeof window === 'undefined') return;

    try {
      const ctx = this.getOrCreateAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;

      // Two ascending harmonic chimes (A5: 880Hz, E6: 1320Hz)
      this.playChimeTone(ctx, 880, now, 0.18, 0.12);
      this.playChimeTone(ctx, 1320, now + 0.12, 0.28, 0.14);
    } catch (err) {
      console.debug('[AudioAlerts] Audio playback suppressed:', err);
    }
  }

  playKillSwitchAlert(): void {
    if (this.isMuted() || typeof window === 'undefined') return;

    try {
      const ctx = this.getOrCreateAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;
      // Low emergency pulse (440Hz down to 220Hz)
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(220, now + 0.3);

      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.35);
    } catch (err) {
      console.debug('[AudioAlerts] Audio playback suppressed:', err);
    }
  }

  private playChimeTone(
    ctx: AudioContext,
    freq: number,
    startTime: number,
    duration: number,
    volume: number,
  ): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, startTime);

    gain.gain.setValueAtTime(0.001, startTime);
    gain.gain.exponentialRampToValueAtTime(volume, startTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(startTime);
    osc.stop(startTime + duration);
  }

  private getOrCreateAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;

    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextClass) return null;

    if (!this.audioCtx) {
      this.audioCtx = new AudioContextClass();
    }

    if (this.audioCtx.state === 'suspended') {
      void this.audioCtx.resume();
    }

    return this.audioCtx;
  }
}
