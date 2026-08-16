---
title: "A code comment saying 'keep these two files in sync' does not stop them going out of sync"
track: bug
category: logic-errors
module: shared
severity: medium
tags: [harness, tooling, mirror, invariant, duplication, code-review, regex, frontmatter]
applies_to: [.claude/hooks/inject-patterns.sh, .claude/hooks/test-inject-patterns-relevance.sh, scripts/check-solution-frontmatter.js, scripts/__tests__/check-solution-frontmatter.test.ts]
symptoms: ["A validator/linter rejects input that the actual runtime consumer would accept (or vice versa)", "A docblock explicitly says 'mirrors X, keep in sync' next to logic that has drifted from X", "Editing the primary implementation's regex/constant compiles and tests green with no signal that a second, hand-maintained copy exists elsewhere", "The two sides were correct when the mirror was first written and only diverged on a later, unrelated-looking edit"]
created: '2026-08-16'
---

# A code comment saying "keep these two files in sync" does not stop them going out of sync

## Problem

`.claude/hooks/inject-patterns.sh`'s `domain_tag_pattern()` computes the ERE alternation that
selects which `docs/solutions/*.md` files route to each domain. `scripts/check-solution-
frontmatter.js` (a lint-staged pre-commit gate) needs the SAME alternation to warn an author
when a doc's `tags:` routes nowhere — so it hand-maintains a second copy, `ROUTABLE_TAG_
PATTERNS`, with a docblock stating "Mirrors `domain_tag_pattern()` in the hook... Keep in sync."

Widening the hook's harness alternation from `worktree` to `worktrees?`
(`injection-glob-tier-ranked-by-date-not-specificity-2026-08-13`, in `todos/archive/`) touched
only `inject-patterns.sh`. The mirror in `check-solution-frontmatter.js` was untouched, tests
still passed (nothing exercises cross-file agreement), and the diff reviewed clean in isolation
— the hook does exactly what the PR says.

## Symptoms

- A doc tagged only `[worktrees]` (plural) would be **accepted by the live hook** (reachable in
  the harness pool) but **rejected by the pre-commit linter** with `'tags:' matches no routed
  domain, so this doc NEVER injects` — a false rejection, and the rejection message itself
  quoted the stale singular-only pattern.
- Neither file's own test suite caught it: `test-inject-patterns-relevance.sh` only drives the
  hook; `check-solution-frontmatter.test.ts` only drives the linter. Nothing runs both against
  the same input and asserts agreement.
- Caught in code review, not by any test — a second reviewer pass explicitly re-scanned "does
  anything else mirror this constant" and found it via `grep`, not via a red test.

## Root Cause

The mirror is a **documented convention**, not an **enforced invariant**. A code comment is
read by a human at write time and never again; it has no mechanism to fire when the thing it
describes stops being true. The two copies are in different languages (bash ERE vs. JS RegExp)
in different directories, so neither an IDE's "find references" nor a same-file diff surfaces
the second copy — the only way to notice is to already know the mirror exists and go looking.

## Solution

Fixed by hand-updating the second copy to match (`ROUTABLE_TAG_PATTERNS`'s harness entry, plus
its user-facing error-message text, which quoted the pattern independently and had its own
identical staleness).

Pinned by **two** regression checks, one per side of the mirror — a `tags: [worktrees]`-only
fixture must be accepted by BOTH copies:

- `scripts/__tests__/check-solution-frontmatter.test.ts` — the linter exits 0 on the fixture.
- `.claude/hooks/test-inject-patterns-relevance.sh` (test 18) — the hook's `domain_tag_pattern()`
  actually delivers the fixture into the `harness` pool for a harness-routed edit.

One check would not have been enough, and asserting so is the whole point: reverting
`worktrees?` → `worktree` in the hook turns **only** the bash test red (vitest stays green);
reverting it in the JS mirror turns **only** vitest red (the bash suite stays green). Each test
is blind to a revert of the other side, so a single-sided test would have left exactly the
desync documented here undetected. Both carry a negative control (a doc tagged with something
genuinely unrouted must be rejected/undelivered), so neither can pass by waving everything
through.

This pins the specific class of drift that occurred; it does not make the mirror structurally
impossible — see Prevention.

## Prevention

- **When a docblock says "mirrors X, keep in sync," treat any edit to X as touching the mirror
  too** — grep for the mirror's known location before closing out the change, the same way you'd
  check callers before changing a function signature.
- A `git grep` for the literal pattern text (or the invariant's distinctive substring) across
  the repo is cheap insurance whenever you touch a constant/regex that a comment claims is
  duplicated elsewhere — don't rely on remembering where every mirror lives.
- Prefer a single source of truth over a documented mirror where one is easy to add (e.g. a
  shared JSON/derived-file, or one side importing the other) — a comment is the weakest
  enforcement available, appropriate only when the two sides are in genuinely incompatible
  languages/runtimes (here: a bash hook vs. a Node lint script) and a generator would be more
  machinery than the drift risk justifies.
- If a single source of truth genuinely isn't feasible, cover **both** copies against the same
  fixture — as done here — turning the documented mirror into an enforced one, cheaply, without
  unifying the implementations. Covering only the copy you happened to edit is the trap: that
  test is green in exactly the state the desync produces.

## Related Files

- `.claude/hooks/inject-patterns.sh` — `domain_tag_pattern()`, the primary implementation
- `scripts/check-solution-frontmatter.js` — `ROUTABLE_TAG_PATTERNS`, the hand-maintained mirror
- `scripts/__tests__/check-solution-frontmatter.test.ts` — the mirror guard on the linter side
- `.claude/hooks/test-inject-patterns-relevance.sh` — the mirror guard on the hook side (test 18)

## See Also

- [duplicated flag-composition logic desyncs across two display surfaces](duplicated-flag-composition-desyncs-display-surfaces-2026-07-24.md) — the same shape (two call sites duplicating one expression) in client UI code
- [a config value hand-copied into per-platform native files drifts on the platform nobody builds locally](hand-copied-config-drifts-on-the-unbuilt-platform-2026-07-27.md) — the same shape at the build-config layer
- [tags and applies_to are a two-part routing precondition](../conventions/tags-and-applies-to-are-a-two-part-routing-precondition-2026-08-06.md) — the routing mechanism this mirror exists to validate
