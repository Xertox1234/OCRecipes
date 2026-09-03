---
title: "cmd_bare/cmd_words treat quoted \$(...) and backtick command substitution as inert data"
status: done
priority: high
created: 2026-08-17
updated: 2026-09-02
assignee:
labels: [security, harness]
github_issue:
---

# cmd_bare/cmd_words treat quoted \$(...) and backtick command substitution as inert data

## Summary

Neither `cmd_bare` nor `cmd_words` (`.claude/hooks/lib/cmd-detect.sh`) special-cases
`$(...)`/backtick command substitution: content inside a double-quoted (or backtick)
span is blanked/neutralized like any other quoted data, even though bash always
**executes** `$(...)`/backticks regardless of surrounding quotes. This lets a real,
executing outward-facing command hide from every guard by wrapping it in ordinary
double quotes — no exotic quoting trick required.

## Background

Surfaced during the `/code-review` follow-up pass on PR #850
(`fix/cmd-words-quoting-bypass`), 2026-08-17, and empirically reproduced by piping
crafted tool-call JSON into the live hook scripts:

- `echo "$(eas update --branch preview --platform all)"` → `guard-outward-cli.sh`
  returns exit 0, no deny. This is a REAL, WORKING bash command that publishes a live
  OTA update via the embedded command substitution. Control: the unquoted form
  `eas update --branch preview --platform all` is correctly denied by the same hook,
  confirming the gap is specifically the quoting, not a missing pattern.
- `echo "$(gh pr merge --admin 42)"` and `echo "$(gh api -X POST repos/o/r/merges)"` —
  both verified to return exit 0 / no deny, both real, executing GitHub API mutations
  (bypassing the `--admin` carve-out check and the mutating-HTTP-method check
  respectively).
- `echo "$(gh pr create --fill)"` — verified to return exit 0 (allowed), no
  preflight-stamp gate JSON emitted, versus the bare form which correctly triggers the
  gate.

**Mechanism**: inside `cmd_words`'s quote-state scan, `neutral()` (the set of
characters a quoted span turns into placeholders) includes `(`, `)`, backtick, and
whitespace — so `"$(eas update ...)"` collapses to a single opaque placeholder-laden
token instead of being recognized as "this text is executed regardless of the quotes
around it." `cmd_bare` has the same blind spot (it blanks the whole span, substitution
included).

**Severity note, why this is arguably the most severe finding of the whole review
round**: it needs no crafting beyond ordinary double quotes (not an ANSI-C `$'...'`
trick, not a mid-word empty span) and grants full command EXECUTION bypass of the
deny gate, not just detection evasion of a matcher.

**Not introduced by PR #850** — confirmed the identical bypass exists on `main` before
that branch (same `echo "$(eas update ...)"` input, same exit 0). This is a
pre-existing, structural gap in the whole quote-scanning approach, not a regression.

## Acceptance Criteria

- [x] Design decision made and documented: **(c) adopt a different detection
      mechanism entirely** — decided by the user 2026-08-29 (see Updates). Decided:
      delegate to a real shell tokenizer (e.g. bash's own parser in a restricted
      subshell) instead of extending `cmd_bare`/`cmd_words`'s hand-rolled awk
      quote-scanner with a 7th special case. This top-level choice is settled; the
      specific tokenizer implementation approach is a design/spike that belongs to
      implementation, not a re-opening of this decision (see Scope Contract).
- [x] All four reproduction cases above (`eas update`, `gh pr merge --admin`,
      `gh api -X POST`, `gh pr create`) correctly deny/gate after the fix — re-verified
      directly on this branch (not inherited from the parked commit's claim); see Updates.
- [x] Regression tests added to `test-cmd-detect.sh` (the prior accepted session added
      +168 lines there for the lib-level scanner) and the relevant end-to-end `test-*.sh`
      file (`test-pr-verify.sh`, this session, 30 new assertions across two review-driven
      fix rounds), piping the exact reproduction strings into the live hooks.
- [x] Full `scripts/run-hook-tests.sh` suite still passes — 34/34 files, exit 0.

## Implementation Notes

This is the specific instance the reviewer's "altitude" finding flagged as a systemic
concern: this branch's own commit history shows SIX separate CRITICAL bypasses found
and closed one at a time, each by adding another special case to the hand-rolled awk
quote-scanning state machine (`ANSI-C quoting → escaped-space → NAME=value splitting →
empty-span → $-sigil → argv-word-boundary`). This finding (command substitution) may be
bypass #7 in that same pattern, or it may be the signal to step back: a real shell
tokenizer (e.g. `bash -c 'read -a words <<<"$CMD"'` under careful sandboxing, or
delegating to bash's own parser in a restricted subshell) would get quoting, escaping,
ANSI-C quoting, AND command-substitution-always-executes semantics for free, closing
this entire CLASS of bug rather than one variant per review round.

**Decided 2026-08-29 (see Updates and Acceptance Criteria): the tokenizer option, not
a 7th awk special case.** The evaluation this paragraph originally left open is closed —
the remaining work is a design/spike on the specific tokenizer implementation approach
(see Scope Contract), not a re-litigation of tokenizer-vs-awk-patch.

## Scope Contract

<!-- Decision made 2026-08-29 (see Updates): option (c), a real shell tokenizer. The
     first step of implementation should still be a design/spike evaluating the
     specific tokenizer approach before committing to line-by-line hook changes. -->

- **Mechanisms to use:** a real shell tokenizer (e.g. bash's own parser invoked in a
  restricted subshell) to replace `cmd_bare`/`cmd_words`'s awk-based quote-scanning,
  rather than adding another special case to the existing state machine.
- **Files in scope:** `.claude/hooks/lib/cmd-detect.sh` and every hook that consumes
  `cmd_bare`/`cmd_words` (`.claude/hooks/{guard-outward-cli,pr-preflight-guard,
branch-preflight,commit-verify,core-bare-guard,drift-detect,drift-detect-update,
pr-verify}.sh`), plus their test files.

## Dependencies

- None. Independent of `todos/P1-2026-08-17-cmd-position-anchor-boundary-gaps.md`
  (same review round, different root cause).

## Risks

- This is a structural change to the core detection mechanism, not a narrow bugfix —
  budget real design time, not a quick patch. A rushed fix here has historically
  (per this same PR's commit history) introduced a NEW bypass while closing the old
  one.

## Updates

### 2026-08-17

- Filed from the PR #850 `/code-review` follow-up pass, per user decision to file
  pre-existing repo-wide gaps for a dedicated session rather than expand this PR's scope.

### 2026-08-29

- A `/todo` orchestrator run flagged this todo as structurally undecided-architecture-
  on-a-security-deny-gate (the same shape as the already-`human_led`-gated sibling
  `P3-2026-08-16-command-guards-fire-on-heredoc-prose.md`) and, rather than dispatching
  it unattended, surfaced the choice to the user directly. **Decision: (c) — replace
  the detection mechanism.** Delegate to a real shell tokenizer instead of extending
  the awk quote-scanner with a 7th special case. This top-level choice is settled; not
  implemented in this session — the specific tokenizer implementation approach is a
  genuinely open-ended first step (a design/spike, per the todo's own Risks section),
  and deserves a dedicated, full-context session (recommended: `/todo-fast` given its
  priority) rather than being squeezed into a batch run's tail end.

### 2026-09-02

- An unattended `todo-executor` dispatch (not the recommended `/todo-fast`) ran the
  design/spike this todo's own 2026-08-29 entry called for, then implemented against
  it. Recorded here in full because the spike findings are the load-bearing input the
  open question below depends on — **do not discard this entry when re-dispatching.**
  **Blocking rather than merging**, on independent advisor review, because the
  question below is a decision only the human who made the 2026-08-29 call can
  settle, not a code bug this agent can fix its way past.

  **Spike: three "real shell tokenizer" mechanisms evaluated, all rejected with
  cause** (this repo's bash 3.2.57 runtime, verified by direct probing):
  1. Bash's own DEBUG-trap (`set -T`) + `extdebug` "veto the pending command" trick —
     non-functional on this runtime.
  2. The `shell-quote` npm package (already a dependency) — does not distinguish live
     `"$(...)"` from inert `'$(...)'` at all; wrong tool for this problem.
  3. The `bash-parser` npm package — unmaintained since ~2022, built on deprecated
     `babylon`, 21 transitive deps; rejected as unacceptable supply-chain risk for a
     security-critical local guard.

  **What was built instead**: a genuinely recursive, stack-based awk scanner
  (`cmd_extract_substitutions` in `.claude/hooks/lib/cmd-detect.sh`) that tracks
  quote/nesting state per depth level, plus `cmd_words_deep` (unions `cmd_words` over
  the command and over every extracted substitution body) wired into 5 of 6
  `cmd_is_*` predicates and into `guard-outward-cli.sh`'s pattern matchers — every
  deny/warn-shaped consumer. The one grant-shaped read (`gh pr merge --auto`'s
  carve-out `CLAUSE`) deliberately stayed on the shallow, non-widened rendering.

  **Two CRITICALs found by the mandatory review round (both fixed, both now pinned
  with mutation-verified regression tests — `test-cmd-detect.sh` 395/395,
  `test-guard-outward-cli.sh` 257/257, full `scripts/run-hook-tests.sh` 34/34 green)**:
  1. (security-auditor) The `--auto` carve-out's `CLAUSE` extraction trusted
     `cmd_words`'s "one quoted span = one word" invariant, which a substitution
     containing its own internal double-quoted argument falsifies — manufacturing a
     forged, free-standing `--auto` token from what is really one opaque argv word.
     Fixed by denying whenever `CLAUSE` contains any literal `$`.
  2. (code-reviewer) The new scanner's double-quote state incorrectly mirrored the
     top-level state's `$'`/`$"` sigil handling, which are word-START constructs in
     real bash — meaningful only where a new word begins, never mid-word inside an
     already-open double quote. A live substitution immediately following such a
     sigil was silently skipped. Fixed by removing the mirrored branches (matching
     `cmd_bare`/`cmd_words`'s own proven, sigil-free double-quote handling).

  **The open question (why this is blocked, not merged)**: the Scope Contract
  mandates "a real shell tokenizer (e.g. bash's own parser invoked in a restricted
  subshell)... rather than adding another special case to the existing state
  machine" — the literal decision from 2026-08-29. The delivered
  `cmd_extract_substitutions` is a hand-rolled, character-by-character awk scanner —
  architecturally new (stack-based, not a state bolted onto the old flat FSA) but
  still hand-rolled, not a delegation to a real parser. Reviewer #2's CRITICAL is that
  this is the exact mechanism category the 2026-08-29 decision rejected, and that
  CRITICAL #1 above is evidence the concern is substantive, not procedural: a brand
  new hand-rolled scanner, built with an explicit stack design specifically to avoid
  the old bugs, still shipped a live bypass in its first review pass — found by a
  reviewer, not by this agent's own corpus or mutation testing, despite substantial
  effort on both.

  **ACTION NEEDED (human)**: decide whether the hand-rolled recursive extractor is
  acceptable given no viable off-the-shelf or bash-native tokenizer exists on this
  project's runtime (the three alternatives above, with cause), or whether the todo
  needs re-scoping (e.g. an explicit amendment accepting a hand-rolled mechanism
  under stated conditions, or a different runtime/dependency tradeoff). If approved
  as delivered: the implementation is complete and green in the worktree the
  executor ran in (uncommitted — recovering it requires either that worktree still
  existing, or redoing the diff from this Updates entry as a guide; the mechanism
  design and both CRITICAL fixes are fully described above and in the code's own
  inline comments). Two smaller items also need a decision when this is
  re-dispatched: `pr-verify.sh` is named in-scope by the Scope Contract but was not
  updated (both reviewers flagged this as a gap); and the WARNING-tier findings above
  are already fixed and pinned, no further action needed on those two specifically.

### 2026-09-02 (resumption)

- **User ruling (verbatim rationale)**: ACCEPT the hand-rolled recursive-stack awk
  scanner built in the prior session (`cmd_extract_substitutions` + `cmd_words_deep`,
  `.claude/hooks/lib/cmd-detect.sh`, committed at `bc1be557`), rather than requiring a
  "real shell tokenizer" per the Scope Contract's original wording. Rationale: no
  viable off-the-shelf or bash-native tokenizer exists on this runtime (this project's
  bash 3.2.57) — three alternatives were evaluated and rejected with cause: bash's own
  DEBUG-trap + extdebug veto trick is non-functional on this runtime (verified by
  direct probing); the `shell-quote` npm package (already a dependency) cannot
  distinguish a live `"$(...)"` from an inert `'$(...)'` at all; the `bash-parser` npm
  package is unmaintained since ~2022, built on the deprecated `babylon` parser, with
  21 transitive deps — an unacceptable supply-chain addition for a security-critical
  local guard. This top-level architecture question is not re-litigated in this
  session.

- **What was actually done in this session**: the one remaining gap flagged by both
  `code-reviewer` and `security-auditor` in the prior session — `.claude/hooks/pr-verify.sh`
  is named in-scope by the Scope Contract but its two consumer functions
  (`cmd_gh_pr_write_subcommand`, `cmd_gh_pr_ref`, used ONLY by pr-verify.sh) still read
  plain `cmd_bare`, which blanks a `"$(...)"` span whole, substitution included,
  exactly like the bug this todo exists to close. Fixed by adding `cmd_bare_deep()` to
  `.claude/hooks/lib/cmd-detect.sh` (the same combinator idiom as the existing
  `cmd_words_deep()`, built on `cmd_bare` instead) and rewiring both functions onto it.
  Also added `cmd_bare_deep` to `test-cmd-detect.sh`'s declared-function existence loop
  (it was missing — a completeness gap in the new function, not a behavior bug).

- **How this was verified (only what was actually run — no inherited/unverified
  claims)**:
  - Constructed `echo "$(gh pr merge --admin 42)"` and ran it against the UNMODIFIED
    `pr-verify.sh` with a PATH-stubbed `gh` recording its argv: confirmed `gh` was
    NEVER invoked (the bypass is real), versus the unquoted control
    `gh pr merge --admin 42`, which correctly invoked `gh pr view 42`. Re-ran the same
    input after the fix: now correctly invokes `gh pr view 42`. Also verified the
    backtick form, an env-assignment form, and a negative control (genuinely inert
    single-quoted `$(...)`, which correctly stays silent both before and after the
    fix).
  - Mutation-tested: reverted `cmd-detect.sh` to the pre-fix committed state
    (`git checkout --` against a saved patch), confirmed exactly the 8 new
    fix-dependent assertions FAIL while the negative-control assertions still pass;
    restored via `git apply`; confirmed all pass again.
  - **Code review round 1 (`code-reviewer`) found a CRITICAL**: the `cmd_bare_deep`
    rewiring made `cmd_gh_pr_ref` (the PR-ref extractor, a VALUE-returning function —
    unlike its boolean sibling `cmd_gh_pr_write_subcommand`) report a **confidently
    WRONG** PR ref, not a safe "could not verify", via three independent mechanisms:
    a nested substitution (`gh pr merge 4$(echo 9)2`, real ref 492, resolved to the
    wrong 42 — a nested substitution leaves a "hole" with no textual trace in its
    parent body, per `cmd_extract_substitutions`'s own documented contract); an
    embedded quote (`gh pr merge 4'x'2`, real ref 4x2, resolved to the wrong 4 —
    `cmd_bare` blanks the quote to whitespace, truncating the positional match); and
    an embedded backslash-escape (`gh pr merge 4\x32`, real ref 4x32, resolved to the
    wrong 4 — same blank-to-space mechanism). Verified all three by construction
    against the actual hook (PATH-stubbed `gh`) before accepting the finding. Fixed
    with a dedicated refuse-guard in `cmd_gh_pr_ref` (refuse when more than one live
    substitution exists anywhere in the command, or when a single substitution body
    contains a quote/backslash character) — `cmd_gh_pr_write_subcommand` is
    unaffected (boolean detection stays correct even when the exact ref is
    corrupted). Also corrected the `cmd_bare_deep` header comment, which had
    incorrectly claimed widening was safe for both pr-verify.sh callers — it is only
    safe for the boolean one, and that overstatement was the reasoning gap that let
    the CRITICAL ship. Mutation-tested the same way (revert guard → exactly the 6 new
    assertions fail; restore → pass). Pinned as Tests 38-40 in `test-pr-verify.sh`.
    One fix cycle (`REVIEW_ROUNDS: 1`); a scoped round-2 review of just this fix was
    also dispatched — see the PR for its outcome.
  - **`security-auditor`'s own (unscoped) review round, dispatched in parallel with
    `code-reviewer` against the pre-fix tree, independently re-derived and confirmed
    the same CRITICAL** (already fixed by the time it reported) by construction, and
    found one additional real WARNING: `cmd_gh_pr_write_subcommand` (the boolean
    consumer) piped `cmd_bare_deep`'s function call directly into
    `grep -oE | grep -oE | head -1`, the same unsound shape this file's own
    `cmd_is_gh_pr_create` header documents — confirmed empirically (135KB/5000-clause
    stress input, rc=141 piped directly). Fixed by capturing into a local first,
    matching every other deep-reading predicate in this file. Also flagged (WARNING,
    confirmed PRE-EXISTING — replayed against the original `bc1be557` baseline and
    got the byte-identical result, not introduced or worsened by this session): a
    `create` mention anywhere in the outer command text can win `head -1`'s race in
    `cmd_gh_pr_write_subcommand` ahead of a genuinely live `merge`/`close`/`edit`
    hidden in a substitution, making pr-verify.sh report the wrong (current-branch)
    PR as verified. Deferred — the real fix belongs in `pr-verify.sh`'s own branching
    logic, not this extractor, and has a genuine tradeoff (a naive symmetric guard
    would break a currently-correct case); recorded in `DEFERRED_WARNINGS`, not
    fixed. One SUGGESTION (a redirect-glued ref mis-extraction, pre-existing,
    degrades safely) — not applied, out of scope.
  - **Process disclosure, for the record**: while constructing the CRITICAL's
    reproduction, `security-auditor` accidentally ran a REAL (non-stubbed) `gh pr
merge` against actual GitHub — a genuine outward-facing CLI mutation, against
    explicit instructions. The target PR (#492) was already merged, so the call was a
    no-op with no state change (confirmed via a follow-up read-only `gh pr view`).
    The reviewer caught its own mistake, switched to a PATH-stubbed `gh` for every
    subsequent construction, and disclosed the incident plainly rather than treating
    it as a code finding. Recorded here for the audit trail — no code action results
    from it, but it is the same incident CLASS this project's own memory already
    tracks (never let an agent exec an outward-facing PATH-resolved CLI).
  - Re-verified all four of the todo's original reproduction cases directly on this
    branch (not inherited from the parked commit's claim): `eas update`/
    `gh pr merge --admin`/`gh api -X POST` all correctly `deny` via
    `guard-outward-cli.sh` (exit 0, `permissionDecision: deny`); `gh pr create`
    correctly triggers the preflight-stamp gate via `pr-preflight-guard.sh`
    (`.claude/hooks/pr-preflight-guard.sh`, not guard-outward-cli.sh — corrected
    mid-session after first checking the wrong hook), identically to the unquoted
    control.
  - Ran the full `scripts/run-hook-tests.sh`: 34/34 files pass, exit 0 —
    `test-cmd-detect.sh` 395/395 and `test-guard-outward-cli.sh` 257/257 (both
    UNCHANGED baselines; this session's diff touches neither file's test assertions),
    `test-pr-verify.sh` 74/74 (up from 50 pre-existing; 24 new assertions across
    Tests 30-40). Also ran
    `npm run test:run` (525 files / 8351 tests passed), `npm run check:types` (clean),
    `npm run lint` (0 errors, 3 pre-existing warnings in unrelated files).
  - Enumerated every `cmd_bare`/`cmd_words` call site across the Scope Contract's file
    list to confirm pr-verify.sh's two functions were the only gap. Found one
    PRE-EXISTING, already-documented residual unrelated to this session's fix and out
    of scope: `cmd_is_git_branch_create` deliberately stays shallow (a decision from
    the prior, accepted session) — verified empirically that
    `echo "$(git checkout -b foo)"` is not detected by it (control: the unquoted form
    is). Also found and documented (pinned with tests, NOT fixed — safe-direction,
    narrow) a new residual specific to this session's fix: a bare/unquoted
    substitution with a leading space right after the opener (`$( gh pr merge 42)`)
    double-counts across the outer+extracted-body union and degrades to "could not
    verify" where the pre-fix code resolved it; the quoted form of the same shape is
    unaffected. See `cmd_bare_deep`'s own header comment in
    `.claude/hooks/lib/cmd-detect.sh` and `test-pr-verify.sh` Tests 35-37.
  - Analyzed merge overlap with four unmerged PRs (#907, #909, #906, #910) via
    `git merge-tree --write-tree` plus materializing each clean result into a
    throwaway worktree and running the full suite on it (never merged/rebased onto
    this branch). See the PR body for the full breakdown and the exact commit this
    analysis was run against.

- **Round 2 (`security-auditor`, scoped to just the CRITICAL fix commit
  `8e542515`) found a SECOND CRITICAL, in the sibling function this session's own
  fix had NOT touched**: `cmd_gh_pr_write_subcommand`'s corrected header
  (written earlier in this same session) claimed "widening only ever ADDS a
  redundant `gh pr view` lookup" — true in the narrowest sense, but incomplete:
  WHICH of `create|merge|close|edit` wins the function's `head -1` still
  determines WHICH lookup `pr-verify.sh` performs, and `create`'s branch
  (a no-args `gh pr view`, resolving the CURRENT branch's PR) is the ONLY one
  that skips `cmd_gh_pr_ref`'s ref-based guard entirely. A decoy `gh pr create`
  mention in the outer text (a trailing `#` comment — `cmd_bare` does not strip
  comments) racing a REAL `gh pr merge` hidden inside a live substitution let
  the decoy win, silently swapping which PR gets reported as verified.
  Constructed and ran: `echo "$(gh pr merge 42)" # gh pr create` really
  executes only `gh pr merge 42` (confirmed against real bash via
  `bash -c`), but pre-fix the hook took the create branch and reported the
  wrong PR. This is the exact failure class round 1 fixed for `cmd_gh_pr_ref`,
  reached through its boolean sibling instead — and it is the SAME issue
  round 1's `security-auditor` had already found and I had deferred as a
  WARNING (see above); round 2 elevated it to CRITICAL with full construction,
  which is why it is now fixed rather than deferred.
  Fixed with a **create-vs-rest co-occurrence guard**, narrower than a blanket
  "any two mentions" guard: an initial broader version (refuse whenever ANY
  two of the four keywords co-occur) was tried first and reverted after it
  broke 5 pre-existing, intentional passing tests (Tests 20/26/27/34/36) — a
  pure merge-vs-close (or similar) compound is ALREADY made safe by
  `cmd_gh_pr_ref`'s own separate multi-occurrence guard downstream (which
  degrades to the more informative "WARNING: could not verify" rather than
  bare silence), so guarding against it here too only threw away information
  for no safety gain. The narrower fix refuses only when `create` co-occurs
  with `merge`/`close`/`edit` — the one combination whose branch has no
  downstream guard. Verified by construction (exploit input now returns
  empty/silent; the exact hidden-merge-with-no-decoy case from round 1 still
  resolves correctly end-to-end; a pure merge-vs-close compound still emits
  the informative WARNING, not silence). Mutation-tested the same way as
  round 1 (save diff → `git checkout --` → confirm exactly Test 41's two
  assertions fail, all others including the new precision-control Tests 42-43
  unaffected → `git apply` → confirm all pass). Pinned as Tests 41-43 in
  `test-pr-verify.sh` (74 → 80 assertions). Re-ran the full
  `scripts/run-hook-tests.sh`: 34/34 files pass, exit 0 (`test-pr-verify.sh`
  80/80, `test-cmd-detect.sh` 395/395, unchanged elsewhere). `REVIEW_ROUNDS: 1`
  stands — both the CRITICAL and the WARNING fixed in this Updates entry came
  out of the SAME review round (code-reviewer + security-auditor dispatched
  together against the initial diff); round 2 was a scoped re-verification of
  round 1's fix commit specifically, not a second full review round, and its
  own finding was fixed directly rather than triggering a round 3 dispatch.
  Also added two SUGGESTION-tier documentation-only notes to `cmd_gh_pr_ref`'s
  header (round 2's other two findings — an unevaluated arithmetic-expansion/
  `$VAR` residual, and the guard's empty-body short-circuit) — both confirmed
  structurally incapable of producing a clean, attacker-chosen wrong ref
  (always leaves stray shell-syntax punctuation), so documented as residuals
  rather than given a functional fix, matching this file's existing residual-
  documentation convention.

- **Out-of-scope finding surfaced, not fixed (per CLAUDE.md's High/Critical
  "ask first" rule — this is a DIFFERENT bypass class than this todo's, found
  incidentally while independently verifying round 2's reproduction, and is
  NOT auto-filed as a todo)**: `guard-outward-cli.sh` does not look inside a
  `bash -c '...'`/`sh -c '...'` string argument at all — the OUTER command's
  scanner correctly treats the single-quoted argument as inert DATA (it is,
  from the outer shell's own perspective), but `bash -c`/`sh -c` RE-PARSES
  that argument as a brand-new script and genuinely executes it. Constructed
  and ran directly against the hook (control alongside): `gh pr merge 42`
  (bare) → correctly denied (`permissionDecision: deny`); `bash -c 'gh pr
merge 42'` → ALLOWED (empty output, no denial JSON); `sh -c 'gh pr merge
42'` → ALLOWED; `bash -c 'echo "$(gh pr merge 42)"'` (the round-2 reviewer's
  own reproduction snippet, which is how this was noticed) → ALLOWED. This is
  a structurally different, likely broader gap than command-substitution
  quoting (any command hidden inside a `-c` string argument to any shell
  interpreter, not specific to `$(...)`) and is out of scope for this todo's
  Scope Contract (which lists `cmd_bare`/`cmd_words` consumers, not a new
  `-c`-argument-recursion mechanism). Flagging for the user to decide whether
  it becomes a dedicated todo.

- **Status**: flipped to `done` and archived.
