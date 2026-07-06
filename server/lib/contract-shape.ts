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
 * Derive a deterministic structural skeleton from a JSON-serializable value.
 *
 * Callers deriving a shape from an Express response body should first round-trip the
 * body through `JSON.parse(JSON.stringify(body))` so the shape reflects the actual
 * wire payload (drops `undefined` fields, serializes `Date`s to strings, etc.) rather
 * than the in-memory object shape — see server/lib/contract-snapshot.ts.
 *
 * CAVEAT: object KEY NAMES are stored verbatim (only values are discarded). No current
 * route in this codebase returns a response object dynamically keyed by user data
 * (e.g. `{ [userEmail]: ... }`), but if one ever did, its key names would leak into the
 * stored shape despite the "never raw values" invariant — this function has no defense
 * against that, since a dynamic key is structurally indistinguishable from a static one.
 */
export function deriveShape(value: unknown): Shape {
  if (value === null || value === undefined) return { type: "null" };

  if (Array.isArray(value)) {
    if (value.length === 0) return { type: "array", items: null };

    const elementShapes = value.map(deriveShape);
    const uniqueByKey = new Map<string, Shape>();
    for (const shape of elementShapes) {
      uniqueByKey.set(canonicalKey(shape), shape);
    }

    if (uniqueByKey.size === 1) {
      return { type: "array", items: elementShapes[0] };
    }

    const variants = [...uniqueByKey.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, shape]) => shape);
    return { type: "array", items: { type: "mixed", variants } };
  }

  switch (typeof value) {
    case "string":
      return { type: "string" };
    case "number":
      return { type: "number" };
    case "boolean":
      return { type: "boolean" };
    case "object": {
      const keys: Record<string, Shape> = {};
      for (const key of Object.keys(value as Record<string, unknown>).sort()) {
        keys[key] = deriveShape((value as Record<string, unknown>)[key]);
      }
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
