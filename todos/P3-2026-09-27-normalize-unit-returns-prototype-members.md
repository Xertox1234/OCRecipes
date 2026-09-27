---
title: 'normalizeUnit returns an Object prototype member for "constructor" or "__proto__"'
status: backlog
priority: low
created: 2026-09-27
updated: 2026-09-27
assignee:
labels: [deferred, api]
github_issue:
---

# normalizeUnit returns an Object prototype member for `"constructor"` or `"__proto__"`

## Summary

`normalizeUnit` in `server/lib/recipe-normalization.ts` reads a plain-object map with
`UNIT_MAP[lower] ?? lower`. For a unit that names an `Object.prototype` member, it returns
that member instead of a string, although its return type is `string`.

## Background

Found while adding the cooking-session unit→grams table (photo/cooking per-100 g P1).
Measured with `npx tsx` on 2026-09-27:

| Input           | Returns                            |
| --------------- | ---------------------------------- |
| `"cups"`        | `"cup"`                            |
| `"constructor"` | the `Object` function              |
| `"__proto__"`   | `Object.prototype` (an object)     |
| `"toString"`    | `"tostring"` (lowercased, so safe) |

Callers: `normalizeIngredient` (recipe import, same file, `:155`) stores the result as an
ingredient's unit; `server/services/cooking-session.ts` looks it up in its unit tables, where a
non-string simply matches nothing. Units are free text (cooking sessions accept any string up
to 50 characters), so the input is user-reachable, but only by typing those exact words.

## Acceptance Criteria

- [ ] `normalizeUnit` returns a string for every input: read the map with an own-key check
      (`Object.hasOwn`) or make it a `Map`.
- [ ] A test covers `"constructor"` and `"__proto__"` (each returns itself, lowercased) beside
      a positive control (`"cups"` → `"cup"`).

## Implementation Notes

- `server/lib/recipe-normalization.ts` `UNIT_MAP` / `normalizeUnit` (`:89-124`).
- `server/services/canonical-enrichment.ts:84` has its own `normalizeUnit`; check it for the
  same shape while there.

## Scope Contract

- **Files in scope:** `server/lib/recipe-normalization.ts`, its `__tests__/` file, and
  `server/services/canonical-enrichment.ts` if it has the same defect.
- No new mechanisms.

## Updates

### 2026-09-27

- Filed from the cooking-session per-100 g PR (Low; auto-filed per the Medium/Low policy).
