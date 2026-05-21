# Kimi Verification Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the Kimi review gate from acting on hallucinated findings by adding a verification phase — deterministic on the commit gate, agentic (read-only tool loop) in deep/CI reviews — after first consolidating the two hand-synced engine copies into one.

**Architecture:** Today every Kimi surface is a single LLM call whose prose output is regex-parsed. This plan moves to a two-phase pipeline: Phase 1 _drafts_ findings (now as structured JSON), Phase 2 _verifies_ them. Verification is **monotonic** — it can only remove or downgrade findings, never invent a blocking one — which is why it is safe to let the agentic loop be non-deterministic while keeping the draft at `temperature=0`. The engine is consolidated first so the new logic lives in one place.

**F3 amendment (decided during planning):** The approved spec said the vendored OCRecipes copy would be guarded by a _CI_ drift-check mirroring `build:copilot-instructions:check`. That cannot work literally: the canonical engine lives **outside** the repo (`~/.local/share/claude-coworker/tools/`, shared with other projects), so CI has no copy to compare against. Resolution: the drift-check runs **locally at commit time** (Husky), enforcing only when the canonical exists (`if canonical present, must match; if absent, skip`) — so user machines enforce and CI/other machines skip. CI instead guarantees correctness by running the **test harness** against the vendored copy. Same `:check` shape, relocated to where the source actually exists.

**Tech Stack:** Python 3.12 (engine, OpenAI SDK against OpenRouter / `deepseek/deepseek-v4-flash`), Bash (the three wrapper surfaces + test harness), Node/npm (script wiring), GitHub Actions (CI).

---

## Key paths (reference)

| Thing                                              | Path                                               |
| -------------------------------------------------- | -------------------------------------------------- |
| Canonical engine (out-of-repo, cross-project home) | `~/.local/share/claude-coworker/tools/kimi-review` |
| Global CLI symlink (what commits invoke)           | `~/.local/bin/kimi-review`                         |
| Vendored in-repo copy (what CI runs)               | `scripts/kimi-review.py`                           |
| Claude-Code PreToolUse gate                        | `.claude/hooks/kimi-review.sh`                     |
| Husky pre-commit gate                              | `.husky/pre-commit`                                |
| CI gate wrapper                                    | `scripts/ci-kimi-review.sh`                        |
| CI workflow                                        | `.github/workflows/kimi-review.yml`                |
| Test harness (parity proof)                        | `.claude/hooks/test-kimi-review.sh`                |
| Multi-domain panel                                 | `~/.local/bin/kimi-multi-review`                   |
| Architecture doc (update at the end)               | `docs/kimi-review-architecture.md`                 |

## Engine output contract (used by every phase)

The engine prints findings to **stdout** and diagnostics to **stderr**, and signals blocking via **exit code**:

| Exit code          | Meaning                                                  | Wrapper action                  |
| ------------------ | -------------------------------------------------------- | ------------------------------- |
| `0`                | clean OR only non-blocking findings (WARNING/SUGGESTION) | allow                           |
| `2`                | at least one **CRITICAL survived verification**          | block                           |
| any other non-zero | tool/transport error (timeout, no key, truncation)       | skip gate (fail-open, as today) |

The printed finding text format is preserved exactly as today —
`[TIER] path/to/file.ts:42 — description` — so existing output remains readable.
The blocking signal migrates from "grep the text" to "read the exit code"
(Phase 2, Task 2.3).

---

# Phase 1 — Consolidate the engine (no review-quality regression)

**Outcome:** one canonical engine file, a byte-identical vendored copy, a local drift-check, and the test harness green against both copies. No new verification behavior yet.

The two current copies differ in four documented ways (see `docs/kimi-review-architecture.md` §3). The canonical engine takes the **superset / safer** option for each:

- Credential resolution → adopt `scripts/kimi-review.py`'s `resolve_client_config` (supports `WORKER_API_KEY`, `OPENROUTER_API_KEY`, and `MOONSHOT_API_KEY`+`WORKER_BASE_URL`).
- Truncation detection → adopt `scripts/kimi-review.py`'s `finish_reason == "length"` exit-1 check.
- System prompt → adopt the longer `~/.local/bin/kimi-review` prompt (numbered priorities + constraints).
- Profiles → externalize to a data file (below) so adding a project never edits the engine.

### Task 1.1: Externalize project profiles to a data file

**Files:**

- Create: `~/.local/share/claude-coworker/tools/kimi-profiles.json`
- Create: `scripts/kimi-profiles.json` (vendored: `generic` + `ocrecipes` only)
- Test: `.claude/hooks/test-kimi-review.sh` (new embedded-python case)

- [ ] **Step 1: Write the profiles data file (canonical home)**

Create `~/.local/share/claude-coworker/tools/kimi-profiles.json` with the three profiles currently inlined in `~/.local/bin/kimi-review` (`generic`, `ocrecipes`, `plant_id`). `generic` is the empty string. Copy the `ocrecipes` and `plant_id` text verbatim from `~/.local/bin/kimi-review` lines 11-38:

```json
{
  "generic": "",
  "ocrecipes": "Project profile: OCRecipes (Expo/React Native + Express/Drizzle/PostgreSQL nutrition app).\n\nReview priorities:\n- Auth/security: Bearer JWT auth only; flag missing ownership/userId checks, IDOR risks, token leaks, secret exposure, unsafe admin paths.\n- Health/nutrition data: flag cross-user data access, unsafe medical/nutrition advice paths, and changes that could corrupt logs, meal plans, receipts, pantry, or IAP state.\n- API/backend: Express route handlers should use existing error/auth patterns; Drizzle queries should preserve transactions, soft-delete/ownership filters, and JSONB safety.\n- Client: React Native/Expo code should follow existing navigation, safe-area, accessibility, TanStack Query, and theme patterns; flag web-only assumptions.\n- AI/evals: prompt, classifier, and eval changes should preserve safety/accuracy gates, cache-key isolation, deterministic behavior where intended, and avoid prompt-injection regressions.\n- Tests: flag missing focused tests only when the diff changes shared behavior, security boundaries, storage contracts, navigation flows, or AI routing/eval semantics.",
  "plant_id": "Project profile: Plant ID Community (Django/Wagtail + DRF backend, React/TypeScript web, Flutter mobile, Firebase).\n\n[copy the full plant_id text verbatim from ~/.local/bin/kimi-review lines 25-37]"
}
```

(Replace the `plant_id` placeholder line with the exact verbatim text from the current local engine — do not paraphrase.)

- [ ] **Step 2: Write the vendored profiles file (repo, OCRecipes-relevant only)**

Create `scripts/kimi-profiles.json` with only `generic` and `ocrecipes` (OCRecipes has no reason to carry another project's profile). The `ocrecipes` value must be byte-identical to the canonical one:

```json
{
  "generic": "",
  "ocrecipes": "Project profile: OCRecipes (Expo/React Native + Express/Drizzle/PostgreSQL nutrition app).\n\nReview priorities:\n- Auth/security: Bearer JWT auth only; flag missing ownership/userId checks, IDOR risks, token leaks, secret exposure, unsafe admin paths.\n- Health/nutrition data: flag cross-user data access, unsafe medical/nutrition advice paths, and changes that could corrupt logs, meal plans, receipts, pantry, or IAP state.\n- API/backend: Express route handlers should use existing error/auth patterns; Drizzle queries should preserve transactions, soft-delete/ownership filters, and JSONB safety.\n- Client: React Native/Expo code should follow existing navigation, safe-area, accessibility, TanStack Query, and theme patterns; flag web-only assumptions.\n- AI/evals: prompt, classifier, and eval changes should preserve safety/accuracy gates, cache-key isolation, deterministic behavior where intended, and avoid prompt-injection regressions.\n- Tests: flag missing focused tests only when the diff changes shared behavior, security boundaries, storage contracts, navigation flows, or AI routing/eval semantics."
}
```

- [ ] **Step 3: Write the failing test for the profile loader**

Add this case to `.claude/hooks/test-kimi-review.sh` (new function near the other `run_python_*` helpers). It asserts a `load_profiles(path)` function exists and reads the JSON:

```bash
run_python_profile_tests() {
  command -v python3 >/dev/null 2>&1 || { echo "python3 not found"; return 1; }
  python3 - "$ROOT/scripts/kimi-review.py" "$ROOT/scripts/kimi-profiles.json" <<'PY'
import importlib.util, pathlib, sys
module_path = pathlib.Path(sys.argv[1])
spec = importlib.util.spec_from_file_location("kimi_review", module_path)
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
profiles = module.load_profiles(pathlib.Path(sys.argv[2]))
assert profiles["generic"] == "", "generic profile must be empty string"
assert "OCRecipes" in profiles["ocrecipes"], "ocrecipes profile must load"
# Unknown profile path → empty dict, never raises
assert module.load_profiles(pathlib.Path("/nonexistent.json")) == {}, "missing file → {}"
PY
}
```

Wire it into the run section near line 477 alongside the other `run_python_*` calls:

```bash
if run_python_profile_tests; then
  echo "PASS: Python profile loader reads kimi-profiles.json"; PASS=$((PASS+1))
else
  echo "FAIL: Python profile loader reads kimi-profiles.json"; FAIL=$((FAIL+1))
fi
```

- [ ] **Step 4: Run it to verify it fails**

Run: `bash .claude/hooks/test-kimi-review.sh 2>&1 | grep -i profile`
Expected: FAIL (`load_profiles` not defined yet).

- [ ] **Step 5: Implement `load_profiles` (write it into the canonical engine; it is vendored in 1.2)**

The implementation lives in the consolidated engine produced in Task 1.2. For now, define the function so the test passes — add to `scripts/kimi-review.py` (temporary placement; 1.2 replaces the whole file):

```python
import json

def load_profiles(path):
    """Load project profiles from a JSON file. Missing/unreadable → {}."""
    try:
        return json.loads(pathlib.Path(path).read_text(errors="replace"))
    except (OSError, ValueError):
        return {}
```

- [ ] **Step 6: Run it to verify it passes**

Run: `bash .claude/hooks/test-kimi-review.sh 2>&1 | grep -i profile`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/kimi-profiles.json .claude/hooks/test-kimi-review.sh scripts/kimi-review.py
git commit -m "feat(kimi): externalize review profiles to kimi-profiles.json"
```

### Task 1.2: Reconcile the two engines into one canonical engine + vendor it

**Files:**

- Modify (full rewrite): `~/.local/share/claude-coworker/tools/kimi-review`
- Create symlink: `~/.local/bin/kimi-review` → `~/.local/share/claude-coworker/tools/kimi-review`
- Create: `scripts/sync-kimi-engine.sh`
- Modify: `scripts/kimi-review.py` (becomes the vendored output of the sync)
- Modify: `package.json` (add `kimi:engine:sync`, `kimi:engine:check`)

- [ ] **Step 1: Back up the current local engine**

```bash
cp ~/.local/bin/kimi-review /tmp/kimi-review.local.bak
cp scripts/kimi-review.py /tmp/kimi-review.ci.bak
```

- [ ] **Step 2: Write the canonical engine**

Author `~/.local/share/claude-coworker/tools/kimi-review` as the unified engine. It is `scripts/kimi-review.py`'s structure (it already has `resolve_client_config`, `build_diff_ref`, `render_changed_files`, `filter_review`, `validate_tiers`, the `finish_reason == "length"` check) PLUS:

- `load_profiles(path)` from Task 1.1.
- Profiles loaded from a sibling `kimi-profiles.json` (same directory as the engine file): `PROFILES = load_profiles(pathlib.Path(__file__).resolve().parent / "kimi-profiles.json")`.
- `detect_profile` and `--profile` choices derived from `PROFILES.keys()` plus `auto`/`generic` (so `plant_id` works wherever its profile data is present; OCRecipes' vendored data simply lacks it).
- The longer system prompt from the current `~/.local/bin/kimi-review` (lines 299-349), unchanged in wording.

Keep the shebang pointing at the coworker venv: `#!/Users/williamtower/.local/share/claude-coworker/venv/bin/python3`. Keep all four testable seam functions' signatures identical (the harness imports them).

- [ ] **Step 3: Point the global CLI at the canonical engine**

```bash
chmod +x ~/.local/share/claude-coworker/tools/kimi-review
ln -sf ~/.local/share/claude-coworker/tools/kimi-review ~/.local/bin/kimi-review
cp ~/.local/share/claude-coworker/tools/kimi-profiles.json ~/.local/share/claude-coworker/tools/kimi-profiles.json  # ensure present next to engine
```

Verify: `command -v kimi-review && readlink ~/.local/bin/kimi-review`
Expected: prints the symlink target in the coworker tools dir.

- [ ] **Step 4: Write the sync script**

Create `scripts/sync-kimi-engine.sh`. It copies the canonical engine into the repo as `scripts/kimi-review.py`, normalizing the shebang to `#!/usr/bin/env python3` (CI has no coworker venv). The vendored `scripts/kimi-profiles.json` is maintained by hand (OCRecipes-only profiles), so the sync does NOT overwrite it.

```bash
#!/usr/bin/env bash
# Sync the canonical kimi engine into the repo's vendored copy.
# Canonical lives outside the repo (cross-project home); this copies it in so CI
# can run it. The vendored kimi-profiles.json is hand-maintained (OCRecipes-only)
# and intentionally NOT overwritten here.
set -euo pipefail

CANON="${KIMI_ENGINE_CANONICAL:-$HOME/.local/share/claude-coworker/tools/kimi-review}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENDORED="$REPO_ROOT/scripts/kimi-review.py"

if [ ! -f "$CANON" ]; then
  echo "Error: canonical engine not found at $CANON" >&2
  exit 1
fi

# Replace the coworker-venv shebang with a portable one for CI.
{
  echo '#!/usr/bin/env python3'
  tail -n +2 "$CANON"
} > "$VENDORED"

echo "Synced $CANON -> $VENDORED"
```

```bash
chmod +x scripts/sync-kimi-engine.sh
```

- [ ] **Step 5: Add the `:check` mode (drift detection)**

Create `scripts/check-kimi-engine.sh` — compares vendored against canonical, skipping when canonical is absent (the F3-amendment rule):

```bash
#!/usr/bin/env bash
# Drift check: vendored scripts/kimi-review.py must match the canonical engine
# (modulo the shebang line). Skips silently when the canonical is absent (CI,
# other machines); enforces when present (developer machines).
set -euo pipefail

CANON="${KIMI_ENGINE_CANONICAL:-$HOME/.local/share/claude-coworker/tools/kimi-review}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENDORED="$REPO_ROOT/scripts/kimi-review.py"

if [ ! -f "$CANON" ]; then
  echo "[kimi:engine:check] canonical engine absent — skipping drift check."
  exit 0
fi

if diff <(tail -n +2 "$CANON") <(tail -n +2 "$VENDORED") >/dev/null 2>&1; then
  echo "[kimi:engine:check] vendored scripts/kimi-review.py matches canonical."
  exit 0
fi

echo "[kimi:engine:check] scripts/kimi-review.py is STALE vs canonical." >&2
echo "Run 'npm run kimi:engine:sync' and commit the result." >&2
exit 1
```

```bash
chmod +x scripts/check-kimi-engine.sh
```

- [ ] **Step 6: Add npm scripts**

In `package.json` `scripts`, after the `ci:kimi-review` line, add:

```json
"kimi:engine:sync": "bash scripts/sync-kimi-engine.sh",
"kimi:engine:check": "bash scripts/check-kimi-engine.sh",
```

- [ ] **Step 7: Sync and verify byte-parity**

```bash
npm run kimi:engine:sync
npm run kimi:engine:check
```

Expected: sync prints `Synced ...`, check prints `... matches canonical.`

- [ ] **Step 8: Commit**

```bash
git add scripts/sync-kimi-engine.sh scripts/check-kimi-engine.sh scripts/kimi-review.py package.json
git commit -m "feat(kimi): consolidate engine into one canonical source + vendored copy"
```

### Task 1.3: Enforce drift locally via Husky

**Files:**

- Modify: `.husky/pre-commit` (add the check before the kimi review section)

- [ ] **Step 1: Add the drift-check call to the Husky hook**

In `.husky/pre-commit`, immediately after the `npx lint-staged` line (line 19) and before the `SKIP_KIMI_REVIEW` block, insert:

```bash
# Engine drift check: vendored scripts/kimi-review.py must match the canonical
# engine on this machine. Skips when canonical is absent (see check script).
if [ -f scripts/check-kimi-engine.sh ]; then
  bash scripts/check-kimi-engine.sh || exit 1
fi
```

- [ ] **Step 2: Verify it passes on a clean tree**

Run: `bash scripts/check-kimi-engine.sh`
Expected: `... matches canonical.` exit 0.

- [ ] **Step 3: Verify it catches drift**

```bash
printf '\n# drift\n' >> scripts/kimi-review.py
bash scripts/check-kimi-engine.sh; echo "rc=$?"
git checkout -- scripts/kimi-review.py
```

Expected: prints `STALE`, `rc=1`. (Then the `git checkout` restores it.)

- [ ] **Step 4: Commit**

```bash
git add .husky/pre-commit
git commit -m "feat(kimi): enforce engine drift check in pre-commit"
```

### Task 1.4: Prove behavioral parity via the harness (both copies)

**Files:**

- Modify: `.claude/hooks/test-kimi-review.sh` (run pure-fn tests against canonical too)

- [ ] **Step 1: Parameterize the python helper tests over a target engine**

The three `run_python_*` helpers in `.claude/hooks/test-kimi-review.sh` hardcode `"$ROOT/scripts/kimi-review.py"`. Change each to accept an engine path argument, defaulting to the vendored copy. Example for `run_python_helper_tests` (apply the same shape to `run_python_filter_tests` and `run_python_credential_tests`):

```bash
run_python_helper_tests() {
  local engine="${1:-$ROOT/scripts/kimi-review.py}"
  command -v python3 >/dev/null 2>&1 || { echo "python3 not found"; return 1; }
  python3 - "$engine" <<'PY'
# ... existing body unchanged ...
PY
}
```

- [ ] **Step 2: Run each python suite against the canonical engine when present**

After the existing vendored-copy invocations (around lines 477-499), add a canonical pass:

```bash
CANON_ENGINE="$HOME/.local/share/claude-coworker/tools/kimi-review"
if [ -f "$CANON_ENGINE" ]; then
  if run_python_helper_tests "$CANON_ENGINE" \
     && run_python_filter_tests "$CANON_ENGINE" \
     && run_python_credential_tests "$CANON_ENGINE"; then
    echo "PASS: canonical engine matches vendored behavior"; PASS=$((PASS+1))
  else
    echo "FAIL: canonical engine diverges from vendored behavior"; FAIL=$((FAIL+1))
  fi
else
  echo "SKIP: canonical engine absent — behavioral parity check"
fi
```

- [ ] **Step 3: Run the full harness**

Run: `bash .claude/hooks/test-kimi-review.sh`
Expected: `Results: N passed, 0 failed` (N grows by the new profile + parity cases).

- [ ] **Step 4: Smoke-test a real review (manual parity sanity)**

```bash
git diff HEAD~1 -- '*.ts' '*.tsx' | kimi-review --scope "phase-1 smoke" --profile ocrecipes --tiers CRITICAL,WARNING
```

Expected: sane findings or a clean message; no traceback. (Requires a working API key; skip if unavailable and note it.)

- [ ] **Step 5: Commit**

```bash
git add .claude/hooks/test-kimi-review.sh
git commit -m "test(kimi): prove engine parity across canonical and vendored copies"
```

---

# Phase 2 — Structured draft findings + exit-code blocking

**Outcome:** the engine builds findings as typed data internally (via `structured_outputs`), renders them to the same text format, and signals blocking via exit code `2`. The three wrappers switch from grepping text to reading the exit code. The brittle prose machinery (`_FILE_REF_RE`, `filter_review` placeholder heuristic, the per-wrapper `[[]CRITICAL[]]` grep) is retired.

Edit the **canonical** engine for every engine change, then `npm run kimi:engine:sync` before committing so the vendored copy and the drift-check stay green.

### Task 2.1: Define the finding schema and a parser

**Files:**

- Modify: canonical engine + `scripts/kimi-review.py` (via sync)
- Test: `.claude/hooks/test-kimi-review.sh`

- [ ] **Step 1: Write the failing test for `findings_to_text` and `parse_findings`**

Add to `.claude/hooks/test-kimi-review.sh`:

```bash
run_python_schema_tests() {
  local engine="${1:-$ROOT/scripts/kimi-review.py}"
  command -v python3 >/dev/null 2>&1 || { echo "python3 not found"; return 1; }
  python3 - "$engine" <<'PY'
import importlib.util, pathlib, sys
spec = importlib.util.spec_from_file_location("kimi_review", pathlib.Path(sys.argv[1]))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

findings = [
    {"tier":"CRITICAL","claim_type":"absent_symbol","file":"server/a.ts","line":42,"symbol":"requireOwner","detail":"missing ownership check"},
    {"tier":"WARNING","claim_type":"semantic","file":"server/b.ts","line":7,"symbol":None,"detail":"noisy log"},
]
text = m.findings_to_text(findings)
assert "[CRITICAL] server/a.ts:42 — missing ownership check" in text, text
assert "[WARNING] server/b.ts:7 — noisy log" in text, text

# round-trip a model JSON payload
payload = '{"findings": ' + __import__("json").dumps(findings) + '}'
parsed = m.parse_findings(payload, {"CRITICAL","WARNING"})
assert len(parsed) == 2 and parsed[0]["tier"] == "CRITICAL"
# tier filtering drops unrequested tiers
parsed_c = m.parse_findings(payload, {"CRITICAL"})
assert len(parsed_c) == 1 and parsed_c[0]["tier"] == "CRITICAL"
PY
}
```

Wire it in next to the other suites (vendored + canonical, mirroring Task 1.4 Step 2).

- [ ] **Step 2: Run to verify it fails**

Run: `bash .claude/hooks/test-kimi-review.sh 2>&1 | grep -i schema`
Expected: FAIL (`findings_to_text` not defined).

- [ ] **Step 3: Implement schema constant, `parse_findings`, `findings_to_text`**

Add to the canonical engine:

```python
FINDING_SCHEMA = {
    "type": "object",
    "properties": {
        "findings": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "tier": {"type": "string", "enum": ["CRITICAL", "WARNING", "SUGGESTION"]},
                    "claim_type": {"type": "string", "enum": ["absent_symbol", "line_assertion", "semantic"]},
                    "file": {"type": "string"},
                    "line": {"type": ["integer", "null"]},
                    "symbol": {"type": ["string", "null"]},
                    "detail": {"type": "string"},
                },
                "required": ["tier", "claim_type", "file", "line", "symbol", "detail"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["findings"],
    "additionalProperties": False,
}


def parse_findings(answer, requested_tiers):
    """Parse the model's JSON payload into a list of finding dicts, keeping only
    requested tiers. Returns [] on malformed JSON (caller treats as clean)."""
    allowed = {t.upper() for t in requested_tiers}
    try:
        data = json.loads(answer)
    except (ValueError, TypeError):
        return []
    out = []
    for f in data.get("findings", []):
        if f.get("tier", "").upper() in allowed:
            out.append(f)
    return out


def findings_to_text(findings):
    """Render findings to the human format the wrappers and humans already read."""
    if not findings:
        return ""
    lines = []
    for f in findings:
        loc = f["file"] + (f":{f['line']}" if f.get("line") is not None else "")
        lines.append(f"[{f['tier']}] {loc} — {f['detail']}")
    return "\n".join(lines)
```

- [ ] **Step 4: Run to verify it passes**

Run: `bash .claude/hooks/test-kimi-review.sh 2>&1 | grep -i schema`
Expected: PASS.

- [ ] **Step 5: Sync + commit**

```bash
npm run kimi:engine:sync && npm run kimi:engine:check
git add scripts/kimi-review.py .claude/hooks/test-kimi-review.sh
git commit -m "feat(kimi): typed finding schema with parse_findings/findings_to_text"
```

### Task 2.2: Switch the draft call to structured output + exit-code contract

**Files:**

- Modify: canonical engine + `scripts/kimi-review.py` (via sync)
- Modify: `.github/workflows/kimi-review.yml` (SDK version pin)

- [ ] **Step 0: Probe that OpenRouter honors json_schema for this model (de-risk before the rewrite)**

OpenRouter lists `structured_outputs` in `supported_parameters` for `deepseek/deepseek-v4-flash`, but that only confirms the parameter is accepted — not that its translation layer enforces strict schema conformance (some providers silently degrade `json_schema` to loose `json_object`). Verify before rewriting the engine. Run this throwaway probe (requires `OPENROUTER_API_KEY` / `WORKER_API_KEY`):

```bash
python3 - <<'PY'
import os, json
from openai import OpenAI
client = OpenAI(api_key=os.environ.get("WORKER_API_KEY") or os.environ["OPENROUTER_API_KEY"],
                base_url="https://openrouter.ai/api/v1")
schema = {"type":"object","properties":{"findings":{"type":"array","items":{"type":"object",
  "properties":{"tier":{"type":"string"},"detail":{"type":"string"}},
  "required":["tier","detail"],"additionalProperties":False}}},
  "required":["findings"],"additionalProperties":False}
r = client.chat.completions.create(
    model="deepseek/deepseek-v4-flash", temperature=0,
    messages=[{"role":"user","content":"Return one CRITICAL finding about an injection bug as JSON."}],
    response_format={"type":"json_schema","json_schema":{"name":"f","strict":True,"schema":schema}})
data = json.loads(r.choices[0].message.content)  # must not raise
assert "findings" in data, data
print("OK structured outputs:", data)
PY
```

Expected: prints `OK structured outputs: {...}`. If it raises (non-JSON content) or ignores the schema, fall back in Step 1 to `response_format={"type":"json_object"}` plus a `json.loads` retry, and note the deviation in the architecture doc. Record the outcome before proceeding.

- [ ] **Step 1: Request structured output in the draft call**

In the engine's `client.chat.completions.create(...)`, add the response-format and instruct JSON. Replace the `temperature=0` call's tail and update the system prompt's "Format every finding exactly as" section to instead say:

```python
        response = client.chat.completions.create(
            model=args.model,
            messages=[{"role": "system", "content": system_prompt},
                      {"role": "user", "content": user_msg}],
            max_tokens=args.max_tokens,
            temperature=0,
            response_format={
                "type": "json_schema",
                "json_schema": {"name": "kimi_findings", "strict": True, "schema": FINDING_SCHEMA},
            },
        )
```

In the system prompt, replace the trailing "Format every finding exactly as: ... Find problems." block with:

```
Return a JSON object {"findings": [...]}. Each finding has:
- tier: CRITICAL | WARNING | SUGGESTION
- claim_type: absent_symbol (you assert code/guard/test is missing) |
              line_assertion (you assert a specific line does/says something) |
              semantic (you assert behavior is wrong but it needs reasoning, not a lookup)
- file: repo-relative path
- line: the line number you are citing, or null
- symbol: the identifier your claim is about (the asserted-missing or asserted-present name), or null
- detail: one or two sentences on why it is wrong and what to fix
Return {"findings": []} when there are no issues. Do not praise. Do not summarize the diff.
```

- [ ] **Step 2: Replace prose handling with structured handling + exit code**

Replace the `print(filter_review(answer, requested_tiers))` tail with:

```python
    findings = parse_findings(answer, requested_tiers)
    text = findings_to_text(findings)
    print(text if text else f"No findings in requested tiers: {', '.join(requested_tiers)}")

    # (Phase 3/4 insert verification here, mutating `findings` before this point.)
    if any(f["tier"].upper() == "CRITICAL" for f in findings):
        sys.exit(2)
```

Keep the existing `finish_reason == "length"` → `sys.exit(1)` and the no-`answer` → `sys.exit(1)` guards before this block (tool errors stay code 1).

- [ ] **Step 3: Keep `filter_review` exported but unused (harness still imports it until Task 2.3)**

Do not delete `filter_review` yet — the harness still calls it. It is removed in Task 2.3 Step 4 once wrappers no longer depend on the text gate.

- [ ] **Step 4: Pin the OpenAI SDK to a version with json_schema support**

`json_schema` structured outputs require `openai>=1.40`. In `.github/workflows/kimi-review.yml`, change the install step (line 54) from `python -m pip install "openai>=1.0.0,<2"` to:

```yaml
run: python -m pip install "openai>=1.40,<2"
```

- [ ] **Step 5: Manual smoke (structured path)**

```bash
git diff HEAD~1 -- '*.ts' '*.tsx' | kimi-review --scope "phase-2 smoke" --profile ocrecipes --tiers CRITICAL,WARNING; echo "exit=$?"
```

Expected: text findings (or clean message); `exit=2` iff a CRITICAL is present, else `exit=0`. (Requires API key.)

- [ ] **Step 6: Sync + commit**

```bash
npm run kimi:engine:sync && npm run kimi:engine:check
git add scripts/kimi-review.py .github/workflows/kimi-review.yml
git commit -m "feat(kimi): structured-output draft with exit-code blocking signal"
```

### Task 2.3: Migrate the three wrappers from text-grep to exit code

**Files:**

- Modify: `.claude/hooks/kimi-review.sh`
- Modify: `.husky/pre-commit`
- Modify: `scripts/ci-kimi-review.sh`
- Modify: `.claude/hooks/test-kimi-review.sh`

- [ ] **Step 1: Update the Husky stub-based test expectations first (TDD)**

The harness stubs `kimi-review` to print text. Update the stub to also exit `2` on critical modes so wrappers can key on exit code. In `make_stub_path`, change the critical cases to exit 2 after printing, e.g.:

```bash
  critical)         echo "[CRITICAL] server/routes/foo.ts:42 — stub finding for tests"; exit 2;;
  critical-bracket) echo "  - [CRITICAL] server/routes/foo.ts:10 — bullet+indent decorated finding"; exit 2;;
  critical-bold)    echo "**[CRITICAL]** server/routes/foo.ts:10 — markdown-bold form"; exit 2;;
  critical-no-findings-desc)
                    echo "[CRITICAL] server/routes/foo.ts:42 — error handler swallows the error and returns no findings to the caller"; exit 2;;
```

Leave clean/warning/placeholder modes exiting 0 (their existing default). Remove the now-obsolete `critical-nobody`, `clean-tiered`, `clean-model-prose` _blocking_ assertions that depended on the grep (they remain as exit-0 non-blocking cases — keep the `assert_not_contains "... does NOT block"` checks; they now pass because the stub exits 0 for those modes).

- [ ] **Step 2: Replace the CRITICAL grep in the Claude hook with exit-code logic**

In `.claude/hooks/kimi-review.sh`, capture the review exit status and branch on it. Replace lines 94-145 (the run + grep + deny block) with:

```bash
if [ -n "$PATTERNS" ]; then
  REVIEW=$(printf '%s' "$REVIEW_DIFF" | kimi-review \
    --scope "staged for commit" --profile ocrecipes \
    --patterns "$PATTERNS" --rules "$PATTERNS" --pattern-max-chars 12000 \
    --changed-files "$CHANGED_FILES" --tiers CRITICAL,WARNING 2>&1)
else
  REVIEW=$(printf '%s' "$REVIEW_DIFF" | kimi-review \
    --scope "staged for commit" --profile ocrecipes \
    --changed-files "$CHANGED_FILES" --tiers CRITICAL,WARNING 2>&1)
fi
REVIEW_STATUS=$?

if [ "$REVIEW_STATUS" -eq 2 ]; then
  REASON=$(printf 'kimi-review blocked the commit — verified CRITICAL finding present.\n\n%s\n\n%s' \
    "${PATTERNS:+patterns: $PATTERNS}" "$REVIEW")
  jq -n --arg reason "$REASON" \
    '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":$reason}}'
  exit 0
fi
```

(Exit 0 = clean/non-blocking, any other non-zero = tool error → fall through to the additionalContext block, which already surfaces the review.)

- [ ] **Step 3: Replace the CRITICAL grep in Husky and CI with exit-code logic**

In `.husky/pre-commit`, replace the `CRITICAL_FINDINGS=$(... grep ...)` block (lines 127-135) with:

```bash
if [ "$REVIEW_STATUS" -eq 2 ]; then
  echo "" >&2
  echo "Commit blocked: kimi-review reported a verified CRITICAL finding above." >&2
  echo "Fix the issue or set SKIP_KIMI_REVIEW=1 to bypass." >&2
  exit 1
fi
```

Keep the existing `124` (timeout) and "other non-zero → skip gate" branches that follow.

In `scripts/ci-kimi-review.sh`, replace the `critical_findings=$(... grep ...)` block (lines 145-155) with:

```bash
if [[ $review_status -eq 2 ]]; then
  echo "" >&2
  echo "Kimi review blocked this PR: verified CRITICAL finding present." >&2
  exit 1
fi
```

Keep the `124` and other-non-zero branches.

- [ ] **Step 4: Remove the now-dead prose machinery**

- In the canonical engine, delete `filter_review` and `_FILE_REF_RE`. Remove `run_python_filter_tests` from the harness and its invocation.
- Update the harness comment block at the top of `make_stub_path` to describe exit codes instead of grep shapes.

- [ ] **Step 5: Run the full harness**

Run: `bash .claude/hooks/test-kimi-review.sh`
Expected: `Results: N passed, 0 failed`. CRITICAL modes block via exit 2; clean/placeholder/warning modes do not block.

- [ ] **Step 6: Sync + commit**

```bash
npm run kimi:engine:sync && npm run kimi:engine:check
git add .claude/hooks/kimi-review.sh .husky/pre-commit scripts/ci-kimi-review.sh scripts/kimi-review.py .claude/hooks/test-kimi-review.sh
git commit -m "refactor(kimi): block on engine exit code, retire prose-grep gate"
```

---

# Phase 3 — Tier A: deterministic gate verification

**Outcome:** before the engine sets exit code 2, it verifies each CRITICAL against the **staged tree**. `absent_symbol` and `line_assertion` claims that the code refutes are downgraded to WARNING (printed, non-blocking). `semantic` and `uncertain` CRITICALs are also downgraded to WARNING on the gate (decision F2). Verification is **monotonic**.

### Task 3.1: Implement the monotonic downgrade primitive

**Files:**

- Modify: canonical engine + `scripts/kimi-review.py` (via sync)
- Test: `.claude/hooks/test-kimi-review.sh`

- [ ] **Step 1: Write the failing test for `apply_downgrades`**

```bash
run_python_monotonic_tests() {
  local engine="${1:-$ROOT/scripts/kimi-review.py}"
  command -v python3 >/dev/null 2>&1 || { echo "python3 not found"; return 1; }
  python3 - "$engine" <<'PY'
import importlib.util, pathlib, sys
spec = importlib.util.spec_from_file_location("kimi_review", pathlib.Path(sys.argv[1]))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

findings = [{"tier":"CRITICAL","claim_type":"absent_symbol","file":"a.ts","line":1,"symbol":"x","detail":"d"}]
# verdicts: index -> "keep" | "downgrade"
out = m.apply_downgrades(findings, {0: "downgrade"})
assert out[0]["tier"] == "WARNING", "downgrade must lower CRITICAL to WARNING"

out2 = m.apply_downgrades(findings, {0: "keep"})
assert out2[0]["tier"] == "CRITICAL", "keep must preserve tier"

# MONOTONICITY: a verdict can never raise tier
warn = [{"tier":"WARNING","claim_type":"semantic","file":"a.ts","line":1,"symbol":None,"detail":"d"}]
out3 = m.apply_downgrades(warn, {0: "keep"})
assert out3[0]["tier"] == "WARNING", "verify must never promote a tier"
PY
}
```

Wire it in (vendored + canonical).

- [ ] **Step 2: Run to verify it fails**

Run: `bash .claude/hooks/test-kimi-review.sh 2>&1 | grep -i monoton`
Expected: FAIL.

- [ ] **Step 3: Implement `apply_downgrades`**

```python
def apply_downgrades(findings, verdicts):
    """Return a new findings list with CRITICAL→WARNING where verdicts say
    'downgrade'. MONOTONIC: never raises a tier, never adds or drops a finding."""
    out = []
    for i, f in enumerate(findings):
        g = dict(f)
        if verdicts.get(i) == "downgrade" and g["tier"].upper() == "CRITICAL":
            g["tier"] = "WARNING"
            g["detail"] = g["detail"] + " [downgraded: unverified against code]"
        out.append(g)
    return out
```

- [ ] **Step 4: Run to verify it passes**

Run: `bash .claude/hooks/test-kimi-review.sh 2>&1 | grep -i monoton`
Expected: PASS.

- [ ] **Step 5: Sync + commit**

```bash
npm run kimi:engine:sync && npm run kimi:engine:check
git add scripts/kimi-review.py .claude/hooks/test-kimi-review.sh
git commit -m "feat(kimi): monotonic apply_downgrades primitive"
```

### Task 3.2: Implement deterministic staged-tree verification

**Files:**

- Modify: canonical engine + `scripts/kimi-review.py` (via sync)
- Test: `.claude/hooks/test-kimi-review.sh`

- [ ] **Step 1: Write the failing test for `verify_deterministic`**

This test creates a temp git repo with a staged file so `git grep --cached` and `git show :path` resolve. It asserts the verdict routing.

```bash
run_python_detverify_tests() {
  local engine="${1:-$ROOT/scripts/kimi-review.py}"
  command -v python3 >/dev/null 2>&1 || { echo "python3 not found"; return 1; }
  python3 - "$engine" <<'PY'
import importlib.util, pathlib, sys, subprocess, tempfile, os
spec = importlib.util.spec_from_file_location("kimi_review", pathlib.Path(sys.argv[1]))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

d = tempfile.mkdtemp()
def git(*a): return subprocess.run(["git","-C",d,*a], capture_output=True, text=True)
git("init","-q"); git("config","user.email","t@t"); git("config","user.name","t")
(pathlib.Path(d)/"a.ts").write_text("export function requireOwner() {}\nconst y = 2;\n")
git("add","a.ts")

# absent_symbol claim that is FALSE (symbol present in staged tree) -> downgrade
f_present = {"tier":"CRITICAL","claim_type":"absent_symbol","file":"a.ts","line":None,"symbol":"requireOwner","detail":"d"}
# absent_symbol claim that is TRUE (symbol really missing) -> keep
f_missing = {"tier":"CRITICAL","claim_type":"absent_symbol","file":"a.ts","line":None,"symbol":"nonexistentGuard","detail":"d"}
# line_assertion that DOES match the cited staged line -> keep
f_goodline = {"tier":"CRITICAL","claim_type":"line_assertion","file":"a.ts","line":1,"symbol":"requireOwner","detail":"d"}
# line_assertion whose symbol is NOT on the cited line -> downgrade
f_badline = {"tier":"CRITICAL","claim_type":"line_assertion","file":"a.ts","line":2,"symbol":"totallyWrongText","detail":"d"}
# semantic on the gate -> downgrade (F2)
f_semantic = {"tier":"CRITICAL","claim_type":"semantic","file":"a.ts","line":1,"symbol":None,"detail":"d"}

verdicts = m.verify_deterministic([f_present,f_missing,f_goodline,f_badline,f_semantic], cwd=d)
assert verdicts[0] == "downgrade", verdicts
assert verdicts[1] == "keep", verdicts
assert verdicts[2] == "keep", verdicts
assert verdicts[3] == "downgrade", verdicts
assert verdicts[4] == "downgrade", verdicts
PY
}
```

Wire it in (vendored + canonical).

- [ ] **Step 2: Run to verify it fails**

Run: `bash .claude/hooks/test-kimi-review.sh 2>&1 | grep -i detverify`
Expected: FAIL.

- [ ] **Step 3: Implement `verify_deterministic`**

```python
def _staged_file(path, cwd):
    r = subprocess.run(["git", "show", f":{path}"], capture_output=True, text=True, cwd=cwd)
    return r.stdout if r.returncode == 0 else None

def _grep_staged(symbol, cwd):
    # Fixed-string, staged-tree search. Returns True if found anywhere.
    r = subprocess.run(["git", "grep", "--cached", "-F", "-q", "--", symbol],
                       capture_output=True, text=True, cwd=cwd)
    return r.returncode == 0

def _normalize(s):
    return " ".join(s.split())

def verify_deterministic(findings, cwd=None):
    """Return a list of per-finding verdicts ('keep'|'downgrade') for CRITICALs,
    routed by claim_type against the STAGED tree. Non-CRITICAL findings always
    'keep' (nothing to block). F2: semantic/uncertain CRITICALs downgrade."""
    verdicts = []
    for f in findings:
        if f["tier"].upper() != "CRITICAL":
            verdicts.append("keep"); continue
        ct = f.get("claim_type")
        if ct == "absent_symbol":
            sym = f.get("symbol")
            if sym and _grep_staged(sym, cwd):
                verdicts.append("downgrade")        # claim "missing" is false
            elif sym:
                verdicts.append("keep")             # genuinely absent
            else:
                verdicts.append("downgrade")        # unverifiable → F2
        elif ct == "line_assertion":
            content = _staged_file(f["file"], cwd)
            quote = f.get("symbol") or ""
            lines = content.splitlines() if content is not None else []
            ln = f.get("line")
            on_line = lines[ln - 1] if isinstance(ln, int) and 1 <= ln <= len(lines) else ""
            if quote and on_line and _normalize(quote) in _normalize(on_line):
                verdicts.append("keep")             # quoted text really on the cited line
            else:
                verdicts.append("downgrade")        # misquote/wrong-line/uncertain → F2
        else:  # semantic or unknown
            verdicts.append("downgrade")            # F2: not gate-blockable
    return verdicts
```

- [ ] **Step 4: Run to verify it passes**

Run: `bash .claude/hooks/test-kimi-review.sh 2>&1 | grep -i detverify`
Expected: PASS.

- [ ] **Step 5: Sync + commit**

```bash
npm run kimi:engine:sync && npm run kimi:engine:check
git add scripts/kimi-review.py .claude/hooks/test-kimi-review.sh
git commit -m "feat(kimi): deterministic staged-tree verification (Tier A)"
```

### Task 3.3: Wire Tier A into the engine behind a flag

**Files:**

- Modify: canonical engine + `scripts/kimi-review.py` (via sync)

- [ ] **Step 1: Add a `--verify` flag**

Add to `parse_args`:

```python
    parser.add_argument(
        "--verify", choices=["off", "deterministic", "agentic"], default="off",
        help="Post-draft verification: off | deterministic (Tier A gate) | agentic (Tier B)",
    )
```

- [ ] **Step 2: Apply deterministic verification before the exit-code decision**

In `main`, between `findings = parse_findings(...)` and the print/exit block, insert:

```python
    if args.verify == "deterministic":
        verdicts = verify_deterministic(findings, cwd=root)
        findings = apply_downgrades(findings, {i: v for i, v in enumerate(verdicts)})
```

The text render and `sys.exit(2 if any CRITICAL)` then operate on the post-verification list.

- [ ] **Step 3: Pass `--verify deterministic` from the two commit-gate wrappers**

In `.claude/hooks/kimi-review.sh`, add `--verify deterministic` to both `kimi-review` invocations (the `-n "$PATTERNS"` and else branches).
In `.husky/pre-commit`, add `--verify deterministic` to the `REVIEW_COMMAND` array (after `--profile ocrecipes`).
Leave `scripts/ci-kimi-review.sh` unchanged for now (CI gets Tier B in Phase 4).

- [ ] **Step 4: Add a wrapper-level harness assertion**

Add a stub mode that emits a JSON-less text path is not possible (engine owns JSON); instead assert the flag is forwarded. Add an `echo-args` expectation:

```bash
OUT=$(run_husky_gate echo-args)
assert_contains "Husky forwards --verify deterministic" "$OUT" "--verify deterministic"
```

(Mirror for the Claude hook with `run_hook echo-args`.)

- [ ] **Step 5: Run the full harness + smoke**

Run: `bash .claude/hooks/test-kimi-review.sh`
Expected: `Results: N passed, 0 failed`.

Smoke (stage a file whose draft would hallucinate a missing symbol, confirm downgrade):

```bash
git add -A && git diff --cached --function-context -- '*.ts' '*.tsx' | kimi-review --scope smoke --profile ocrecipes --tiers CRITICAL,WARNING --verify deterministic --changed-files "$(git diff --cached --name-status)"; echo "exit=$?"
```

Expected: any refuted "missing X" CRITICAL prints as `[WARNING] ... [downgraded: ...]`; `exit=0` if no real CRITICAL survives.

- [ ] **Step 6: Sync + commit**

```bash
npm run kimi:engine:sync && npm run kimi:engine:check
git add scripts/kimi-review.py .claude/hooks/kimi-review.sh .husky/pre-commit .claude/hooks/test-kimi-review.sh
git commit -m "feat(kimi): enable Tier A deterministic verify on the commit gate"
```

---

# Phase 4 — Tier B: agentic read-only verification

**Outcome:** for deep/CI reviews, each draft CRITICAL is verified by a bounded, read-only tool loop that can refute semantic misreads. Verdicts feed the same monotonic `apply_downgrades`. CI never executes PR-head code (read-only text tools only).

### Task 4.1: Implement the read-only tool executor

**Files:**

- Modify: canonical engine + `scripts/kimi-review.py` (via sync)
- Test: `.claude/hooks/test-kimi-review.sh`

- [ ] **Step 1: Write the failing test for `run_tool`**

```bash
run_python_tool_tests() {
  local engine="${1:-$ROOT/scripts/kimi-review.py}"
  command -v python3 >/dev/null 2>&1 || { echo "python3 not found"; return 1; }
  python3 - "$engine" <<'PY'
import importlib.util, pathlib, sys, tempfile
spec = importlib.util.spec_from_file_location("kimi_review", pathlib.Path(sys.argv[1]))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

import subprocess
d = tempfile.mkdtemp()
def git(*a): return subprocess.run(["git","-C",d,*a], capture_output=True, text=True)
git("init","-q"); git("config","user.email","t@t"); git("config","user.name","t")
(pathlib.Path(d)/"a.ts").write_text("line1\nrequireOwner()\nline3\n")

# working-tree read (tree_ref=None) returns file contents
r = m.run_tool("read_file", {"path": "a.ts"}, root=d)
assert "requireOwner" in r, r
# grep (working tree) returns matching lines
g = m.run_tool("grep", {"pattern": "requireOwner"}, root=d)
assert "requireOwner" in g, g
# path traversal is refused (read-only, in-tree only)
bad = m.run_tool("read_file", {"path": "../../../etc/passwd"}, root=d)
assert "error" in bad.lower() or bad == "", bad
# unknown tool is refused
assert "error" in m.run_tool("rm", {"path":"a.ts"}, root=d).lower()

# TREE DISCIPLINE: read a committed sha (simulates CI reading PR head, not the
# checked-out base). Commit a CHANGED version, then read it back by sha.
git("add","a.ts"); git("commit","-q","-m","base")
(pathlib.Path(d)/"a.ts").write_text("line1\nverifiedAtHead()\nline3\n")
git("add","a.ts"); git("commit","-q","-m","head")
head = git("rev-parse","HEAD").stdout.strip()
git("checkout","-q","HEAD~1")  # working tree is now BASE, like CI
assert "verifiedAtHead" not in (pathlib.Path(d)/"a.ts").read_text()
rh = m.run_tool("read_file", {"path":"a.ts"}, root=d, tree_ref=head)
assert "verifiedAtHead" in rh, "tree_ref read must see the head tree, not working tree"
gh = m.run_tool("grep", {"pattern":"verifiedAtHead"}, root=d, tree_ref=head)
assert "verifiedAtHead" in gh, gh
PY
}
```

Wire it in (vendored + canonical).

- [ ] **Step 2: Run to verify it fails**

Run: `bash .claude/hooks/test-kimi-review.sh 2>&1 | grep -i tool`
Expected: FAIL.

- [ ] **Step 3: Implement `run_tool` (read-only, in-tree only)**

```python
TOOL_DEFS = [
    {"type": "function", "function": {
        "name": "read_file",
        "description": "Read a repo-relative text file. Read-only.",
        "parameters": {"type": "object", "properties": {
            "path": {"type": "string"}}, "required": ["path"]}}},
    {"type": "function", "function": {
        "name": "grep",
        "description": "Search the repo for a fixed string. Read-only.",
        "parameters": {"type": "object", "properties": {
            "pattern": {"type": "string"}}, "required": ["pattern"]}}},
]

def _safe_path(root, rel):
    base = pathlib.Path(root).resolve()
    target = (base / rel).resolve()
    if base != target and base not in target.parents:
        return None  # escape attempt
    return target

def _read_tree(path, root, tree_ref):
    """Read a file from a git tree. tree_ref None => working tree (via _safe_path,
    in-tree only); a sha/ref => `git show <ref>:path` (CI reads PR head this way)."""
    if tree_ref:
        r = subprocess.run(["git", "show", f"{tree_ref}:{path}"],
                           capture_output=True, text=True, cwd=root)
        return r.stdout if r.returncode == 0 else None
    target = _safe_path(root, path)
    if target is None or not target.is_file():
        return None
    return target.read_text(errors="replace")

def run_tool(name, args, root, tree_ref=None):
    """Execute a read-only tool against the chosen git tree. Never writes, never
    executes project code. tree_ref selects the tree per surface (None = working
    tree for local/manual; KIMI_REVIEW_HEAD_SHA for CI PR-head)."""
    if name == "read_file":
        content = _read_tree(args.get("path", ""), root, tree_ref)
        if content is None:
            return "error: path not readable in tree"
        return content[:8000]
    if name == "grep":
        pattern = args.get("pattern", "")
        if not pattern:
            return "error: empty pattern"
        cmd = ["git", "grep", "-n", "-F", "-e", pattern]
        if tree_ref:
            cmd.append(tree_ref)   # search the PR-head tree, not the checked-out base
        r = subprocess.run(cmd, capture_output=True, text=True, cwd=root)
        return r.stdout[:8000] if r.stdout else "(no matches)"
    return f"error: unknown tool {name}"
```

- [ ] **Step 4: Run to verify it passes**

Run: `bash .claude/hooks/test-kimi-review.sh 2>&1 | grep -i tool`
Expected: PASS.

- [ ] **Step 5: Sync + commit**

```bash
npm run kimi:engine:sync && npm run kimi:engine:check
git add scripts/kimi-review.py .claude/hooks/test-kimi-review.sh
git commit -m "feat(kimi): read-only tool executor for agentic verify"
```

### Task 4.2: Implement the bounded per-finding verify loop

**Files:**

- Modify: canonical engine + `scripts/kimi-review.py` (via sync)
- Test: `.claude/hooks/test-kimi-review.sh`

- [ ] **Step 1: Write the failing test with a fake client**

The loop must be testable without network. It takes an injected `client` exposing `chat.completions.create`. The fake returns a tool call once, then a final verdict.

```bash
run_python_verifyloop_tests() {
  local engine="${1:-$ROOT/scripts/kimi-review.py}"
  command -v python3 >/dev/null 2>&1 || { echo "python3 not found"; return 1; }
  python3 - "$engine" <<'PY'
import importlib.util, pathlib, sys, tempfile, types, json
spec = importlib.util.spec_from_file_location("kimi_review", pathlib.Path(sys.argv[1]))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

d = tempfile.mkdtemp(); (pathlib.Path(d)/"a.ts").write_text("requireOwner()\n")

def msg(content=None, tool_calls=None):
    return types.SimpleNamespace(content=content, tool_calls=tool_calls)
def choice(m_): return types.SimpleNamespace(message=m_, finish_reason="stop")
def resp(m_): return types.SimpleNamespace(choices=[choice(m_)])

class FakeClient:
    def __init__(self): self.calls=0; self.chat=types.SimpleNamespace(completions=self)
    def create(self, **kw):
        self.calls += 1
        if self.calls == 1:
            tc = types.SimpleNamespace(id="t1", function=types.SimpleNamespace(
                name="grep", arguments=json.dumps({"pattern":"requireOwner"})))
            return resp(msg(tool_calls=[tc]))
        return resp(msg(content=json.dumps({"verdict":"refuted","corrected_detail":"exists","confidence":0.9})))

f = {"tier":"CRITICAL","claim_type":"semantic","file":"a.ts","line":1,"symbol":None,"detail":"x missing"}
verdict = m.verify_one_agentic(f, FakeClient(), model="x", root=d, max_turns=5)
assert verdict == "downgrade", verdict  # refuted -> downgrade
PY
}
```

Wire it in (vendored + canonical).

- [ ] **Step 2: Run to verify it fails**

Run: `bash .claude/hooks/test-kimi-review.sh 2>&1 | grep -i verifyloop`
Expected: FAIL.

- [ ] **Step 3: Implement `verify_one_agentic` and `verify_agentic`**

```python
VERIFY_SCHEMA = {
    "type": "object",
    "properties": {
        "verdict": {"type": "string", "enum": ["verified", "refuted", "uncertain"]},
        "corrected_detail": {"type": "string"},
        "confidence": {"type": "number"},
    },
    "required": ["verdict", "corrected_detail", "confidence"],
    "additionalProperties": False,
}

VERIFY_SYSTEM = (
    "You verify a single code-review finding against the real code using read-only "
    "tools (read_file, grep). Decide if the finding's claim actually holds. "
    "verdict=verified (claim is real), refuted (claim is false), uncertain (cannot tell). "
    "Use tools before deciding. Never assume; check."
)

def verify_one_agentic(finding, client, model, root, max_turns=5, tree_ref=None):
    """Bounded read-only verify loop for one finding. Returns 'keep' (verified)
    or 'downgrade' (refuted/uncertain). MONOTONIC: only ever downgrades.
    tree_ref selects which git tree the tools read (None = working tree)."""
    messages = [
        {"role": "system", "content": VERIFY_SYSTEM},
        {"role": "user", "content": "Finding to verify:\n" + json.dumps(finding)},
    ]
    for _ in range(max_turns):
        resp = client.chat.completions.create(
            model=model, messages=messages, temperature=0, tools=TOOL_DEFS)
        m = resp.choices[0].message
        tool_calls = getattr(m, "tool_calls", None)
        if tool_calls:
            messages.append({"role": "assistant", "content": m.content or "",
                             "tool_calls": [
                                 {"id": tc.id, "type": "function",
                                  "function": {"name": tc.function.name,
                                               "arguments": tc.function.arguments}}
                                 for tc in tool_calls]})
            for tc in tool_calls:
                try:
                    a = json.loads(tc.function.arguments)
                except ValueError:
                    a = {}
                result = run_tool(tc.function.name, a, root=root, tree_ref=tree_ref)
                messages.append({"role": "tool", "tool_call_id": tc.id, "content": result})
            continue
        # No tool call → ask for the structured verdict and stop.
        verdict_resp = client.chat.completions.create(
            model=model, messages=messages + [
                {"role": "user", "content": "Now return your verdict as JSON."}],
            temperature=0,
            response_format={"type": "json_schema",
                             "json_schema": {"name": "verify", "strict": True, "schema": VERIFY_SCHEMA}})
        try:
            v = json.loads(verdict_resp.choices[0].message.content)
        except (ValueError, TypeError):
            return "downgrade"  # uncertain → F2-style fail-safe
        return "keep" if v.get("verdict") == "verified" else "downgrade"
    return "downgrade"  # ran out of turns → treat as uncertain


def verify_agentic(findings, client, model, root, max_turns=5, jobs=4, tree_ref=None):
    """Verify all CRITICAL findings in parallel; non-CRITICAL always 'keep'."""
    import concurrent.futures
    verdicts = ["keep"] * len(findings)
    targets = [i for i, f in enumerate(findings) if f["tier"].upper() == "CRITICAL"]
    if not targets:
        return verdicts
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, jobs)) as ex:
        futs = {ex.submit(verify_one_agentic, findings[i], client, model, root, max_turns, tree_ref): i
                for i in targets}
        for fut in concurrent.futures.as_completed(futs):
            verdicts[futs[fut]] = fut.result()
    return verdicts
```

- [ ] **Step 4: Run to verify it passes**

Run: `bash .claude/hooks/test-kimi-review.sh 2>&1 | grep -i verifyloop`
Expected: PASS.

- [ ] **Step 5: Sync + commit**

```bash
npm run kimi:engine:sync && npm run kimi:engine:check
git add scripts/kimi-review.py .claude/hooks/test-kimi-review.sh
git commit -m "feat(kimi): bounded read-only agentic verify loop (Tier B)"
```

### Task 4.3: Wire Tier B into the engine and CI; route the multi-review panel

**Files:**

- Modify: canonical engine + `scripts/kimi-review.py` (via sync)
- Modify: `scripts/ci-kimi-review.sh`
- Modify: `~/.local/bin/kimi-multi-review`

- [ ] **Step 1: Branch on `--verify agentic` in `main`**

In `main`, extend the verification block from Phase 3:

```python
    if args.verify == "deterministic":
        verdicts = verify_deterministic(findings, cwd=root)
        findings = apply_downgrades(findings, {i: v for i, v in enumerate(verdicts)})
    elif args.verify == "agentic":
        # CI sets KIMI_REVIEW_HEAD_SHA and checks out the BASE tree, so PR-head
        # content is only reachable by sha. Local/manual runs leave it unset =>
        # working tree. This is the Tier B half of the spec's tree-discipline rule.
        head_ref = os.environ.get("KIMI_REVIEW_HEAD_SHA") or None
        verdicts = verify_agentic(findings, client, args.model, root, tree_ref=head_ref)
        findings = apply_downgrades(findings, {i: v for i, v in enumerate(verdicts)})
```

(`client`, `args.model`, and `root` are already in scope from the draft call.)

- [ ] **Step 2: Pass `--verify agentic` from CI**

In `scripts/ci-kimi-review.sh`, add `--verify agentic` to the `review_command` array (after `--profile ocrecipes`). CI's read-only invariant holds: `run_tool` only reads files and runs `git grep`; it never executes PR-head code.

- [ ] **Step 3: Pass `--verify agentic` from the multi-review panel**

In `~/.local/bin/kimi-multi-review`, add `--verify`, `agentic` to the `cmd` list in `run_reviewer` (after `--profile`, args.profile).

- [ ] **Step 4: Add a CI-security assertion to the harness**

Assert `run_tool` cannot execute or write — add to `run_python_tool_tests` (already covers unknown-tool + traversal; add an explicit write attempt):

```bash
# (append inside run_python_tool_tests PY heredoc)
before = (pathlib.Path(d)/"a.ts").read_text()
m.run_tool("read_file", {"path":"a.ts"}, root=d)
assert (pathlib.Path(d)/"a.ts").read_text() == before, "tools must never mutate files"
```

- [ ] **Step 5: Run the full harness + CI dry run**

Run: `bash .claude/hooks/test-kimi-review.sh`
Expected: `Results: N passed, 0 failed`.

CI dry run locally:

```bash
KIMI_REVIEW_BASE_SHA=HEAD~1 KIMI_REVIEW_HEAD_SHA=HEAD WORKER_API_KEY="$OPENROUTER_API_KEY" bash scripts/ci-kimi-review.sh; echo "exit=$?"
```

Expected: completes; `exit=0` clean, `exit=1` only on a verified CRITICAL. (Requires API key.)

- [ ] **Step 6: Sync + commit**

```bash
npm run kimi:engine:sync && npm run kimi:engine:check
git add scripts/kimi-review.py scripts/ci-kimi-review.sh
git commit -m "feat(kimi): enable Tier B agentic verify in CI and multi-review"
```

### Task 4.4: Update the architecture doc

**Files:**

- Modify: `docs/kimi-review-architecture.md`

- [ ] **Step 1: Document the two-phase pipeline**

Update `docs/kimi-review-architecture.md`: add a "Verification" section describing Phase 1/2, the `--verify` modes, the exit-code contract (0/2/other), the monotonicity invariant, the deterministic claim-type routing, the read-only tool invariant, and the consolidation model (canonical home + vendored copy + local drift-check). Update §3 ("Two copies") to reflect the new sync/check mechanism. Update §5 to add the `--verify` flag row. Update §6 to replace the shape-based grep description with the exit-code gate.

- [ ] **Step 2: Commit**

```bash
git add docs/kimi-review-architecture.md
git commit -m "docs(kimi): document verification layer + consolidation in architecture ref"
```

---

## Final verification (run after Phase 4)

- [ ] `bash .claude/hooks/test-kimi-review.sh` → `Results: N passed, 0 failed`
- [ ] `npm run kimi:engine:check` → matches canonical
- [ ] A staged commit with a hallucinated "missing X" CRITICAL is **not** blocked (downgraded to WARNING) — manual smoke
- [ ] A staged commit with a real CRITICAL **is** blocked (exit 2) — manual smoke
- [ ] `grep -rn "filter_review\|_FILE_REF_RE\|\[\[\]CRITICAL" .claude/hooks scripts .husky` returns nothing (prose machinery fully retired)
- [ ] Update `docs/kimi-review-architecture.md` "Last updated" date

## Notes for the implementer

- **Always edit the canonical engine, then `npm run kimi:engine:sync`** before committing engine changes; the pre-commit drift-check (Task 1.3) will block otherwise.
- The canonical engine is **outside the repo** (`~/.local/share/claude-coworker/tools/kimi-review`). The orchestrator must edit it directly (it is not in a worktree). See the project memory note on out-of-repo fixes.
- API-key-dependent smoke steps are optional during implementation; the harness is hermetic and is the binding gate. Mark skipped smokes explicitly.
- Keep `temperature=0` on the **draft** call always. The agentic verify loop is allowed to be non-deterministic because it is monotonic.
