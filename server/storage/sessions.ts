/**
 * Generic in-memory session store factory + domain-specific instances.
 *
 * Sessions are transient state (<30 min TTL) that bridge the gap between
 * upload → optional follow-up → confirm. Once confirmed, data is persisted
 * to the database and the session is cleared.
 *
 * TODO: Replace with Redis for horizontal scaling in production.
 */
import crypto from "crypto";
import type { AnalysisResult } from "@shared/types/photo-analysis";
import type { LabelExtractionResult } from "@shared/types/label-analysis";

// ── Cooking session store ─────────────────────────────────────────────

import type {
  CookingSessionIngredient,
  CookingSessionPhoto,
} from "@shared/types/cook-session";

// ── Front-label verification session store ───────────────────────────

import type { FrontLabelExtractionResult } from "@shared/types/front-label";

// ── Generic session store factory ─────────────────────────────────────

export type SessionCheckResult =
  | { allowed: true }
  | { allowed: false; reason: string; code: string };

export interface SessionStoreOptions {
  maxPerUser: number;
  maxGlobal: number;
  timeoutMs: number;
  /** Domain label for error messages (e.g., "cooking", "front-label") */
  label?: string;
}

export interface SessionStore<T extends { userId: string; createdAt: number }> {
  /** Check whether a new session can be created for this user */
  canCreate(userId: string): SessionCheckResult;
  /**
   * Atomically check the per-user and global caps, then create a new session.
   * Prefer this over the separate canCreate → create pair to eliminate the
   * TOCTOU window between the check and the increment.
   */
  createIfAllowed(
    data: T,
  ): { ok: true; id: string } | { ok: false; reason: string; code: string };
  /** Store a new session, returning a random UUID key */
  create(data: T): string;
  /**
   * Store a new session under a caller-supplied deterministic key. Replaces
   * any existing entry at the same key (freeing its user-count slot first
   * so the caller does not trip the per-user cap when re-setting).
   *
   * Returns `{ ok: true }` on success, or `{ ok: false; reason; code }`
   * when the per-user or global cap would be exceeded.
   *
   * Use this instead of writing to `_internals.store` directly when a
   * domain needs deterministic keying (e.g. `(userId, conversationId)`
   * composite keys) while still honoring `canCreate()` caps.
   */
  createWithKey(
    key: string,
    data: T,
  ): { ok: true } | { ok: false; reason: string; code: string };
  /** Get an existing session by ID */
  get(id: string): T | undefined;
  /** Update an existing session in-place */
  update(id: string, data: Partial<T>): void;
  /** Delete a session and clean up its timeout + user count */
  clear(id: string): void;
  /** Reset the timeout for an existing session (touch) */
  resetTimeout(id: string): void;
  /** Internal state exposed for testing only */
  _internals: {
    store: Map<string, T>;
    timeouts: Map<string, ReturnType<typeof setTimeout>>;
    userCount: Map<string, number>;
  };
}

export function createSessionStore<
  T extends { userId: string; createdAt: number },
>(opts: SessionStoreOptions): SessionStore<T> {
  const store = new Map<string, T>();
  const timeouts = new Map<string, ReturnType<typeof setTimeout>>();
  const userCount = new Map<string, number>();
  const label = opts.label ?? "active";

  function decrementCount(userId: string): void {
    const count = userCount.get(userId) ?? 0;
    if (count <= 1) {
      userCount.delete(userId);
    } else {
      userCount.set(userId, count - 1);
    }
  }

  function clearSession(id: string): void {
    const session = store.get(id);
    const existingTimeout = timeouts.get(id);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      timeouts.delete(id);
    }
    store.delete(id);
    if (session) {
      decrementCount(session.userId);
    }
  }

  function resetTimeout(id: string): void {
    const existing = timeouts.get(id);
    if (existing) clearTimeout(existing);
    const timeoutId = setTimeout(() => clearSession(id), opts.timeoutMs);
    timeouts.set(id, timeoutId);
  }

  return {
    canCreate(userId: string): SessionCheckResult {
      if (store.size >= opts.maxGlobal) {
        return {
          allowed: false,
          reason: "Server is busy, please try again later",
          code: "SESSION_LIMIT_REACHED",
        };
      }
      const count = userCount.get(userId) ?? 0;
      if (count >= opts.maxPerUser) {
        return {
          allowed: false,
          reason: `Too many ${label} sessions. Please confirm or wait for existing sessions to expire.`,
          code: "USER_SESSION_LIMIT",
        };
      }
      return { allowed: true };
    },

    createIfAllowed(
      data: T,
    ): { ok: true; id: string } | { ok: false; reason: string; code: string } {
      // Perform both cap checks and the increment atomically (synchronous Map
      // ops — no await gap — so there is no TOCTOU window under Node's
      // single-threaded event loop).
      if (store.size >= opts.maxGlobal) {
        return {
          ok: false,
          reason: "Server is busy, please try again later",
          code: "SESSION_LIMIT_REACHED",
        };
      }
      const count = userCount.get(data.userId) ?? 0;
      if (count >= opts.maxPerUser) {
        return {
          ok: false,
          reason: `Too many ${label} sessions. Please confirm or wait for existing sessions to expire.`,
          code: "USER_SESSION_LIMIT",
        };
      }
      const id = crypto.randomUUID();
      if ("id" in data) {
        (data as Record<string, unknown>).id = id;
      }
      store.set(id, data);
      userCount.set(data.userId, count + 1);
      const timeoutId = setTimeout(() => clearSession(id), opts.timeoutMs);
      (timeoutId as unknown as { unref?: () => void }).unref?.();
      timeouts.set(id, timeoutId);
      return { ok: true, id };
    },

    create(data: T): string {
      const id = crypto.randomUUID();
      // Auto-inject the store key into data.id if the type has one
      if ("id" in data) {
        (data as Record<string, unknown>).id = id;
      }
      store.set(id, data);
      userCount.set(data.userId, (userCount.get(data.userId) ?? 0) + 1);
      const timeoutId = setTimeout(() => clearSession(id), opts.timeoutMs);
      // Don't keep the event loop alive in tests/CLI just for this timer.
      (timeoutId as unknown as { unref?: () => void }).unref?.();
      timeouts.set(id, timeoutId);
      return id;
    },

    createWithKey(
      key: string,
      data: T,
    ): { ok: true } | { ok: false; reason: string; code: string } {
      // Determine whether the existing entry at this key (if any) belongs to
      // the same user, so we can account for the freed slot in the cap checks
      // below BEFORE actually clearing it. This prevents a scenario where the
      // old entry is cleared first and then the cap rejects the new one,
      // leaving the user with no session at all.
      const existing = store.get(key);
      const isSameUser = existing?.userId === data.userId;

      // Net session count after the replace: current total minus the one we're
      // about to evict (if any), since we'll add one back immediately.
      const netGlobal = store.size - (existing ? 1 : 0);
      if (netGlobal >= opts.maxGlobal) {
        return {
          ok: false,
          reason: "Server is busy, please try again later",
          code: "SESSION_LIMIT_REACHED",
        };
      }
      const currentUserCount = userCount.get(data.userId) ?? 0;
      const netUserCount = currentUserCount - (isSameUser ? 1 : 0);
      if (netUserCount >= opts.maxPerUser) {
        return {
          ok: false,
          reason: `Too many ${label} sessions. Please confirm or wait for existing sessions to expire.`,
          code: "USER_SESSION_LIMIT",
        };
      }

      // Cap checks passed — now safe to clear the old entry and write the new one.
      if (existing) {
        clearSession(key);
      }

      store.set(key, data);
      userCount.set(data.userId, (userCount.get(data.userId) ?? 0) + 1);
      const timeoutId = setTimeout(() => clearSession(key), opts.timeoutMs);
      // Don't keep the event loop alive in tests/CLI just for this timer.
      (timeoutId as unknown as { unref?: () => void }).unref?.();
      timeouts.set(key, timeoutId);
      return { ok: true };
    },

    get(id: string): T | undefined {
      return store.get(id);
    },

    update(id: string, data: Partial<T>): void {
      const session = store.get(id);
      if (session) {
        Object.assign(session, data);
        store.set(id, session);
      }
    },

    clear: clearSession,
    resetTimeout,

    _internals: { store, timeouts, userCount },
  };
}

// ── Domain-specific types ─────────────────────────────────────────────

export interface AnalysisSession {
  userId: string;
  result: AnalysisResult;
  createdAt: number;
}

export interface LabelSession {
  userId: string;
  labelData: LabelExtractionResult;
  barcode?: string;
  createdAt: number;
}

// ── Constants ─────────────────────────────────────────────────────────

export const MAX_SESSIONS_PER_USER = 3;
export const MAX_SESSIONS_GLOBAL = 500;
export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB decoded
export const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

// ── Instances ─────────────────────────────────────────────────────────

const analysisStore = createSessionStore<AnalysisSession>({
  maxPerUser: MAX_SESSIONS_PER_USER,
  maxGlobal: MAX_SESSIONS_GLOBAL,
  timeoutMs: SESSION_TIMEOUT,
  label: "active analysis",
});

const labelStore = createSessionStore<LabelSession>({
  maxPerUser: MAX_SESSIONS_PER_USER,
  maxGlobal: MAX_SESSIONS_GLOBAL,
  timeoutMs: SESSION_TIMEOUT,
  label: "active label",
});

// ── Public API (preserves existing function signatures) ───────────────

export function canCreateAnalysisSession(userId: string): SessionCheckResult {
  return analysisStore.canCreate(userId);
}

/** Atomically check caps and create an analysis session in one synchronous call. */
export function createAnalysisSessionIfAllowed(
  userId: string,
  result: AnalysisResult,
): { ok: true; id: string } | { ok: false; reason: string; code: string } {
  return analysisStore.createIfAllowed({
    userId,
    result,
    createdAt: Date.now(),
  });
}

export function createAnalysisSession(
  userId: string,
  result: AnalysisResult,
): string {
  return analysisStore.create({ userId, result, createdAt: Date.now() });
}

export function getAnalysisSession(
  sessionId: string,
): AnalysisSession | undefined {
  return analysisStore.get(sessionId);
}

export function updateAnalysisSession(
  sessionId: string,
  result: AnalysisResult,
): void {
  analysisStore.update(sessionId, { result });
}

export function clearAnalysisSession(sessionId: string): void {
  analysisStore.clear(sessionId);
}

export function canCreateLabelSession(userId: string): SessionCheckResult {
  return labelStore.canCreate(userId);
}

/** Atomically check caps and create a label session in one synchronous call. */
export function createLabelSessionIfAllowed(
  userId: string,
  labelData: LabelExtractionResult,
  barcode?: string,
): { ok: true; id: string } | { ok: false; reason: string; code: string } {
  return labelStore.createIfAllowed({
    userId,
    labelData,
    barcode,
    createdAt: Date.now(),
  });
}

export function createLabelSession(
  userId: string,
  labelData: LabelExtractionResult,
  barcode?: string,
): string {
  return labelStore.create({
    userId,
    labelData,
    barcode,
    createdAt: Date.now(),
  });
}

export function getLabelSession(sessionId: string): LabelSession | undefined {
  return labelStore.get(sessionId);
}

export function clearLabelSession(sessionId: string): void {
  labelStore.clear(sessionId);
}

// ── Coach warm-up session store ────────────────────────────────────────

export interface WarmUpMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

interface WarmUpSession {
  userId: string;
  conversationId: number;
  warmUpId: string;
  messages: WarmUpMessage[];
  createdAt: number;
}

export interface CookingSession {
  id: string;
  userId: string;
  ingredients: CookingSessionIngredient[];
  photos: CookingSessionPhoto[];
  createdAt: number;
}

export const COOKING_MAX_PER_USER = 2;
export const COOKING_MAX_GLOBAL = 1000;
export const COOKING_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export const cookingSessionStore = createSessionStore<CookingSession>({
  maxPerUser: COOKING_MAX_PER_USER,
  maxGlobal: COOKING_MAX_GLOBAL,
  timeoutMs: COOKING_TIMEOUT_MS,
  label: "active cooking",
});

export interface FrontLabelSession {
  userId: string;
  data: FrontLabelExtractionResult;
  barcode: string;
  createdAt: number;
}

export const frontLabelSessionStore = createSessionStore<FrontLabelSession>({
  maxPerUser: 3,
  maxGlobal: 500,
  timeoutMs: 15 * 60 * 1000, // 15 minutes
  label: "active front-label",
});

/** Max warm-ups per user — user may have one per active conversation. */
export const WARM_UP_MAX_PER_USER = 1;

/** Global cap so a single tenant cannot exhaust process memory. */
export const WARM_UP_MAX_GLOBAL = 1000;

/** Warm-up TTL in milliseconds (30 seconds). */
export const WARM_UP_TTL_MS = 30_000;

export const warmUpStore = createSessionStore<WarmUpSession>({
  maxPerUser: WARM_UP_MAX_PER_USER,
  maxGlobal: WARM_UP_MAX_GLOBAL,
  timeoutMs: WARM_UP_TTL_MS,
  label: "coach warm-up",
});

// ── Test internals ────────────────────────────────────────────────────

export const _testInternals = {
  analysisSessionStore: analysisStore._internals.store,
  sessionTimeouts: analysisStore._internals.timeouts,
  userSessionCount: analysisStore._internals.userCount,
  labelSessionStore: labelStore._internals.store,
  labelSessionTimeouts: labelStore._internals.timeouts,
  userLabelSessionCount: labelStore._internals.userCount,
  cookingSessionStore: cookingSessionStore._internals.store,
  userCookingSessionCount: cookingSessionStore._internals.userCount,
  frontLabelSessionStore: frontLabelSessionStore._internals.store,
  userFrontLabelSessionCount: frontLabelSessionStore._internals.userCount,
  warmUpSessionStore: warmUpStore._internals.store,
  userWarmUpSessionCount: warmUpStore._internals.userCount,
};
