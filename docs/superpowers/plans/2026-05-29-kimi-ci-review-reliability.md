# Kimi CI Review Reliability — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the Kimi CI review job crashing on transient API behavior (empty/malformed draft responses, agentic-verify timeouts) by adding a deadline-aware retry layer and a single global wall-clock budget, while keeping the gate strict (a real CRITICAL still blocks and notifies).

**Architecture:** One monotonic deadline (`engine-start + KIMI_REVIEW_BUDGET_SECONDS`, default 330s) is threaded into every model call and every loop boundary in the Python review engine. A `call_with_retry` wrapper retries transient failures and empty content (but never `length` truncation) without overrunning the deadline. The agentic verify phase resolves unfinished CRITICALs to a new `keep_unverified` verdict (keep + notify). The CI hard-timeout backstop rises 300→480s so the internal budget trips first with a clean verdict instead of a SIGTERM.

**Tech Stack:** Python 3.12 (the review engine), the OpenAI SDK (OpenRouter-compatible), Bash (CI wrapper + test harness), `concurrent.futures` for the parallel verify loop.

**Spec:** `docs/superpowers/specs/2026-05-29-kimi-ci-review-reliability-design.md`

---

## Critical operational constraints (read before Task 1)

1. **Two engine copies, kept in sync.** The source of truth is the **canonical** engine at
   `~/.local/share/claude-coworker/tools/kimi-review` (extensionless executable, NOT in git, shared across projects).
   The **vendored** copy `scripts/kimi-review.py` (in git, used by CI) is regenerated from the canonical by
   `npm run kimi:engine:sync`. A Husky pre-commit drift check (`npm run kimi:engine:check`) **blocks the commit** if the
   two differ (modulo shebang). **Therefore: every task that changes engine code edits the canonical FIRST, then runs
   `npm run kimi:engine:sync` BEFORE committing.** The bodies of the two files are identical, so the code blocks below
   apply verbatim to both.

2. **The test harness validates both copies.** `.claude/hooks/test-kimi-review.sh` runs each `run_python_*_tests()`
   function against vendored `scripts/kimi-review.py`, then re-runs the same functions against the canonical engine
   (symlinked to a `.py` name). A new test function must be added to BOTH the tally block AND the canonical-parity
   `&&`-chain near the bottom of the harness.

3. **The Kimi review gate does not fire on these commits.** The commit-time Kimi gate only reviews staged `.ts`/`.tsx`
   files; this work touches `.py`, `.sh`, and `.md` only, so it auto-skips. The **drift check still runs** — sync first.

4. **`time` import.** Task 2 adds `import time` to the engine's top-level imports; Tasks 4–6 rely on module-level
   `time.monotonic()`.

---

## File Structure

| File                                                               | In git? | Responsibility                                                          | Tasks                  |
| ------------------------------------------------------------------ | ------- | ----------------------------------------------------------------------- | ---------------------- |
| `~/.local/share/claude-coworker/tools/kimi-review` (canonical)     | No      | Source of truth for all engine logic edits                              | 1,2,3,4,5,6            |
| `scripts/kimi-review.py` (vendored)                                | Yes     | CI engine; regenerated via `kimi:engine:sync` after each canonical edit | 1,2,3,4,5,6 (via sync) |
| `.claude/hooks/test-kimi-review.sh`                                | Yes     | Hermetic test harness; new Python unit tests added here                 | 1,2,3,4,5              |
| `scripts/ci-kimi-review.sh`                                        | Yes     | CI wrapper; hard-timeout backstop 300→480                               | 7                      |
| `docs/kimi-review-architecture.md`                                 | Yes     | Single source of truth for the review system; documents new behavior    | 8                      |
| `~/.local/share/claude-coworker/tools/test-kimi-review.py` (local) | No      | Local convenience test suite; mirror of new tests                       | 9                      |

---

## Setup (before Task 1)

- [ ] **Step 1: Branch from current `main`.**

```bash
cd /Users/williamtower/projects/OCRecipes
git switch -c fix/2026-05-29-kimi-ci-reliability
```

- [ ] **Step 2: Confirm the canonical engine is present and in sync (baseline).**

Run:

```bash
ls -1 "$HOME/.local/share/claude-coworker/tools/kimi-review" && npm run -s kimi:engine:check
```

Expected: the path prints, then `[kimi:engine:check] vendored scripts/kimi-review.py matches canonical.`
If the check reports a mismatch, STOP — resolve drift before changing anything.

- [ ] **Step 3: Confirm the harness is green at baseline.**

Run: `bash .claude/hooks/test-kimi-review.sh`
Expected: final line `Results: N passed, 0 failed`. Record N.

---

## Task 1: `resolve_budget_seconds` — read the global budget from env

**Files:**

- Modify: `~/.local/share/claude-coworker/tools/kimi-review` (canonical) → synced to `scripts/kimi-review.py`
- Test: `.claude/hooks/test-kimi-review.sh` (new `run_python_budget_tests` function + runner wiring)

- [ ] **Step 1: Write the failing test.** Add this function in `.claude/hooks/test-kimi-review.sh` immediately after `run_python_credential_tests()` (it closes around line 183):

```bash
run_python_budget_tests() {
  local engine="${1:-$ROOT/scripts/kimi-review.py}"
  command -v python3 >/dev/null 2>&1 || { echo "python3 not found"; return 1; }
  python3 - "$engine" <<'PY'
import importlib.util, pathlib, sys
spec = importlib.util.spec_from_file_location("kimi_review", pathlib.Path(sys.argv[1]))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
assert m.resolve_budget_seconds({}) == 330, "default budget is 330"
assert m.resolve_budget_seconds({"KIMI_REVIEW_BUDGET_SECONDS": "120"}) == 120, "explicit value honored"
assert m.resolve_budget_seconds({"KIMI_REVIEW_BUDGET_SECONDS": "0"}) == 330, "non-positive -> default"
assert m.resolve_budget_seconds({"KIMI_REVIEW_BUDGET_SECONDS": "-5"}) == 330, "negative -> default"
assert m.resolve_budget_seconds({"KIMI_REVIEW_BUDGET_SECONDS": "abc"}) == 330, "unparseable -> default"
PY
}
```

Wire it into the bottom runner: add this block immediately after the `run_python_credential_tests` PASS/FAIL block (ends ~line 642):

```bash
if run_python_budget_tests; then
  echo "PASS: Python resolve_budget_seconds env parsing"; PASS=$((PASS+1))
else
  echo "FAIL: Python resolve_budget_seconds env parsing"; FAIL=$((FAIL+1))
fi
```

And add it to the canonical-parity `&&`-chain (the block that starts `if run_python_helper_tests "$CANON_TMP/kimi_review.py" \`), inserting this line into the chain:

```bash
     && run_python_budget_tests "$CANON_TMP/kimi_review.py" \
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `bash .claude/hooks/test-kimi-review.sh 2>&1 | grep -E "resolve_budget_seconds|Results"`
Expected: `FAIL: Python resolve_budget_seconds env parsing` (the function does not exist yet → `AttributeError`).

- [ ] **Step 3: Implement in the canonical engine.** Edit `~/.local/share/claude-coworker/tools/kimi-review`. Add this function immediately after `resolve_client_config` (which ends at the line `    return api_key, base_url`):

```python
def resolve_budget_seconds(env=os.environ):
    """Global wall-clock budget (seconds) for draft + agentic verify combined.
    Defaults to 330; a non-positive or unparseable value falls back to the
    default. One shared deadline (see main) keeps total time bounded so a slow,
    retry-heavy draft cannot push the verify phase past the CI backstop."""
    raw = env.get("KIMI_REVIEW_BUDGET_SECONDS")
    if raw is None:
        return 330
    try:
        val = int(raw)
    except (TypeError, ValueError):
        return 330
    return val if val > 0 else 330
```

- [ ] **Step 4: Sync canonical → vendored.**

Run: `npm run -s kimi:engine:sync && npm run -s kimi:engine:check`
Expected: ends with `vendored scripts/kimi-review.py matches canonical.`

- [ ] **Step 5: Run the test to verify it passes.**

Run: `bash .claude/hooks/test-kimi-review.sh 2>&1 | grep -E "resolve_budget_seconds|canonical engine|Results"`
Expected: `PASS: Python resolve_budget_seconds env parsing`, `PASS: canonical engine matches vendored behavior`, and `Results: <N+1> passed, 0 failed`.

- [ ] **Step 6: Commit.**

```bash
git add scripts/kimi-review.py .claude/hooks/test-kimi-review.sh
git commit -m "feat(kimi): add resolve_budget_seconds global-budget env helper"
```

---

## Task 2: `BudgetExceeded` + deadline-aware `call_with_retry` + content validators

**Files:**

- Modify: `~/.local/share/claude-coworker/tools/kimi-review` (canonical) → synced
- Test: `.claude/hooks/test-kimi-review.sh` (new `run_python_retry_tests`)

- [ ] **Step 1: Write the failing test.** Add this function after `run_python_budget_tests()`:

```bash
run_python_retry_tests() {
  local engine="${1:-$ROOT/scripts/kimi-review.py}"
  command -v python3 >/dev/null 2>&1 || { echo "python3 not found"; return 1; }
  python3 - "$engine" <<'PY'
import importlib.util, pathlib, sys, types, time
spec = importlib.util.spec_from_file_location("kimi_review", pathlib.Path(sys.argv[1]))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

def resp(content, fr="stop"):
    msg = types.SimpleNamespace(content=content, tool_calls=None)
    return types.SimpleNamespace(choices=[types.SimpleNamespace(message=msg, finish_reason=fr)])

# validators
assert m._draft_acceptable(resp("text")) is None, "non-empty draft accepted"
assert m._draft_acceptable(resp("", fr="length")) is None, "length draft accepted (fast-fail downstream)"
assert m._draft_acceptable(resp("")) is not None, "empty non-length draft rejected -> retry"
assert m._verdict_acceptable(resp("{}")) is None
assert m._verdict_acceptable(resp("")) is not None

# (i) raises once, then succeeds
class RaiseThenOK:
    def __init__(self): self.calls=0; self.chat=types.SimpleNamespace(completions=self)
    def create(self, **kw):
        self.calls += 1
        if self.calls == 1: raise RuntimeError("boom")
        return resp("ok")
c = RaiseThenOK()
r = m.call_with_retry(c, validate=None, retries=2, base_delay=0)
assert r.choices[0].message.content == "ok" and c.calls == 2, c.calls

# (ii) empty content retried until non-empty, using the draft validator
class EmptyThenOK:
    def __init__(self): self.calls=0; self.chat=types.SimpleNamespace(completions=self)
    def create(self, **kw):
        self.calls += 1
        return resp("" if self.calls == 1 else "good")
c2 = EmptyThenOK()
r2 = m.call_with_retry(c2, validate=m._draft_acceptable, retries=2, base_delay=0)
assert r2.choices[0].message.content == "good" and c2.calls == 2, c2.calls

# (iii) deadline already passed -> BudgetExceeded, NO model call made
class Counting:
    def __init__(self): self.calls=0; self.chat=types.SimpleNamespace(completions=self)
    def create(self, **kw): self.calls += 1; return resp("x")
c3 = Counting()
try:
    m.call_with_retry(c3, validate=None, deadline=time.monotonic()-1, retries=2, base_delay=0)
    raise AssertionError("expected BudgetExceeded")
except m.BudgetExceeded:
    pass
assert c3.calls == 0, "no model call once budget exhausted"

# (iv) length is NOT retried (accepted -> returned for the downstream fast-fail)
class LengthEmpty:
    def __init__(self): self.calls=0; self.chat=types.SimpleNamespace(completions=self)
    def create(self, **kw): self.calls += 1; return resp("", fr="length")
c4 = LengthEmpty()
r4 = m.call_with_retry(c4, validate=m._draft_acceptable, retries=2, base_delay=0)
assert c4.calls == 1, "length response must not be retried"
assert r4.choices[0].finish_reason == "length"

# (v) exhausts retries on persistent empty -> raises
class AlwaysEmpty:
    def __init__(self): self.calls=0; self.chat=types.SimpleNamespace(completions=self)
    def create(self, **kw): self.calls += 1; return resp("")
c5 = AlwaysEmpty()
try:
    m.call_with_retry(c5, validate=m._draft_acceptable, retries=2, base_delay=0)
    raise AssertionError("expected raise after exhausting retries")
except RuntimeError:
    pass
assert c5.calls == 3, "1 initial + 2 retries"
PY
}
```

Wire into the runner (after the budget block) and into the canonical-parity chain:

```bash
if run_python_retry_tests; then
  echo "PASS: Python call_with_retry (deadline-aware, validators, no length retry)"; PASS=$((PASS+1))
else
  echo "FAIL: Python call_with_retry (deadline-aware, validators, no length retry)"; FAIL=$((FAIL+1))
fi
```

```bash
     && run_python_retry_tests "$CANON_TMP/kimi_review.py" \
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `bash .claude/hooks/test-kimi-review.sh 2>&1 | grep -E "call_with_retry|Results"`
Expected: `FAIL: Python call_with_retry ...` (symbols not defined yet).

- [ ] **Step 3: Implement in the canonical engine.** Edit `~/.local/share/claude-coworker/tools/kimi-review`.

(3a) Add `import time` to the top-level imports. Change:

```python
import argparse
import json
import os
import pathlib
import re
import subprocess
import sys
```

to:

```python
import argparse
import json
import os
import pathlib
import re
import subprocess
import sys
import time
```

(3b) Add the exception, retry helper, and validators. Insert immediately after `resolve_budget_seconds` (added in Task 1):

```python
RETRY_BASE_DELAY_SECONDS = 1.0


class BudgetExceeded(Exception):
    """Raised by call_with_retry when the global deadline is reached before a
    (re)try could start. Callers translate this into their fail-safe outcome
    (draft: tool-error exit; verify: keep_unverified)."""


def call_with_retry(client, *, validate=None, deadline=None, retries=2, base_delay=None, **kwargs):
    """Call client.chat.completions.create with bounded, deadline-aware retry.

    Retries on (a) any exception from the API call (connection/timeout/5xx/429
    and the malformed-200-body JSONDecodeError the SDK raises), and (b) a
    response the caller rejects via validate(resp) -> reason|None. Before each
    attempt, if the global deadline has passed, raise BudgetExceeded rather than
    starting another (possibly minute-long) call. After `retries` extra attempts
    the last error is raised. base_delay defaults to RETRY_BASE_DELAY_SECONDS so
    tests can pass 0 (or patch the module constant) and never sleep."""
    if base_delay is None:
        base_delay = RETRY_BASE_DELAY_SECONDS
    last_error = None
    for attempt in range(retries + 1):
        if deadline is not None and time.monotonic() >= deadline:
            raise BudgetExceeded("budget exhausted before model call")
        try:
            resp = client.chat.completions.create(**kwargs)
        except Exception as error:
            last_error = error
        else:
            reason = validate(resp) if validate else None
            if reason is None:
                return resp
            last_error = RuntimeError(reason)
        if attempt < retries:
            time.sleep(base_delay * (2 ** attempt))
    raise last_error if last_error else RuntimeError("call_with_retry: no attempts made")


def _draft_acceptable(resp):
    """Draft response is acceptable when it has content, OR it is a `length`
    truncation. We do NOT retry `length`: main fast-fails it at the
    finish_reason check, every retry re-bills the full prompt, and no observed
    failure was a length truncation."""
    ch = resp.choices[0]
    return None if (ch.message.content or ch.finish_reason == "length") else "empty draft content"


def _verdict_acceptable(resp):
    """Verdict response is acceptable when it has content; an empty verdict is a
    transient miss worth retrying (then keep_unverified if it persists)."""
    return None if resp.choices[0].message.content else "empty verdict content"
```

- [ ] **Step 4: Sync canonical → vendored.**

Run: `npm run -s kimi:engine:sync && npm run -s kimi:engine:check`
Expected: `vendored scripts/kimi-review.py matches canonical.`

- [ ] **Step 5: Run the test to verify it passes.**

Run: `bash .claude/hooks/test-kimi-review.sh 2>&1 | grep -E "call_with_retry|canonical engine|Results"`
Expected: `PASS: Python call_with_retry ...`, `PASS: canonical engine matches vendored behavior`, `Results: <N+2> passed, 0 failed`.

- [ ] **Step 6: Commit.**

```bash
git add scripts/kimi-review.py .claude/hooks/test-kimi-review.sh
git commit -m "feat(kimi): add deadline-aware call_with_retry + content validators"
```

---

## Task 3: `apply_downgrades` handles the `keep_unverified` verdict

**Files:**

- Modify: `~/.local/share/claude-coworker/tools/kimi-review` (canonical) → synced
- Test: `.claude/hooks/test-kimi-review.sh` (extend `run_python_monotonic_tests`)

- [ ] **Step 1: Write the failing test.** In `.claude/hooks/test-kimi-review.sh`, extend `run_python_monotonic_tests()` by appending these assertions immediately before its closing `PY` line (after the existing `out3` assertion):

```python
# keep_unverified: keeps CRITICAL but appends the budget-exhausted marker
ku = m.apply_downgrades(findings, {0: "keep_unverified"})
assert ku[0]["tier"] == "CRITICAL", "keep_unverified must keep CRITICAL"
assert "budget exhausted" in ku[0]["detail"], ku
# keep_unverified never promotes a WARNING and adds no marker to non-CRITICAL
warn_ku = m.apply_downgrades(warn, {0: "keep_unverified"})
assert warn_ku[0]["tier"] == "WARNING", "keep_unverified must not change a WARNING"
assert "budget exhausted" not in warn_ku[0]["detail"], warn_ku
```

(The `findings` and `warn` fixtures already exist in this function.)

- [ ] **Step 2: Run the test to verify it fails.**

Run: `bash .claude/hooks/test-kimi-review.sh 2>&1 | grep -E "apply_downgrades|Results"`
Expected: `FAIL: Python apply_downgrades is monotonic ...` (current code ignores `keep_unverified`, so no marker is appended → assertion fails).

- [ ] **Step 3: Implement in the canonical engine.** Edit `~/.local/share/claude-coworker/tools/kimi-review`. Replace the body of `apply_downgrades`:

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

with:

```python
def apply_downgrades(findings, verdicts):
    """Return a new findings list. 'downgrade' lowers CRITICAL→WARNING;
    'keep_unverified' keeps CRITICAL but appends a marker so a finding that
    blocked because verification could not complete is unambiguous (vs a
    genuinely-verified CRITICAL). MONOTONIC: never raises a tier, never adds or
    drops a finding; keep/keep_unverified never lower a tier."""
    out = []
    for i, f in enumerate(findings):
        g = dict(f)
        verdict = verdicts.get(i)
        if verdict == "downgrade" and g["tier"].upper() == "CRITICAL":
            g["tier"] = "WARNING"
            g["detail"] = g["detail"] + " [downgraded: unverified against code]"
        elif verdict == "keep_unverified" and g["tier"].upper() == "CRITICAL":
            g["detail"] = g["detail"] + " [kept: verification budget exhausted — re-run or review manually]"
        out.append(g)
    return out
```

- [ ] **Step 4: Sync canonical → vendored.**

Run: `npm run -s kimi:engine:sync && npm run -s kimi:engine:check`
Expected: `vendored scripts/kimi-review.py matches canonical.`

- [ ] **Step 5: Run the test to verify it passes.**

Run: `bash .claude/hooks/test-kimi-review.sh 2>&1 | grep -E "apply_downgrades|canonical engine|Results"`
Expected: `PASS: Python apply_downgrades is monotonic ...`, `PASS: canonical engine matches vendored behavior`, `Results: <N+2> passed, 0 failed` (no new test function, so the total is unchanged from Task 2's run).

- [ ] **Step 6: Commit.**

```bash
git add scripts/kimi-review.py .claude/hooks/test-kimi-review.sh
git commit -m "feat(kimi): apply_downgrades handles keep_unverified verdict + marker"
```

---

## Task 4: `verify_one_agentic` — deadline checks, retry, keep_unverified, never propagate

**Files:**

- Modify: `~/.local/share/claude-coworker/tools/kimi-review` (canonical) → synced
- Test: `.claude/hooks/test-kimi-review.sh` (new `run_python_verify_deadline_tests`)

- [ ] **Step 1: Write the failing test.** Add this function after `run_python_verifyloop_tests()`:

```bash
run_python_verify_deadline_tests() {
  local engine="${1:-$ROOT/scripts/kimi-review.py}"
  command -v python3 >/dev/null 2>&1 || { echo "python3 not found"; return 1; }
  python3 - "$engine" <<'PY'
import importlib.util, pathlib, sys, types, time, json
spec = importlib.util.spec_from_file_location("kimi_review", pathlib.Path(sys.argv[1]))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
m.RETRY_BASE_DELAY_SECONDS = 0  # no real sleeps (fresh process per heredoc)

def resp(content=None, tool_calls=None):
    msg = types.SimpleNamespace(content=content, tool_calls=tool_calls)
    return types.SimpleNamespace(choices=[types.SimpleNamespace(message=msg, finish_reason="stop")])

f = {"tier":"CRITICAL","claim_type":"semantic","file":"a.ts","line":1,"symbol":None,"detail":"x"}

# (a) deadline already past at turn-top -> keep_unverified, NO model call
class NeverCalled:
    def __init__(self): self.calls=0; self.chat=types.SimpleNamespace(completions=self)
    def create(self, **kw): self.calls += 1; return resp("x")
nc = NeverCalled()
assert m.verify_one_agentic(f, nc, model="x", root=".", max_turns=5, deadline=time.monotonic()-1) == "keep_unverified"
assert nc.calls == 0, "no model call once deadline passed"

# (b) pre-verdict deadline check (blocker D): tool-loop turn runs, but the
# deadline trips before the verdict call -> keep_unverified, verdict call NOT made.
# Drive m.time.monotonic deterministically: [turn-top<deadline, retry-precheck<deadline, pre-verdict>=deadline]
real = m.time.monotonic
class Clock:
    def __init__(self, seq): self.seq=list(seq); self.i=0
    def __call__(self):
        v = self.seq[min(self.i, len(self.seq)-1)]; self.i += 1; return v
m.time.monotonic = Clock([0, 0, 20])  # deadline = 10
class NoToolThenVerdict:
    def __init__(self): self.calls=0; self.chat=types.SimpleNamespace(completions=self)
    def create(self, **kw):
        self.calls += 1
        # first (and only expected) call: a turn with no tool_calls -> ready for verdict
        return resp(content="ignored-at-this-stage")
try:
    ntv = NoToolThenVerdict()
    out = m.verify_one_agentic(f, ntv, model="x", root=".", max_turns=5, deadline=10)
    assert out == "keep_unverified", out
    assert ntv.calls == 1, f"only the tool-loop turn ran; verdict call must be skipped, got {ntv.calls}"
finally:
    m.time.monotonic = real

# (c) any persistent failure is swallowed -> keep_unverified (never propagates)
class AlwaysRaise:
    def __init__(self): self.calls=0; self.chat=types.SimpleNamespace(completions=self)
    def create(self, **kw): self.calls += 1; raise RuntimeError("api down")
assert m.verify_one_agentic(f, AlwaysRaise(), model="x", root=".", max_turns=5, deadline=None) == "keep_unverified"

# (d) unparseable verdict -> keep_unverified (changed from legacy 'downgrade')
class BadVerdict:
    def __init__(self): self.calls=0; self.chat=types.SimpleNamespace(completions=self)
    def create(self, **kw):
        self.calls += 1
        return resp(content="not json at all")
assert m.verify_one_agentic(f, BadVerdict(), model="x", root=".", max_turns=5, deadline=None) == "keep_unverified"

# (e) regression guard: a parsed 'refuted' verdict still downgrades; 'verified' still keeps
class Refuted:
    def __init__(self): self.calls=0; self.chat=types.SimpleNamespace(completions=self)
    def create(self, **kw):
        self.calls += 1
        return resp(content=json.dumps({"verdict":"refuted","corrected_detail":"x","confidence":0.9}))
assert m.verify_one_agentic(f, Refuted(), model="x", root=".", max_turns=5, deadline=None) == "downgrade"
class Verified:
    def __init__(self): self.calls=0; self.chat=types.SimpleNamespace(completions=self)
    def create(self, **kw):
        self.calls += 1
        return resp(content=json.dumps({"verdict":"verified","corrected_detail":"x","confidence":0.9}))
assert m.verify_one_agentic(f, Verified(), model="x", root=".", max_turns=5, deadline=None) == "keep"
PY
}
```

Wire into the runner (after the verifyloop block, ~line 688) and the canonical-parity chain:

```bash
if run_python_verify_deadline_tests; then
  echo "PASS: Python verify_one_agentic deadline + keep_unverified + swallow"; PASS=$((PASS+1))
else
  echo "FAIL: Python verify_one_agentic deadline + keep_unverified + swallow"; FAIL=$((FAIL+1))
fi
```

```bash
     && run_python_verify_deadline_tests "$CANON_TMP/kimi_review.py" \
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `bash .claude/hooks/test-kimi-review.sh 2>&1 | grep -E "verify_one_agentic deadline|Results"`
Expected: `FAIL` — the current `verify_one_agentic` has no `deadline` param behavior, calls `client...create` directly (case (a) would make a call), and returns `downgrade` (not `keep_unverified`) for bad verdicts.

- [ ] **Step 3: Implement in the canonical engine.** Edit `~/.local/share/claude-coworker/tools/kimi-review`. Replace the entire `verify_one_agentic` function with:

```python
def verify_one_agentic(finding, client, model, root, max_turns=5, tree_ref=None, deadline=None):
    """Bounded read-only verify loop for one finding. Returns:
      'keep'            verified (claim holds);
      'downgrade'       refuted or uncertain (a completed verdict);
      'keep_unverified' verification did not complete (deadline/budget hit,
                        retries exhausted, turns exhausted, or unparseable/unknown
                        verdict) — keep + notify.
    MONOTONIC: 'downgrade' only lowers CRITICAL→WARNING; keep/keep_unverified
    never lower. Never propagates an exception, so verify_agentic's fut.result()
    cannot raise. tree_ref selects which git tree the read-only tools see."""
    messages = [
        {"role": "system", "content": VERIFY_SYSTEM},
        {"role": "user", "content": "Finding to verify:\n" + json.dumps(finding)},
    ]
    try:
        for _ in range(max_turns):
            if deadline is not None and time.monotonic() >= deadline:
                return "keep_unverified"
            resp = call_with_retry(
                client, validate=None, deadline=deadline,
                model=model, messages=messages, temperature=0, tools=TOOL_DEFS)
            msg = resp.choices[0].message
            tool_calls = getattr(msg, "tool_calls", None)
            if tool_calls:
                messages.append({"role": "assistant", "content": msg.content or "",
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
            # Ready for the verdict — re-check the deadline first (blocker D: this
            # is the second model call in the turn; a single turn-top check would
            # let it overrun by ~2x the per-call timeout).
            if deadline is not None and time.monotonic() >= deadline:
                return "keep_unverified"
            verdict_resp = call_with_retry(
                client, validate=_verdict_acceptable, deadline=deadline,
                model=model, messages=messages + [
                    {"role": "user", "content": "Now return your verdict as JSON."}],
                temperature=0,
                response_format={"type": "json_schema",
                                 "json_schema": {"name": "verify", "strict": True, "schema": VERIFY_SCHEMA}})
            try:
                v = json.loads(verdict_resp.choices[0].message.content)
            except (ValueError, TypeError):
                return "keep_unverified"
            verdict = v.get("verdict")
            if verdict == "verified":
                return "keep"
            if verdict in ("refuted", "uncertain"):
                return "downgrade"
            return "keep_unverified"  # unknown/missing verdict value
        return "keep_unverified"  # turns exhausted without a verdict
    except BudgetExceeded:
        return "keep_unverified"
    except Exception:
        # Any unrecoverable verify failure: never propagate — fail safe toward
        # keeping the CRITICAL for human review (the user chose keep-on-deadline).
        return "keep_unverified"
```

- [ ] **Step 4: Sync canonical → vendored.**

Run: `npm run -s kimi:engine:sync && npm run -s kimi:engine:check`
Expected: `vendored scripts/kimi-review.py matches canonical.`

- [ ] **Step 5: Run the test to verify it passes (and existing verify tests still pass).**

Run: `bash .claude/hooks/test-kimi-review.sh 2>&1 | grep -E "verify_one_agentic deadline|verify_one_agentic \+ verify_agentic|canonical engine|Results"`
Expected: `PASS: Python verify_one_agentic deadline + keep_unverified + swallow`, `PASS: Python verify_one_agentic + verify_agentic bounded loop (Tier B)` (unchanged behavior for parsed verdicts), `PASS: canonical engine matches vendored behavior`, `Results: <N+3> passed, 0 failed`.

- [ ] **Step 6: Commit.**

```bash
git add scripts/kimi-review.py .claude/hooks/test-kimi-review.sh
git commit -m "feat(kimi): deadline-bound verify_one_agentic, keep_unverified on incomplete verify"
```

---

## Task 5: `verify_agentic` — global deadline, prompt return, harvest-gap fix

**Files:**

- Modify: `~/.local/share/claude-coworker/tools/kimi-review` (canonical) → synced
- Test: `.claude/hooks/test-kimi-review.sh` (new `run_python_verify_budget_tests`)

- [ ] **Step 1: Write the failing test.** Add this function after `run_python_verify_deadline_tests()`:

```bash
run_python_verify_budget_tests() {
  local engine="${1:-$ROOT/scripts/kimi-review.py}"
  command -v python3 >/dev/null 2>&1 || { echo "python3 not found"; return 1; }
  python3 - "$engine" <<'PY'
import importlib.util, pathlib, sys, time, concurrent.futures
spec = importlib.util.spec_from_file_location("kimi_review", pathlib.Path(sys.argv[1]))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

# (a) blocker E harvest helper: a DONE future keeps its real verdict;
#     a pending one is kept-unverified. Deterministic with real Futures.
done = concurrent.futures.Future(); done.set_result("downgrade")
pending = concurrent.futures.Future()
assert m._harvest_verdict(done) == "downgrade", "done future must keep its real verdict"
assert m._harvest_verdict(pending) == "keep_unverified", "pending future -> keep_unverified"

# (b) deadline behavior + prompt return: a slow verify must NOT keep
# verify_agentic blocked; the unfinished CRITICAL becomes keep_unverified.
def slow_voa(finding, client, model, root, max_turns=5, tree_ref=None, deadline=None):
    time.sleep(3); return "keep"
m.verify_one_agentic = slow_voa
f1 = {"tier":"CRITICAL","claim_type":"semantic","file":"a.ts","line":1,"symbol":None,"detail":"d"}
t0 = time.monotonic()
vs = m.verify_agentic([f1], client=None, model="x", root=".", jobs=2, deadline=time.monotonic()+0.2)
elapsed = time.monotonic() - t0
assert vs == ["keep_unverified"], vs
assert elapsed < 2.5, f"verify_agentic must return promptly (shutdown wait=False), took {elapsed:.2f}s"

# (c) non-CRITICAL is never targeted and stays 'keep'
def keep_voa(finding, client, model, root, max_turns=5, tree_ref=None, deadline=None):
    return "keep"
m.verify_one_agentic = keep_voa
fw = {"tier":"WARNING","claim_type":"semantic","file":"a.ts","line":1,"symbol":None,"detail":"w"}
vs2 = m.verify_agentic([fw], client=None, model="x", root=".", deadline=time.monotonic()+5)
assert vs2 == ["keep"], vs2
PY
}
```

Wire into the runner (after the verify-deadline block) and the canonical-parity chain:

```bash
if run_python_verify_budget_tests; then
  echo "PASS: Python verify_agentic global budget + harvest gap (blocker E)"; PASS=$((PASS+1))
else
  echo "FAIL: Python verify_agentic global budget + harvest gap (blocker E)"; FAIL=$((FAIL+1))
fi
```

```bash
     && run_python_verify_budget_tests "$CANON_TMP/kimi_review.py" \
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `bash .claude/hooks/test-kimi-review.sh 2>&1 | grep -E "verify_agentic global budget|Results"`
Expected: `FAIL` — `_harvest_verdict` does not exist and `verify_agentic` has no `deadline` handling.

- [ ] **Step 3: Implement in the canonical engine.** Edit `~/.local/share/claude-coworker/tools/kimi-review`.

(3a) Add the harvest helper immediately before `verify_agentic`:

```python
def _harvest_verdict(fut):
    """Resolve a future's verdict after the waiter has timed out. A future that
    already completed keeps its real result (blocker E: as_completed may time
    out before yielding an already-done future); an unfinished one is
    kept-unverified. fut.result() never raises here — verify_one_agentic always
    returns a verdict string and swallows its own exceptions."""
    return fut.result() if fut.done() else "keep_unverified"
```

(3b) Replace the entire `verify_agentic` function with:

```python
def verify_agentic(findings, client, model, root, max_turns=5, jobs=4, tree_ref=None, deadline=None):
    """Verify all CRITICAL findings in parallel; non-CRITICAL always 'keep'.
    Bounded by the global `deadline`: when the waiter times out, finished futures
    keep their real verdict (via _harvest_verdict) and unfinished CRITICALs become
    'keep_unverified' (keep-on-deadline). shutdown(wait=False, cancel_futures=True)
    lets this return promptly; the per-turn/pre-verdict deadline checks in
    verify_one_agentic let the worker threads exit so the process can exit."""
    import concurrent.futures
    verdicts = ["keep"] * len(findings)
    targets = [i for i, f in enumerate(findings) if f["tier"].upper() == "CRITICAL"]
    if not targets:
        return verdicts
    ex = concurrent.futures.ThreadPoolExecutor(max_workers=max(1, jobs))
    try:
        futs = {ex.submit(verify_one_agentic, findings[i], client, model, root,
                          max_turns, tree_ref, deadline): i for i in targets}
        remaining = (deadline - time.monotonic()) if deadline is not None else None
        try:
            for fut in concurrent.futures.as_completed(futs, timeout=remaining):
                verdicts[futs[fut]] = fut.result()
        except concurrent.futures.TimeoutError:
            for fut, i in futs.items():
                verdicts[i] = _harvest_verdict(fut)
    finally:
        ex.shutdown(wait=False, cancel_futures=True)
    return verdicts
```

- [ ] **Step 4: Sync canonical → vendored.**

Run: `npm run -s kimi:engine:sync && npm run -s kimi:engine:check`
Expected: `vendored scripts/kimi-review.py matches canonical.`

- [ ] **Step 5: Run the test to verify it passes.**

Run: `bash .claude/hooks/test-kimi-review.sh 2>&1 | grep -E "verify_agentic global budget|canonical engine|Results"`
Expected: `PASS: Python verify_agentic global budget + harvest gap (blocker E)`, `PASS: canonical engine matches vendored behavior`, `Results: <N+4> passed, 0 failed`.

- [ ] **Step 6: Commit.**

```bash
git add scripts/kimi-review.py .claude/hooks/test-kimi-review.sh
git commit -m "feat(kimi): verify_agentic global deadline + prompt shutdown + harvest-gap fix"
```

---

## Task 6: Wire the global deadline + retry into `main()` and tune the client

**Files:**

- Modify: `~/.local/share/claude-coworker/tools/kimi-review` (canonical) → synced
- Verify: full harness + a smoke import (main() is I/O glue, validated by integration not a new unit test)

- [ ] **Step 1: Edit the client construction.** In `~/.local/share/claude-coworker/tools/kimi-review`, change:

```python
    client = OpenAI(
        api_key=api_key,
        base_url=base_url,
        timeout=90.0,
    )
```

to:

```python
    client = OpenAI(
        api_key=api_key,
        base_url=base_url,
        timeout=90.0,        # unchanged: lowering it would turn slow-but-valid calls into failures
        max_retries=0,       # call_with_retry owns retry; avoid compounding SDK retries
    )

    # One global wall-clock deadline for draft + verify combined. Time the draft
    # spends on retries shrinks the verify window rather than extending the clock,
    # so the total can never exceed the budget + one in-flight call.
    deadline = time.monotonic() + resolve_budget_seconds()
```

- [ ] **Step 2: Route the draft call through `call_with_retry`.** Replace:

```python
    try:
        response = client.chat.completions.create(
            model=args.model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_msg},
            ],
            max_tokens=args.max_tokens,
            temperature=0,
            response_format={
                "type": "json_schema",
                "json_schema": {"name": "kimi_findings", "strict": True, "schema": FINDING_SCHEMA},
            },
        )
    except Exception as error:
        print(f"[ERROR: kimi-review request failed: {error}]", file=sys.stderr)
        sys.exit(1)
```

with:

```python
    try:
        response = call_with_retry(
            client,
            validate=_draft_acceptable,
            deadline=deadline,
            model=args.model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_msg},
            ],
            max_tokens=args.max_tokens,
            temperature=0,
            response_format={
                "type": "json_schema",
                "json_schema": {"name": "kimi_findings", "strict": True, "schema": FINDING_SCHEMA},
            },
        )
    except Exception as error:
        # Includes BudgetExceeded and retries-exhausted: the draft could not
        # complete -> tool-error exit (CI fails closed, which is correct).
        print(f"[ERROR: kimi-review request failed: {error}]", file=sys.stderr)
        sys.exit(1)
```

(The downstream `finish_reason == "length"` fast-fail and `if not answer` checks are unchanged and still catch a final truncated/empty response.)

- [ ] **Step 3: Pass the deadline into the agentic verify call.** Change:

```python
        head_ref = os.environ.get("KIMI_REVIEW_HEAD_SHA") or None
        verdicts = verify_agentic(findings, client, args.model, root, tree_ref=head_ref)
```

to:

```python
        head_ref = os.environ.get("KIMI_REVIEW_HEAD_SHA") or None
        verdicts = verify_agentic(findings, client, args.model, root, tree_ref=head_ref, deadline=deadline)
```

- [ ] **Step 4: Sync canonical → vendored.**

Run: `npm run -s kimi:engine:sync && npm run -s kimi:engine:check`
Expected: `vendored scripts/kimi-review.py matches canonical.`

- [ ] **Step 5: Smoke-check the module loads and exposes the new symbols, and argparse still works.**

Run:

```bash
python3 scripts/kimi-review.py --help >/dev/null && echo "argparse-ok"
python3 - scripts/kimi-review.py <<'PY'
import importlib.util, pathlib, sys
s = importlib.util.spec_from_file_location("k", pathlib.Path(sys.argv[1]))
m = importlib.util.module_from_spec(s); s.loader.exec_module(m)
for name in ("resolve_budget_seconds","call_with_retry","BudgetExceeded","_harvest_verdict","_draft_acceptable","_verdict_acceptable"):
    assert hasattr(m, name), name
print("symbols-ok")
PY
```

Expected: `argparse-ok` then `symbols-ok` (proves no syntax error and main() references resolve correctly).

- [ ] **Step 6: Run the full harness to confirm no regressions.**

Run: `bash .claude/hooks/test-kimi-review.sh`
Expected: `Results: <N+4> passed, 0 failed`.

- [ ] **Step 7: Commit.**

```bash
git add scripts/kimi-review.py
git commit -m "feat(kimi): thread global deadline + retry into main, set client max_retries=0"
```

---

## Task 7: Raise the CI hard-timeout backstop 300 → 480

**Files:**

- Modify: `scripts/ci-kimi-review.sh:28`

- [ ] **Step 1: Edit the default.** In `scripts/ci-kimi-review.sh`, change:

```bash
timeout_seconds="${KIMI_REVIEW_TIMEOUT_SECONDS:-300}"
```

to:

```bash
# Backstop only: the engine's internal global budget (KIMI_REVIEW_BUDGET_SECONDS,
# default 330) trips first and emits a clean verdict. 480 >= 330 + 90 (one
# in-flight call) + margin, so a slow verify ends gracefully instead of SIGTERM.
timeout_seconds="${KIMI_REVIEW_TIMEOUT_SECONDS:-480}"
```

- [ ] **Step 2: Verify the change.**

Run: `grep -n 'KIMI_REVIEW_TIMEOUT_SECONDS:-480' scripts/ci-kimi-review.sh`
Expected: one match on line 28.

- [ ] **Step 3: Confirm harness still green (it exercises the CI wrapper too).**

Run: `bash .claude/hooks/test-kimi-review.sh 2>&1 | tail -1`
Expected: `Results: <N+4> passed, 0 failed`.

- [ ] **Step 4: Commit.**

```bash
git add scripts/ci-kimi-review.sh
git commit -m "feat(kimi): raise CI hard-timeout backstop 300->480 (internal budget trips first)"
```

---

## Task 8: Update the architecture doc (single source of truth)

**Files:**

- Modify: `docs/kimi-review-architecture.md`

- [ ] **Step 1: §5 Config — add the budget env and correct the timeout.** In the "Model and base URL" / "Review flags" area of §5, add a row documenting:
  - `KIMI_REVIEW_BUDGET_SECONDS` (default `330`) — global soft wall-clock budget for draft + agentic verify combined; the engine computes one monotonic deadline = start + this, threaded into `call_with_retry` and the verify loop.
  - Note the client is now `timeout=90.0, max_retries=0` (the engine owns retry via `call_with_retry`).

- [ ] **Step 2: §5/§6 — document the two-layer timeout.** Add a sentence: the CI wrapper's `KIMI_REVIEW_TIMEOUT_SECONDS` default is now `480` and is a pure backstop; the internal global budget (330) trips first and emits a real verdict + exit code. Invariant: `backstop ≥ budget + client_timeout + margin`.

- [ ] **Step 3: §8 — update the verdict vocabulary and verify modes.** Replace the legacy statement that "refuted, uncertain, turn-exhaustion, or malformed verdict → downgrade" with the three-token model:
  - `verified` → keep (blocks CI);
  - `refuted` / `uncertain` (a _completed, parsed_ verdict) → downgrade to WARNING;
  - verification did **not** complete (deadline/budget hit, retries exhausted, turns exhausted, unparseable/unknown verdict) → **`keep_unverified`**: stays CRITICAL (blocks + notifies) with the appended marker `[kept: verification budget exhausted — re-run or review manually]`.
  - Note `call_with_retry` retries transient API errors + empty content (but never `length` truncation), and `verify_one_agentic` never propagates an exception.
  - Note `verify_agentic` uses `shutdown(wait=False, cancel_futures=True)` and harvests already-done futures on deadline; the process may linger up to one in-flight call (~90s) after the verdict prints (non-daemon worker threads) — expected, not a hang.

- [ ] **Step 4: Bump the `Last updated` date** at the top of `docs/kimi-review-architecture.md` to `2026-05-29` and add a one-line pointer to this spec under "Design spec".

- [ ] **Step 5: Commit.**

```bash
git add docs/kimi-review-architecture.md
git commit -m "docs(kimi): document global budget, keep_unverified verdict, 480 backstop"
```

---

## Task 9: Wrap-up — local-suite mirror, final parity, branch finalize

**Files:**

- Modify (local-only, not in git): `~/.local/share/claude-coworker/tools/test-kimi-review.py`

- [ ] **Step 1: Mirror the new assertions into the local canonical test suite.** Append to `~/.local/share/claude-coworker/tools/test-kimi-review.py` direct-call assertions for the new behavior (this file imports the canonical engine as a module `m`):

```python
# --- reliability hardening (2026-05-29) ---
import time as _t, concurrent.futures as _cf, types as _ty
assert m.resolve_budget_seconds({}) == 330
assert m.resolve_budget_seconds({"KIMI_REVIEW_BUDGET_SECONDS": "0"}) == 330
def _r(content, fr="stop"):
    msg = _ty.SimpleNamespace(content=content, tool_calls=None)
    return _ty.SimpleNamespace(choices=[_ty.SimpleNamespace(message=msg, finish_reason=fr)])
assert m._draft_acceptable(_r("")) is not None
assert m._draft_acceptable(_r("", fr="length")) is None
_d = _cf.Future(); _d.set_result("downgrade")
assert m._harvest_verdict(_d) == "downgrade"
assert m._harvest_verdict(_cf.Future()) == "keep_unverified"
_ku = m.apply_downgrades(
    [{"tier":"CRITICAL","claim_type":"semantic","file":"a.ts","line":1,"symbol":None,"detail":"d"}],
    {0: "keep_unverified"})
assert _ku[0]["tier"] == "CRITICAL" and "budget exhausted" in _ku[0]["detail"]
print("reliability hardening assertions OK")
```

- [ ] **Step 2: Run the local canonical test suite.**

Run: `python3 ~/.local/share/claude-coworker/tools/test-kimi-review.py`
Expected: existing output plus `reliability hardening assertions OK`, exit 0.

- [ ] **Step 3: Final parity + full harness.**

Run:

```bash
npm run -s kimi:engine:sync && npm run -s kimi:engine:check && bash .claude/hooks/test-kimi-review.sh | tail -3
```

Expected: `vendored scripts/kimi-review.py matches canonical.`, `PASS: canonical engine matches vendored behavior`, `Results: <N+4> passed, 0 failed`.

- [ ] **Step 4: Confirm the working tree is clean and review the full branch diff.**

Run:

```bash
git status --porcelain
git --no-pager diff main...HEAD --stat
```

Expected: clean working tree; the stat shows only `scripts/kimi-review.py`, `scripts/ci-kimi-review.sh`, `.claude/hooks/test-kimi-review.sh`, `docs/kimi-review-architecture.md`.

- [ ] **Step 5: Push and open a PR (this triggers the real CI Kimi Review job — the live confirmation).**

```bash
git push -u origin fix/2026-05-29-kimi-ci-reliability
```

Then open a PR. Because the PR diff has no `.ts`/`.tsx` changes, the CI Kimi Review job exits early ("No TypeScript diff for kimi-review.") — confirming the wrapper path is intact. To exercise the engine end-to-end, monitor the next real `.ts`-touching PR's Kimi Review run, or re-run a previously-failing run; it should no longer crash on empty/timeout.

---

## Self-Review

**Spec coverage** (each spec §4 component → task):

- §4.0 global deadline → Task 1 (`resolve_budget_seconds`) + Task 6 (compute + thread).
- §4(a) deadline-aware `call_with_retry` + validators (empty-only, not `length`) → Task 2.
- §4(b) verify deadline (turn-top + pre-verdict), swallow → keep_unverified; `verify_agentic` try/finally + `shutdown(wait=False)` + harvest gap → Tasks 4 & 5.
- §4(b.1) three-token verdict vocabulary + marker → Task 3 (`apply_downgrades`) + Task 4 (verdict routing).
- §4(c) client `max_retries=0`, timeout stays 90 → Task 6.
- §4(d) backstop 300→480 → Task 7.
- §5 exit-code contract preserved (keep_unverified → CRITICAL → exit 2) → Task 4 routing + existing `main():619`.
- §6 tests (A/C/D/E + existing) → Tasks 1–5; §7 rollout (sync, both suites, cross-project note, blocker F) → Tasks 4/5/8/9.

**Placeholder scan:** no TBD/TODO; every code/test step has complete code and an exact command with expected output.

**Type/name consistency:** symbol names are consistent across tasks — `resolve_budget_seconds`, `BudgetExceeded`, `call_with_retry`, `RETRY_BASE_DELAY_SECONDS`, `_draft_acceptable`, `_verdict_acceptable`, `_harvest_verdict`, verdict tokens `keep`/`downgrade`/`keep_unverified`. `verify_one_agentic(finding, client, model, root, max_turns=5, tree_ref=None, deadline=None)` and `verify_agentic(findings, client, model, root, max_turns=5, jobs=4, tree_ref=None, deadline=None)` signatures match their call sites in Task 5 (`ex.submit(... max_turns, tree_ref, deadline)`) and Task 6 (`deadline=deadline`).
