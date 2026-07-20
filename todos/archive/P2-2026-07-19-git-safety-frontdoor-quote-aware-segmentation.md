---
title: "git-safety mutating-git 'front door' is quote-blind — close the pre-existing main-mutation false-negatives (segment split + chained/quoted -C)"
status: done
priority: medium
created: 2026-07-19
updated: 2026-07-19
assignee:
labels: [deferred, harness, hooks, security]
github_issue:
human_led: true
blocked_reason: "Never delegate — live blocking git gate protecting the main checkout; changes must be truth-table-first TDD, verified fail-closed, primary session only"
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

4. **Gate separator boundary — single `|`/`&` before a mutating git — FALSE-NEGATIVE**
   (surfaced by the PR #665 pre-write advisor pass, not the original enumeration).
   `echo msg | git commit -F -` and `foo & git commit -m x` (cwd = main checkout) →
   **ALLOW**. The old whole-command `MUTATING_GIT_RE` gate anchored the command position
   on `(^|&&|\|\||;)`, which omits single `|` and single `&`, so the gate never fired and
   the per-segment check never ran. `… | git commit -F -` is normal (non-adversarial)
   usage. **FIXED in the `fix/git-safety-frontdoor-segmentation` PR** by demoting the gate
   to a permissive `*git*` pre-filter (the anchored per-segment SEG_RE is the real
   decision), which removes the boundary bug class outright.

5. **`$'…'` (ANSI-C) quote blindness in ALL THREE quote scanners — FALSE-NEGATIVE**
   (found by the PR #666 security review). None of `split_segments`, `git_c_target`, or
   `emit_write_targets` recognize bash `$'…'`: their single-quote state toggles on every
   `'` and ignores the `\'` escape, so inside `$'…\'…'` (a `\'` that bash treats as a
   literal apostrophe, NOT a close) their quote state INVERTS and they then mis-handle
   every following char. Confirmed live:
   - Mutating branch (was the split-attempt REGRESSION): `git -C <WT> commit -m $'don\'t
ship' && git reset --hard HEAD~1` (cwd = main) → bash runs the `reset --hard` in main;
     a `$'…'`-blind split merges it into the prior segment → **ALLOW**. (The blind `tr` split
     shipped in #666 does NOT have this — it splits everything — so #666 is safe; the
     quote-aware redo must handle `$'…'`.)
   - Write-shaped branch (**pre-existing bypass in already-merged code**, #664's
     `emit_write_targets`): `echo $'\'' > <MAIN>/f.txt` → the `>` is consumed inside the
     scanner's perceived quote, no target emitted → **ALLOW** (real bash writes into main).
     **Partial quote-awareness is worse than none on a security scanner** — fix `$'…'` in all
     three scanners in ONE change, ideally by factoring a single shared quote scanner so the
     three copies cannot drift (the root cause of this whole residual family).
     - **Sub-finding (`$$'…\'` even-dollar-run) — a SECOND regression in the `$'…'` fix, caught by
       the PR #666 re-review and FIXED in the same PR.** `$'` detection was context-free (any `$`
       before `'` → ANSI-C), but bash pairs a run of `$` into `$$` (PID); only an UNPAIRED `$`
       before `'` is ANSI-C. An even run (`$$'a\'`) is a NORMAL single quote in bash, so entering
       ANSI-C on the 2nd `$` desynced and swallowed the real `&&`. Fixed by consuming `$$` pairs
       before the `$'` check in all three scanners; regression tests added. Lesson: a hand corpus
       AND a hand differential both miss `$`-context you don't enumerate — the auditor's fuzz found
       it. (Reinforces the codified doc.)

6. **ANSI-C escape DECODING not modeled — decode-divergence FALSE-NEGATIVE (pre-existing residual).**
   `git -C $'\x2fmain' commit` / `rm $'\x2fmain\x2fx'` — bash decodes `\x2f`→`/`, mutating/writing
   `/main…`, but the scanners read `\xHH`/`\nnn`/`\uHHHH` as literal chars → a non-absolute string →
   resolves under cwd → ALLOW. Confirmed identical on `main` (pre-existing, NOT introduced). Obscure
   (needs deliberate hex/octal/unicode encoding); documented in the scanner docstrings. Fix (if ever):
   decode ANSI-C escapes in `st==3`, or a targeted defense (treat a decoded leading `/` as absolute).
   Same guardrail-not-sandbox class as chained-`-C`/wrappers; SKIP_WORKTREE_CONTRACT=1 is the backstop.

## Acceptance Criteria

- [x] **Gate boundary (#4) DONE (PR #666 `fix/git-safety-frontdoor-segmentation`).** The old
      whole-command `MUTATING_GIT_RE` gate anchored on `(^|&&|\|\||;)` — omitting single `|`/`&`
      — so `echo msg | git commit -F -` (a normal pattern) in the main checkout NEVER fired the
      gate. Fixed by demoting the gate to a cheap permissive `[[ "$CMD" == *git* ]]` pre-filter,
      letting the anchored per-segment `MUTATING_GIT_SEG_RE` be the sole precise decision
      (over-firing harmless; a non-git segment can't match `^…git…verb`) — removing the
      boundary-completeness bug class and deleting the buggy `MUTATING_GIT_RE`. Validation loop
      unchanged. 2 red tests (piped, backgrounded) + 2 guards — 61/61 green, 29-suite sweep green.
- [x] **Quote-AWARE segmentation DONE** (redo, in PR #666's `$'…'` version). Re-added
      `split_segments` (splits on _unquoted_ `;`/`|`/`&`/newline), now `$'…'`-complete so the
      earlier regression cannot recur. Closes bypass #1 (the `-c`-value fracture).
- [x] **`$'…'`-complete ALL THREE quote scanners DONE** (bypass #5): `split_segments`,
      `git_c_target`, and `emit_write_targets` each gained an explicit ANSI-C state (`st==3`:
      `\` escapes next incl. the apostrophe; only an unescaped apostrophe closes; BS checked
      BEFORE `$'` so `\$'…'` is a normal quote; `$"…"` needs nothing). Closes the pre-existing
      write-shaped `$'…'` bypass in merged #664 code. Drift guard is a SHARED TEST CORPUS (not a
      shared scanner — a shared-loop bug would break all three permissively; not a comment —
      comments are what failed), and a DIFFERENTIAL harness (old vs new hook over the corpus)
      confirmed **0 DENY→ALLOW regressions, 6 bypasses closed**. 69/69 + 29-suite green. Lesson
      codified: `docs/solutions/logic-errors/partial-parse-regresses-crude-total-safety-scanner-2026-07-19.md`.
- [x] **Chained/interleaved `-C` DONE** (branch `fix/git-safety-chained-c-resolution`).
      `MUTATING_GIT_SEG_RE`'s global-options group went `-C?-c*` → `(-C…|-c…)*` (≥1 `-C`, any
      order, interleaved with `-c` — a strict superset), AND `git_c_target` now folds EVERY
      command-position `-C` to the cumulative effective repo (last absolute wins, relatives
      append — empirically matches real git `chdir`), stopping at the verb. Red tests (all were
      ALLOW, now DENY): `git -C /tmp -C <MAIN> commit`, `git -C <WT> -C <MAIN> commit`, and the
      interleaved sibling `git -c x=y -C <MAIN> commit`.
- [x] **Quote-blind-flag family DECIDED → documented as ACCEPTED residuals.** Closing them means
      making the quote-BLIND SEG_RE quote-aware — new matching architecture (scoped out) or a
      partial quote-strip that reopens the decoy false-DENY class this chain fought to close
      ([[partial-parse-regresses-crude-total-safety-scanner]]). Quoted `-C` flag (`git '-C'
    <MAIN>`), space-bearing env value (`FOO='a b' git …`), quoted keyword (`g"i"t`) stay the
      same shell-wrapper residual class already accepted (sudo/env/subshell). **Glued `-C<path>`
      is a non-issue** — real git REJECTS it (`unknown option`, EXIT 129); pinned by a test at its
      ALLOW verdict. `git_c_target` `-C` recognition stays taint-STRICT (consistent with the
      un-hardened SEG_RE, per its docstring coupling note).
- [x] **Truth-table-first TDD DONE.** Red-first (3 chained/interleaved DENYs failed against the
      LIVE hook before the fix), + fail-open guards (last-`-C`-wins-to-worktree ALLOW), the
      `-C`-before-`-c` ordering control, stop-at-verb invariant guards (`git commit -C HEAD`),
      and the glued-form residual pin. 84/84 git-safety + full 29-suite hook sweep green; NO
      existing DENY flipped to ALLOW.
- [x] **Docstrings updated.** `git_c_target` opening rewritten (cumulative effective + stop-at-verb),
      chained-`-C` removed from its residual list, glued-form noted as git-rejected; the stale
      "tracked in this todo" pointers in both `git_c_target` and `split_segments` replaced with
      "ACCEPTED residual". Neither solution doc listed chained-`-C` as open, so no stale claim there.

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
- **Gate boundary (#4) FIXED; segmentation attempt REVERTED** (PR #666
  `fix/git-safety-frontdoor-segmentation`). Implemented quote-aware `split_segments` (closed
  bypass #1) AND the permissive-`*git*` gate (closed bypass #4, the advisor-found single-`|`/`&`
  boundary). The PR #666 security-auditor pass then caught a HIGH **regression**: `split_segments`
  was `$'…'`-blind, so `$'…\'…'` inverted its quote state and swallowed real separators — a
  partial quote model is worse than the blind `tr` split on a security gate. **Narrowed #666 to
  the gate fix only** (reverted `split_segments`, kept the permissive gate — provably a strict
  widening, both reviewers confirmed) and filed the whole `$'…'` class as its own AC (#5, now
  spanning all three scanners incl. a pre-existing write-shaped bypass in merged #664 code).
  #666: 61/61 + 29-suite green; P3/P4 (gate) DENY, P1/P2 (segmentation) deferred.
- **Lesson:** replacing a crude-but-total mechanism (`tr` splits at every separator) with a
  smarter partial one is a REGRESSION wherever the partial model has a hole. On a safety gate a
  conservative over-approximation beats a precise-but-incomplete one. The redo must be quote-COMPLETE
  (incl. `$'…'`) across all three scanners at once — hence the shared-scanner AC.

### 2026-07-20

- **Chained/interleaved `-C` CLOSED; residual family ACCEPTED → todo complete** (branch
  `fix/git-safety-chained-c-resolution`, worked by hand in the primary session per the
  `human_led` / never-delegate contract — the `/todo` batch orchestrator would have gated it out
  AND delegated to a subagent, both forbidden here). Empirically confirmed real git's cumulative
  `-C` (`git -C /a -C /b` → `/b`; `git -C /a -C rel` → `/a/rel`) and that glued `-C<path>` is
  git-REJECTED (EXIT 129, not a bypass). Changes: SEG_RE `-C?-c*` → interleaved `(-C…|-c…)*`;
  `git_c_target` first-`-C` → cumulative fold with stop-at-verb. The remaining quote-blind-gate
  cases (#3) are ACCEPTED guardrail residuals documented in the scanner docstrings; the ANSI-C
  escape-decode case (#6) stays the pre-existing documented residual — closing either would need
  the quote-aware-GATE architecture this todo scopes out. All 6 enumerated bypasses now either
  closed (#1,#2,#4,#5) or accepted-and-documented (#3,#6). Verification: red-first TDD, 84/84
  git-safety, full 29-suite hook sweep green, no DENY→ALLOW regression.
