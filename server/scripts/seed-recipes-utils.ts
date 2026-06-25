/**
 * Pure helpers for `seed-recipes.ts`.
 *
 * Extracted so the prod-seed authorization decision can be unit-tested without
 * booting a real Postgres connection — `seed-recipes.ts` runs `main()` at module
 * load, so it cannot be imported in a test.
 *
 * Safety context (mirrors backfill-email-verified-utils.ts): the live run path
 * is `railway run`, which does NOT reliably set NODE_ENV=production. So the
 * authorless/no-account decision keys PRIMARILY on the explicit opt-in flag;
 * NODE_ENV is only belt-and-suspenders. Keying on NODE_ENV alone would let
 * ensureDemoUser() create a `demo` test account on the live backend — vetoed.
 */

/** Opt-in flag the operator passes to seed the live backend. */
export const ALLOW_PROD_SEED_FLAG = "--allow-prod-seed";

/**
 * Decide whether to seed as PLATFORM-OWNED content: create NO account and
 * insert every recipe with `authorId = null`. True when `--allow-prod-seed`
 * was passed OR NODE_ENV === "production".
 */
export function shouldSeedAsPlatformOwned(opts: {
  allowProdSeed: boolean;
  nodeEnv: string | undefined;
}): boolean {
  return opts.allowProdSeed || opts.nodeEnv === "production";
}
