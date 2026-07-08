<!-- Filename: P{0-3}-YYYY-MM-DD-short-description.md  (P0=critical … P3=low) -->

---

title: "contract-shape.ts computes mergeShapes unconditionally for every object node, discarded in the common static case"
status: backlog
priority: low
created: 2026-07-08
updated: 2026-07-08
assignee:
labels: [deferred, server]
github_issue:

---

# contract-shape.ts computes mergeShapes unconditionally for every object node, discarded in the common static case

## Summary

In `deriveShape()`'s object branch, `mergeShapes(valueShapes)` is computed unconditionally for
every object node in the recursion tree — including the overwhelmingly common case (an
ordinary static object) where the result is immediately discarded because neither redaction
signal fires.

## Background

Found during code review of PR #544, confirmed via trace: for a typical mixed-primitive-typed
object, `mergeShapes` calls `canonicalKey` (a full `JSON.stringify` of each child's already-
built shape subtree) once per field, builds a dedup Map, and — since mixed types make
`uniqueByKey.size > 1` — also sorts and builds a full `variants` array, all thrown away. This
runs synchronously inline on the request path (confirmed: executes before the response
returns) and compounds with response nesting depth. Severity is capped low: only active behind
the `CONTRACT_SNAPSHOT=1` dev-only opt-in flag, never on production traffic.

## Acceptance Criteria

- [ ] `mergeShapes(valueShapes)` is only computed when a redaction signal might actually need
      it (e.g. a cheap linear uniformity pre-check before building the full Map/sort), or its
      cost is otherwise avoided for the common static-object case.
- [ ] Existing `contract-shape.test.ts` suite still passes unchanged (behavior-preserving
      optimization only).

## Implementation Notes

`server/lib/contract-shape.ts` — `deriveShape()`'s `case "object":` branch, where
`mergedValueShape = mergeShapes(valueShapes)` is called before the
`looksDynamicallyKeyed(...) || hasUniformNonPrimitiveValueShape(...)` check.

## Dependencies

- None.

## Risks

- Low — pure performance optimization on a dev-only opt-in code path; must not change output
  shapes, only defer/avoid unnecessary work.

## Updates

### 2026-07-08

- Filed during code review of PR #544 (merged as 137b746e).
