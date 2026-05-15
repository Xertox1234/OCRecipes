---
title: "Document the hardcoded PATTERNS_URL_BASE with a rename caveat"
status: in-progress
priority: low
created: 2026-05-11
updated: 2026-05-11
assignee:
labels: [docs, documentation, code-quality, deferred]
github_issue:
---

# Document the hardcoded PATTERNS_URL_BASE with a rename caveat

## Summary

`scripts/delegate-copilot-issue.ts` defines:

```typescript
const PATTERNS_URL_BASE =
  "https://github.com/Xertox1234/OCRecipes/blob/main/docs/patterns";
```

If the repo is ever renamed or forked, these URLs go stale silently — the
generated Project Rules section in Copilot Issue bodies would point at a 404. Add a brief comment above the constant noting this and what to update.

## Background

Surfaced by the final code review of PR #149. Marked as Minor / informational.
Trivial cleanup, just makes the latent fragility explicit for a future
maintainer.

## Acceptance Criteria

- [ ] A 1-3 line comment block immediately above `PATTERNS_URL_BASE` in
      `scripts/delegate-copilot-issue.ts`, noting that the constant is the
      base URL embedded in every generated Project Rules section, and that
      it must be updated if the repo owner/name changes
- [ ] No behavior change; no tests need updates
- [ ] Pre-commit hooks still pass (eslint, prettier)

## Implementation Notes

Files in scope:

- scripts/delegate-copilot-issue.ts

Suggested wording:

```typescript
// Hardcoded GitHub URL for the patterns directory. Embedded as
// further-reading links in every Project Rules section injected into
// Copilot Issue bodies. Update if the repo is renamed or forked, otherwise
// the rendered URLs will 404 on the new home.
const PATTERNS_URL_BASE =
  "https://github.com/Xertox1234/OCRecipes/blob/main/docs/patterns";
```

## Dependencies

None.

## Risks

- None. Comment-only change.

## Project Rules

The rules below are binding. If any rule conflicts with the acceptance criteria, raise it in a PR comment rather than silently violating it. Open the linked pattern file for full context if a rule isn't clear.

### typescript

- Never use `as` cast on a bare `text` DB column to derive a discriminated type — use a type guard (`function isFoo(x: string): x is Foo`) or Zod enum `.parse()`
- Never cast navigation types with `as never` or `as unknown` — define `CompositeNavigationProp` in `client/types/navigation.ts` for 3-level stack → tab → root composites
- JSONB columns typed with `$type<MyType>()` hint in the schema — don't add redundant `as MyType` casts on top of them
- Use a named update-fields type (e.g., `UpdateUserFields`) instead of `Partial<User>` in storage update functions — the narrower type surfaces compile-time errors when schema changes, and prevents mass-assignment
- `Drizzle .default([])` does NOT fix the TypeScript type — the inferred type stays `T[] | null` (not `T[]`); add `.notNull()` to make the TS type non-nullable and prevent null-access crashes on legacy rows
- PostgreSQL decimal aggregates (SUM, AVG) return strings via Drizzle — always `parseFloat()` or `Number()` the result

**Further context (open the URL if a rule above isn't clear):**

- https://github.com/Xertox1234/OCRecipes/blob/main/docs/patterns/typescript.md

## Updates

### 2026-05-11

- Deferred from PR #149 final review.
