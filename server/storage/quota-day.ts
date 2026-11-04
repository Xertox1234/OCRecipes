import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import type { db } from "../db";
import { parseTimezone } from "../lib/civil-date";
import { getDayBounds } from "./helpers";

/** A pool `db` or a transaction client: both can run a select. */
type Executor = Pick<typeof db, "select">;

/**
 * THE day boundary for every daily quota (scans, meal suggestions, chat and
 * coach messages, recipe generations, paid-AI claims).
 *
 * Bounds are the calendar day of `now` in the user's STORED `users.timezone`
 * (NULL or invalid -> UTC), never an `x-timezone` header: the header is
 * client-controlled, so flipping it would earn an extra reset. Every quota
 * counter, the early check AND the in-transaction re-check, calls this, so a
 * feature has exactly one bucket. Not cached: a cache would let two buckets
 * coexist for a moment. Pass the transaction client inside a transaction.
 *
 * Non-quota day-bucketed READS (daily summary, meal plan) still bucket in the
 * device timezone from the header; those are display, not a spend cap.
 */
export async function quotaDayBounds(
  executor: Executor,
  userId: string,
  now: Date = new Date(),
): Promise<{ startOfDay: Date; endOfDay: Date }> {
  const [row] = await executor
    .select({ timezone: users.timezone })
    .from(users)
    .where(eq(users.id, userId));
  return getDayBounds(now, parseTimezone(row?.timezone));
}
