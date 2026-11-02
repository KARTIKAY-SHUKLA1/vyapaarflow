/**
 * Circuit breaker for AI capture. When the provider is slow or failing (Google
 * answering in 19–23 s against our 12 s budget, or 5xx), every message would make
 * the desk wait 12 s for the same rule-based fallback. After THRESHOLD consecutive
 * availability failures within WINDOW, automatic AI calls are paused for COOLDOWN
 * and the desk gets the labelled rule-based result at once.
 *
 * - Only availability failures count: timeouts and HTTP 5xx. A blocked, invalid
 *   or 4xx answer means the provider is reachable, so it resets the count.
 * - Any successful answer closes the breaker.
 * - A manual "Re-read with AI" bypasses the pause (the caller passes bypass).
 * - State is per server process (in memory). Node runs these updates without
 *   interleaving, so concurrent requests are safe; on serverless each instance
 *   keeps its own state, which only makes the pause best-effort.
 */

export const BREAKER_THRESHOLD = 2;
export const BREAKER_WINDOW_MS = 5 * 60_000;
export const BREAKER_COOLDOWN_MS = 2 * 60_000;

export type BreakerOptions = { threshold?: number; windowMs?: number; cooldownMs?: number; now?: () => number };

export class CircuitBreaker {
  private failures: number[] = []; // timestamps of consecutive availability failures
  private openUntil = 0;
  private readonly threshold: number;
  private readonly windowMs: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;

  constructor(opts: BreakerOptions = {}) {
    this.threshold = opts.threshold ?? BREAKER_THRESHOLD;
    this.windowMs = opts.windowMs ?? BREAKER_WINDOW_MS;
    this.cooldownMs = opts.cooldownMs ?? BREAKER_COOLDOWN_MS;
    this.now = opts.now ?? Date.now;
  }

  /** Paused right now? Expired pauses close themselves and start counting afresh. */
  isOpen(): boolean {
    if (this.openUntil === 0) return false;
    if (this.now() < this.openUntil) return true;
    this.openUntil = 0;
    this.failures = [];
    return false;
  }

  /** Epoch ms when automatic calls resume, or null when not paused. */
  pausedUntil(): number | null {
    return this.isOpen() ? this.openUntil : null;
  }

  recordSuccess(): void {
    this.failures = [];
    this.openUntil = 0;
  }

  recordFailure(): void {
    const t = this.now();
    this.failures = [...this.failures.filter((f) => t - f <= this.windowMs), t];
    if (this.failures.length >= this.threshold) {
      this.openUntil = t + this.cooldownMs;
      this.failures = [];
    }
  }
}
