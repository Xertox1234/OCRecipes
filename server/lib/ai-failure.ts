import OpenAI from "openai";

export type AiFailureKind = "transport" | "balance" | "request" | "config";

/** An OpenRouter SSE event carrying a top-level `error` / finish_reason "error" (HTTP 200). */
export class InStreamError extends Error {
  constructor(readonly payload: unknown) {
    super("OpenRouter in-stream error");
    this.name = "InStreamError";
  }
}

// 4xx caused by THIS request's content (spec §3.4) — warn, no Sentry, no breaker.
const REQUEST_CONTENT_PATTERNS = [
  /context[_ ]length/i,
  /maximum context/i,
  /too many tokens/i,
  /content[_ ]?filter/i,
  /content management policy/i,
];

export function classifyAiFailure(err: unknown): AiFailureKind {
  if (err instanceof InStreamError) return "transport";
  if (err instanceof OpenAI.APIError) {
    const status = err.status;
    if (status === undefined) return "transport"; // connection / timeout
    if (status === 402) return "balance";
    if (status === 429 || status >= 500) return "transport";
    const text = `${String(err.code ?? "")} ${err.message}`;
    return REQUEST_CONTENT_PATTERNS.some((p) => p.test(text))
      ? "request"
      : "config";
  }
  return "transport";
}

export function countsTowardBreaker(kind: AiFailureKind): boolean {
  return kind === "transport" || kind === "balance";
}

/** In-memory, per process (spec §3.4) — fine for one Railway service. */
export class CircuitBreaker {
  private failures: number[] = [];
  private openedAt: number | null = null;
  private readonly threshold: number;
  private readonly windowMs: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;

  constructor(
    opts: {
      threshold?: number;
      windowMs?: number;
      cooldownMs?: number;
      now?: () => number;
    } = {},
  ) {
    this.threshold = opts.threshold ?? 5;
    this.windowMs = opts.windowMs ?? 60_000;
    this.cooldownMs = opts.cooldownMs ?? 60_000;
    this.now = opts.now ?? Date.now;
  }

  isOpen(): boolean {
    if (this.openedAt === null) return false;
    return this.now() - this.openedAt < this.cooldownMs;
  }

  recordFailure(): void {
    const t = this.now();
    if (this.openedAt !== null) {
      // Failed trial after cooldown (or a straggler while open) → (re)open now.
      this.openedAt = t;
      return;
    }
    this.failures = this.failures.filter((f) => t - f < this.windowMs);
    this.failures.push(t);
    if (this.failures.length >= this.threshold) this.openedAt = t;
  }

  recordSuccess(): void {
    this.failures = [];
    this.openedAt = null;
  }
}
