---
title: "merge-review-guard.sh: an extractor MISS is indistinguishable from 'not a merge', so unparseable gh pr merge spellings are silently allowed"
status: backlog
priority: high
created: 2026-09-12
updated: 2026-09-12
assignee:
labels: [deferred, harness, security]
github_issue:
---

# An extractor miss reaches the gate as "not a merge"

## Summary

`cmd_gh_pr_write_subcommand` signals "I could not parse this" and "there is no merge here"
with the **same empty string and rc 0** — only its explicit REFUSE carries rc 1. So
`merge-review-guard.sh`'s `[ "$SUB" = "merge" ] || exit 0` lets every rendering the shared
extractor cannot read through as a silent allow, before any risk classification.

**248 of a 537-row combinatorial corpus are a ground-truthed real merge that the gate
allows.** No bypass token required.

## Background

Found by `security-auditor` reviewing PR #941 (the merge review gate itself). A raw-token
predicate was attempted in that PR across three review rounds and **withdrawn** — see the
Prior Attempt section, which is the most important part of this todo.

This is **not a regression introduced by the gate**. `guard-outward-cli.sh` already allows
a path-qualified merge on `main`, and mechanism (b) below defeats the shared extractor at
`lib/cmd-detect.sh` as well, so both layers miss the same row. The gate is a new layer with
an incomplete edge, not a hole someone opened.

### The three mechanisms (each measured, none needing a bypass token)

Corpus: 13 binary renderings x 10 leading separators x 4 inter-token separators = 537 rows,
each ground-truthed by executing it under a PATH containing only stubs, so "really invokes
the binary" is measured rather than assumed. Controls in the same run: a plain
`gh pr merge 42 --squash` denied, `ls -la` allowed, every row run under `env -u SKIP_MERGE_REVIEW`.

- **(a) Glued shell metacharacter — 192 of the 248.** The token adjacent to the verb
  swallows the separator, so it is `echo x;gh`, `true&&gh`, `false||gh`, `echo x|gh`, `(gh`
  or `echo x &gh` — matching neither `gh` nor `*/gh`.
- **(b) A word between the binary and the verb — 110 of the 248.** A redirect hides the
  verb from an adjacency test: `gh 2>/dev/null pr merge 42 --squash` allows for **every**
  binary rendering including the plainest. This also defeats
  `lib/cmd-detect.sh`'s own `gh[[:space:]]+pr` needle, so it is a SHARED-LIBRARY defect.
  (Compare the already-known `git-safety.sh` `MUTATING_GIT_SEG_RE` gap, which models no
  redirect between `git` and its verb — same class.)
- **(c) Quoted substitution.** `"$(which gh)" pr merge 42 --squash` allows on all four
  inter-token separators: the token ends in a quote, so a paren test never fires, while
  `cmd_bare` blanks the span for the extractor.

The documented merge ritual itself carries the escape that makes (a)-(c) reachable:
`ALLOW_OUTWARD_CLI=1 gh 2>/dev/null pr merge 42 --squash` measured
`outward=allow merge-review=allow` with no record present.

## Prior Attempt — READ BEFORE WRITING CODE

Three rounds of a raw-token predicate in PR #941, each withdrawn. Every version closed the
family it was aimed at and **re-opened the opposite failure one layer up**:

| Version                           | Closed                        | Broke                                                              |
| --------------------------------- | ----------------------------- | ------------------------------------------------------------------ |
| token adjacent to verb, `=~ gh$`  | path-qualified, `\gh`, `g"h"` | denied `through`, `enough`                                         |
| single `if` on the regex          | —                             | a decoy `… pr merge <word>` clause masked a later real merge       |
| added `*'$'*`                     | `${gh_bin}`, `$gh_bin`        | denied `$var`, `$5`                                                |
| narrowed to `gh*` after stripping | `$var`, `$5`                  | still denied `git commit -m "docs: describe the gh pr merge gate"` |

**The binding constraint is the prose direction.** A merge gate that denies ordinary commit
messages has no per-command escape — `SKIP_MERGE_REVIEW` must be set in the shell that
launched the session — so it gets switched off, which costs more than the gap it closes.
It is also not theoretical: the live hook blocked a reviewer's own file write on the word
`through`, and blocked this session's own edit command twice.

### Candidate fix, measured but NOT validated against the suite or the required corpus

From the round-4 review, replica measured over the same 537 rows:
**real-merges-allowed 248 -> 0, prose-denied 4 -> 0.**

1. **Gate on an unquoted `pr merge` surviving `cmd_bare_deep "$CMD"`.** This is what
   removes the prose direction wholesale — a quoted `pr merge` does not survive, so the
   token scan never runs on a commit message. (Verified separately:
   `cmd_bare_deep 'git commit -m "fix highlight for pr merge"'` renders `git commit -m`.)
2. **Then scan every whitespace-separated token** of `$CMD` under `set -f`, not only the
   one adjacent to the verb.
3. **Normalise each token** with the existing quote/backslash deletion followed by
   `_bare=${_bare##*[\;\&\|\(\{]}`, and run the paren arm against the quote-stripped form
   so `gh)"` is reached.

Its own stated residual: `gh issue list && echo pr merge` denies under it — contrived, and
fails closed. Write that down in the code rather than rediscovering it.

## Acceptance Criteria

- [ ] All three mechanisms deny on a risk-classified PR with no review record: a glued metacharacter, a redirect between binary and verb, and a quoted substitution.
- [ ] The four prose rows currently pinned as ALLOW in `test-merge-review-guard.sh` (the `KNOWN GAP` / `prose must never be denied` block) stay allowed — converting the gap rows to deny rows is the point of the change; converting the prose rows is a regression.
- [ ] The pinned `KNOWN GAP` rows in `test-merge-review-guard.sh` are converted to deny rows in the same change (they are a tripwire and WILL fail when this lands — that is deliberate).
- [ ] Test rows are GENERATED from a separator x rendering product, not hand-listed. Hand-listing is what let all three mechanisms ship: every prior row varied the binary and held the separator at a single space.
- [ ] If `lib/cmd-detect.sh` is widened, `.claude/hooks/repro-outward-cli-corpus.sh` passes with per-path verdicts and deny attribution unchanged, or the pin is updated with the delta explained. It is a **required** check on `main`.
- [ ] `test-cmd-detect.sh`'s `assert_wired` / non-vacuity caller count updated if the fast-path needle set changes.
- [ ] Mutation-verified per mechanism, not in aggregate: reverting each clause reddens only its own rows.

## Implementation Notes

- Files: `.claude/hooks/merge-review-guard.sh` (the `[ "$SUB" = "merge" ] || exit 0` at ~:148 and the comment block above it), `.claude/hooks/test-merge-review-guard.sh`, and probably `.claude/hooks/lib/cmd-detect.sh` for mechanism (b).
- Sibling todo, same root cause class, do them together if touching the shared extractor: `todos/P2-2026-09-12-merge-review-guard-does-not-model-the-gh-api-merge-route.md`.
- The comment block already in `merge-review-guard.sh` records this gap where the check is defined; update it rather than deleting it.
- `.claude/hooks/**` feeds a required check. Mutation-verify before pushing, and run the corpus against **branch + current main**, not the bare tip.
