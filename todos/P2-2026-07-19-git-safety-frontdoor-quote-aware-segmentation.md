---
title: "git-safety mutating-git 'front door' is quote-blind — close the pre-existing main-mutation false-negatives (segment split + chained/quoted -C)"
status: backlog
priority: medium
created: 2026-07-19
updated: 2026-07-19
assignee:
labels: [deferred, harness, hooks, security]
github_issue:
human_led: true
---

# git-safety mutating-git front door is quote-blind — close the pre-existing bypasses

## Summary

`git-safety.sh`'s mutating-git CONTRACT branch decides _whether_ to examine a command
with a quote-blind regex + `tr ';|&'` pre-split (the "front door"), then extracts the
effective repo with the now-quote-aware `git_c_target` tokenizer (PR #665). The
front door is upstream of the tokenizer, so several **pre-existing** crafted inputs
never reach the (correct) extractor and a real MAIN-checkout git mutation is ALLOWED
past the contract. These are genuine **false-negatives / gate bypasses** on the
crown-jewel branch. All were confirmed against the live hook by the PR #665
code-reviewer + security-auditor pass.

## Background

PR #665 fixed the `-C` _extraction_ (greedy quote-blind `tr -d | sed` → role-aware
`git_c_target` tokenizer) and closed a bidirectional message-decoy bug. During that
PR's review, both reviewers independently showed the remaining bypasses all live in
the UNCHANGED quote-blind front door — "the fix hardened the extractor, but the gate
that decides whether the extractor runs is still quote-blind, so the new quote-awareness
is capped by a quote-blind gate." PR #665 corrected an earlier draft comment that
wrongly called the split residual "never a false-negative"; this todo is where the
false-negatives actually get closed.

`human_led: true` and **never delegate** — this is a live, blocking git gate protecting
the main checkout; changes must be verified fail-closed with truth-table-first TDD and
must not weaken any existing mutating-git guard test.

## Confirmed bypasses (live-hook repros; cwd = a registered worktree, contract active, real git → main)

1. **Metachar inside a `-c name=value` global option (before the verb) — FALSE-NEGATIVE.**
   `git -C <MAIN> -c core.pager='a;b' commit -m x` → **ALLOW** (should DENY).
   The full command matches `MUTATING_GIT_RE` (enters the loop), but `tr ';|&' '\n'`
   splits at the `;` _inside the quoted `-c` value_ into `git -C <MAIN> -c core.pager='a`
   (no verb → fails `MUTATING_GIT_SEG_RE`) and `b' commit -m x` (no leading `git` →
   fails). Neither fragment is examined → `VIOLATION` never set → ALLOW. Also fires with
   `&`, `|`, or a backslash-escaped `\;`. Control (`-c core.pager='ab'`, no metachar)
   correctly DENYs. NOTE the honest scoping: a split char AFTER the verb (in a `-m`
   message) is false-POSITIVE only (fragment keeps `git … <verb>`); only a split char
   BEFORE the verb is the false-negative.

2. **Chained / multiple `-C` — whole command invisible to the gate.**
   `git -C /tmp -C <MAIN> commit -m x` → **ALLOW**. Real git honors cumulative `-C`
   (absolute later wins → mutates `<MAIN>`), but `MUTATING_GIT_SEG_RE`'s `(-C…)?` group
   is 0-or-1, so a double-`-C` fails the segment regex entirely and the CONTRACT check is
   skipped. Fixing this needs BOTH the regex (allow ≥1 `-C`) AND `git_c_target`
   (cumulative last-absolute-wins resolution — today it emits only the first `-C`).

3. **Quote-blind command-word / flag recognition.** Each defeats `MUTATING_GIT_SEG_RE`'s
   literal-substring matching while real bash executes them against MAIN:
   - `git '-C' <MAIN> commit` / `git "-C" <MAIN> commit` — quoted `-C` flag.
   - `git -C<MAIN> commit` — glued `-C<path>` (NOTE: verify vs git; reviewer found bare
     `-C/path` may be rejected by git in some forms — confirm before spending effort).
   - `FOO="a b" git -C <MAIN> commit` — env value containing a space defeats the
     assignment sub-pattern (`FOO=x` control DENYs).
   - `g"i"t …`, `-"C" …` — quoting the keyword chars themselves.
     These are the same class as the already-accepted shell-wrapper residuals
     (`sudo`/`env`/`command`/`xargs`/subshell/`eval`) — decide per-case: close or document.

## Acceptance Criteria

- [ ] Replace the quote-blind `tr ';|&' '\n'` pre-split with quote-AWARE segmentation.
      Reuse the state machine already in this file — `emit_write_targets`' internal
      `segend()` splits on `|;&()` only when `st == 0` (outside quotes). Preferred shape:
      one quote-aware AWK pass over the whole `$CMD` that yields per-segment effective-repo
      decisions, replacing both the `tr` split and the per-segment `git_c_target` call.
- [ ] Handle chained `-C`: allow ≥1 `-C` in `MUTATING_GIT_SEG_RE`/`MUTATING_GIT_RE` AND
      teach `git_c_target` cumulative last-absolute-wins resolution (mirror real git). Add
      a red test: `git -C /tmp -C <MAIN> commit` → DENY.
- [ ] Decide (fix or explicitly document as accepted residual, with a test either way) the
      quoted-`-C`-flag, glued `-C<path>`, env-value-with-space, and quoted-keyword cases.
      If the regex is hardened to catch a quoted `-C` flag, make `git_c_target`'s `-C`
      recognition taint-TOLERANT in the same change (currently taint-strict and coupled to
      the regex's weakness — see the docstring note added in PR #665).
- [ ] Truth-table-first TDD in `test-git-safety.sh`: a red test per closed bypass, and the
      documented-residual cases asserted at their intended verdict. All existing
      mutating-git guards stay green; full 29-suite hook sweep green.
- [ ] Update the `git_c_target` docstring residual list + the solution doc as the residuals
      actually shrink (don't leave stale "tracked in this todo" pointers for closed items).

## Scope Contract

- **Files in scope:** `.claude/hooks/git-safety.sh`, `.claude/hooks/test-git-safety.sh`,
  and (only if a residual is codified) the quote-strip-escape-glue solution doc.
- **Mechanisms to use:** the existing in-file quote-state AWK machine
  (`emit_write_targets`/`git_c_target`); no new matching architecture, no new files.
- Do NOT weaken any existing mutating-git or write-shaped guard test.

## Risks

- Live, contract-gated blocking gate. A regression in the PERMISSIVE direction is a
  security hole; verify every change fails closed. Never delegate; primary session only.
- The segmentation rewrite touches EVERY mutating-git test path (not just `-C`), so it is
  higher-risk than the PR #665 extraction fix — hence a separate, deliberate landing.

## Updates

### 2026-07-19

- Filed from the PR #665 (`fix/git-safety-C-extraction-quote-aware`) review. The
  extraction fix shipped correctly; these front-door false-negatives are pre-existing
  (the split + regex are byte-identical on `main`) and deferred here for their own clean,
  fully-tested landing.
