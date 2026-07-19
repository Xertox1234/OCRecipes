---
title: "Port command-matching sibling hooks onto the shared quote-aware cmd-detect.sh (and fix git-safety's CONFIRMED false-DENY)"
status: backlog
priority: medium
created: 2026-07-18
updated: 2026-07-18
assignee:
labels: [deferred, harness, hooks, security]
github_issue:
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
- [ ] **NEW — CONFIRMED 2026-07-18, land as its OWN PR.** The mutating-git branch has the SAME
      quote-blind bug in its `-C` extraction (line ~127: `tr -d '\042\047'` + greedy `sed`): a
      commit whose MESSAGE merely mentions `git -C <main-abs-path>` false-DENYs (truth-table probe:
      `git commit -m "see git -C /main commit"` → DENY). Fix must read a real `-C` FLAG while
      ignoring `-C` buried in a quoted argument — WITHOUT reddening the `git -C '<main>' commit` →
      DENY guard test (`test-git-safety.sh` ~line 109). SEPARATE PR: this is git-safety's
      highest-stakes, best-tested branch (the actual worktree-contract protection) and gets its own
      clean landing per the 2026-07-18 advisor review. Never delegate.
- [ ] Port `core-bare-guard.sh`, `drift-detect.sh`, `branch-preflight.sh` to source
      `cmd-detect.sh` and use `cmd_is_git_commit` / a shared mutating-git predicate, so
      quoted mentions stop false-positiving. Each gets a "quoted mention stays silent"
      regression test.
- [ ] Any BLOCKING hook that adopts the helper encodes an explicit fail-CLOSED fallback for
      an unsourceable lib (never fail-open); advisory hooks fall back to silent. Test both.
- [ ] All existing `test-*.sh` suites for the touched hooks stay green.

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
- Sibling-hook port (`core-bare-guard`/`drift-detect`/`branch-preflight`) still pending.
