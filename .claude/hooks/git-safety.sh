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
#     (order-dependent); an unmodeled SEPARATE-arg global (`--namespace foo`) mis-reads its arg as
#     the verb and stops early. Both obscure; SKIP_WORKTREE_CONTRACT=1 / the file-tool guard backstop.
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
      return (eff == "" ? t : eff "/" t)             #   (relative + a LATER -C is a documented ordering residual)
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
    function endword(   w, tnt){
      if (!wstart) return
      w = word; tnt = wtaint; word = ""; wstart = 0; wtaint = 0
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
          if (c == BS) { i++; if (i <= n) { ch = substr(buf, i, 1); if (ch != "\n") { word = word ch; wstart = 1 } } }
          else if (c == "$" && i < n && substr(buf, i + 1, 1) == "$") { word = word c substr(buf, i + 1, 1); wstart = 1; i++ }
          else if (c == "$" && i < n && substr(buf, i + 1, 1) == SQ) { i++; st = 3; wstart = 1 }
          else if (c == SQ) { st = 1; wstart = 1 }
          else if (c == DQ) { st = 2; wstart = 1 }
          else if (c == " " || c == "\t" || c == "\n") { endword() }
          else { word = word c; wstart = 1 }
        } else if (st == 1) {
          if (c == SQ) st = 0; else { word = word c; wstart = 1; wtaint = 1 }
        } else if (st == 2) {
          if (c == BS) { i++; if (i <= n) { word = word substr(buf, i, 1); wstart = 1; wtaint = 1 } }
          else if (c == DQ) st = 0
          else { word = word c; wstart = 1; wtaint = 1 }
        } else {
          # st==3 ANSI-C dollar-quote: BS escapes next char (incl. the quote); only an unescaped quote closes
          if (c == BS) { i++; if (i <= n) { word = word substr(buf, i, 1); wstart = 1; wtaint = 1 } }
          else if (c == SQ) st = 0
          else { word = word c; wstart = 1; wtaint = 1 }
        }
      }
      endword()
      # Fail-safe, currently UNREACHABLE: git_c_target only runs on SEG_RE-matched segments,
      # which always contain a verb, so the verb branch sets done=1 first. Kept as defense in
      # depth — if a future SEG_RE relaxation ever admitted a verbless segment, this still emits
      # its redirect target instead of silently falling back to cwd (which could launder a main mutation).
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
      n = length(buf); st = 0
      for (i = 1; i <= n; i++) {
        c = substr(buf, i, 1)
        if (st == 0) {
          if (c == BS) { seg = seg c; i++; if (i <= n) seg = seg substr(buf, i, 1) }
          else if (c == "$" && i < n && substr(buf, i + 1, 1) == "$") { seg = seg c substr(buf, i + 1, 1); i++ }
          else if (c == "$" && i < n && substr(buf, i + 1, 1) == SQ) { seg = seg c substr(buf, i + 1, 1); i++; st = 3 }
          else if (c == SQ) { seg = seg c; st = 1 }
          else if (c == DQ) { seg = seg c; st = 2 }
          else if (c == ";" || c == "|" || c == "&" || c == "\n") { flush() }
          else seg = seg c
        } else if (st == 1) {
          seg = seg c; if (c == SQ) st = 0
        } else if (st == 2) {
          if (c == BS) { seg = seg c; i++; if (i <= n) seg = seg substr(buf, i, 1) }
          else if (c == DQ) { seg = seg c; st = 0 }
          else seg = seg c
        } else {
          # st==3 ANSI-C dollar-quote: BS escapes next (incl. the quote); only an unescaped quote closes
          if (c == BS) { seg = seg c; i++; if (i <= n) seg = seg substr(buf, i, 1) }
          else if (c == SQ) { seg = seg c; st = 0 }
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
KIND=""
REF=""
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
elif printf '%s' "$CMD" | grep -qE '(^|[;&|[:space:]])gh[[:space:]]+pr[[:space:]]+close[[:space:]]+'; then
  KIND="delete"
  REF=$(printf '%s' "$CMD" | sed -nE 's/.*gh[[:space:]]+pr[[:space:]]+close[[:space:]]+([^[:space:];&|]+).*/\1/p')
elif printf '%s' "$CMD" | grep -qE '(^|[;&|[:space:]])git[[:space:]]+worktree[[:space:]]+remove[[:space:]][^;&|]*(--force|[[:space:]]-f)'; then
  warn "⚠ git worktree remove --force discards any uncommitted work in that worktree. Confirm the branch is pushed (or its PR merged) before removal. Recovery runbook: docs/solutions/best-practices/restore-and-merge-closed-pr-after-branch-deletion-2026-07-11.md"
fi

if [ "$KIND" = "delete" ] && [ -n "$REF" ]; then
  REF="${REF#origin/}"
  # A flag-like extraction must not reach gh in argument position.
  case "$REF" in -*)
    warn "⚠ Fresh PR check skipped: extracted ref '${REF}' looks like a flag — verify the branch's PR state manually before deleting." ;;
  esac
  if PR_JSON=$(gh pr view "$REF" --json number,state,mergedAt 2>/dev/null); then
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
