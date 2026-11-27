import { useSyncExternalStore } from "react";
import type { WriteCardStatus } from "@shared/schemas/coach-write-cards";

/**
 * What this device did to one write card, kept outside the card component.
 * A finished reply's card first renders in the streaming footer, then the
 * saved message row takes over and the card remounts (coach chat audit
 * 2026-11-24, L34). Without this, a save in flight, its Undo and its error
 * were lost on that swap. Keyed by the server's cardId, which is unique.
 */
export interface WriteCardSession {
  /** Save or Undo is running: the guard against a second tap. */
  busy: boolean;
  saving: boolean;
  /** This device's result, and the block status it acted on. */
  status: WriteCardStatus | null;
  actedOn: WriteCardStatus | null;
  receipt: string | undefined;
  error: string | null;
  undoError: string | null;
  undoVisible: boolean;
  /** Undo on a log applied at once (T2) was used, refused or closed. */
  atOnceClosed: boolean;
}

const EMPTY: WriteCardSession = {
  busy: false,
  saving: false,
  status: null,
  actedOn: null,
  receipt: undefined,
  error: null,
  undoError: null,
  undoVisible: false,
  atOnceClosed: false,
};

const sessions = new Map<string, WriteCardSession>();
const listeners = new Map<string, Set<() => void>>();

export function getWriteCardSession(cardId: string): WriteCardSession {
  return sessions.get(cardId) ?? EMPTY;
}

export function updateWriteCardSession(
  cardId: string,
  patch: Partial<WriteCardSession>,
): void {
  sessions.set(cardId, { ...getWriteCardSession(cardId), ...patch });
  listeners.get(cardId)?.forEach((notify) => notify());
}

function subscribe(cardId: string, notify: () => void): () => void {
  let set = listeners.get(cardId);
  if (!set) {
    set = new Set();
    listeners.set(cardId, set);
  }
  set.add(notify);
  return () => {
    set.delete(notify);
    if (set.size === 0) listeners.delete(cardId);
  };
}

/** The card's session; re-renders when any copy of the card changes it. */
export function useWriteCardSession(cardId: string): WriteCardSession {
  return useSyncExternalStore(
    (notify) => subscribe(cardId, notify),
    () => getWriteCardSession(cardId),
  );
}

/**
 * The status the card shows. A newer card locking this one (replaced or
 * expired) always wins. Otherwise this device's result wins while the
 * server still reports the status it acted on; once a refetch says
 * something else, the server wins.
 */
export function effectiveCardStatus(
  blockStatus: WriteCardStatus,
  session: WriteCardSession,
): WriteCardStatus {
  if (blockStatus === "replaced" || blockStatus === "expired") {
    return blockStatus;
  }
  if (session.status === null) return blockStatus;
  // A refetch that caught up with this device's own action agrees with it.
  if (blockStatus === session.actedOn || blockStatus === session.status) {
    return session.status;
  }
  return blockStatus;
}

/**
 * A Coach form's answers in progress, for the same footer-to-saved-row
 * remount (L34). A form has no id, so the key is the form itself; the entry
 * goes when the form is sent, so a later identical form starts fresh.
 */
const formAnswers = new Map<string, unknown[]>();

export function formAnswersKey(block: unknown): string {
  return JSON.stringify(block);
}

export function getFormAnswers<T>(key: string): T[] | undefined {
  return formAnswers.get(key) as T[] | undefined;
}

export function setFormAnswers(key: string, answers: unknown[]): void {
  formAnswers.set(key, answers);
}

export function clearFormAnswers(key: string): void {
  formAnswers.delete(key);
}

/** Tests only: these stores live for the whole app run, so tests reset them. */
export function resetWriteCardSessions(): void {
  sessions.clear();
  formAnswers.clear();
}
