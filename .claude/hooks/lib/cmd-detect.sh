#!/usr/bin/env bash
# Shared, quote-AWARE command detection for the PR/commit matcher hooks
# (pr-preflight-guard.sh, commit-verify.sh, pr-verify.sh) and the git-state hooks
# (core-bare-guard.sh, drift-detect.sh, drift-detect-update.sh, branch-preflight.sh).
# SOURCE this file; it defines functions, runs nothing on its own.
#
# WHY THIS EXISTS (2026-07-18 harness audit + /code-review of PR #662):
#   Shell quoting is CONTEXT-SENSITIVE — a `'` inside a "…" span is a literal, and a
#   `"` inside a '…' span is a literal. The previous per-hook fix stripped quoted spans
#   with three INDEPENDENT sed substitutions (s/\\["']//g; s/'…'//g; s/"…"//g). Three
#   context-free substitutions cannot express one context-sensitive grammar, so a lone
#   apostrophe inside a double-quoted word (e.g. `echo "don't" && gh pr create …`) was
#   mistaken for a single-quote delimiter and "glued" across the real command, deleting
#   it — a silent ALLOW on the deny gate. The only correct primitive is a SINGLE
#   left-to-right scan that tracks quote state. This file owns that scan ONCE, so the
#   three hooks stop re-deriving (and re-breaking) it. See
#   docs/solutions/logic-errors/quote-strip-escape-glue-hides-real-command-2026-07-18.md
#
# DOCUMENTED RESIDUALS (guardrail, not a sandbox — a determined bypass is always
# possible; that is what the SKIP_* env bypasses are for):
#   * Arg-taking command-position wrappers are NOT skipped: `timeout 30 gh pr create`,
#     `nice -n 10 …`, `sudo -u x …`. A regex `(word )*` prefix cannot parse each
#     wrapper's own argument grammar without matching the malformed `timeout gh pr
#     create` while the valid `timeout 30 …` still slips past — which would re-create
#     the exact false-coverage this refactor deletes. Only the zero-arg / assignment
#     forms (`env NAME=v`, `command`, `builtin`, `exec`, `nohup`, `setsid`) are skipped.
#   * $'…' ANSI-C quoting is treated as a plain single-quote span (its \' does not
#     close the span in a real shell). This errs toward OVER-blanking = the deny side.
#   * A keyword character split mid-word by a quote or backslash — `g\h pr create`,
#     `g"h" pr create` — defeats detection: a real shell concatenates the word back to
#     `gh`, but cmd_bare BLANKS the quoted/escaped char (it does not unescape), so the
#     matcher sees the keyword broken by spaces and misses it. This is DELIBERATE:
#     unescaping-then-rejoining would re-introduce the `echo "gh pr create"` false match
#     this scan exists to kill. Suppressing false positives is the chosen tradeoff;
#     catching every mid-word evasion is out of scope (that is the SKIP_* bypass's job).

# Command-position building blocks, shared by the STRICT matchers (guard + commit).
# Separator class opens a command: start-of-line (grep's ^ is per-line, so newline-
# separated compounds are covered), or after ; & | ( . The prefix then skips any run of
# env-assignments (NAME=value) and bare command-position runner words that take no
# intervening args. Assignment value class is `*` (not `+`): a quote-blanked value can
# leave `NAME= `. Trailing class closes the token: whitespace, a subshell `)`, or EOL.
_CMD_POS_PREFIX='(^|[;&|(])[[:space:]]*(([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*|env|command|builtin|exec|nohup|setsid)[[:space:]]+)*'
_CMD_POS_SUFFIX='([[:space:]]|[)]|$)'

# cmd_bare: read a shell command string on STDIN, emit a "bare" copy with the CONTENTS
# of every quoted span (and every backslash-escaped character) replaced by spaces, via a
# single quote-state scan. Unquoted separators, operators and command words survive, so
# a downstream ERE sees only genuinely-unquoted syntax. Quote state carries ACROSS
# newlines (the whole input is slurped) so a multi-line quoted body cannot leak its
# contents. The single-quote char is obtained via sprintf("%c",39) to avoid embedding a
# literal ' inside this single-quoted awk program.
cmd_bare() {
  awk '
    BEGIN { SQ = sprintf("%c", 39); DQ = "\""; BS = "\\" }
    { buf = buf $0 "\n" }
    END {
      st = 0           # 0 = unquoted, 1 = inside single quotes, 2 = inside double quotes
      n = length(buf)
      out = ""
      for (i = 1; i <= n; i++) {
        c = substr(buf, i, 1)
        if (st == 0) {
          if (c == BS)      { out = out " "; i++; if (i <= n) out = out " " }
          else if (c == SQ) { st = 1; out = out " " }
          else if (c == DQ) { st = 2; out = out " " }
          else                out = out c            # keep separators/words/newlines
        } else if (st == 1) {
          if (c == SQ)      { st = 0; out = out " " }
          else                out = out " "          # single quotes: no escapes inside
        } else {
          if (c == BS)      { out = out " "; i++; if (i <= n) out = out " " }  # \" stays in span
          else if (c == DQ) { st = 0; out = out " " }
          else                out = out " "
        }
      }
      printf "%s", out
    }'
}

# cmd_is_gh_pr_create <command>  → exit 0 if it invokes `gh pr create` in command position.
cmd_is_gh_pr_create() {
  printf '%s' "$1" | cmd_bare \
    | grep -Eq "${_CMD_POS_PREFIX}gh[[:space:]]+pr[[:space:]]+create${_CMD_POS_SUFFIX}"
}

# cmd_is_git_commit <command>  → exit 0 if it invokes `git [-c k=v]* commit` in command position.
cmd_is_git_commit() {
  printf '%s' "$1" | cmd_bare \
    | grep -Eq "${_CMD_POS_PREFIX}git([[:space:]]+-c[[:space:]]+[^[:space:]]+)*[[:space:]]+commit${_CMD_POS_SUFFIX}"
}

# cmd_is_git <command>  → exit 0 if it invokes `git` in command position (ANY subcommand, or
# bare git). Used by core-bare-guard.sh, which heals core.bare before ANY git op.
cmd_is_git() {
  printf '%s' "$1" | cmd_bare \
    | grep -Eq "${_CMD_POS_PREFIX}git${_CMD_POS_SUFFIX}"
}

# cmd_is_git_commit_or_push <command>  → exit 0 if it invokes `git [-c k=v]* (commit|push)`
# in command position. Used by drift-detect.sh (the two HEAD-movers it warns on).
cmd_is_git_commit_or_push() {
  printf '%s' "$1" | cmd_bare \
    | grep -Eq "${_CMD_POS_PREFIX}git([[:space:]]+-c[[:space:]]+[^[:space:]]+)*[[:space:]]+(commit|push)${_CMD_POS_SUFFIX}"
}

# cmd_is_git_head_mover <command>  → exit 0 if it invokes a HEAD-moving
# `git [-c k=v]* (commit|push|rebase|reset|pull|merge|cherry-pick)` in command position.
# Used by drift-detect-update.sh (the PostToolUse baseline writer).
cmd_is_git_head_mover() {
  printf '%s' "$1" | cmd_bare \
    | grep -Eq "${_CMD_POS_PREFIX}git([[:space:]]+-c[[:space:]]+[^[:space:]]+)*[[:space:]]+(commit|push|rebase|reset|pull|merge|cherry-pick)${_CMD_POS_SUFFIX}"
}

# cmd_gh_pr_write_subcommand <command>  → echo the gh pr WRITE subcommand
# (create|merge|close|edit) if present, else nothing. Deliberately LOOSER than the strict
# matchers (matches after any whitespace, no command-position anchor): this feeds a
# NON-blocking verifier, so a false positive costs a redundant `gh pr view`, never a gate
# bypass. Quoted mentions are still suppressed because it reads cmd_bare output.
cmd_gh_pr_write_subcommand() {
  printf '%s' "$1" | cmd_bare \
    | grep -oE '(^|[[:space:]])gh[[:space:]]+pr[[:space:]]+(create|merge|close|edit)([[:space:]]|$)' \
    | grep -oE '(create|merge|close|edit)' | head -1
}

# cmd_gh_pr_ref <command>  → echo the PR ref (number, branch name, or URL) that
# FOLLOWS `gh pr <merge|close|edit>`, skipping flag tokens (and, for a known
# value-taking long-form flag, its value token too) along the way — not the
# first ref-shaped token anywhere in the line (a wrapper like `timeout 30 gh pr
# merge 42` must resolve 42, not 30; a boolean flag before the ref, `gh pr
# merge --squash 42`, must resolve 42, not --squash; a VALUE-taking flag
# before the ref, `gh pr merge --repo owner/repo 42` or `gh pr edit
# --add-label bug 42`, must resolve 42, not the flag's own value). Renamed
# from cmd_gh_pr_number (2026-07-26) because it can now return a non-numeric
# ref; `gh pr view <ref>` accepts all three forms itself, so callers do not
# need to know which form it is. Reads cmd_bare'd output like every other
# predicate here — NOT raw text: a greedy last-match search over raw text is
# a decoy vector (`gh pr merge 42 --delete-branch && echo "done gh pr merge
# 999"` would resolve 999, not 42, if run on unblanked text) — same family as
# docs/solutions/logic-errors/quote-strip-escape-glue-hides-real-command-2026-07-18.md.
# Takes the FIRST match, not the last: `cmd_gh_pr_write_subcommand` (above)
# also picks its first match, and a compound command chaining two DIFFERENT
# gh-pr write subcommands (`gh pr merge 42 && gh pr close some-branch`) must
# report the ref for the SAME invocation SUBCOMMAND was read from — otherwise
# a caller pairing them independently could describe two different
# sub-invocations as if they were one.
# A leading `#` (`gh pr merge #42`) is stripped, matching the old numeric-only
# behavior. Value-taking flags are matched by LONG name only — short forms
# (`-b`, `-c`, `-t`, …) are treated as a boolean-style single-token skip, an
# accepted residual: `-m` alone is genuinely ambiguous between merge's
# boolean `--merge` and edit's value-taking `--milestone`, and resolving it
# would require knowing which subcommand's grammar applies mid-regex. The
# `value_flags` alternation is the complete set of long-form value-taking
# flags across `gh pr merge|close|edit --help` as of gh 2.95.0 — an UNLISTED
# value-taking flag (a future `gh` release adding one, not currently
# possible with any real `gh` flag) is treated as boolean by the same
# fallback, so its value is read as the ref and a REAL ref later in the
# command is silently skipped (`gh pr merge --foo bar 42` → `bar`, not `42`,
# if `--foo` were ever a real value-taking flag). Re-derive and extend this
# list against `gh pr <subcommand> --help` if `gh` adds one.
# Empty if no ref token is found: a flags-only tail (`gh pr merge --auto`), a
# value-taking flag with NOTHING after it (`gh pr edit --milestone 5` — ERE
# has no negative lookahead, so the regex alone cannot forbid a flag+value
# pair from being the final tokens; instead it MATCHES that shape via the
# generic single-token fallback, misreading "5" as a positional ref, and a
# second check below (is the token before the match's last token itself a
# known value-flag name?) rejects that parse and returns empty), or a QUOTED
# ref (cmd_bare blanks quoted content — an accepted residual, along with the
# narrower case where a value-flag's QUOTED value is immediately followed by
# a real positional ref, e.g. `gh pr merge --body "msg" 42` — cmd_bare blanks
# the quoted value to whitespace, which is indistinguishable from "nothing
# follows the flag" once blanked, so this now also returns empty rather than
# resolving 42; not currently exercised by any command this hook's callers
# are known to run). Callers MUST treat empty as "could not verify" and never
# fall back to a no-args lookup, which resolves the CURRENT branch's PR
# instead.
cmd_gh_pr_ref() {
  local value_flags='--author-email|--body-file|--body|--match-head-commit|--subject|--comment|--add-assignee|--add-label|--add-project|--add-reviewer|--base|--milestone|--remove-assignee|--remove-label|--remove-project|--remove-reviewer|--title|--repo'
  local full_match ref prev
  full_match=$(printf '%s' "$1" | cmd_bare \
    | grep -oE "gh[[:space:]]+pr[[:space:]]+(merge|close|edit)([[:space:]]+(${value_flags})[[:space:]]+[^[:space:];&|]*|[[:space:]]+-[^[:space:];&|]*)*[[:space:]]+[^[:space:];&|-][^[:space:];&|]*" \
    | head -1)
  [ -n "$full_match" ] || return
  ref=$(printf '%s' "$full_match" | awk '{print $NF}')
  # If the token immediately before the extracted ref is ITSELF a known
  # value-flag name, the match above only succeeded by reinterpreting that
  # flag as boolean (see comment above) — the "ref" is really the flag's own
  # value. Reject it rather than report a wrong PR.
  prev=$(printf '%s' "$full_match" | awk '{print $(NF-1)}')
  case "$prev" in
    --author-email|--body-file|--body|--match-head-commit|--subject|--comment|--add-assignee|--add-label|--add-project|--add-reviewer|--base|--milestone|--remove-assignee|--remove-label|--remove-project|--remove-reviewer|--title|--repo)
      return ;;
  esac
  printf '%s' "${ref#\#}"
}
