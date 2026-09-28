#!/usr/bin/env bash
# .claude/hooks/lib/write-targets.sh — the quote-aware write-target parser, shared by
# git-safety.sh (contract guard) and scripts/pg-lab/session-coord.sh (record/consult).
# Moved verbatim from git-safety.sh (spec 2026-09-27 §5.2); its residuals move with it.
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
  local rel=0
  [ "${1:-}" = "--relative" ] && rel=1
  awk -v rel="$rel" '
    function addc(ch){ word = word ch; wstart = 1 }
    function addcq(ch){ word = word ch; wstart = 1; wtaint = 1 }
    function seg_reset(){ np = 0; has_rm = 0; has_tee = 0; has_cp = 0; has_mv = 0; has_sed = 0; has_sedi = 0; nrp = 0; cmdseen = 0; sedpend = 0; skipnext = 0; lastrel = 0 }
    function endword(   w, tnt, iscmd){
      if (!wstart) return
      w = word; tnt = wtaint; word = ""; wstart = 0; wtaint = 0
      if (skipword) { skipword = 0; return }
      if (redir)    { redir = 0; if (substr(w, 1, 1) == "/") print w; else if (rel && w != "") relout[++nro] = w; return }
      iscmd = 0
      if (!tnt) {
        if (w == "rm") { has_rm = 1; iscmd = 1 }
        else if (w == "tee") { has_tee = 1; iscmd = 1 }
        else if (w == "cp") { has_cp = 1; iscmd = 1 }
        else if (w == "mv") { has_mv = 1; iscmd = 1 }
        else if (w == "sed") { has_sed = 1; iscmd = 1; sedpend = 1 }
        else if (substr(w, 1, 2) == "-i" || substr(w, 1, 10) == "--in-place") has_sedi = 1
        if (w == "cd" || w == "pushd") saw_cd = 1
      }
      if (substr(w, 1, 1) == "/") { paths[++np] = w; if (rel && has_sed && sedpend && !iscmd) sedpend = 0; lastrel = 0 }
      else if (rel && cmdseen && !iscmd) {
        if (w == "") { }
        else if (skipnext) skipnext = 0
        else if (substr(w, 1, 1) == "-") { if (has_sed && (w == "-e" || w == "-f" || w == "--expression" || w == "--file")) { skipnext = 1; sedpend = 0 } }
        else if (has_sed && sedpend) sedpend = 0
        else { rpaths[++nrp] = w; lastrel = 1 }
      }
      if (iscmd) cmdseen = 1
    }
    function segend(   k){
      endword()
      if (has_rm || has_tee || (has_sed && has_sedi)) { for (k = 1; k <= np; k++) print paths[k]; if (rel) for (k = 1; k <= nrp; k++) relout[++nro] = rpaths[k] }
      else if (has_cp || has_mv) { if (np > 0 && !(rel && lastrel)) print paths[np]; if (rel && lastrel && nrp > 0) relout[++nro] = rpaths[nrp] }
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
          else if (c == ">") { if (rel && wstart && !wtaint && word ~ /^[0-9]+$/) { word = ""; wstart = 0 } else endword(); if (i < n) { nx = substr(buf, i + 1, 1); if (nx == ">" || nx == "|") i++ } redir = 1 }
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
      if (rel && !saw_cd) for (k = 1; k <= nro; k++) print relout[k]
    }
  '
}

# resolve_write_targets <cwd>: stdin command → ABSOLUTE write targets, one per line. Relative
# targets (only reported when the command has no cd/pushd) are joined to cwd, a leading ./
# stripped; with no cwd they are dropped. No other normalization — `..` segments are
# compared as spelled.
resolve_write_targets() {
  local cwd="${1:-}" t
  emit_write_targets --relative | while IFS= read -r t; do
    case "$t" in
      /*) printf '%s\n' "$t" ;;
      *)  [ -n "$cwd" ] || continue; t="${t#./}"; printf '%s/%s\n' "${cwd%/}" "$t" ;;
    esac
  done
}
