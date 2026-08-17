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
#   * $'…' ANSI-C quoting has its OWN scan state as of 2026-08-16. It previously
#     reused the plain single-quote state, and the note here claimed that "errs
#     toward OVER-blanking = the deny side". That claim was false in BOTH
#     directions and the construct was a total bypass, on main and every branch
#     commit before the fix — verified by running:
#       - the `$` sigil survived, so `$'eas' update` rendered as `$eas update`,
#         which no command-position anchor matches: silent ALLOW on every gate;
#       - `\'` inside the span was read as a CLOSER, but bash treats it as a
#         literal apostrophe. The span ended early and the trailing quote
#         re-opened one that swallowed the rest of the command, so the one-token
#         prefix `echo $'it\'s ok'; ` hid EVERY deny family — and in the other
#         direction forged a standalone `--auto` token that GRANTED
#         guard-outward-cli's immediate-merge carve-out.
#     Pinned in test-cmd-detect.sh and test-guard-outward-cli.sh. The lesson worth
#     keeping: "errs toward the deny side" is a claim about behaviour and needs a
#     test, not a comment.
#   * A keyword character split by a BACKSLASH — `g\h pr create`, and the leading
#     `\gh pr create` alias-bypass idiom — still defeats detection: neither
#     rendering UNESCAPES, they only hide. The mechanism differs between the two,
#     which matters when reasoning about a specific case: cmd_bare blanks to
#     SPACES (`e\as update` -> `e  s update`) while cmd_words substitutes the
#     placeholder (`exxs update`). Either way the keyword is broken, and it is out
#     of scope — that is the SKIP_* bypass's job. Note this also means a deny-only
#     flag scan can MISS a spelling (`--ad\min` is a real `--admin` to gh); such a
#     scan can only fail to ADD a deny, never grant one.
#   * A whitespace-bearing QUOTED FLAG VALUE is unmatchable, because the space
#     inside the span becomes the placeholder: `gh api -X" PUT"` renders as
#     `-XxPUT`. Not a working bypass (Go's HTTP client rejects a method token
#     containing a space, so the call fails rather than mutating), but it belongs
#     in this list beside the quoted flag forms that ARE covered.
#   * A keyword split by a QUOTE — `g"h" pr create`, `gh pr "create"` — USED to defeat
#     detection for the same reason, and no longer does: `cmd_words` below reproduces
#     the argv the shell actually builds, and every command-position-anchored matcher
#     reads it. The old note here claimed rejoining was impossible because it "would
#     re-introduce the `echo "gh pr create"` false match" — that turned out to be
#     wrong. The command-position ANCHOR is what suppresses that mention; blanking is
#     load-bearing only for SEPARATORS inside a span, which cmd_words preserves.
#     Verified by running, 2026-08-16: `bash scripts/run-hook-tests.sh` stayed green
#     across all 34 suites. See test-cmd-detect.sh for the per-rendering pins.

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
      # 0 = unquoted, 1 = single quotes, 2 = double quotes, 3 = ANSI-C $(quote)
      st = 0
      n = length(buf)
      out = ""
      for (i = 1; i <= n; i++) {
        c = substr(buf, i, 1)
        if (st == 0) {
          if (c == BS)      { out = out " "; i++; if (i <= n) out = out " " }
          # `$` immediately before a quote is a QUOTING SIGIL, not part of the
          # word: bash strips it from $(sq)…(sq) and $"…". Keeping it left the
          # verb as `$eas`, which no command-position anchor can match — a
          # silent ALLOW on every gate (review, 2026-08-16). Consume both.
          else if (c == "$" && i < n && (substr(buf, i+1, 1) == SQ || substr(buf, i+1, 1) == DQ)) {
            if (substr(buf, i+1, 1) == SQ) st = 3; else st = 2
            i++
            out = out "  "
          }
          else if (c == SQ) { st = 1; out = out " " }
          else if (c == DQ) { st = 2; out = out " " }
          else                out = out c            # keep separators/words/newlines
        } else if (st == 1) {
          if (c == SQ)      { st = 0; out = out " " }
          else                out = out " "          # single quotes: no escapes inside
        } else if (st == 3) {
          # ANSI-C $(sq)…(sq): a backslash ESCAPES the next character, so \(sq)
          # is a literal apostrophe and does NOT close the span. Treating it as a
          # closer ended the span early and let the trailing quote re-open one
          # that swallowed the rest of the command — `echo $(sq)it\(sq)s ok(sq); eas update`
          # hid EVERY deny family in this lib and its consumers.
          if (c == BS)      { out = out " "; i++; if (i <= n) out = out " " }
          else if (c == SQ) { st = 0; out = out " " }
          else                out = out " "
        } else {
          if (c == BS)      { out = out " "; i++; if (i <= n) out = out " " }  # \" stays in span
          else if (c == DQ) { st = 0; out = out " " }
          else                out = out " "
        }
      }
      printf "%s", out
    }'
}

# cmd_words: the SECOND rendering, for INVOCATION detection only. Where cmd_bare
# BLANKS a quoted span whole, cmd_words reproduces the shell's own word model:
#
#   A QUOTED SPAN IS EXACTLY ONE ARGV WORD.
#
# So the quote characters are DELETED (`eas "update"` word-splits, and
# `eas up"date"` concatenates, to the same `eas update` a bare invocation
# produces), and every character inside the span that could break it into two
# words or open a command position — whitespace, `; & | ( ) { } !`, a backtick,
# a newline — becomes a single `x` placeholder (alphanumeric on purpose; see BEGIN).
#
# Keeping the BYTES is not the invariant; keeping the WORD BOUNDARIES is. An
# earlier version of this function preserved intra-span whitespace, which split
# `X="a b" eas update` into the tokens `X=a` and `b` and broke the NAME=value
# absorber in _CMD_POS_PREFIX — the verb then sat outside command position and
# every guard in this file ALLOWED it (caught in review, 2026-08-16).
#
# The one-word property is load-bearing three times over: a quoted span can never
# split a token, never contribute a separator, and never equal a bare flag — so
# `-b "use --auto next time"` yields the single token `usex--autoxnextxtime`,
# which is not `--auto`, and a carve-out keyed on that flag stays withheld.
#
# WHY A SECOND FUNCTION AND NOT A FIX TO cmd_bare (2026-08-16): blanking is
# load-bearing in two places that must NOT see the words, and changing cmd_bare
# in place broke exactly those two, each caught by an existing test:
#   * FLAG-PRESENCE checks that GRANT a carve-out — `gh pr merge 42 -b "use
#     --auto next time"` must keep denying, which only holds while the quoted
#     `--auto` is blanked out of view (guard-outward-cli.sh's decoy test).
#   * LOOSE, non-command-position-anchored matchers — pr-verify.sh has no anchor,
#     so blanking is the only thing suppressing `echo "... gh pr create ..."`.
# Only the ANCHORED cmd_is_* matchers below use cmd_words: their
# `_CMD_POS_PREFIX` is what keeps a kept-word mention from matching, and
# test-cmd-detect.sh pins that in both directions.
#
# NOTE this corrects the header's residual note above: blanking is NOT what kills
# the `echo "gh pr create"` false match — the command-position anchor is. Blanking
# is what keeps a SEPARATOR inside a span from opening a command position, which
# is precisely the part cmd_words preserves.
cmd_words() {
  awk '
    # Everything a quoted span must NOT be able to emit: whitespace (which would
    # split one argv word into two) and every character that can OPEN or CLOSE a
    # command position in either anchor — the lib`s `; & | ( )` plus the wider
    # guard-local set (backtick, `{`, `}`, `!`) and a newline (grep is
    # line-oriented, so a surviving newline is a start-of-line command position).
    function neutral(ch) {
      return (ch == ";" || ch == "&" || ch == "|" || ch == "(" || ch == ")" \
              || ch == "{" || ch == "}" || ch == "!" || ch == BT \
              || ch == "\n" || ch == "\r" || ch == " " || ch == "\t")
    }
    # An EMPTY quoted span (open immediately followed by its own close) needs a
    # placeholder ONLY when it is the WHOLE argv word — flanked by a separator
    # (or start/end of input) on BOTH sides, e.g. `--body ""`. Real bash deletes
    # an empty quote and lets adjacent literal text concatenate straight through
    # it (`eas u''pdate` -> `update`), so a MID-WORD empty span — flanked by a
    # literal word character on either side — must emit NOTHING. Failing to
    # distinguish the two shapes rendered `eas u''pdate --branch preview
    # --platform all` as `eas uxpdate ...`, splitting the verb the
    # `eas[[:space:]]+update` deny pattern anchors on: a silent ALLOW of a real
    # OTA publish (review, 2026-08-16). `sp` is the length `out` had when the
    # span opened, so `substr(out, sp, 1)` is the character that preceded it;
    # `i` is the position of the CLOSING quote in `buf`, so
    # `substr(buf, i+1, 1)` is the raw character that follows it.
    function empty_span_needs_ph(sp,    nc) {
      nc = (i < n) ? substr(buf, i + 1, 1) : ""
      return (sp == 0 || neutral(substr(out, sp, 1))) && (nc == "" || neutral(nc))
    }
    # PH must be ALPHANUMERIC, not punctuation. Consumers spell their token
    # boundaries as `[^-A-Za-z0-9]` (the --repo/--admin/--auto-submit flag
    # checks), and `_` SATISFIES that class — so an underscore placeholder made
    # `--title "use --repo carefully"` render as `use_--repo_carefully`, where
    # the `_` read as a boundary and a prose mention became a flag hit. A letter
    # is a boundary in none of the classes in play, so a span collapses to one
    # contiguous word for every consumer, not just the whitespace-based ones.
    BEGIN { SQ = sprintf("%c", 39); DQ = "\""; BS = "\\"; BT = sprintf("%c", 96); PH = "x" }
    { buf = buf $0 "\n" }
    END {
      # 0 = unquoted, 1 = single quotes, 2 = double quotes, 3 = ANSI-C $(quote)
      st = 0
      n = length(buf)
      out = ""
      for (i = 1; i <= n; i++) {
        c = substr(buf, i, 1)
        if (st == 0) {
          # An unquoted backslash must NEVER render as whitespace. `\ ` is an
          # escaped space: the shell JOINS on it, so `--body "ship it"\ --auto`
          # is ONE argv word `ship it --auto` and gh never sees an --auto flag.
          # Rendering it as spaces SPLIT what the shell joined, manufacturing a
          # standalone `--auto` token that GRANTED guard-outward-cli`s
          # immediate-merge carve-out (review, 2026-08-16). Emitting more tokens
          # than argv contains is harmless for a deny-shaped check and fatal for
          # a grant-shaped one, so the rendering must not do it at all.
          #   \<newline>  -> emit NOTHING: a line continuation is REMOVED by the
          #                  shell, joining the two lines into one word-stream.
          #   \<anything> -> emit the placeholder twice: keeps the join, keeps
          #                  the escaped char out of view (so `e\as` stays split
          #                  and undetected — the documented backslash residual).
          if (c == BS) {
            i++
            if (i <= n) { if (substr(buf, i, 1) != "\n") out = out PH PH }
            else out = out PH
          }
          # `$` immediately before a quote is a QUOTING SIGIL that bash strips
          # from the word ($(sq)…(sq) ANSI-C, $"…" locale). Emitting it left the verb
          # as `$eas`, which no command-position anchor matches — a silent ALLOW
          # on every gate (review, 2026-08-16). Consume the sigil AND enter the
          # right span state; a bare `$` (e.g. `$VAR`) is untouched.
          else if (c == "$" && i < n && (substr(buf, i+1, 1) == SQ || substr(buf, i+1, 1) == DQ)) {
            if (substr(buf, i+1, 1) == SQ) st = 3; else st = 2
            i++
            sp = length(out)
          }
          else if (c == SQ) { st = 1; sp = length(out) }   # DELETE the quote char: the
          else if (c == DQ) { st = 2; sp = length(out) }   # shell omits it from argv too
          else                out = out c
        } else if (st == 1) {
          if (c == SQ)         { st = 0; if (length(out) == sp && empty_span_needs_ph(sp)) out = out PH }
          else if (neutral(c))   out = out PH
          else                   out = out c         # keep the word bytes
        } else if (st == 3) {
          # ANSI-C $(sq)…(sq): a backslash ESCAPES the next character, so \(sq) is a
          # literal apostrophe that does NOT close the span. Treating it as a
          # closer ended the span early and let the trailing quote re-open one
          # that swallowed the rest of the command — a one-token prefix
          # (`echo $(sq)it\(sq)s ok(sq); `) hid EVERY deny family, and in the other
          # direction forged a standalone `--auto` that granted the
          # immediate-merge carve-out. Escapes keep the span ONE word.
          if (c == BS) { i++; if (i <= n) out = out PH PH; else out = out PH }
          else if (c == SQ)    { st = 0; if (length(out) == sp && empty_span_needs_ph(sp)) out = out PH }
          else if (neutral(c))   out = out PH
          else                   out = out c
        } else {
          if (c == BS)         { out = out PH; i++; if (i <= n) out = out PH }
          else if (c == DQ)    { st = 0; if (length(out) == sp && empty_span_needs_ph(sp)) out = out PH }
          else if (neutral(c))   out = out PH
          else                   out = out c
        }
      }
      printf "%s", out
    }'
}

# cmd_is_gh_pr_create <command>  → exit 0 if it invokes `gh pr create` in command position.
cmd_is_gh_pr_create() {
  printf '%s' "$1" | cmd_words \
    | grep -Eq "${_CMD_POS_PREFIX}gh[[:space:]]+pr[[:space:]]+create${_CMD_POS_SUFFIX}"
}

# cmd_is_git_commit <command>  → exit 0 if it invokes `git [-c k=v]* commit` in command position.
cmd_is_git_commit() {
  printf '%s' "$1" | cmd_words \
    | grep -Eq "${_CMD_POS_PREFIX}git([[:space:]]+-c[[:space:]]+[^[:space:]]+)*[[:space:]]+commit${_CMD_POS_SUFFIX}"
}

# cmd_is_git <command>  → exit 0 if it invokes `git` in command position (ANY subcommand, or
# bare git). Used by core-bare-guard.sh, which heals core.bare before ANY git op.
cmd_is_git() {
  printf '%s' "$1" | cmd_words \
    | grep -Eq "${_CMD_POS_PREFIX}git${_CMD_POS_SUFFIX}"
}

# cmd_is_git_commit_or_push <command>  → exit 0 if it invokes `git [-c k=v]* (commit|push)`
# in command position. Used by drift-detect.sh (the two HEAD-movers it warns on).
cmd_is_git_commit_or_push() {
  printf '%s' "$1" | cmd_words \
    | grep -Eq "${_CMD_POS_PREFIX}git([[:space:]]+-c[[:space:]]+[^[:space:]]+)*[[:space:]]+(commit|push)${_CMD_POS_SUFFIX}"
}

# cmd_is_git_head_mover <command>  → exit 0 if it invokes a HEAD-moving
# `git [-c k=v]* (commit|push|rebase|reset|pull|merge|cherry-pick)` in command position.
# Used by drift-detect-update.sh (the PostToolUse baseline writer).
cmd_is_git_head_mover() {
  printf '%s' "$1" | cmd_words \
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
