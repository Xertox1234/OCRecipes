---
title: "Structural shape derivation must redact dynamically-keyed objects, not just discard values"
track: knowledge
category: conventions
tags: [security, server, redaction, pii, structural-shape, contract-snapshot]
module: server
applies_to: [server/lib/contract-shape.ts]
created: '2026-07-07'
last_updated: '2026-07-09'
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

## Update (2026-07-08): a producer-side marker closes both gaps for known routes

The two gaps above are common enough (a single flagged allergen is the *ordinary*
case, not the edge case) that they warranted closing, not just documenting. Rather
than a per-route allowlist of *expected* keys (rejected above for its maintenance
cost across ~45 route modules), the fix is a producer-side marker: the two known
dynamically-keyed-map producers (`server/routes/grocery.ts`,
`server/routes/menu.ts`) call `markDynamicKeyFields(res, ["allergenFlags"])`
immediately before their `res.json(...)`, right next to the code that builds the
map. `deriveShape()` gained an optional `forcedDynamicKeys` parameter that
force-redacts a marked field deterministically, at any entry count and any value
shape — closing both gaps for these two routes.

Two design choices made this work without compromising the module's other
invariants:

1. **The marker lives on `res.locals`, never on the response body.** The body
   passed to `res.json(...)` is what actually reaches the client — a marker
   embedded in it would leak into the real API contract. `res.locals` is
   Express-only per-request state, never serialized to the wire, and — critically
   — untouched by `recordSnapshot`'s `JSON.parse(JSON.stringify(body))`
   normalization (a marker attached directly to `body`, e.g. a non-enumerable
   property, would be silently stripped by that round-trip).
2. **The marker mechanism lives in its own tiny module**
   (`server/lib/dynamic-key-fields.ts`), not in `contract-snapshot.ts`. A route
   file marking its own response doesn't need to import that module's dev/lab-only
   dependencies (`pg`, git-branch reading, the lab-DB pool) just to call one
   function — and `contract-shape.ts` itself stays Express-agnostic (its new
   parameter is a plain `ReadonlySet<string>`, no `Response` import).

**This is still a hand-maintained list, and therefore still fail-open** — the same
shape as the allowlist-is-a-denylist pattern this project has separately learned to
watch for (see See Also below). A future route that returns a new free-text-keyed
dynamic map and forgets to call `markDynamicKeyFields` falls back to the two
heuristics alone, with their original two gaps intact. This was accepted
deliberately, not overlooked, because the residual surface is narrow: an
identifier-shaped key (email/UUID/long numeric id) or a >=2-entry non-primitive
map still trips the heuristics regardless of marking, so the only unmarked-route
leak path left is a free-text-keyed map that is *also* single-entry-or-all-primitive
— a materially narrower combination than "any dynamic key" (the pre-#544 exposure).
Automating this further (e.g. statically verifying every dynamically-keyed response
field is marked) was judged not worth it for two producers; revisit if a third
distinct dynamically-keyed field is added without going through this convention.

**Correction (2026-07-08, same day, found in an ultrareview of the PR that shipped
the above):** the marker mechanism's own `deriveForcedDynamicShape` helper had a
recursion bug — its internal recursive calls didn't forward `forcedDynamicKeys`,
so a *second* marked field nested inside a first marked field's values silently
lost its forcing and fell back to the heuristics alone. Not reachable by either
of the two producers above (neither nests a second marked field), but real and
untested. Fixed same-day; see
[A special-cased recursive helper must forward the same context parameter as the general-case recursion](../logic-errors/forced-recursion-branch-drops-forwarded-context-2026-07-08.md)
for the full writeup. Left as a deferred, not-yet-actioned finding from that same
review: `server/lib/dynamic-key-fields.ts`'s `res.locals`-based marker duplicates
`server/lib/request-context.ts`'s existing AsyncLocalStorage per-request context
mechanism — tracked in `todos/P3-2026-07-08-dynamic-key-fields-reinvents-request-context.md`.

## Update (2026-07-09): a diagnostic/telemetry walk over the shape tree must also stop at the redaction boundary

A follow-up todo added dev-mode telemetry (`hasUnredactedUniformPrimitiveObject` in `server/lib/contract-shape.ts`, wired into `recordSnapshot` in `server/lib/contract-snapshot.ts`) to flag, for manual triage, a plain (non-redacted) object with >= 2 keys whose values are all the same primitive type -- the closest cheap observable proxy for the all-primitive-valued dynamic-map gap documented above.

The first implementation recursed into every object node in an already-derived Shape tree, INCLUDING the merged value shape nested under a correctly-redacted `<dynamic>` placeholder. For the real `allergenFlags` shape (entries shaped `{ allergenId: string, severity: string }`), that nested value shape is itself a 2-key, same-typed-string object -- so the new telemetry fired a false 'was NOT redacted' signal on essentially every response with >= 1 flagged allergen, on exactly the two live routes (`grocery.ts`, `menu.ts`) the whole redaction mechanism exists to protect. This carries zero leak-detection value: the placeholder's own real (sensitive) keys are already hidden, and the nested field names are ordinary, already-classified static schema names, not user data.

Fixed by pruning recursion at the redaction-placeholder boundary: treat any `{ "<dynamic>": ... }` node as opaque and do not descend into it. Verified empirically against the real `allergenFlags` production shape before and after the fix.

**Rule for future consumers**: any downstream code that inspects an already-derived Shape tree for its own purpose (diffing, telemetry, counting, redaction-adjacent auditing, etc.) must independently know to treat the `<dynamic>` placeholder as an opaque leaf, not just a normal object node. This is the second distinct bug class in this module caused by a consumer failing to special-case the placeholder (the first is documented in the diffRouteShapes finding linked below) -- the placeholder's 'opaque past this point' contract is easy to violate in a NEW piece of code that doesn't reuse either existing example.

## Related Files

- `server/lib/contract-shape.ts` — `deriveShape()`, `looksDynamicallyKeyed()`,
  `hasUniformNonPrimitiveValueShape()`, `deriveForcedDynamicShape()`,
  `mergeShapes()`
- `server/lib/contract-shape.ts` — `hasUnredactedUniformPrimitiveObject()`, the new telemetry proxy and its `<dynamic>`-placeholder pruning guard.
- `server/lib/dynamic-key-fields.ts` — `markDynamicKeyFields()` /
  `readDynamicKeyFields()`, the producer-marker mechanism from the 2026-07-08
  update above
- `server/routes/grocery.ts` — the live `allergenFlags` case that motivated the
  second signal, now also a marked producer
- `server/services/menu-analysis.ts` / `server/routes/menu.ts` — second live
  instance of the same shape; `menu.ts` is the marked producer (the service
  function itself has no `res` to mark with)

## See Also

- [A database-name denylist parsed by naive string-slicing is bypassed by a connection-string query string](../logic-errors/denylist-bypassed-by-connection-string-query-string-2026-07-06.md) — a different finding in the same `server/lib/contract-snapshot.ts` module family
- [Widening an allowlist root turns it into a hand-maintained denylist that fails open](../best-practices/widening-allowlist-root-creates-hand-maintained-denylist-2026-07-08.md) — the general pattern this doc's 2026-07-08 update's `markDynamicKeyFields` residual is an instance of: any hand-maintained "which fields/paths are special" list is fail-open by construction; the mitigation here is narrowing the residual surface (see the update above), not eliminating the list
- [A diff guard that intercepts on "one side looks redacted" must also confirm the other side would actually BE redacted, or it silently swallows real changes](../logic-errors/redaction-diff-intercept-must-validate-both-sides-not-just-asymmetry-2026-07-08.md) — the sibling instance of the same 'a Shape-tree consumer must specially handle the <dynamic> placeholder' class of bug, in diffRouteShapes rather than in a telemetry walk.
