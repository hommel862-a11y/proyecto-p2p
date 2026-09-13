import { computeSha256 } from '../core/index.js';

export class RateLimiter {
  private readonly callHistory = new Map<string, number[]>();

  /**
   * Enforces max calls per time window. Returns true if allowed, false if limit exceeded.
   */
  checkLimit(toolName: string, maxCalls: number, windowMs = 60000): boolean {
    const now = Date.now();
    const timestamps = this.callHistory.get(toolName) || [];
    const valid = timestamps.filter((t) => now - t < windowMs);

    if (valid.length >= maxCalls) {
      return false;
    }

    valid.push(now);
    this.callHistory.set(toolName, valid);
    return true;
  }
}

export class HumanConfirmationManager {
  private readonly pendingTokens = new Map<string, { action: string; payloadHash: string; expiresAt: number }>();

  /**
   * Generates a 2-minute ephemeral confirmation challenge token.
   */
  generateChallengeToken(action: string, payload: unknown): string {
    const payloadHash = computeSha256(JSON.stringify(payload));
    const token = `CONFIRM-${computeSha256(`${action}:${payloadHash}:${Date.now()}`).slice(0, 10).toUpperCase()}`;
    this.pendingTokens.set(token, {
      action,
      payloadHash,
      expiresAt: Date.now() + 120000,
    });
    return token;
  }

  /**
   * Validates a challenge token and payload before permitting execution.
   */
  verifyChallengeToken(token: string, action: string, payload: unknown): boolean {
    const record = this.pendingTokens.get(token);
    if (!record) return false;

    if (Date.now() > record.expiresAt) {
      this.pendingTokens.delete(token);
      return false;
    }

    const payloadHash = computeSha256(JSON.stringify(payload));
    if (record.action !== action || record.payloadHash !== payloadHash) {
      return false;
    }

    this.pendingTokens.delete(token);
    return true;
  }
}

export const rateLimiter = new RateLimiter();
export const confirmationManager = new HumanConfirmationManager();
