#!/usr/bin/env bash
# scripts/pg-lab/distill.sh — episodic-distillation pipeline (PG Lab Phase D), productionized
# 2026-07-12 per P3-2026-07-10-distill-productionization.md.
# Spec: docs/superpowers/specs/2026-07-09-pg-episodic-distillation-design.md
#
# Modes:
#   --init-schema             Apply schema/memory-candidates.sql explicitly. Run once before
#                              the first --window on a fresh DB; required — --window refuses
#                              to run (require_schema) if the tables are absent.
#   --window <start> <end>   Distill sessions (min ts date in [start,end], not yet in
#                            harness.distilled_sessions) through the health gate to the
#                            external model; candidates -> harness.memory_candidates.
#   --review                 Interactive queue review (reads choices from stdin).
#   --report [start end]     Run stats, spend, four-bucket tallies, codify-only sweep.
#
# Safety model: distill-gate.py is FAIL-CLOSED (non-zero exit or verdict!=sent => gated;
# never sent). The gated artifact's sha256 is re-verified immediately before send (spec:
# gate-to-send buffer identity). Manual script => fails LOUD (set -e), same as transcripts.sh.
#
# psql gotcha (docs/solutions/logic-errors/psql-c-flag-skips-var-substitution-2026-07-05.md):
# :'var' substitution goes through stdin/heredocs, never -c.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAB_DATABASE_URL="${LAB_DATABASE_URL:-postgresql://localhost/ocrecipes_lab}"
DISTILL_SEND_CMD="${DISTILL_SEND_CMD:-ask-kimi}"
DISTILL_COST_CAP_USD="${DISTILL_COST_CAP_USD:-5}"
# Deliberate OVER-estimates of OpenRouter DeepSeek V4 Flash pricing (USD per 1M tokens) so
# the cap trips early, never late. Verify at https://openrouter.ai/models; lower to match,
# never raise above the verified price.
DISTILL_PRICE_IN_PER_MTOK="${DISTILL_PRICE_IN_PER_MTOK:-0.30}"
DISTILL_PRICE_OUT_PER_MTOK="${DISTILL_PRICE_OUT_PER_MTOK:-1.20}"
# Deliberately machine-specific: the experiment compares candidates against THIS project's
# memory corpus (spec: comparison protocol). Override via env elsewhere.
DISTILL_MEMORY_DIR="${DISTILL_MEMORY_DIR:-$HOME/.claude/projects/-Users-williamtower-projects-OCRecipes/memory}"
MAX_BUFFER_CHARS=400000
# Volume control (AC3, P3-2026-07-10-distill-productionization.md): triage evidence showed
# ~9% survival vs canon and near-zero near-dup catch rate on conceptual duplicates — a hard
# structural cap is the backstop the prompt-only approach (below) cannot guarantee alone.
DISTILL_MAX_CANDIDATES_PER_SESSION="${DISTILL_MAX_CANDIDATES_PER_SESSION:-1}"
# Fail loudly on a non-numeric override rather than silently disabling the cap: inside an
# `if` condition, `[ "$n" -ge "$DISTILL_MAX_CANDIDATES_PER_SESSION" ]` on a non-numeric value
# would exit 2 (error), which set -e treats as "false" because it's a tested condition — the
# cap would just never trip, with no error anywhere (found in code review, 2026-07-12).
case "$DISTILL_MAX_CANDIDATES_PER_SESSION" in
  ''|*[!0-9]*)
    echo "distill.sh: DISTILL_MAX_CANDIDATES_PER_SESSION must be a non-negative integer, got '$DISTILL_MAX_CANDIDATES_PER_SESSION'" >&2
    exit 1
    ;;
esac
# Size cap (chars) on the canon-context file built by build_canon_context() — keeps the
# second --paths file bounded regardless of corpus growth.
DISTILL_CANON_CONTEXT_MAX_CHARS="${DISTILL_CANON_CONTEXT_MAX_CHARS:-20000}"

# Distillation prompt (spec: "Distillation prompt + typed output"). Empty array is the
# expected common case — noise control lives HERE, not in post-filtering. A second file
# (canon-context: existing docs/solutions + memory titles/summaries, see build_canon_context)
# is sent alongside the transcript so the model can self-filter already-documented knowledge
# instead of relying solely on post-hoc near-dup title matching.
DISTILL_PROMPT=$(cat <<'EOF'
You are distilling a Claude Code session transcript from the OCRecipes project into durable, reusable knowledge. Extract ONLY knowledge a future coding session would benefit from: decisions with their rationale, discovered constraints or gotchas, user preferences and corrections, recurring workflows.

Most sessions contain NO durable knowledge. An empty JSON array [] is the expected common case. Do not manufacture candidates.

A second file lists titles and summaries of EXISTING documented knowledge (docs/solutions entries and memory files). Check it before extracting anything: if the knowledge is already covered there, even under different wording, do NOT extract it — that is noise, not a new candidate.

If more than one distinct, not-already-covered piece of durable knowledge remains, rank them by how novel, reusable, and load-bearing they are, and return ONLY the single best one. Return at most 1 element in the array — never more, even if several genuinely qualify.

Never extract: secrets or credentials, personal or health data, session-specific trivia (file paths under active edit, transient test failures, one-off command output).

Return ONLY a JSON array — no markdown fences, no prose before or after. Each element:
{"target_store":"memory"|"solution","subtype":"...","title":"...","content":"...","evidence_msg_uuids":["..."]}

subtype when target_store=memory: one of user, feedback, project, reference.
subtype when target_store=solution: one of bug:logic-errors, bug:runtime-errors, bug:code-quality, bug:performance-issues, knowledge:conventions, knowledge:design-patterns, knowledge:best-practices.

title: at most 100 characters, specific. content: 3-10 self-contained sentences including the WHY. evidence_msg_uuids: the [#uuid] markers of the transcript lines the knowledge came from.
EOF
)

# Hard safety rail (same as init.sh/codify-neardup.sh) — strip query string and fragment
# BEFORE the suffix split (docs/solutions/logic-errors/
# bash-suffix-split-db-name-denylist-query-string-smuggling-2026-07-06.md). Order is
# load-bearing: splitting first lets any '/'-bearing query value (?sslrootcert=/path/ca.pem
# is standard libpq) capture the ##*/ match and smuggle a denylisted name past the case.
DB_NAME="${LAB_DATABASE_URL%%\?*}"; DB_NAME="${DB_NAME%%#*}"; DB_NAME="${DB_NAME##*/}"
case "$DB_NAME" in
  nutricam | ocrecipes_solutions)
    echo "distill.sh: refusing — LAB_DATABASE_URL resolves to '$DB_NAME', a real app database, not a PG Lab database" >&2
    exit 1
    ;;
esac

command -v psql >/dev/null 2>&1 || { echo "distill.sh: psql not found on PATH" >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "distill.sh: python3 not found on PATH" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

sql() { psql -X -q -v ON_ERROR_STOP=1 -d "$LAB_DATABASE_URL" "$@"; }

apply_schema() { sql -f "$SCRIPT_DIR/schema/memory-candidates.sql"; }

# AC2 (bookmark durability): --window must never silently proceed on a DB where the schema
# (and therefore harness.distilled_sessions, the at-most-once send bookmark) doesn't exist —
# that would re-select and re-send/re-bill every session in the window with no memory of
# what was already sent. Bare statement (never `if !`-wrapped) — see
# docs/solutions/logic-errors/bash-errexit-suspended-for-whole-function-under-if-not-2026-07-06.md.
require_schema() {
  local ok
  ok=$(sql -tA -c "SELECT to_regclass('harness.distilled_sessions') IS NOT NULL")
  if [ "$ok" != "t" ]; then
    echo "distill.sh: harness schema not found (harness.distilled_sessions is missing) — run '$0 --init-schema' first, then retry" >&2
    exit 1
  fi
}

sha256_of() {
  # shasum on macOS, sha256sum on linux CI
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1; else sha256sum "$1" | cut -d' ' -f1; fi
}

# Assemble one session's dialogue: "[#uuid] role: content" + blank line, cap at
# MAX_BUFFER_CHARS with a tail marker (same spirit as transcripts.sh MAX_CONTENT_CHARS).
# Server-side COPY ... TO STDOUT, not \copy: psql performs NO variable interpolation in
# \copy arguments (the rest of the line is taken literally), so :'sid' only expands in a
# plain SQL statement. TO STDOUT needs no server file access; psql's stdout is the CSV.
assemble_session() {
  local sid="$1" buf="$2" rows="$WORK/rows.csv"
  sql -v sid="$sid" <<'SQL' > "$rows"
COPY (SELECT msg_uuid, role, content FROM harness.transcript_messages WHERE session_id = :'sid' AND role IN ('user','assistant') ORDER BY ts NULLS LAST, msg_uuid) TO STDOUT (FORMAT csv);
SQL
  python3 - "$rows" "$buf" "$MAX_BUFFER_CHARS" <<'PYEOF'
import csv, sys
# Real transcript messages exceed csv's default 128 KiB field limit (found live: a
# >131072-char content field aborted the run at session 74/88, 2026-07-09).
csv.field_size_limit(sys.maxsize)
rows_path, buf_path, cap = sys.argv[1], sys.argv[2], int(sys.argv[3])
out, size = [], 0
with open(rows_path, newline="", encoding="utf-8") as f:
    for msg_uuid, role, content in csv.reader(f):
        chunk = f"[#{msg_uuid}] {role}: {content}\n\n"
        if size + len(chunk) > cap:
            out.append("[...session truncated for distillation...]\n")
            break
        out.append(chunk); size += len(chunk)
with open(buf_path, "w", encoding="utf-8") as f:
    f.write("".join(out))
PYEOF
}

record_session() {  # sid, run_id, outcome
  sql -v sid="$1" -v run_id="$2" -v outcome="$3" <<'SQL'
INSERT INTO harness.distilled_sessions (session_id, run_id, outcome) VALUES (:'sid', :run_id, :'outcome');
SQL
}

# Ad-hoc memory-title extraction (per run, no persisted projection — spec rail): path TAB
# "name — description" from each memory file's frontmatter.
build_memory_titles() {
  local out="$WORK/memory-titles.tsv"
  : > "$out"
  local f name desc
  for f in "$DISTILL_MEMORY_DIR"/*.md; do
    [ -e "$f" ] || continue
    [ "$(basename "$f")" = "MEMORY.md" ] && continue
    name=$(sed -n 's/^name:[[:space:]]*//p' "$f" | head -1)
    desc=$(sed -n 's/^description:[[:space:]]*//p' "$f" | head -1 | tr -d '"' | tr '\t' ' ')
    [ -n "$name$desc" ] && printf '%s\t%s\n' "$f" "${name:+$name — }$desc" >> "$out"
  done
}

# AC3 (volume control — canon-aware dedup): project existing docs/solutions titles/summaries
# (harness.solution_titles) and existing memory-file titles (build_memory_titles output,
# call it first) into one size-capped text file. Sent to the model as a SEPARATE file (see
# send_session) — never merged into the health-gated session artifact, so the gate-to-send
# sha256 identity check (which only ever hashes the artifact) is untouched. Guards the
# solution_titles read with to_regclass so a DB that hasn't run codify-neardup.sh --rebuild
# yet degrades to memory-titles-only instead of erroring (harness.solution_titles is owned
# by a different pg-lab item and may not exist).
build_canon_context() {
  local raw="$WORK/canon-context.raw" out="$WORK/canon-context.txt" has_solutions
  : > "$raw"
  has_solutions=$(sql -tA -c "SELECT to_regclass('harness.solution_titles') IS NOT NULL")
  if [ "$has_solutions" = "t" ]; then
    {
      echo "== Existing docs/solutions (path — title) =="
      # Title-only (summary dropped — more rows fit per char), round-robin across
      # categories (path's first segment) so a plain ORDER BY path + byte-truncate can't
      # zero out the largest categories: at 615 rows across 7 categories, a naive
      # alphabetical cut under the default 20000-char budget included ONLY best-practices
      # and part of code-quality, giving conventions/design-patterns/logic-errors (the 3
      # largest, including "discovered constraints or gotchas" — exactly what the
      # distillation prompt targets) zero representation (found in code review, 2026-07-12).
      # row_number() PARTITION BY category, then ORDER BY rn — every category contributes
      # its rn=1 row before any category's rn=2 row, so truncation degrades breadth (fewer
      # rows per category) instead of coverage (missing categories entirely).
      sql -tA <<'SQL'
WITH ranked AS (
  SELECT path, title,
         row_number() OVER (PARTITION BY split_part(path, '/', 1) ORDER BY path) AS rn
  FROM harness.solution_titles
)
SELECT path || ' — ' || title FROM ranked ORDER BY rn, split_part(path, '/', 1);
SQL
      echo
    } >> "$raw"
  fi
  if [ -s "$WORK/memory-titles.tsv" ]; then
    {
      echo "== Existing memory files (path — name/description) =="
      awk -F'\t' '{print $1 " — " $2}' "$WORK/memory-titles.tsv"
    } >> "$raw"
  fi
  head -c "$DISTILL_CANON_CONTEXT_MAX_CHARS" "$raw" > "$out"
}

insert_candidate() {  # sid, store, subtype, title, content, uuids_csv
  local sid="$1" store="$2" subtype="$3" title="$4" content="$5" uuids="$6" nd=""
  if [ "$store" = "solution" ]; then
    nd=$(sql -tA -v t="$title" <<'SQL'
SELECT path || E'\t' || round(similarity(title, :'t')::numeric, 3)
FROM harness.solution_titles
WHERE similarity(title, :'t') >= 0.45
ORDER BY similarity(title, :'t') DESC LIMIT 1;
SQL
    ) || nd=""  # advisory lookup: degrade to unflagged (loud on stderr), never lose the insert
  elif [ -s "$WORK/memory-titles.tsv" ]; then
    # word_similarity, NOT similarity(): a short candidate title against a long
    # name+description whole-string under-scores (~0.2 for an exact contained phrase) —
    # the same short-query-vs-long-text lesson behind transcripts.sh --fuzzy.
    nd=$(sql -tA -v t="$title" <<SQL
CREATE TEMP TABLE mem_titles (path text, title text);
\\copy mem_titles FROM '$WORK/memory-titles.tsv' (FORMAT csv, DELIMITER E'\t')
SELECT path || E'\t' || round(word_similarity(:'t', title)::numeric, 3)
FROM mem_titles
WHERE word_similarity(:'t', title) >= 0.45
ORDER BY word_similarity(:'t', title) DESC LIMIT 1;
SQL
    ) || nd=""  # advisory lookup: degrade to unflagged (loud on stderr), never lose the insert
  fi
  local nd_path="" nd_score=""
  if [ -n "$nd" ]; then nd_path="${nd%%$'\t'*}"; nd_score="${nd##*$'\t'}"; fi
  sql -v sid="$sid" -v store="$store" -v subtype="$subtype" -v title="$title" \
      -v content="$content" -v uuids="$uuids" -v ndp="$nd_path" -v nds="$nd_score" <<'SQL'
INSERT INTO harness.memory_candidates
  (session_id, source_msgs, target_store, subtype, title, content, near_dup_path, near_dup_score)
VALUES (:'sid', CASE WHEN :'uuids' = '' THEN NULL ELSE string_to_array(:'uuids', ',') END,
        :'store', :'subtype', :'title', :'content',
        NULLIF(:'ndp', ''), NULLIF(:'nds', '')::numeric);
SQL
}

# Contract: args sid, run_id, artifact, canon_context_path; writes "tokens_in tokens_out
# n_candidates parse_failed(0|1)" to $WORK/send.result. Result goes via FILE and the caller
# uses a bare call, NOT read <<<"$(send_session ...)": command substitution disables errexit
# inside the function (bash default), which would silently swallow a failed candidate INSERT
# after a paid send. Bare call keeps unguarded failures LOUD; the tolerated ones (send
# failure, parse failure, near-dup lookup) are each explicitly guarded.
#
# canon_context_path is passed to $DISTILL_SEND_CMD as a SECOND path in the SAME --paths
# flag (`--paths "$artifact" "$canon"`), not a second --paths flag: ask-kimi's argparse uses
# `--paths PATHS [PATHS ...]` (nargs="+", default store action), so a repeated --paths flag
# would silently OVERWRITE the first instead of accumulating (verified empirically). One
# flag with two args achieves the intended "two distinct files, not merged into one buffer"
# without that trap.
send_session() {
  local sid="$1" run_id="$2" artifact="$3" canon="${4:-}" errf="$WORK/send.err" respf="$WORK/resp.txt"
  local send_paths=("$artifact")
  if [ -n "$canon" ] && [ -s "$canon" ]; then
    send_paths+=("$canon")
  fi
  if ! "$DISTILL_SEND_CMD" --paths "${send_paths[@]}" --question "$DISTILL_PROMPT" >"$respf" 2>"$errf"; then
    echo "0 0 0 1" > "$WORK/send.result"; return
  fi
  local toks tin tout
  toks=$(sed -n 's/.*\[kimi: \([0-9][0-9]*\) in.*\/ \([0-9][0-9]*\) out.*/\1 \2/p' "$errf" | head -1)
  tin=${toks%% *}; tout=${toks##* }; tin=${tin:-0}; tout=${tout:-0}
  # Parse + validate: emits one TAB-separated line per VALID candidate
  # (store, subtype, title, content-with-\n-escaped, uuids_csv); exit 1 = unparseable.
  local parsed="$WORK/cands.tsv"
  if ! python3 - "$respf" <<'PYEOF' > "$parsed"
import json, re, sys
raw = open(sys.argv[1], encoding="utf-8").read().strip()
raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw)  # tolerate fenced output
arr = json.loads(raw)
if not isinstance(arr, list):
    raise SystemExit(1)
MEM = {"user", "feedback", "project", "reference"}
SOL = {"bug:logic-errors", "bug:runtime-errors", "bug:code-quality", "bug:performance-issues",
       "knowledge:conventions", "knowledge:design-patterns", "knowledge:best-practices"}
for c in arr:
    store, sub = c.get("target_store"), c.get("subtype")
    title, content = (c.get("title") or "").strip(), (c.get("content") or "").strip()
    uuids = c.get("evidence_msg_uuids") or []
    if store == "memory" and sub in MEM: pass
    elif store == "solution" and sub in SOL: pass
    else: continue  # invented subtype/store: reject candidate, keep the session
    if not title or not content: continue
    # Escape backslash FIRST, then newline — the bash side unescapes with printf '%b',
    # which would otherwise mangle literal backslashes in LLM content (code snippets).
    safe = content.replace("\\", "\\\\").replace("\t", " ").replace("\n", "\\n")
    fields = [store, sub, title[:200], safe,
              ",".join(u for u in uuids if isinstance(u, str))]
    print("\t".join(fields))
PYEOF
  then
    echo "$tin $tout 0 1" > "$WORK/send.result"; return
  fi
  local n=0
  while IFS=$'\t' read -r store subtype title content uuids; do
    [ -n "$store" ] || continue
    if [ "$n" -ge "$DISTILL_MAX_CANDIDATES_PER_SESSION" ]; then
      echo "distill.sh: session $sid returned more candidates than the cap ($DISTILL_MAX_CANDIDATES_PER_SESSION) — discarding the rest" >&2
      break
    fi
    insert_candidate "$sid" "$store" "$subtype" "$title" "$(printf '%b' "$content")" "$uuids"
    n=$((n + 1))
  done < "$parsed"
  echo "$tin $tout $n 0" > "$WORK/send.result"
}

check_cost_cap() {
  local spent
  spent=$(sql -tA <<'SQL'
SELECT COALESCE(sum(tokens_in),0) || ' ' || COALESCE(sum(tokens_out),0) FROM harness.distill_runs;
SQL
  )
  awk -v line="$spent" -v pin="$DISTILL_PRICE_IN_PER_MTOK" -v pout="$DISTILL_PRICE_OUT_PER_MTOK" -v cap="$DISTILL_COST_CAP_USD" '
    BEGIN { split(line, t, " "); usd = t[1]/1e6*pin + t[2]/1e6*pout;
            if (usd >= cap) { printf "distill.sh: refusing — cumulative spend $%.4f >= cap $%s\n", usd, cap > "/dev/stderr"; exit 1 }
            printf "spend so far: $%.4f of $%s cap\n", usd, cap }'
}

run_window() {
  local start="$1" end="$2"
  require_schema
  check_cost_cap
  build_memory_titles
  build_canon_context
  local run_id
  run_id=$(sql -tA -v s="$start" -v e="$end" <<'SQL'
INSERT INTO harness.distill_runs (window_start, window_end) VALUES (:'s', :'e') RETURNING id;
SQL
  )
  sql -tA -v s="$start" -v e="$end" <<'SQL' > "$WORK/sessions.txt"
SELECT session_id FROM harness.transcript_messages
WHERE role IN ('user','assistant')
GROUP BY session_id
HAVING min(ts)::date BETWEEN :'s' AND :'e'
   AND session_id NOT IN (SELECT session_id FROM harness.distilled_sessions)
ORDER BY min(ts);
SQL
  local seen=0 sent=0 gated=0 pfail=0 cands=0 tin=0 tout=0
  while IFS= read -r sid; do
    [ -n "$sid" ] || continue
    seen=$((seen + 1))
    local buf="$WORK/buf.txt" artifact="$WORK/artifact.txt" verdict_json verdict
    rm -f "$artifact"
    assemble_session "$sid" "$buf"
    # FAIL-CLOSED contract: non-zero exit OR verdict != sent => gated.
    if ! verdict_json=$(python3 "$SCRIPT_DIR/distill-gate.py" "$buf" "$artifact"); then
      verdict_json='{"verdict":"gated","class":"gate_error"}'
    fi
    verdict=$(printf '%s' "$verdict_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["verdict"])')
    if [ "$verdict" != "sent" ]; then
      gated=$((gated + 1))
      echo "gated: $sid ($(printf '%s' "$verdict_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["class"])'))"
      record_session "$sid" "$run_id" "gated"
      continue
    fi
    # Gate-to-send buffer identity (spec): artifact hash must equal the gate's stamp.
    local want got
    want=$(printf '%s' "$verdict_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["sha256"])')
    got=$(sha256_of "$artifact")
    if [ "$want" != "$got" ]; then
      echo "distill.sh: artifact hash mismatch for $sid — refusing to send" >&2
      gated=$((gated + 1)); record_session "$sid" "$run_id" "gated"; continue
    fi
    send_session "$sid" "$run_id" "$artifact" "$WORK/canon-context.txt"
    read -r s_tin s_tout s_cands s_pfail < "$WORK/send.result"
    tin=$((tin + s_tin)); tout=$((tout + s_tout)); cands=$((cands + s_cands))
    if [ "$s_pfail" -ne 0 ]; then
      pfail=$((pfail + 1)); record_session "$sid" "$run_id" "parse_failed"
    else
      sent=$((sent + 1)); record_session "$sid" "$run_id" "sent"
    fi
  done < "$WORK/sessions.txt"
  sql -v run_id="$run_id" -v seen="$seen" -v sent="$sent" -v gated="$gated" -v pfail="$pfail" -v cands="$cands" -v tin="$tin" -v tout="$tout" <<'SQL'
UPDATE harness.distill_runs
SET sessions_seen=:seen, sessions_sent=:sent, sessions_gated=:gated,
    parse_failures=:pfail, candidates=:cands, tokens_in=:tin, tokens_out=:tout
WHERE id = :run_id;
SQL
  echo "run $run_id: seen=$seen sent=$sent gated=$gated parse_failed=$pfail candidates=$cands"
}

run_review() {
  apply_schema
  sql -tA <<'SQL' > "$WORK/pending.txt"
SELECT id FROM harness.memory_candidates WHERE status = 'pending' ORDER BY id;
SQL
  # AC4 (review UX): a #k of N progress marker so an interrupted session is visible — the
  # silent-early-quit incident of 2026-07-10 (reviewer saw ~18 of 254 candidates with no way
  # to tell from the transcript how far along they were) motivates this. total computed once
  # up front; k increments per candidate shown.
  local total
  total=$(wc -l < "$WORK/pending.txt" | tr -d '[:space:]')
  local cid choice note k=0
  # Candidate ids come in on fd 3 — stdin stays free for the reviewer's choices. Reading
  # both from fd 0 would make `read choice` consume the NEXT candidate id.
  while IFS= read -r cid <&3; do
    [ -n "$cid" ] || continue
    k=$((k + 1))
    sql -v id="$cid" -v k="$k" -v total="$total" <<'SQL'
SELECT E'\n--- candidate #' || id || ' [' || :'k' || ' of ' || :'total' || '] [' || target_store || '/' || subtype || ']'
       || E'\ntitle:   ' || title
       || E'\nnear-dup: ' || COALESCE(near_dup_path || ' (' || near_dup_score || ')', '(none)')
       || E'\nsession: ' || session_id
       || E'\n' || content
FROM harness.memory_candidates WHERE id = :id;
SQL
    # Re-prompt on anything unrecognized — a catch-all quit turned one stray keystroke
    # (blank Enter, trailing space, typo) into a silent end of the whole review (live,
    # 2026-07-10: reviewer saw ~18 of 254 candidates). Only an explicit q or EOF quits.
    while :; do
      printf '[a]ccept / [d]uplicate-reject / [n]oise-reject / [s]kip / [q]uit: '
      IFS= read -r choice || choice=q
      case "$choice" in
        a|d|n|s|q) break ;;
        *) echo "unrecognized input '$choice' — expected a, d, n, s, or q" ;;
      esac
    done
    case "$choice" in
      a|d|n) printf 'note (empty for none): '; IFS= read -r note || note="" ;;
      s) continue ;;
      q) break ;;
    esac
    case "$choice" in
      a) sql -v id="$cid" -v note="$note" <<'SQL'
UPDATE harness.memory_candidates SET status='accepted', reviewer_note=NULLIF(:'note',''), reviewed_at=now() WHERE id=:id;
SQL
         ;;
      d) sql -v id="$cid" -v note="$note" <<'SQL'
UPDATE harness.memory_candidates
SET status='rejected',
    reviewer_note='dup: ' || COALESCE(near_dup_path, '(unflagged)') || CASE WHEN :'note' = '' THEN '' ELSE ' — ' || :'note' END,
    reviewed_at=now()
WHERE id=:id;
SQL
         ;;
      n) sql -v id="$cid" -v note="$note" <<'SQL'
UPDATE harness.memory_candidates SET status='rejected', reviewer_note=NULLIF(:'note',''), reviewed_at=now() WHERE id=:id;
SQL
         ;;
    esac
  done 3< "$WORK/pending.txt"
  echo "review done: $(sql -tA -c 'SELECT count(*) FROM harness.memory_candidates WHERE status = $$pending$$') still pending"
}

run_report() {
  local start="${1:-}" end="${2:-}"
  apply_schema
  # Precondition hints (spec: surface, don't report a silently empty experiment)
  local tm st
  tm=$(sql -tA -c "SELECT COALESCE((SELECT count(*) FROM harness.transcript_messages), 0)" 2>/dev/null || echo 0)
  st=$(sql -tA -c "SELECT COALESCE((SELECT count(*) FROM harness.solution_titles), 0)" 2>/dev/null || echo 0)
  [ "${tm:-0}" -gt 0 ] || echo "PRECONDITION: transcript corpus empty — run scripts/pg-lab/transcripts.sh --import"
  [ "${st:-0}" -gt 0 ] || echo "PRECONDITION: solution_titles empty — run scripts/pg-lab/codify-neardup.sh --rebuild"
  if [ -z "$start" ]; then
    read -r start end <<<"$(sql -tA -c "SELECT COALESCE(min(window_start),CURRENT_DATE)||' '||COALESCE(max(window_end),CURRENT_DATE) FROM harness.distill_runs")"
  fi
  echo "== runs =="
  sql <<'SQL'
SELECT id, ran_at::date AS ran, window_start, window_end, sessions_seen AS seen,
       sessions_sent AS sent, sessions_gated AS gated, parse_failures AS pfail,
       candidates, tokens_in, tokens_out
FROM harness.distill_runs ORDER BY id;
SQL
  local tok_line
  tok_line=$(sql -tA <<'SQL'
SELECT COALESCE(sum(tokens_in),0) || ' ' || COALESCE(sum(tokens_out),0) FROM harness.distill_runs;
SQL
  )
  awk -v line="$tok_line" -v pin="$DISTILL_PRICE_IN_PER_MTOK" -v pout="$DISTILL_PRICE_OUT_PER_MTOK" -v cap="$DISTILL_COST_CAP_USD" \
    'BEGIN { split(line, t, " "); printf "spend: $%.4f of $%s cap (%s in / %s out tokens)\n", t[1]/1e6*pin + t[2]/1e6*pout, cap, t[1], t[2] }'
  echo "== candidates =="
  sql <<'SQL'
SELECT status, count(*) FROM harness.memory_candidates GROUP BY status ORDER BY status;
SQL
  echo "== buckets =="
  sql -tA <<'SQL'
SELECT 'caught-by-both: '  || count(*) FILTER (WHERE status='rejected' AND reviewer_note LIKE 'dup:%')
    || E'\nautomation-only: ' || count(*) FILTER (WHERE status='accepted')
    || E'\nnoise: '            || count(*) FILTER (WHERE status='rejected' AND (reviewer_note IS NULL OR reviewer_note NOT LIKE 'dup:%'))
    || E'\npending: '          || count(*) FILTER (WHERE status='pending')
FROM harness.memory_candidates;
SQL
  # Reverse sweep: window-period solutions never matched by any candidate's near_dup_path.
  # Memory-file half is mtime-based best-effort (spec: baseline asymmetry) — solutions only here.
  echo "== codify-only (window-period solutions with no matching candidate) =="
  echo "note: memory-file baseline omitted — mtime-based best-effort only (spec: baseline asymmetry); sweep is git-exact for docs/solutions"
  local matched="$WORK/matched.txt"
  sql -tA -c "SELECT DISTINCT near_dup_path FROM harness.memory_candidates WHERE near_dup_path IS NOT NULL" > "$matched"
  # Sentinel keeps the pattern file non-empty — grep -f on an empty file is
  # implementation-defined across GNU/BSD.
  echo "__no_matches_sentinel__" >> "$matched"
  git -C "$SCRIPT_DIR/../.." log --since="$start" --until="$end 23:59" --diff-filter=A --name-only --pretty=format: -- docs/solutions \
    | grep -v '^$' | grep -v _manifests | sort -u \
    | grep -vxF -f "$matched" \
    | sed 's/^/codify-only: /' || true
}

MODE="${1:-}"
case "$MODE" in
  --init-schema) apply_schema ;;
  --window)
    [ $# -eq 3 ] || { echo "usage: $0 --window <YYYY-MM-DD> <YYYY-MM-DD>" >&2; exit 1; }
    run_window "$2" "$3"
    ;;
  --review) run_review ;;
  --report)
    shift
    run_report "${1:-}" "${2:-}"
    ;;
  *) echo "usage: $0 --init-schema | --window <start> <end> | --review | --report [start end]" >&2; exit 1 ;;
esac
