#!/usr/bin/env bash
# PreToolUse(Bash) — combined git-safety hook. ONE Bash hook (respecting the
# ~140ms/hook budget), two branches:
#
#  A) CONTRACT branch (deny, fail closed) — active only while the session's
#     worktree-contract registry (/tmp/claude-worktree-contracts-<session_id>/,
#     written by scripts/declare-worktree.sh) is non-empty:
#       - mutating git subcommands (commit|mv|rm|restore|checkout|stash|reset|
#         rebase|merge|cherry-pick|apply|am|clean) whose EFFECTIVE repo (cwd, or
#         the `git -C <path>` override; relative -C resolves against cwd) is not
#         a registered worktree and not allowlisted → DENY.
#       - write-shaped shell commands (>/>> redirects, tee, rm, cp/mv destination,
#         sed -i) with an absolute target UNDER THE MAIN CHECKOUT and outside
#         every registered worktree → DENY. (Scoped to the main checkout — the
#         incident class — to avoid false positives elsewhere.)
#     Bypass: SKIP_WORKTREE_CONTRACT=1.
#
#  B) ADVISOR branch (warn only, NEVER blocks — user decision) — on destructive
#     ops (git branch -D, git push --delete/:ref, gh pr close, git worktree
#     remove --force): inject FRESH per-branch PR state as additionalContext so
#     the decision is made on live data, not a stale snapshot (the PR #520
#     incident). gh failure → "UNVERIFIED" warning, still allowed (fail open).
#
# Spec: docs/superpowers/specs/2026-07-17-git-guardrails-design.md §3.1–3.2.
# Tests: .claude/hooks/test-git-safety.sh
set -uo pipefail

if ! command -v jq >/dev/null 2>&1; then
  # Cannot parse the envelope. The advisor (warn-only) is safely skipped, but the
  # CONTRACT branch must not silently disable: if ANY session's registry exists
  # and the raw input smells like a mutating-git or write-shaped command, fail
  # closed with hand-built JSON (mirrors guard-worktree-isolation.sh's no-jq deny).
  INPUT=$(cat)
  if [ -z "${SKIP_WORKTREE_CONTRACT:-}" ] \
     && ls -d /tmp/claude-worktree-contracts-*/ >/dev/null 2>&1 \
     && printf '%s' "$INPUT" | grep -qE 'git[^a-zA-Z]+(commit|mv|rm|restore|checkout|switch|pull|revert|stash|reset|rebase|merge|cherry-pick|apply|am|clean)|>>?|(^|[^a-zA-Z])(tee|rm|cp|mv)[^a-zA-Z]|sed[^|;]*-i'; then
    printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"git-safety: jq unavailable while a worktree-contract registry exists - failing closed for git/write-shaped commands. Bypass: SKIP_WORKTREE_CONTRACT=1."}}'
  fi
  exit 0
fi

INPUT=$(cat)
TOOL=$(printf '%s' "$INPUT" | jq -re '.tool_name' 2>/dev/null) || exit 0
[ "$TOOL" = "Bash" ] || exit 0
CMD=$(printf '%s' "$INPUT" | jq -re '.tool_input.command' 2>/dev/null) || exit 0
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null || echo "")
SESSION=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null || echo "")

deny() {
  jq -n --arg r "$1" \
    '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":$r}}'
  exit 0
}
warn() {
  jq -n --arg c "$1" \
    '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":$c}}'
  exit 0
}

REG_DIR=""
[ -n "$SESSION" ] && REG_DIR="/tmp/claude-worktree-contracts-${SESSION}"
registry_active() { [ -n "$REG_DIR" ] && [ -d "$REG_DIR" ] && [ -n "$(ls -A "$REG_DIR" 2>/dev/null)" ]; }

# Dot segments defeat lexical prefix matching ($WT/../x, /tmp/../x) — treat any
# path containing them as matching nothing, which fails toward deny in the
# contract branch.
has_dot_segments() { case "${1}/" in */../*|*/./*) return 0 ;; *) return 1 ;; esac; }
# Lexically collapse . and .. segments (string-only — no symlink resolution, for
# the same reason has_dot_segments avoids realpath) so a laundered
# /tmp/../<main>/x is judged by where it actually lands.
lex_collapse() {
  local rest="${1#/}" out="" seg
  while [ -n "$rest" ]; do
    seg="${rest%%/*}"
    case "$rest" in */*) rest="${rest#*/}" ;; *) rest="" ;; esac
    case "$seg" in
      ''|'.') ;;
      '..') out="${out%/*}" ;;
      *) out="$out/$seg" ;;
    esac
  done
  printf '%s' "${out:-/}"
}
# emit_write_targets: read a shell command on STDIN, emit each ABSOLUTE-path write
# TARGET on its own line, quote/escape-AWARE in a single pass. A redirect (> >> N> &>)
# or write command (rm/tee/cp/mv/sed -i) counts ONLY when its operator/command word is
# UNQUOTED — the target PATH may still be quoted (the agent-default style the previous
# `tr -d` strip was added for). Because quoted content stays inside its word, a write
# op/command mentioned inside a commit MESSAGE (`git commit -m "writes > /main/out"`) is
# never mined — the false-DENY this replaces. Emission mirrors the prior extractors:
# rm/tee/sed -i → every abs-path arg; cp/mv → the last abs path (destination); redirect
# → the following path. Quote-AWARE incl. bash ANSI-C `$'…'` (st==3) — a `$'…\'…'` used to
# desync the scanner and hide a `>` into the main checkout (a pre-existing false-negative).
# Residuals (guardrail, not sandbox): fd-dup `>&`/`2>&1` split on the `&`; arg-taking
# wrappers still expose the command word; `$(…)`/`${…}`/here-docs unmodeled (over-split =
# false-POSITIVE, not a bypass). Bypass remains SKIP_WORKTREE_CONTRACT=1.
emit_write_targets() {
  awk '
    function addc(ch){ word = word ch; wstart = 1 }
    function addcq(ch){ word = word ch; wstart = 1; wtaint = 1 }
    function seg_reset(){ np = 0; has_rm = 0; has_tee = 0; has_cp = 0; has_mv = 0; has_sed = 0; has_sedi = 0 }
    function endword(   w, tnt){
      if (!wstart) return
      w = word; tnt = wtaint; word = ""; wstart = 0; wtaint = 0
      if (skipword) { skipword = 0; return }
      if (redir)    { redir = 0; if (substr(w, 1, 1) == "/") print w; return }
      if (!tnt) {
        if (w == "rm") has_rm = 1
        else if (w == "tee") has_tee = 1
        else if (w == "cp") has_cp = 1
        else if (w == "mv") has_mv = 1
        else if (w == "sed") has_sed = 1
        else if (substr(w, 1, 2) == "-i" || substr(w, 1, 10) == "--in-place") has_sedi = 1
      }
      if (substr(w, 1, 1) == "/") paths[++np] = w
    }
    function segend(   k){
      endword()
      if (has_rm || has_tee || (has_sed && has_sedi)) { for (k = 1; k <= np; k++) print paths[k] }
      else if (has_cp || has_mv) { if (np > 0) print paths[np] }
      redir = 0; skipword = 0; seg_reset()
    }
    BEGIN { SQ = sprintf("%c", 39); DQ = "\""; BS = "\\"; seg_reset() }
    { buf = buf $0 "\n" }
    END {
      n = length(buf); st = 0
      for (i = 1; i <= n; i++) {
        c = substr(buf, i, 1)
        if (st == 0) {
          if (c == BS) { i++; if (i <= n) { ch = substr(buf, i, 1); if (ch != "\n") addc(ch) } }
          else if (c == "$" && i < n && substr(buf, i + 1, 1) == "$") { addc(c); addc(substr(buf, i + 1, 1)); i++ }
          else if (c == "$" && i < n && substr(buf, i + 1, 1) == SQ) { i++; st = 3; wstart = 1 }
          else if (c == SQ) { st = 1; wstart = 1 }
          else if (c == DQ) { st = 2; wstart = 1 }
          else if (c == ">") { endword(); if (i < n) { nx = substr(buf, i + 1, 1); if (nx == ">" || nx == "|") i++ } redir = 1 }
          else if (c == "<") { endword(); skipword = 1 }
          else if (c == "|" || c == ";" || c == "&" || c == "(" || c == ")" || c == "\n") { segend() }
          else if (c == " " || c == "\t") { endword() }
          else addc(c)
        } else if (st == 1) {
          if (c == SQ) st = 0; else addcq(c)
        } else if (st == 2) {
          if (c == BS) { i++; if (i <= n) addcq(substr(buf, i, 1)) }
          else if (c == DQ) st = 0
          else addcq(c)
        } else {
          # st==3 ANSI-C dollar-quote: BS escapes next (incl. the quote); only an unescaped quote closes
          if (c == BS) { i++; if (i <= n) addcq(substr(buf, i, 1)) }
          else if (c == SQ) st = 0
          else addcq(c)
        }
      }
      segend()
    }
  '
}
# git_c_target: read ONE shell segment (already matched MUTATING_GIT_SEG_RE) on STDIN and emit the
# repo-redirect COMPONENTS present, one per TAGGED line, for the caller to reconstruct git's TWO
# INDEPENDENT write targets from (see emit_effective + the caller loop):
#   g <path>  --git-dir / GIT_DIR   (the git-dir: refs/objects — commit, reset refs, …)
#   c <path>  the cumulative -C fold (last absolute wins, relatives append — the default for BOTH targets)
#   w <path>  --work-tree / GIT_WORK_TREE (the work-tree: working FILES — checkout, reset --hard, …)
# git resolves the git-dir and the work-tree INDEPENDENTLY (git-dir = g else c else cwd; work-tree =
# w else c else cwd), so a --git-dir redirect does NOT move the work-tree — verified: `git
# --git-dir=<other>/.git reset --hard` from cwd=main destroys MAIN files. The caller validates both.
# Any OTHER global (--no-pager/-p/…) is skipped so a later real redirect is still reached. Quote/
# escape-AWARE. A subcommand's own post-verb -C (`git commit -C HEAD` reuses a message) is never
# mined: collection STOPS at the verb. The -C fold replaces a greedy
# `tr -d '\042\047' | sed 's/.*git…-C ([^ ]+)/\1/'` that kept quoted CONTENT and
# matched the LAST `git -C` anywhere, so a commit MESSAGE mentioning `git -C <path>`
# was mined as a real override. That was BIDIRECTIONAL: a main-path decoy fabricated
# a violation (false-DENY) and a registered-worktree decoy laundered a real
# main-checkout mutation past the gate (BYPASS). Tokenizing reads a quoted -C VALUE
# (`git -C '/main'` still DENYs) while a quoted -m message tokenizes as one atomic
# word and is ignored — the role-aware distinction the write-shaped fix used
# (docs/solutions/logic-errors/quote-strip-escape-glue-hides-real-command-2026-07-18.md).
# The env-assignment PREFIX is taint-TOLERANT (so `FOO='x' git -C /main` is not a
# false-negative), but every recognized token — `git`, `-C`, `--git-dir`, `--work-tree`,
# and the GIT_DIR/GIT_WORK_TREE values — is taint-STRICT: a quoted flag or value is left
# opaque for the documented quote-blindness residual below. Safe because the quote-blind
# MUTATING_GIT_SEG_RE either skips a quoted-flag segment (`git '-C' <main>`) or, when it
# does match a quoted redirect VALUE (`--git-dir='<v>'`), the strict recognition captures
# nothing and the effective repo falls to cwd. This tokenizer, split_segments, and
# emit_write_targets all handle `'…'`, `"…"`, and bash ANSI-C `$'…'` (st==3) — a
# `$'…\'…'` used to desync the scanner and swallow real separators (a false-NEGATIVE that
# a PARTIAL quote model, worse than none on a gate, reintroduced). The three share NO code
# but ARE pinned against one quote-torture corpus in test-git-safety.sh so they cannot
# drift. Residuals (ACCEPTED — guardrail, not sandbox; NOT "complete" — the same
# shell-wrapper residual class, backstopped by SKIP_WORKTREE_CONTRACT=1 + the file-tool guard):
#   (`$$` PID pairing IS modeled — a run of `$` is consumed in pairs before the `$'` check,
#   so only an UNPAIRED `$` before `'` enters ANSI-C, matching bash; an even run `$$'…\'` is a
#   normal single quote.) Remaining residuals:
#   - WITHIN-segment quote-blindness: a WHOLLY quoted `-C` flag/keyword (`git '-C' <main>`, `g"i"t`)
#     or a space-bearing flag/env VALUE (`git -C '/a b' …`, `--git-dir='/a b/.git'`, `FOO='a b' git
#     -C <main>`) isn't recognized by the quote-blind SEG_RE (its value class is `[^space]+`), so
#     such a segment is skipped — the shell-wrapper residual class
#     (same as sudo/env/command/xargs/subshell/eval; SKIP_WORKTREE_CONTRACT is not needed to
#     hit it, but the file-tool guard is a second layer and this is a guardrail, not a sandbox).
#     A tainted DECOY global followed by a real UNQUOTED redirect (`git --no-adv'i'ce -C <main>`) is
#     NOT in this residual — the generic global-skip is taint-INDEPENDENT, so the scan reaches the
#     real -C and DENYs (a review-found bypass, now closed).
#     Glued `-C<path>` is NOT a bypass: real git REJECTS it (`unknown option`, EXIT 129) — no
#     mutation happens. The broadened SEG_RE matches its single token as a generic global, so
#     with cwd=main it (harmlessly) DENYs. (Chained/interleaved -C, --git-dir/--work-tree [glued
#     + separate], the INLINE GIT_DIR=/GIT_WORK_TREE= env prefix, and an unmodeled global before
#     the verb are all HANDLED now — see the function summary above and MUTATING_GIT_SEG_RE.)
#   - QUOTED redirect VALUE under an UNQUOTED flag/name (`git --git-dir='<main>/.git' commit`,
#     `GIT_DIR='<main>/.git' git commit`): taint-STRICT capture reads nothing, so the git-dir falls
#     to cwd → ALLOW from a worktree cwd (verified). The UNQUOTED flag/env forms ARE closed; only
#     this quoted-value variant remains — the same within-segment quote-blindness class.
#   - CROSS-SEGMENT / exported env: each `;`/`|`/`&`-separated segment is validated independently,
#     so an assignment or `export` in an EARLIER segment (`export GIT_DIR=<main>/.git && git commit`)
#     is not applied to git in a later one → ALLOW (verified); a truly ambient exported
#     GIT_DIR/GIT_WORK_TREE in the hook's own environment is likewise unseeable. Only the INLINE
#     same-segment prefix is closed. Structurally out of scope at the command-string layer.
#   (SPLIT `--git-dir`≠`--work-tree` at DIFFERENT checkouts is now CLOSED: the caller validates the
#   git-dir target AND the work-tree target independently and DENYs if EITHER is outside the
#   worktrees — conservative for a commit whose refs go to the safe side, but never a bypass.)
#   - A RELATIVE `--git-dir`/`--work-tree` with a LATER `-C` resolves against cwd, not the -C'd dir
#     (order-dependent). An unmodeled SEPARATE-arg global (`--namespace foo`) is a MATCHER miss,
#     NOT a walker one: the segment fails MUTATING_GIT_SEG_RE and takes its `|| continue`, so
#     git_c_target never runs and cannot 'mis-read its arg as the verb'. Measured NOMATCH, with
#     `git commit -m x` MATCH and `echo hello` NOMATCH as controls in the same run. It is a live
#     route — real git accepts the separate-space form and still honours a later `-C` — and is
#     pre-existing, identical on main. Layer attribution matters here: residual 6 below was
#     re-attributed to the coarse pre-filter for the same reason, and a residual blamed on the
#     wrong layer sends the eventual fix to a file that cannot close it.
#     Both obscure; SKIP_WORKTREE_CONTRACT=1 / the file-tool guard backstop.
#   - `$(…)`/`${…}` substitution, here-docs, `\`-newline continuation are unmodeled: they
#     over-split (a false-POSITIVE/extra DENY), never an inversion-swallow false-negative.
#   - ANSI-C escape DECODING is not modeled: `$'\x2f…'`/`\nnn`/`\uHHHH` read as literal chars,
#     so `git -C $'\x2fmain'` (bash decodes to `/main`) is seen as non-absolute → resolves
#     under cwd → a FALSE-NEGATIVE (decode-divergence, not inversion-swallow). Pre-existing,
#     obscure (deliberate hex-encoding); SKIP_WORKTREE_CONTRACT=1 / the file-tool guard backstop.
git_c_target() {
  awk '
    function fold(t){                                # cumulative -C: last absolute wins, relatives append (mirrors git chdir)
      if (t == "") return                            #   empty -C is a git no-op; skip it (no gotc, no trailing slash)
      if (substr(t, 1, 1) == "/") eff = t
      else eff = (eff == "" ? t : eff "/" t)
      gotc = 1
    }
    function resolve_target(t){                      # --git-dir/--work-tree/GIT_DIR/GIT_WORK_TREE target:
      if (substr(t, 1, 1) == "/") return t           #   absolute → as-is; relative → resolve against the -C fold
      return (eff == "" ? t : eff "/" t)             #   (mirrors fold above; relative + a LATER -C = ordering residual)
    }
    function setgd(t){ if (t != "") { gitdir = resolve_target(t); gotgd = 1 } }   # --git-dir / GIT_DIR redirect
    function setwt(t){ if (t != "") { worktree = resolve_target(t); gotwt = 1 } } # --work-tree / GIT_WORK_TREE redirect
    function emit_effective(){                       # emit the redirect COMPONENTS; the caller
      # reconstructs the TWO INDEPENDENT targets git mutates and validates BOTH of them:
      #   git-dir (refs/objects) = --git-dir/GIT_DIR (g), else the -C fold (c), else cwd.
      #   work-tree (working FILES: checkout, reset --hard, restore, clean, …) = --work-tree/
      #     GIT_WORK_TREE (w), else the -C fold (c), else cwd.
      # git resolves these INDEPENDENTLY: a --git-dir redirect moves ONLY the git-dir — the work-tree
      # still defaults to -C/cwd — so `git --git-dir=<worktree>/.git reset --hard` from cwd=main
      # destroys MAIN files (verified). Hence BOTH targets are checked; the -C fold (c) is emitted
      # even alongside a git-dir so it can still serve as the implicit work-tree.
      if (gotgd) print "g " gitdir
      if (gotc)  print "c " eff
      if (gotwt) print "w " worktree
    }
    function endword(   w, tnt, wsn, wop){
      if (!wstart) return
      w = word; tnt = wtaint; wsn = wsan; word = ""; wsan = ""; wstart = 0; wtaint = 0
      wop = (match(wsn, /[<>]/) ? RSTART : 0)
      if (done) return
      if (phase == 0) {                              # command position
        if (w ~ /^[A-Za-z_][A-Za-z0-9_]*=/) {        #   env assignment (value may be quoted): stay in phase 0,
          if (!tnt && w ~ /^GIT_DIR=/)            setgd(substr(w, 9))   #   but capture a repo-REDIRECTING one:
          else if (!tnt && w ~ /^GIT_WORK_TREE=/) setwt(substr(w, 15))  #   GIT_DIR/GIT_WORK_TREE mutate <target>
          return
        }
        if (!tnt && w == "git") { phase = 1; return } #   the real git
        done = 1; return                              #   some other command: stop looking
      }
      # phase 1: walk the git global options until the verb, resolving EVERY repo redirect.
      # git honors cumulative -C (last absolute wins) and --git-dir/--work-tree redirects; a
      # benign unmodeled global (--no-pager/-p/…) must be skipped so a later real -C is reached.
      # WSAN: a SHADOW of this word in which every ESCAPED or QUOTED character is `_`, a
      # character no operator class contains. Every operator predicate below reads the shadow;
      # every CONTENT read still uses the real word, so a value keeps its own characters.
      # WHY IT EXISTS: a backslash-escaped `<`/`>` is a LITERAL character in argv, but the
      # scanner appends it WITHOUT tainting, so `index(w, ">")` could not tell `a.b=c\>` from
      # `a.b=c>`. That was harmless while the pend arms ran FIRST -- the `-c` value was consumed
      # before the redirect arm was reached -- and became a live ALLOW of a cross-checkout
      # mutation the moment the 2026-09-17 reorder put the redirect arm above them: tailop saw a
      # word ending in a literal `>`, set predir, and predir swallowed the REAL `-C` flag, so
      # nothing was emitted and the repo fell back to cwd. Measured DENY->ALLOW on
      # `git -c a.b=c\> -C <main> reset --hard`, argv identical under bash 5.3.15 and zsh 5.9.
      # A SHADOW rather than a re-spelled predicate, because the first attempt at this fix
      # redefined tailop as "operator run reaches the end of the word" and broke `git >a> -C
      # <path> commit`, where a genuinely target-less trailing `>` really does consume the next
      # word (argv-verified). Masking the input leaves every predicate meaning what it meant.
      if (predir)       { predir = 0; return }          #   target word of a SPACED redirect operator
      # A brace-only fd word was skipped last round (see the pendbrace arm further down). Decide
      # what it WAS by looking at THIS word: a redirect operator here means zsh consumed the pair
      # as an fd-var redirect, so let this word fall through to the redirect arm and keep scanning
      # for a later -C. Anything else means both shells treat the brace word as an ordinary
      # argument (git errors on it), so it was the verb: emit and stop, exactly as the verb branch
      # would have done had the brace word not been skipped. Deciding one word LATE is the only
      # way to tell the two shells apart, because the brace word alone is ambiguous.
      if (pendbrace) {
        pendbrace = 0
        if (tnt || wop == 0) { emit_effective(); done = 1; return }
      }
      # THE pend / FLAG / dash-skip ARMS NOW SIT BELOW THE REDIRECT ARM, and the ORDER IS THE FIX
      # (2026-09-17). They used to run FIRST, so an arg-taking global whose VALUE SLOT held a
      # redirect folded the operator as the value: `git -C >out <main> commit -m x` emitted
      # `c >out`, a RELATIVE path that resolved under cwd, and a real main mutation was ALLOWED
      # from a worktree cwd. The shell strips a redirect from the word list WHEREVER it sits --
      # including between a flag and its value -- so classifying redirects first is what mirrors
      # the shell rather than a special case for one slot. The brace-fd spelling
      # (`git -C {fd} >o <main> commit`) is the same defect one token over and is closed by the
      # same move, because the brace class below also now precedes these arms.
      # Filed as todos/archive/P1-2026-09-16-redirect-in-arg-taking-global-value-slot-defeats-both-…
      # A brace-ONLY word with no operator in it (`{fd}`, `{9}`). This is the WHITESPACE axis of
      # _CMD_REDIR (`[}][[:space:]]*`), which the rpre class below can never see: rpre is the
      # prefix of a SINGLE word before its first operator, and this word has no operator at all.
      # Measured: zsh lexes `{fd} >o` as an fd-var redirect (argv drops both tokens) while bash
      # keeps `{fd}` as an ordinary argument. Defer one word rather than guess — see pendbrace.
      if (!tnt && w ~ /^[{]([A-Za-z_][A-Za-z0-9_]*|[0-9]+)[}]$/) { pendbrace = 1; return }
      # A REDIRECT token is not the verb (2026-09-13). It starts with a digit, `>`, `<`, `&`
      # or `{`, so the dash-skip above misses it and it used to fall through to the verb
      # branch below — ENDING the scan, so a repo-redirecting global AFTER it was never mined
      # and the target silently fell back to cwd. Measured, both directions: with cwd inside a
      # registered worktree `git 2>/dev/null -C <main> commit -m x` resolved to cwd and was
      # ALLOWED though it really mutates main; with cwd at main, `git 2>/dev/null -C <worktree>
      # commit -m x` — the -C spelling CLAUDE.md prescribes — was DENIED though it is safe.
      # Ordering is the discriminator that proves this is the tokenizer and not the regex: the
      # same tokens with the redirect AFTER the -C always resolved correctly.
      # `!tnt` is load-bearing: a QUOTED redirect-shaped token is a literal ARGUMENT, not a
      # redirect, and must NOT be skipped.
      #
      # THE PREFIX BEFORE THE FIRST OPERATOR DECIDES WHICH OF THREE THINGS THIS WORD IS, and
      # collapsing them into one blanket skip was wrong in two measured ways (review round 2):
      #   * prefix EMPTY or an fd number (`2>/dev/null`, `>out`, `{fd}>x`) — a real redirect.
      #     Skip it. If the word ENDS at the operator (`2>` in `git 2> /dev/null -C <main> …`)
      #     bash spells the redirect as TWO words, so the TARGET is the next word: set predir
      #     and swallow that too. Skipping only the operator left `/dev/null` to be read as the
      #     verb, which ended the scan and reproduced the exact regression this arm fixes — a
      #     new false-DENY on the `-C <worktree>` idiom — in the spaced spelling. That spelling
      #     was invisible because the corpus varied WHERE the redirect sits while holding
      #     operator-to-target spacing glued: an axis you do not vary is an axis where a defect
      #     is invisible.
      #   * prefix is a real WORD (`commit>log`) — that prefix IS the verb, merely glued to a
      #     redirect. Emit and STOP, exactly as a bare verb would. Skipping it instead ran the
      #     walker on into post-verb territory and broke this function-s own stated invariant
      #     that collection stops at the verb: `git -C <main> commit>log -C /tmp/x` emitted
      #     `c /tmp/x`, letting a post-verb token overwrite the real repo redirect.
      # Deciding on the PREFIX rather than on the presence of an operator anywhere is what keeps
      # those three cases apart. It is not a re-derived redirect grammar: the only classes are
      # empty, all-digits, and a `{name}` or `{N}` fd — the same insight stated in the note on
      # _CMD_POS_SUFFIX. BOTH brace forms belong here: `_CMD_REDIR` admits digits inside the
      # braces, so narrowing this class to names alone leaves the matcher MATCHING a row this
      # tokenizer then emits nothing for, the repo falls back to cwd, and the hook ALLOWs a real
      # main mutation (zsh reads `{9}>` as an fd-var redirect). Pinned by the `{9}`/`{fd}` pair
      # in test-git-safety.sh: widen a detector and its consumers in ONE change, never half.
      # NOT one-directional, despite how a tightening reads. Measured over a 440-row corpus by
      # mutating this one class back: 24 DENY->ALLOW, 12 ALLOW->DENY, 404 unchanged. Every one
      # is a CORRECT resolution -- 12 of the relaxations are the false-DENY repair (the
      # prescribed -C <worktree> spelling stops being denied) and 12 are position-B rows where
      # real git resolves to the LAST absolute -C. Do NOT quote a DENY->ALLOW count against
      # origin/main here: over a 1200-row brace/redirect corpus origin/main denies 0 of 1200,
      # because its MUTATING_GIT_SEG_RE has no redirect branch and matches no redirect-bearing
      # segment at all -- a zero against that baseline is VACUOUS, not reassuring. The
      # differential that HAS a denominator is pre-pendbrace to HEAD over the same corpus: 396
      # rows deny on the pre-fix side, 360 stay DENY, 36 become ALLOW (every one ending with the
      # last absolute -C at the registered worktree, correct under last-absolute-wins), and 54
      # go ALLOW->DENY (every one targeting main). Zero incorrect relaxations. Quote the
      # denominator with any such count. Do not restate this as monotone.
      # THE OTHER AXIS: _CMD_REDIR also carries a trailing [[:space:]]* after the closing brace.
      # That half cannot live in THIS class -- rpre is the prefix of a SINGLE word, and a
      # brace-only word has no operator to take a prefix of -- so it is handled one word later
      # by the pendbrace state above. Adopting only the axis that happened to fail is how the
      # first attempt at this fix shipped a half-widening.
      # _CMD_POS_SUFFIX, that neither `<` nor `>` can be part of a real unquoted word.
      # (No apostrophe appears in this block on purpose: the whole program is inside a
      # single-quoted awk string, so one would close it and hand the rest to the shell.)
      if (!tnt && wop > 0) {
        rpre = substr(w, 1, wop - 1)
        # A `&` sitting DIRECTLY before the operator belongs to the OPERATOR, not to the prefix:
        # _CMD_REDIR spells it `&?[<>]+`. Stripping it here rather than widening the class below
        # fixes two cells at once and keeps them from needing separate arms -- `&>o` (prefix
        # becomes empty, a plain redirect) and `-C&>o` (prefix becomes the FLAG `-C`, so the
        # real `-C <main>` is still mined). Both were live ALLOWs of real main mutations.
        if (wop > 1 && substr(wsn, wop - 1, 1) == "&") rpre = substr(w, 1, wop - 2)
        tailop = (wsn ~ /[<>]+&?[|!]?$/)
        if (rpre == "" || rpre ~ /^[0-9]+$/ || rpre ~ /^[{]([A-Za-z_][A-Za-z0-9_]*|[0-9]+)[}]$/) {
          #   Does this word END AT the operator, so its TARGET is the next word? The test must
          #   be "ends with a complete operator RUN", not "ends with a character from the
          #   operator class". `[<>&|!]$` was the latter and matched `>out!` on the FILENAME:
          #   predir then swallowed the following `-C <main>`, the path after it was read as
          #   the verb, nothing was emitted, and the repo fell back to cwd — a DENY->ALLOW
          #   bypass of the whole destructive family (`>out! -C <main> reset --hard`,
          #   `clean -fdx`, `--work-tree=<main> reset --hard`), each with a one-character
          #   control (`>out`) that still denied. Do NOT narrow by dropping `!`/`|`: they model
          #   `>|` and the zsh `>!` form, and this predicate keeps both plus a trailing `>`
          #   (`>a>`), which is a genuine target-less operator.
          if (tailop) predir = 1                          #   operator with no target: next word is it
          return                                          #   a real redirect: skip, keep scanning
        }
        # A REAL PREFIX GLUED TO A REDIRECT. The shell removes the operator, so the prefix keeps
        # exactly the role it would have had standing alone: the awaited VALUE while a pend is
        # open (`git -C <main>>o commit`), a FLAG when it starts with a dash (`git -C>o <main>
        # commit`), and otherwise the VERB (`commit>log`), which ends the scan as before.
        # Folding the WHOLE word is why `git -C <main>>o commit` denied only BY ACCIDENT -- the
        # value it emitted still LOOKED absolute -- so a reorder that did not add this branch
        # would have converted that accident into a DENY->ALLOW regression. Measured as such:
        # the grid caught it before the reorder shipped.
        if (pend != "" || substr(rpre, 1, 1) == "-") {
          if (tailop) predir = 1
          w = rpre                                        #   fall through: the prefix is re-read below
        } else { emit_effective(); done = 1; return }     #   a VERB glued to a redirect: stop here
      }
      if (pend == "C")  { fold(w);  pend = ""; return } #   -C arg (value may be quoted): accumulate
      if (pend == "c")  { pend = ""; return }           #   -c value: skip (its name=value token)
      if (pend == "gd") { setgd(w); pend = ""; return } #   --git-dir arg (separate form)
      if (pend == "wt") { setwt(w); pend = ""; return } #   --work-tree arg (separate form)
      if (!tnt && w == "-C") { pend = "C"; return }     #   real -C flag: next word is its arg
      if (!tnt && w == "-c") { pend = "c"; return }     #   real -c flag: skip its value
      if (!tnt && w == "--git-dir")   { pend = "gd"; return }   #   separate: --git-dir <path>
      if (!tnt && w == "--work-tree") { pend = "wt"; return }   #   separate: --work-tree <path>
      if (!tnt && w ~ /^--git-dir=/)   { setgd(substr(w, 11)); return } #   glued: --git-dir=<path>
      if (!tnt && w ~ /^--work-tree=/) { setwt(substr(w, 13)); return } #   glued: --work-tree=<path>
      # Any OTHER global (no-arg): skip, keep scanning. TAINT-INDEPENDENT (unlike the value
      # captures above): a dash-token here is always a global since no mutating verb starts with a
      # dash, so skipping a QUOTED decoy flag still lets a later real -C be reached — a taint-gated
      # skip would instead halt the scan at the decoy and miss the real redirect (a bypass).
      if (substr(w, 1, 1) == "-") return
      emit_effective()                                  #   first non-option word = the verb: emit & stop
      done = 1                                           #   (git commit -C HEAD: a -C after the verb is never mined)
    }
    BEGIN { SQ = sprintf("%c", 39); DQ = "\""; BS = "\\"; phase = 0 }
    { buf = buf $0 "\n" }
    END {
      n = length(buf); st = 0
      for (i = 1; i <= n; i++) {
        c = substr(buf, i, 1)
        if (st == 0) {
          if (c == BS) { i++; if (i <= n) { ch = substr(buf, i, 1); if (ch != "\n") { word = word ch; wsan = wsan "_"; wstart = 1 } } }
          else if (c == "$" && i < n && substr(buf, i + 1, 1) == "$") { word = word c substr(buf, i + 1, 1); wsan = wsan "__"; wstart = 1; i++ }
          else if (c == "$" && i < n && substr(buf, i + 1, 1) == SQ) { i++; st = 3; wstart = 1 }
          else if (c == SQ) { st = 1; wstart = 1 }
          else if (c == DQ) { st = 2; wstart = 1 }
          else if (c == " " || c == "\t" || c == "\n") { endword() }
          else { word = word c; wsan = wsan c; wstart = 1 }
        } else if (st == 1) {
          if (c == SQ) st = 0; else { word = word c; wsan = wsan "_"; wstart = 1; wtaint = 1 }
        } else if (st == 2) {
          if (c == BS) { i++; if (i <= n) { word = word substr(buf, i, 1); wsan = wsan "_"; wstart = 1; wtaint = 1 } }
          else if (c == DQ) st = 0
          else { word = word c; wsan = wsan "_"; wstart = 1; wtaint = 1 }
        } else {
          # st==3 ANSI-C dollar-quote: BS escapes next char (incl. the quote); only an unescaped quote closes
          if (c == BS) { i++; if (i <= n) { word = word substr(buf, i, 1); wsan = wsan "_"; wstart = 1; wtaint = 1 } }
          else if (c == SQ) st = 0
          else { word = word c; wsan = wsan "_"; wstart = 1; wtaint = 1 }
        }
      }
      endword()
      # Fail-safe, and it IS REACHED TODAY — this note has now been wrong in three successive
      # revisions, so the evidence is recorded rather than the conclusion alone.
      #   rev 1: "UNREACHABLE: SEG_RE-matched segments always contain a verb, so the verb
      #          branch sets done=1 first."
      #   rev 2: "REACHABLE" — true at the time, but only because a first cut at the
      #          redirect-skip arm skipped `commit>log` wholesale. That was a defect (it also
      #          ran the walker past the verb, letting a post-verb `-C /tmp/x` overwrite a real
      #          `-C <main>`), and fixing it took the reachability away again.
      #   rev 3: "still UNREACHABLE" — wrong for a reason neither earlier revision considered.
      # The real route has been open the whole time and has nothing to do with redirects: the
      # generic no-arg global arm `-[^[:space:]]+` lets an ARG-TAKING flag swallow the verb
      # token, so no word ever reaches the verb branch. `git -C <main> -c commit` is the
      # witness — `-c` sets pend and eats `commit`. Proven by MUTATION with both-direction
      # controls: with this line disabled, that command flips DENY->ALLOW from a worktree cwd
      # and `git -C /tmp/x -c commit` flips ALLOW->DENY from a main cwd, while four
      # neighbouring rows are unchanged.
      # Firing is harmless in itself (real git rejects a bare `-c`, so this is over-denial),
      # but the line is LOAD-BEARING, not dead — keep it, and do not let a future reading of
      # "unreachable" justify deleting a guard that runs.
      if (!done) emit_effective()
    }
  '
}
# split_segments: read a shell command on STDIN and emit each top-level segment on its
# own line, split on UNQUOTED `;` `|` `&` and newline — QUOTE/ESCAPE-AWARE incl. bash
# ANSI-C `$'...'` (see the shared quote-torture corpus in test-git-safety.sh, which pins
# all three scanners against the SAME strings so they cannot drift again — the drift that
# caused the `$'...'` regression). Quoted spans + escapes are emitted VERBATIM so the
# downstream quote-aware git_c_target re-parses them. A PARTIAL quote model is worse than
# none here: `$'…\'…'` used to invert the state and swallow real separators (a
# false-negative), so `$'...'` (st==3) is handled. Residuals (guardrail, not sandbox;
# documented, NOT "complete"): `$(…)`/`${…}` command/param substitution, here-docs
# (`<<`/`<<<`), and `\`-newline continuation are not modeled — over-splitting there is a
# false-POSITIVE (extra DENY), never an inversion-swallow; `$"…"` needs no handling
# (double-quote escaping already covers it). These are ACCEPTED (they fail toward DENY).
split_segments() {
  awk '
    function flush(){ print seg; seg = "" }
    BEGIN { SQ = sprintf("%c", 39); DQ = "\""; BS = "\\" }
    { buf = buf $0 "\n" }
    END {
      n = length(buf); st = 0; praw = ""
      for (i = 1; i <= n; i++) {
        c = substr(buf, i, 1)
        if (st == 0) {
          nxt = (i < n ? substr(buf, i + 1, 1) : "")
          if (c == BS) { seg = seg c; i++; if (i <= n) seg = seg substr(buf, i, 1); praw = "" }
          else if (c == "$" && i < n && substr(buf, i + 1, 1) == "$") { seg = seg c substr(buf, i + 1, 1); i++; praw = "" }
          else if (c == "$" && i < n && substr(buf, i + 1, 1) == SQ) { seg = seg c substr(buf, i + 1, 1); i++; st = 3; praw = "" }
          else if (c == SQ) { seg = seg c; st = 1; praw = "" }
          else if (c == DQ) { seg = seg c; st = 2; praw = "" }
          # An `&` or `|` ADJACENT to `<`/`>` is part of a REDIRECT OPERATOR, not a separator.
          # Without this the scanner flushed mid-operator and `git 2>&1 commit -m x` arrived as
          # `git 2>` + `1 commit -m x`, so neither half matched and the contract was never
          # checked (todos/archive/P1-2026-09-13-split-segments-fractures-redirect-operators-…).
          # The adjacency test is derived from the `&?[<>]+&?[|!]?` shape _CMD_REDIR already
          # spells, which keeps the surrounding `&`/`|` as part of ONE unit, rather than from a
          # second local grammar. (NO APOSTROPHE anywhere in this awk program: it is inside a
          # single-quoted string, so one would close it and hand the rest to the shell. That is
          # not hypothetical -- the first draft of this comment did exactly that.)
          # praw is the last character appended in state 0 UNQUOTED and UNESCAPED — reading
          # buf[i-1] directly would misread `echo \>& foo`, where the `>` is a literal and the
          # `&` really is a separator, and merging there is the false-ALLOW direction.
          # `&?[<>]+&?[|!]?` -- so a LEADING `&` needs `<`/`>` next (`&>`), a TRAILING one needs
          # `<`/`>` behind it (`>&`, `2>&`), and only `[|!]` may follow that `&` (`>&|`). A second
          # `&` may NOT (`>&&` is not an operator), which is why the two arms differ.
          else if (c == "&" && (nxt == ">" || nxt == "<" || praw == ">" || praw == "<")) { seg = seg c; praw = c }
          else if (c == "|" && (praw == ">" || praw == "<" || praw == "&")) { seg = seg c; praw = c }
          else if (c == ";" || c == "|" || c == "&" || c == "\n") { flush(); praw = "" }
          else { seg = seg c; praw = c }
        } else if (st == 1) {
          seg = seg c; if (c == SQ) { st = 0; praw = "" }
        } else if (st == 2) {
          if (c == BS) { seg = seg c; i++; if (i <= n) seg = seg substr(buf, i, 1) }
          else if (c == DQ) { seg = seg c; st = 0; praw = "" }
          else seg = seg c
        } else {
          # st==3 ANSI-C dollar-quote: BS escapes next (incl. the quote); only an unescaped quote closes
          if (c == BS) { seg = seg c; i++; if (i <= n) seg = seg substr(buf, i, 1) }
          else if (c == SQ) { seg = seg c; st = 0; praw = "" }
          else seg = seg c
        }
      }
      flush()
    }
  '
}
allowlisted() {
  has_dot_segments "$1" && return 1
  case "$1" in
    /tmp/*|/private/tmp/*|/var/folders/*|/private/var/folders/*|"${HOME:-/nonexistent}"/.claude/*) return 0 ;;
    *) return 1 ;;
  esac
}
in_registered() {
  local p="$1" entry wt
  has_dot_segments "$p" && return 1
  for entry in "$REG_DIR"/*; do
    wt=$(cat "$entry" 2>/dev/null || echo "")
    [ -n "$wt" ] || continue
    case "$p" in "$wt"|"$wt"/*) return 0 ;; esac
  done
  return 1
}
registered_list() { for e in "$REG_DIR"/*; do printf '  %s\n' "$(cat "$e" 2>/dev/null)"; done; }
# check_repo_target <raw-target>: resolve one candidate repository directory (relative → against
# cwd), store the absolute path in RESOLVED, and classify it. Returns 0 = VIOLATION (outside every
# registered worktree and not allowlisted), 1 = OK, 2 = UNRESOLVABLE (empty cwd + empty target →
# fail closed). Used per tagged git-dir/work-tree/cwd target in the mutating-git branch below.
check_repo_target() {
  local e="$1"
  [ -n "$e" ] || e="$CWD"
  case "$e" in
    "") RESOLVED=""; return 2 ;;
    /*) ;;
    *)  e=$( (cd "$CWD" 2>/dev/null && cd "$e" 2>/dev/null && pwd) || printf '%s/%s' "$CWD" "$e") ;;
  esac
  RESOLVED="$e"
  allowlisted "$e" || in_registered "$e" || return 0
  return 1
}
ESCAPES="Escapes: SKIP_WORKTREE_CONTRACT=1 (one command) or scripts/declare-worktree.sh --remove/--clear (assignment ended)."

# ============ A) CONTRACT branch ============
MUTATING_GIT_VERBS='commit|mv|rm|restore|checkout|switch|pull|revert|stash|reset|rebase|merge|cherry-pick|apply|am|clean'
# Anchored at segment start — applied to EACH quote-aware segment, this is the PRECISE
# mutating-git decision. The top-level gate below is only a cheap permissive `*git*`
# pre-filter (over-firing is harmless: a non-git segment can't match `^…git…verb`). A
# whole-command MUTATING_GIT_RE used to gate, but its separator boundary
# `(^|&&|\|\||;)` omitted single `|`/`&`, so `… | git commit` never fired it (a
# boundary false-negative). Making the gate permissive removes that whole bug class.
# The global-options group allows any number of -C/-c, --git-dir/--work-tree (glued OR
# separate), and a generic single-token `-…` no-arg global (--no-pager/-p/…), in ANY order.
# It only needs to REACH the verb so the segment enters the loop; git_c_target does the real
# repo resolution. Modeling only `-C`/`-c` used to let three false-negatives slip: a chained
# `-C` failed the regex (single-`?`), an unmodeled global before the -C stopped it reaching the
# verb, and --git-dir/--work-tree redirects were never recognized. This grammar is a STRICT
# SUPERSET of the old one (it only adds matches), so the REGEX can only ADD DENYs. The caller
# validating TWO independent targets (git-dir + work-tree) is likewise a superset of the old single
# cwd/-C check, so the whole change is strictly-tightening: an old-vs-new differential over the whole
# hook (630+ cases) finds ZERO DENY→ALLOW transitions — every transition is ALLOW→DENY.
#
# This definition is the FALLBACK as of 2026-09-13. It models globals only, so a redirect
# between `git` and its verb defeats it; the contract branch below REDEFINES this from
# lib/cmd-detect.sh's shared grammar when that lib is sourceable, and explains both the
# closed and the still-open positions there. What survives here is what a broken install
# gets — never `exit 0`, which on this deny gate would be a silent ALLOW.
MUTATING_GIT_SEG_RE="^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]+[[:space:]]+)*git([[:space:]]+(-C[[:space:]]+[^[:space:]]+|-c[[:space:]]+[^[:space:]]+|--git-dir[[:space:]]+[^[:space:]]+|--work-tree[[:space:]]+[^[:space:]]+|-[^[:space:]]+))*[[:space:]]+(${MUTATING_GIT_VERBS})([[:space:]]|\$)"

# The hook process does not inherit inline assignments from the tool command, so
# a leading SKIP_WORKTREE_CONTRACT=1 in the command string is recognized here as
# the sanctioned one-shot bypass (otherwise the documented escape would be a no-op).
INLINE_BYPASS=""
case "$CMD" in "SKIP_WORKTREE_CONTRACT=1 "*) INLINE_BYPASS=1 ;; esac

if [ -z "${SKIP_WORKTREE_CONTRACT:-}" ] && [ -z "$INLINE_BYPASS" ] && registry_active; then
  # --- mutating git: EVERY mutating segment's effective repo must be a registered
  # worktree (or allowlisted scratch). A cheap permissive `*git*` pre-filter gates the
  # loop (see MUTATING_GIT_SEG_RE above for why permissive), then split_segments splits
  # QUOTE-AWARE on ; | & (unquoted — incl. metachars inside `'…'`, `"…"`, and `$'…'`) so a
  # benign cross-segment -C cannot launder a main-checkout mutation AND a metachar inside a
  # quoted arg cannot fracture a real one. (Shell-wrapped invocations — subshells, eval,
  # xargs, find -exec, `$(…)`, here-docs — remain the accepted best-effort residual; the
  # jq-less fallback's cruder grep catches some.)
  if [[ "$CMD" == *git* ]]; then
    # --- REDIRECT POSITIONS (2026-09-13) ------------------------------------------------
    # The hand-written grammar above models everything between `git` and its verb as GLOBALS.
    # A redirect token starts with a digit, `>`, `<`, `&` or `{`, so it matches none of them
    # and the whole segment fails the regex — taking the `|| continue` below, which means the
    # worktree contract was never checked for that command. THREE spellings defeated it, by
    # TWO different mechanisms — the first two share one, the third does not:
    #
    #   git 2>/dev/null commit -m x   interposed  — defeats the GLOBALS group
    #   git>out commit -m x           glued       — same group; bash splits at the operator,
    #                                               so no space is required for this to run
    #   git commit>log                verb-glued  — defeats the TRAILING BOUNDARY instead
    #
    # (A redirect TRAILING the whole command — `git commit -m x 2>/dev/null` — always matched.)
    #
    # Both are closed by adopting the SHARED grammar rather than re-deriving one here.
    # `_CMD_GIT_GLOBALS` already carries a redirect branch separated by `[[:space:]]*`
    # (zero-or-more — that is precisely what admits the glued spelling; splicing `_CMD_REDIR`
    # into the local group behind its mandatory `[[:space:]]+` was tried and misses every
    # glued row). `_CMD_POS_SUFFIX`'s closer class already admits `<`/`>`, which is what
    # catches the verb-glued position. Re-deriving a redirect grammar in the consumer is this
    # repo's most-repeated defect — reuse the constants, and the STRUCTURE around them.
    #
    # SOURCED HERE, not at file scope, because this is the regex's only use site and it sits
    # behind the registry/bypass gate: a session with no worktree contract pays nothing
    # (measured 3.4ms marginal to source the lib, n=50).
    #
    # FAIL-TO-STATUS-QUO, deliberately NOT fail-closed: if the lib is unsourceable the
    # hand-written regex above stays in force. That is the exact predicate that shipped, so a
    # broken install loses the redirect positions and nothing else. It must never degrade to
    # `exit 0` the way the advisory-path hooks do — for this deny gate that is a silent ALLOW.
    #
    # INHERITED RESIDUALS — both are over-DENIALS (a SEEN verdict only sends the segment to
    # the repo-resolution check, which can deny or pass; it can never produce a wrong ALLOW):
    #   * `_CMD_POS_SUFFIX`'s closer class is `[);&|`{}<>]`. `;` `&` `|` are consumed by
    #     split_segments before the regex runs, so they do not flip; `<` `>` are the fix
    #     working (verified with an argv shim: `git commit>log` really does run `git commit`);
    #     `)` `` ` `` `{` `}` flip on segments that are NOT real invocations. Do not narrow the
    #     class to silence those four — it would delete the deliberate `<`/`>` catch.
    #   * A DIGIT glued to the binary — `git2>out commit` — is SEEN, but bash lexes it as the
    #     word `git2` plus `>out`, so it invokes `git2`, not git (verified with an argv shim).
    #     This is a pre-existing property of `_CMD_GIT_GLOBALS` shared by every consumer on
    #     main, not something this adoption introduces; near-miss binaries generally (`gitk`,
    #     `gitk>out`, `git-foo`, `digit`, `legit`) all stay MISSED.
    #
    # RESIDUAL CLASSES — SIX. Classes 2 and 4 were CLOSED on 2026-09-17 and are kept IN PLACE,
    # marked, rather than deleted and renumbered: test-git-safety.sh cites these numbers, and
    # renumbering silently re-points every citation at the wrong class. The rest are listed
    # together because a residual list naming only one reads as completeness and the omitted one
    # is the live route. Measured after the 2026-09-17 change over an 884-row grid (operator x
    # EVERY insertion slot x 3 arg-taking globals x bash/zsh, argv ground truth from a shim):
    # 803 rows are real main mutations, 689 deny, and every one of the 114 that still ALLOW
    # IN THAT GRID falls inside class 3 or class 5 below.
    # READ THAT SCOPE LITERALLY -- it is a property of the grid, not of the guard. An earlier
    # revision of this sentence said "no surviving bypass lacks a class", which is a claim about
    # ALL inputs, and it was FALSE when written: the grid varies operator x slot x spacing x
    # global x shell and has NO QUOTING/ESCAPING DIMENSION, so a backslash-escaped operator --
    # a whole population of real main mutations, and at the time a live DENY->ALLOW this file
    # had just introduced -- could not appear in any of its 884 rows. The grid answered exactly
    # what it was asked and the sentence asked for more. A count is a property of its corpus;
    # quote it with the corpus, and never let a corpus-derived number carry a universal claim.
    #   1. A redirect BEFORE the `git` token (`2>/dev/null git commit -m x`) is a real
    #      invocation and is still MISSED: the segment anchor never reaches `git` when a
    #      redirect precedes it, and this change only touches the group BETWEEN `git` and the
    #      verb. Pre-existing; `_CMD_POS_PREFIX` upstream models the shape if it is ever fixed.
    #   2. CLOSED 2026-09-17 — a redirect operator containing `&` or `|` (`2>&1`, `&>`, `>&`,
    #      `>|`) in an INTERPOSED position. split_segments used to flush on those characters
    #      unconditionally, so `git 2>&1 commit -m x` arrived as `git 2>` + `1 commit -m x` and
    #      neither half matched. Its state-0 flush now recognises an `&`/`|` ADJACENT to `<`/`>`
    #      as part of a redirect operator, deriving the adjacency from the `&?[<>]+&?[|!]?`
    #      shape _CMD_REDIR already spells rather than from a second local grammar.
    #      THE DANGEROUS DIRECTION, and why this is safe: narrowing where a splitter flushes is
    #      the FALSE-ALLOW direction, because MUTATING_GIT_SEG_RE is `^`-anchored PER SEGMENT, so
    #      a genuine separator that stops flushing makes the command after it non-segment-initial
    #      and therefore INVISIBLE. The adjacency test reads the last character appended in
    #      state 0 UNQUOTED and UNESCAPED, not buf[i-1]: `echo \>& git -C <main> commit` has a
    #      LITERAL `>`, so its `&` really is a separator, and a naive lookbehind would have
    #      swallowed it. Verified by a segment-count differential over a constructed corpus
    #      carrying genuine separators: 16 rows change segment count (all un-fracturing) and
    #      ZERO rows lose a segment-initial `git`. The old KNOWN-WRONG rows are now assert_deny.
    #      Historical note worth keeping: **the gap was POSITIONAL, not per-family** — an earlier
    #      revision of this note said these families "never reach this regex at all", which this
    #      file's OWN test suite already falsified (`git checkout>&2 -b foo` was an assert_deny
    #      here), and `git commit2>&1` stays allowed CORRECTLY because it lexes as verb `commit2`.
    #
    #   3. Two shapes the MATCHER now sees but the TOKENIZER still mis-resolves, so the
    #      effective repo falls back to cwd and a real `-C <main>` mutation is missed from a
    #      worktree cwd (both fail toward DENY from a main cwd, and main ALLOWs both today, so
    #      these are un-closed gaps rather than regressions — pinned as KNOWN-WRONG rows):
    #        * a redirect whose TARGET is quoted (`git 2>"/dev/null" -C <main> commit`) — the
    #          skip arm in git_c_target is gated on `!tnt` and quoting taints the whole word;
    #        * a redirect GLUED to the binary (`git>out -C <main> commit`) — phase 0 matches
    #          the binary as the exact word `git`, so the walker never enters phase 1.
    #   4. CLOSED 2026-09-17 — a redirect occupying an arg-taking global VALUE SLOT
    #      (`git -C >out <main> commit`, `git --work-tree >out <main> reset --hard`). BOTH
    #      layers missed it, for DIFFERENT reasons, so it needed two edits in two files:
    #        MATCHER   _CMD_GIT_ARGVAL (lib/cmd-detect.sh) now spells the separate-arg value slot
    #                  as `(redirect)*[[:space:]]+[^[:space:]<>]+`. The old `[^[:space:]]+` ATE
    #                  `>out` as the -C value and left a bare path token nothing absorbs, so the
    #                  whole segment failed to match.
    #        TOKENIZER the redirect and brace classes now precede the `pend` arms in git_c_target,
    #                  so an operator in a value slot is skipped instead of folded as a RELATIVE
    #                  value that resolves under cwd.
    #      The BRACE-FD spelling (`git -C {fd} >o <main> commit`) is closed by the SAME move, not
    #      by a second special case. Each layer is pinned separately in test-git-safety.sh
    #      (assert_matcher / assert_walker), because a green end-to-end row cannot say which of
    #      the two regressed.
    #      WHAT THIS CLASS NO LONGER COVERS, stated because retiring a class silently is how a
    #      live route ends up with no residual naming it: the value slot STILL allows the
    #      PARAMETER-EXPANSION fd spelling (`git -C ${n}>o <main> commit`). Those rows are not
    #      orphaned — they belong to class 5, which is explicitly slot-INDEPENDENT below. On the
    #      884-row grid every surviving value-slot ALLOW is a class-5 spelling and nothing else.
    #      A deliberate over-denial came with this: `{9}` in the value slot is an fd redirect in
    #      zsh but a literal word in bash (whose `{varname}>` needs a valid identifier), so bash
    #      would pass `{9}` as the -C value and git would error without mutating. The guard
    #      cannot know the shell and takes the dangerous reading — 3 rows, pinned as a choice.
    #      CLOSED VIA THE LIB ARM ONLY, which is a condition and not a footnote: the matcher half
    #      lives in `_CMD_GIT_ARGVAL` in lib/cmd-detect.sh, and the hand-written fallback above
    #      still spells the separate-arg globals `-C[[:space:]]+[^[:space:]]+`. On an UNSOURCEABLE
    #      lib this class REOPENS. That is the file-wide fail-to-status-quo contract working as
    #      designed — the fallback is deliberately not touched, because re-deriving a redirect
    #      grammar in the consumer is this repo's most-repeated defect — but a residual list whose
    #      whole purpose is completeness has to say so rather than read as unconditional. The
    #      TOKENIZER half has no such condition: it is in this file and always in force.
    #
    #   5. A parameter expansion in the fd slot (`git ${nope}>o -C <main> commit`, and the
    #      unbraced `git $nope>o ...`). A MATCHER miss, not a tokenizer one: _CMD_REDIR spells
    #      the fd prefix as `([0-9]*|[{]...[}][[:space:]]*)`, which admits neither spelling, so
    #      the segment never matches and the tokenizer is never consulted. Both produce a real
    #      main-mutating argv under bash 5.3.15 AND zsh 5.9, so unlike class 4 this one does not
    #      depend on zsh-only lexing. main ALLOWs both identically -- an un-closed gap, not a
    #      regression.
    #      SLOT-INDEPENDENT, widened 2026-09-17 and the reason it matters: because the miss is in
    #      the MATCHER, the whole segment fails to match WHEREVER the operator sits, so this class
    #      covers the interposed position, the arg-taking global VALUE SLOT that class 4 otherwise
    #      closed, the pre-verb slot and the post-verb slot alike. Measured on the 884-row grid:
    #      72 of the 114 surviving ALLOWs are this class (the other 42 are class 3), spread over
    #      12 operator x slot x spacing cells. Class 4 was retired in the same change, and had
    #      this widening not landed with it those value-slot rows would have been left live with
    #      NO residual naming them -- which is the exact failure the filing todo was written about.
    #      NOT FIXED HERE ON PURPOSE: the fix is to widen `_CMD_REDIR` itself, which is consumed by
    #      guard-outward-cli.sh (`_OUT_SEP`, `_OUT_POS_PREFIX`, `_OUT_GH_GLOBALS_GRANT`),
    #      merge-review-guard.sh (`MRG_SEP`) and two more constants in lib/cmd-detect.sh. That
    #      makes it a cross-guard change whose corpus pins must be re-derived, and it is tracked
    #      separately rather than smuggled into a git-safety-only PR. Still pinned in
    #      test-git-safety.sh as KNOWN-WRONG rows. Folded into
    #      todos/archive/P1-2026-09-16-redirect-in-arg-taking-global-value-slot-defeats-both-git-safety-layers.md
    #
    #   6. A bare brace DECOY word ahead of a second brace-fd redirect
    #      (`git {fd} {9}>o -C <main> commit`). This one fails at the COARSE PRE-FILTER, before
    #      git_c_target is invoked at all: the segment matches no arm of MUTATING_GIT_SEG_RE and
    #      takes its `|| continue`. Handed the same string directly, the tokenizer resolves it
    #      CORRECTLY (`c <main>`) -- the resolution is right and simply never runs.
    #      NOT a live bypass, and the reason matters: real git stops global-option scanning at
    #      the first non-dash argument, so the undigested leading brace word becomes the
    #      subcommand and git errors out with no mutation. The safety of this row therefore
    #      rests on GIT CLI GRAMMAR, not on anything this guard enforces -- an unenforced
    #      cross-consumer assumption, written down here because it stops holding the moment the
    #      pre-filter widens enough to match the segment without the tokenizer being reached.
    #      Six variants were tried against it (double-brace glued and spaced, quoted-brace glued
    #      to a redirect, brace before --work-tree with and without a redirect, and the
    #      predir x pendbrace combinations); none produced a real mutation.
    #
    # So: three spellings closed across two mechanisms; the redirect bypass is NARROWED, not
    # eliminated. Measured through the real two-stage pipeline (split_segments then the regex),
    # a 1344-row product-of-dimensions corpus goes from 24 SEEN to 912, with 0 regressions.
    # Measuring the regex ALONE reports 0 -> 1200 and is the wrong layer for that claim.
    # SOURCED IN A SUBSHELL, and the result SELF-TESTED, because "the lib returned non-zero"
    # is only one of four ways this can go wrong and it is not the dangerous one. Measured,
    # each against a stub lib, with a healthy lib and an absent lib as the two controls:
    #   (a) a top-level unset-var reference is FATAL under this file's `set -uo pipefail`
    #       EVEN INSIDE AN `if` CONDITION — the hook died at rc=127 having printed ZERO
    #       bytes, losing the contract, write-shape AND advisor branches at once. A stray
    #       top-level `exit 0` does the same. For a deny gate that is a total silent ALLOW,
    #       and NO in-band guard placed after the source can catch it: the shell is gone.
    #       A subshell confines it — the capture is then empty and the fallback stands.
    #   (b) a malformed constant (`((`) passes any -n test, and `grep -E` then rejects the
    #       COMPOSED pattern at rc=2, which the `|| continue` below swallows for every
    #       segment: also a total ALLOW.
    #   (c) a well-formed constant with DIFFERENT SEMANTICS matches nothing: same outcome.
    # (b) and (c) are what the self-test catches; (a) is what the subshell catches. The
    # composition goes to a TEMP var so the shipped fallback is still intact to fall back to.
    # Stdout of the source is discarded inside the brace group (the lib is silent today —
    # measured, not assumed — but anything it ever printed would land ahead of deny()'s JSON
    # and a strict envelope parser would read the malformed result as an allow).
    case "${BASH_SOURCE[0]}" in */*) HERE="${BASH_SOURCE[0]%/*}" ;; *) HERE=. ;; esac
    _LIB_PAIR=$( { . "$HERE/lib/cmd-detect.sh" >/dev/null 2>&1; } \
                 && printf '%s\t%s' "${_CMD_GIT_GLOBALS:-}" "${_CMD_POS_SUFFIX:-}" )
    if [ -n "${_LIB_PAIR:-}" ] && [ "${_LIB_PAIR#*	}" != "$_LIB_PAIR" ]; then
      _LIB_G=${_LIB_PAIR%%	*}
      _LIB_S=${_LIB_PAIR#*	}
      if [ -n "$_LIB_G" ] && [ -n "$_LIB_S" ]; then
        _CAND="^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]+[[:space:]]+)*git${_LIB_G}[[:space:]]+(${MUTATING_GIT_VERBS})${_LIB_S}"
        # Positive self-test: the candidate must still match a canonical mutating invocation
        # AND must still reject a non-invocation. Both directions, or a pattern that matches
        # everything would pass as readily as a correct one.
        if printf '%s' 'git commit -m x' | grep -qE "$_CAND" 2>/dev/null \
           && ! printf '%s' 'echo hello' | grep -qE "$_CAND" 2>/dev/null; then
          # UNION IN, NEVER SUBSTITUTE. The self-test above proves the candidate is neither
          # empty nor absurdly wide; it CANNOT prove it is not NARROWER than the shipped
          # fallback, and a wholesale replace would then SUBTRACT denials. Measured: a lib
          # whose `_CMD_POS_SUFFIX` drops the end-of-line anchor turns a bare `git commit` at
          # main from DENY into ALLOW, and one whose `_CMD_GIT_GLOBALS` drops the `-C` arm
          # turns `git -C <main> commit -m x` from a worktree cwd into ALLOW — the incident
          # class this hook exists for. Alternating with the fallback makes adoption monotone:
          # the lib can only ever ADD matches, so no lib defect can subtract a denial.
          MUTATING_GIT_SEG_RE="(${MUTATING_GIT_SEG_RE})|(${_CAND})"
        fi
      fi
    fi
    VIOLATION=""; UNRESOLVABLE=""
    SEGS=$(printf '%s' "$CMD" | split_segments)
    while IFS= read -r seg; do
      printf '%s' "$seg" | grep -qE "$MUTATING_GIT_SEG_RE" || continue
      # git_c_target (defined above) emits the redirect COMPONENTS of this segment, quote-AWARE:
      #   g <path> = --git-dir/GIT_DIR   c <path> = the cumulative -C fold   w <path> = --work-tree/GIT_WORK_TREE
      # git resolves the git-dir and the work-tree INDEPENDENTLY, so we reconstruct BOTH and validate
      # each: git-dir (refs) = g else c else cwd; work-tree (files) = w else c else cwd. A --git-dir
      # that points at a safe worktree does NOT move the work-tree — `git --git-dir=<wt>/.git reset
      # --hard` from cwd=main still destroys MAIN files — so checking only the git-dir would be a
      # bypass. We check both for EVERY mutating verb (conservative: `commit` alone does not write the
      # work-tree, so `--git-dir=<wt> commit` from a main cwd is over-DENYed — a rare pattern, fails safe).
      GITDIR=""; CDIR=""; WORKTREE=""; HAVE_GD=0; HAVE_C=0; HAVE_WT=0
      while IFS= read -r line; do
        [ -n "$line" ] || continue
        case "${line%% *}" in
          g) GITDIR="${line#* }";   HAVE_GD=1 ;;
          c) CDIR="${line#* }";     HAVE_C=1 ;;
          w) WORKTREE="${line#* }"; HAVE_WT=1 ;;
        esac
      done <<INNER
$(printf '%s' "$seg" | git_c_target)
INNER
      # git-dir target: explicit --git-dir/GIT_DIR, else the -C fold, else cwd (empty → helper uses cwd).
      if   [ "$HAVE_GD" = 1 ]; then GD="$GITDIR"
      elif [ "$HAVE_C"  = 1 ]; then GD="$CDIR"
      else GD=""; fi
      # work-tree target: explicit --work-tree/GIT_WORK_TREE, else the -C fold, else cwd.
      if   [ "$HAVE_WT" = 1 ]; then WT="$WORKTREE"
      elif [ "$HAVE_C"  = 1 ]; then WT="$CDIR"
      else WT=""; fi
      for tgt in "$GD" "$WT"; do
        check_repo_target "$tgt"
        case $? in
          0) VIOLATION="$RESOLVED"; break ;;
          2) UNRESOLVABLE=1; break ;;
        esac
        [ "$WT" = "$GD" ] && break   # git-dir and work-tree identical (no redirect / plain -C) → 2nd check redundant
      done
      [ -n "$VIOLATION$UNRESOLVABLE" ] && break
    done <<EOF
$SEGS
EOF
    if [ -n "$UNRESOLVABLE" ]; then
      deny "Worktree contract violation: a mutating git command has no resolvable repository (empty cwd and no redirect) while worktree assignment(s) are active:
$(registered_list)
${ESCAPES}"
    fi
    if [ -n "$VIOLATION" ]; then
      deny "Worktree contract violation: a mutating git command would run against
  ${VIOLATION}
which is outside every registered worktree:
$(registered_list)
Run it inside the assigned worktree (or with git -C <worktree>). ${ESCAPES}"
    fi
  fi

  # --- write-shaped shell commands: absolute targets under the MAIN checkout ---
  # Cheap grep FIRST — the git rev-parse below must not run for every ls/echo/npm
  # command while a registry is active (~140ms/hook budget).
  if printf '%s' "$CMD" | grep -qE '>>?|(^|[[:space:]|;&])(tee|rm|cp|mv)[[:space:]]|sed[[:space:]][^|;]*-i'; then
  MAIN_ROOT=""
  COMMON=$(git -C "${CWD:-/nonexistent}" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || echo "")
  [ -n "$COMMON" ] && MAIN_ROOT=$(dirname "$COMMON")
  if [ -n "$MAIN_ROOT" ]; then
    # Quote-AWARE target extraction (emit_write_targets, defined above). The prior
    # `tr -d '\042\047'` strip DELETED quote chars but kept their CONTENT, so a commit
    # message like `git commit -m "writes > /main/out"` was mined as a real redirect →
    # false-DENY (2026-07-18 audit follow-up). A write is real only when its OPERATOR or
    # COMMAND word is UNQUOTED; the target PATH may still be quoted (the agent-default
    # style the old strip existed for). See
    # docs/solutions/logic-errors/quote-strip-escape-glue-hides-real-command-2026-07-18.md.
    WRITE_TARGETS=$(printf '%s' "$CMD" | emit_write_targets | sort -u)
    while IFS= read -r t; do
      [ -n "$t" ] || continue
      # Judge dot-segment targets by where they LAND: an allowlist-prefixed
      # /tmp/../<main>/x lexically dodges the $MAIN_ROOT/* check below while
      # resolving into the main checkout.
      TC="$t"
      case "${t}/" in */../*|*/./*) TC=$(lex_collapse "$t") ;; esac
      # No allowlist here (Global Constraints scope it to the file-tool guard +
      # mutating-git branch): a target outside MAIN_ROOT is never denied anyway,
      # and a write INTO the main checkout is the incident class even when the
      # checkout lives under a temp prefix (as in the self-test fixture).
      in_registered "$TC" && continue
      case "$TC" in
        "$MAIN_ROOT"/*)
          deny "Worktree contract violation: a write-shaped command targets
  ${t}
under the main checkout while worktree assignment(s) are active:
$(registered_list)
${ESCAPES}" ;;
      esac
    done <<EOF
$WRITE_TARGETS
EOF
  fi
  fi
fi

# ============ B) ADVISOR branch (never blocks) ============
# `gh pr close` detection reads the shared, quote-AWARE command detector
# (lib/cmd-detect.sh) instead of a hand-written raw-$CMD needle, so it inherits
# the root-position globals slot (`gh -R <repo> pr close 42` and friends, all
# four spellings) and cmd_bare's quote-aware rendering (a `gh pr close` MENTION
# sitting inside a quoted commit message no longer false-fires; one hidden
# inside a LIVE "$(...)" substitution now correctly does). Scoped to THIS
# branch only, never sourced unconditionally at file scope: branch A (the
# CONTRACT deny gate, above) has its own independent inline scanners and must
# keep denying even when this lib cannot be sourced — an advisory hook may
# fail silent, the main-checkout deny gate must not (see test-git-safety.sh's
# "lib-missing" pair). Cheap `*gh*`+`*close*` pre-guard first — a deliberate
# PERFORMANCE trade, and the necessary-substring argument that used to justify
# it is UNSOUND. The premise was "cmd_bare only BLANKS characters, never inserts
# them, so both substrings must be literally present". cmd_bare is blanking-only,
# but the consumer is cmd_bare_deep, which routes through
# cmd_extract_substitutions — and that DELETES a nested substitution, leaving a
# zero-width hole. Deletion can SYNTHESISE a substring the raw text never had.
# Measured under bash 5.3.15, control in the same run:
#   gh pr close 42                       raw has both   lib=close   advisory=warn
#   echo "$(gh pr clo$(echo)se 42)"      no "close"     lib=close   advisory=SILENT
#   echo "$(g$(echo)h pr close 42)"      no "gh"        lib=close   advisory=SILENT
# Both really execute `gh pr close 42`. So this pre-guard SUPPRESSES shapes the
# library resolves. Kept anyway: this hook is advisory, both shapes DENY at
# guard-outward-cli.sh, and the cost is a missed warning against a stated
# ~140ms/hook budget on every Bash call. Pinned as a row below so the cost is
# visible on every run rather than rediscovered. Do NOT restate the substring
# argument as sound — and note pr-verify.sh's pre-guard, cited below as
# precedent, has the same property, which makes it a second instance rather
# than support. (Narrowed
# here from `gh` alone: that single-substring form still sourced the library
# for any command containing "gh" as a substring of an unrelated word —
# highlight, through, weight, right — which this hook sees on every single
# Bash call against a stated ~140ms/hook budget). Fork-free HERE
# (core-bare-guard.sh/drift-detect.sh's own pattern): a $(cd …) subshell would
# be the entire added cost of reaching the library.
_CMD_DETECT_OK=""
if [[ "$CMD" == *gh* && "$CMD" == *close* ]]; then
  case "${BASH_SOURCE[0]}" in */*) HERE="${BASH_SOURCE[0]%/*}" ;; *) HERE=. ;; esac
  if . "$HERE/lib/cmd-detect.sh" 2>/dev/null \
     && declare -F cmd_gh_pr_write_subcommand >/dev/null \
     && declare -F cmd_gh_pr_ref >/dev/null; then
    _CMD_DETECT_OK=1
  fi
fi

KIND=""
REF=""
SKIP_REASON=""
# Wording for the SHARED guidance clauses further down. All five arms below set
# KIND="delete", so KIND cannot say whether the thing being acted on is a branch or a
# PR — these two carry that, and default to the branch-deletion case because four of
# the five arms are branch deletions. The `gh pr close` arm overrides them.
#
# Why this is not cosmetic: the shared block is reached by every arm, so a hardcoded
# noun is wrong for whichever arms it was not written for. Measured before this change,
# `git branch -D https://exfil.example.test/o/r/pull/1` produced "confirm this PR's
# state manually before closing" — no PR is involved in a branch deletion — while the
# three sibling clauses said "branch" and were wrong in the mirror direction for
# `gh pr close`. Fixing only the reported instance would have left its mirror live.
SUBJ="this branch's merge state"
VERB="deleting"
if printf '%s' "$CMD" | grep -qE '(^|[;&|[:space:]])git[[:space:]]+branch[[:space:]]+-[a-zA-Z]*D[a-zA-Z]*[[:space:]]+'; then
  KIND="delete"
  REF=$(printf '%s' "$CMD" | sed -nE 's/.*git[[:space:]]+branch[[:space:]]+-[a-zA-Z]*D[a-zA-Z]*[[:space:]]+([^[:space:];&|]+).*/\1/p')
elif printf '%s' "$CMD" | grep -qE '(^|[;&|[:space:]])git[[:space:]]+branch[[:space:]]+[^;&|]*--delete[^;&|]*--force|(^|[;&|[:space:]])git[[:space:]]+branch[[:space:]]+[^;&|]*--force[^;&|]*--delete'; then
  # Long-form spelling of branch -D.
  KIND="delete"
  REF=$(printf '%s' "$CMD" | tr ' ' '\n' | awk 'f && $0 !~ /^-/ { print; exit } $0 == "branch" { f = 1 }')
elif printf '%s' "$CMD" | grep -qE '(^|[;&|[:space:]])git[[:space:]]+push[[:space:]][^;&|]*--delete[[:space:]]'; then
  KIND="delete"
  REF=$(printf '%s' "$CMD" | sed -nE 's/.*--delete[[:space:]]+([^[:space:];&|]+).*/\1/p')
elif printf '%s' "$CMD" | grep -qE '(^|[;&|[:space:]])git[[:space:]]+push[[:space:]][^;&|]*[[:space:]]:[^[:space:]]'; then
  KIND="delete"
  REF=$(printf '%s' "$CMD" | sed -nE 's/.*[[:space:]]:([^[:space:];&|]+).*/\1/p')
elif [ -n "$_CMD_DETECT_OK" ] && [ "$(cmd_gh_pr_write_subcommand "$CMD")" = "close" ]; then
  # Gate strictly on "close" — cmd_gh_pr_write_subcommand also returns
  # create|merge|edit, and this advisor must not widen to those. It also
  # refuses (empty) when a `gh pr create` mention co-occurs with a
  # merge/close/edit one (its own create-vs-rest guard) — so
  # `gh pr create -t x && gh pr close 42` no longer fires here, where the old
  # raw needle did (see test-git-safety.sh). Safe direction: a missed warning,
  # never a wrong one — this hook is advisory only.
  KIND="delete"
  SUBJ="this PR's state"
  VERB="closing"
  # cmd_gh_pr_ref REFUSES (empty output, rc!=0) on a --repo/-R retarget, more
  # than one gh-pr mention, or an ambiguous flag — that means "cannot name the
  # branch/PR", not "no ref". Route it to the SAME SKIP_REASON path the other
  # extractors below use (see the widened gate at the top of that block),
  # rather than either silently dropping the advisory (REF empty would
  # otherwise fail the `[ -n "$REF" ]` gate) or resolving `gh pr view $REF`
  # against a garbled/retargeted ref, which could report on the WRONG PR.
  # No `|| REF=""` fallback: every documented refusal path in cmd_gh_pr_ref
  # returns 1 with empty stdout (verified by reading its body — no early
  # `return 1` follows a `printf`), so a bare capture already yields REF="" on
  # refusal. Checking `$?` here would also be the one caller that newly
  # depends on cmd-detect.sh's own accepted SIGPIPE residual for this
  # function (documented there as safe only because "no caller ... checks
  # $? today") — not adding that dependency keeps that note accurate.
  REF=$(cmd_gh_pr_ref "$CMD")
  [ -n "$REF" ] || SKIP_REASON="could not resolve the PR ref via the shared extractor (e.g. a --repo/-R retarget, more than one 'gh pr' mention, or an ambiguous flag) — confirm this PR's state manually before closing."
elif printf '%s' "$CMD" | grep -qE '(^|[;&|[:space:]])git[[:space:]]+worktree[[:space:]]+remove[[:space:]][^;&|]*(--force|[[:space:]]-f)'; then
  warn "⚠ git worktree remove --force discards any uncommitted work in that worktree. Confirm the branch is pushed (or its PR merged) before removal. Recovery runbook: docs/solutions/best-practices/restore-and-merge-closed-pr-after-branch-deletion-2026-07-11.md"
fi

if [ "$KIND" = "delete" ] && { [ -n "$REF" ] || [ -n "$SKIP_REASON" ]; }; then
  # Strip one matched pair of surrounding quotes BEFORE the origin/ prefix
  # strip below, so a quoted literal (`git branch -D "todo/foo"`) — or a
  # quoted origin ref — resolves exactly like the unquoted form. Matched-pair
  # removal only (never `tr -d`, which deletes quote chars but keeps their
  # content and glues adjacent tokens — see
  # docs/solutions/logic-errors/quote-strip-escape-glue-hides-real-command-2026-07-18.md).
  case "$REF" in
    \"*\") REF="${REF#\"}"; REF="${REF%\"}" ;;
    \'*\') REF="${REF#\'}"; REF="${REF%\'}" ;;
  esac
  REF="${REF#origin/}"
  # Exactly one of these paths may reach `gh pr view` below — a REF that
  # cannot be resolved to a literal branch name must SKIP the lookup
  # entirely rather than fall through to it. (`warn()` itself calls `exit 0`,
  # so a naive sibling `case` would still emit only one message today — but
  # making the skip explicit here, instead of relying on that side effect,
  # keeps it true if `warn()` ever changes. See
  # docs/solutions/conventions/warn-deny-helper-embedded-exit-defeats-fallthrough-reasoning-2026-07-26.md.)
  # SKIP_REASON may already be set here (the gh-pr-close branch above presets
  # it when cmd_gh_pr_ref refuses) — do not clobber that with the generic
  # empty-ref message below.
  # A ref that is empty AFTER normalization (quote-stripping above, OR the
  # origin/ strip — e.g. `git branch -D ""` or `git push origin --delete
  # origin/`) must not reach `gh pr view`: an empty positional is NOT "no
  # ref" to gh — it resolves to the CURRENT branch's PR, which can print a
  # confident "MERGED — deletion is safe" about a branch that has nothing to
  # do with the one actually being deleted. That is worse than the honest
  # "no PR found" this hook used to (accidentally) produce for a garbled ref.
  [ -n "$SKIP_REASON" ] || [ -n "$REF" ] || SKIP_REASON="the extracted ref is empty after normalization — confirm ${SUBJ} manually before ${VERB}."
  # A flag-like extraction must not reach gh in argument position.
  if [ -z "$SKIP_REASON" ]; then
    case "$REF" in
      -*) SKIP_REASON="extracted ref '${REF}' looks like a flag — verify ${SUBJ} manually before ${VERB}." ;;
    esac
  fi
  if [ -z "$SKIP_REASON" ]; then
    # An unexpanded shell construct ($VAR, `cmd`) survives quote-stripping as
    # a literal token — the ref could not be resolved from the command text.
    # This must NOT assert that no PR exists; it is an honest "unknown."
    # Accepted trade-off: a real branch legitimately named e.g. `feat/a$b`
    # also hits this path and gets "unresolvable" instead of a real PR
    # lookup. That is intentional — a softer warning on a rare valid name
    # beats a confidently wrong one on the common quoted-variable case. Do
    # not "fix" this back to a real lookup for `$`/backtick-containing refs.
    case "$REF" in
      *'$'*|*'`'*) SKIP_REASON="could not resolve a literal branch name from '${REF}' (looks like an unexpanded shell variable or command substitution) — confirm ${SUBJ} manually before ${VERB}." ;;
    esac
  fi
  if [ -z "$SKIP_REASON" ]; then
    # cmd_gh_pr_ref can return a URL, not just a number or branch name (it was
    # renamed from cmd_gh_pr_number for exactly this reason). Restrict a
    # URL-shaped REF to the configured GitHub host before it ever reaches `gh
    # pr view` below — mirrors pr-verify.sh's own GH_ALLOWED_HOST guard,
    # required by cmd_gh_pr_write_subcommand's own header comment ("keep that
    # guard if you reuse this matcher with a ref extractor that can return a
    # URL"). Without this, `gh pr close <attacker-url>` — including one hidden
    # inside a live "$(...)" substitution this port newly surfaces — makes
    # this PreToolUse hook open a real network connection to an
    # attacker-chosen host the instant the command is merely PROPOSED, before
    # any user permission decision and independent of guard-outward-cli.sh
    # (which screens the agent's own tool-call target, not a subprocess this
    # hook spawns internally). Numbers and branch names are untouched: git
    # ref names cannot contain a colon OR two consecutive slashes anywhere
    # (git-check-ref-format; verified: `git check-ref-format --branch
    # '//foo'` and `git check-ref-format 'refs/heads/a//b'` both reject),
    # so only a URL-SHAPED or PROTOCOL-RELATIVE (`//host/path`, no scheme,
    # no colon at all — still a real host reference to `gh`'s own URL
    # handling) REF can match the disqualifying arm below. The `//*` arm was
    # added after review (security-auditor, round 2, CRITICAL): the
    # colon-based check alone let a scheme-less `//host/path` fall through
    # BOTH arms unrestricted — reproduced by construction, no `gh` invoked:
    # `cmd_gh_pr_ref` on a `gh pr close //exfil.example.test/...` mention
    # resolves that exact string with rc=0, and it matched neither the
    # allowed-host prefix nor the original `*://*|*:*` pattern (no colon
    # present at all).
    GH_ALLOWED_HOST="${GH_HOST:-github.com}"
    case "$REF" in
      "https://$GH_ALLOWED_HOST/"*) ;;
      //*|*://*|*:*) SKIP_REASON="extracted ref '${REF}' is a URL outside the configured GitHub host — refusing to look it up (this hook never contacts a host other than https://${GH_ALLOWED_HOST}/) — confirm ${SUBJ} manually before ${VERB}." ;;
    esac
  fi
  if [ -n "$SKIP_REASON" ]; then
    warn "⚠ Fresh PR check skipped: ${SKIP_REASON}"
  elif PR_JSON=$(gh pr view "$REF" --json number,state,mergedAt 2>/dev/null); then
    NUM=$(printf '%s' "$PR_JSON" | jq -r '.number' 2>/dev/null || echo "?")
    STATE=$(printf '%s' "$PR_JSON" | jq -r '.state' 2>/dev/null || echo "")
    MERGED_AT=$(printf '%s' "$PR_JSON" | jq -r '.mergedAt // "-"' 2>/dev/null || echo "-")
    case "$STATE" in
      MERGED) warn "Fresh PR check: PR #${NUM} for '${REF}' is MERGED (${MERGED_AT}) — deletion is safe." ;;
      OPEN)   warn "⚠ Fresh PR check: PR #${NUM} for '${REF}' is OPEN and NOT merged — deleting this branch will CLOSE THE PR UNMERGED (the PR #520 incident). Stop unless you intend to abandon it. Recovery runbook: docs/solutions/best-practices/restore-and-merge-closed-pr-after-branch-deletion-2026-07-11.md" ;;
      CLOSED) warn "⚠ Fresh PR check: PR #${NUM} for '${REF}' is CLOSED WITHOUT MERGE — a rejection signal. Never sweep this branch silently (keep local AND remote; see the land skill's branch-sweep table)." ;;
      *)      warn "⚠ Fresh PR check for '${REF}': PR state unparseable — treat as UNVERIFIED and confirm merge state manually. Rule: docs/solutions/conventions/delete-branch-only-after-confirming-pr-merged-2026-07-06.md" ;;
    esac
  else
    GH_ERR=$(gh pr view "$REF" --json number 2>&1 >/dev/null || true)
    if printf '%s' "$GH_ERR" | grep -qi 'no pull requests found'; then
      warn "⚠ Fresh PR check: NO PR found for '${REF}' — deleting it may lose never-pushed work. Rule: docs/solutions/conventions/delete-branch-only-after-confirming-pr-merged-2026-07-06.md"
    else
      warn "⚠ Fresh PR check for '${REF}' FAILED (gh unavailable/network) — treat as UNVERIFIED and confirm merge state manually before deleting. Rule: docs/solutions/conventions/delete-branch-only-after-confirming-pr-merged-2026-07-06.md"
    fi
  fi
fi

exit 0
