---
title: A special-cased recursive helper must forward the same context parameter as the general-case recursion, or the override silently stops one level down
track: bug
category: logic-errors
module: server
severity: high
tags: [recursion, redaction, security, code-review, contract-shape]
symptoms: [An override/force parameter works correctly at the top level but silently has no effect for a case nested one level inside another already-overridden case, A code review finds the same bug independently from multiple unrelated angles (correctness scan, cross-file trace, reuse/duplication check) because the general-case recursion is correct and only the special-cased branch is wrong]
created: '2026-07-08'
---

# A special-cased recursive helper must forward the same context parameter as the general-case recursion, or the override silently stops one level down

## Problem

`server/lib/contract-shape.ts`'s `deriveShape(value, forcedDynamicKeys)` redacts
dynamically-keyed objects. Its own JSDoc promises `forcedDynamicKeys` (a set of
field names a producer has explicitly marked as dynamic) are matched "wherever
they appear in the value tree" — and the *general-case* object/array branches
inside `deriveShape` do this correctly, threading `forcedDynamicKeys` through
every recursive `deriveShape(child, forcedDynamicKeys)` call.

But when a key matches `forcedDynamicKeys`, `deriveShape` hands off to a
separate helper, `deriveForcedDynamicShape(value)`, written to force-redact that
one field's value deterministically. That helper has its *own* recursion — it
walks the marked field's own values and calls `deriveShape` on each one — and
those internal calls omitted the second argument entirely:

```ts
function deriveForcedDynamicShape(value: unknown): Shape {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return deriveShape(value); // BUG: forcedDynamicKeys not forwarded
  }
  const objValue = value as Record<string, unknown>;
  const keys = Object.keys(objValue);
  if (keys.length === 0) return { type: "object", keys: {} };

  const valueShapes = keys.sort().map((key) => deriveShape(objValue[key])); // BUG: same
  return {
    type: "object",
    keys: { [DYNAMIC_KEY_PLACEHOLDER]: mergeShapes(valueShapes) },
  };
}
```

Both calls silently fall back to `deriveShape`'s default (an empty set), so once
execution enters the forced branch, a *second* marked field name nested inside
the first one's values is no longer recognized as forced — it falls back to the
general heuristics alone, which is exactly the class of gap this mechanism
exists to close (a single-entry or all-primitive-valued dynamic map).

## Symptoms

- A code review across 4 independent finder angles (line-by-line scan,
  cross-file tracer, reuse/duplication check, removed-behavior audit) each
  surfaced this same bug on their own, from different reasoning paths — a strong
  signal that the bug sits at a genuine seam (a parallel recursive path) rather
  than being a one-off typo any single lens would happen to catch.
- The bug was invisible to the two existing test suites for this feature: every
  test that marked a field only ever marked ONE field name per call, so nothing
  exercised "a marked field nested inside another marked field's values."
- Not reachable by either of the two production call sites at the time of
  writing (both mark exactly one, non-self-nesting field name) — the gap is
  real and mechanically demonstrated, but latent until a second marked field is
  ever nested under the first.

## Root Cause

When a recursive function grows a "normal case" and a "special case" that both
need to recurse, it's natural to write the special case as a separate helper
function for clarity — but that helper then has its *own* independent
recursion, and nothing forces it to thread through every parameter the general
case threads through. The two recursive paths look similar (both eventually
call `deriveShape` again) but only one of them was updated when the
`forcedDynamicKeys` parameter was added, because the two call sites live in
different functions and a change to one doesn't visually or mechanically imply
the same change is needed in the other.

## Solution

Give the special-case helper the same context parameter as the general case,
and forward it into every one of its own recursive calls — the same discipline
already applied to the general case's array/object branches:

```ts
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
```

And the call site that hands off to the helper must also forward it:

```ts
forcedDynamicKeys.has(key)
  ? deriveForcedDynamicShape(objValue[key], forcedDynamicKeys)
  : deriveShape(objValue[key], forcedDynamicKeys),
```

## Prevention

- When a recursive function gains a context/override parameter, grep every
  call site of that function (not just the ones inside its own body) — a
  sibling helper that calls the same function recursively is a call site too,
  even if it lives in a different function or file.
- When adding a "special case, delegate to a helper" branch to an existing
  recursive function, ask specifically: does the helper have its own
  recursion, and does that recursion need the same context the caller just
  threaded through? A helper's internal recursive calls are easy to overlook
  because they read as "just calling the same function again" rather than as
  a second place the override needs to propagate.
- Write a regression test that nests a second overridden case inside a first
  overridden case's values, not just one override at a time — a test suite
  that only ever exercises a single marked/overridden key per call cannot
  distinguish "the override recurses correctly" from "the override only
  applies at the first level it's checked."
- When several independent review angles (line scan, cross-file trace,
  reuse/duplication check) converge on the *same* line from *different*
  reasoning paths, treat that convergence itself as high-confidence evidence,
  not coincidence — it usually means the bug sits at a structural seam (here:
  two parallel recursive paths) rather than a one-off mistake.

## Related Files

- `server/lib/contract-shape.ts` — `deriveShape()`, `deriveForcedDynamicShape()`
- `server/lib/__tests__/contract-shape.test.ts` — the added regression test
  nesting a second marked field inside the first's values

## See Also

- [Structural shape derivation must redact dynamically-keyed objects, not just discard values](../conventions/redact-dynamic-object-keys-not-just-values-2026-07-07.md) — the parent convention this bug was found while extending
