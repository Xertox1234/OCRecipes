/**
 * Pure, side-effect-free helpers for the PG Lab API contract snapshot/diff item
 * (docs/research/2026-07-05-pg-lab-roadmap.md, Batch C). Derives a structural TYPE
 * SKELETON from a JSON-serializable value — keys, primitive types, and array-element
 * skeletons only, values are always discarded (responses can contain user health
 * data; storing values is out of bounds) — and diffs two such skeletons for the same
 * route to surface added/removed/retyped keys.
 *
 * Deterministic: object keys are always emitted in sorted order so two structurally
 * identical values always produce byte-identical shapes (required both for Postgres
 * jsonb-equality dedup in dev.contract_snapshots and for the JSON.stringify-based
 * comparisons in diffRouteShapes below).
 *
 * Consumed by:
 *   - server/lib/contract-snapshot.ts (the Express middleware — derives a shape from
 *     each dev-mode response body before writing it to dev.contract_snapshots)
 *   - scripts/pg-lab/contract-diff-cli.ts (the contract-diff.sh helper — diffs two
 *     branches' stored shapes for the same route/method/status)
 */

export type Shape =
  | { type: "null" }
  | { type: "string" }
  | { type: "number" }
  | { type: "boolean" }
  | { type: "array"; items: Shape | null } // null items = empty array (no element shape observed)
  | { type: "object"; keys: Record<string, Shape> } // keys always sorted
  | { type: "mixed"; variants: Shape[] }; // heterogeneous array elements — sorted, deduped variants

function canonicalKey(shape: Shape): string {
  // Deterministic because object keys are always inserted in sorted order and this
  // is only ever called on already-canonicalized Shape values.
  return JSON.stringify(shape);
}

/**
 * Collapse multiple shapes into one: the shape itself when every input is structurally
 * identical, or a sorted/deduped `mixed` shape otherwise. Shared by array-element
 * merging and the dynamic-key redaction path below (`looksDynamicallyKeyed`) — both
 * need "N observed shapes -> one representative shape."
 */
function mergeShapes(shapes: Shape[]): Shape {
  const uniqueByKey = new Map<string, Shape>();
  for (const shape of shapes) {
    uniqueByKey.set(canonicalKey(shape), shape);
  }
  if (uniqueByKey.size === 1) {
    return shapes[0];
  }
  const variants = [...uniqueByKey.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, shape]) => shape);
  return { type: "mixed", variants };
}

/**
 * Heuristic guard against object KEY NAMES that are themselves user data rather than a
 * static schema field name a developer hand-typed (see the "never raw values" CAVEAT
 * on `deriveShape` below). This is not a hypothetical future-route backstop: at least
 * two routes in this codebase already return exactly this pattern —
 * `server/routes/grocery.ts` (`allergenFlags` keyed by grocery-item name) and
 * `server/services/menu-analysis.ts` (`allergenFlags` keyed by menu-item name), both
 * flagging which specific foods trigger a user's allergies. Free-text item names like
 * "shrimp" match none of the DYNAMIC_KEY_PATTERNS below and a shopping/menu list
 * rarely crosses MAX_STATIC_OBJECT_KEYS, so `looksDynamicallyKeyed` alone does not
 * catch them — see `hasUniformNonPrimitiveValueShape` below, the second, independent
 * signal added specifically to close that gap. This function deliberately trades some
 * false positives/negatives for never requiring per-route configuration (an allowlist
 * of expected keys per route pattern was considered and rejected: `deriveShape` itself
 * is a pure function with no route context, and while its sole caller —
 * `recordSnapshot` in server/lib/contract-snapshot.ts — does have route context
 * available, wiring a per-route allowlist through that one call site would still make
 * the allowlist a second, drift-prone place to update on every response shape change
 * across the ~45 route modules in this app, a maintenance cost judged not worth
 * trading for the heuristic's occasional over/under-redaction).
 *
 *   - MAX_STATIC_OBJECT_KEYS (50): a real static schema (deliberately named fields)
 *     essentially never has this many keys at one nesting level; a genuine dynamic-key
 *     leak (one entry per user/row) typically has far more. Kept generous so a
 *     legitimately large-but-static object (a wide settings/feature-flag bag) is NOT
 *     over-redacted, since over-redaction silently degrades the diff tool's
 *     field-level usefulness for that route.
 *   - DYNAMIC_KEY_PATTERNS: keys that look like an email, a UUID, or a long numeric id
 *     are values an application developer would essentially never choose as a
 *     hand-typed field name. Any key longer than MAX_KEY_LENGTH_FOR_PATTERN_CHECK
 *     skips straight to "dynamic" without running the patterns at all — both a cheap
 *     defense against pathological input on the request-handling path (`deriveShape`
 *     runs inline before the DB write, per server/lib/contract-snapshot.ts) and a
 *     reasonable prior, since no real static field name approaches that length.
 *   - FALSE NEGATIVE (closed for the two known routes via a producer marker, see
 *     `deriveForcedDynamicShape` below — residual only for an unmarked route): a
 *     dynamic-keyed object with fewer than MIN_UNIFORM_MAP_KEYS entries whose key(s)
 *     also don't match a DYNAMIC_KEY_PATTERN (e.g. a response with exactly one
 *     flagged allergen item) is not caught by either heuristic signal alone — this
 *     is COMMON, not a rare edge case: a user with exactly one matching allergen on a
 *     grocery/menu list is an ordinary real-world scenario for
 *     server/routes/grocery.ts and server/services/menu-analysis.ts, not a corner
 *     case. Both routes call `markDynamicKeyFields` (server/lib/dynamic-key-fields.ts)
 *     to force-redact `allergenFlags` deterministically regardless of entry count, so
 *     this gap is closed for them; a future, not-yet-marked route with the same
 *     free-text-keyed shape would still fall through to this heuristic alone.
 */
const MAX_STATIC_OBJECT_KEYS = 50;
const MAX_KEY_LENGTH_FOR_PATTERN_CHECK = 200;

const DYNAMIC_KEY_PATTERNS: RegExp[] = [
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/, // email — mirrors client/components/ChangeEmailModal.tsx's EMAIL_RE
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, // UUID
  /^\d{4,}$/, // long numeric id (barcode, row id, etc.) — unlikely as a hand-typed field name
];

function looksDynamicallyKeyed(keys: string[]): boolean {
  return (
    keys.length > MAX_STATIC_OBJECT_KEYS ||
    keys.some(
      (key) =>
        key.length > MAX_KEY_LENGTH_FOR_PATTERN_CHECK ||
        DYNAMIC_KEY_PATTERNS.some((pattern) => pattern.test(key)),
    )
  );
}

/**
 * Second, independent dynamic-key signal: an object whose values ALL derive to the
 * exact same non-primitive (object/array) shape looks like a dictionary keyed by
 * dynamic data (a name, an id, ...), not a hand-named static record — this is what
 * actually catches `allergenFlags`-style objects (see `looksDynamicallyKeyed` above),
 * since their key names are ordinary free text. `mergeShapes` only collapses to a
 * single non-`mixed` shape when every value is BYTE-IDENTICAL in structure (same
 * nested key names and types), so two legitimately different static object fields
 * (e.g. `user: {...}` and `address: {...}` with different internal keys) will
 * usually NOT trigger this — only genuine "N records, all the same shape" data does.
 * CAVEAT: this is structural, not semantic — two coincidentally same-shaped but
 * unrelated static fields (e.g. `tags: string[]` and `categories: string[]`, or two
 * static object fields that happen to share identical nested keys) ALSO collapse to
 * `<dynamic>`. That's an intentional over-redaction / false-positive tradeoff, not a
 * bug: it costs the diff tool some field-level granularity on that route, but never
 * causes a leak (see `contract-shape.test.ts`'s "DOES redact two static array-typed
 * fields..." test for a pinned example).
 *
 * FALSE NEGATIVE (closed for the two known routes via a producer marker, distinct
 * from the single-entry gap above): a dynamic-keyed object whose
 * values are all PRIMITIVE (e.g. `{ shrimp: "high", peanuts: "severe" }` — a
 * plausible simplification of `allergenFlags` from `Record<string, {allergenId,
 * severity}>` to `Record<string, AllergySeverity>`) is caught by NEITHER heuristic
 * signal for object sizes in the 2-50 entry range — bounded above by
 * MAX_STATIC_OBJECT_KEYS (the 1-entry case is the separately documented
 * single-entry gap above, not this signal's doing), not unbounded at any entry
 * count: past 50 entries, `looksDynamicallyKeyed`'s key-count check fires
 * independently of value type, so a larger all-primitive-valued object is still
 * redacted by that signal alone. Primitives are deliberately excluded from
 * `hasUniformNonPrimitiveValueShape` precisely because they collide too often in
 * legitimate static records (`{ width: 100, height: 50 }`, `{ r, g, b }`) to use as a
 * uniformity signal. Not live in this
 * codebase today (no `Record<string, primitive>` response-shaped value exists as of
 * this writing), but a future refactor to that shape at `allergenFlags` would still
 * be caught, since `deriveForcedDynamicShape` below redacts a marked field's value
 * regardless of whether its entries are primitive or non-primitive — only a
 * not-yet-marked route reintroducing this shape elsewhere remains exposed.
 *
 * Requires >= MIN_UNIFORM_MAP_KEYS entries: a single key trivially "matches itself,"
 * so a 1-entry check would redact virtually every nested single-field object in the
 * app. A dynamic-keyed map with exactly one live entry is not caught by this signal
 * (documented residual risk, same class noted in `looksDynamicallyKeyed` above).
 *
 * Takes the already-merged shape rather than computing it internally — the caller
 * (deriveShape) needs `mergeShapes(valueShapes)` either way when the object turns out
 * dynamic (as the `<dynamic>` placeholder's value shape), so it merges once and passes
 * the result in here rather than merging twice for the same input.
 */
const MIN_UNIFORM_MAP_KEYS = 2;

function hasUniformNonPrimitiveValueShape(
  valueShapes: Shape[],
  merged: Shape,
): boolean {
  return (
    valueShapes.length >= MIN_UNIFORM_MAP_KEYS &&
    (merged.type === "object" || merged.type === "array")
  );
}

/** Placeholder key used in place of a dynamically-keyed object's real key names. */
const DYNAMIC_KEY_PLACEHOLDER = "<dynamic>";

/** No producer has marked any field as forced-dynamic — the default for every
 *  `deriveShape` call that doesn't pass `forcedDynamicKeys` explicitly (all of
 *  today's callers except `recordSnapshot`). Shared, not reallocated per call,
 *  since it's never mutated. */
const NO_FORCED_DYNAMIC_KEYS: ReadonlySet<string> = new Set();

/**
 * Force-redact a single response-body field known — via a producer's explicit
 * `markDynamicKeyFields` call, see server/lib/dynamic-key-fields.ts — to be a
 * dynamically-keyed map, bypassing both heuristic signals above entirely. This is
 * what closes the two residual gaps neither heuristic catches alone: a map with
 * only one entry (`looksDynamicallyKeyed`'s key-shape/count checks don't fire, and
 * `hasUniformNonPrimitiveValueShape` requires >= MIN_UNIFORM_MAP_KEYS), and a map
 * whose values are all primitive (`hasUniformNonPrimitiveValueShape` only fires on
 * object/array values, by design — see its doc comment above). Deterministic for a
 * MARKED field at ANY entry count and ANY value shape — the only accepted gap is a
 * route that never calls the marker for a new dynamically-keyed field (see
 * dynamic-key-fields.ts's "RESIDUAL RISK"), not this function's own coverage.
 *
 * Falls back to plain `deriveShape` when the marked field's actual value isn't
 * itself a plain object (e.g. absent, null, or — in a future refactor — a
 * differently-shaped value) so a stale/misapplied marker degrades gracefully
 * rather than throwing or silently mis-redacting an unrelated value.
 *
 * Forwards `forcedDynamicKeys` into both of its own recursive `deriveShape`
 * calls — a second marked field name nested inside this field's values (e.g.
 * `markDynamicKeyFields(res, ["allergenFlags", "otherDynamicField"])` where
 * `otherDynamicField` sits inside one of `allergenFlags`'s entries) must still
 * be force-redacted, not silently fall back to the heuristics alone just
 * because it's nested under an already-forced key.
 */
function deriveForcedDynamicShape(
  value: unknown,
  forcedDynamicKeys: ReadonlySet<string>,
): Shape {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return deriveShape(value, forcedDynamicKeys);
  }
  const objValue = value as Record<string, unknown>;
  const keys = Object.keys(objValue);
  if (keys.length === 0) return { type: "object", keys: {} };

  const valueShapes = keys
    .sort()
    .map((key) => deriveShape(objValue[key], forcedDynamicKeys));
  return {
    type: "object",
    keys: { [DYNAMIC_KEY_PLACEHOLDER]: mergeShapes(valueShapes) },
  };
}

/**
 * Derive a deterministic structural skeleton from a JSON-serializable value.
 *
 * Callers deriving a shape from an Express response body should first round-trip the
 * body through `JSON.parse(JSON.stringify(body))` so the shape reflects the actual
 * wire payload (drops `undefined` fields, serializes `Date`s to strings, etc.) rather
 * than the in-memory object shape — see server/lib/contract-snapshot.ts.
 *
 * @param forcedDynamicKeys — top-level-or-nested key NAMES (matched wherever they
 * appear in the value tree, not scoped to a specific JSON path) whose value is always
 * treated as a dynamically-keyed map and force-redacted via `deriveForcedDynamicShape`,
 * regardless of entry count or value primitiveness. Matching by bare name rather than
 * path means an unrelated field that happens to share a marked name would also be
 * force-redacted — accepted because it only ever over-redacts (costs that one field's
 * diff granularity), never under-redacts, and today's two marked routes each have
 * exactly one field with the marked name in their response tree. Populated from a
 * producer's `markDynamicKeyFields` call — see server/lib/dynamic-key-fields.ts — and
 * passed through by `recordSnapshot` in contract-snapshot.ts. Defaults to empty, so
 * every existing caller that doesn't pass
 * it behaves exactly as before this parameter was added.
 *
 * CAVEAT: object KEY NAMES are stored verbatim for a normal, statically-shaped object
 * (only values are discarded) — see `looksDynamicallyKeyed` and
 * `hasUniformNonPrimitiveValueShape` above for the two independent, defense-in-depth
 * heuristic signals that redact a dynamically-keyed object's key names before storage
 * (e.g. `{ [userEmail]: ... }`, or the live `allergenFlags` shape documented on
 * `looksDynamicallyKeyed`), and `deriveForcedDynamicShape` above for the deterministic,
 * marker-driven closure of those heuristics' two residual gaps for the two known
 * marked routes (server/routes/grocery.ts, server/routes/menu.ts). A route that
 * introduces a NEW dynamically-keyed field without calling `markDynamicKeyFields`
 * still relies on the heuristics alone, and so still carries their residual gaps:
 * (1) a dynamic-keyed object with fewer than MIN_UNIFORM_MAP_KEYS entries whose
 * key(s) also don't match a DYNAMIC_KEY_PATTERN, and (2) a dynamic-keyed object
 * whose values are all PRIMITIVE, for object sizes in the 2-50 entry range (bounded
 * by MAX_STATIC_OBJECT_KEYS — see `hasUniformNonPrimitiveValueShape` above).
 */
export function deriveShape(
  value: unknown,
  forcedDynamicKeys: ReadonlySet<string> = NO_FORCED_DYNAMIC_KEYS,
): Shape {
  if (value === null || value === undefined) return { type: "null" };

  if (Array.isArray(value)) {
    if (value.length === 0) return { type: "array", items: null };

    const elementShapes = value.map((element) =>
      deriveShape(element, forcedDynamicKeys),
    );
    return { type: "array", items: mergeShapes(elementShapes) };
  }

  switch (typeof value) {
    case "string":
      return { type: "string" };
    case "number":
      return { type: "number" };
    case "boolean":
      return { type: "boolean" };
    case "object": {
      const objValue = value as Record<string, unknown>;
      const sortedKeys = Object.keys(objValue).sort();
      const valueShapes = sortedKeys.map((key) =>
        forcedDynamicKeys.has(key)
          ? deriveForcedDynamicShape(objValue[key], forcedDynamicKeys)
          : deriveShape(objValue[key], forcedDynamicKeys),
      );
      const mergedValueShape = mergeShapes(valueShapes);

      if (
        looksDynamicallyKeyed(sortedKeys) ||
        hasUniformNonPrimitiveValueShape(valueShapes, mergedValueShape)
      ) {
        return {
          type: "object",
          keys: { [DYNAMIC_KEY_PLACEHOLDER]: mergedValueShape },
        };
      }

      // Object.fromEntries (not `keys[key] = ...` bracket assignment) so a literal
      // "__proto__" key becomes a real own property instead of silently invoking
      // Object.prototype's legacy __proto__ setter and vanishing from the shape.
      const keys: Record<string, Shape> = Object.fromEntries(
        sortedKeys.map((key, i) => [key, valueShapes[i]] as const),
      );
      return { type: "object", keys };
    }
    default:
      // function/symbol/bigint — none of these survive JSON.stringify in a real
      // response body; treat defensively as an opaque, valueless leaf.
      return { type: "null" };
  }
}

export interface RouteShapeDiff {
  added: string[];
  removed: string[];
  retyped: string[];
}

/**
 * Unwrap a shape down to the nearest level with named object keys, following through
 * any wrapping arrays (e.g. a route that returns a bare JSON array of objects). Returns
 * null when no key-level comparison is possible (a primitive/null root, an empty
 * array with no observed element shape, or a `mixed`-typed array).
 */
function unwrapToKeys(shape: Shape): Record<string, Shape> | null {
  let current = shape;
  // Bounded: each iteration strictly unwraps one array layer, and deriveShape never
  // produces a self-referential Shape, so this always terminates.
  while (current.type === "array") {
    if (!current.items) return null;
    current = current.items;
  }
  return current.type === "object" ? current.keys : null;
}

/** True when a shape's key set is exactly the redaction placeholder — i.e. deriveShape
 *  collapsed a dynamically-keyed object to `{ "<dynamic>": <mergedValueShape> }`. */
function isRedactedKeySet(keys: Record<string, Shape>): boolean {
  const names = Object.keys(keys);
  return names.length === 1 && names[0] === DYNAMIC_KEY_PLACEHOLDER;
}

/**
 * Diff two shapes recorded for the same (route_pattern, method, status) across
 * branches. When a key-level comparison isn't possible (primitive/mixed root shapes),
 * falls back to reporting a single `<root>` entry in `retyped` if the shapes differ at
 * all — never silently reports "no difference" for an unwrappable shape change.
 */
export function diffRouteShapes(base: Shape, feature: Shape): RouteShapeDiff {
  const baseKeys = unwrapToKeys(base);
  const featureKeys = unwrapToKeys(feature);

  if (!baseKeys || !featureKeys) {
    const retyped =
      canonicalKey(base) === canonicalKey(feature) ? [] : ["<root>"];
    return { added: [], removed: [], retyped };
  }

  // One side redacted to <dynamic>, the other still holds real key names — an old
  // pre-#544 snapshot diffed against a post-#544 one for the same route. Emitting the
  // raw key names here would reprint the exact dynamic keys (emails, item names) that
  // #544 redacts. But that key-set asymmetry alone doesn't prove this IS a #544
  // migration: a route can also genuinely change from a static object to an unrelated
  // dynamic map (or vice versa), which the per-key loop below must still catch. So only
  // intercept when the non-redacted side's real keys would themselves have been
  // redacted by deriveShape today (the same two signals deriveShape itself uses) —
  // otherwise fall through and let the normal loop report the real, safe key names.
  const baseRedacted = isRedactedKeySet(baseKeys);
  const featureRedacted = isRedactedKeySet(featureKeys);
  if (baseRedacted !== featureRedacted) {
    const realKeys = baseRedacted ? featureKeys : baseKeys;
    const realKeyNames = Object.keys(realKeys);
    const realValueShapes = Object.values(realKeys);
    const realMergedValue = mergeShapes(realValueShapes);
    const realSideLooksDynamic =
      looksDynamicallyKeyed(realKeyNames) ||
      hasUniformNonPrimitiveValueShape(realValueShapes, realMergedValue);

    if (realSideLooksDynamic) {
      const baseValue = baseRedacted
        ? baseKeys[DYNAMIC_KEY_PLACEHOLDER]
        : realMergedValue;
      const featureValue = featureRedacted
        ? featureKeys[DYNAMIC_KEY_PLACEHOLDER]
        : realMergedValue;
      const retyped =
        canonicalKey(baseValue) === canonicalKey(featureValue)
          ? []
          : [DYNAMIC_KEY_PLACEHOLDER];
      return { added: [], removed: [], retyped };
    }
    // else: the non-redacted side doesn't actually look dynamic, so this isn't a
    // #544-migration case — fall through to the normal per-key loop below.
  }

  const added: string[] = [];
  const retyped: string[] = [];
  for (const key of Object.keys(featureKeys)) {
    if (!Object.prototype.hasOwnProperty.call(baseKeys, key)) {
      added.push(key);
    } else if (canonicalKey(baseKeys[key]) !== canonicalKey(featureKeys[key])) {
      retyped.push(key);
    }
  }

  const removed = Object.keys(baseKeys).filter(
    (key) => !Object.prototype.hasOwnProperty.call(featureKeys, key),
  );

  return {
    added: added.sort(),
    removed: removed.sort(),
    retyped: retyped.sort(),
  };
}
