/* eslint-disable no-console */
/**
 * One-shot guarded backfill for the email-verification gate-on flip.
 *
 * Runs the point-in-time
 *   UPDATE users SET email_verified = true WHERE email_verified = false
 * so that every PRE-EXISTING user is grandfathered before the verification
 * gate is turned ON (i.e. before `RESEND_API_KEY` is set). Running it AFTER the
 * flip locks those users out of login — see `docs/DEV_SETUP.md` "Turning the
 * gate ON in prod".
 *
 * Idempotent: the `WHERE email_verified = false` clause means a re-run touches
 * only rows that still need it; a second run reports 0 updated. Re-run it
 * immediately before flipping `RESEND_API_KEY` to catch signups that happened
 * during the gate-off window.
 *
 * Safety: this writes to the prod `users` table, so it refuses to run without
 * the `--allow-prod-backfill` opt-in flag (mirrors the `--allow-prod-seed`
 * guard in `seed-recipes.ts`). The guard is UNCONDITIONAL — not keyed on
 * `NODE_ENV` — because the real `railway run` invocation does not set it.
 *
 * Usage (prod, via Railway — internal host won't resolve from a laptop, so
 * point DATABASE_URL at the public URL):
 *   railway run --service Postgres -- sh -c \
 *     'DATABASE_URL="$DATABASE_PUBLIC_URL" npx tsx \
 *       server/scripts/backfill-email-verified.ts --allow-prod-backfill'
 *
 * Or via the npm script:
 *   npm run backfill:email-verified -- --allow-prod-backfill
 */
import "dotenv/config";
import { db, pool } from "../db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import {
  ALLOW_FLAG,
  isBackfillAuthorized,
  REFUSAL_MESSAGE,
  resendGateWarning,
} from "./backfill-email-verified-utils";

/**
 * Best-effort, redacted description of the connection target, logged just
 * before the UPDATE so the operator can confirm which DB was written to. Never
 * prints credentials (host/port/db name only).
 */
function describeTarget(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) return "(DATABASE_URL unset)";
  try {
    const url = new URL(raw);
    const dbName = url.pathname.replace(/^\//, "") || "(default)";
    const port = url.port ? `:${url.port}` : "";
    return `${url.hostname}${port}/${dbName}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

/**
 * Minimal surface of the Drizzle db this script needs. Declared as an interface
 * so the unit test can inject a fake without constructing the full
 * `NodePgDatabase` — mirrors `cleanup-retention.ts`'s `RetentionDb`.
 */
export interface BackfillDb {
  update: typeof db.update;
}

/**
 * Run the idempotent backfill against an injected db and return the number of
 * rows actually flipped. The `WHERE email_verified = false` clause is the
 * idempotency guarantee: a re-run touches only rows that still need it, so a
 * second run returns 0. `.returning()` yields one row per updated user, so its
 * length is the affected-row count.
 *
 * Exported (and db-injected) so the test can assert the false-condition WHERE
 * clause without booting Postgres.
 */
export async function backfillEmailVerified(
  database: BackfillDb,
): Promise<number> {
  const updated = await database
    .update(users)
    .set({ emailVerified: true })
    .where(eq(users.emailVerified, false))
    .returning({ id: users.id });
  return updated.length;
}

async function main() {
  console.log("=== Backfill email_verified ===\n");

  if (!isBackfillAuthorized(process.argv)) {
    // Exit before opening any connection — the pool is lazy and untouched here,
    // so there is nothing to close (mirrors cleanup-retention.ts's guard path).
    console.error(REFUSAL_MESSAGE);
    process.exit(1);
  }

  const warning = resendGateWarning();
  if (warning) console.warn(warning);

  console.log(`Target DB: ${describeTarget()}`);
  console.log(
    `Authorized with ${ALLOW_FLAG} — running point-in-time backfill.`,
  );

  const updatedCount = await backfillEmailVerified(db);

  console.log(`Updated ${updatedCount} user(s) to email_verified = true.`);
  if (updatedCount === 0) {
    console.log("Nothing to backfill — all users were already verified.");
  }

  await pool.end();
}

// Only run main() when invoked directly via `tsx`/`node`, not when imported by
// tests (importing must not trigger the guard/exit or open a connection).
const isMain = (() => {
  try {
    const argv1 = process.argv[1];
    return Boolean(argv1 && argv1.includes("backfill-email-verified"));
  } catch {
    return false;
  }
})();

if (isMain) {
  main().catch((err) => {
    console.error("Backfill failed:", err);
    void pool.end().then(() => process.exit(1));
  });
}
