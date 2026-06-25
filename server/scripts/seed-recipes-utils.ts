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

/**
 * Hostnames that count as a LOCAL database. The demo/test login may only ever
 * be created against one of these — see assertLocalDbForDemoAccount. The empty
 * string covers hostless unix-socket URLs (e.g. `postgresql:///nutricam`).
 */
const LOCAL_DB_HOSTS = new Set(["localhost", "127.0.0.1", "::1", ""]);

/** Parse a DATABASE_URL's hostname, or null if absent/unparseable. */
function dbHost(databaseUrl: string | undefined): string | null {
  if (!databaseUrl) return null;
  try {
    const hostname = new URL(databaseUrl).hostname;
    // Strip IPv6 brackets: new URL returns "[::1]" for IPv6, but LOCAL_DB_HOSTS stores "::1"
    return hostname ? hostname.replace(/^\[|\]$/g, "") : hostname;
  } catch {
    return null;
  }
}

/**
 * True ONLY when DATABASE_URL points at a local Postgres host. Fail-closed: an
 * absent or unparseable URL returns false (treated as non-local).
 */
export function isLocalDbHost(databaseUrl: string | undefined): boolean {
  const host = dbHost(databaseUrl);
  return host !== null && LOCAL_DB_HOSTS.has(host);
}

/**
 * Fail-closed guard for the demo/test account: throws unless DATABASE_URL is a
 * local host. This makes "no test/demo login on the live backend" structurally
 * true — independent of the --allow-prod-seed flag and NODE_ENV (which
 * `railway run` may not inject). The demo account therefore cannot be written to
 * a remote/prod DB even if every flag/env guard above it is bypassed.
 */
export function assertLocalDbForDemoAccount(
  databaseUrl: string | undefined,
): void {
  if (!isLocalDbHost(databaseUrl)) {
    const host =
      dbHost(databaseUrl) ?? (databaseUrl ? "(unparseable)" : "(unset)");
    throw new Error(
      `Refusing to create the demo account against non-local DB host '${host}'. ` +
        `The demo/test login is local-only; seed the live backend with ` +
        `--allow-prod-seed (platform-owned, no account).`,
    );
  }
}
