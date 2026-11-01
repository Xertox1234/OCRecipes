import { schedulerRuns } from "@shared/schema";
import { db } from "../db";

/**
 * Claim one scheduler run. Returns true for exactly one caller per
 * (jobName, runSlot) — the unique index decides — and false for every other
 * caller, so a cron tick firing on several server instances runs once.
 */
export async function claimSchedulerRun(
  jobName: string,
  runSlot: string,
): Promise<boolean> {
  const rows = await db
    .insert(schedulerRuns)
    .values({ jobName, runSlot })
    .onConflictDoNothing()
    .returning({ id: schedulerRuns.id });
  return rows.length > 0;
}
