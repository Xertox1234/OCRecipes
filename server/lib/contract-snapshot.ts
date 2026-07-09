/**
 * Dev-only, opt-in Express middleware for the PG Lab API contract snapshot/diff item
 * (docs/research/2026-07-05-pg-lab-roadmap.md, Batch C). Wraps `res.json` to record a
 * structural TYPE SKELETON (never raw values — responses can contain user health data)
 * of each distinct (branch, route, method, status) response shape into
 * dev.contract_snapshots — see scripts/pg-lab/schema/contract-snapshots.sql and the
 * comparison script scripts/pg-lab/contract-diff.sh.
 *
 * Fail-silent by design (PG Lab rail #2: nothing DB-related may ever block or slow a
 * request). Any error here — DB down, git unavailable, non-JSON-serializable body — is
 * caught and logged at `debug`, never surfaced to the caller and never thrown.
 *
 * Opt-in via CONTRACT_SNAPSHOT=1; refuses unconditionally when NODE_ENV=production even
 * if the flag is set (belt-and-suspenders — this must never run against real traffic).
 *
 * The lab-DB Pool is constructed lazily (only when the middleware is actually
 * installed) and is injectable, per
 * docs/solutions/conventions/lazy-init-db-pool-and-api-client-in-test-imported-modules-2026-06-13.md
 * — this module is imported by a `*.test.ts` file, so a module-level `new Pool(...)`
 * would open a connection at Vitest collection time even for tests that never exercise
 * the DB path.
 */
import { execSync } from "node:child_process";
import type { Application, NextFunction, Request, Response } from "express";
import pg from "pg";
import { deriveShape } from "./contract-shape";
import { readDynamicKeyFields } from "./dynamic-key-fields";
import { logger, toError } from "./logger";

const { Pool } = pg;
type PgPool = InstanceType<typeof Pool>;

type QueryFn = (text: string, params?: unknown[]) => Promise<unknown>;

let labPool: PgPool | null = null;

const SAFE_IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Parse the database name out of a connection string via the URL parser (not naive
 * `lastIndexOf("/")` slicing, which leaves a trailing query string attached — e.g.
 * `postgresql://localhost/nutricam?sslmode=require` would slice to
 * `"nutricam?sslmode=require"`, silently failing an exact-string denylist check below).
 * Falls back to stripping `?`/`#` before the slash-split for a URL the parser rejects.
 */
function parseDbName(connectionString: string): string {
  try {
    return new URL(connectionString).pathname.replace(/^\//, "");
  } catch {
    const withoutQuery = connectionString.split(/[?#]/)[0];
    return withoutQuery.slice(withoutQuery.lastIndexOf("/") + 1);
  }
}

/**
 * Lazily construct the ocrecipes_lab Pool. Same denylist as scripts/pg-lab/init.sh and
 * scripts/pg-lab/codify-neardup.sh: this must never resolve to a real app database.
 */
export function getLabPool(env: NodeJS.ProcessEnv = process.env): QueryFn {
  if (!labPool) {
    const connectionString =
      env.LAB_DATABASE_URL || "postgresql://localhost/ocrecipes_lab";
    const dbName = parseDbName(connectionString);
    if (dbName === "nutricam" || dbName === "ocrecipes_solutions") {
      throw new Error(
        `contract-snapshot: LAB_DATABASE_URL resolves to '${dbName}', a real app database, not a PG Lab database`,
      );
    }
    if (!SAFE_IDENTIFIER_RE.test(dbName)) {
      throw new Error(
        `contract-snapshot: LAB_DATABASE_URL resolves to a database name '${dbName}' that isn't a safe identifier`,
      );
    }
    labPool = new Pool({ connectionString });
    labPool.on("error", (err) => {
      logger.debug({ err: toError(err) }, "contract-snapshot: lab pool error");
    });
  }
  const pool = labPool;
  return (text, params) => pool.query(text, params);
}

let cachedBranch: string | null | undefined;

/** Read the current git branch once (per process). Returns null on any failure. */
function readGitBranchOnce(): string | null {
  if (cachedBranch !== undefined) return cachedBranch;
  try {
    cachedBranch = execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    cachedBranch = null;
  }
  return cachedBranch;
}

export interface InstallContractSnapshotOptions {
  env?: NodeJS.ProcessEnv;
  /** Injectable for tests — defaults to a real once-per-process git branch read. */
  getBranch?: () => string | null;
  /** Injectable for tests — defaults to the lazily-constructed lab Pool. */
  getQuery?: (env: NodeJS.ProcessEnv) => QueryFn;
}

/**
 * Install the contract-snapshot middleware on `app` when opted in and not in
 * production. No-ops (does not register anything) otherwise.
 */
export function installContractSnapshotMiddleware(
  app: Application,
  options: InstallContractSnapshotOptions = {},
): void {
  const env = options.env ?? process.env;
  if (env.NODE_ENV === "production") return;
  if (env.CONTRACT_SNAPSHOT !== "1") return;

  const getBranch = options.getBranch ?? readGitBranchOnce;
  const branch = getBranch();
  if (!branch) {
    logger.warn(
      "contract-snapshot: could not resolve current git branch — middleware not installed",
    );
    return;
  }

  const getQuery = options.getQuery ?? getLabPool;

  app.use((req: Request, res: Response, next: NextFunction) => {
    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      try {
        void recordSnapshot(getQuery(env), branch, req, res, body).catch(
          (err) => {
            logger.debug(
              { err: toError(err) },
              "contract-snapshot: recording failed (ignored)",
            );
          },
        );
      } catch (err) {
        logger.debug(
          { err: toError(err) },
          "contract-snapshot: shape derivation failed (ignored)",
        );
      }
      return originalJson(body);
    }) as Response["json"];
    next();
  });
}

// DECISION (2026-07-09, todos/archive/P3-2026-07-08-contract-snapshots-no-backfill-for-pre-fix-rows.md):
// rows written before PR #544 added dynamic-key redaction to deriveShape() keep their
// raw, unredacted key names forever, because the upsert below is keyed on
// (branch, route_pattern, method, status) — it only overwrites a row when that exact
// branch is re-exercised, so a row from a since-deleted or since-merged branch is never
// touched again. Deliberately NOT backfilling those rows in place. Three reasons:
//   1. This table is dev-only, opt-in (CONTRACT_SNAPSHOT=1), and unconditionally refused
//      under NODE_ENV=production (see installContractSnapshotMiddleware above) — no
//      production data is ever at risk.
//   2. The canonical leak channel — a developer diffing an old pre-#544 snapshot
//      against a new post-#544 one for the same route (the migration scenario
//      contract-diff.sh exists to run across a branch boundary) — is already closed:
//      diffRouteShapes() in contract-shape.ts now treats that redaction transition as
//      such and never prints the raw keys (see
//      todos/archive/P1-2026-07-08-contract-diff-cli-leaks-old-unredacted-keys.md).
//      NOT fully closed, by that same todo's own accepted boundary: diffing two
//      pre-#544 rows against each other, or a key that never trips the redaction
//      heuristic, still prints real key names via the normal per-key path. That
//      residual is narrower than the pre-#544 exposure (it requires two stale rows on
//      both sides, or a non-dynamic-looking key) and is still confined to a dev-only,
//      opt-in, non-production tool.
//   3. Every row here is disposable, re-derivable diagnostic data, not a source of truth
//      (scripts/pg-lab/init.sh's module doc comment: "ocrecipes_lab ... is NEVER a
//      source of truth"). Writing a real backfill script would mean duplicating
//      deriveShape()'s redaction heuristics (looksDynamicallyKeyed /
//      hasUniformNonPrimitiveValueShape) as a second, standalone recursive walker over
//      an already-derived Shape tree instead of a raw response body — those heuristics
//      are not currently exported for reuse, and this exact module has already had
//      multiple subtle regression bugs in redaction logic this week (see
//      docs/solutions/logic-errors/redaction-diff-intercept-must-validate-both-sides-not-just-asymmetry-2026-07-08.md).
//      That risk is disproportionate to a P3/low-severity, no-production-exposure gap.
// Remediation available to any developer who wants pre-fix rows gone from their own
// local table: `TRUNCATE dev.contract_snapshots;` (safe — every row is disposable and
// gets repopulated the next time CONTRACT_SNAPSHOT=1 traffic hits the route).
async function recordSnapshot(
  query: QueryFn,
  branch: string,
  req: Request,
  res: Response,
  body: unknown,
): Promise<void> {
  // No matched route (a genuine 404, or an error thrown before routing completed) —
  // skip rather than record a bogus, non-canonical route string.
  if (!req.route?.path) return;

  // req.baseUrl + req.route.path is the full mounted pattern for a sub-router (e.g.
  // server/routes/public-api.ts, mounted at app.use("/api/v1", router)) and is exactly
  // req.route.path (baseUrl === "") for the ~45 domain modules that register directly
  // on `app`. KNOWN LIMITATION: req.baseUrl resets to "" by the time control reaches a
  // top-level error-handling middleware, so a JSON error response that bubbled up from
  // a sub-router will under-report its route pattern (missing the mount prefix) here —
  // accepted rather than special-cased for the one affected sub-router.
  const routePattern = `${req.baseUrl}${req.route.path}`;
  const method = req.method;
  const status = res.statusCode;

  // Round-trip through JSON so the shape reflects the actual wire payload (drops
  // `undefined` fields, serializes Dates to strings, etc.) rather than the in-memory
  // object shape.
  const normalized: unknown = JSON.parse(JSON.stringify(body));
  // Ordering here doesn't matter: res.locals is separate from `body` entirely, so
  // it is never touched by (and can't be stripped by) the JSON.parse(JSON.stringify(body))
  // normalization above — see dynamic-key-fields.ts's module doc comment for why
  // the marker lives there rather than on `body` itself.
  const forcedDynamicKeys = readDynamicKeyFields(res);
  const shape = deriveShape(normalized, forcedDynamicKeys);

  await query(
    `INSERT INTO dev.contract_snapshots
       (branch, route_pattern, method, status, shape, first_seen, last_seen, sample_count)
     VALUES ($1, $2, $3, $4, $5::jsonb, now(), now(), 1)
     ON CONFLICT (branch, route_pattern, method, status)
     DO UPDATE SET
       shape = EXCLUDED.shape,
       last_seen = now(),
       sample_count = CASE
         WHEN dev.contract_snapshots.shape = EXCLUDED.shape
         THEN dev.contract_snapshots.sample_count + 1
         ELSE 1
       END`,
    [branch, routePattern, method, status, JSON.stringify(shape)],
  );
}
