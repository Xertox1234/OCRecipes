/**
 * Coach response-cache and notebook-dedupe key helpers.
 *
 * Extracted verbatim from coach-pro-chat.ts. A changed digest silently
 * invalidates or cross-serves cached coach replies — the pinned digests in
 * __tests__/coach-cache-keys.test.ts guard against that.
 */

import { createHash } from "crypto";
import { civilDateString } from "../lib/civil-date";
import {
  getSystemPromptTemplateVersion,
  type CoachContext,
} from "./nutrition-coach";
import type { CoachIntent } from "./coach-intent-classifier";

/**
 * Day bucket string — e.g. `"2026-04-18"` — in the given IANA timezone.
 * Used to expire cached coach answers whose prompt includes today's numeric
 * context (goals, intake).
 *
 * Both parameters are required. The previous UTC/now defaults had no remaining
 * callers, and a plausible UTC default on a timezone-dependent value is the
 * trap `hashCoachCacheKey` documents below — this bucket must agree with the
 * user's civil date, which is also what the system prompt now states.
 */
export function getDayBucketInTz(d: Date, tz: string): string {
  // Delegates rather than re-implementing: this was a verbatim third copy of
  // the same `en-CA` formatter, and civil-date logic living in several places
  // is how the bases drift apart in the first place.
  return civilDateString(d, tz);
}

/**
 * Build the SHA-256 cache key used for coach-response caching. The key includes:
 *  - prompt template version — automatically derived from the static system
 *    prompt hash so cache entries stale out when the prompt prose changes,
 *    eliminating the need for a manual version bump (H5 — 2026-04-18)
 *  - userId  — different users must not share answers
 *  - isCoachPro — Pro and non-Pro prompts diverge (tools, notebook); a cached
 *    non-Pro answer must never be replayed to a Pro user (H4 — 2026-04-18)
 *  - dayBucket — keeps universal first-turn answers from crossing the USER's
 *    civil day (not the server's — see getDayBucketInTz)
 *  - contextHash — captures goals, intake, dietary profile, and
 *    hour bucket so same-day context changes invalidate cached answers
 *  - intent — the deterministic intent classification; different intents pick
 *    different prompt bundles, so cached answers must not cross intents
 *
 * The `intent` parameter defaults to `"personalized_advice"` purely as a
 * backward-compat fallback for callers that predate intent-aware caching — it
 * is NOT a meaningful routing decision. Real callers (`handleCoachChat`) always
 * pass the classified intent explicitly.
 */
export function hashCoachCacheKey(
  userId: string,
  content: string,
  isCoachPro: boolean,
  // Required, not defaulted: `getDayBucketInTz()` with no arguments answers in
  // UTC, which is a different day from the user's for part of every day. A
  // plausible default on a timezone-dependent parameter is exactly what let the
  // planned_date bases diverge unnoticed (PRs #889/#890) — the cache key and the
  // prompt's date must agree, so the caller states the bucket.
  dayBucket: string,
  contextHash = "no-context",
  intent: CoachIntent = "personalized_advice",
): string {
  return createHash("sha256")
    .update(
      [
        getSystemPromptTemplateVersion(),
        userId,
        isCoachPro ? "pro" : "free",
        dayBucket,
        contextHash,
        intent,
        content.trim().toLowerCase(),
      ].join("\u001f"),
    )
    .digest("hex")
    .slice(0, 32);
}

export function hashCoachCacheContext(
  context: CoachContext,
  now: Date = new Date(),
  tz: string = "UTC",
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        goals: context.goals,
        todayIntake: context.todayIntake,
        dietaryProfile: context.dietaryProfile,
        // Binding rule (ai-prompting): every context field the prompt renders
        // must be in this hash, or same-day profile edits serve stale answers.
        // (dueCommitmentsSummary is Pro-only and the cache is free-only, but
        // it's included so the invariant stays mechanical, not reasoned-about.)
        aboutUser: context.aboutUser ?? null,
        dueCommitmentsSummary: context.dueCommitmentsSummary ?? null,
        frequentFoodsSummary: context.frequentFoodsSummary ?? null,
        // User-local hour, matching the tz-aware day bucket — the prompt's
        // "Current time" line is rendered in the user's tz, so the cache
        // must bucket on the same clock. h23 avoids "24" at midnight.
        hour: Number(
          new Intl.DateTimeFormat("en-US", {
            timeZone: tz,
            hour: "2-digit",
            hourCycle: "h23",
          }).format(now),
        ),
      }),
    )
    .digest("hex")
    .slice(0, 16);
}

/**
 * Build a dedup fingerprint for a notebook write. The same conversation
 * turn (same last user + last assistant pair) must always produce the same
 * key so the unique index makes repeat writes idempotent.
 *
 * For `coaching_strategy` entries the key is bucketed by ISO week instead
 * of conversation turn so the TOCTOU between `shouldUpdateStrategy`'s count
 * read and the insert cannot produce duplicate strategy rows for the same
 * user in the same week.
 */
export function hashNotebookDedupeKey(params: {
  userId: string;
  conversationId: number;
  entryType: string;
  entryContent: string;
  lastUserMessage: string;
  lastAssistantMessage: string;
}): string {
  if (params.entryType === "coaching_strategy") {
    const weekBucket = getIsoWeekBucket(new Date());
    return createHash("sha256")
      .update(["coaching_strategy", params.userId, weekBucket].join("\u001f"))
      .digest("hex");
  }
  return createHash("sha256")
    .update(
      [
        params.userId,
        String(params.conversationId),
        params.entryType,
        params.entryContent,
        params.lastUserMessage,
        params.lastAssistantMessage,
      ].join("\u001f"),
    )
    .digest("hex");
}

/** Returns an ISO year+week bucket string like `"2026-W16"`. */
function getIsoWeekBucket(d: Date): string {
  // Copy to UTC and shift to the nearest Thursday (ISO week anchor).
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(
    ((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
  );
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}
