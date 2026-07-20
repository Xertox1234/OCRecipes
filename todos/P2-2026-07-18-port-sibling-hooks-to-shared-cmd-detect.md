---
title: "Port command-matching sibling hooks onto the shared quote-aware cmd-detect.sh (and fix git-safety's CONFIRMED false-DENY)"
status: backlog
priority: medium
created: 2026-07-18
updated: 2026-07-18
assignee:
labels: [deferred, harness, hooks, security]
github_issue:
human_led: true
blocked_reason: "Risks: never delegate — touches git-safety / branch guards; keep in the primary session (gate made machine-visible 2026-07-19 after the /todo orchestrator had to judgment-skip it)"
---

# Port command-matching sibling hooks onto the shared quote-aware cmd-detect.sh

## Summary

The 2026-07-18 harness audit fixed quote-handling in the three PR/commit hooks by
introducing a shared quote-aware scanner (`.claude/hooks/lib/cmd-detect.sh`). Several
SIBLING hooks still do their own command-matching with cruder, quote-unaware approaches.
Port them onto the shared helper — and fix a **now-CONFIRMED** false-DENY in `git-safety.sh`
(a legitimate commit is blocked when its message mentions a redirect/tee to a main-checkout
path) that the PR #662 `/code-review` flagged out-of-scope.

## Background

Command detection in shell hooks kept being re-derived per hook and re-broken. The PR-hook
fix (PR after `fix/quote-aware-cmd-detect-hooks`) collapsed three of them onto one
single-pass quote-state scanner. The audit surfaced that the harness now runs **four
distinct quote-handling architectures** across its matcher hooks; the remaining three are:

1. **No stripping at all** — `core-bare-guard.sh`, `drift-detect.sh`, `branch-preflight.sh`
   match against the RAW command (`[[ "$CMD" =~ $GIT_RE ]]` + `grep -qE "$COMPOUND_RE"`).
   Consequence: a quoted MENTION (`echo "git commit"`, `git commit -m "then git push"`)
   false-POSITIVES. All three are **warn-only / advisory** (drift warns; branch-preflight
   blocks only detached-HEAD; core-bare-guard auto-heals a bare `core.bare` and is
   effectively advisory), so this is **noise, not a gate bypass** — lower severity than the
   PR-hook bypasses, but the same root-cause smell.

2. **Content-keeping strip** — `git-safety.sh` uses `tr -d '\042\047'` (deletes quote
   CHARACTERS, keeps their CONTENTS) before matching mutating-git / write-shaped commands.
   This is a blocking, worktree-contract-gated DENY, so its false-match class is the
   highest-severity of the group.

## The git-safety false-DENY — CONFIRMED (2026-07-18, hermetic repro)

Reproduced with a hermetic fixture (real temp main-checkout + a real registered worktree +
an isolated `/tmp/claude-worktree-contracts-<session>` registry — **never** the live session).
Under an ACTIVE contract, with cwd = a registered worktree (so the mutating-git branch
correctly ALLOWS the commit), a benign commit whose MESSAGE contains a write-verb + a
main-checkout absolute path is DENIED by the write-shaped branch:

| Command (cwd = registered worktree)                                | Result           |
| ------------------------------------------------------------------ | ---------------- |
| `git commit -m "writes > /…/OCRecipes/out"`                        | **DENY** (false) |
| `git commit -m "pipe to tee /…/OCRecipes/log"`                     | **DENY** (false) |
| `git commit -m "mv /…/OCRecipes/a /…/OCRecipes/b"`                 | allow            |
| `git commit -m "rm /…/OCRecipes/x"`                                | allow            |
| `git commit -m fixed-a-bug` (control)                              | allow            |
| `git commit -m x` in the MAIN checkout (contract feature, control) | DENY (correct)   |

**Root cause:** `tr -d '\042\047'` (git-safety.sh:164) deletes quote CHARACTERS but keeps
their CONTENTS, so the write-shaped extractors run over the commit message. The `>`/`>>`
(line 168) and `tee` (line 170) extractors are **command-wide / positional** — they match a
target anywhere in the string — so they mine the message. The `rm`/`cp`/`mv`/`sed -i`
extractors (lines 175-182) are **segment-scoped** with tighter token rules and did NOT fire
on the single-segment message form tested (the fix must determine their full coverage).

**IMPORTANT design constraint (the naive fix is WRONG):** you cannot simply swap `tr -d` for
the shared `cmd_bare` (which BLANKS quoted content). git-safety intentionally relies on seeing
quoted `-C` PATHS — `test-git-safety.sh` asserts `git -C '$MAIN' commit` is DENIED (line ~109);
blanking that quoted path would break it. The fix must distinguish `-C` **arguments** (a real
git argument that MUST be read even when quoted) from `-m` **message** content (must never be
mined for write targets) — e.g. extract `-C` targets from the raw command, then run the
write-shaped extractors over `cmd_bare` output. This is real design work — hence P2, not a
tack-on, and **never delegate** (live blocking git gate).

**Severity:** Medium — narrow trigger (active contract + message containing a redirect/tee to
a main-checkout absolute path), and `SKIP_WORKTREE_CONTRACT=1` bypasses it — but it blocks
_legitimate_ work, so it outranks the (weaker) PR-gate bypasses on blast-to-the-user.

Repro script archived in the 2026-07-18 audit notes (scratchpad, not committed).

## Acceptance Criteria

- [x] ~~Reproduce-or-refute the git-safety false-DENY with a hermetic test.~~ **CONFIRMED
      2026-07-18** — `>`/`tee` in a commit message under an active contract false-DENY (see the
      section above for the table + root cause).
- [x] **DONE (PR `fix/git-safety-false-deny-quote-aware`).** Fixed git-safety's write-shaped
      extraction to be quote-AWARE. The originally-planned approach ("mine write targets from
      `cmd_bare` output") proved INSUFFICIENT: `cmd_bare` blanks the quoted target PATH too, so a
      real `rm "/main/x"` / `> "/main/out"` would be MISSED (a safety regression — trading the
      false-positive for a false-negative on the exact threat). Shipped instead a role-aware
      TOKENIZER (`emit_write_targets`): a write is real only when its operator/command word is
      UNQUOTED; the target path may still be quoted. Truth table (must-ALLOW message-mentions +
      must-DENY real writes, incl. the quoted-`-C` guard, fd-redirects, `tee -a`, wrapper `sudo rm`,
      escaped `\>`) codified in `test-git-safety.sh` — 51/51 green. `rm`/`cp`/`mv`/`sed -i`
      coverage determined: they false-DENY only when the command word is space-preceded inside a
      quoted message; the tokenizer handles all write ops/commands uniformly.
- [x] **DONE (PR `fix/git-safety-C-extraction-quote-aware`).** Replaced the greedy quote-blind
      `-C` extraction (`tr -d '\042\047' | sed 's/.*git…-C ([^ ]+)/\1/'`) with a role-aware
      tokenizer `git_c_target` that emits ONLY the FIRST command-position `git`'s `-C` argument
      (flag must be UNQUOTED; value may be quoted). **The bug was BIDIRECTIONAL** (advisor catch,
      not in the original CONFIRMED probe): greedy `.*git…-C` grabbed the _last_ `git -C` anywhere,
      so a message decoy naming a MAIN path fabricated a violation (the confirmed false-DENY) AND a
      message decoy naming a REGISTERED-WORKTREE path SUBSTITUTED for the real target, laundering a
      genuine main-checkout mutation past the gate (**BYPASS / false-negative** — e.g.
      `git commit -m "ref git -C <worktree>"` run in the main checkout). Locked with a 2x2 truth
      table (`test-git-safety.sh`, 4 new assertions: main-decoy → must-ALLOW, worktree-decoy →
      must-DENY, in both "real -C present" and "no real -C" rows) — all 4 RED before, 57/57 green
      after; all 8 pre-existing `-C` guards (incl. single-quoted `git -C '<main>'` → DENY at ~L109)
      preserved; full 29-suite hook sweep green. Solution doc extended with the bidirectional
      "last-match decoy substitutes the real value" lesson. **The `-C` EXTRACTION is fixed and
      strictly-improving** (confirmed by a post-implementation code-reviewer + security-auditor
      pass on PR #665). That review surfaced that the UNCHANGED quote-blind "front door" (the
      `tr ';|&'` split + `MUTATING_GIT_SEG_RE`) still admits **pre-existing** main-mutation
      bypasses — most notably a metachar INSIDE a `-c name=val` global option (before the verb)
      fractures the segment so a real `git -C <main> … commit` slips (a genuine FALSE-NEGATIVE,
      NOT false-positive-only as an earlier draft of this note wrongly claimed), plus chained `-C`,
      quoted `-C` flag, glued `-C/path`, and env-value-with-space. Those live upstream of the
      extractor this AC fixed and are tracked separately in
      **`todos/P2-2026-07-19-git-safety-frontdoor-quote-aware-segmentation.md`** (own clean landing,
      never delegate). PR #665 corrects the claim in-place and does not pretend to close them.
- [x] **DONE (PR `fix/port-sibling-hooks-cmd-detect`, 2026-07-20).** Ported `core-bare-guard.sh`
      (→ `cmd_is_git`), `drift-detect.sh` (→ `cmd_is_git_commit_or_push`), `branch-preflight.sh`
      (→ existing `cmd_is_git_commit`), **and the companion `drift-detect-update.sh`**
      (→ `cmd_is_git_head_mover`; folded in by user decision — same quote-unaware matcher, and its
      false-positive is _worse_: a quoted HEAD-mover mention wrongly stamped the drift baseline →
      silently absorbed a real drift). Three predicates added to `cmd-detect.sh` (pure additions,
      mirroring `cmd_is_git_commit`). Each hook got a "quoted mention stays silent" regression test,
      red-first (verified failing on the pre-port hook, then green).
- [x] **DONE.** `branch-preflight.sh` (the one blocking hook) fails CLOSED via a retained raw-regex
      else-branch — a real detached-HEAD commit still denies when the lib is unsourceable. The three
      advisory hooks fail SILENT (`exit 0`). Both directions carry a lib-missing test (copy the hook
      into a `lib`-less temp dir so the `source` fails and the fallback branch runs).
- [x] **DONE.** Full 29-suite hook sweep green (`bash scripts/run-hook-tests.sh`, exit 0), including
      the existing lib consumers (`git-safety`, `pr-preflight-guard`, `commit-verify`, `pr-verify`) —
      confirms the additive-only predicate change didn't regress them.

## Implementation Notes

- Helper: `.claude/hooks/lib/cmd-detect.sh` — `cmd_bare` (single-pass quote-state awk scan)
  plus predicate functions. Extend it with new predicates rather than inlining regex in a hook.
- Files in scope: `.claude/hooks/git-safety.sh`, `core-bare-guard.sh`, `drift-detect.sh`,
  `branch-preflight.sh`, `.claude/hooks/lib/cmd-detect.sh`, and each hook's `test-*.sh`.
  (`guard-worktree-isolation.sh` matches on CWD/path, not the command string — out of scope
  unless a command-string matcher is found there during the work.)
- Reference the root-cause solution: `docs/solutions/logic-errors/quote-strip-escape-glue-hides-real-command-2026-07-18.md`.
- Keep the guardrail-not-sandbox framing: document arg-taking-wrapper and `$'…'` residuals,
  do not pretend regex closes them.

## Scope Contract

- **Mechanisms to use:** the existing shared `cmd-detect.sh` helper (extend with predicates);
  the standard `test-*.sh` hermetic-hook test pattern. No new matching architecture.
- **Files in scope:** the four hooks + `cmd-detect.sh` + their tests, listed above.
- No new mechanisms, files, or abstractions beyond those listed.

## Risks

- git-safety.sh is a live, contract-gated blocking gate — changes must be verified
  fail-closed and must not weaken the real worktree-contract DENY it exists to provide.
- Never delegate: touches git-safety / branch guards. Keep in the primary session.

## Updates

### 2026-07-18

- Initial creation, deferred from the `fix/quote-aware-cmd-detect-hooks` PR (Option 1 of the
  2026-07-18 harness-audit `/code-review` follow-up).
- git-safety false-DENY **CONFIRMED** via a hermetic repro (real temp checkout + registered
  worktree + isolated registry; live session untouched, no litter). `>`/`tee` in a commit
  message under an active contract false-DENY. Found the design constraint that rules out a
  naive `cmd_bare` swap (would break the intentional quoted-`-C`-path DENY). Title + Summary +
  AC updated from "verify" to "fix". Fix deferred to deliberate P2 execution (live git gate,
  never delegate) rather than tacked onto the PR-hook fix.

### 2026-07-19

- **Write-shaped branch FIXED** (PR `fix/git-safety-false-deny-quote-aware`). Built the truth
  table first (hermetic probe): confirmed the `>`/`tee`/space-preceded-`rm`/escaped-`\>`
  false-DENYs and confirmed every real write (bare/quoted redirect, `>>`, `2>`, `tee -a`,
  quoted `rm`, `cp`, `sudo rm`, quoted-`-C`) still DENYs. The planned "`cmd_bare` output"
  approach was rejected mid-design — `cmd_bare` blanks the quoted target path too, which would
  turn the false-positive into a false-NEGATIVE on the real threat. Implemented a role-aware
  tokenizer (`emit_write_targets`) instead; downstream dot-segment/`in_registered`/`MAIN_ROOT`
  deny loop unchanged. Solution doc extended with the "tokenize when the extracted value can
  itself be quoted" rule.
- **`-C` mutating-branch false-DENY CONFIRMED** via the same truth-table probe and split out to
  its own AC + its own future PR (highest-stakes branch, own clean landing — advisor guidance).
- **`-C` FIXED** (PR `fix/git-safety-C-extraction-quote-aware`). Building the truth table first
  surfaced that the bug is **bidirectional**, not just the confirmed false-DENY: the pre-write
  advisor pass flagged that greedy last-match `.*git…-C` also lets a registered-worktree path
  named in a commit MESSAGE SUBSTITUTE for the real target, laundering a genuine main-checkout
  mutation past the gate (a BYPASS — the dangerous direction the original probe missed). Shipped
  the `git_c_target` tokenizer (first command-position git's `-C` arg; flag untainted, value may
  be quoted) with a 2x2 must-ALLOW/must-DENY table (4 new tests, all RED first). 57/57 git-safety
  - 29-suite hook sweep green; all pre-existing `-C` guards preserved.
- Sibling-hook port (`core-bare-guard`/`drift-detect`/`branch-preflight`) still pending — the ONLY
  remaining AC in this todo.

### 2026-07-20

- **Sibling-hook port DONE** (PR `fix/port-sibling-hooks-cmd-detect`) — closes the last remaining
  AC. Added `cmd_is_git`, `cmd_is_git_commit_or_push`, `cmd_is_git_head_mover` to `cmd-detect.sh`
  (pure additions; existing `cmd_bare`/`_CMD_POS_*`/predicates untouched, so the three current
  consumers can't regress). Ported all three enumerated hooks **and folded in the companion
  `drift-detect-update.sh`** (user-confirmed scope call: same-class quote-unaware sibling whose
  false-positive is worse — a quoted HEAD-mover mention wrongly stamped the drift baseline and
  silently absorbed a real external drift, defeating its own read-only-ops exclusion). Strict TDD:
  each quoted-mention red test verified failing on the pre-port hook first. Fail-safe directions:
  advisory hooks (`core-bare-guard`, `drift-detect`, `drift-detect-update`) → SILENT on an
  unsourceable lib; `branch-preflight` (blocking) → CLOSED via a retained raw-regex fallback.
  29/29 hook suites green. Solution doc `quote-strip-escape-glue-hides-real-command-2026-07-18.md`
  extended (Related Files) with the ported hooks. Closes pending PR merge (human_led — user merges).
