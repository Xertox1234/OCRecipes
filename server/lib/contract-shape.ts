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
 *   - FALSE NEGATIVE (accepted, see the todo's Risks section): a dynamic-keyed object
 *     with fewer than MIN_UNIFORM_MAP_KEYS entries whose key(s) also don't match a
 *     DYNAMIC_KEY_PATTERN (e.g. a response with exactly one flagged allergen item) is
 *     not caught by either signal — an exhaustive detector isn't attempted here. This
 *     is COMMON, not a rare edge case: a user with exactly one matching allergen on a
 *     grocery/menu list is an ordinary real-world scenario for
 *     server/routes/grocery.ts and server/services/menu-analysis.ts, not a corner
 *     case — treat this gap as routinely reachable in normal dev use of
 *     CONTRACT_SNAPSHOT=1, not as a hypothetical.
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
 * FALSE NEGATIVE (accepted, distinct from and broader than the single-entry gap
 * above): a dynamic-keyed object whose values are all PRIMITIVE (e.g. `{ shrimp:
 * "high", peanuts: "severe" }` — a plausible simplification of `allergenFlags` from
 * `Record<string, {allergenId, severity}>` to `Record<string, AllergySeverity>`) is
 * caught by NEITHER signal, at ANY entry count — primitives are deliberately excluded
 * above precisely because they collide too often in legitimate static records
 * (`{ width: 100, height: 50 }`, `{ r, g, b }`) to use as a uniformity signal. Not
 * live in this codebase today (no `Record<string, primitive>` response-shaped value
 * exists as of this writing), but a real gap, not merely theoretical — a future
 * refactor could reintroduce it silently, since neither signal would fire on it.
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

/**
 * Derive a deterministic structural skeleton from a JSON-serializable value.
 *
 * Callers deriving a shape from an Express response body should first round-trip the
 * body through `JSON.parse(JSON.stringify(body))` so the shape reflects the actual
 * wire payload (drops `undefined` fields, serializes `Date`s to strings, etc.) rather
 * than the in-memory object shape — see server/lib/contract-snapshot.ts.
 *
 * CAVEAT: object KEY NAMES are stored verbatim for a normal, statically-shaped object
 * (only values are discarded) — see `looksDynamicallyKeyed` and
 * `hasUniformNonPrimitiveValueShape` above for the two independent, defense-in-depth
 * signals that redact a dynamically-keyed object's key names before storage (e.g. `{
 * [userEmail]: ... }`, or the live `allergenFlags` shape documented on
 * `looksDynamicallyKeyed`). Both are heuristics, not a proof — two accepted residual
 * gaps, both documented in detail on `hasUniformNonPrimitiveValueShape` above: (1) a
 * dynamic-keyed object with fewer than MIN_UNIFORM_MAP_KEYS entries whose key(s) also
 * don't match a DYNAMIC_KEY_PATTERN (COMMON in this app, not rare — see that
 * comment), and (2) a dynamic-keyed object whose values are all PRIMITIVE (not caught
 * at any entry count — not live today, but a real, not merely theoretical, gap).
 */
export function deriveShape(value: unknown): Shape {
  if (value === null || value === undefined) return { type: "null" };

  if (Array.isArray(value)) {
    if (value.length === 0) return { type: "array", items: null };

    const elementShapes = value.map(deriveShape);
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
      const valueShapes = sortedKeys.map((key) => deriveShape(objValue[key]));
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
  // #544 redacts. Collapse to a single <dynamic> comparison: reconstruct what post-#544
  // code would have stored for the unredacted side (mergeShapes of its values) and
  // compare value shapes only — never surface the real names.
  const baseRedacted = isRedactedKeySet(baseKeys);
  const featureRedacted = isRedactedKeySet(featureKeys);
  if (baseRedacted !== featureRedacted) {
    const baseValue = baseRedacted
      ? baseKeys[DYNAMIC_KEY_PLACEHOLDER]
      : mergeShapes(Object.values(baseKeys));
    const featureValue = featureRedacted
      ? featureKeys[DYNAMIC_KEY_PLACEHOLDER]
      : mergeShapes(Object.values(featureKeys));
    const retyped =
      canonicalKey(baseValue) === canonicalKey(featureValue)
        ? []
        : [DYNAMIC_KEY_PLACEHOLDER];
    return { added: [], removed: [], retyped };
  }

  const added: string[] = [];
  const retyped: string[] = [];
  for (const key of Object.keys(featureKeys)) {
    if (!(key in baseKeys)) {
      added.push(key);
    } else if (canonicalKey(baseKeys[key]) !== canonicalKey(featureKeys[key])) {
      retyped.push(key);
    }
  }

  const removed = Object.keys(baseKeys).filter((key) => !(key in featureKeys));

  return {
    added: added.sort(),
    removed: removed.sort(),
    retyped: retyped.sort(),
  };
}
