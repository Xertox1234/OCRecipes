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

/**
 * The M3 production guard `main()` enforces before anything else runs:
 * ensureDemoUser() writes a privileged "demo" user with a scripted password,
 * so a prod run must be an explicit opt-in. Returns the decision plus the
 * exact operator-facing messages; `main()` owns the side effects
 * (console.error, pool.end, exit).
 *
 * Interplay with shouldSeedAsPlatformOwned: when this guard refuses, that
 * helper's "production without the flag" branch is unreachable from main() —
 * it is retained anyway as layer 2 of the defense stack (guard →
 * platform-owned → assertLocalDbForDemoAccount), so a future reorder of
 * main() still cannot create a demo account in prod.
 */
export function evaluateProdSeedGuard(opts: {
  nodeEnv: string | undefined;
  allowProdSeed: boolean;
}): { refuse: true; messages: string[] } | { refuse: false; warning?: string } {
  if (opts.nodeEnv === "production" && !opts.allowProdSeed) {
    return {
      refuse: true,
      messages: [
        "Refusing to seed in NODE_ENV=production without --allow-prod-seed.",
        "Re-run as: npm run seed:recipes -- --allow-prod-seed   (you will be held to this)",
      ],
    };
  }
  if (opts.nodeEnv === "production" && opts.allowProdSeed) {
    return {
      refuse: false,
      warning:
        "⚠  NODE_ENV=production with --allow-prod-seed: creating demo user in a live DB.",
    };
  }
  return { refuse: false };
}

/**
 * Resolve the demo account's plaintext password. Preserves ensureDemoUser()'s
 * exact semantics: the env value wins when non-nullish (`??` — an explicitly
 * empty SEED_DEMO_PASSWORD is still used verbatim), while `fromEnv` mirrors
 * the TRUTHINESS check that decides whether to print the reproducible-login
 * tip. The two deliberately disagree on the empty string.
 */
export function resolveDemoPassword(
  envValue: string | undefined,
  generate: () => string,
): { password: string; fromEnv: boolean } {
  return {
    password: envValue ?? generate(),
    fromEnv: Boolean(envValue),
  };
}
