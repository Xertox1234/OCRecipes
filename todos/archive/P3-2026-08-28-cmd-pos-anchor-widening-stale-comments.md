---
title: "Stale _CMD_POS_PREFIX/_CMD_POS_SUFFIX comments in guard-outward-cli.sh's test/header after the anchor widening"
status: done
priority: low
created: 2026-08-28
updated: 2026-09-02
assignee:
labels: [deferred, harness]
github_issue:
---

# Stale \_CMD_POS_PREFIX/\_CMD_POS_SUFFIX comments in guard-outward-cli.sh's test/header after the anchor widening

## Summary

`todos/archive/P1-2026-08-17-cmd-position-anchor-boundary-gaps.md` widened
`.claude/hooks/lib/cmd-detect.sh`'s `_CMD_POS_PREFIX`/`_CMD_POS_SUFFIX` to recognize
`{`, backtick, and `!` as openers and `;`, `&`, `|`, backtick, `{`, `}` as closers. Three
comments in files outside that todo's Scope Contract now describe the OLD, narrower
character classes and are factually stale.

## Background

Surfaced by the todo-researcher during implementation of the parent todo (2026-08-28).
Left unfixed there because `guard-outward-cli.sh` and `test-guard-outward-cli.sh` were
outside that todo's Scope Contract (`.claude/hooks/lib/cmd-detect.sh`,
`.claude/hooks/test-cmd-detect.sh`, `.claude/hooks/pr-preflight-guard.sh`,
`.claude/hooks/branch-preflight.sh` only).

Stale locations, each asserting `_CMD_POS_PREFIX`/`_CMD_POS_SUFFIX` still lack
brace/backtick/bang coverage (now false):

- `test-guard-outward-cli.sh:402` — "The lib's shared `_CMD_POS_SUFFIX` is
  `([[:space:]]|[)]|$)` — it omits `;`, `&` and `|`"
- `test-guard-outward-cli.sh:428` — "`_CMD_POS_PREFIX`'s separator class omitted the
  backtick, `{`, and the shell KEYWORD positions (then/do/else/elif/time) and `!`"
  (half-false: only the keyword-absorption delta — `then|do|else|elif|time`, deliberately
  NOT added to `_CMD_POS_PREFIX` by the parent todo — remains a real prefix difference)
- `guard-outward-cli.sh:23-40` header block ("COMMAND-POSITION ANCHORS ARE GUARD-LOCAL")
  — its suffix bullet claiming the lib's suffix never matches a terminal verb is now
  wrong; post-fix the lib's suffix is actually WIDER than the guard's own
  `_OUT_POS_SUFFIX` (the lib gained `{`/`}` as closers per the parent todo's Acceptance
  Criteria; the guard's `_OUT_POS_SUFFIX` does not have them).

**CORRECTED 2026-08-29 — this was NOT a comment-only gap; it was a live bypass, now fixed.**
`branch-preflight.sh`'s lib-unsourceable fail-closed fallback regexes (`GIT_COMMIT_RE`,
`COMPOUND_COMMIT_RE` — hand-rolled, independent of `_CMD_POS_PREFIX`/`_CMD_POS_SUFFIX`)
did not recognize brace/backtick/bang either, and were narrower than the (now-fixed)
primary path. The original framing below ("worth a one-line comment noting the
divergence is deliberate") was wrong on its own terms — the todo's own paragraph a
sentence earlier says "this was already true before the parent todo (the fallback never
shared the shared-lib anchors)," which is organic drift, not a decision, and a `code-reviewer`
pass during PR #874's review round reproduced it live: with the lib made unsourceable
(the `NOLIB` harness `test-branch-preflight.sh`'s Test 10 already uses), a real
detached-HEAD commit written as `{ git commit -m oops; }`, `` `git commit -m oops` ``,
or `! git commit -m oops` was **silently allowed** on `branch-preflight.sh`'s Check 1 — a
BLOCKING, not advisory, gate — where the bare form correctly denied. Per this repo's own
convention (`test-cmd-detect.sh`'s cross-hook fast-path invariant), "a fallback must be a
superset of what the primary matcher reads" — this violated it. **Fixed as part of this
PR's review-repair cycle**: `GIT_COMMIT_RE`/`COMPOUND_COMMIT_RE` now also recognize
`` ` ``/`{`/`!` as valid openers, with a two-sided regression test (`test-branch-preflight.sh`
Test 10b, confirmed RED against the old regex and GREEN against the fix). See AC below.

## Acceptance Criteria

- [x] `test-guard-outward-cli.sh:402`'s comment updated to describe the current
      `_CMD_POS_SUFFIX` (now ``([[:space:]]|[);&|`{}]|$)``), or reworded to note the
      guard's own `_OUT_POS_SUFFIX` is now narrower than the lib's in the `{`/`}` dimension.

      **State explicitly that this divergence is deliberate and must NOT be synced.**
      Reason (flagged by `security-auditor` during PR #874's review round): the guard's
      `_OUT_POS_SUFFIX` feeds the clause extraction at `guard-outward-cli.sh:567`, the one
      that gates the `--auto` immediate-merge carve-out flag scan. Adding `{`/`}` as
      closers there could truncate that extracted clause before a real `--auto` flag is
      reached — fail-safe direction (loses the carve-out, falls through to deny, not a
      live bypass), but still the wrong edit for whoever reads this comment next. This is
      exactly the "mirror the sibling's character class because they widened together"
      trap this same PR's own solution doc warns against.

      **CORRECTED 2026-09-02** — two things wrong with the paragraph above, found during
      this todo's own implementation and its two code-review rounds. (1) By 2026-09-02 the
      lib's `_CMD_POS_SUFFIX` had grown a SECOND time past this AC's `{`/`}`-only framing,
      to also include `<`/`>` — and unlike `{`/`}` (genuinely inert: a verb glued to a
      brace span stays one bash word), `<`/`>` are REAL bash redirect operators that DO
      split a glued verb into its own word. Their absence from `_OUT_POS_SUFFIX` is a LIVE,
      confirmed bypass of this hook (verified against the live hook: a redirect glued onto
      `eas update` or `gh pr merge` is silently ALLOWED where the spaced/bare form
      correctly denies) — not a cosmetic divergence to leave alone the way `{`/`}` are. (2)
      The truncation claim above was itself re-tested on 2026-09-02 and could not be
      reproduced; it is now understood to be structurally impossible for this pattern shape
      (a single-character suffix alternation cannot shorten the separate `[^;&|]*` capture
      adjacent to it — differentially tested across 9 constructed shapes, no truncation in
      any of them).

      **CORRECTED AGAIN, same day** — the "2026-09-02" correction directly above was
      itself wrong on the one claim it added: `{`/`}` are NOT inert. A second code-review
      round (`security-auditor`) constructed and ran `gh pr merge{,x} 42` /
      `npm publish{,x}` / `eas update{,x} ...` against the live hook and found all
      SILENTLY ALLOWED where the bare form correctly denies — a COMMA-form brace span
      glued to a verb is real bash brace EXPANSION (`merge{,x}` expands to the two
      separate words `merge` and `mergex`), not inert text. The NO-comma/NO-range case
      (`merge{x}`) genuinely does stay one word and was the only shape the first
      correction actually tested — it wrongly generalized "inert" from that one case to
      both. Per this todo's own precedent for `branch-preflight.sh` earlier in this same
      file (a "deliberate, don't touch" comment that was itself the defect, fixed rather
      than merely re-commented, deliberately exceeding the original Scope Contract), this
      was **fixed in-PR**: `_OUT_POS_SUFFIX` widened from `` ([[:space:]]|[);&|`]|$) `` to
      `` ([[:space:]]|[);&|`{}]|$) ``, with a two-sided regression test in
      `test-guard-outward-cli.sh` (confirmed RED against the pre-fix regex, GREEN after;
      a negative control pins that the genuinely-inert no-comma case still allows a
      different read-only verb glued the same way). `<`/`>` remain un-fixed and disclosed
      only — that half of the "flag for a human decision" framing stands.

- [x] `test-guard-outward-cli.sh:428`'s comment narrowed to the one delta that remains
      true: prefix keyword-absorption (`then|do|else|elif|time`) is guard-local; brace/
      backtick/bang are no longer guard-local. **Exceeded 2026-09-02**: this AC's "the one
      delta" premise was itself incomplete — a SECOND, reverse-direction delta was found
      during implementation (the lib separately gained prefix REDIRECT absorption
      `_OUT_POS_PREFIX` lacks — a live, unfixed gap, disclosed rather than fixed). The
      shipped comment states both directions rather than "the one delta."
- [x] `guard-outward-cli.sh:23-40` header block's suffix bullet updated to reflect that
      the lib's suffix was a superset of the guard's own in FOUR dimensions as of
      2026-09-02 (`{`, `}`, `<`, `>`, not the two originally cited). Both `{`/`}` and `<`/`>`
      turned out to be live bypasses (see AC above), not one live and one cosmetic as an
      earlier pass through this todo believed — `{`/`}` were FIXED in-PR, narrowing the
      guard's remaining gap to `<`/`>` only (disclosed, not fixed).
- [x] ~~One-line comment added near `branch-preflight.sh`'s `GIT_COMMIT_RE`/
      `COMPOUND_COMMIT_RE` noting the fallback deliberately does not share
      `_CMD_POS_PREFIX`/`_CMD_POS_SUFFIX`'s brace/backtick/bang coverage.~~ **Superseded
      2026-08-29**: this framing was wrong (see corrected Background above) — the gap was
      a real, live bypass, not a decision to document. Fixed instead of commented: both
      fallback regexes now recognize `` ` ``/`{`/`!`, with a two-sided regression test
      (Test 10b in `test-branch-preflight.sh`). Done as part of PR #874's own review-repair
      cycle, ahead of this todo — nothing left to do here for `branch-preflight.sh`.
- [ ] `bash scripts/run-hook-tests.sh` still passes.

## Implementation Notes

**Remaining scope (guard-outward-cli.sh + test-guard-outward-cli.sh) is still pure
comment/prose** — no regex or test-assertion changes needed there. Read the current
`_CMD_POS_PREFIX`/`_CMD_POS_SUFFIX` definitions in `.claude/hooks/lib/cmd-detect.sh`
(and their explanatory comment, which documents the widening) as the source of truth for
what the corrected prose should say. Also carry the "must not sync `_OUT_POS_SUFFIX`"
warning from the AC above into whichever comment ends up nearest `guard-outward-cli.sh`'s
`--auto` clause-extraction call site, not just the one at `test-guard-outward-cli.sh:402`.

`branch-preflight.sh`'s item was NOT comment/prose — see AC above; already done.

## Scope Contract

- **Mechanisms to use:** comment/prose edits only for `guard-outward-cli.sh` /
  `test-guard-outward-cli.sh` — no regex changes, no new test assertions there.
  `branch-preflight.sh` is now DONE (a real regex widening + regression test, not a
  comment — see corrected Background/AC above; this exceeds the original Scope Contract
  deliberately, because the original framing for that file was itself the defect).
- **Files in scope:** `.claude/hooks/guard-outward-cli.sh`,
  `.claude/hooks/test-guard-outward-cli.sh` (remaining); `.claude/hooks/branch-preflight.sh`
  - `.claude/hooks/test-branch-preflight.sh` (done, via PR #874's review-repair).
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. Depends conceptually on the already-merged
  `todos/archive/P1-2026-08-17-cmd-position-anchor-boundary-gaps.md` (the widening this
  todo's comments need to catch up to), but that todo is done, not blocking.

## Risks

- Low — comment-only change, but re-verify `bash scripts/run-hook-tests.sh` stays green
  since it touches files with self-tests, to catch an accidental syntax slip.

## Updates

### 2026-08-28

- Filed from the todo-researcher's findings during implementation of
  `todos/archive/P1-2026-08-17-cmd-position-anchor-boundary-gaps.md`, per the
  Deferred Item Todos policy (Low severity, out of that todo's Scope Contract).

### 2026-08-29

- A `code-reviewer` pass during PR #874's own review round (medium-effort, dispatched
  concurrently with reviews of #871–#875) constructed and ran the exact fallback-path
  bypass this todo's AC #4 had mischaracterized as "deliberate" — proved it silently
  allowed a real detached-HEAD commit through `branch-preflight.sh`'s BLOCKING Check 1.
  Fixed directly on PR #874 rather than merely re-commented: `GIT_COMMIT_RE`/
  `COMPOUND_COMMIT_RE` widened to recognize backtick/`{`/`!`, two-sided regression test
  added (`test-branch-preflight.sh` Test 10b). A `security-auditor` pass on the same PR
  additionally flagged that this todo's original AC #1 wording could mislead a future
  implementer into unsafely syncing `_OUT_POS_SUFFIX` to match — corrected above with an
  explicit must-not-sync warning and the concrete reason (`--auto` carve-out clause
  truncation risk). Remaining scope: the `guard-outward-cli.sh` / `test-guard-outward-cli.sh`
  comment corrections only — unchanged from the original filing, still pure prose.

### 2026-09-02

- Implemented via `/todo`. Short-circuited research onto
  `docs/solutions/logic-errors/cmd-position-anchor-missed-brace-backtick-bang-boundaries-2026-08-28.md`
  (tight match — the solution literally cites this todo). Corrected the three targeted
  comments (`test-guard-outward-cli.sh:402`, `test-guard-outward-cli.sh:428`,
  `guard-outward-cli.sh:23-40` header) against the CURRENT anchors — which had moved TWICE
  more since this todo was filed (`_CMD_POS_SUFFIX` gained `<`/`>` and `_CMD_POS_PREFIX`
  gained `_CMD_REDIR` absorption, 2026-09-01) — every claim verified by constructing and
  running inputs against the live hook, not by re-deriving from the regex text.
  - Two review rounds (`code-reviewer` + `security-auditor`, both rounds) found real
    defects in the CORRECTIONS themselves, not just leftover staleness: round 1 caught a
    blanket "don't sync any of {`,`}`,`<`,`>`}" framing that was wrong for `<`/`>` (a
confirmed live bypass, corrected above); round 2 caught that even the NARROWED
"`{`/`}` are inert" claim was itself wrong — a COMMA-form brace span glued to a verb
(`merge{,x}`) is real bash brace EXPANSION, not inert text, and was silently ALLOWED
at every `\_OUT_POS_SUFFIX`-gated call site. Per this todo's own `branch-preflight.sh`precedent above ("the original framing for that file was itself the defect" →
fix, don't merely re-comment),`\_OUT_POS_SUFFIX` was widened
`` ([[:space:]]|[);&|`]|$) `` → `` ([[:space:]]|[);&|`{}]|$) ``with a two-sided
regression test (RED against the pre-fix regex, GREEN after; confirmed across the`gh pr merge`/`npm publish`/`eas update`/`railway up`/`eas build --auto-submit` call
    sites, plus a negative control for the genuinely-inert no-comma case). This landed
    AFTER the Step 7 two-round review cap — a human should look at the regex change
    before merge, not just the prose.
  - Two live gaps remain confirmed but UNFIXED, out of this comment-only-except-the-`{}`-fix
    todo's scope: (1) `_OUT_POS_SUFFIX` still lacks `<`/`>` (a glued redirect, e.g. a verb
    immediately followed by `>`, is silently allowed); (2) `_OUT_POS_PREFIX` still lacks
    the lib's `_CMD_REDIR` absorption (a leading redirect before the verb is silently
    allowed). Both disclosed in the shipped comments (no working exploit string embedded)
    and surfaced in the executor's report as `DEFERRED_WARNINGS` — High-severity findings,
    per this repo's Deferred Item Todos policy, are surfaced for a human decision, never
    auto-filed as a todo.
  - `bash scripts/run-hook-tests.sh`: 34/34 suites green (`test-guard-outward-cli.sh`
    itself: 252/252, up from 248/248 pre-fix — 4 new assertions from the `{`/`}` fix).

### 2026-09-02 (PR #910 review-driven repair)

- **CORRECTION to the entry immediately above.** A post-merge review of PR #910 found the
  "at every `_OUT_POS_SUFFIX`-gated call site" claim in that entry was FALSE, and the
  five-call-site list it gives (`gh pr merge`/`npm publish`/`eas update`/`railway up`/
  `eas build --auto-submit`) — while each individually verified — was incorrectly read as
  covering every consumer. One call site was missed: `GH_API_CLAUSE`
  (`guard-outward-cli.sh`'s `gh api` clause-cut, used to scan for a mutating `-X`/`--method`
  flag) still hardcoded a literal `[[:space:]]` after `api` instead of `${_OUT_POS_SUFFIX}`.
  Its sibling `GH_API_RE` (the occurrence counter gating the SAME check, a few lines above
  it) WAS migrated in the original fix, so a comma-brace-glued `gh api{,x} -X POST
repos/o/r/pulls/1/merge` still counted as exactly one occurrence — but the clause-cut then
  matched nothing, the empty `$GH_API_CLAUSE` short-circuited the mutating-method scan, and
  the deny never fired. Confirmed SILENTLY ALLOWED before this repair (both the comma-brace
  form and the pre-existing backtick-glued form `gh api\`x\` -X POST ...`), by constructing
the input and running it through the hook — not by re-deriving from the regex text. Same
bug class as
`docs/solutions/logic-errors/occurrence-ambiguity-guard-applied-selectively-not-uniformly-2026-08-17.md`:
  a detector widened without its sibling consumer.
  - Fixed by mirroring the already-correct `gh pr merge` CLAUSE= pattern: `GH_API_CLAUSE`
    now reads `${_OUT_POS_SUFFIX}` instead of a literal space.
  - Also corrected a second, narrower prose defect the same review found: the "NO-comma/
    NO-range span (`merge{x}`) genuinely stays one word and was never the issue" framing in
    both `guard-outward-cli.sh` and `test-guard-outward-cli.sh` is true of BASH's own
    word-splitting but was never true of the shipped regex — `_OUT_POS_SUFFIX` makes no
    comma/no-comma distinction, so `gh pr merge{x} 42` and `gh pr merge{1..3} 42` (both
    genuinely one bash word, never brace-expanding) ALSO deny under the fix, same as the
    comma-expansion form. Deliberate conservatism, not a regression — but the comments
    described behavior the code does not implement, and have been corrected in place.
  - 4 new regression assertions added to `test-guard-outward-cli.sh` ("2026-09-02 FIX
    (round 2)" block): the comma-brace `gh api` deny, the backtick-glue `gh api` deny, a
    third distinct code shape (`GH_MUTATING_RE` family, via `gh release create{,x}` —
    already correct before this round, pinned to stay that way), and a `gh api -X GET`
    negative control. Mutation-tested: reverting the `GH_API_CLAUSE` fix alone took the
    suite from 256/256 to 254 passed/2 failed (exactly the two `gh api`-clause assertions
    went RED; the `GH_MUTATING_RE`-family assertion and the GET negative control were
    unaffected, confirming they exercise a different code path); restoring the fix returned
    256/256.
  - Full details, reproduction transcript, and updated PR body: PR #910.

### 2026-09-02 (PR #910 review-driven repair, continued — round 3, more severe than round 2)

- **A DIFFERENT and more serious defect, found while verifying the round-2 fix's own
  false-positive direction as instructed by review.** The `GH_API_CLAUSE` fix above is a
  DENY-direction check (over-capture can only ADD a deny — safe). Checking whether the SAME
  swallowing shape (`${_OUT_POS_SUFFIX}[^;&|]*`, which consumes the boundary character and
  keeps capturing past it) existed anywhere ELSE surfaced that `guard-outward-cli.sh`'s `gh
pr merge` `CLAUSE=` — untouched by rounds 1 or 2, present since before this PR — is the
  ONE clause-cut in this file whose downstream check DECIDES AN ALLOW on flag presence
  (found `--auto` in the clause → allow, subject to `--repo`/`--admin` elsewhere). For that
  one check, the same swallowing shape is dangerous: a verb glued DIRECTLY to a hard
  separator with no argument in between (`merge;`, `merge&`, `merge|`, or a close-paren
  closing a `$(...)` the verb sits inside) let the clause-cut consume the separator and
  capture straight into an UNRELATED, following command, picking up ITS `--auto` as a
  decoy. Confirmed a working, SILENT FALSE ALLOW before this fix (construct-and-run
  against the live hook):
  ```
  gh pr merge;curl --auto
  gh pr merge&curl --auto
  gh pr merge|curl --auto
  $(gh pr merge)curl --auto
  ```
  All four allowed an immediate, non-automerge `gh pr merge` to execute — three glued hard
  separators plus a `$(...)` close-paren, a structurally different construct sharing only
  the boundary character class — exactly the action this specific check exists to block.
  `gh_pr_clause_has_repo` (the sibling
  `--repo`/`-R` check) was confirmed NOT vulnerable to the analogous shape
  (`gh pr create;curl --repo evil/evil`) — its own clause-cut never used the swallowing
  `${_OUT_POS_SUFFIX}[^;&|]*` pattern to begin with.
  - **This also means PR #910's own "widening a DENY-only anchor's closer class can only
    ever ADD matches" argument — repeated in this document, in the archived-todo entries
    above, and in the PR body — does not extend automatically to every clause-cut built on
    that anchor.** It holds for the ANCHOR (where a clause starts/ends); it does not hold
    for what a clause-cut DOES with the captured text once the downstream check inverts
    from deny-on-presence to allow-on-presence. Codified as a new top-level section in
    `docs/solutions/logic-errors/cmd-position-anchor-missed-brace-backtick-bang-boundaries-2026-08-28.md`.
  - Fixed with a NEW, non-swallowing suffix variant scoped to this one consumer,
    `_OUT_POS_SUFFIX_MERGE_CLAUSE='([[:space:]][^;&|]*|[);&|`{}]|$)'`(defined next to`\_OUT_POS_SUFFIX`in`guard-outward-cli.sh`): capture continues only after a whitespace
    boundary; a hard separator/bracket or end-of-string ends the clause immediately with
    nothing captured past it — matches real bash command-position semantics (a verb glued
    to a hard separator has no arguments of its own).
  - 6 new regression assertions in `test-guard-outward-cli.sh` ("2026-09-02 FIX (round 3)"
    block): the four decoy-`--auto` denies, a sanctioned-`--auto`-stays-allowed positive
    control, and a regression pin for the already-correctly-bounded arg-token case.
    Mutation-tested: reverting the merge-clause fix alone took the suite from 262/262 to
    258 passed/4 failed — exactly the four decoy assertions went RED, the sanctioned-allow
    control and the arg-token regression pin were unaffected; restoring returned 262/262.
    `bash scripts/run-hook-tests.sh`: 34/34 suites green, zero `FAIL` lines in the full run.
  - While fixing this, re-verified the pre-existing, still-disclosed-but-unfixed `<`/`>`
    gap (round 1) specifically against the merge clause and found its severity was
    understated: `gh pr merge>log` (no `--auto`, no decoy, nothing to find) is silently
    ALLOWED because `>` glued to `merge` makes the DETECTOR itself fail to match — a total
    bypass, not merely a wrong-clause-capture issue, and NOT touched by this fix. Strengthened
    the disclosure comment in place; still out of this repair's scope, still a human decision.
  - PR #910's body and the `{`/`}` overclaim row corrected a third time to disclose this
    finding — see the PR for the final text.
