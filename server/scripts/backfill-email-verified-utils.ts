/**
 * Pure helpers for `backfill-email-verified.ts`.
 *
 * Extracted so the guard-refusal and warning logic can be unit-tested without
 * booting a real Postgres connection. See the sibling
 * `__tests__/backfill-email-verified-utils.test.ts`.
 *
 * Operational context (read before changing the guard): unlike
 * `seed-recipes.ts`, this script is a PROD operation. It is invoked against the
 * live DB via `railway run` (see `docs/DEV_SETUP.md` "Turning the gate ON"),
 * which does NOT reliably set `NODE_ENV=production`. A `seed`-style
 * "refuse only when NODE_ENV=production" guard would therefore never fire on
 * the real run path and silently allow the destructive write. So the guard
 * here requires the opt-in flag UNCONDITIONALLY — the only safe default for a
 * `UPDATE users` statement.
 */

/** Opt-in flag the operator must pass to authorize the destructive UPDATE. */
export const ALLOW_FLAG = "--allow-prod-backfill";

/**
 * Decide whether the backfill is authorized to run. The script writes
 * `UPDATE users SET email_verified = true`, so it refuses to proceed unless the
 * operator explicitly opts in with `--allow-prod-backfill`. We do NOT key this
 * on `NODE_ENV` because the real `railway run` invocation does not set it (see
 * the file header) — the flag is the single source of authorization.
 *
 * @param argv process argv (or any token list); the flag may appear anywhere.
 */
export function isBackfillAuthorized(argv: readonly string[]): boolean {
  return argv.includes(ALLOW_FLAG);
}

/**
 * The single line printed when the script refuses to run. Tells the operator
 * exactly how to re-invoke with the opt-in flag.
 */
export const REFUSAL_MESSAGE =
  `Refusing to run the email_verified backfill without ${ALLOW_FLAG}.\n` +
  `This statement writes UPDATE users SET email_verified = true.\n` +
  `Re-run with the flag once you have confirmed the target DB, e.g.:\n` +
  `  railway run --service Postgres -- sh -c ` +
  `'DATABASE_URL="$DATABASE_PUBLIC_URL" npx tsx ` +
  `server/scripts/backfill-email-verified.ts ${ALLOW_FLAG}'`;

/**
 * If `RESEND_API_KEY` is already set in the target env, the verification gate
 * is ON and this backfill is running LATE — pre-existing unverified users were
 * lockable-out in the window between the flip and this run. Returns a warning
 * string in that case, or `null` when the ordering is still correct.
 *
 * Advisory only — never blocks the run (the backfill is still the right thing
 * to do; it just should have happened before the flip).
 *
 * @param env environment record to inspect (defaults to `process.env`).
 */
export function resendGateWarning(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const key = env.RESEND_API_KEY;
  if (key !== undefined && key.trim() !== "") {
    return (
      "⚠  RESEND_API_KEY is already set — the verification gate is ON. " +
      "This backfill is running AFTER the flip; pre-existing unverified " +
      "users may already have been locked out. Run it BEFORE setting " +
      "RESEND_API_KEY next time."
    );
  }
  return null;
}
