---
title: "Quoted-span stripping without an escape pre-pass glues spans together and hides a real command from a matcher hook"
track: bug
category: logic-errors
tags: [bash, hooks, awk, quote-aware, quote-stripping, tokenizer, command-matcher, pr-gate, fail-closed, regex]
module: shared
applies_to: [".claude/hooks/**/*.sh", "scripts/**/*.sh"]
symptoms: ["A command-matching hook that strips quoted spans before matching silently allows or ignores a REAL invocation when an earlier argument contains a backslash-escaped quote or a bare apostrophe inside a double-quoted word", "Independent per-quote-type span substitutions pair a quote inside one argument with the quote opening a LATER argument and delete the separator and command between them", "A deny gate falls through its final match-or-exit-0 line on input that visibly contains the gated command"]
created: 2026-07-18
severity: high
---

# Quoted-span stripping without an escape pre-pass glues spans together and hides a real command from a matcher hook

## Problem

Command-matching hooks (`pr-preflight-guard.sh`, `commit-verify.sh`,
`pr-verify.sh`) strip quoted spans before matching, so a command merely
*mentioned* inside a quoted argument never false-matches. The original strip
used two independent per-quote-type substitutions:

```bash
CMD_BARE=$(printf '%s' "$CMD" | sed "s/'[^']*'//g; s/\"[^\"]*\"//g")
```

This misses in several ways that all end the same: a REAL command gets deleted
and the gate falls through `|| exit 0` — a **silent allow on the PR gate** (and
a silently skipped verification in the two advisory hooks):

- **Escaped-quote glue.** In `echo "escaped \" quote" && gh pr create --title "x"`
  the `\"` pairs with the quote *opening* `--title`'s argument; the strip
  deletes everything between — the `&&` and the literal `gh pr create` included.
- **Apostrophe glue.** In `echo "don't" && gh pr create --title 'fix'` the bare
  `'` inside the double-quoted word `"don't"` is a *literal*, but `s/'…'//g`
  treats it as a delimiter and pairs it with the opening `'` of `'fix'`,
  deleting the `&& gh pr create --title ` between them.

Found by the 2026-07-18 harness audit (Phase 6 review caught the escaped-quote
class; the follow-up `/code-review` of PR #662 caught the apostrophe class and
proved the first attempted fix was incomplete).

## Symptoms

- A deny gate lets through an input that visibly contains the gated command.
- A PostToolUse verifier stays silent on a real, matching command.
- Repro shape: any command where one quoted argument contains a `\"`, a `\'`,
  or a bare apostrophe, with the gated command *after* it and another
  same-type quote later in the line.

## Root Cause

**Shell quoting is context-sensitive; a chain of independent regex
substitutions is context-free — the two can never be equivalent.** Whether a
given `'` is a delimiter depends on whether the scanner is currently inside a
`"…"` span (there it is a literal), and whether a `"` is a delimiter depends on
whether it is inside a `'…'` span or backslash-escaped. Two separate
substitutions (`s/'…'//g` then `s/"…"//g`) each run blind to the other's state,
so they mis-pair quotes across the real command. No amount of *additional*
regex legs (an escape pre-pass, more anchors) fixes this — it is the wrong
altitude. The first fix attempt (adding `s/\\\\[\"']//g` before the strip)
closed only the escaped-quote case and left the apostrophe case fully open,
because it was still three context-free passes.

## Solution

Do the strip with **one left-to-right scan that tracks quote state**, owned by
a single shared helper — not re-derived (and re-broken) per hook.
`.claude/hooks/lib/cmd-detect.sh` exposes `cmd_bare` (an `awk` state machine:
`OUT` / `IN_SINGLE` / `IN_DOUBLE`, blanking quoted content and escaped chars,
state carried across newlines) plus the matcher predicates
(`cmd_is_gh_pr_create`, `cmd_is_git_commit`, `cmd_gh_pr_write_subcommand`,
`cmd_gh_pr_number`). Each hook sources the helper and calls a predicate; the
quote grammar lives in exactly one place.

```bash
# in a hook:
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if . "$HERE/lib/cmd-detect.sh" 2>/dev/null && declare -F cmd_is_gh_pr_create >/dev/null; then
  cmd_is_gh_pr_create "$CMD" || exit 0
else
  case "$CMD" in *gh*pr*create*) : ;; *) exit 0 ;; esac   # BLOCKING guard: fail toward DENY
fi
```

**Fail-safe direction is hook-specific and must be explicit.** The sourced
helper is a new dependency: if it is missing, the naive
`CMD_BARE=$(… | cmd_bare)` yields empty and the matcher passes — a *reintroduced
fail-open*. Encode the fallback: the blocking gate matches the raw command
(fail toward DENY, without blocking unrelated Bash); the two advisory hooks
`exit 0` (silence — matching raw would fire false context on quoted mentions).
Test it: run a copy of the hook from a dir with no `lib/` and assert the
fallback direction (see `test-pr-preflight-guard.sh` #14).

### When the extracted value can itself be quoted: tokenize, don't just blank

`cmd_bare` **blanks** all quoted content — the right primitive when you only need to
know *whether* a command word is present (the PR/commit matchers). git-safety's
write-shaped branch (`emit_write_targets`) has the harder job: it must **reject** a
write operator/command that is quoted (a `>` or `tee` inside a commit message) *while
still* **reading** a write TARGET that is quoted (`> "/main/out"`, `rm "/main/x"` — the
agent-default style). The two quoted spans need OPPOSITE treatment based on grammatical
role, so no single transform works: blanking (`cmd_bare`) drops the target with the
message; the old `tr -d '\042\047'` (delete quote chars, keep content) did the reverse
and mined the message → the CONFIRMED false-DENY. The fix is one shell-aware
**tokenizer**: quote delimiters drop, quoted content stays inside its word, and
`>`/`>>`/`|`/`;`/`&` are operators only when UNQUOTED. A write is then real iff its
operator/command word is *untainted by quotes*; the target path may be quoted.
**Rule of thumb: detect *presence* with the quote-aware blank scan, but if the VALUE
you extract can itself be legitimately quoted, you need tokenization (role-aware), not
blanking (presence-only).**

**A greedy "last-match" extraction over a mixed command+message string is
BIDIRECTIONALLY unsafe — not only a false-positive.** git-safety's `-C` extractor
(`git_c_target`, the sibling that reads the effective repo of a mutating `git`) used
`tr -d '\042\047' | sed 's/.*git…-C ([^ ]+)/\1/'` — greedy `.*` grabs the *last*
`git -C` anywhere in the string. A commit *message* mentioning `git -C <path>` is
therefore read as a real `-C` override, and the direction of harm depends on what the
message names: a **main-checkout** path fabricates a violation (false-DENY), but a
**registered-worktree** path SUBSTITUTES for the real target and launders a genuine
main-checkout mutation past the gate (false-NEGATIVE / BYPASS — e.g.
`git commit -m "ref git -C <worktree>"` run in the main checkout). The tokenizer fix
emits only the FIRST command-position `git`'s `-C` argument (flag untainted, value may
be quoted), so a quoted message — one atomic token — can neither fabricate nor
substitute a target. Lesson: on a gate, a decoy in free-text isn't just noise that
adds a false-positive; "last match wins" lets the decoy REPLACE the real value, which
is the bypass direction. Test both directions (see `test-git-safety.sh`: main-decoy →
must-ALLOW, worktree-decoy → must-DENY).

## Prevention

- **Detect commands with the shared scanner, never a bespoke per-hook quote
  strip.** A new matcher hook sources `cmd-detect.sh`; if it needs a new target,
  add a predicate there. Any hand-rolled `s/'…'//g; s/"…"//g` in a hook is the
  smell.
- **The regex "matcher recipe" is necessary but NOT sufficient.** Command-position
  legs still matter *after* the quote-aware strip — separator class `(^|[;&|(])`
  (else compound `git add -A && git commit` slips), env-assignment prefix with
  value class `*` not `+` (quote-blanking can leave `FOO= `), a bare
  command-position runner-word alternation (`env`/`command`/`builtin`/`exec`/
  `nohup`/`setsid`, else `env NAME=v gh pr create` slips), and trailing anchor
  `([[:space:]]|[)]|$)`. But these legs on top of a *context-free* strip are what
  gave false confidence before: the pre-fix hook had all four legs and still
  had two live bypasses. Correct strip first, then position anchors.
- **Documented residuals (guardrail, not sandbox).** A regex prefix cannot parse
  each command-position wrapper's own argument grammar, so arg-taking wrappers
  are NOT skipped: `timeout 30 gh pr create`, `nice -n 10 …`, `sudo -u x …`
  still bypass. `$'…'` ANSI-C quoting is treated as a plain single-quote span
  (errs toward over-blanking = the deny side). And because the scan *blanks*
  quoted/escaped content instead of unescaping it, a keyword split mid-word
  (`g\h pr create`, `g"h" pr create`) is rejoined to `gh` by a real shell but
  missed by the matcher — the deliberate cost of suppressing the
  `echo "gh pr create"` false positive (unescaping-then-rejoining would bring it
  back). These are acceptable for a guardrail whose escape hatch is
  `SKIP_PR_PREFLIGHT=1` — document them in the helper, do not pretend a regex
  closes them.
- **Red test per class**, in the hook's `test-*.sh`: escaped-quote glue,
  apostrophe glue, env-runner-word, newline-compound, and lib-missing
  fail-safe.

## Related Files

- `.claude/hooks/lib/cmd-detect.sh` — the shared quote-aware scanner + predicates (the fix)
- `.claude/hooks/git-safety.sh` (`emit_write_targets`, `git_c_target`) — two role-aware TOKENIZER variants, same root cause (`tr -d` kept quoted content and mined a commit message) where the extracted value must survive quoting so it tokenizes instead of blanking: `emit_write_targets` for write-shaped targets (false-DENY only), `git_c_target` for the mutating-git `-C` repo override (BIDIRECTIONAL — greedy last-match also laundered a real main mutation past the gate; see the bidirectional note above)
- `.claude/hooks/pr-preflight-guard.sh` — the gate (deny-side); `commit-verify.sh`, `pr-verify.sh` — advisory
- `.claude/hooks/test-pr-preflight-guard.sh` (12e–12h, 14), `test-commit-verify.sh` (7–11), `test-pr-verify.sh` (11–14) — per-class regression tests

## See Also

- `docs/solutions/logic-errors/guard-lexer-content-predicate-needs-same-redaction-2026-07-12.md` — the sibling trap: a lexer's downstream predicate skipping the redaction
- `docs/solutions/logic-errors/lexical-prefix-path-guard-dot-segment-escape-2026-07-17.md` — same "lexical shortcut has a semantic hole" family, for paths
