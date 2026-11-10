/**
 * AI-sharing gate (privacy audit H3): no AI call is made for a signed-in user
 * who has not allowed their data to go to the AI companies named in
 * `shared/lib/ai-sharing.ts`. `aiChat` calls this before every request, so
 * the rule holds for every feature without a check in each route.
 *
 * The user comes from the request context (`requireAuth` sets it). Work that
 * runs outside a signed-in request — scheduled jobs, scripts, evals — sends
 * no user's request and is not gated.
 *
 * `lib/` is a leaf and cannot read storage, so the server installs the lookup
 * at boot (`server/index.ts`). With no lookup installed a signed-in request
 * is refused: failing closed is the safe direction for a privacy rule.
 */
import { getRequestContext } from "./request-context";

export class AiSharingRequiredError extends Error {
  constructor() {
    super("AI features are off for this account");
    this.name = "AiSharingRequiredError";
  }
}

type AiSharingLookup = (userId: string) => Promise<boolean>;

/**
 * How long a "yes" is trusted before the lookup runs again. One instance
 * drops it at once when the user turns the permission off (`forgetAiSharing`);
 * another instance catches up within this window.
 */
const ALLOWED_TTL_MS = 60_000;
const MAX_REMEMBERED = 5_000;

let lookup: AiSharingLookup | undefined;
const allowedUntil = new Map<string, number>();

export function installAiSharingLookup(fn: AiSharingLookup): void {
  lookup = fn;
}

/** Drop the remembered "yes" for a user whose permission just changed. */
export function forgetAiSharing(userId: string): void {
  allowedUntil.delete(userId);
}

export function resetAiSharingGateForTests(): void {
  lookup = undefined;
  allowedUntil.clear();
}

export async function assertAiSharingAllowed(): Promise<void> {
  const ctx = getRequestContext();
  const userId = ctx?.userId;
  if (!ctx || !userId) return;

  const until = allowedUntil.get(userId);
  if (until !== undefined && until > Date.now()) return;
  allowedUntil.delete(userId);

  if (!lookup || !(await lookup(userId))) {
    // Many services replace a failed AI call's error with their own; the flag
    // lets handleRouteError still tell the app why (see wasAiSharingRefused).
    ctx.aiSharingRefused = true;
    throw new AiSharingRequiredError();
  }

  if (allowedUntil.size >= MAX_REMEMBERED) {
    const oldest = allowedUntil.keys().next().value;
    if (oldest !== undefined) allowedUntil.delete(oldest);
  }
  allowedUntil.set(userId, Date.now() + ALLOWED_TTL_MS);
}

/** True when `error`, or an AI call earlier in this request, was a refusal. */
export function wasAiSharingRefused(error: unknown): boolean {
  return (
    error instanceof AiSharingRequiredError ||
    getRequestContext()?.aiSharingRefused === true
  );
}
