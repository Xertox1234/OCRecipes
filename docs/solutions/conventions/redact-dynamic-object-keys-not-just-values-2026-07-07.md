---
title: "Structural shape derivation must redact dynamically-keyed objects, not just discard values"
track: knowledge
category: conventions
tags: [security, server, redaction, pii, structural-shape, contract-snapshot]
module: server
applies_to: [server/lib/contract-shape.ts]
created: '2026-07-07'
---

# Structural shape derivation must redact dynamically-keyed objects, not just discard values

## Rule

When deriving a structural "shape"/"skeleton" from JSON data for storage, diffing, or
logging — discarding VALUES to avoid persisting sensitive data — object KEY NAMES must
also be checked. A dynamically-keyed object (e.g. `{ [userEmail]: ... }`, `{
[itemName]: ... }`) leaks its key strings verbatim even though "only values are
discarded," because a dynamic key is structurally indistinguishable from a static
schema field name. "We never store values" is not the same guarantee as "we never
store user data" if key names can also be user data.

Use **two independent signals**, because either alone misses common real-world cases:

1. **Key-shape pattern/count matching** — identifier-shaped keys (email, UUID, long
   numeric id) via regex, plus a max-key-count threshold. Catches identifier-shaped
   dynamic keys regardless of object size, but misses ordinary free-text dynamic keys
   (an item/ingredient/tag name) entirely — free text matches no identifier pattern.
2. **Uniform non-primitive value-shape detection** — if an object has >= 2 keys and
   every value derives to the exact same non-primitive (object/array) structural
   shape, treat it as a dynamically-keyed map regardless of what the keys look like.
   This is what actually catches free-text-keyed maps: "N records, all the same
   shape" is the defining structural characteristic of dynamically-keyed data,
   independent of key content. Exclude primitive value shapes (string/number/boolean)
   from this signal — they collide constantly in legitimate static records (`{
   width, height }`, `{ r, g, b }`) and would make the signal over-redact common,
   harmless static shapes.

## When this applies

Any code deriving a value-stripped structural skeleton of JSON API responses (or
similar untrusted/sensitive data) for storage, diffing, or logging, where "never leak
raw values" is the stated invariant.

## Smell patterns

- A doc comment justifying a missing defense with "no current route does this" as the
  *sole* evidence — verify empirically (grep the actual route/service code) rather
  than trusting the claim. See Related Files below for a case where this exact claim
  was wrong: the guard shipped with that comment, and a second-opinion review found
  two live routes returning exactly the pattern it claimed didn't exist.
- A key-leak heuristic that only inspects key STRINGS (regex/length/count) without
  also inspecting whether the VALUES across keys are structurally uniform. Free-text
  dynamic keys will slip through a key-only heuristic every time.

## Why

A key-name-only heuristic is necessary but not sufficient: dynamically-keyed data in
real application code is frequently keyed by ordinary free text (an ingredient name, a
menu-item name, a tag) rather than an email/UUID/numeric id, and a realistic instance
of this (e.g. a per-item flag map) often stays well under any "too many keys" count
threshold too. The uniform-value-shape signal closes this gap precisely because it
doesn't care what the keys look like — it detects "a dictionary of N same-shaped
records," the actual defining trait of dynamically-keyed data.

## Examples

```typescript
// Two independent signals feeding the same redaction decision:

function looksDynamicallyKeyed(keys: string[]): boolean {
  return (
    keys.length > MAX_STATIC_OBJECT_KEYS ||
    keys.some((key) => DYNAMIC_KEY_PATTERNS.some((p) => p.test(key)))
  );
}

function hasUniformNonPrimitiveValueShape(valueShapes: Shape[]): boolean {
  if (valueShapes.length < MIN_UNIFORM_MAP_KEYS) return false;
  // mergeShapes collapses to a single shape ONLY when every input is
  // byte-identical in structure -- two different static fields that happen to
  // both be objects, but with different internal keys, do NOT collapse.
  const merged = mergeShapes(valueShapes);
  return merged.type === "object" || merged.type === "array";
}

// Redact when EITHER signal fires:
if (looksDynamicallyKeyed(keys) || hasUniformNonPrimitiveValueShape(valueShapes)) {
  return { type: "object", keys: { "<dynamic>": mergeShapes(valueShapes) } };
}
```

Real-world case that motivated this rule: `server/routes/grocery.ts` and
`server/services/menu-analysis.ts` both return `allergenFlags: Record<string, {
allergenId, severity }>` keyed by free-text food-item name (e.g. `{ shrimp: {...},
"peanut butter": {...} }`), flagging which foods trigger a user's allergies —
health-adjacent, sensitive data. Key-pattern matching alone missed it: item names
aren't emails/UUIDs/numeric ids, and a realistic grocery/menu list stays well under a
50-key threshold. The uniform-value-shape signal catches it because every entry
shares the identical `{ allergenId, severity }` shape.

## Exceptions

- **Primitive-valued uniform maps** (e.g. `{ [itemName]: severityString }`) are NOT
  caught by the uniform-value-shape signal, by design — primitive types collide too
  often in legitimate static records to use as a redaction signal without an
  unacceptable false-positive rate. If your domain has (or could plausibly refactor
  into) a primitive-valued dynamic map, this convention alone is insufficient — extend
  the signal deliberately with its own threshold/false-positive analysis; don't bolt
  it on as an afterthought.
- A dynamically-keyed map with fewer than ~2 live entries, whose key(s) also don't
  match an identifier pattern, is not caught by either signal.
- Both gaps above should be documented explicitly in code comments, with a concrete
  example and an honest assessment of how common (not just "theoretically possible")
  the gap is in your actual route surface — an inaccurate "this covers it" comment is
  worse than an accurate "this is a known, common gap" comment, because the former
  gets trusted at face value and never re-derived by the next reader.
- This is a heuristic, not a proof. If the route surface is small and stable enough to
  enumerate, an explicit allowlist of expected response-key shapes per route is a more
  robust (if more maintenance-heavy) alternative — evaluate this tradeoff per project
  rather than defaulting to heuristics everywhere.

## Related Files

- `server/lib/contract-shape.ts` — `deriveShape()`, `looksDynamicallyKeyed()`,
  `hasUniformNonPrimitiveValueShape()`, `mergeShapes()`
- `server/routes/grocery.ts` — the live `allergenFlags` case that motivated the second
  signal
- `server/services/menu-analysis.ts` — second live instance of the same shape

## See Also

- [A database-name denylist parsed by naive string-slicing is bypassed by a connection-string query string](../logic-errors/denylist-bypassed-by-connection-string-query-string-2026-07-06.md) — a different finding in the same `server/lib/contract-snapshot.ts` module family
