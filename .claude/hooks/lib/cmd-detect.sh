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
# separated compounds are covered), or after ; & | ( ` { ! — a brace-group `{ ... }`
# executes its body in the CURRENT shell (no subshell), a backtick span runs its
# contents as a command substitution, and `!` negates a pipeline's exit status without
# preventing it from running: all three are real command positions, not just the four
# operators this class originally covered (found by /code-review of PR #850, 2026-08-17,
# and empirically reproduced — see
# docs/solutions/logic-errors/cmd-position-anchor-missed-brace-backtick-bang-boundaries-2026-08-28.md).
# The prefix then skips any run of env-assignments (NAME=value) and bare command-position
# runner words that take no intervening args. Assignment value class is `*` (not `+`): a
# quote-blanked value can leave `NAME= `. Trailing class closes the token: whitespace, a
# subshell `)`, one of the same ; & | ` operators (a verb with no trailing space before a
# separator, e.g. `git commit;date`, was previously invisible), `{`/`}` (AC-required
# defense-in-depth for this todo, wider than guard-outward-cli.sh's own `_OUT_POS_SUFFIX`,
# which omits them — `}` cannot follow a verb as a REAL brace-group close since bash
# requires a preceding `;`/newline there, so this is belt-and-suspenders, not a live gap),
# or EOL. Mirrors guard-outward-cli.sh's `_OUT_POS_PREFIX`/`_OUT_POS_SUFFIX` opener
# treatment (already correct) MINUS its shell-keyword absorber (then/do/else/elif/time) —
# out of scope for this todo's character-class-only fix.
#
# KNOWN RESIDUAL (harmless): widening `{`+`}` together also makes a bash parameter
# expansion whose variable name equals a matched verb, e.g. `${git}` or `${git commit}`,
# satisfy the anchor (`{` opens, `}` closes) even though the expansion merely reads a
# variable — it does not invoke anything by itself. This is NOT limited to `cmd_is_git`:
# every anchored matcher can fire this way (`cmd_is_git_commit`, `cmd_is_git_head_mover`,
# `cmd_is_gh_pr_create`, etc. all confirmed — the anchor matches rendered TEXT, not valid
# bash syntax, and `${verb subcommand}` is not valid parameter-expansion syntax to begin
# with, so this never corresponds to a real invocation). It stays harmless for every
# DENY-shaped consumer (pr-preflight-guard.sh, branch-preflight.sh check 1 —
# over-triggering on non-executing text is the safe direction for a deny gate) and every
# advisory-only consumer (core-bare-guard.sh's `cmd_is_git` — always exits 0, never
# denies, so a spurious match costs at most a redundant, idempotent
# `git config core.bare false`). One consumer is neither: `drift-detect-update.sh`'s
# `cmd_is_git_head_mover` call WRITES a HEAD baseline on a match rather than denying —
# a spurious `${git commit}`-shaped match there is SUPPRESSIVE, not safe-direction (it
# can refresh the baseline to the current SHA without a real HEAD-moving op, narrowing
# the window in which a genuinely external drift would be noticed). Exploiting it
# requires literal `${verb subcommand}`-shaped text with no real invocation, unlikely by
# accident — noted rather than treated as blocking.
#
# A REDIRECTION joined the prefix's absorber run on 2026-09-01. Bash permits a redirect
# ANYWHERE in a simple command, including BEFORE the command word — `2>/dev/null git
# commit -m x` really does run git (verified by execution: a function printing its argv,
# invoked with a leading redirect, still receives them). The prefix previously absorbed
# only env-assignments and zero-arg runner words, so every matcher in this file silently
# ALLOWED that shape. The operator pattern is `_CMD_REDIR` below — deliberately the SAME
# text cmd_git_branch_create_segment deletes with, because `&>` and `>|` were each a
# separate CRITICAL there and a second, subtly-different redirect pattern in this file is
# a fresh instance of the same bug surface.
_CMD_REDIR='([0-9]*|&)[<>]+[&|]?[[:space:]]*[^[:space:];&|)`]+'
_CMD_POS_PREFIX='(^|[;&|(`{!])[[:space:]]*(([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*|env|command|builtin|exec|nohup|setsid|'"$_CMD_REDIR"')[[:space:]]+)*'
# `<` and `>` joined the closer set on 2026-09-01: a verb GLUED to a redirect
# (`git checkout>&2 -b foo`, `git commit>log`) is a real invocation — bash always splits at
# the operator, no space required — but stage 1's anchor rejected it, so the command was
# invisible before the redirect-deleting sed downstream ever ran. `&>` slipped through only
# because `&` was already a closer, which is exactly why this gap survived the `&>` fix in
# the branch below this one. Neither character can be part of a real unquoted verb word, and
# cmd_words neutralises a QUOTED one to the placeholder, so this can only add REAL matches.
_CMD_POS_SUFFIX='([[:space:]]|[);&|`{}<>]|$)'

# _CMD_GIT_GLOBALS — the option run BETWEEN `git` and its subcommand. Every matcher below
# used to model exactly one global, `-c key=value`, so ALL of these reported "not a git
# commit" for a real one (measured 2026-09-01, all four cmd_is_git_* predicates):
#
#     git -C /path commit      git --no-pager commit      git --git-dir=/x commit
#     git --literal-pathspecs commit                      git 2>/dev/null checkout -b foo
#
# The blindness mattered most for `-C`, which is the spelling CLAUDE.md itself prescribes
# for worktree sessions, so the common form was the invisible one. Grammar deliberately
# mirrors git-safety.sh's MUTATING_GIT_SEG_RE: the arg-taking globals named explicitly,
# then a generic single-token `-…` catch-all, so an unmodeled no-arg global still reaches
# the verb. Widening a matcher can only ADD matches, which is the safe direction for every
# DENY consumer here; the one consumer where over-matching is suppressive rather than safe
# (drift-detect-update.sh's baseline write) is discussed in the residual note above.
#
# INHERITED RESIDUAL, same as git-safety.sh's: an unmodeled SEPARATE-arg global
# (`git --namespace foo commit`) has its argument mis-read as the verb, so the match is
# lost — a false NEGATIVE, never a false positive. The explicitly-named list is what keeps
# the two globals that actually appear in this repo (`-c`, `-C`) out of that residual.
#
# The redirect alternative takes `[[:space:]]*`, not `+`: `git>log commit` is a real
# invocation (bash splits at the operator with no space required), so requiring a space
# would leave a hole the `-`-flag alternatives do not have.
_CMD_GIT_GLOBALS='(([[:space:]]+(-C[[:space:]]+[^[:space:]]+|-c[[:space:]]+[^[:space:]]+|--git-dir[[:space:]]+[^[:space:]]+|--work-tree[[:space:]]+[^[:space:]]+|-[^[:space:]]+))|([[:space:]]*'"$_CMD_REDIR"'))*'

# Verb alternations, named ONCE. cmd_git_repo_dir (below) must be called with the SAME verb
# set as the predicate whose match it is qualifying — passing a wider set re-opens the
# false-DENY described in that function's header — so the sets are constants rather than
# literals repeated at each call site. test-cmd-detect.sh pins the pairing.
_CMD_GIT_VERBS_COMMIT='commit'
_CMD_GIT_VERBS_COMMIT_PUSH='(commit|push)'
_CMD_GIT_VERBS_HEAD_MOVER='(commit|push|rebase|reset|pull|merge|cherry-pick)'
_CMD_GIT_VERBS_BRANCH='(checkout|switch)'

# Repo-redirecting tokens, in TWO classes, because they differ in what the gate did BEFORE
# this change — and "skip when unresolvable" is only safe for the class the old predicate
# could not see.
#
#   GLOBAL form (`-C`, `--git-dir`, `--work-tree`) — sits between `git` and the verb, where
#   the old predicate modelled nothing but `-c key=value`. `git -C /x commit` therefore did
#   NOT match on main (measured), so declining to judge it is exactly the old behaviour.
#
#   ENV form (`GIT_DIR=`, `GIT_WORK_TREE=`) — an inline assignment BEFORE `git`, which
#   `_CMD_POS_PREFIX`'s env-assignment absorber has swallowed since long before this change.
#   `GIT_DIR=.git git commit` DID match on main and DID deny on a detached HEAD (measured).
#   Skipping it would be a deny->allow in a data-loss gate, so it must keep resolving to cwd.
#
# Collapsing the two into one "unresolvable" bucket was a CRITICAL (review, 2026-09-01):
# it silently dropped the deny for `GIT_DIR=.git git commit`, `GIT_WORK_TREE=. git commit`
# and `git -c GIT_DIR=x commit` — the last not even a redirect, just the text `GIT_DIR=`
# appearing as a `-c` VALUE.
#
# `-C` is matched as a PREFIX so the glued `-C/path` form counts too (real git rejects it
# with exit 129, but it must still not be mistaken for a cwd-local invocation). `-c`
# (lowercase, config) is in NEITHER class — it changes settings, never the repository.
_CMD_GIT_REDIRECTS_REPO='(^|[[:space:]])(-C|--git-dir|--work-tree)'
_CMD_GIT_REDIRECT_ENV='(^|[[:space:]])(GIT_DIR|GIT_WORK_TREE)='

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
    # command position in either anchor — `; & | ( )` plus backtick, `{`, `}`, `!`
    # (now part of THIS lib`s own `_CMD_POS_PREFIX`/`_CMD_POS_SUFFIX`, not exclusively
    # guard-local -- see the anchor definition above) -- and a newline (grep is
    # line-oriented, so a surviving newline is a start-of-line command position).
    # `<`, `>`, `#` joined this set on 2026-09-01, when
    # cmd_git_branch_create_segment started treating an unquoted redirect and an
    # unquoted word-start comment as segment boundaries. That made them
    # boundary-significant downstream, and this set`s contract is "everything a
    # quoted span must NOT be able to emit" — so leaving them out let a QUOTED
    # occurrence render identically to real syntax once the quotes were deleted.
    # Both directions were live, and both were caught by review, not by 833
    # green assertions: `git commit -m "#123 fix" && git checkout -b x` had the
    # rest of the line eaten as a comment (a real create went UNDETECTED —
    # deny→allow), and `git checkout -b foo ">bar"` lost a legitimate quoted
    # start-point (`>bar` is a legal ref name). Quote state does not survive to
    # the consumer, so this MUST be fixed here rather than there.
    function neutral(ch) {
      return (ch == ";" || ch == "&" || ch == "|" || ch == "(" || ch == ")" \
              || ch == "{" || ch == "}" || ch == "!" || ch == BT \
              || ch == "<" || ch == ">" || ch == "#" \
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

# cmd_extract_substitutions <command>  → echo the RAW body text of every
# $(...)/backtick command-substitution found in a LIVE quote context (state 0
# unquoted, or state 2 double-quoted), one body per line, recursing into
# nested substitutions (both `$(a $(b))` nesting and a substitution appearing
# inside a nested double-quoted span within an outer one). A substitution
# found inside a SINGLE-quoted or ANSI-C `$'...'` span is genuinely inert in
# bash (those quote forms disable substitution entirely) and is correctly
# skipped — see docs/solutions/logic-errors/quoted-command-substitution-always-executes-2026-08-17.md.
#
# THE MECHANISM cmd_bare/cmd_words fundamentally cannot express: both are a
# FLAT, single-pass state machine (states 0/1/2/3, no stack), so neither can
# represent "resume the outer quote after this nested construct closes" —
# which is exactly what finding a substitution's own matching closer, through
# arbitrary further nesting, requires. This function is a genuinely different
# class of mechanism (an explicit array-based STACK, one quote-state per
# nesting level) rather than a state added to that same machine — the
# Scope Contract of todos/P1-2026-08-17-quoted-command-substitution-inert.md
# (archived) rules out the latter specifically.
#
# WHY NOT DELEGATE TO AN EXISTING PARSER (the design/spike this todo
# required): bash's own DEBUG-trap + extdebug "skip the next command" trick
# (the todo's own parenthetical example) requires a bash feature this
# project's runtime does not have — verified empirically, not assumed: on
# this project's actual `#!/usr/bin/env bash` runtime (macOS system bash
# 3.2.57, confirmed via `bash --version`), neither `command_not_found_handle`
# nor a non-zero DEBUG-trap return skipping the pending command has any
# effect (both probed directly: a `touch` inside a "vetoed" `$(...)` still
# ran). Even where that trick DOES work, it requires literally letting bash
# begin evaluating the untrusted string — an execution-during-detection
# surface this file has never had, and bare redirection (`: > ~/.bashrc`)
# still causes real file damage with PATH emptied, since redirection and
# builtins need no external program. A real parser LIBRARY was evaluated too:
# npm's `shell-quote` (already a project dependency) does not interpret
# `$(...)`/backtick substitution at all (verified: it renders identically for
# single- and double-quoted `$(...)`, losing exactly the live/inert
# distinction this fix depends on); `bash-parser` does build a real AST but is
# 4+ years unmaintained (last publish 2022-06-13) on top of the deprecated
# `babylon` parser, 21 transitive deps — an unacceptable supply-chain
# addition for a security-critical local guard. A hand-written, but properly
# RECURSIVE (stack-based) extractor, reusing this file's own proven
# character-by-character quote-state conventions, was the remaining option.
#
# OUTPUT IS DELIBERATELY NOT A FAITHFUL RECONSTRUCTION of the outer body: when
# a nested substitution is found, its delimiters and contents are NOT
# additionally copied into the enclosing level's own accumulated text (the
# enclosing level gets a "hole" where the nested one was) — the nested body is
# independently emitted as its OWN line instead. Detection does not need the
# enclosing level's text to be complete, only that every substitution's own
# content is captured somewhere in the output; each line is independently
# re-scanned by the caller (cmd_words_deep, below).
#
# UNBALANCED INPUT (a syntax error in real bash, so it would never actually
# run): whatever is accumulated at every still-open level is emitted at EOF
# rather than discarded. Best-effort over-matching is the safe direction for
# every DENY-shaped consumer this function feeds (see cmd_words_deep).
#
# DELIBERATE SIMPLIFICATION, documented rather than silently incomplete: a
# backtick encountered while already inside a nested double-quote (state 2 at
# some depth) always OPENS a new level, never treated as closing an
# enclosing backtick span — real bash's own rules for an unescaped backtick
# nested this way are themselves inconsistent/rarely-used (POSIX recommends
# `$(...)` specifically because backtick nesting requires escaping); this
# matches the common case (a plain, non-nested backtick substitution) and is
# not tuned for a nested-unescaped-backtick corner case no caller writes.
cmd_extract_substitutions() {
  awk '
    BEGIN { SQ = sprintf("%c", 39); DQ = "\""; BS = "\\"; BT = sprintf("%c", 96) }
    { buf = buf $0 "\n" }
    END {
      n = length(buf)
      depth = 0
      state[0] = 0
      for (i = 1; i <= n; i++) {
        c = substr(buf, i, 1)
        d = depth
        s = state[d]
        if (s == 0) {
          if (c == BS) {
            if (d >= 1) accbuf[d] = accbuf[d] c
            i++
            if (i <= n) { if (d >= 1) accbuf[d] = accbuf[d] substr(buf, i, 1) }
          }
          else if (c == "$" && i < n && substr(buf, i+1, 1) == "(") {
            depth++; state[depth] = 0; kind[depth] = "P"; accbuf[depth] = ""
            i++
          }
          else if (c == BT) {
            if (d >= 1 && kind[d] == "B") { print accbuf[d]; depth-- }
            else { depth++; state[depth] = 0; kind[depth] = "B"; accbuf[depth] = "" }
          }
          else if (c == "$" && i < n && substr(buf, i+1, 1) == SQ) {
            state[d] = 3
            if (d >= 1) accbuf[d] = accbuf[d] c
            i++
            if (d >= 1) accbuf[d] = accbuf[d] SQ
          }
          else if (c == "$" && i < n && substr(buf, i+1, 1) == DQ) {
            state[d] = 2
            if (d >= 1) accbuf[d] = accbuf[d] c
            i++
            if (d >= 1) accbuf[d] = accbuf[d] DQ
          }
          else if (c == SQ) { state[d] = 1; if (d >= 1) accbuf[d] = accbuf[d] c }
          else if (c == DQ) { state[d] = 2; if (d >= 1) accbuf[d] = accbuf[d] c }
          else if (c == ")" && d >= 1 && kind[d] == "P") { print accbuf[d]; depth-- }
          else { if (d >= 1) accbuf[d] = accbuf[d] c }
        }
        else if (s == 1) {
          if (d >= 1) accbuf[d] = accbuf[d] c
          if (c == SQ) state[d] = 0
        }
        else if (s == 3) {
          if (c == BS) {
            if (d >= 1) accbuf[d] = accbuf[d] c
            i++
            if (i <= n) { if (d >= 1) accbuf[d] = accbuf[d] substr(buf, i, 1) }
          }
          else if (c == SQ) { state[d] = 0; if (d >= 1) accbuf[d] = accbuf[d] c }
          else { if (d >= 1) accbuf[d] = accbuf[d] c }
        }
        else {
          # s == 2: double-quote at this level -- the LIVE context this whole
          # function exists for. A substitution opener here starts a NEW
          # nested level exactly like the unquoted case; that recursion is
          # the fix.
          #
          # NO DOLLAR-SIGN QUOTE-SIGIL HANDLING HERE, deliberately unlike
          # state 0 above -- NO apostrophe or double-quote character appears
          # ANYWHERE in this comment block; this whole function body is
          # itself inside a bash single-quoted awk program, so a literal
          # apostrophe here would close that outer bash string early and
          # break the file (exactly the mistake a first version of this
          # comment made, see below). cmd_bare and cmd_words -- the two
          # PROVEN, already-shipped renderings this function sits beside --
          # have NO such sigil handling in their own double-quote branches
          # either (grep them for st == 2). The ANSI-C and locale-string
          # sigils are WORD-START constructs in real bash, meaningful only
          # where a NEW word is beginning; inside an ALREADY-OPEN double
          # quote there is no new word starting, so a dollar sign immediately
          # followed by a quote character there is just two ordinary literal
          # bytes, and that quote character is evaluated FRESH on the next
          # loop iteration -- a double-quote closes the span via the DQ
          # branch below (matching real bash exactly), and the ANSI-C form
          # has no special state-2 handler of its own at all, so it falls
          # through to accumulate as literal text like any other character.
          #
          # A first version of this branch copied state ZERO sigil handling
          # in here too, on the assumption the two branches should mirror
          # each other -- that assumption was wrong and cost a CRITICAL
          # (security review, 2026-09-02): a live command substitution
          # immediately preceded by the ANSI-C dollar-quote sigil, while
          # already inside an open double-quoted span, genuinely executes in
          # real bash (the sigil bytes print literally, proving bash never
          # treated them as quote delimiters there) -- but the erroneous
          # branch put THIS function into ANSI-C state at that sigil, which
          # never recognizes a paren-opener as starting a substitution, so
          # the live substitution was silently skipped. Ground-truthed by
          # running the exact string through a real bash and comparing
          # against the output this function itself produces; see
          # test-cmd-detect.sh for the pinned regression case.
          if (c == BS) {
            if (d >= 1) accbuf[d] = accbuf[d] c
            i++
            if (i <= n) { if (d >= 1) accbuf[d] = accbuf[d] substr(buf, i, 1) }
          }
          else if (c == "$" && i < n && substr(buf, i+1, 1) == "(") {
            depth++; state[depth] = 0; kind[depth] = "P"; accbuf[depth] = ""
            i++
          }
          else if (c == BT) {
            depth++; state[depth] = 0; kind[depth] = "B"; accbuf[depth] = ""
          }
          else if (c == DQ) { state[d] = 0; if (d >= 1) accbuf[d] = accbuf[d] c }
          else { if (d >= 1) accbuf[d] = accbuf[d] c }
        }
      }
      while (depth >= 1) { print accbuf[depth]; depth-- }
    }'
}

# cmd_words_deep <command>  → cmd_words(command), joined by NEWLINE with
# cmd_words(body) for every command-substitution body cmd_extract_substitutions
# finds (recursively, so a substitution nested inside another still gets its
# own line).
#
# CALLING CONVENTION DIFFERS from cmd_bare/cmd_words/cmd_extract_substitutions,
# deliberately: those three read the command from STDIN (`printf '%s' "$1" |
# cmd_words`); this one takes it as `$1` directly, like the cmd_is_* wrapper
# functions below, because its body needs the same command text more than
# once (once for cmd_words, once for cmd_extract_substitutions) and re-reading
# stdin a second time is not possible in a plain pipeline. Call it as
# `cmd_words_deep "$CMD"` — piping into it (`... | cmd_words_deep`) leaves its
# own `$1` unset under this file's callers' `set -u` and aborts with an
# "unbound variable" error (caught empirically integrating this into
# guard-outward-cli.sh — the first version of that call site got this wrong).
#
# NEWLINE-joined, never concatenated: grep's `^`/`$` and this file's
# own separator classes are per-line (verified: `grep -oE 'a[^;]*'` over
# multi-line input never spans a match across the newline), so each extracted
# body starts a fresh command position and cannot graft its own tokens onto an
# adjacent line's — the exact "seam spells tokens present in neither string"
# hazard this file's `scan_both` already documents for its own two-source join.
#
# DENY-SHAPED CONSUMERS ONLY — never call this from a check that GRANTS
# something (a carve-out, an allow) rather than only adding a deny. Widening
# can only ADD a match, which is safe for every deny/warn consumer in this
# file, but is UNSAFE for a check keyed on a flag's ABSENCE-grants-nothing /
# PRESENCE-grants-something shape (guard-outward-cli.sh's `gh pr merge --auto`
# carve-out is the one such check in this codebase) — a decoy substitution
# manufacturing that flag as its own, unrelated invocation must never be read
# as satisfying a DIFFERENT command's carve-out. Plain `cmd_words` stays
# byte-identical (this function does not modify it) specifically so that
# check can keep reading it unchanged. See lib/cmd-detect.sh's own header and
# guard-outward-cli.sh's carve-out comments for the fuller reasoning.
#
# EMPTY-OUTPUT INVARIANT PRESERVED: this always calls plain `cmd_words` FIRST,
# unconditionally, so a broken/absent awk still produces the same "empty from
# a non-empty command" signature the existing blocking-gate detectors already
# check for — a bug or pathological input inside cmd_extract_substitutions can
# only cost the ADDED matches, never corrupt or blank the base rendering.
cmd_words_deep() {
  local cmd="$1" body
  printf '%s' "$cmd" | cmd_words
  while IFS= read -r body; do
    [ -n "$body" ] || continue
    printf '\n'
    printf '%s' "$body" | cmd_words
  done < <(printf '%s' "$cmd" | cmd_extract_substitutions)
}

# cmd_is_gh_pr_create <command>  → exit 0 if it invokes `gh pr create` in command position.
# Reads cmd_words_deep, not plain cmd_words: this is a pure boolean DENY-shaped
# predicate (never grants anything), so also matching a verb hidden inside a
# LIVE command substitution can only add a true positive — see cmd_words_deep.
#
# CAPTURE FIRST, THEN GREP — `cmd_words_deep "$1" | grep -Eq ...` looks
# equivalent but is NOT: cmd_words_deep runs as the LEFT side of a pipe, so
# bash executes its whole body (multiple sequential printf/awk calls, unlike
# plain cmd_words's single END-block printf) in a subshell; `grep -Eq` exits
# the instant it finds a match, closing the read end, and cmd_words_deep's
# NEXT write then dies of SIGPIPE (exit 141) — which `pipefail` (every caller
# of this library sets it) turns into a NON-ZERO exit for this whole function,
# even though grep's `-q` short-circuit means it DID find the match. A real
# positive silently read as "not detected" is a fail-OPEN, exactly the
# "early-exiting reader under pipefail" class this repo has hit before (see
# docs/legacy-patterns or grep the codebase for "fails open under pipefail").
# Caught empirically: `cmd_is_git_commit '\`git commit -m x\`'` under `set -o
# pipefail` returned 141, not 0, despite grep genuinely matching line 1.
# `$(...)` command substitution waits for the whole subshell to finish before
# the pipe closes, so there is no live pipe for an early exit to break.
cmd_is_gh_pr_create() {
  local words
  words=$(cmd_words_deep "$1")
  grep -Eq "${_CMD_POS_PREFIX}gh[[:space:]]+pr[[:space:]]+create${_CMD_POS_SUFFIX}" <<< "$words"
}

# cmd_is_git_commit <command>  → exit 0 if it invokes `git [-c k=v]* commit` in command position.
# Deep (see cmd_is_gh_pr_create's note): DENY-shaped, feeds commit-verify.sh only.
# Capture-first (see cmd_is_gh_pr_create's note on the pipefail/SIGPIPE hazard).
cmd_is_git_commit() {
  local words
  words=$(cmd_words_deep "$1")
  grep -Eq "${_CMD_POS_PREFIX}git${_CMD_GIT_GLOBALS}[[:space:]]+${_CMD_GIT_VERBS_COMMIT}${_CMD_POS_SUFFIX}" <<< "$words"
}

# cmd_is_git <command>  → exit 0 if it invokes `git` in command position (ANY subcommand, or
# bare git). Used by core-bare-guard.sh, which heals core.bare before ANY git op.
# Deep (see cmd_is_gh_pr_create's note): advisory-only consumer, always exits 0 itself.
# Capture-first (see cmd_is_gh_pr_create's note on the pipefail/SIGPIPE hazard).
cmd_is_git() {
  local words
  words=$(cmd_words_deep "$1")
  grep -Eq "${_CMD_POS_PREFIX}git${_CMD_POS_SUFFIX}" <<< "$words"
}

# cmd_is_git_commit_or_push <command>  → exit 0 if it invokes `git [-c k=v]* (commit|push)`
# in command position. Used by drift-detect.sh (the two HEAD-movers it warns on).
# Deep (see cmd_is_gh_pr_create's note): warn-only consumer, never denies.
# Capture-first (see cmd_is_gh_pr_create's note on the pipefail/SIGPIPE hazard).
cmd_is_git_commit_or_push() {
  local words
  words=$(cmd_words_deep "$1")
  grep -Eq "${_CMD_POS_PREFIX}git${_CMD_GIT_GLOBALS}[[:space:]]+${_CMD_GIT_VERBS_COMMIT_PUSH}${_CMD_POS_SUFFIX}" <<< "$words"
}

# cmd_is_git_head_mover <command>  → exit 0 if it invokes a HEAD-moving
# `git [-c k=v]* (commit|push|rebase|reset|pull|merge|cherry-pick)` in command position.
# Used by drift-detect-update.sh (the PostToolUse baseline writer).
# Deep (see cmd_is_gh_pr_create's note) — deliberately, even though this is this
# file's ONE consumer where over-matching is SUPPRESSIVE rather than safe (a
# spurious match here refreshes the baseline without a real HEAD move,
# narrowing the drift-detection window; see the residual note near
# _CMD_GIT_GLOBALS above). The reasoning still holds: cmd_extract_substitutions
# only surfaces content from a LIVE quote context, so any match this adds
# corresponds to a substitution that genuinely executes and genuinely moves
# HEAD — refreshing the baseline for it is correct, not spurious. A
# SINGLE-quoted or `$'...'`-quoted head-mover mention (inert, never executes)
# must NOT be matched — pinned in test-cmd-detect.sh specifically for this
# consumer, since it is the one place the distinction is load-bearing rather
# than merely safe-direction.
# Capture-first (see cmd_is_gh_pr_create's note on the pipefail/SIGPIPE hazard).
cmd_is_git_head_mover() {
  local words
  words=$(cmd_words_deep "$1")
  grep -Eq "${_CMD_POS_PREFIX}git${_CMD_GIT_GLOBALS}[[:space:]]+${_CMD_GIT_VERBS_HEAD_MOVER}${_CMD_POS_SUFFIX}" <<< "$words"
}

# cmd_git_repo_dir <command> <verb-ere>  → echo WHICH REPOSITORY the matching git
# invocations act on, so a consumer that reads repo state does not read the wrong repo:
#
#   `.`   (exit 0) — they act on the hook's own cwd; behave exactly as before.
#   <abs> (exit 0) — EVERY one of them is redirected there by `-C <absolute path>`.
#   (exit 1, no output) — a repo redirect is present but unresolvable at the command-string
#                         layer. The caller MUST SKIP its check. Falling back to cwd here
#                         would evaluate a repository the command never touches.
#
# WHY THIS EXISTS. Widening _CMD_GIT_GLOBALS made `git -C /elsewhere commit` visible to the
# predicates above for the first time. On its own that is a REGRESSION, not a fix: every
# consumer of those predicates then reads HEAD, the upstream, or the staged set from its own
# cwd — so a correct command in another repo is judged against this one. The parse and the
# repo resolution are one change or neither.
#
# THE VERB SET IS A PARAMETER, AND MUST MATCH THE CALLER'S PREDICATE. Pass a wider set and
# an unrelated invocation votes on the answer: for `git -C /wt commit && git status`, a
# verb set that accepted `status` would find an unredirected git and return `.`, sending a
# commit-shaped DENY gate to inspect a repo where nothing is committed — a false DENY that
# does not exist today. Use the _CMD_GIT_VERBS_* constant the predicate itself uses.
#
# THE `.`-ON-ANY-UNREDIRECTED-INVOCATION RULE IS WHAT PRESERVES TODAY'S DENIES. In
# `git -C /wt commit && git commit` the second invocation really does commit in cwd, and
# today's gate denies on it. Resolving the command to `/wt` would turn that into an ALLOW —
# a deny→allow transition in a data-loss gate, which is the exact regression class that
# consumed two review rounds of the redirect fix below. One unredirected invocation of a
# verb we care about therefore settles the answer as cwd, immediately.
#
# Segments are split with `tr` rather than a quote-aware scanner because cmd_words has
# ALREADY neutralised quoting: a separator inside a quoted span became the placeholder, so
# every `;`/`&`/`|`/backtick still standing is a real control operator.
#
# ONLY those four, and the omissions are load-bearing. `(`, `)`, `{`, `}` were in this set in
# the first version and it was a CRITICAL: they are not operators, they are ordinary content
# inside an unquoted global's value. `git -c core.hooksPath=$(pwd)/hooks commit -m x` is ONE
# real commit — an argv shim confirms `[-c][core.hooksPath=/…/hooks][commit][-m][x]` — but the
# split severed `git` from its verb, no segment matched, and every consumer skipped: 144
# base-DENY -> new-ALLOW rows over a 6400-input corpus, in the detached-HEAD data-loss gate,
# plus 216/9600 in check 2 (security review, 2026-09-01). This file had already litigated the
# same class once, when adding `{`/`}` to the extractor's terminator class truncated a real
# ref name and was rejected. Nothing is lost by dropping them: `_CMD_POS_PREFIX`'s opener
# class already contains `(`, `{` and backtick, so `( git commit )` and `{ git commit; }` are
# still found without a split. `!` is likewise NOT split on — an opener, not a separator.
#
# RESOLUTION IS DELIBERATELY NARROW — everything it cannot prove falls to exit 1, which is
# today's behaviour (blind), never a new judgement. Unresolvable: a relative `-C` (it
# resolves against the SHELL's cwd, which a `cd` earlier in the same command can have moved
# away from the hook's); an unexpanded `$VAR` (the common `git -C "$WORKTREE"` spelling —
# genuinely unknowable here); the glued `-C/path` form (real git rejects it, exit 129);
# `--git-dir`/`--work-tree`/`GIT_DIR=`/`GIT_WORK_TREE=` (git resolves the git-dir and the
# work-tree INDEPENDENTLY — see git-safety.sh's git_c_target — so one path is not an
# answer); and two invocations naming DIFFERENT directories. Two naming the SAME directory
# resolve fine. Existence is NOT checked here: the function stays pure and string-only, and
# every caller already gates on `git -C "$REPO" rev-parse`, which subsumes it.
#
# NO NECESSARY-SUBSTRING FAST PATH, deliberately. ~8 ms, and only on a command that already
# matched a git-verb predicate — i.e. a real commit/push/checkout, not every Bash call. The
# obvious optimisation, globbing raw "$1" for `-C` and returning `.` on a miss, is unsound
# for the reason every hook in this directory carries a two-stage filter: `git -"C" /tmp
# commit` holds no literal `-C` until cmd_words deletes the quotes. If this ever does need a
# fast path, it needs the stripped second stage too.
cmd_git_repo_dir() {
  local seg span targets="" unresolved=0 saw=0 ntok nval vals uniq

  while IFS= read -r seg; do
    span=$(printf '%s' "$seg" \
      | grep -oE "${_CMD_POS_PREFIX}git${_CMD_GIT_GLOBALS}[[:space:]]+$2${_CMD_POS_SUFFIX}" \
      | head -1) || true
    [ -n "$span" ] || continue
    saw=1

    # No GLOBAL-form redirect ⇒ this invocation is judged against cwd, and that settles the
    # whole command (see the rule above). An ENV-form redirect alone lands here deliberately:
    # the old gate judged those against cwd, and keeping that is what stops this from
    # becoming a deny->allow. See the two-class note on _CMD_GIT_REDIRECTS_REPO.
    printf '%s' "$span" | grep -qE "$_CMD_GIT_REDIRECTS_REPO" || { printf '.\n'; return 0; }

    # A GLOBAL redirect AND an env one together: git resolves the git-dir and the work-tree
    # independently, so neither path is the answer on its own. Unresolvable — and safely so,
    # since a global redirect means the old predicate did not match this command at all.
    if printf '%s' "$span" | grep -qE "$_CMD_GIT_REDIRECT_ENV"; then unresolved=1; continue; fi

    # Every redirecting token must be a clean separate-arg `-C <value>`, or we cannot say
    # where this invocation points. Counting both sides is what rejects the glued and
    # --git-dir forms without enumerating them a second time.
    ntok=$(printf '%s' "$span" | grep -oE "$_CMD_GIT_REDIRECTS_REPO" | grep -c . || true)
    vals=$(printf '%s' "$span" | grep -oE '(^|[[:space:]])-C[[:space:]]+[^[:space:]]+' \
           | sed -E 's/.*-C[[:space:]]+//' || true)
    nval=$(printf '%s' "$vals" | grep -c . || true)
    if [ "$ntok" != "$nval" ]; then unresolved=1; continue; fi
    targets="${targets}${vals}
"
  done <<EOF
$(printf '%s' "$1" | cmd_words | tr ';&|`' '\n\n\n\n')
EOF

  # The predicate matched but this segment scan found no invocation — the two disagree, so we
  # do not know which repo. `git -C /tmp/`pwd` commit` is the shape: the predicate's `-C`
  # value class tolerates the backtick, the split above treats it as the command-position
  # boundary it is. SKIP, do not guess cwd. Answering `.` here was the first version and it
  # is a false-DENY generator — a command that commits somewhere else would be judged against
  # this repo's HEAD.
  #
  # Skipping here CAN lose a deny the old predicate had, but only a SPURIOUS one. The old `-c`
  # value class is `[^[:space:]]+`, which swallows an unquoted separator, so main reads
  # `git -c foo=a;b commit` as a commit. Bash does not — it runs `git -c foo=a`, then a
  # command named `b` — so nothing commits and that deny was never real. A REAL invocation
  # always survives into some segment: `git -c foo=a;git commit` resolves to `.` and keeps
  # its deny. Both are pinned, because only the PAIR discriminates the two readings.
  #
  # This sentence has been wrong twice and both times in the confident direction, so it is
  # worth saying what makes the current version safe rather than plausible: the split is now
  # over unconditional control operators ONLY. When `(`/`)`/`{`/`}` were in that set, a
  # `-c` value containing `$(...)` — a single real invocation — was severed here and the deny
  # was genuinely lost, 144 times over a 6400-input corpus.
  [ "$saw" = 1 ] || return 1
  [ "$unresolved" = 0 ] || return 1

  uniq=$(printf '%s' "$targets" | grep -v '^[[:space:]]*$' | sort -u || true)
  [ "$(printf '%s' "$uniq" | grep -c . || true)" = 1 ] || return 1
  case "$uniq" in
    /*) ;;                  # a relative -C resolves against the shell's cwd, not the hook's
    *) return 1 ;;
  esac
  case "$uniq" in
    *'$'* | *'`'*) return 1 ;;   # an unexpanded substitution is unknowable here
  esac
  printf '%s\n' "$uniq"
}

# cmd_git_branch_create_segment <command>  → echoes the "checkout ..."/"switch ..." argument
# segment (that subcommand through the next control-operator boundary) that carries a real
# create flag, tolerating (a) an attached value (`-bfoo`, no space — genuinely common, not
# exotic) and (b) other flags appearing before it (`-q -b foo`, `--track -c foo`). If the
# command contains MORE THAN ONE checkout/switch invocation, returns the FIRST one that
# actually carries a create flag — not simply the first occurring segment: `git checkout main
# && git checkout -b foo` must resolve to the SECOND segment (a regression found by a second
# review pass, 2026-08-28, in this function's first version, which `head -1`'d the first
# occurrence unconditionally and so missed a real create hiding behind an earlier unrelated
# checkout — exactly the 2026-08-28 incident's own shape). Echoes nothing and returns 1 if no
# segment carries a create flag. Deliberate scope gaps, both documented rather than silently
# incomplete:
#   - plain `git branch <name>` (create-without-switching) is NOT matched — rarer, and
#     ambiguous to distinguish from `-d`/`-D`/`-m`/`-a`/`--list` without a fuller parse.
#   - a BUNDLED short flag where the create letter isn't the bundle's own leading character
#     (`-qb foo`, meaning `-q -b foo` bundled) is NOT matched — the attached-value case above
#     only covers `-b<name>` where `-b` itself leads the token.
# Shared by cmd_is_git_branch_create (below) AND branch-preflight.sh's own start-point
# extraction — ONE definition of "which segment is the real create" for both, since the
# original bug this fixes was exactly two call sites silently disagreeing about that.
# The terminator class `[^;&|)`]` does NOT simply mirror `_CMD_POS_SUFFIX`'s closer set —
# the two classes answer different questions and must be derived independently. Found by
# two /code-review passes, 2026-08-28:
#   (1) `_CMD_POS_SUFFIX` closes a span immediately after a FIXED verb token (`git commit`,
#       `checkout`/`switch` itself) — a backtick belongs there because an unquoted backtick
#       is ALWAYS command-substitution syntax in real bash, never literal payload, so when
#       stage 1 (cmd_is_git_branch_create, which anchors on _CMD_POS_SUFFIX) widened to
#       treat a bare backtick as a boundary, this stage-2 extraction's own terminator had to
#       gain backtick too, or a backtick-wrapped `` `git checkout -b foo` `` would leak the
#       trailing text AFTER the closing backtick into the extracted segment as if it were
#       part of the invocation — manufacturing a spurious start-point token.
#   (2) This terminator instead closes a MULTI-TOKEN ARGUMENT span (the branch/ref name and
#       everything after the create flag) — a real, unquoted git ref name CAN legitimately
#       contain `{`/`}` (`git check-ref-format --branch 'foo{bar}'` exits 0, and bash passes
#       an unquoted `foo{bar}` through to argv literally with no comma/range to expand), so
#       adding `{`/`}` here — done in a first attempt at fix (1), reasoning "stay in sync
#       with _CMD_POS_SUFFIX" — silently TRUNCATED a real explicit start-point
#       (`git checkout -b feature/six{seven} origin/main` lost `origin/main` entirely),
#       flipping branch-preflight.sh's HAS_START_POINT 1→0 and spuriously re-running the
#       stale-upstream check on a command that correctly named one. `{`/`}` must NOT be in
#       this class; only backtick, which can never be real unquoted ref-name content.
# REDIRECTS AND COMMENTS (fixed 2026-09-01, previously the "KNOWN PRE-EXISTING GAP" here).
# An ordinary `git checkout -b foo 2>/dev/null` used to leak the redirection into the
# segment, manufacturing a spurious start-point token and flipping branch-preflight.sh's
# HAS_START_POINT 0→1 — which SKIPS the stale-upstream check on a command that never named
# a start point. Same for `>log.txt` and for a trailing ` # comment`.
#
# These are NOT fixed by widening the terminator character class, and the reason is the
# lesson in (2) above restated for three more characters. `git check-ref-format --branch`
# accepts ALL of `foo#bar`, `foo<bar`, `foo>bar`, so none of them can be excluded on the
# grounds of being illegal in a ref name. What actually separates them is what BASH does
# with them unquoted, which is not the same answer for all three (all verified by running
# them, not by reading):
#   * `<` / `>` — ALWAYS redirection, never literal argv content. `printf x foo>bar`
#     creates a FILE named `bar`; the text never reaches argv. So, like backtick, they can
#     never be real unquoted ref-name content and are always a boundary.
#   * `#` — a comment ONLY at the start of a word. Mid-word it is ordinary literal text:
#     `echo issue#42` prints `issue#42`, and `issue#42` is a legal branch name. Putting a
#     bare `#` in the terminator class would truncate it — exactly the `{`/`}` regression
#     in (2). It is a boundary only when preceded by whitespace or start-of-string.
#   * the fd-prefix DIGITS (`2` in `2>`) cannot be stripped positionally either: a
#     pure-digit trailing token is a REAL start point (`git checkout -b foo 1234567` names
#     an abbreviated SHA). The digits are only an fd when ATTACHED to the redirect operator.
#
# So instead of widening the class, both forms are neutralised before extraction.
# `(^|[[:space:]])` on both is what keeps `issue#42` and `release/2.0` intact.
#
# A REDIRECT IS DELETED, NOT TURNED INTO A TERMINATOR — this distinction is load-bearing
# and the first version of this fix got it wrong. Bash permits a redirection ANYWHERE in a
# simple command, including BETWEEN the subcommand and the create flag
# (`git checkout 2>/dev/null -b foo` really does create a branch — verified with
# `printf '[%s]' checkout 2>/dev/null -b foo` → `[checkout][-b][foo]`). Rewriting it to `;`
# ended the segment BEFORE `-b`, so the extractor found no create flag, returned 1, and
# `cmd_is_git_branch_create` reported "not a create" for a real one — a deny→allow
# regression in the very gate this fix hardens (security review, 2026-09-01). Injecting a
# terminator at a computed offset IS a positional widening of the terminator class, and it
# inherits every hazard the class-widening lesson above describes. Deleting the operator,
# its fd digits and its target word instead leaves the surrounding command intact.
# THE TARGET-WORD CLASS MUST BE THE EXTRACTOR`S TERMINATOR CLASS UNION WHITESPACE. The first
# deleting version wrote the target word as `[^[:space:]]*`, excluding only whitespace — so it
# also ate `;`, `&`, `|`, `)` and backtick, the very characters the `grep -oE` below uses as
# its segment boundary. When a redirect ended a clause with NO space before the separator, the
# separator was deleted and two clauses FUSED into one segment; the `case` then dispatched on
# the merged segment`s first word and never looked for the second verb:
#     git checkout main 2>/dev/null;git switch -c foo
#       -> checkout main  switch -c foo      (one segment, greps for -[bB], finds none)
#       -> NOT a create, though it really creates a branch.
# 240 deny→allow transitions over a 2189-input combinatorial corpus (security review,
# 2026-09-01); the 240 is 10 matched redirect forms × 4 unspaced separators × 6
# verb-mismatched pairs —
# an order of magnitude worse than the regression it was repairing.
# NOTE the direction of the coupling here, because it is the OPPOSITE of the lesson above:
# `_CMD_POS_SUFFIX` and this extractor`s terminator must be derived INDEPENDENTLY, but this
# deletion`s stop-set and that same terminator class are coupled BY CONSTRUCTION — the
# deletion must never consume a character the extractor needs to see. That terminator class
# has already changed twice (backtick added 2026-08-28; `{`/`}` tried and rejected), so a
# reader who over-applies the independence lesson here will desync them and revive the merge.
# `[&|]?` rather than `&?` so the noclobber `>|` form is consumed as one unit too.
#
# TWO EXPRESSIONS, NOT ONE, AND THE SPLIT IS THE WHOLE POINT (review round 4, 2026-09-01 —
# a CRITICAL). Round 3 matched the `&>`/`&>>` family by widening the operator to
# `([0-9]*|&)`, but left it sharing the digit form's `(^|[[:space:]])` boundary. Real bash
# needs no such boundary: it always splits at `<`/`>`, so a redirect GLUED to the preceding
# word is an ordinary invocation. `git checkout main&>/dev/null -b foo` really creates the
# branch (run, not reasoned: the branch exists afterwards), yet the glued `&` survived the
# deletion, and `&` is in the `grep -oE` terminator class below — so the segment was
# TRUNCATED before the create flag and the command reported not-a-create, skipping the very
# stale-base check this todo exists to protect. `>&` and `>|` glued fail identically; only
# the reviewer's `&>` case had been noticed.
#   * expression 1 — the fd-DIGIT form, which KEEPS the boundary, because bash only reads
#     digits as an fd at a word start: `main2>` is the word `main2` plus `>`, verified by
#     running `git checkout main2>/dev/null -b sp` (it creates `sp` off `main2`). Stripping
#     the digit positionally would rename the ref.
#   * expression 2 — everything else, boundary-FREE, because an unquoted `<`/`>` can never
#     be argv content wherever it appears.
# The target class is `+`, not `*` — the change deferred from the branch that split this sed,
# because only now is it observable. A redirect's target is MANDATORY in bash; modelling it as
# optional lets the pattern match a bare `> ` and hand the FOLLOWING word back to be read as
# the command. Once `_CMD_POS_PREFIX` absorbs a redirect (below), `true && > git commit` —
# which creates a FILE named `git` and then runs `commit`, verified with an argv shim — was
# read as a real `git commit`: a false DENY in branch-preflight and, worse, a baseline STAMP
# in drift-detect-update, which absorbs a genuine external drift (security review, 2026-09-01).
# `_CMD_REDIR` carries the same `+` and the same reasoning; the two are a literal copy of one
# another, so any edit to one must be made to both.
#
# THE THREE ANCHOR RESIDUALS THIS BLOCK USED TO LIST ARE NOW CLOSED, all in the anchor where
# they belonged: a redirect BEFORE the subcommand and one glued to the SUBCOMMAND
# (`_CMD_REDIR` in `_CMD_POS_PREFIX`, plus `<`/`>` in `_CMD_POS_SUFFIX`), and the
# `git -C <path>` blindness (`_CMD_GIT_GLOBALS`, with cmd_git_repo_dir for the repo half).
# Still read the list as "what we knew about", never as "everything else is covered": a
# previous version of this note claimed the fix covered every position "from the SUBCOMMAND
# rightward", and the very next review round found a defect living inside the region that
# sentence called covered. The corpus that cleared round 3 reported 190 residual
# missed-creates out of 3811 and they are not all accounted for here.
#
# A COMMENT is still a terminator, because an unquoted `#` genuinely does end the line in
# bash — `git commit -m x # c && git checkout -b foo` never runs the create.
#
# Both rewrites rely on quoted occurrences never reaching them: that is `neutral()`'s job
# (see cmd_words), which is why `<`, `>` and `#` were added to it in the same change. Quote
# state is already gone by the time these run, so it cannot be recovered here.
cmd_git_branch_create_segment() {
  local segment
  while IFS= read -r segment; do
    case "$segment" in
      checkout*) printf '%s' "$segment" | grep -Eq '(^|[[:space:]])-[bB]' \
                   && { printf '%s\n' "$segment"; return 0; } ;;
      switch*)   printf '%s' "$segment" | grep -Eq '(^|[[:space:]])-[cC]' \
                   && { printf '%s\n' "$segment"; return 0; } ;;
    esac
  done <<EOF
$(printf '%s' "$1" | cmd_words \
  | sed -E -e 's/(^|[[:space:]])[0-9]+[<>]+[&|]?[[:space:]]*[^[:space:];&|)`]+/\1/g' \
           -e 's/&?[<>]+[&|]?[[:space:]]*[^[:space:];&|)`]+//g' \
           -e 's/(^|[[:space:]])#.*$/\1;/' \
  | grep -oE '(checkout|switch)[[:space:]]+[^;&|)`]*')
EOF
  return 1
}

# cmd_is_git_branch_create <command>  → exit 0 if it invokes `git checkout -b/-B` or
# `git switch -c/-C` (branch-creation forms) in command position. Two-stage: stage 1 (strict,
# command-position anchored) confirms `checkout`/`switch` is really invoked — this is what
# suppresses a quoted MENTION; stage 2 delegates to cmd_git_branch_create_segment (see above)
# to find the create flag itself, tolerant of an attached value or preceding flags.
# Used by branch-preflight.sh's stale-base-branch check.
#
# DELIBERATELY STAYS ON PLAIN cmd_words, not cmd_words_deep, for BOTH stages —
# unlike every other cmd_is_* predicate in this file. Stage 2
# (cmd_git_branch_create_segment) always reads plain cmd_words on the
# ORIGINAL "$1", and its own `tr`-based clause split is exactly the fragile,
# previously-144-lost-denies-over-6400-inputs logic documented on that
# function above — extending it to see substitution content is out of this
# fix's scope. Making JUST stage 1 deep was tried and measured to have NO
# observable effect (stage 2 remains the bottleneck: it can never find a
# create-flag segment hidden inside a substitution either way), so stage 1
# stays shallow too rather than adding an unused, misleading widening.
# Documented residual: a `checkout`/`switch` create invocation hidden inside a
# live command substitution is not detected by this predicate. None of this
# todo's four reproduction cases are this shape.
cmd_is_git_branch_create() {
  printf '%s' "$1" | cmd_words \
    | grep -Eq "${_CMD_POS_PREFIX}git${_CMD_GIT_GLOBALS}[[:space:]]+${_CMD_GIT_VERBS_BRANCH}${_CMD_POS_SUFFIX}" \
    || return 1
  cmd_git_branch_create_segment "$1" >/dev/null
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
