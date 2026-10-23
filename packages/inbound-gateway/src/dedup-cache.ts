/**
 * In-memory TTL Deduplication Cache to prevent webhook replay attacks and duplicate message processing.
 * Clean, zero external dependencies, self-evicting.
 */
export class DedupCache {
  private readonly store = new Map<string, number>();
  private readonly ttlMs: number;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(ttlSeconds = 86400) {
    this.ttlMs = ttlSeconds * 1000;
    // Periodic sweep every 5 minutes
    this.cleanupTimer = setInterval(() => this.prune(), 5 * 60 * 1000);
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Checks if an event ID was already seen.
   * If seen and not expired, returns true.
   * If not seen, records it with current timestamp and returns false.
   */
  checkAndRecord(eventId: string, nowMs = Date.now()): boolean {
    if (!eventId) return false;

    const expiresAt = this.store.get(eventId);
    if (expiresAt && expiresAt > nowMs) {
      return true; // Already processed
    }

    this.store.set(eventId, nowMs + this.ttlMs);
    return false; // Newly recorded
  }

  has(eventId: string, nowMs = Date.now()): boolean {
    const expiresAt = this.store.get(eventId);
    return Boolean(expiresAt && expiresAt > nowMs);
  }

  size(): number {
    return this.store.size;
  }

  prune(nowMs = Date.now()): number {
    let evicted = 0;
    for (const [key, expiresAt] of this.store.entries()) {
      if (expiresAt <= nowMs) {
        this.store.delete(key);
        evicted++;
      }
    }
    return evicted;
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.store.clear();
  }
}
