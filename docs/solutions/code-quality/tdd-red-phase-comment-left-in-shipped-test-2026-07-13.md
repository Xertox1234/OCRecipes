---
title: A TDD red-phase comment left in a shipped, passing test misrepresents the code as unimplemented
track: bug
category: code-quality
module: client
tags: [testing, tdd, documentation, review]
applies_to: ["**/__tests__/*.test.ts", "**/__tests__/*.test.tsx"]
symptoms: ["A test file's leading comment claims the behavior doesn't exist yet or the tests are expected to fail until it's wired up", "The referenced behavior is already implemented in the same commit and the tests pass"]
created: '2026-07-13'
severity: low
---

# A TDD red-phase comment left in a shipped, passing test misrepresents the code as unimplemented

## Problem

Following strict TDD (write a failing test, then implement, per project convention), it's natural to write a comment above the red-phase test explaining that the behavior doesn't exist yet and the test is expected to fail. Once the implementation lands in the same commit and the test goes green, that comment becomes stale — a future reader (or reviewer, or another agent) sees "expected to fail until wired up" next to a passing test and has to re-derive that it's actually shipped, or worse, assumes the feature is still missing.

Caught by `code-reviewer` during PR #617's review: `client/hooks/__tests__/useNutritionLookup.test.ts` shipped with a comment stating the mutation "has no client-visible failure path today" in the same commit that added the `toast.error(...)` call fixing exactly that.

## Root Cause

TDD process artifacts (red-phase narration) describe a transient state (before the fix) rather than the shipped state (after the fix) — if not swept before commit, they persist as permanently-wrong documentation.

## Solution

Before committing a TDD-driven test file, re-read any comment written during the red phase and either delete it or rewrite it to describe only the current (green) behavior — e.g. "X surfaces failures via toast; verifies silence on success" instead of "X doesn't do this yet." Same discipline applies to `// TODO: implement` and `// FIXME` markers left over from the red phase.

## Prevention

Treat the red→green transition as an edit pass over the test file's own comments, not just its assertions — the assertions get updated by definition (they're what makes the test pass), but narrative comments don't get touched by the same mechanism and are easy to forget.

## Related Files

- `client/hooks/__tests__/useNutritionLookup.test.ts`

## See Also

- [../logic-errors/toast-action-button-unreachable-by-screen-reader-2026-07-13.md](../logic-errors/toast-action-button-unreachable-by-screen-reader-2026-07-13.md) — another PR #617 review finding, different category
