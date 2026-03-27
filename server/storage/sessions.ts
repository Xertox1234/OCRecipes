/**
 * In-memory session storage for photo analysis workflows.
 *
 * Sessions are transient state (<30 min TTL) that bridge the gap between
 * photo upload → optional follow-up → confirm. Once confirmed, data is
 * persisted to scannedItems/dailyLogs and the session is cleared.
 *
 * TODO: Replace with Redis for horizontal scaling in production.
 */
import crypto from "crypto";
import type {
  AnalysisResult,
  LabelExtractionResult,
} from "../services/photo-analysis";

// ── Types ────────────────────────────────────────────────────────────────

export interface AnalysisSession {
  userId: string;
  result: AnalysisResult;
  /** Timestamp used for diagnostics and future LRU eviction when migrating to Redis */
  createdAt: number;
}

export interface LabelSession {
  userId: string;
  labelData: LabelExtractionResult;
  barcode?: string;
  createdAt: number;
}

// ── Constants ────────────────────────────────────────────────────────────

export const MAX_SESSIONS_PER_USER = 3;
export const MAX_SESSIONS_GLOBAL = 500;
export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB decoded
export const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

// ── Internal state ───────────────────────────────────────────────────────

const analysisSessionStore = new Map<string, AnalysisSession>();
const sessionTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
const userSessionCount = new Map<string, number>();

const labelSessionStore = new Map<string, LabelSession>();
const labelSessionTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
const userLabelSessionCount = new Map<string, number>();

// ── Helpers ──────────────────────────────────────────────────────────────

function decrementCount(map: Map<string, number>, userId: string): void {
  const count = map.get(userId) ?? 0;
  if (count <= 1) {
    map.delete(userId);
  } else {
    map.set(userId, count - 1);
  }
}

// ── Types ────────────────────────────────────────────────────────────────

export type SessionCheckResult =
  | { allowed: true }
  | { allowed: false; reason: string; code: string };

// ── Analysis sessions ────────────────────────────────────────────────────

export function canCreateAnalysisSession(userId: string): SessionCheckResult {
  if (analysisSessionStore.size >= MAX_SESSIONS_GLOBAL) {
    return {
      allowed: false,
      reason: "Server is busy, please try again later",
      code: "SESSION_LIMIT_REACHED",
    };
  }
  const count = userSessionCount.get(userId) ?? 0;
  if (count >= MAX_SESSIONS_PER_USER) {
    return {
      allowed: false,
      reason:
        "Too many active analysis sessions. Please confirm or wait for existing sessions to expire.",
      code: "USER_SESSION_LIMIT",
    };
  }
  return { allowed: true };
}

export function createAnalysisSession(
  userId: string,
  result: AnalysisResult,
): string {
  const sessionId = crypto.randomUUID();
  analysisSessionStore.set(sessionId, {
    userId,
    result,
    createdAt: Date.now(),
  });
  userSessionCount.set(userId, (userSessionCount.get(userId) ?? 0) + 1);
  const timeoutId = setTimeout(
    () => clearAnalysisSession(sessionId),
    SESSION_TIMEOUT,
  );
  sessionTimeouts.set(sessionId, timeoutId);
  return sessionId;
}

export function getAnalysisSession(
  sessionId: string,
): AnalysisSession | undefined {
  return analysisSessionStore.get(sessionId);
}

export function updateAnalysisSession(
  sessionId: string,
  result: AnalysisResult,
): void {
  const session = analysisSessionStore.get(sessionId);
  if (session) {
    session.result = result;
    analysisSessionStore.set(sessionId, session);
  }
}

export function clearAnalysisSession(sessionId: string): void {
  const session = analysisSessionStore.get(sessionId);
  const existingTimeout = sessionTimeouts.get(sessionId);
  if (existingTimeout) {
    clearTimeout(existingTimeout);
    sessionTimeouts.delete(sessionId);
  }
  analysisSessionStore.delete(sessionId);
  if (session) {
    decrementCount(userSessionCount, session.userId);
  }
}

// ── Label sessions ───────────────────────────────────────────────────────

export function canCreateLabelSession(userId: string): SessionCheckResult {
  if (labelSessionStore.size >= MAX_SESSIONS_GLOBAL) {
    return {
      allowed: false,
      reason: "Server is busy, please try again later",
      code: "SESSION_LIMIT_REACHED",
    };
  }
  const count = userLabelSessionCount.get(userId) ?? 0;
  if (count >= MAX_SESSIONS_PER_USER) {
    return {
      allowed: false,
      reason:
        "Too many active label sessions. Please confirm or wait for existing sessions to expire.",
      code: "USER_SESSION_LIMIT",
    };
  }
  return { allowed: true };
}

export function createLabelSession(
  userId: string,
  labelData: LabelExtractionResult,
  barcode?: string,
): string {
  const sessionId = crypto.randomUUID();
  labelSessionStore.set(sessionId, {
    userId,
    labelData,
    barcode,
    createdAt: Date.now(),
  });
  userLabelSessionCount.set(
    userId,
    (userLabelSessionCount.get(userId) ?? 0) + 1,
  );
  const timeoutId = setTimeout(
    () => clearLabelSession(sessionId),
    SESSION_TIMEOUT,
  );
  labelSessionTimeouts.set(sessionId, timeoutId);
  return sessionId;
}

export function getLabelSession(sessionId: string): LabelSession | undefined {
  return labelSessionStore.get(sessionId);
}

export function clearLabelSession(sessionId: string): void {
  const session = labelSessionStore.get(sessionId);
  const existingTimeout = labelSessionTimeouts.get(sessionId);
  if (existingTimeout) {
    clearTimeout(existingTimeout);
    labelSessionTimeouts.delete(sessionId);
  }
  labelSessionStore.delete(sessionId);
  if (session) {
    decrementCount(userLabelSessionCount, session.userId);
  }
}

// ── Test internals ───────────────────────────────────────────────────────

/**
 * Internal state exported for testing only.
 * Convention: prefix with underscore to signal non-public API.
 * See docs/PATTERNS.md "Test Internals Export Pattern".
 */
export const _testInternals = {
  analysisSessionStore,
  sessionTimeouts,
  userSessionCount,
  labelSessionStore,
  labelSessionTimeouts,
  userLabelSessionCount,
};
