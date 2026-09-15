---
title: "Compose a new hook detector from a shared library's primitives, but reuse a sibling detector's HARDENED sub-patterns too — not just its position anchors — or you re-derive an already-fixed bug"
track: knowledge
category: conventions
tags: [harness, hooks, bash, security, testing]
module: shared
applies_to: [".claude/hooks/*.sh"]
created: 2026-09-14
---

# Compose a new precise detector from shared primitives instead of widening the extractor it lives in

## Rule

When a deny-shaped guard needs to model a **new command shape** a shared extractor library
was never asked to cover, and editing that library is out of scope (owned by concurrent
work, or simply not where the new shape belongs), do not widen the library's existing
matcher to also catch the new shape. Instead, **compose a new, narrowly-scoped detector
directly in the consuming hook**, built from the library's already-exposed primitives
(command-position anchors, quote-aware renderings) rather than a hand-rolled regex from
scratch.

This is not a workaround — it is frequently the *more correct* factoring: a `gh pr <verb>`
extractor and a `gh api <endpoint>` extractor are different shapes with different failure
modes (a REST path is not a subcommand+ref pair), and forcing one function to recognize
both usually means smuggling shape-specific logic into a matcher whose other callers do not
want it (see `../logic-errors/widening-is-safe-on-every-deny-read-and-a-false-grant-at-the-one-allow-read-2026-09-13.md`
for what goes wrong when a widened shared matcher reaches a *different* consumer than the
one motivating the widening).

**A THIRD, sharper rule, found by security review of the first version of this composed
detector: reuse the SIBLING'S HARDENED SUB-PATTERNS, not just its position-anchor
primitives.** A hand-spelled `-X`/`--method` value separator (`([[:space:]]|=)*`)
independently re-derived the exact pre-fix, vulnerable shape `guard-outward-cli.sh` already
carries a dated fix for (`_OUT_SEP`, absorbing a redirect between the flag and its value —
see that file's own "THE FLAG->VALUE SEPARATOR TAKES THE ABSORBER", 2026-09-07). Composing
from primitives is not enough if the composition re-derives a sub-pattern the sibling
detector already had to harden once; grep the sibling file for the SAME flag/value shape you
are about to write, and reuse its constant rather than typing a shorter one that looks
equivalent.

A second, independent fact makes this composable in practice: **a pinned "wiring" test that
asserts a call site's argument list via `case "$line" in *"$expect"*)` (substring
containment, not exact equality) survives you adding a second argument to that call**, as
long as the original argument stays present verbatim. You can widen a `cmd_fastpath_has`
call site's needle set without editing that call's own pinned assertion in a sibling test
file — useful precisely when that sibling file is also out of scope (owned by concurrent
work, or simply not yours to touch).

## When this applies

- You are extending a `.claude/hooks/*.sh` guard to cover a new command shape, and the
  shared shape-specific extractor (`lib/cmd-detect.sh`'s `cmd_gh_pr_*`, `cmd_is_git_*`,
  etc.) is scoped to a *different* shape than the one you need.
- You cannot or should not edit the shared library (owned by concurrent work; or the new
  shape is different enough that folding it in would make that function serve two purposes).
- A shared fast-path pre-filter call (`cmd_fastpath_has "$CMD" 'pattern...'`) needs a new
  needle, and a sibling test file pins that call site's exact argument text.
- The new detector matches a FLAG followed by a VALUE (`-X PUT`, `--foo bar`) — check
  whether a sibling detector in the codebase already matches the same flag shape (even for
  a different flag name) and had to harden its separator; a bare `([[:space:]]|=)*` almost
  always needs to become a `_CMD_REDIR`-absorbing one, per the Why section below.

## Why

`merge-review-guard.sh` denies two merge routes — `gh pr merge` (via
`lib/cmd-detect.sh`'s `cmd_gh_pr_write_subcommand`/`cmd_gh_pr_ref`) and the
`mcp__github__merge_pull_request` MCP tool. A third route, `gh api` against the REST merge
endpoint (`PUT /repos/{owner}/{repo}/pulls/{n}/merge`), reached neither: its raw command
text contains no `pr` substring at all, so it never passed the fast path's original
`'*gh*pr*merge*'` needle, and even had it passed, `cmd_gh_pr_write_subcommand` correctly
returns "" for it — that function is built to read `gh pr <verb>`, and a `gh api` call
genuinely is not one. This was never an extractor *miss*; it was the wrong extractor for the
shape (contrast the sibling
`todos/P1-2026-09-12-merge-review-guard-extractor-miss-is-a-silent-allow.md`, where
`cmd_gh_pr_write_subcommand` IS the right extractor and simply fails to parse some
renderings of the shape it targets).

`lib/cmd-detect.sh` was out of scope for this change (held by a concurrent todo touching
the same file). The fix instead composed a new detector directly in
`merge-review-guard.sh`, reusing that library's exposed, general-purpose primitives —
`_CMD_POS_PREFIX` (command-position anchor), `_CMD_GH_GLOBALS` (the `gh <flags> <namespace>`
slot), `_CMD_POS_SUFFIX`, and `cmd_words_deep` (quote-aware rendering) — the same way
`guard-outward-cli.sh` composes its own, separate `gh api` mutation check from the same
primitives without either file needing to touch the other or `cmd-detect.sh`:

```bash
MRG_API_CUT="${_CMD_POS_PREFIX}gh${_CMD_GH_GLOBALS}[[:space:]]+api${_CMD_POS_SUFFIX}([^;&|]|&[0-9-]|&[<>]|[<>]&|&?[<>]+&?[|!])*"
MRG_API_WORDS=$(cmd_words_deep "$CMD")
MRG_API_CLAUSES=$(printf '%s' "$MRG_API_WORDS" | grep -ioE "$MRG_API_CUT")
```

Then two conjuncts, both load-bearing, keep it precise rather than a bare substring test:
a mutating HTTP method (`-X`/`--method` POST/PUT/PATCH/DELETE — the bare GET default on
this exact path is a legitimate read, "has PR #n been merged?", not a merge) AND the
`pulls`…`merge` sub-resource path (not any mutating `gh api` call — that is
`guard-outward-cli.sh`'s concern, not this merge-specific gate's). Every matched clause is
scanned, not just the first, so a benign `gh api` call followed by the real merge in a later
clause on the same compound command is still caught (the co-occurrence lesson from
`one-axis-at-a-time-corpus-misses-co-occurrence-checks-2026-09-01.md`).

Separately: the fast path's existing pinned call,

```bash
cmd_fastpath_has "$CMD" '*gh*pr*merge*' || exit 0
```

needed a second needle (`'*gh*api*merge*'`) to let the new shape reach the detector at all.
`test-cmd-detect.sh`'s `assert_wired` extracts this exact call site (`grep -o
'cmd_fastpath_has "\$CMD"[^|;&]*'`) and asserts `case "$line" in *"'*gh*pr*merge*'"*)` —
a **substring** test, not equality. Adding a second argument —

```bash
cmd_fastpath_has "$CMD" '*gh*pr*merge*' '*gh*api*merge*' || exit 0
```

— leaves the original needle text present verbatim in the extracted line, so the pinned
assertion still passes with **zero edits to `test-cmd-detect.sh`**. Verified by running the
suite before and after: `test-cmd-detect.sh` stayed at 611/0 unchanged.

### The composition re-derived a bug the sibling detector had already fixed

The first version of the mutating-method conjunct was hand-spelled:

```bash
grep -qiE '(^|[[:space:]])(-X|--method)([[:space:]]|=)*(POST|PUT|PATCH|DELETE)([^-A-Za-z0-9]|$)'
```

Security review constructed `gh api -X 2>&1 PUT repos/o/r/pulls/938/merge` and confirmed —
via an argv-dumping `gh` stub run under both bash and zsh — that this is a genuinely
executing `gh api --method PUT` call (argv `[api -X PUT repos/o/r/pulls/938/merge]`), yet
the hand-spelled `([[:space:]]|=)*` separator does not absorb the redirect between the flag
and its value, so the clause `-X 2>&1 PUT ...` never matches `-X` immediately followed by
`PUT`. **This is the identical bug class `guard-outward-cli.sh` already found and fixed for
its own `gh api` mutating-method check** (that file, 2026-09-07, "THE FLAG->VALUE SEPARATOR
TAKES THE ABSORBER" — `gh api repos/o/r -X DELETE` denied, `gh api repos/o/r -X 2>&1 DELETE`
silently allowed, same live bypass). The fix reused that file's exact composition instead of
re-deriving it:

```bash
MRG_SEP='([[:space:]]*'"$_CMD_REDIR"')*[[:space:]]+'    # mirrors guard-outward-cli.sh's _OUT_SEP
MRG_API_M='([Pp][Oo][Ss][Tt]|[Pp][Uu][Tt]|[Pp][Aa][Tt][Cc][Hh]|[Dd][Ee][Ll][Ee][Tt][Ee])'
grep -Eq "(^|[[:space:]])(-X${MRG_API_M}${_CMD_POS_SUFFIX}|(-X|--method)(${MRG_SEP}|=)${MRG_API_M}${_CMD_POS_SUFFIX})"
```

A second, adjacent gap surfaced the same way: `gh api -X "$(echo PUT)" repos/o/r/pulls/938/merge`
renders its method value as `cmd_words`'s placeholder text (`$xechoxPUTx`), not the literal
"PUT", so the literal-value match alone cannot see it either. `guard-outward-cli.sh` has a
dedicated, separate "unreadable value" check for exactly this (a `-X`/`--method` flag present
anywhere in the clause, co-occurring with a `$`/backtick — "cannot verify -> deny"); the fix
added the same second arm rather than trying to widen the literal-value regex to somehow
parse a substitution's output (which it structurally cannot — this is text analysis, not
execution).

**The lesson generalizes past this one flag:** a hand-spelled flag→value separator is
*always* suspect once you know redirects and substitutions can sit in that slot, and the
correct fix is almost never a wider ad hoc character class — it is *finding the sibling
detector that already solved this exact shape* and reusing its named constant.

## Examples

Mutation-verify that all of the above are load-bearing (not merely present) before trusting
any of it:

```bash
# 1. Delete the new deny clause entirely — its assertions must go red, nothing else.
#    (`if [ -n "$MRG_API_HIT" ]` -> `if false`)
# 2. Delete the new fast-path needle — the SAME assertions must go red again, proving
#    the needle is necessary, not decorative.
#    ('*gh*pr*merge*' '*gh*api*merge*' -> '*gh*pr*merge*')
```

Both mutations reddened exactly the 10 gh-api-route deny assertions and nothing else in a
95-assertion suite. The redirect-separator and unreadable-value fixes were additionally
verified by constructing the adversarial commands and running them through the REAL hook
(not a copy) before and after the fix — the harness's own permission layer refused a
revert-in-place mutation of the fixed regex back to its vulnerable form (flagged as
weakening security in a live guard file), which is itself worth noting: that refusal is a
GOOD sign the file is correctly recognized as security-sensitive, and pre/post empirical
reproduction against the real, unmutated file is an equally rigorous substitute when the
harness declines an in-place revert.

## Exceptions

- If the new shape is genuinely a variant of what the shared extractor already models
  (not a different command entirely), widen the shared extractor instead — that is the
  right layer, and a locally-composed duplicate would drift from it. This rule applies when
  the shapes are different commands (`gh pr merge` vs `gh api ...`), not different
  spellings of the same command.
- The substring-survives-widening property of `assert_wired`-style tests only holds while
  you **add** an argument and leave the original text intact. Removing, reordering, or
  reformatting the original needle's literal text still requires updating the pinned test.

## Related Files

- `.claude/hooks/merge-review-guard.sh` — the composed `gh api` merge detector and the
  widened `cmd_fastpath_has` call
- `.claude/hooks/test-merge-review-guard.sh` — the new `gh api` route assertions (rows 3a-3n)
- `.claude/hooks/lib/cmd-detect.sh` — the shared primitives reused (`_CMD_POS_PREFIX`,
  `_CMD_GH_GLOBALS`, `_CMD_POS_SUFFIX`, `cmd_words_deep`), left untouched
- `.claude/hooks/guard-outward-cli.sh` — the precedent for composing a `gh api` mutation
  check from the same shared primitives without editing `cmd-detect.sh`
- `.claude/hooks/test-cmd-detect.sh` — `assert_wired`'s substring-based wiring assertion
  for `merge-review-guard.sh`, unchanged by this widening

## See Also

- [widening a shared matcher is safe on every deny-shaped read and a false grant at the one allow-shaped read](../logic-errors/widening-is-safe-on-every-deny-read-and-a-false-grant-at-the-one-allow-read-2026-09-13.md)
- [a corpus that varies one axis at a time cannot exercise a check that only fires when two things co-occur](one-axis-at-a-time-corpus-misses-co-occurrence-checks-2026-09-01.md)
