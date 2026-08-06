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
# That "only costs a redundant `gh pr view`" claim is CONDITIONAL, not inherent: it held
# because the ref this pairs with could address nothing but the LOCAL repo, so the
# redundant lookup was local. Matching MENTIONS rather than invocations means inert text —
# a shell COMMENT, a heredoc body — can still drive that lookup, and once cmd_gh_pr_ref
# learned to return URLs (2026-07-26) the redundant local lookup became network egress to
# an attacker-chosen host. pr-verify.sh now host-restricts the ref before forwarding it,
# which is the ONLY reason the claim above is still true. Keep that guard if you reuse
# this matcher with a ref extractor that can return a URL.
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
# before the ref, `gh pr edit --add-label bug 42` or `gh pr merge --body-file
# notes.md 42`, must resolve 42, not the flag's own value — but see the
# `--repo` carve-out below, which disqualifies rather than resolves). Renamed
# from cmd_gh_pr_number (2026-07-26) because it can now return a non-numeric
# ref; `gh pr view <ref>` accepts all three forms itself, so callers do not
# need to know which form it is. Reads cmd_bare'd output like every other
# predicate here — NOT raw text: a greedy last-match search over raw text is
# a decoy vector (`gh pr merge 42 --delete-branch && echo "done gh pr merge
# 999"` would resolve 999, not 42, if run on unblanked text) — same family as
# docs/solutions/logic-errors/quote-strip-escape-glue-hides-real-command-2026-07-18.md.
# Returns EMPTY when the bare text contains MORE THAN ONE `gh pr
# <merge|close|edit>` occurrence. Taking the first match of each was not
# enough: `cmd_gh_pr_write_subcommand` (above) picks the first of
# create|merge|close|edit while this picks the first of merge|close|edit, and
# a match that is then REJECTED (by one of the checks below) is never retried
# against the next occurrence — so `gh pr close --delete-branch && gh pr merge
# 42` paired the FIRST clause's subcommand with the SECOND clause's ref and
# reported them as one invocation. Correlating positions across clauses would
# add real parsing to a hook that must never block; refusing to answer costs
# only a "could not verify". This is why the pairing SUBCOMMAND↔ref is
# best-effort, not guaranteed — the guarantee is only that a WRONG pairing
# cannot be reported confidently. Cost: `gh pr edit --add-label bug && gh pr
# merge 42` now returns empty where the numeric-only predecessor returned 42
# (safe direction, mild usefulness regression). `create` is deliberately NOT
# counted: when it is the first subcommand, pr-verify.sh takes its no-args
# path and never calls this function, so counting it would only cost
# usefulness (`gh pr create -t x && gh pr merge 42` still resolves 42).
# A leading `#` (`gh pr merge #42`) is stripped, matching the old numeric-only
# behavior; a ref that is dash-leading AFTER the strip is rejected, since the
# strip would otherwise re-open the very tokens the regex's first-char class
# excludes (`gh pr merge #-w` → `gh pr view -w`).
# `--repo`/`-R` in any spelling DISQUALIFIES the match (returns empty). The
# extractor can skip past that flag correctly, but its VALUE selects a
# different repository and this function has one return channel, so the ref
# would be resolved against the CURRENT repo — `gh pr merge --repo
# other-org/other-repo 42` would confidently report the local #42, an
# unrelated PR. Forwarding the repo instead would need a second output channel
# in a lib seven hooks source, plus its own host restriction (gh accepts a
# URL there too), to buy a shape this repo never invokes; and the short form
# is forced to empty by the value-flag check below regardless, so
# disqualifying simply makes both spellings agree. This restores exactly what
# the numeric-only predecessor did with that input.
# Value-taking flags are matched by LONG name in the regex; the SHORT forms
# that take a value (`-A -b -F -t -c -B`, derived against `gh pr
# merge|close|edit --help` for gh 2.95.0, where each is value-taking
# everywhere it appears and boolean nowhere) are rejected by the post-hoc
# `prev` check ONLY — deliberately not added to the regex alternation, so the
# boolean single-token skip path is preserved and every wrong-ref case
# (`gh pr merge -b message 42` → "message") converts to empty → warning
# instead. `-d -r -s` are boolean-only and correctly skipped as single tokens.
# `-m` is the one genuine ambiguity — boolean `--merge` in `merge` vs
# value-taking `--milestone` in `edit` — so `gh pr edit -m 5 42` still
# resolves `5`. Closing that needs subcommand-aware handling (the regex
# already captures `(merge|close|edit)`, so the information is available);
# deliberately NOT implemented here.
# The `value_flags` alternation is the complete set of long-form value-taking
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
  local bare occurrences full_match ref prev
  bare=$(printf '%s' "$1" | cmd_bare)
  # More than one `gh pr <write>` clause: refuse to pair a subcommand from one
  # clause with a ref from another (see comment above). Counted with `wc -l`
  # over `grep -oE` output, NOT `grep -c` — `-c` counts matching LINES, and a
  # compound command is normally one line.
  occurrences=$(printf '%s' "$bare" \
    | grep -oE '(^|[[:space:]])gh[[:space:]]+pr[[:space:]]+(merge|close|edit)([[:space:]]|$)' \
    | wc -l | tr -d '[:space:]')
  if [ "${occurrences:-0}" -gt 1 ]; then
    return 1
  fi
  full_match=$(printf '%s' "$bare" \
    | grep -oE "(^|[[:space:]])gh[[:space:]]+pr[[:space:]]+(merge|close|edit)([[:space:]]+(${value_flags})[[:space:]]+[^[:space:];&|]*|[[:space:]]+-[^[:space:];&|]*)*[[:space:]]+[^[:space:];&|-][^[:space:];&|]*" \
    | head -1)
  [ -n "$full_match" ] || return 1
  # `--repo`/`-R` retargets another repository, which this function cannot
  # convey (see comment above) — disqualify every spelling gh's flag parser
  # accepts: `--repo v`, `--repo=v`, `-R v`, `-Rv`. This also subsumes `-R` as
  # a value-taking short flag, which is why `-R` is absent from the `prev`
  # list below; that list stays exactly the set derivable from `gh --help`.
  if printf '%s' "$full_match" | grep -qE '(^|[[:space:]])(--repo([=[:space:]]|$)|-R)'; then
    return 1
  fi
  ref=$(printf '%s' "$full_match" | awk '{print $NF}')
  # If the token immediately before the extracted ref is ITSELF a known
  # value-flag name, the match above only succeeded by reinterpreting that
  # flag as boolean (see comment above) — the "ref" is really the flag's own
  # value. Reject it rather than report a wrong PR.
  prev=$(printf '%s' "$full_match" | awk '{print $(NF-1)}')
  case "$prev" in
    --author-email|--body-file|--body|--match-head-commit|--subject|--comment|--add-assignee|--add-label|--add-project|--add-reviewer|--base|--milestone|--remove-assignee|--remove-label|--remove-project|--remove-reviewer|--title|--repo)
      return 1 ;;
    -A|-b|-F|-t|-c|-B)
      return 1 ;;
  esac
  ref=${ref#\#}
  # The `#` strip can expose a dash-leading token the regex's first-char class
  # was written to exclude (`gh pr merge #-w` → `-w`), which would reach
  # `gh pr view` as a FLAG rather than a ref. Reject it.
  case "$ref" in
    -*) return 1 ;;
  esac
  printf '%s' "$ref"
}
