# PG Lab Episodic Distillation Experiment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the bounded distillation experiment from `docs/superpowers/specs/2026-07-09-pg-episodic-distillation-design.md` — a batch pipeline that sends health-gated session transcripts to DeepSeek (via `ask-kimi`), lands typed candidate memories in a review queue, and reports the four-bucket verdict against `/codify`.

**Architecture:** One orchestrator shell script (`distill.sh`, modes `--window`/`--review`/`--report`) following `scripts/pg-lab/transcripts.sh` conventions; one standalone Python gate (`distill-gate.py`) — the load-bearing safety control, isolated so it is testable without a DB; one schema file (3 tables); one fixture-driven hook test following `.claude/hooks/test-pg-lab-transcripts.sh`.

**Tech Stack:** bash + psql (Postgres `ocrecipes_lab`, pg_trgm), python3 (stdlib only), `ask-kimi` CLI (external send, stubbed in tests via `DISTILL_SEND_CMD`).

## Global Constraints

- **Execution setup:** work on a branch (`git checkout -b pg-lab/episodic-distillation`) — `main` is PR-only. Use a worktree via superpowers:using-git-worktrees if isolating.
- **Spec is the contract:** `docs/superpowers/specs/2026-07-09-pg-episodic-distillation-design.md`. Any gate loosening (regex, allowlist, thresholds) requires re-running the fixture suite — never loosen ad hoc.
- `LAB_DATABASE_URL` default `postgresql://localhost/ocrecipes_lab`; refuse `nutricam` / `ocrecipes_solutions` **after stripping query string/fragment** (docs/solutions/logic-errors/bash-suffix-split-db-name-denylist-query-string-smuggling-2026-07-06.md).
- psql `:'var'` substitution MUST go through stdin/heredoc, never `-c` (docs/solutions/logic-errors/psql-c-flag-skips-var-substitution-2026-07-05.md).
- Fail LOUD (`set -euo pipefail`) — manual script, not a hook (same rationale as transcripts.sh). Fail CLOSED in the gate: any gate error = session gated.
- Tables are experiment-scoped: created `IF NOT EXISTS`, never dropped by the scripts, dropped by hand when the experiment concludes.
- The send artifact: `0600` perms, in `mktemp -d` under `${TMPDIR:-/tmp}` cleaned by `trap` — and its SHA-256 must match the gate's reported hash immediately before send.
- Cost cap: `DISTILL_COST_CAP_USD` default `5`. Pricing constants are deliberate **over**-estimates (cap trips early, never late): `DISTILL_PRICE_IN_PER_MTOK` default `0.30`, `DISTILL_PRICE_OUT_PER_MTOK` default `1.20` USD. Verify against https://openrouter.ai/models (DeepSeek V4 Flash) at execution and lower if desired — never raise above verified price.
- No new npm scripts. No product-code changes. `shared/schema.ts` is read, never modified.

---

### Task 1: Schema file + test harness bootstrap

**Files:**

- Create: `scripts/pg-lab/schema/memory-candidates.sql`
- Create: `.claude/hooks/test-pg-lab-distill.sh`

**Interfaces:**

- Produces: tables `harness.memory_candidates`, `harness.distill_runs`, `harness.distilled_sessions` (columns exactly as below — every later task depends on these names); test file with helpers `assert_exit0/assert_nonzero/assert_contains/assert_eq`, throwaway DB `$TEST_URL`, fixture dir `$FIX`.

- [ ] **Step 1: Write the failing test (harness + schema assertions)**

Create `.claude/hooks/test-pg-lab-distill.sh` (mode 0755):

```bash
#!/usr/bin/env bash
# Unit test for scripts/pg-lab/distill.sh, distill-gate.py, and schema/memory-candidates.sql.
# Run by CI (Lint · Types · Patterns job) via scripts/run-hook-tests.sh's .claude/hooks/test-*.sh
# glob. That job has NO postgres service, so DB-dependent sections SKIP cleanly when Postgres
# is unreachable (mirrors test-pg-lab-transcripts.sh). The external send is stubbed via the
# DISTILL_SEND_CMD seam — no network, ever.
set -uo pipefail
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$HOOK_DIR/../.." && pwd)"
SCRIPT="$PROJECT_ROOT/scripts/pg-lab/distill.sh"
GATE="$PROJECT_ROOT/scripts/pg-lab/distill-gate.py"
SCHEMA="$PROJECT_ROOT/scripts/pg-lab/schema/memory-candidates.sql"
FAIL=0
assert_exit0()    { if [ "$2" -eq 0 ]; then echo "ok: $1"; else echo "FAIL: $1 — expected exit 0, got $2"; FAIL=1; fi; }
assert_nonzero()  { if [ "$2" -ne 0 ]; then echo "ok: $1"; else echo "FAIL: $1 — expected non-zero exit, got 0"; FAIL=1; fi; }
assert_contains() { if printf '%s' "$2" | grep -qF -- "$3"; then echo "ok: $1"; else echo "FAIL: $1 — missing: $3"; FAIL=1; fi; }
assert_not_contains() { if printf '%s' "$2" | grep -qF -- "$3"; then echo "FAIL: $1 — found forbidden: $3"; FAIL=1; else echo "ok: $1"; fi; }
assert_eq()       { if [ "$2" = "$3" ]; then echo "ok: $1"; else echo "FAIL: $1 — expected $3, got $2"; FAIL=1; fi; }

command -v python3 >/dev/null 2>&1 || { echo "skip: python3 not installed"; exit 0; }

# ---------- DB-dependent sections ----------
command -v psql >/dev/null 2>&1 || { echo "skip: psql not installed"; [ "$FAIL" -eq 0 ] && exit 0 || exit 1; }
psql -X -q -d postgres -c 'SELECT 1' >/dev/null 2>&1 || { echo "skip: no local Postgres reachable"; [ "$FAIL" -eq 0 ] && exit 0 || exit 1; }

TEST_DB="pg_lab_distill_test_$$"
TEST_URL="postgresql://localhost/$TEST_DB"
FIX=""
cleanup() {
  psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$TEST_DB\"" >/dev/null 2>&1
  [ -z "$FIX" ] || rm -rf "$FIX"
}
trap cleanup EXIT
psql -X -q -v ON_ERROR_STOP=1 -d postgres -c "CREATE DATABASE \"$TEST_DB\"" >/dev/null 2>&1
assert_exit0 "creates the throwaway DB" "$?"
FIX="$(mktemp -d)"

# Schema applies idempotently (twice = still exit 0)
psql -X -q -v ON_ERROR_STOP=1 -d "$TEST_URL" -f "$SCHEMA" >/dev/null 2>&1
assert_exit0 "schema applies" "$?"
psql -X -q -v ON_ERROR_STOP=1 -d "$TEST_URL" -f "$SCHEMA" >/dev/null 2>&1
assert_exit0 "schema re-applies (idempotent)" "$?"
TABLES=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT string_agg(tablename, ',' ORDER BY tablename) FROM pg_tables WHERE schemaname='harness'")
assert_contains "memory_candidates exists" "$TABLES" "memory_candidates"
assert_contains "distill_runs exists" "$TABLES" "distill_runs"
assert_contains "distilled_sessions exists" "$TABLES" "distilled_sessions"

[ "$FAIL" -eq 0 ] && { echo "all assertions passed"; exit 0; } || exit 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash .claude/hooks/test-pg-lab-distill.sh`
Expected: FAIL on "schema applies" (file does not exist yet).

- [ ] **Step 3: Write the schema file**

Create `scripts/pg-lab/schema/memory-candidates.sql`:

```sql
-- scripts/pg-lab/schema/memory-candidates.sql
--
-- Schema for the episodic-distillation EXPERIMENT (PG Lab Phase D —
-- P3-2026-07-05-pg-episodic-distillation.md; spec:
-- docs/superpowers/specs/2026-07-09-pg-episodic-distillation-design.md). Owned entirely by
-- this item, per the PG Lab "one schema file per item" rail.
--
-- EXPERIMENT-SCOPED: harness.memory_candidates is a working queue (candidates + review
-- status); harness.distill_runs and harness.distilled_sessions are append-only ledgers.
-- None is a source of truth — the canonical stores remain the markdown memory directory and
-- docs/solutions/. All three tables are dropped by hand when the experiment concludes
-- (keep/kill verdict recorded); nothing else may ever read them.
--
-- Cost accounting lives in distill_runs.tokens_in/tokens_out (converted to USD by distill.sh
-- pricing constants) — NOT in the cheap-worker usage.jsonl ledger, which carries no cost
-- field and no purpose tag (inspected 2026-07-09).
--
-- Idempotent: safe to re-run (IF NOT EXISTS everywhere). CREATE EXTENSION / CREATE SCHEMA
-- repeated defensively (same convention as transcripts.sql / codify-neardup.sql).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE SCHEMA IF NOT EXISTS harness;

CREATE TABLE IF NOT EXISTS harness.distill_runs (
    id             SERIAL PRIMARY KEY,
    ran_at         TIMESTAMPTZ DEFAULT now(),
    window_start   DATE NOT NULL,
    window_end     DATE NOT NULL,
    sessions_seen  INT NOT NULL DEFAULT 0,
    sessions_sent  INT NOT NULL DEFAULT 0,
    sessions_gated INT NOT NULL DEFAULT 0,
    parse_failures INT NOT NULL DEFAULT 0,
    candidates     INT NOT NULL DEFAULT 0,
    tokens_in      BIGINT NOT NULL DEFAULT 0,
    tokens_out     BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS harness.distilled_sessions (
    session_id     TEXT PRIMARY KEY,
    run_id         INT NOT NULL REFERENCES harness.distill_runs(id),
    outcome        TEXT NOT NULL CHECK (outcome IN ('sent','gated','parse_failed'))
);

CREATE TABLE IF NOT EXISTS harness.memory_candidates (
    id             SERIAL PRIMARY KEY,
    created_at     TIMESTAMPTZ DEFAULT now(),
    session_id     TEXT NOT NULL,
    source_msgs    TEXT[],
    target_store   TEXT NOT NULL CHECK (target_store IN ('memory','solution')),
    subtype        TEXT NOT NULL,  -- validated by the distill.sh parser (memory: user|feedback|
                                   -- project|reference; solution: '<track>:<category>')
    title          TEXT NOT NULL,
    content        TEXT NOT NULL,
    near_dup_path  TEXT,
    near_dup_score NUMERIC,
    status         TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','accepted','rejected')),
    reviewer_note  TEXT,
    reviewed_at    TIMESTAMPTZ
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash .claude/hooks/test-pg-lab-distill.sh`
Expected: PASS — "all assertions passed".

- [ ] **Step 5: Commit**

```bash
git add scripts/pg-lab/schema/memory-candidates.sql .claude/hooks/test-pg-lab-distill.sh
git commit -m "feat(pg-lab): schema + test harness for episodic distillation experiment"
```

---

### Task 2: Gate skeleton — fail-closed CLI, redaction, clean pass-through

**Files:**

- Create: `scripts/pg-lab/distill-gate.py`
- Modify: `.claude/hooks/test-pg-lab-distill.sh` (insert gate section BEFORE the `---------- DB-dependent sections ----------` marker — the gate needs no DB)

**Interfaces:**

- Produces: `python3 scripts/pg-lab/distill-gate.py <in-file> <out-file>` → stdout one JSON line.
  - Pass: `{"verdict":"sent","sha256":"<hex>"}`, `<out-file>` written `0600` with the redacted buffer, exit 0.
  - Gated: `{"verdict":"gated","class":"<class>"}`, no out-file, exit 0.
  - Any unexpected error: `{"verdict":"gated","class":"gate_error"}`, exit 3. **Callers treat non-zero exit OR verdict!=sent as gated.**
  - Classes (Tasks 2–4): `gate_error`, `nutrition_fields`, `email`, `dob`, `weight_height_units`, `volume_guard_absolute`, `volume_guard_ratio`.

- [ ] **Step 1: Write the failing tests (gate section, no DB needed)**

Insert into `.claude/hooks/test-pg-lab-distill.sh` immediately before the `# ---------- DB-dependent sections ----------` line:

```bash
# ---------- Gate (no DB required) ----------
GFIX="$(mktemp -d)"
gate_cleanup() { rm -rf "$GFIX"; }
# note: combined with DB cleanup below once FIX exists; for now standalone
json_field() { python3 -c 'import json,sys; print(json.load(sys.stdin).get(sys.argv[1],""))' "$2" <<<"$1"; }

# Clean session passes, artifact written 0600, sha matches
printf '[#u-1] user: Let us discuss the search architecture.\n\n[#a-1] assistant: pg_trgm word_similarity is the right primitive here.\n' > "$GFIX/clean.txt"
OUT=$(python3 "$GATE" "$GFIX/clean.txt" "$GFIX/clean.out"); RC=$?
assert_exit0 "gate: clean session exits 0" "$RC"
assert_eq "gate: clean session verdict sent" "$(json_field "$OUT" verdict)" "sent"
PERMS=$(stat -f '%Lp' "$GFIX/clean.out" 2>/dev/null || stat -c '%a' "$GFIX/clean.out")
assert_eq "gate: artifact is 0600" "$PERMS" "600"
WANT_SHA=$(python3 -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$GFIX/clean.out")
assert_eq "gate: reported sha256 matches artifact" "$(json_field "$OUT" sha256)" "$WANT_SHA"

# Defense-in-depth redaction happens in the artifact
printf '[#u-1] user: my key is sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890 sorry\n' > "$GFIX/secret.txt"
OUT=$(python3 "$GATE" "$GFIX/secret.txt" "$GFIX/secret.out")
assert_eq "gate: secret-only session still sent" "$(json_field "$OUT" verdict)" "sent"
assert_contains "gate: artifact redacted" "$(cat "$GFIX/secret.out")" "[REDACTED]"
assert_not_contains "gate: raw key absent from artifact" "$(cat "$GFIX/secret.out")" "sk-ant-api03"

# Fail-closed: unreadable input → non-zero exit, gated verdict, no artifact
OUT=$(python3 "$GATE" "$GFIX/does-not-exist.txt" "$GFIX/nope.out" 2>/dev/null); RC=$?
assert_nonzero "gate: missing input fails closed (non-zero)" "$RC"
assert_eq "gate: missing input verdict gated" "$(json_field "$OUT" verdict)" "gated"
assert_eq "gate: missing input class gate_error" "$(json_field "$OUT" class)" "gate_error"
[ ! -f "$GFIX/nope.out" ]; assert_exit0 "gate: no artifact on gate_error" "$?"
rm -rf "$GFIX"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash .claude/hooks/test-pg-lab-distill.sh`
Expected: FAIL — `distill-gate.py` does not exist (python3 exits 2).

- [ ] **Step 3: Write the gate skeleton**

Create `scripts/pg-lab/distill-gate.py` (mode 0755):

```python
#!/usr/bin/env python3
"""scripts/pg-lab/distill-gate.py — send-time health-data gate for the episodic-distillation
experiment (spec: docs/superpowers/specs/2026-07-09-pg-episodic-distillation-design.md,
"Health-data send gate"). The LOAD-BEARING control that makes the external-model choice
compatible with CLAUDE.md's absolute cheap-worker health-data exclusion.

Usage: distill-gate.py <in-file> <out-file>
  stdout: one JSON line — {"verdict":"sent","sha256":...} (out-file written 0600, redacted)
          or {"verdict":"gated","class":"<pattern class>"} (no out-file).
  FAIL-CLOSED: any unexpected error prints {"verdict":"gated","class":"gate_error"} and
  exits 3. Callers MUST treat a non-zero exit or any verdict != "sent" as gated.

Drop-not-redact is deliberate (spec): a partial-redaction bug would be a SILENT violation of
an absolute exclusion; dropping converts gate uncertainty into corpus loss, which the
drop-rate kill signal already prices in. Never log matched content — pattern class only.

Any change to the patterns, allowlist, or thresholds below requires re-running
.claude/hooks/test-pg-lab-distill.sh (the spec's anti-loosening rail).
"""
import hashlib
import json
import os
import re
import sys

# Defense-in-depth secret redaction — duplicated from scripts/pg-lab/transcripts.sh
# REDACT_PATTERNS (embedded in a bash heredoc there, so not importable). Keep in sync.
REDACT_PATTERNS = [
    re.compile(r"sk-[A-Za-z0-9_-]{16,}"),
    re.compile(r"sk_live_[A-Za-z0-9]{16,}|rk_live_[A-Za-z0-9]{16,}"),
    re.compile(r"gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}"),
    re.compile(r"xox[baprs]-[A-Za-z0-9-]{10,}"),
    re.compile(r"AIza[0-9A-Za-z_-]{20,}"),
    re.compile(r"AKIA[0-9A-Z]{16}"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----", re.DOTALL),
    re.compile(r"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+"),
    re.compile(r"(?i)(api[_-]?key|secret|token|password)\s*[:=]\s*['\"]?[A-Za-z0-9_\-.]{12,}"),
    re.compile(r"postgres(?:ql)?://[^:\s]+:[^@\s]+@"),
]


def redact(text):
    for pat in REDACT_PATTERNS:
        text = pat.sub("[REDACTED]", text)
    return text


def layer1(text):
    """Pattern screen. Returns a class string, or None to pass. Filled in Task 3."""
    return None


def layer2(text):
    """Volume guard. Returns a class string, or None to pass. Filled in Task 4."""
    return None


def main():
    src, dst = sys.argv[1], sys.argv[2]
    with open(src, encoding="utf-8") as f:  # strict decode: undecodable input -> gate_error
        text = f.read()
    text = redact(text)
    verdict = layer1(text) or layer2(text)
    if verdict:
        print(json.dumps({"verdict": "gated", "class": verdict}))
        return
    fd = os.open(dst, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(text)
    print(json.dumps({"verdict": "sent",
                      "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest()}))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # FAIL-CLOSED: never sent on error; class only, never content or the exception text
        # (an exception message can embed the very content the gate exists to contain).
        print(json.dumps({"verdict": "gated", "class": "gate_error"}))
        sys.exit(3)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash .claude/hooks/test-pg-lab-distill.sh`
Expected: PASS — all gate assertions ok (DB section may skip without Postgres; that's fine).

- [ ] **Step 5: Commit**

```bash
git add scripts/pg-lab/distill-gate.py .claude/hooks/test-pg-lab-distill.sh
git commit -m "feat(pg-lab): distill gate skeleton — fail-closed CLI, redaction, sha-stamped artifact"
```

---

### Task 3: Gate Layer 1 — pattern screen

**Files:**

- Modify: `scripts/pg-lab/distill-gate.py` (replace the `layer1` stub; add constants above it)
- Modify: `.claude/hooks/test-pg-lab-distill.sh` (extend the gate section)

**Interfaces:**

- Consumes: Task 2's skeleton (`layer1` stub, `redact`).
- Produces: `layer1(text)` returning `None` | `'nutrition_fields'` | `'email'` | `'dob'` | `'weight_height_units'`.

- [ ] **Step 1: Write the failing tests**

Append to the gate section of the test (before `rm -rf "$GFIX"`):

```bash
# Layer 1 — JSON-form nutrition record (camelCase, value-bearing) gates
printf '[#u-1] user: debugging, here is the record: {"caloriesPerServing": 320.5, "proteinPerServing": 12}\n' > "$GFIX/json.txt"
OUT=$(python3 "$GATE" "$GFIX/json.txt" "$GFIX/json.out")
assert_eq "gate: JSON nutrition record gated" "$(json_field "$OUT" verdict)" "gated"
assert_eq "gate: JSON class nutrition_fields" "$(json_field "$OUT" class)" "nutrition_fields"

# Layer 1 — psql-table paste (snake_case headers + numeric row): THE channel the three
# container shapes exist for (spec critical finding)
cat > "$GFIX/psql.txt" <<'TBL'
[#u-1] user: query output while debugging:
 serving_size | calories | protein
--------------+----------+---------
 100g         |   235.50 |   11.20
TBL
OUT=$(python3 "$GATE" "$GFIX/psql.txt" "$GFIX/psql.out")
assert_eq "gate: psql table paste gated" "$(json_field "$OUT" verdict)" "gated"
assert_eq "gate: psql table class nutrition_fields" "$(json_field "$OUT" class)" "nutrition_fields"

# Layer 1 — key=value record line gates
printf '[#u-1] user: row was calories=421 protein=18 for that user\n' > "$GFIX/kv.txt"
OUT=$(python3 "$GATE" "$GFIX/kv.txt" "$GFIX/kv.out")
assert_eq "gate: key=value record gated" "$(json_field "$OUT" verdict)" "gated"

# Layer 1 — code DISCUSSION does not gate (field name without a value-bearing container)
printf '[#u-1] user: should calories stay decimal("calories", { precision: 10 }) in schema.ts?\n' > "$GFIX/code.txt"
OUT=$(python3 "$GATE" "$GFIX/code.txt" "$GFIX/code.out")
assert_eq "gate: schema code discussion passes" "$(json_field "$OUT" verdict)" "sent"

# Layer 1 — non-allowlisted email gates; allowlisted set + RFC 2606 pass
printf '[#u-1] user: the affected account is jane.roe1984@gmail.com\n' > "$GFIX/email.txt"
OUT=$(python3 "$GATE" "$GFIX/email.txt" "$GFIX/email.out")
assert_eq "gate: foreign email gated" "$(json_field "$OUT" verdict)" "gated"
assert_eq "gate: email class" "$(json_field "$OUT" class)" "email"
printf '[#u-1] user: mail owner@example.com, bot noreply@anthropic.com, fixture demo@example.com\n' > "$GFIX/email-ok.txt"
OUT=$(python3 "$GATE" "$GFIX/email-ok.txt" "$GFIX/email-ok.out")
assert_eq "gate: allowlisted emails pass" "$(json_field "$OUT" verdict)" "sent"

# Layer 1 — DOB keyword-adjacent date gates; free-floating ISO date passes
printf '[#u-1] user: her dob: 1984-03-11 was in the row\n' > "$GFIX/dob.txt"
OUT=$(python3 "$GATE" "$GFIX/dob.txt" "$GFIX/dob.out")
assert_eq "gate: dob-adjacent date gated" "$(json_field "$OUT" verdict)" "gated"
assert_eq "gate: dob class" "$(json_field "$OUT" class)" "dob"
printf '[#u-1] user: see docs/research/2026-07-04-postgres-memory-for-claude-code.md from 2026-07-04\n' > "$GFIX/date-ok.txt"
OUT=$(python3 "$GATE" "$GFIX/date-ok.txt" "$GFIX/date-ok.out")
assert_eq "gate: free-floating dates pass" "$(json_field "$OUT" verdict)" "sent"

# Layer 1 — prose weight-with-units gates
printf '[#u-1] user: the profile showed 72.5 kg at signup\n' > "$GFIX/wt.txt"
OUT=$(python3 "$GATE" "$GFIX/wt.txt" "$GFIX/wt.out")
assert_eq "gate: weight-with-units gated" "$(json_field "$OUT" verdict)" "gated"
assert_eq "gate: weight class" "$(json_field "$OUT" class)" "weight_height_units"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash .claude/hooks/test-pg-lab-distill.sh`
Expected: FAIL on every new "gated" assertion (stub returns None → verdict sent).

- [ ] **Step 3: Implement Layer 1**

In `distill-gate.py`, add above `layer1` and replace the stub:

```python
# --- Layer 1: nutrition-record field names. SINGLE SOURCE: shared/schema.ts (Drizzle
# definitions carry BOTH casings — camelCase TS property + snake_case SQL column; spec).
# Curated from schema.ts on 2026-07-09; regenerate by grepping its table definitions:
#   grep -nE 'decimal\(|integer\(' shared/schema.ts
# snake_case variants are DERIVED mechanically below — one list, no second list to drift.
NUTRITION_FIELDS_CAMEL = [
    "calories", "protein", "carbs", "fat", "fiber", "sugar", "sodium",
    "servingSize", "servings",
    "caloriesPerServing", "proteinPerServing", "carbsPerServing", "fatPerServing",
    "fiberPerServing", "sugarPerServing",
    "dailyCalorieGoal", "dailyProteinGoal", "dailyCarbsGoal", "dailyFatGoal",
    "goalWeight",
]


def _snake(name):
    return re.sub(r"(?<!^)(?=[A-Z])", "_", name).lower()


FIELD_NAMES = sorted(set(NUTRITION_FIELDS_CAMEL) | {_snake(f) for f in NUTRITION_FIELDS_CAMEL})

# Three VALUE-BEARING container shapes per field (spec): pasted RECORDS carry numeric
# values; code that merely names a column (decimal("calories", ...)) must pass. Shapes:
#   1. JSON key with numeric/quoted value:      "calories": 235.5
#   2. key=value / key: value record line:      calories=421   calories: 421
#   3. psql/markdown table: handled separately (header cell + numeric row nearby).
_FIELD_ALT = "|".join(re.escape(f) for f in FIELD_NAMES)
JSON_SHAPE = re.compile(r'"(?:' + _FIELD_ALT + r')"\s*:\s*["\']?\d')
KV_SHAPE = re.compile(r"\b(?:" + _FIELD_ALT + r")\s*[=:]\s*\d")
TABLE_HEADER = re.compile(r"(?m)^[^|\n]*\b(?:" + _FIELD_ALT + r")\b[^|\n]*\|")
NUMERIC_ROW = re.compile(r"(?m)^[\s|]*[\d.]+[\s\d.|a-zA-Z%]*\|[\s\d.|a-zA-Z%]*$")

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
# Pinned allowlist SET (spec): developer + bot/tooling + RFC 2606 example domains. A single
# -address allowlist would drop most of the corpus (commit trailers, test fixtures).
EMAIL_ALLOWLIST = {
    "owner@example.com",
    "noreply@anthropic.com",
    "noreply@github.com",
}
EMAIL_ALLOW_DOMAINS = {"example.com", "example.org", "example.net", "anthropic.com", "github.com"}

DOB_RE = re.compile(r"(?i)\b(dob|date[_ ]of[_ ]birth|birth[_ ]?date|born)\b\W{0,12}\d{4}-\d{2}-\d{2}")
WEIGHT_HEIGHT_RE = re.compile(
    r"\b\d{2,3}(?:\.\d+)?\s*(?:kg|kgs|lbs?|pounds)\b"
    r"|\b\d{2,3}(?:\.\d+)?\s*cm\b"
    r"|\b\d'\d{1,2}\""
)


def _table_hit(text):
    m = TABLE_HEADER.search(text)
    if not m:
        return False
    # numeric data row within the next 5 lines of the matched header
    tail = text[m.end():].split("\n", 6)[:5]
    return any(NUMERIC_ROW.match(line) for line in tail)


def layer1(text):
    """Pattern screen. Returns a class string, or None to pass.

    Note (spec): the user-ID/UUID and free-date classes are SUBSUMED here — they were
    specified to fire only adjacent to a matched field-name block, and a field-name match
    already gates the session, so they cannot add coverage; DOB is the independent date
    surface. Free-floating UUIDs/ISO dates never gate alone (dev transcripts are full of
    them)."""
    if JSON_SHAPE.search(text) or KV_SHAPE.search(text) or _table_hit(text):
        return "nutrition_fields"
    for email in EMAIL_RE.findall(text):
        addr = email.lower()
        domain = addr.rsplit("@", 1)[1]
        if addr not in EMAIL_ALLOWLIST and domain not in EMAIL_ALLOW_DOMAINS:
            return "email"
    if DOB_RE.search(text):
        return "dob"
    if WEIGHT_HEIGHT_RE.search(text):
        return "weight_height_units"
    return None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash .claude/hooks/test-pg-lab-distill.sh`
Expected: PASS — including "schema code discussion passes" and "free-floating dates pass" (the false-positive containment assertions).

- [ ] **Step 5: Commit**

```bash
git add scripts/pg-lab/distill-gate.py .claude/hooks/test-pg-lab-distill.sh
git commit -m "feat(pg-lab): gate layer 1 — value-bearing nutrition patterns, email allowlist, dob, units"
```

---

### Task 4: Gate Layer 2 — volume guard

**Files:**

- Modify: `scripts/pg-lab/distill-gate.py` (replace the `layer2` stub)
- Modify: `.claude/hooks/test-pg-lab-distill.sh` (extend the gate section)

**Interfaces:**

- Consumes: Task 2's `layer2` stub.
- Produces: `layer2(text)` returning `None` | `'volume_guard_absolute'` | `'volume_guard_ratio'`. Constants `RUN_MIN_CHARS = 500`, `RUN_ABSOLUTE_CHARS = 2000`, `RATIO_MAX = 0.30` (spec defaults — changing them requires the fixture re-run).

- [ ] **Step 1: Write the failing tests**

Append to the gate section (generate fixtures with python so sizes are exact):

```bash
# Layer 2 — one >=2000-char pasted-data run in a LONG session (ratio < 30%) gates: the
# absolute trigger exists because a pure ratio dilutes (spec).
python3 - "$GFIX/abs.txt" <<'PY'
import sys
prose = "".join(f"[#u-{i}] user: ordinary discussion line {i} about architecture.\n\n" for i in range(200))
blob = "\n".join('{"item_%d": %d, "note": "bulk"}' % (i, i) for i in range(80))  # ~2.4k chars, JSON-ish lines
open(sys.argv[1], "w").write(prose + blob + "\n" + prose)
PY
OUT=$(python3 "$GATE" "$GFIX/abs.txt" "$GFIX/abs.out")
assert_eq "gate: absolute-size pasted run gated" "$(json_field "$OUT" verdict)" "gated"
assert_eq "gate: absolute class" "$(json_field "$OUT" class)" "volume_guard_absolute"

# Layer 2 — many mid-size runs pushing ratio > 30% gates
python3 - "$GFIX/ratio.txt" <<'PY'
import sys
prose = "".join(f"[#u-{i}] user: short line {i}.\n" for i in range(20))          # ~400 chars
blob = "\n".join('| row%03d | %d |' % (i, i) for i in range(60))                  # ~1k chars table run
open(sys.argv[1], "w").write(prose + blob + "\n")
PY
OUT=$(python3 "$GATE" "$GFIX/ratio.txt" "$GFIX/ratio.out")
assert_eq "gate: ratio breach gated" "$(json_field "$OUT" verdict)" "gated"
assert_eq "gate: ratio class" "$(json_field "$OUT" class)" "volume_guard_ratio"

# Layer 2 — small pasted snippet (<500-char run) in normal dialogue passes
python3 - "$GFIX/small.txt" <<'PY'
import sys
prose = "".join(f"[#u-{i}] user: ordinary line {i} of discussion.\n\n" for i in range(40))
open(sys.argv[1], "w").write(prose + '| a | 1 |\n| b | 2 |\n' + prose)
PY
OUT=$(python3 "$GATE" "$GFIX/small.txt" "$GFIX/small.out")
assert_eq "gate: small paste passes" "$(json_field "$OUT" verdict)" "sent"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash .claude/hooks/test-pg-lab-distill.sh`
Expected: FAIL on both new "gated" assertions.

- [ ] **Step 3: Implement Layer 2**

Replace the `layer2` stub in `distill-gate.py`:

```python
# --- Layer 2: volume guard (spec defaults — tuning requires the fixture re-run).
RUN_MIN_CHARS = 500        # a contiguous data-shaped run must reach this to count at all
RUN_ABSOLUTE_CHARS = 2000  # any single run this large gates regardless of ratio
RATIO_MAX = 0.30

_BASE64_LINE = re.compile(r"^[A-Za-z0-9+/=]{60,}$")
_TABLE_SEP = re.compile(r"^[-+| ]+$")
_JSONISH = re.compile(r'^\s*[\[{]|"[A-Za-z_]+"\s*:')


def _is_data_line(line):
    s = line.strip()
    if not s:
        return False
    return bool(
        _JSONISH.search(line)
        or _BASE64_LINE.fullmatch(s)
        or line.count("|") >= 2
        or _TABLE_SEP.fullmatch(s)
    )


def layer2(text):
    """Volume guard. Contiguous data-shaped line runs; numerator = chars in runs >=
    RUN_MIN_CHARS, denominator = all chars. Gate on any run >= RUN_ABSOLUTE_CHARS
    (dilution defense) or numerator/denominator > RATIO_MAX."""
    total = len(text) or 1
    numerator = 0
    run = 0
    for line in text.split("\n") + [""]:  # sentinel flushes the final run
        if _is_data_line(line):
            run += len(line) + 1
            continue
        if run >= RUN_ABSOLUTE_CHARS:
            return "volume_guard_absolute"
        if run >= RUN_MIN_CHARS:
            numerator += run
        run = 0
    if numerator / total > RATIO_MAX:
        return "volume_guard_ratio"
    return None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash .claude/hooks/test-pg-lab-distill.sh`
Expected: PASS — all gate assertions including "small paste passes".

- [ ] **Step 5: Commit**

```bash
git add scripts/pg-lab/distill-gate.py .claude/hooks/test-pg-lab-distill.sh
git commit -m "feat(pg-lab): gate layer 2 — volume guard with absolute-run dilution defense"
```

---

### Task 5: distill.sh `--window` core — selection, assembly, gate wiring, ledgers

**Files:**

- Create: `scripts/pg-lab/distill.sh`
- Modify: `.claude/hooks/test-pg-lab-distill.sh` (DB section: fixture transcript rows + stub send + `--window` assertions)

**Interfaces:**

- Consumes: Task 1 tables; gate CLI contract from Task 2.
- Produces: `distill.sh --window <YYYY-MM-DD> <YYYY-MM-DD>`; env seams `LAB_DATABASE_URL`, `DISTILL_SEND_CMD` (default `ask-kimi`), `DISTILL_COST_CAP_USD`, `DISTILL_PRICE_IN_PER_MTOK`, `DISTILL_PRICE_OUT_PER_MTOK`, `DISTILL_MEMORY_DIR` (default `$HOME/.claude/projects/-Users-williamtower-projects-OCRecipes/memory`). Internal functions later tasks extend: `send_session` (Task 6 fills), `run_review`/`run_report` (Tasks 8–9). Session buffer line format: `[#<msg_uuid>] <role>: <content>` + blank line, capped at 400000 chars with tail marker `[...session truncated for distillation...]`.

- [ ] **Step 1: Write the failing tests**

Append to the DB section of the test file (after the schema assertions):

```bash
# --- distill.sh fixtures: transcript rows + a stub send (mimics ask-kimi's contract:
# response JSON on stdout, "[kimi: N in (0 cached) / M out | finish: stop]" on stderr).
psql -X -q -v ON_ERROR_STOP=1 -d "$TEST_URL" -f "$PROJECT_ROOT/scripts/pg-lab/schema/transcripts.sql" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -d "$TEST_URL" >/dev/null <<'SQL'
INSERT INTO harness.transcript_messages (msg_uuid, session_id, project_dir, ts, role, content) VALUES
 ('c-1','clean-session','fx','2026-07-01T10:00:00Z','user','We decided pg_trgm beats embeddings here.'),
 ('c-2','clean-session','fx','2026-07-01T10:00:05Z','assistant','Agreed — keyword search wins the neutral benchmarks.'),
 ('h-1','healthy-session','fx','2026-07-01T11:00:00Z','user','debug row: {"caloriesPerServing": 320.5, "proteinPerServing": 12}'),
 ('o-1','out-of-window','fx','2026-06-01T09:00:00Z','user','Old session outside the window.');
SQL
STUB="$FIX/stub-send.sh"
cat > "$STUB" <<'EOF'
#!/usr/bin/env bash
echo '[{"target_store":"solution","subtype":"knowledge:conventions","title":"Fixture: prefer pg_trgm keyword search over embeddings","content":"Fixture content sentence.","evidence_msg_uuids":["c-1"]}]'
echo '[kimi: 1200 in (0 cached) / 90 out | finish: stop]' >&2
EOF
chmod +x "$STUB"

# Refusal rail (query-string smuggling covered): nutricam refused before any connection
REF=$(LAB_DATABASE_URL="postgresql://localhost/nutricam?sslmode=disable" bash "$SCRIPT" --window 2026-07-01 2026-07-14 2>&1 1>/dev/null); RC=$?
assert_nonzero "distill.sh refuses nutricam (with query string)" "$RC"
assert_contains "refusal names nutricam" "$REF" "nutricam"

WOUT=$(LAB_DATABASE_URL="$TEST_URL" DISTILL_SEND_CMD="$STUB" bash "$SCRIPT" --window 2026-07-01 2026-07-14 2>&1); RC=$?
assert_exit0 "--window runs" "$RC"
SEEN=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT sessions_seen||'/'||sessions_sent||'/'||sessions_gated FROM harness.distill_runs ORDER BY id DESC LIMIT 1")
assert_eq "--window run stats seen/sent/gated" "$SEEN" "2/1/1"
CLEAN_OUTCOME=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT outcome FROM harness.distilled_sessions WHERE session_id='clean-session'")
assert_eq "clean session outcome sent" "$CLEAN_OUTCOME" "sent"
GATED_OUTCOME=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT outcome FROM harness.distilled_sessions WHERE session_id='healthy-session'")
assert_eq "healthy session outcome gated" "$GATED_OUTCOME" "gated"
OOW=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT count(*) FROM harness.distilled_sessions WHERE session_id='out-of-window'")
assert_eq "out-of-window session untouched" "$OOW" "0"

# Idempotency: second run over the same window selects zero sessions
W2=$(LAB_DATABASE_URL="$TEST_URL" DISTILL_SEND_CMD="$STUB" bash "$SCRIPT" --window 2026-07-01 2026-07-14 2>&1)
SEEN2=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT sessions_seen FROM harness.distill_runs ORDER BY id DESC LIMIT 1")
assert_eq "second --window is a no-op (bookmark)" "$SEEN2" "0"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash .claude/hooks/test-pg-lab-distill.sh`
Expected: FAIL — `distill.sh` does not exist.

- [ ] **Step 3: Write distill.sh**

Create `scripts/pg-lab/distill.sh` (mode 0755). Task 6 fills `send_session`'s parse/insert; here it calls the send command and discards the response after counting tokens — the test above passes because stats/outcomes are already real:

```bash
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
# The heredoc is UNQUOTED so '$rows' expands; psql's :'sid' is untouched by bash (single
# quotes are literal inside heredocs — only $, backtick, backslash are special), and
# \\copy collapses to \copy.
assemble_session() {
  local sid="$1" buf="$2" rows="$WORK/rows.csv"
  sql -v sid="$sid" <<SQL
\\copy (SELECT msg_uuid, role, content FROM harness.transcript_messages WHERE session_id = :'sid' AND role IN ('user','assistant') ORDER BY ts NULLS LAST, msg_uuid) TO '$rows' (FORMAT csv)
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

# Filled in Task 6 (send + parse + candidate insert). Contract: args sid, run_id, artifact;
# echoes "tokens_in tokens_out n_candidates parse_failed(0|1)" on stdout.
send_session() {
  local sid="$1" run_id="$2" artifact="$3" errf="$WORK/send.err"
  "$DISTILL_SEND_CMD" --paths "$artifact" --question "distill" >"$WORK/resp.txt" 2>"$errf" || true
  local toks
  toks=$(sed -n 's/.*\[kimi: \([0-9][0-9]*\) in.*\/ \([0-9][0-9]*\) out.*/\1 \2/p' "$errf")
  echo "${toks:-0 0} 0 0"
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
```

Delete the first (placeholder) `assemble_session` definition when writing the real file — it is shown only to flag the `\copy`-to-variable pitfall; the second definition is the real one. The file must contain exactly one `assemble_session`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bash .claude/hooks/test-pg-lab-distill.sh`
Expected: PASS — run stats `2/1/1`, outcomes recorded, second run no-op.

- [ ] **Step 5: Commit**

```bash
git add scripts/pg-lab/distill.sh .claude/hooks/test-pg-lab-distill.sh
git commit -m "feat(pg-lab): distill.sh --window — selection, assembly, gate wiring, run ledgers"
```

---

### Task 6: Send, prompt, response parsing, candidate insert, cost cap

**Files:**

- Modify: `scripts/pg-lab/distill.sh` (replace `send_session`; add `DISTILL_PROMPT`; add `insert_candidate`)
- Modify: `.claude/hooks/test-pg-lab-distill.sh`

**Interfaces:**

- Consumes: Task 5's `send_session` contract (echoes `tokens_in tokens_out n_candidates parse_failed`), `sql` helper, stub-send seam.
- Produces: validated rows in `harness.memory_candidates` (`status='pending'`, `near_dup_path` NULL until Task 7); `DISTILL_PROMPT` constant; taxonomy validation sets `memory: user|feedback|project|reference`, `solution: bug:logic-errors|bug:runtime-errors|bug:code-quality|bug:performance-issues|knowledge:conventions|knowledge:design-patterns|knowledge:best-practices`.

- [ ] **Step 1: Write the failing tests**

Append to the DB section:

```bash
# Candidates from the Task 5 window run should now exist (stub returned one valid candidate)
# — reset ledgers and re-run so this task's assertions see a fresh run.
psql -X -q -d "$TEST_URL" -c "TRUNCATE harness.memory_candidates, harness.distilled_sessions, harness.distill_runs RESTART IDENTITY CASCADE" >/dev/null
LAB_DATABASE_URL="$TEST_URL" DISTILL_SEND_CMD="$STUB" bash "$SCRIPT" --window 2026-07-01 2026-07-14 >/dev/null 2>&1
NCAND=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT count(*) FROM harness.memory_candidates WHERE status='pending'")
assert_eq "valid candidate inserted pending" "$NCAND" "1"
CANDROW=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT target_store||'|'||subtype||'|'||array_to_string(source_msgs,',') FROM harness.memory_candidates LIMIT 1")
assert_eq "candidate fields round-trip" "$CANDROW" "solution|knowledge:conventions|c-1"
TOKS=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT tokens_in||'/'||tokens_out FROM harness.distill_runs ORDER BY id DESC LIMIT 1")
assert_eq "token counts recorded from send stderr" "$TOKS" "1200/90"

# Malformed response => parse_failed outcome, run completes; invented subtype => candidate
# rejected but session still 'sent'
BADSTUB="$FIX/bad-send.sh"; cat > "$BADSTUB" <<'EOF'
#!/usr/bin/env bash
echo 'Sorry, here is prose, not JSON.'
echo '[kimi: 500 in (0 cached) / 20 out | finish: stop]' >&2
EOF
chmod +x "$BADSTUB"
SUBSTUB="$FIX/subtype-send.sh"; cat > "$SUBSTUB" <<'EOF'
#!/usr/bin/env bash
echo '[{"target_store":"solution","subtype":"bug:invented-category","title":"x","content":"y","evidence_msg_uuids":[]},{"target_store":"memory","subtype":"feedback","title":"Valid one","content":"Valid content.","evidence_msg_uuids":["m-1"]}]'
echo '[kimi: 700 in (0 cached) / 40 out | finish: stop]' >&2
EOF
chmod +x "$SUBSTUB"
psql -X -q -v ON_ERROR_STOP=1 -d "$TEST_URL" >/dev/null <<'SQL'
INSERT INTO harness.transcript_messages (msg_uuid, session_id, project_dir, ts, role, content) VALUES
 ('m-1','malformed-session','fx','2026-07-02T10:00:00Z','user','Another clean discussion, no records.'),
 ('s-1','subtype-session','fx','2026-07-03T10:00:00Z','user','Clean discussion for subtype validation.');
SQL
LAB_DATABASE_URL="$TEST_URL" DISTILL_SEND_CMD="$BADSTUB" bash "$SCRIPT" --window 2026-07-02 2026-07-02 >/dev/null 2>&1
MF=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT outcome FROM harness.distilled_sessions WHERE session_id='malformed-session'")
assert_eq "malformed response -> parse_failed" "$MF" "parse_failed"
LAB_DATABASE_URL="$TEST_URL" DISTILL_SEND_CMD="$SUBSTUB" bash "$SCRIPT" --window 2026-07-03 2026-07-03 >/dev/null 2>&1
SS=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT outcome FROM harness.distilled_sessions WHERE session_id='subtype-session'")
assert_eq "invented subtype: session still sent" "$SS" "sent"
NVALID=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT count(*) FROM harness.memory_candidates WHERE session_id='subtype-session'")
assert_eq "invented subtype rejected, valid sibling inserted" "$NVALID" "1"

# Cost cap: seed a run at the cap -> refusal before any send
psql -X -q -d "$TEST_URL" -c "INSERT INTO harness.distill_runs (window_start,window_end,tokens_in) VALUES ('2026-01-01','2026-01-01', 20000000000)" >/dev/null
CAPOUT=$(LAB_DATABASE_URL="$TEST_URL" DISTILL_SEND_CMD="$STUB" bash "$SCRIPT" --window 2026-07-04 2026-07-04 2>&1); RC=$?
assert_nonzero "cost cap refusal" "$RC"
assert_contains "cap message names the cap" "$CAPOUT" "cap"
psql -X -q -d "$TEST_URL" -c "DELETE FROM harness.distill_runs WHERE tokens_in = 20000000000" >/dev/null
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash .claude/hooks/test-pg-lab-distill.sh`
Expected: FAIL — "valid candidate inserted pending" gets 0 (Task 5's `send_session` discards responses). The cost-cap assertions pass already (Task 5 implemented `check_cost_cap`) — that's fine.

- [ ] **Step 3: Implement prompt + parse + insert**

In `distill.sh`, add after the env-var block:

```bash
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
```

Replace `send_session` (keep the same contract) and add `insert_candidate`:

````bash
insert_candidate() {  # sid, store, subtype, title, content, uuids_csv
  sql -v sid="$1" -v store="$2" -v subtype="$3" -v title="$4" -v content="$5" -v uuids="$6" <<'SQL'
INSERT INTO harness.memory_candidates (session_id, source_msgs, target_store, subtype, title, content)
VALUES (:'sid', CASE WHEN :'uuids' = '' THEN NULL ELSE string_to_array(:'uuids', ',') END,
        :'store', :'subtype', :'title', :'content');
SQL
}

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
````

- [ ] **Step 4: Run test to verify it passes**

Run: `bash .claude/hooks/test-pg-lab-distill.sh`
Expected: PASS — candidate round-trip, token recording, parse_failed path, subtype rejection, cap refusal.

- [ ] **Step 5: Commit**

```bash
git add scripts/pg-lab/distill.sh .claude/hooks/test-pg-lab-distill.sh
git commit -m "feat(pg-lab): distill send path — prompt, tolerant parse, taxonomy validation, cost cap"
```

---

### Task 7: Near-dup flagging (solutions projection + ad-hoc memory comparison)

**Files:**

- Modify: `scripts/pg-lab/distill.sh` (extend `insert_candidate` into a flag-then-insert)
- Modify: `.claude/hooks/test-pg-lab-distill.sh`

**Interfaces:**

- Consumes: `harness.solution_titles` (shipped by `codify-neardup.sh --rebuild`; schema `scripts/pg-lab/schema/codify-neardup.sql`); memory files at `$DISTILL_MEMORY_DIR/*.md` with `name:`/`description:` frontmatter lines.
- Produces: `near_dup_path`/`near_dup_score` populated on insert, threshold `0.45` for both stores. Solution candidates: `similarity()` against `solution_titles` (title-vs-title, comparable lengths — same primitive and threshold as codify-neardup.sh). Memory candidates: `word_similarity(candidate_title, name+description)` against a per-run TSV of memory-file frontmatter (NO persisted projection — spec anti-speculative-infra rail) — a short title against a long description under-scores with whole-string `similarity()`, the exact lesson codified in transcripts.sh's `--fuzzy` design.

- [ ] **Step 1: Write the failing tests**

```bash
# Near-dup: seed the solutions projection with a very similar title; re-run a fresh session
psql -X -q -v ON_ERROR_STOP=1 -d "$TEST_URL" -f "$PROJECT_ROOT/scripts/pg-lab/schema/codify-neardup.sql" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -d "$TEST_URL" >/dev/null <<'SQL'
INSERT INTO harness.solution_titles (path, title) VALUES
 ('docs/solutions/conventions/prefer-pg-trgm-keyword-search-2026-07-01.md',
  'Fixture: prefer pg_trgm keyword search over embeddings');
INSERT INTO harness.transcript_messages (msg_uuid, session_id, project_dir, ts, role, content) VALUES
 ('n-1','neardup-session','fx','2026-07-05T10:00:00Z','user','Clean discussion for near-dup flagging.');
SQL
LAB_DATABASE_URL="$TEST_URL" DISTILL_SEND_CMD="$STUB" bash "$SCRIPT" --window 2026-07-05 2026-07-05 >/dev/null 2>&1
ND=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT near_dup_path FROM harness.memory_candidates WHERE session_id='neardup-session'")
assert_contains "solution near-dup flagged" "$ND" "prefer-pg-trgm-keyword-search"

# Memory-store near-dup via ad-hoc file comparison
MEMDIR="$FIX/memory"; mkdir -p "$MEMDIR"
cat > "$MEMDIR/some_memory.md" <<'MD'
---
name: some_memory
description: "Valid one — a highly similar memory description"
metadata:
  type: feedback
---
Body.
MD
MEMSTUB="$FIX/mem-send.sh"; cat > "$MEMSTUB" <<'EOF'
#!/usr/bin/env bash
echo '[{"target_store":"memory","subtype":"feedback","title":"Valid one","content":"Content.","evidence_msg_uuids":[]}]'
echo '[kimi: 300 in (0 cached) / 30 out | finish: stop]' >&2
EOF
chmod +x "$MEMSTUB"
psql -X -q -d "$TEST_URL" -c "INSERT INTO harness.transcript_messages (msg_uuid, session_id, project_dir, ts, role, content) VALUES ('mm-1','memdup-session','fx','2026-07-06T10:00:00Z','user','Clean.')" >/dev/null
LAB_DATABASE_URL="$TEST_URL" DISTILL_SEND_CMD="$MEMSTUB" DISTILL_MEMORY_DIR="$MEMDIR" bash "$SCRIPT" --window 2026-07-06 2026-07-06 >/dev/null 2>&1
MND=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT near_dup_path FROM harness.memory_candidates WHERE session_id='memdup-session'")
assert_contains "memory near-dup flagged" "$MND" "some_memory.md"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash .claude/hooks/test-pg-lab-distill.sh`
Expected: FAIL — `near_dup_path` NULL on both.

- [ ] **Step 3: Implement flagging**

In `distill.sh`: at the top of `run_window` (after `apply_schema`), build the per-run memory-titles TSV; replace `insert_candidate`:

```bash
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
```

And add `build_memory_titles` as the first line of the `while` loop's enclosing scope — i.e., call it once in `run_window` right after `check_cost_cap`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bash .claude/hooks/test-pg-lab-distill.sh`
Expected: PASS — both near-dup assertions.

- [ ] **Step 5: Commit**

```bash
git add scripts/pg-lab/distill.sh .claude/hooks/test-pg-lab-distill.sh
git commit -m "feat(pg-lab): near-dup flagging — solution_titles projection + ad-hoc memory titles"
```

---

### Task 8: `--review` — interactive queue review

**Files:**

- Modify: `scripts/pg-lab/distill.sh` (replace the `--review` stub with `run_review`)
- Modify: `.claude/hooks/test-pg-lab-distill.sh`

**Interfaces:**

- Consumes: pending `memory_candidates` rows.
- Produces: per-candidate choices read from **stdin** (testable): `a` = accept, `d` = reject-as-duplicate (`reviewer_note` prefixed `dup: <near_dup_path>`), `n` = reject-as-noise, `s` = skip (stays pending), `q` = quit. After the choice, one free-text note line (empty = none). Bucket mapping consumed by Task 9: caught-by-both = rejected with `dup:` prefix; automation-only = accepted; noise = rejected without `dup:` prefix.

- [ ] **Step 1: Write the failing tests**

```bash
# Review: 'a' + note accepts; 'd' rejects with dup: prefix; 'q' quits leaving rest pending
psql -X -q -d "$TEST_URL" -c "UPDATE harness.memory_candidates SET status='pending', reviewer_note=NULL, reviewed_at=NULL" >/dev/null
NPEND=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT count(*) FROM harness.memory_candidates WHERE status='pending'")
REVOUT=$(printf 'a\ngood one\nd\n\nq\n' | LAB_DATABASE_URL="$TEST_URL" bash "$SCRIPT" --review 2>&1); RC=$?
assert_exit0 "--review runs" "$RC"
NACC=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT count(*) FROM harness.memory_candidates WHERE status='accepted' AND reviewer_note='good one' AND reviewed_at IS NOT NULL")
assert_eq "review accept with note" "$NACC" "1"
NDUP=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT count(*) FROM harness.memory_candidates WHERE status='rejected' AND reviewer_note LIKE 'dup:%'")
assert_eq "review duplicate-reject" "$NDUP" "1"
NLEFT=$(psql -X -q -tA -d "$TEST_URL" -c "SELECT count(*) FROM harness.memory_candidates WHERE status='pending'")
assert_eq "quit leaves remainder pending" "$NLEFT" "$((NPEND - 2))"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash .claude/hooks/test-pg-lab-distill.sh`
Expected: FAIL — `--review` exits 1 ("lands in Task 8").

- [ ] **Step 3: Implement run_review**

```bash
run_review() {
  apply_schema
  sql -tA <<'SQL' > "$WORK/pending.txt"
SELECT id FROM harness.memory_candidates WHERE status = 'pending' ORDER BY id;
SQL
  local cid choice note
  # Candidate ids come in on fd 3 — stdin stays free for the reviewer's choices. Reading
  # both from fd 0 would make `read choice` consume the NEXT candidate id.
  while IFS= read -r cid <&3; do
    [ -n "$cid" ] || continue
    sql -v id="$cid" <<'SQL'
SELECT E'\n--- candidate #' || id || ' [' || target_store || '/' || subtype || ']'
       || E'\ntitle:   ' || title
       || E'\nnear-dup: ' || COALESCE(near_dup_path || ' (' || near_dup_score || ')', '(none)')
       || E'\nsession: ' || session_id
       || E'\n' || content
FROM harness.memory_candidates WHERE id = :id;
SQL
    printf '[a]ccept / [d]uplicate-reject / [n]oise-reject / [s]kip / [q]uit: '
    IFS= read -r choice || choice=q
    case "$choice" in
      a|d|n) printf 'note (empty for none): '; IFS= read -r note || note="" ;;
      s) continue ;;
      q|*) break ;;
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
```

Replace the `--review` case arm with `run_review`. Note the final count uses `-c` with NO `:'var'` substitution (allowed — the heredoc rule applies to substitution only) and dollar-quoting to survive the shell single-quote nesting.

- [ ] **Step 4: Run test to verify it passes**

Run: `bash .claude/hooks/test-pg-lab-distill.sh`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/pg-lab/distill.sh .claude/hooks/test-pg-lab-distill.sh
git commit -m "feat(pg-lab): distill --review — stdin-driven queue review with bucket-encoding notes"
```

---

### Task 9: `--report` — stats, spend, buckets, codify-only sweep, precondition hints

**Files:**

- Modify: `scripts/pg-lab/distill.sh` (replace the `--report` stub with `run_report`)
- Modify: `.claude/hooks/test-pg-lab-distill.sh`

**Interfaces:**

- Consumes: all three tables; Task 8's bucket encoding; `git log` for the codify-only reverse sweep.
- Produces: `distill.sh --report [start end]` printing: per-run stats, spend USD, gate ratio, candidate counts by status, four-bucket tally (`caught-by-both` / `automation-only` / `noise` / `codify-only`), and precondition hints when `transcript_messages` or `solution_titles` is missing/empty. Window for the codify-only sweep: args if given, else `min(window_start)`/`max(window_end)` from `distill_runs`.

- [ ] **Step 1: Write the failing tests**

```bash
# Report: buckets derive from review encoding; spend > 0; codify-only sweep runs (the git
# window in the fixture repo has no docs/solutions commits in 2026-07 => count 0 lines is fine)
RPT=$(LAB_DATABASE_URL="$TEST_URL" bash "$SCRIPT" --report 2026-07-01 2026-07-14 2>&1); RC=$?
assert_exit0 "--report runs" "$RC"
assert_contains "report: automation-only bucket" "$RPT" "automation-only: 1"
assert_contains "report: caught-by-both bucket" "$RPT" "caught-by-both: 1"
assert_contains "report: spend line" "$RPT" "spend:"
assert_contains "report: gate stats" "$RPT" "gated"
assert_contains "report: codify-only" "$RPT" "codify-only"

# Precondition hints on an empty DB
EMPTY_DB="pg_lab_distill_empty_$$"
psql -X -q -d postgres -c "CREATE DATABASE \"$EMPTY_DB\"" >/dev/null 2>&1
HINT=$(LAB_DATABASE_URL="postgresql://localhost/$EMPTY_DB" bash "$SCRIPT" --report 2>&1)
assert_contains "report: transcripts precondition hint" "$HINT" "transcripts.sh --import"
assert_contains "report: solution_titles precondition hint" "$HINT" "codify-neardup.sh --rebuild"
psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$EMPTY_DB\"" >/dev/null 2>&1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash .claude/hooks/test-pg-lab-distill.sh`
Expected: FAIL — `--report` exits 1 ("lands in Task 9").

- [ ] **Step 3: Implement run_report**

```bash
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
```

Replace the `--report` case arm:

```bash
  --report)
    shift
    run_report "${1:-}" "${2:-}"
    ;;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash .claude/hooks/test-pg-lab-distill.sh`
Expected: PASS — bucket lines, spend line, precondition hints.

- [ ] **Step 5: Commit**

```bash
git add scripts/pg-lab/distill.sh .claude/hooks/test-pg-lab-distill.sh
git commit -m "feat(pg-lab): distill --report — stats, spend, four buckets, codify-only sweep, preconditions"
```

---

### Task 10: Full verification + PR

**Files:**

- Modify: none (verification only)

- [ ] **Step 1: Syntax + full hook-test suite**

```bash
bash -n scripts/pg-lab/distill.sh && python3 -m py_compile scripts/pg-lab/distill-gate.py
bash scripts/run-hook-tests.sh
```

Expected: both exit 0; every `.claude/hooks/test-*.sh` passes (not just the new one).

- [ ] **Step 2: Repo gates**

```bash
npm run lint && npm run check:types && npm run test:run
```

Expected: PASS — nothing here touches TS/product code, so any failure is pre-existing; investigate before proceeding.

- [ ] **Step 3: Spec cross-check**

Re-read `docs/superpowers/specs/2026-07-09-pg-episodic-distillation-design.md` section by section; confirm each maps to shipped behavior (pipeline steps 1–6, gate layers + identity + hygiene, schema, prompt, review buckets, report, preconditions, cost cap). Fix any gap before the PR.

- [ ] **Step 4: Push + PR**

```bash
git push -u origin pg-lab/episodic-distillation
gh pr create --title "feat(pg-lab): episodic distillation experiment pipeline" --body "..."
```

PR body: link the spec path (note it is gitignored/local-only), summarize the gate design and the experiment's keep/kill criteria, note tables are experiment-scoped. The experiment itself (2-week window, review, verdict) runs AFTER merge, per the spec's execution checklist.

---

## Post-implementation (NOT in this plan's scope)

The experiment execution — `transcripts.sh --import`, `codify-neardup.sh --rebuild`, `distill.sh --window` over the 2-week corpus, `--review`, `--report`, and recording the keep/kill verdict in the spec + todo — happens in its own session per the spec's "Deliverable boundary".
