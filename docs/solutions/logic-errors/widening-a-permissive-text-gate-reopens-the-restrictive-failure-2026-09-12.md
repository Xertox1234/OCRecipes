---
title: "Widening a text-matching gate to close a permissive family re-opens the restrictive failure one layer up — and the two directions are not equally costly"
track: bug
category: logic-errors
tags: [harness, hooks, safety-gate, bash, testing, security]
module: shared
applies_to: [".claude/hooks/*.sh", "scripts/**/*.sh"]
symptoms: ["Each review round finds a defect introduced by the previous round's fix", "A guard denies ordinary prose that merely describes what it guards", "A fix closes the spelling it was aimed at and misses a sibling rendering", "The guard blocks the author's own commands while they work on it"]
created: 2026-09-12
severity: high
---

# Widening a text-matching gate to close a permissive family re-opens the restrictive failure one layer up

## Problem

A gate that classifies **command text** has two failure directions: it can miss a real
invocation (permissive) or deny an innocent one (restrictive). Widening the predicate to
close a permissive family reliably opens a restrictive one just outside the new boundary,
and narrowing it back re-opens the permissive side. Without a corpus that exercises both
directions at once, each fix looks correct and ships the next defect.

Measured across four review rounds on one predicate (`merge-review-guard.sh`, PR #941):

| Version                           | Closed                        | Broke                                                   |
| --------------------------------- | ----------------------------- | ------------------------------------------------------- |
| token adjacent to verb, `=~ gh$`  | path-qualified, `\gh`, `g"h"` | denied `through`, `enough`                              |
| single `if` on the regex          | —                             | a decoy `… pr merge <word>` clause masked a real merge  |
| added `*'$'*`                     | `${gh_bin}`, `$gh_bin`        | denied `$var`, `$5`                                     |
| narrowed to `gh*` after stripping | `$var`, `$5`                  | still denied a commit message describing the gate       |

Three of the four defects were introduced by the previous round's fix.

## Symptoms

- Consecutive review rounds each find a defect that the prior round's fix created.
- The guard denies the author's own commands while they work on it — writing *about* the
  guarded verb trips it.
- A fix closes one spelling and leaves a sibling rendering (`\gh` vs `/path/gh` vs `g"h"`).
- Test rows for the fix all vary the same single dimension.

## Root Cause

Command text is not the thing being gated — the **argv the kernel receives** is. Every
rendering that produces the same argv (path-qualified, backslash-escaped, quote-split,
expanded, substituted, separated by a redirect or a glued metacharacter) is one case to the
shell and N cases to a text matcher. Enumerating renderings is therefore unbounded from
inside the matcher, and each enumeration step trades one direction for the other.

The specific traps that produced each row above:

- **Normalisation destroys the needle.** `cmd_bare_deep` renders `\gh pr merge` as
  `  h pr merge` — the backslash consumes the *following* character. A fix derived from the
  normalised rendering passes its own test and leaves the raw case open.
- **`[[ =~ ]]` is leftmost-match-only.** Inspecting `BASH_REMATCH` once lets a benign
  earlier clause consume the inspection and mask a later real invocation.
- **Unanchored substring tests leak into English.** `=~ gh$` matches `through`; `*'$'*`
  matches `$var`; `*gh*` would match `$highlight`.

## Solution

**Treat the two directions as unequal, because they are.**

- A **false deny** is active harm with no escape hatch: the documented bypass typically
  lives in the launching environment (`SKIP_MERGE_REVIEW=1`), so recovering means
  restarting the session. A gate that denies ordinary work gets switched off.
- A **false allow** in a *new* layer is a gap, not a regression — the system is left where
  it already was. Check this explicitly: if the sibling guard on `main` already permits the
  same spelling, the new gate is not introducing the hole.

So when a predicate keeps oscillating:

1. **Gate on a normalised, quote-stripped form first**, so quoted prose cannot reach the
   token scan at all. (`cmd_bare_deep 'git commit -m "fix pr merge"'` → `git commit -m`.)
2. **Scan every token, not the one adjacent to the verb** — adjacency is defeated by a
   redirect or a glued separator sitting between binary and verb.
3. **If the root cause is in a shared extractor, fix it there**, with the corpus check
   re-pinned — not with a second predicate in the consumer.
4. **If neither is achievable in the current change, withdraw the predicate and file it**
   with its corpus, rather than shipping round five. Pin the known gap as a *tripwire*
   (assert the current ALLOW with the todo named in the label) so the gap is visible in the
   suite and the eventual fix must come back and convert it.

## Prevention

- Generate the corpus from a product of dimensions — rendering × separator × position ×
  quoting — and ground-truth "really invokes the binary" by executing each row under a
  PATH of stubs, so the permissive count is measured rather than assumed.
- Require both counts in the same run: real-invocations-allowed **and** prose-denied. A fix
  that improves one and is silent on the other has not been evaluated.
- See [a two-sided control can still agree with a broken predicate](../code-quality/a-two-sided-control-can-still-agree-with-a-broken-predicate-2026-09-12.md) for why the hand-written rows kept agreeing.

## Related Files

- `.claude/hooks/merge-review-guard.sh` — the withdrawn predicate's site, with the gap recorded where the check is defined
- `todos/archive/P1-2026-09-12-merge-review-guard-extractor-miss-is-a-silent-allow.md` — the 537-row corpus, three mechanisms, and the candidate fix
- `.claude/hooks/lib/cmd-detect.sh` — the shared extractor whose `gh[[:space:]]+pr` needle the redirect family also defeats

## See Also

- [a two-sided control can still agree with a broken predicate](../code-quality/a-two-sided-control-can-still-agree-with-a-broken-predicate-2026-09-12.md) — why each round's tests stayed green
- [widened extractor, unwidened consumer fails confidently](widened-extractor-unwidened-consumer-fails-confidently-2026-08-06.md) — the sibling failure when only one side is widened
- [one form property asserted of whole syntax class](one-form-property-asserted-of-whole-syntax-class-2026-09-06.md) — overclaiming from a single rendering
- [union over renderings does not cover selection within one](union-over-renderings-does-not-cover-selection-within-one-2026-09-07.md)
