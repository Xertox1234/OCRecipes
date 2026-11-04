/**
 * Multi-connection test for the scheduler run claim. Does NOT mock `../../db`
 * or use the savepoint harness (both force one connection, which cannot race):
 * parallel claims check out distinct pool connections, so each is a genuine
 * separate transaction — the situation of two server instances ticking at once.
 */
import { describe, it, expect, afterAll } from "vitest";
import { like } from "drizzle-orm";
import crypto from "node:crypto";
import { db, pool } from "../../db";
import { schedulerRuns } from "@shared/schema";
import { claimSchedulerRun } from "../scheduler-runs";

const PREFIX = `test-concurrent-${crypto.randomUUID()}`;

afterAll(async () => {
  await db
    .delete(schedulerRuns)
    .where(like(schedulerRuns.jobName, `${PREFIX}%`));
  await pool.end();
});

describe("claimSchedulerRun: concurrent multi-connection safety", () => {
  it("exactly one of N simultaneous claims wins", async () => {
    for (let iter = 0; iter < 10; iter++) {
      const job = `${PREFIX}-${iter}`;
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          claimSchedulerRun(job, "2026-11-01T09"),
        ),
      );
      expect(results.filter(Boolean)).toHaveLength(1);
    }
  });
});
