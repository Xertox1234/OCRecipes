---
title: "Two redirect shapes still defeat git-safety: a redirect in an arg-taking global VALUE SLOT (both layers), and a parameter expansion in the fd slot (matcher only)"
status: backlog
priority: high
created: 2026-09-16
updated: 2026-09-16
assignee:
labels: [deferred, harness, security]
github_issue:
---

# A redirect in an arg-taking global's value slot is invisible to both git-safety layers

## Summary

Two shapes, filed together because they are both fd-slot/value-slot misses in the same guard
but fail at DIFFERENT layers. Shape 1: `git -C >out /MAIN commit -m x` is a real `main` mutation (argv: `[-C] [/MAIN] [commit] [-m] [x]`)
that the worktree contract does **not** enforce. Both of `git-safety.sh`'s layers miss it
independently, for two different reasons, so closing either one alone leaves the route open.

## Background

Found during the review of PR #956 (`fix(hooks): see a redirect between git and its verb in the
worktree contract`), which closed the redirect-**between**-`git`-and-its-verb position. This is a
**sixth** redirect position that PR did not cover and that its residual list at
the `NOT CLOSED` residual list in `git-safety.sh` does not name — the omission matters because that list is written to read as
complete ("a residual list naming only one reads as completeness and the omitted one is the live
route"), and this position sits _inside_ the very group PR #956 widened, which is exactly where an
implementer is most likely to assume coverage.

**This is NOT a regression introduced by #956.** `main` allows these rows identically. It is a
pre-existing gap, filed separately so PR #956 stays scoped.

## Evidence

**Structural (verified directly against the files, 2026-09-16):**

- Matcher, the `MUTATING_GIT_SEG_RE=` assignment in `git-safety.sh` — it spells the separate-arg globals as
  `-C[[:space:]]+[^[:space:]]+` (and the same shape for `-c`, `--git-dir`, `--work-tree`). The
  value class `[^[:space:]]+` happily consumes `>out`, so `>out` is eaten _as the `-C` value_.
  What is left is a bare `/MAIN` token, which matches neither the `-[^[:space:]]+` flag arm nor
  `_CMD_REDIR` — so the whole segment falls off the matcher.
- Tokenizer, the `pend` dispatch inside `git_c_target` in `git-safety.sh` — the `if (pend == "C") { fold(w); pend = ""; return }` branch
  sits **above** the redirect-classifying arm at the `index(w, "<")` redirect arm
  (`if (!tnt && (index(w, "<") || index(w, ">")))`). Because `pend` was set by the preceding
  `-C`, the redirect arm is never reached and `>out` is folded as a **relative** `-C` value,
  which then resolves under cwd — the wrong repo.

**Behavioural (measured in the PR #956 security review; reproduce before relying on it):**

- argv ground truth via an out-of-band shim, identical under bash 3.2.57, bash 5.3.15 and zsh 5.9:
  - `git -C >out /MAIN commit -m x` -> `argv: [-C] [/MAIN] [commit] [-m] [x]`
  - `git --work-tree >out /MAIN reset --hard` -> `argv: [--work-tree] [/MAIN] [reset] [--hard]`
  - `git --git-dir >out /MAIN/.git commit -m x` -> `argv: [--git-dir] [/MAIN/.git] [commit] [-m] [x]`
- Against the real hook with the suite's registry fixture, cwd = the registered worktree: all
  value-slot rows ALLOW on both `main` and the #956 branch.
- Two-sided controls held in the same run: `git -C $MAIN commit -m x` DENY on both hooks, and
  `git 2>/dev/null -C $MAIN commit -m x` ALLOW on `main` / DENY on the branch (proving the #956
  adoption was engaged in the probe rather than the harness being inert).

### Shape 1b — the same value slot, with a brace-fd token

Reachable because the guard now knows the brace token class: `git -C {fd} >o <main> commit -m x`,
`git --git-dir {fd} >o <main>/.git commit -m x`, `git --work-tree {fd} >o <main> reset --hard`.

The `pend` arms fire before the brace class, so the brace word is folded as a **relative** value
and resolves under cwd. Measured emissions from `git_c_target`: `c {fd}`, `g {fd}`, `w {fd}` — so
the real `-C <main>` is never mined. `origin/main` allows these identically; a gap, not a
regression. Pinned as KNOWN-WRONG rows.

Whatever fixes shape 1 must cover this spelling too: both are the same value slot, and a fix that
only teaches the matcher about a bare redirect will leave the brace-fd form open.

## Shape 2 — a parameter expansion in the fd slot (matcher-side only)

Distinct from shape 1 and worth keeping separate in the fix: here the **matcher** misses, so the
tokenizer is never consulted at all.

`git ${nope}>o -C <main> commit -m x` and the unbraced `git $nope>o -C <main> commit -m x` both
produce a real main-mutating argv — `[-C] [/MAIN] [commit]` — under **both** bash 5.3.15 and
zsh 5.9, so unlike the brace-fd family this shape does not depend on zsh-only lexing. `_CMD_REDIR`
spells the fd prefix as `([0-9]*|[{]...[}][[:space:]]*)`, which admits neither `${nope}` nor
`$nope`, so `MUTATING_GIT_SEG_RE` never matches the segment.

`main` allows both identically — an un-closed gap, not a regression. Pinned as KNOWN-WRONG rows
in `test-git-safety.sh` and named as residual class 5 in `git-safety.sh`.

Note the interaction that makes this worth fixing with shape 1 rather than after it: an expansion
that is EMPTY at runtime leaves a bare redirect the guard already models, while a non-empty one
becomes an fd number. The guard cannot know which, so the safe reading is that any expansion in
the fd slot is a redirect prefix.

## Acceptance Criteria

- [ ] The matcher no longer lets a redirect-shaped token satisfy the separate-arg value class of
      `-C` / `-c` / `--git-dir` / `--work-tree`, and the segment still matches as a mutating git
      command (it must become a DENY, not merely stop matching).
- [ ] The tokenizer classifies a redirect **before** the `pend` checks in `git_c_target`, so a
      redirect token is never folded as a `-C`/`--git-dir`/`--work-tree` value.
- [ ] **Both layers are fixed and pinned independently** — one assertion per layer. A one-layer
      fix leaves the other open, so a single passing row is not evidence the route is closed.
- [ ] These DENY from a registered worktree cwd: `git -C >out $MAIN commit -m x`,
      `git --work-tree >out $MAIN reset --hard`, `git --git-dir >out $MAIN/.git commit -m x`.
- [ ] Two-sided controls in the same run: `git -C $MAIN commit -m x` still DENYs, and a legitimate
      `git -C <path-inside-the-worktree> commit` still ALLOWs — no new over-deny.
- [ ] The corpus is generated by inserting each operator at **every slot** of a token list, not by
      enumerating slots by name (a named-slot list reproduces whatever the author already had in
      mind — which is how this position was missed the first time).
- [ ] `git-safety.sh`'s residual list is updated: this position is removed from the residuals once
      closed, and any KNOWN-WRONG rows for it in `test-git-safety.sh` become `assert_deny`.
- [ ] **Shape 1b:** the brace-fd spelling of the value slot denies too, and the fix is the same
      one as shape 1 rather than a second special case.
- [ ] **Shape 2:** `_CMD_REDIR` admits a parameter expansion in the fd slot, so
      `git ${nope}>o -C $MAIN commit -m x` and `git $nope>o -C $MAIN commit -m x` both DENY from a
      registered worktree cwd. Because this is a MATCHER fix on a constant with multiple
      consumers, verify every consumer of `_CMD_REDIR`, not just `git-safety.sh`.
- [ ] **Shape 2 control:** a literal `$` in a filename target (no expansion) is unaffected, and no
      safe-idiom row in the FALSE-DENY sweep starts denying.

## Implementation Notes

- The fix must move redirect classification above the `pend` checks in `git_c_target`, **and**
  stop the matcher's value class from swallowing a redirect-shaped token. The two edits are
  independent; neither alone closes the route.
- `_CMD_GIT_GLOBALS` in `.claude/hooks/lib/cmd-detect.sh` carries the same separate-arg value
  class and is shared by other consumers — check whether the fix belongs there rather than only in
  `git-safety.sh`, and widen the detector and its consumers in ONE change.
- Related, already fixed in PR #956 and worth reading first as the worked example: the brace-fd
  class (the `rpre ~ /^[{]...[}]$/` test in `git_c_target`) was narrower than `_CMD_REDIR`, which is the same
  matcher/consumer-divergence shape.

## Scope Contract

- **Mechanisms to use:** the existing matcher regex and the existing awk tokenizer in
  `git-safety.sh` — reorder/tighten what is there. No new gate, no new classification concept.
- **Files in scope:** `.claude/hooks/git-safety.sh`, `.claude/hooks/test-git-safety.sh`, and
  `.claude/hooks/lib/cmd-detect.sh` only if the shared `_CMD_GIT_GLOBALS` value class is the right
  home for the matcher half.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None blocking. **File contention:** `lib/cmd-detect.sh` is also touched by
  `P1-2026-09-12-merge-review-guard-extractor-miss-is-a-silent-allow` and
  `P1-2026-09-15-a-root-flag-whose-value-is-a-bare-dash-...` — serialize, do not run concurrently.

## Risks

- `.claude/hooks/**` feeds main's **required** `Outward-CLI guard corpus` check. A careless edit
  wedges every open PR in the repo. Mutation-verify against **branch merged with current main**,
  never the bare branch tip.
- Tightening the matcher's value class risks over-denying a legitimate `-C` value that contains a
  redirect character. Pin an allow-side control so the tightening is shown to be one-directional.
- These hooks run under **bash**; the interactive shell here is **zsh**, which does not word-split
  unquoted parameter expansion. Assert the interpreter in any probe's own output.

## Updates

### 2026-09-16

- Filed from the PR #956 security review. Structural claims re-verified directly against the
  files; behavioural argv/hook measurements carried over from that review and flagged as
  reproduce-before-relying-on.
