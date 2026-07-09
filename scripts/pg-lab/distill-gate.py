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
    "william.tower@gmail.com",
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
    payload = json.dumps({"verdict": "sent",
                          "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest()})
    tmp = dst + ".tmp"
    try:
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
        os.replace(tmp, dst)
        print(payload)
        sys.stdout.flush()
    except BaseException:
        # Contract: no out-file may survive any non-sent outcome — remove both the temp
        # file and dst (dst only exists here if the final print/flush failed post-replace).
        for p in (tmp, dst):
            try:
                os.unlink(p)
            except OSError:
                pass
        raise


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # FAIL-CLOSED: never sent on error; class only, never content or the exception text
        # (an exception message can embed the very content the gate exists to contain).
        print(json.dumps({"verdict": "gated", "class": "gate_error"}))
        sys.exit(3)
