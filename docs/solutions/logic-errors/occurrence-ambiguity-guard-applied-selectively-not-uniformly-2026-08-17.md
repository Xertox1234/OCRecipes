---
title: "A 'deny on ambiguous multi-occurrence' guard applied to some sibling checks but not others leaves the ungated one bypassable by clause reordering"
track: bug
category: logic-errors
tags: [harness, security, false-negative]
module: server
applies_to: [".claude/hooks/**"]
symptoms: ["Several sibling checks share an 'extract the first matching clause, inspect it' pattern (e.g. via head -1)", "Some of the siblings have an occurrence-count guard that denies outright when the pattern matches more than once (ambiguous — cannot verify EVERY occurrence)", "One sibling lacks that guard, relying only on the first-match extraction", "A benign occurrence placed FIRST lets a malicious occurrence in a LATER clause go uninspected"]
created: 2026-08-17
severity: critical
---

# A 'deny on ambiguous multi-occurrence' guard applied selectively leaves the ungated sibling bypassable

## Problem

`guard-outward-cli.sh` gates several `gh pr <subcommand>` families with a
"clause-scoped" flag check: extract the (first) matching clause's text via
`grep ... | head -1`, then scan that one clause for a dangerous flag. Two of the three
families (`gh pr merge`, `gh api`) additionally count how many times the anchoring
pattern occurs in the command and deny outright if it's ambiguous (`>1` occurrence) —
"cannot verify each carries/lacks the flag, so deny is the safe direction." The third
family (`gh pr create`/`gh pr comment`, the cross-repo `--repo`/`-R` egress check) had
no such guard: `gh pr create --fill && gh pr create --repo other/org --title x` was
silently ALLOWED, because `gh_pr_clause_has_repo`'s `head -1` only ever inspected the
first (benign) clause and never reached the second (malicious) one.

## Symptoms

- Three sibling checks share the same "extract first clause via `head -1`, inspect it"
  primitive.
- A comment on the shared extraction function claims the `head -1` residual is safe
  "and the ambiguous-multi case is already denied outright for `merge`" — stating a
  fact that was true for ONE sibling and silently assuming it generalized to all
  callers, without verifying each caller actually had the same guard.
- Reordering the malicious clause to come FIRST correctly denies (the coincidental
  effect of `head -1` grabbing the malicious clause) — masking the bug in casual manual
  testing, since "does this deny when the bad flag is present" naturally gets tested
  with the bad flag in the obvious first position.

## Root Cause

A safety guard (deny-on-ambiguous-occurrence-count) was added to two of three sibling
checks that share the same underlying extraction primitive, but never propagated to
the third. The shared extraction function's own comment asserted the guard existed
"for `merge`" as if that were evidence it was unnecessary to re-verify for every
caller — but each call site independently decides whether to add the occurrence guard
before calling the shared extractor, and nothing enforces that all callers of a
`head -1`-based extractor add the same ambiguity check.

## Solution

Add the identical occurrence-count guard to the previously-ungated call site, mirroring
the pattern already used by its siblings:

```bash
GH_PR_CREATE_OCCURRENCES=$(printf '%s' "$WORDS" | grep -oiE "$GH_PR_CREATE_RE" | wc -l | tr -d '[:space:]')
if [ "${GH_PR_CREATE_OCCURRENCES:-0}" -gt 1 ]; then
  deny "... more than one command-position 'gh pr create/comment' occurrence — ambiguous ..."
elif [ "${GH_PR_CREATE_OCCURRENCES:-0}" -eq 1 ] && gh_pr_clause_has_repo 'create|comment'; then
  deny "..."
fi
```

Also correct the shared extraction function's comment: it should state a fact that is
now enforced structurally (every caller counts occurrences before calling this
function), not a fact that happened to be true of one caller.

## Prevention

When a `head -1` (or any "take the first match") extraction pattern is shared across
multiple call sites, and one caller adds a safety guard to handle the "more than one
match" ambiguity, audit every OTHER caller of the same shared extraction function for
the identical gap — the shared function's soundness depends on ALL its callers
guarding ambiguity the same way, and a comment claiming "the ambiguous case is already
handled" is only true if you verify it's handled at every call site, not just the one
you're looking at.

## Related Files

- `.claude/hooks/guard-outward-cli.sh` — `gh_pr_clause_has_repo()` (the shared
  extractor) and its three call sites (`merge`, `api` via a separate occurrence count,
  `create|comment` — the one that was missing the guard).
- `.claude/hooks/test-guard-outward-cli.sh` — regression pins for two-occurrence
  ambiguity, malicious-clause-first (coincidental correct deny), and malicious-clause-
  second (the actual bug).

## See Also

- [Empty quote-span mid-word vs standalone](empty-quote-span-closing-check-needs-mid-word-vs-standalone-2026-08-17.md) — a sibling finding from the same review round, same underlying theme of a check's soundness depending on an assumption that silently stopped holding.
