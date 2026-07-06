import { createHash } from "crypto";
import pg from "pg";
import type { Pool as PgPool } from "pg";
import { createServiceLogger, toError } from "../lib/logger";

const log = createServiceLogger("dev-api-cache");

/**
 * Dev-only record/replay cache in front of external nutrition/recipe APIs
 * (CNF, USDA, API Ninjas, Spoonacular). Recorded once, replayed forever —
 * speeds the dev loop, dodges rate limits, and makes integration-style tests
 * deterministic. Backing table: scripts/pg-lab/schema/api-cache.sql, in the
 * `dev` schema of the separate `ocrecipes_lab` database (never `nutricam`,
 * which Vitest shares).
 *
 * Modes (env-gated):
 *   API_CACHE unset   -> "off": no cache code path executes at all — the
 *                        lab DB pool is never even constructed.
 *   API_CACHE=1       -> "replay": replay-if-hit, record-on-miss.
 *   API_CACHE=refresh -> "refresh": always call through and re-record.
 * All modes additionally require NODE_ENV=development — any other NODE_ENV
 * (test, production, or unset) is "off" regardless of API_CACHE, so Vitest
 * runs and production stay fully passthrough with zero behavior change.
 *
 * Fail-silent: any lab-DB error (unreachable, missing table, etc.) falls
 * straight through to the real fetch — this must never break a real lookup.
 *
 * Hard guard below: throws at import time if NODE_ENV=production and
 * API_CACHE is set to a recognized cache-activating value ("1" or
 * "refresh"), mirroring the seed script's refuse-prod pattern — this cache
 * must never be reachable in production, full stop. Checked against exact
 * values (not bare truthiness) so an unrelated/garbage API_CACHE value
 * leaked into a prod environment can't crash server boot for a mode this
 * module wouldn't even activate for.
 */
const ACTIVE_CACHE_VALUES = new Set(["1", "refresh"]);
if (
  process.env.NODE_ENV === "production" &&
  ACTIVE_CACHE_VALUES.has(process.env.API_CACHE ?? "")
) {
  throw new Error(
    `dev-api-cache: API_CACHE=${process.env.API_CACHE} but NODE_ENV=production — ` +
      "this dev-only record/replay cache must never run in production",
  );
}

type CacheMode = "off" | "replay" | "refresh";

function resolveMode(): CacheMode {
  if (process.env.NODE_ENV !== "development") return "off";
  if (process.env.API_CACHE === "refresh") return "refresh";
  if (process.env.API_CACHE === "1") return "replay";
  return "off";
}

// Lazy singleton — never constructed at module scope (this file is imported
// by nutrition-lookup.ts, which Vitest imports; a top-level `new Pool()`
// would attempt a connection at test-collection time).
const { Pool } = pg;
let pool: PgPool | null = null;

function getPool(): PgPool {
  if (!pool) {
    const connectionString =
      process.env.LAB_DATABASE_URL || "postgresql://localhost/ocrecipes_lab";
    pool = new Pool({ connectionString });
    pool.on("error", (err) => {
      log.warn({ err: toError(err) }, "lab DB pool error (fail-silent)");
    });
  }
  return pool;
}

// API-key-like param/body-field names are excluded from the hash so key
// rotation never invalidates an already-recorded fixture.
const API_KEY_FIELD_RE = /^(api[_-]?key|key|x-api-key)$/i;

function extractParams(
  url: string,
  body: BodyInit | null | undefined,
): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  try {
    for (const [k, v] of new URL(url).searchParams) {
      if (API_KEY_FIELD_RE.test(k)) continue;
      params[k] = v;
    }
  } catch {
    // not a valid absolute URL — hash on the raw string via basePath() below
  }
  if (typeof body === "string") {
    try {
      const parsed: unknown = JSON.parse(body);
      if (parsed && typeof parsed === "object") {
        for (const [k, v] of Object.entries(
          parsed as Record<string, unknown>,
        )) {
          if (API_KEY_FIELD_RE.test(k)) continue;
          params[k] = v;
        }
      }
    } catch {
      // body isn't JSON — nothing to add
    }
  }
  return params;
}

function basePath(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url.split("?")[0];
  }
}

function computeRequestHash(
  method: string,
  url: string,
  params: Record<string, unknown>,
): string {
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}=${JSON.stringify(params[k])}`)
    .join("&");
  return createHash("sha256")
    .update(`${method.toUpperCase()}:${basePath(url)}:${sorted}`)
    .digest("hex");
}

interface CachedRow {
  response: unknown;
  status: number;
}

async function replayFromCache(
  api: string,
  hash: string,
): Promise<CachedRow | null> {
  try {
    const result = await getPool().query<CachedRow>(
      "SELECT response, status FROM dev.api_cache WHERE api = $1 AND request_hash = $2",
      [api, hash],
    );
    return result.rows[0] ?? null;
  } catch (err) {
    log.warn({ err: toError(err) }, "cache replay lookup failed — passthrough");
    return null;
  }
}

async function recordToCache(
  api: string,
  hash: string,
  summary: string,
  status: number,
  responseBody: unknown,
): Promise<void> {
  try {
    await getPool().query(
      `INSERT INTO dev.api_cache (api, request_hash, request_summary, response, status)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (api, request_hash) DO UPDATE SET
         request_summary = EXCLUDED.request_summary,
         response = EXCLUDED.response,
         status = EXCLUDED.status,
         recorded_at = now()`,
      [api, hash, summary, JSON.stringify(responseBody), status],
    );
  } catch (err) {
    log.warn({ err: toError(err) }, "cache record write failed — ignored");
  }
}

/**
 * Value-probe ledger (mirrors harness.codify_neardup_log's pattern from the
 * PG Lab foundation): one row per invocation that reached replay/refresh
 * mode, so scripts/pg-lab/api-cache-report.sh can report hit/miss counts per
 * API over N days. Never blocks or throws — logging must not affect the
 * real request.
 */
async function logInvocation(api: string, hit: boolean): Promise<void> {
  try {
    await getPool().query(
      "INSERT INTO dev.api_cache_log (api, hit) VALUES ($1, $2)",
      [api, hit],
    );
  } catch {
    // value probe only — failure here is never surfaced
  }
}

/**
 * Dev-only record/replay wrapper around fetch() for external nutrition/
 * recipe APIs. Call sites pass a stable `api` identifier ("cnf", "usda",
 * "api-ninjas", "spoonacular") so the cache and the hit/miss report group by
 * provider. Outside NODE_ENV=development + API_CACHE, this is a bare
 * `fetch(url, init)` passthrough — no cache code path executes.
 */
export async function cachedFetch(
  api: string,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const mode = resolveMode();
  if (mode === "off") return fetch(url, init);

  const method = init.method ?? "GET";
  const params = extractParams(url, init.body);
  const hash = computeRequestHash(method, url, params);

  if (mode === "replay") {
    const cached = await replayFromCache(api, hash);
    if (cached) {
      await logInvocation(api, true);
      return new Response(JSON.stringify(cached.response), {
        status: cached.status,
      });
    }
  }

  const response = await fetch(url, init);
  // Only cache successful responses — a transient 429/500 recorded here would
  // otherwise be replayed as a permanent "success" for this request hash on
  // every subsequent API_CACHE=1 run until a manual API_CACHE=refresh.
  if (response.ok) {
    const summary = `${method.toUpperCase()} ${basePath(url)}`;
    try {
      const bodyJson: unknown = await response.clone().json();
      await recordToCache(api, hash, summary, response.status, bodyJson);
    } catch {
      // non-JSON body — nothing to cache; the real response is still returned
    }
  }
  await logInvocation(api, false);

  return response;
}
