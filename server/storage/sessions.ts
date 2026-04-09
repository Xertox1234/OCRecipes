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
  /** Store a new session, returning a random UUID key */
  create(data: T): string;
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

    create(data: T): string {
      const id = crypto.randomUUID();
      // Auto-inject the store key into data.id if the type has one
      if ("id" in data) {
        (data as Record<string, unknown>).id = id;
      }
      store.set(id, data);
      userCount.set(data.userId, (userCount.get(data.userId) ?? 0) + 1);
      const timeoutId = setTimeout(() => clearSession(id), opts.timeoutMs);
      timeouts.set(id, timeoutId);
      return id;
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
};
