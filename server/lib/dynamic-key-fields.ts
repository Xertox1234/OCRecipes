/**
 * Tiny, dependency-free convention letting a route mark specific top-level
 * response-body field names as dynamically-keyed maps (e.g. `allergenFlags`, keyed
 * by a grocery/menu item name rather than a hand-typed schema field name) --
 * consumed by `recordSnapshot` in server/lib/contract-snapshot.ts to force-redact
 * those fields via server/lib/contract-shape.ts's `deriveShape` `forcedDynamicKeys`
 * parameter, closing the two residual false-negative gaps neither of
 * `deriveShape`'s own heuristic signals (`looksDynamicallyKeyed`,
 * `hasUniformNonPrimitiveValueShape`) catches alone -- see that file's doc
 * comments and
 * docs/solutions/conventions/redact-dynamic-object-keys-not-just-values-2026-07-07.md.
 *
 * Kept in its own module, separate from contract-snapshot.ts, so a normal route
 * file marking its own response doesn't have to import that module's dev/lab-only
 * dependencies (pg, git-branch reading, the lab-DB pool) -- this file's only
 * dependency is express's `Response` type (type-only, zero runtime cost).
 *
 * Deliberately stored on `res.locals`, NOT on the response body itself: the body
 * passed to `res.json(...)` is what actually reaches the client, so embedding a
 * marker in it would leak into the real API contract. `res.locals` is Express-only
 * per-request state, never serialized to the wire, and -- critically -- untouched
 * by `recordSnapshot`'s `JSON.parse(JSON.stringify(body))` normalization (a marker
 * attached directly to `body`, e.g. a non-enumerable property, would be silently
 * stripped by that round-trip).
 *
 * RESIDUAL RISK (accepted, see the doc above's "Exceptions"): this is a manually-
 * maintained list, one call per producer -- a future route that returns a new
 * free-text-keyed dynamic map and forgets to call `markDynamicKeyFields` falls
 * back to the two heuristic signals alone, which by construction miss a
 * single-entry map and an all-primitive-valued map. This is the same fail-open
 * shape as a hand-maintained allowlist. It's accepted here (rather than solved
 * with more heuristics) because the residual surface is narrow: an identifier-
 * shaped key (email/UUID/long numeric id) or a >=2-entry non-primitive-valued map
 * still trips `looksDynamicallyKeyed`/`hasUniformNonPrimitiveValueShape`
 * regardless of marking, so the only unmarked-route leak path left is a free-text-
 * keyed map that is ALSO single-entry-or-all-primitive -- a narrower, rarer
 * combination than "any dynamic key," not the wide-open surface the pre-#544 code
 * had.
 *
 * ALTERNATIVE CONSIDERED, REJECTED: server/lib/request-context.ts's
 * AsyncLocalStorage-based `RequestContext` (an ultrareview of PR #551 flagged
 * this res.locals marker as reinventing that existing "producer sets
 * per-request metadata, a later consumer reads it" mechanism -- see
 * docs/solutions/conventions/redact-dynamic-object-keys-not-just-values-2026-07-07.md's
 * 2026-07-08 update for the full resolution). Kept res.locals rather than
 * adding a `forcedDynamicKeys` field + setter to `RequestContext`, for two
 * reasons:
 *
 * 1. The migration's cited benefit -- that `recordSnapshot()` "wouldn't need
 *    res threaded through at all" -- doesn't actually hold: `recordSnapshot()`
 *    already reads `res.statusCode` directly, so `res` stays in its parameter
 *    list either way. There is no threading cost for migrating to remove.
 * 2. `RequestContext` exists to propagate a handful of values to arbitrary,
 *    deeply-nested, arbitrarily-async call sites across the whole app (auth
 *    sets `userId` once; logging reads it from any log call anywhere) and is
 *    populated via `AsyncLocalStorage.run()` on every production request.
 *    This marker's job is narrower and travels exactly one hop: set on `res`
 *    immediately before a route's own `res.json()` call, read back in the
 *    very next middleware layer that wraps that same `res.json`. `res.locals`
 *    -- an Express-native, response-scoped bag built for precisely this
 *    "producer sets response-scoped metadata, next-in-chain middleware reads
 *    it" shape -- is a tighter fit than widening a small, load-bearing,
 *    always-populated interface for a dev-only diagnostic field. Both
 *    mechanisms happen to store "per-request metadata," but the propagation
 *    requirements differ enough that folding this one into `RequestContext`
 *    would be a net loss, not a simplification.
 */
import type { Response } from "express";

const DYNAMIC_KEY_FIELDS_LOCAL = "dynamicKeyFields";

/**
 * Mark one or more top-level response-body field names as dynamically-keyed maps.
 * Call this immediately before `res.json(...)`, right next to the code that builds
 * the dynamic map -- so "this field is dynamic" lives beside the code that makes
 * it true, not in a separately-maintained list (the drift-prone shape this project
 * already rejected once for a full per-route key allowlist -- see
 * `looksDynamicallyKeyed`'s doc comment in contract-shape.ts). Safe to call
 * unconditionally even when the field may end up absent/undefined on some requests
 * (e.g. no allergies matched) -- `deriveShape` simply won't find the key. Safe in
 * production too: with the contract-snapshot middleware not installed (or
 * refusing per `NODE_ENV=production`), nothing ever reads this value back.
 *
 * Additive across multiple calls in the same request (merges with any names
 * already marked) rather than overwriting, so unrelated middleware/handlers
 * marking different fields on the same response don't clobber each other.
 */
export function markDynamicKeyFields(
  res: Response,
  fieldNames: readonly string[],
): void {
  const existing: unknown = res.locals[DYNAMIC_KEY_FIELDS_LOCAL];
  res.locals[DYNAMIC_KEY_FIELDS_LOCAL] = Array.isArray(existing)
    ? [...existing, ...fieldNames]
    : [...fieldNames];
}

/**
 * Read back the field names marked via `markDynamicKeyFields` for this response,
 * as a Set for O(1) lookup in `deriveShape`'s object branch. Defensive against a
 * malformed/non-array `res.locals` value (should never happen through the setter
 * above, but `res.locals` is a loose, untyped bag any middleware could touch) --
 * falls back to an empty Set rather than throwing, matching this feature's fail-
 * silent posture (see contract-snapshot.ts's module doc comment).
 */
export function readDynamicKeyFields(res: Response): ReadonlySet<string> {
  const value: unknown = res.locals[DYNAMIC_KEY_FIELDS_LOCAL];
  return new Set(
    Array.isArray(value)
      ? value.filter((v): v is string => typeof v === "string")
      : [],
  );
}
