---
title: "Recipe finder: the 'this/that/my … recipe' exclusion vetoes a real request elsewhere in the same message"
status: done
priority: medium
created: 2026-09-28
updated: 2026-09-28
assignee:
labels: [deferred, ai-prompting]
github_issue:
---

# Referent exclusion vetoes compound recipe requests

## Summary

#1152 added `RECIPE_REQUEST_EXCLUSIONS` in `server/services/coach-intent-classifier.ts`. Its referent regex (`this|that|these|those|my … recipe`) is unanchored and is tested against the whole message before any request pattern runs. So "Find me a recipe, I don't like that recipe" no longer routes to the finder, and the docblock's "A request for A recipe still routes" is false for compound messages. This must be fixed before `RECIPE_FINDER_ENABLED` is flipped.

## Background

This was flagged by all three reviewers of #1152 (code, server and ai), each measuring against `main` with a generated corpus:

- ai-reviewer: 6 openers × 4 objects × 15 tails = 360 rows. 168 went from routed to not-routed, 0 the other way. Every lost row is one of the 7 tails that contain a qualified "recipe" (e.g. "similar to my lasagna recipe", "better than my usual recipe").
- code-reviewer: 5 heads × 9 tails = 45 rows. 20 went from routed to not-routed, and 15 of those are plainly new-recipe requests ("Find me a recipe, I don't like that recipe").
- server-reviewer: 12/21 rows no longer route, e.g. "Find me a new recipe for my recipe box".

Impact after the flip is recoverable: a missed route falls through to the ordinary Coach LLM, which still answers. It is non-blocking under the one-review-pass rule, so it was filed here rather than fixed on the reviewed branch.

## Acceptance Criteria

- [x] Compound new-recipe requests route again: "Find me a recipe, I don't like that recipe", "Give me a recipe similar to my lasagna recipe", "Send me a recipe better than my usual recipe", "Find me a new recipe for my recipe box".
- [x] All 16 existing must-NOT-route action cases in `coach-intent-classifier.test.ts` still do not route; "I want to add a recipe to my meal plan" in particular must stay excluded.
- [x] All 8 existing must-route controls still route; the eval count stays 5/41 with the same ids.
- [x] Re-run a generated openers × tails corpus against `main` and the fix, and report the counts in the commit.
- [x] The docblock states what the code does.

## Implementation Notes

- The reviewers proposed three fixes. Measure them against each other; don't pick one on reasoning alone:
  1. (code-reviewer, measured bad=0 on the shipped lists plus 4 compound rows) Gate the referent exclusion with a negative lookahead for an indefinite request: `/^(?![\s\S]*\b(?:a|an|another|new|different|some)\s+(?:[\w-]+\s+){0,2}recipes?\b(?!\s+(?:to|on|in|into)\b))[\s\S]*\b(?:this|that|these|those|my)\s+(?:[\w-]+\s+){0,2}recipes?\b/i`
  2. (ai-reviewer) Skip the referent exclusion when the referent follows a comparator (`like|similar to|than|based on|instead of`). This recovers 5/7 lost tails. It warns that a plain indefinite-article override would let "add a recipe to my meal plan" through; variant 1's `(?!\s+(?:to|on|in|into))` and exclusion 4 are meant to keep it out, so verify that.
  3. (server/code) Apply the exclusions only to the clause (split on `[,;—.?!]`) that contains the request-pattern match, or only when the exclusion match overlaps or precedes the request match (compare `.index`).
- Files: `server/services/coach-intent-classifier.ts`, `server/services/__tests__/coach-intent-classifier.test.ts`.

## Dependencies

- #1152 merged.

## Updates

### 2026-09-28

- Auto-filed (Medium) from #1152's review; all three reviewers raised it as non-blocking.
- Fixed: the referent vetoes only when no indefinite recipe precedes it (order rule; todo option 1's lookahead plus ordering). Measured on 587 labelled rows (harness in the PR body): base misses 274 new-recipe requests (the fix recovers 271) and gets 0 must-not-route rows wrong; the fix misses 3 referent-first rows (base misses them too) and gets 0 must-not-route wrong, including 8 referent-first rows that option 1 routed. Option 3 (clause scoping) was rejected: splitting re-anchors `recipe_leading` on a fragment, so "…my recipe, a big recipe for 8" routes.
- #1156 review: the indefinite phrase's modifier window swallowed "my"/"this", so "I want a name for my recipe" routed (2240/3360 generated actions); modifiers now exclude referent determiners. Follow-up: `any` joined the indefinite determiners. (Corrected 271→274 and 9→8 above; the #1156 first commit message repeats 271.)
