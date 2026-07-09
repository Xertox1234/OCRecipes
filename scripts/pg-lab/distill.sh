#!/usr/bin/env bash
# scripts/pg-lab/distill.sh — episodic-distillation EXPERIMENT pipeline (PG Lab Phase D).
# Spec: docs/superpowers/specs/2026-07-09-pg-episodic-distillation-design.md
#
# Modes:
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
DISTILL_MEMORY_DIR="${DISTILL_MEMORY_DIR:-$HOME/.claude/projects/-Users-williamtower-projects-OCRecipes/memory}"
MAX_BUFFER_CHARS=400000

# Distillation prompt (spec: "Distillation prompt + typed output"). Empty array is the
# expected common case — noise control lives HERE, not in post-filtering.
DISTILL_PROMPT=$(cat <<'EOF'
You are distilling a Claude Code session transcript from the OCRecipes project into durable, reusable knowledge. Extract ONLY knowledge a future coding session would benefit from: decisions with their rationale, discovered constraints or gotchas, user preferences and corrections, recurring workflows.

Most sessions contain NO durable knowledge. An empty JSON array [] is the expected common case. Do not manufacture candidates.

Never extract: secrets or credentials, personal or health data, session-specific trivia (file paths under active edit, transient test failures, one-off command output).

Return ONLY a JSON array — no markdown fences, no prose before or after. Each element:
{"target_store":"memory"|"solution","subtype":"...","title":"...","content":"...","evidence_msg_uuids":["..."]}

subtype when target_store=memory: one of user, feedback, project, reference.
subtype when target_store=solution: one of bug:logic-errors, bug:runtime-errors, bug:code-quality, bug:performance-issues, knowledge:conventions, knowledge:design-patterns, knowledge:best-practices.

title: at most 100 characters, specific. content: 3-10 self-contained sentences including the WHY. evidence_msg_uuids: the [#uuid] markers of the transcript lines the knowledge came from.
EOF
)

# Hard safety rail (same as init.sh/codify-neardup.sh/transcripts.sh) — strip query string
# and fragment BEFORE the suffix split (docs/solutions/logic-errors/
# bash-suffix-split-db-name-denylist-query-string-smuggling-2026-07-06.md).
DB_NAME="${LAB_DATABASE_URL##*/}"; DB_NAME="${DB_NAME%%\?*}"; DB_NAME="${DB_NAME%%#*}"
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

insert_candidate() {  # sid, store, subtype, title, content, uuids_csv
  local sid="$1" store="$2" subtype="$3" title="$4" content="$5" uuids="$6" nd=""
  if [ "$store" = "solution" ]; then
    nd=$(sql -tA -v t="$title" <<'SQL'
SELECT path || E'\t' || round(similarity(title, :'t')::numeric, 3)
FROM harness.solution_titles
WHERE similarity(title, :'t') >= 0.45
ORDER BY similarity(title, :'t') DESC LIMIT 1;
SQL
    )
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
    )
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

# Contract: args sid, run_id, artifact; echoes "tokens_in tokens_out n_candidates
# parse_failed(0|1)" on stdout.
send_session() {
  local sid="$1" run_id="$2" artifact="$3" errf="$WORK/send.err" respf="$WORK/resp.txt"
  if ! "$DISTILL_SEND_CMD" --paths "$artifact" --question "$DISTILL_PROMPT" >"$respf" 2>"$errf"; then
    echo "0 0 0 1"; return
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
    echo "$tin $tout 0 1"; return
  fi
  local n=0
  while IFS=$'\t' read -r store subtype title content uuids; do
    [ -n "$store" ] || continue
    insert_candidate "$sid" "$store" "$subtype" "$title" "$(printf '%b' "$content")" "$uuids"
    n=$((n + 1))
  done < "$parsed"
  echo "$tin $tout $n 0"
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
  apply_schema
  check_cost_cap
  build_memory_titles
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
    read -r s_tin s_tout s_cands s_pfail <<<"$(send_session "$sid" "$run_id" "$artifact")"
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

MODE="${1:-}"
case "$MODE" in
  --window)
    [ $# -eq 3 ] || { echo "usage: $0 --window <YYYY-MM-DD> <YYYY-MM-DD>" >&2; exit 1; }
    run_window "$2" "$3"
    ;;
  --review) echo "distill.sh: --review lands in Task 8" >&2; exit 1 ;;
  --report) echo "distill.sh: --report lands in Task 9" >&2; exit 1 ;;
  *) echo "usage: $0 --window <start> <end> | --review | --report [start end]" >&2; exit 1 ;;
esac
