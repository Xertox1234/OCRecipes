# Kimi False-Positive Prevention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut false-positive CRITICAL findings from the `kimi-review` gate by giving the reviewer enough context to stop hallucinating absences, plus making its verdicts deterministic.

**Architecture:** One shared review engine, duplicated in two hand-synced copies (`~/.local/bin/kimi-review`, `scripts/kimi-review.py`), is invoked by three wrapper surfaces (Claude-Code PreToolUse hook, Husky pre-commit, CI job). The fix adds a `<changed-files>` manifest and function-level diff context to what the engine receives, sets `temperature=0`, hardens the system prompt against "hallucinated absence" findings, and fixes the manual `--base` diff to use the merge base. No engine consolidation, no second LLM pass.

**Tech Stack:** Python 3 (engine, via the OpenAI SDK against OpenRouter), Bash (wrappers + test harness), git plumbing (`git diff --function-context`, `--name-status`, three-dot refs).

**Spec:** `docs/superpowers/specs/2026-05-18-kimi-false-positive-prevention-design.md`

**Branch:** Work on `docs/kimi-fp-prevention-spec` (already checked out; the spec lives here).

**Note on the unversioned engine copy:** `~/.local/bin/kimi-review` and `~/.local/bin/test-kimi-review.py` are NOT in any git repo. Edit them in place. They must stay byte-for-byte equivalent in logic to `scripts/kimi-review.py` (the in-repo CI copy). The final report must call out that the local copies were changed outside the repo.

**Committing:** The Husky pre-commit and Claude-Code hooks run `kimi-review` on staged `.ts`/`.tsx`. This plan touches no `.ts`/`.tsx`, so the gate auto-skips — normal `git commit` is fine. If a commit ever stalls on the gate, prefix with `SKIP_KIMI_REVIEW=1` (works for Husky; for the Claude-Code hook the user runs the commit in their terminal).

---

## File Structure

| File                                | Responsibility                                            | Change                                                                                                       |
| ----------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `~/.local/bin/kimi-review`          | Local engine (unversioned)                                | Add `render_changed_files` + `build_diff_ref` helpers; wire into `main()`; `temperature=0`; prompt hardening |
| `scripts/kimi-review.py`            | CI engine (in-repo, hand-synced)                          | Identical changes                                                                                            |
| `.claude/hooks/kimi-review.sh`      | Claude-Code PreToolUse wrapper                            | `--function-context` diff; dedicated `--name-status` capture; pass `--changed-files`                         |
| `.husky/pre-commit`                 | Husky wrapper                                             | Same wrapper changes                                                                                         |
| `scripts/ci-kimi-review.sh`         | CI wrapper                                                | Same wrapper changes                                                                                         |
| `~/.local/bin/test-kimi-review.py`  | Local engine unit tests (unversioned)                     | New cases for the two helpers                                                                                |
| `.claude/hooks/test-kimi-review.sh` | In-repo harness (wrappers + embedded Python engine tests) | New stub mode + bash cases for `--changed-files`; new embedded Python helper cases                           |
| `docs/kimi-review-architecture.md`  | NEW — single source of truth for the whole system         | Written last                                                                                                 |

---

## Task 0: Confirm `temperature=0` is accepted (fail-fast gate)

DeepSeek V4 Flash is a reasoning model; reasoning models sometimes reject
`temperature`. Verify before building anything that depends on it. **No code
changes, no commit** — this is a go/no-go check.

**Files:** none.

- [ ] **Step 1: Make one real `temperature=0` call**

Requires `WORKER_API_KEY` or `OPENROUTER_API_KEY` in the environment (the same
credential the gate uses). Run:

```bash
python3 - <<'PY'
import os
from openai import OpenAI
key = os.environ.get("WORKER_API_KEY") or os.environ.get("OPENROUTER_API_KEY")
assert key, "set WORKER_API_KEY or OPENROUTER_API_KEY first"
c = OpenAI(api_key=key, base_url=os.environ.get("WORKER_BASE_URL", "https://openrouter.ai/api/v1"))
r = c.chat.completions.create(
    model=os.environ.get("WORKER_MODEL", "deepseek/deepseek-v4-flash"),
    temperature=0, max_tokens=10,
    messages=[{"role": "user", "content": "reply with the word ok"}],
)
print("ACCEPTED:", r.choices[0].finish_reason, "|", (r.choices[0].message.content or "").strip())
PY
```

- [ ] **Step 2: Decide the branch**

Expected: prints `ACCEPTED: ...`. → Proceed with the plan as written
(`temperature=0` stays in Task 2).

If it raises an error mentioning `temperature` (HTTP 400): the model rejects it.
**Do this:** in Task 2 omit the `temperature=0` line everywhere, and in the spec
soften §4 to "prompt hardening only; temperature not supported by the model."
Then continue with all other tasks unchanged. Record the outcome in the final
report either way.

---

## Task 1: Engine helpers — `render_changed_files` + `build_diff_ref`

Two pure functions, unit-tested first. Implemented identically in both engine
copies. These are the only new testable seams; the rest of the engine change
(Task 2) is inline integration verified by the harness + smoke tests.

**Files:**

- Modify: `~/.local/bin/kimi-review` (add helpers near `filter_review`, ~line 76)
- Modify: `scripts/kimi-review.py` (add helpers near `filter_review`, ~line 196)
- Test: `~/.local/bin/test-kimi-review.py`
- Test: `.claude/hooks/test-kimi-review.sh` (embedded Python block)

- [ ] **Step 1: Write the failing tests in `~/.local/bin/test-kimi-review.py`**

After the existing `filter_review = _module.filter_review` binding (line 17),
add two more bindings and a block of cases. Insert these bindings right after
line 17:

```python
render_changed_files = _module.render_changed_files
build_diff_ref = _module.build_diff_ref
```

Then append these cases after the last existing `case(...)` (after line 94):

```python
# render_changed_files: empty / None -> empty string (no block emitted)
case("changed-files: empty string -> ''", render_changed_files(""), "")
case("changed-files: None -> ''", render_changed_files(None), "")

# render_changed_files: name-status lines wrapped verbatim in a block
case(
    "changed-files: name-status lines wrapped",
    render_changed_files("M\tshared/schema.ts\nA\tmigrations/0043.sql"),
    "<changed-files>\nM\tshared/schema.ts\nA\tmigrations/0043.sql\n</changed-files>",
)

# render_changed_files: blank lines are skipped
case(
    "changed-files: blank lines skipped",
    render_changed_files("M\ta.ts\n\n"),
    "<changed-files>\nM\ta.ts\n</changed-files>",
)

# build_diff_ref: a base produces a three-dot (merge-base) ref
case("diff-ref: base -> three-dot", build_diff_ref("main"), "main...HEAD")

# build_diff_ref: no base falls back to the single-commit ref
case("diff-ref: no base -> HEAD~1", build_diff_ref(None), "HEAD~1")
```

- [ ] **Step 2: Run the local test to verify it fails**

Run: `python3 ~/.local/bin/test-kimi-review.py`
Expected: FAIL at import — `AttributeError: module 'kimi_review' has no attribute 'render_changed_files'` (the binding on the new line 18 fails before any case runs).

- [ ] **Step 3: Implement the helpers in `~/.local/bin/kimi-review`**

Insert immediately after the `filter_review` function (after line 75, before
`def main():`):

```python
def render_changed_files(changed_files):
    """Render a <changed-files> block from newline-delimited `git diff
    --name-status` output. Lists every file in the change-set (names only, no
    content) so the reviewer knows which non-.ts/.tsx files exist and does not
    false-flag them as missing. Returns '' when nothing is provided."""
    if not changed_files:
        return ""
    entries = [line.rstrip() for line in changed_files.splitlines() if line.strip()]
    if not entries:
        return ""
    body = "\n".join(entries)
    return f"<changed-files>\n{body}\n</changed-files>"


def build_diff_ref(base):
    """Diff ref for the engine's own `git diff`. Three-dot (merge-base..HEAD)
    when a base is given, so a branch behind its base does not surface the
    base's commits as deletions; single-commit fallback otherwise."""
    return f"{base}...HEAD" if base else "HEAD~1"
```

- [ ] **Step 4: Run the local test to verify it passes**

Run: `python3 ~/.local/bin/test-kimi-review.py`
Expected: PASS — `14/14 passed` (8 existing + 6 new).

- [ ] **Step 5: Mirror the helpers into `scripts/kimi-review.py`**

Insert the identical two functions immediately after `filter_review` (after
line 221, before `def main():`). Copy the exact code from Step 3.

- [ ] **Step 6: Add embedded Python helper tests to `.claude/hooks/test-kimi-review.sh`**

The harness already has `run_python_filter_tests()` (line 123) that loads
`scripts/kimi-review.py` and exercises `filter_review`. Add a parallel function
right after it (after line 158). Insert:

```bash
run_python_helper_tests() {
  command -v python3 >/dev/null 2>&1 || {
    echo "python3 not found"
    return 1
  }
  python3 - "$ROOT/scripts/kimi-review.py" <<'PY'
import importlib.util
import pathlib
import sys

module_path = pathlib.Path(sys.argv[1])
spec = importlib.util.spec_from_file_location("kimi_review", module_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

rcf = module.render_changed_files
bdr = module.build_diff_ref

cases = [
    (rcf(""), ""),
    (rcf(None), ""),
    (
        rcf("M\tshared/schema.ts\nA\tmigrations/0043.sql"),
        "<changed-files>\nM\tshared/schema.ts\nA\tmigrations/0043.sql\n</changed-files>",
    ),
    (rcf("M\ta.ts\n\n"), "<changed-files>\nM\ta.ts\n</changed-files>"),
    (bdr("main"), "main...HEAD"),
    (bdr(None), "HEAD~1"),
]

for actual, expected in cases:
    if actual != expected:
        raise AssertionError(f"expected {expected!r}, got {actual!r}")
PY
}
```

Then register it next to the other Python test invocations. After the
`run_python_credential_tests` block (after line 404), add:

```bash
if run_python_helper_tests; then
  echo "PASS: Python render_changed_files + build_diff_ref helpers"
  PASS=$((PASS+1))
else
  echo "FAIL: Python render_changed_files + build_diff_ref helpers"
  FAIL=$((FAIL+1))
fi
```

- [ ] **Step 7: Run the harness to verify it passes**

Run: `bash .claude/hooks/test-kimi-review.sh`
Expected: PASS — final line `Results: N passed, 0 failed` (N = old count + 1).

- [ ] **Step 8: Commit**

```bash
git add scripts/kimi-review.py .claude/hooks/test-kimi-review.sh
git commit -m "feat(kimi): add render_changed_files + build_diff_ref engine helpers"
```

(The `~/.local/bin/*` copies are unversioned and not staged; they were edited in
place in Steps 1, 3 and verified in Step 4.)

---

## Task 2: Engine integration — wire helpers into `main()`

Add the `--changed-files` argument, render the manifest into the user message,
use `build_diff_ref` + `--function-context` for the engine's own diff, set
`temperature=0`, and harden the system prompt. Applied identically to both
engine copies. Verified by re-running the harness (no regression) — the inline
behavior is exercised end-to-end by the Task 4 smoke tests.

**Files:**

- Modify: `~/.local/bin/kimi-review`
- Modify: `scripts/kimi-review.py`

### `~/.local/bin/kimi-review`

- [ ] **Step 1: Add the `--changed-files` argument**

After the `--rules` argument block (after line 108, before `--profile`), add:

```python
    p.add_argument(
        "--changed-files",
        default=None,
        help="Newline-delimited `git diff --name-status` output for the full "
             "change-set; rendered as a <changed-files> block so the reviewer "
             "knows which non-.ts/.tsx files (migrations, config) exist.",
    )
```

- [ ] **Step 2: Use `build_diff_ref` + `--function-context` for the fallback diff**

Replace the ref construction and git diff (lines 148-152):

```python
        ref = f"{args.base}..HEAD" if args.base else "HEAD~1"
        result = subprocess.run(
            ["git", "diff", ref],
            capture_output=True, text=True, cwd=git_root,
        )
```

with:

```python
        ref = build_diff_ref(args.base)
        result = subprocess.run(
            ["git", "diff", "--function-context", ref],
            capture_output=True, text=True, cwd=git_root,
        )
```

- [ ] **Step 3: Render the manifest into the user message**

Replace the `user_msg` line (line 244):

```python
    user_msg = f"{focus}<diff>\n{diff}\n</diff>{file_context}"
```

with:

```python
    changed_block = render_changed_files(args.changed_files)
    changed_section = f"\n\n{changed_block}" if changed_block else ""
    user_msg = f"{focus}<diff>\n{diff}\n</diff>{changed_section}{file_context}"
```

- [ ] **Step 4: Set `temperature=0`**

In the `client.chat.completions.create(...)` call, the final argument is
`max_tokens=args.max_tokens,` (line 315). Add a line directly after it:

```python
            max_tokens=args.max_tokens,
            temperature=0,
```

(Skip this step entirely if Task 0 found `temperature` is rejected.)

- [ ] **Step 5: Harden the system prompt**

Two edits inside the system `content` string.

(a) Replace the input-format sentence (lines 272-274):

```python
                        "Input: a unified git diff inside <diff>, optionally followed by <file> "
                        "blocks containing source context, docs/patterns/* convention docs, or "
                        "docs/rules/* checklists.\n\n"
```

with:

```python
                        "Input: a unified git diff (with function-level context) inside <diff>, "
                        "optionally followed by a <changed-files> block listing every file in the "
                        "change-set, then optional <file> blocks containing source context, "
                        "docs/patterns/* convention docs, or docs/rules/* checklists.\n\n"
```

(b) Add a partial-view paragraph. Find the line that ends the standards
sentence (line 292):

```python
                        "binding standards — flag violations and cite the specific convention."
```

Immediately after it, insert a new string literal (before the
`f"{profile_block}\n\n"` line):

```python
                        "\n\nYou see a partial view: a diff with function-level context, not "
                        "necessarily whole files. The <changed-files> block lists EVERY file in "
                        "this change-set; files not shown in <diff> (e.g. .sql migrations, config, "
                        "JSON) were still changed and their existence is established. NEVER raise a "
                        "finding claiming a file, migration, test, index, or guard is missing when "
                        "it appears in <changed-files>. If a risk depends on code you cannot see, "
                        "raise it only as WARNING and state explicitly what must be verified."
```

### `scripts/kimi-review.py`

- [ ] **Step 6: Apply Steps 1–4 identically**

- `--changed-files` argument: add after the `--rules` argument (after line 60,
  before `--profile`). Use the exact block from Step 1.
- `build_diff_ref` + `--function-context`: in `get_diff`, replace lines 92-93:

  ```python
      ref = f"{args.base}..HEAD" if args.base else "HEAD~1"
      result = subprocess.run(["git", "diff", ref], capture_output=True, text=True, cwd=root)
  ```

  with:

  ```python
      ref = build_diff_ref(args.base)
      result = subprocess.run(["git", "diff", "--function-context", ref], capture_output=True, text=True, cwd=root)
  ```

- Manifest render: replace the `user_msg` line (line 232):

  ```python
      user_msg = f"{focus}<diff>\n{diff}\n</diff>{context_blocks(args, root)}"
  ```

  with:

  ```python
      changed_block = render_changed_files(args.changed_files)
      changed_section = f"\n\n{changed_block}" if changed_block else ""
      user_msg = f"{focus}<diff>\n{diff}\n</diff>{changed_section}{context_blocks(args, root)}"
  ```

- `temperature=0`: in `create(...)`, after `max_tokens=args.max_tokens,`
  (line 277), add `temperature=0,` (skip if Task 0 said rejected).

- [ ] **Step 7: Harden the shorter CI system prompt**

In `scripts/kimi-review.py` the system prompt is condensed. Replace its
input-format line (line 261):

```python
                        "Input: a unified git diff inside <diff>, optionally followed by <file> blocks.\n\n"
```

with:

```python
                        "Input: a unified git diff (with function-level context) inside <diff>, "
                        "optionally followed by a <changed-files> block listing every file in the "
                        "change-set, then optional <file> blocks.\n\n"
```

Then, after the line `"Treat included rules or patterns as binding project standards."`
(line 266), insert:

```python
                        "\n\nYou see a partial view, not whole files. The <changed-files> block "
                        "lists EVERY file in this change-set; files not shown in <diff> (e.g. .sql "
                        "migrations, config) were still changed and their existence is established. "
                        "NEVER claim a file, migration, test, index, or guard is missing when it "
                        "appears in <changed-files>. If a risk depends on code you cannot see, "
                        "raise it only as WARNING and say what must be verified."
```

- [ ] **Step 8: Verify no regression**

Run: `bash .claude/hooks/test-kimi-review.sh`
Expected: PASS — `Results: N passed, 0 failed` (same N as Task 1 Step 7).

- [ ] **Step 9: Sanity-check the engine still runs (offline)**

Confirm the `--changed-files` argument parses and the manifest renders without
hitting the network. Run:

```bash
echo "diff --git a/x.ts b/x.ts" | python3 scripts/kimi-review.py --help >/dev/null && echo "PARSES OK"
```

Expected: prints `PARSES OK` and `--changed-files` appears in the help text:

```bash
python3 scripts/kimi-review.py --help | grep -- --changed-files
```

Expected: the `--changed-files` line is printed.

- [ ] **Step 10: Commit**

```bash
git add scripts/kimi-review.py
git commit -m "feat(kimi): pass <changed-files> manifest, function-context diff, temperature=0"
```

---

## Task 3: Wrappers — function-context diff, `--name-status` capture, pass `--changed-files`

Each wrapper gains: `--function-context` on the review diff it pipes, a dedicated
`git diff --name-status` capture of the full change-set, and a `--changed-files`
argument on the `kimi-review` invocation. The existing name-only pattern-loop
inputs are left untouched.

**Files:**

- Modify: `.claude/hooks/kimi-review.sh`
- Modify: `.husky/pre-commit`
- Modify: `scripts/ci-kimi-review.sh`
- Test: `.claude/hooks/test-kimi-review.sh`

- [ ] **Step 1: Add an `echo-args` stub mode + `--name-status` git stub to the harness**

In `.claude/hooks/test-kimi-review.sh`, the `make_stub_path` stub `kimi-review`
has a `case "$mode"` (lines 38-52). Add a mode that echoes its arguments so a
test can assert the wrapper passed `--changed-files`. After the `echo-input`
line (line 51), add:

```bash
  echo-args)        printf 'ARGS: %s\n' "$*";;
```

Then update the stub `git` so the new `--name-status` and `--function-context`
diff forms resolve (otherwise they fall through to real git). In the stub `git`
`case "$* "` (lines 59-66), add these branches **before** the existing
`"diff --cached --name-only"*` / `"diff --diff-filter="*` lines:

```bash
  "diff --cached --name-status"*) printf '%s\n' "${KIMI_TEST_CHANGED_STATUS:-M\tserver/routes/foo.ts}";;
  "diff --name-status"*)          printf '%s\n' "${KIMI_TEST_CHANGED_STATUS:-M\tserver/routes/foo.ts}";;
  "diff --cached --function-context"*) printf '%s\n' "${KIMI_TEST_REVIEW_DIFF:-diff --git a/server/routes/foo.ts b/server/routes/foo.ts}";;
  "diff --function-context"*)     printf '%s\n' "${KIMI_TEST_REVIEW_DIFF:-diff --git a/server/routes/foo.ts b/server/routes/foo.ts}";;
```

- [ ] **Step 2: Write the failing wrapper tests**

Add these to the "Diff scoping" section of `.claude/hooks/test-kimi-review.sh`
(after line 361). The `echo-args` stub puts the kimi-review argv into the
review body, which the hook surfaces in `additionalContext`:

```bash
# The hook passes a --changed-files manifest to kimi-review.
OUT=$(run_hook echo-args '{"tool_input":{"command":"git commit -m x"}}')
assert_contains "hook passes --changed-files to kimi-review" "$OUT" "--changed-files"

# The CI wrapper passes a --changed-files manifest.
OUT=$(run_ci_gate echo-args)
assert_contains "CI passes --changed-files to kimi-review" "$OUT" "--changed-files"

# The Husky wrapper passes a --changed-files manifest.
OUT=$(run_husky_gate echo-args)
assert_contains "Husky passes --changed-files to kimi-review" "$OUT" "--changed-files"
```

- [ ] **Step 3: Run the harness to verify the new tests fail**

Run: `bash .claude/hooks/test-kimi-review.sh`
Expected: the three new assertions FAIL (`--changed-files` not yet passed); final line shows `3 failed` (the existing tests still pass).

- [ ] **Step 4: Update `.claude/hooks/kimi-review.sh`**

(a) After the `FILES=...` capture (line 35), add a dedicated full-list capture:

```bash
# Full change-set (all files, with status) for the <changed-files> manifest.
# Separate from FILES (which is .ts/.tsx-only for the guard + pattern loop) so
# the reviewer can see non-code files (migrations, config) without those files
# entering pattern selection or being sent as content.
CHANGED_FILES=$(git diff --cached --name-status --diff-filter=ACMDR 2>/dev/null || true)
```

(b) Add `--function-context` to the review diff (line 85):

```bash
REVIEW_DIFF=$(git diff --cached --function-context --diff-filter=ACMDR -- '*.ts' '*.tsx')
```

(c) Pass `--changed-files` in BOTH invocations (lines 88-101). In the
`if [ -n "$PATTERNS" ]` branch add the flag, and in the `else` branch add it
too. Result:

```bash
if [ -n "$PATTERNS" ]; then
  REVIEW=$(printf '%s' "$REVIEW_DIFF" | kimi-review \
    --scope "staged for commit" \
    --profile ocrecipes \
    --patterns "$PATTERNS" \
    --rules "$PATTERNS" \
    --pattern-max-chars 12000 \
    --changed-files "$CHANGED_FILES" \
    --tiers CRITICAL,WARNING 2>&1)
else
  REVIEW=$(printf '%s' "$REVIEW_DIFF" | kimi-review \
    --scope "staged for commit" \
    --profile ocrecipes \
    --changed-files "$CHANGED_FILES" \
    --tiers CRITICAL,WARNING 2>&1)
fi
```

- [ ] **Step 5: Update `.husky/pre-commit`**

(a) After the `STAGED_FILES=...` capture (line 20), add:

```bash
CHANGED_FILES=$(git diff --cached --name-status --diff-filter=ACMDR)
```

(b) Add `--function-context` to the review diff (line 28):

```bash
REVIEW_DIFF=$(git diff --cached --function-context --diff-filter=ACMDR -- '*.ts' '*.tsx')
```

(c) Add `--changed-files` to the base `REVIEW_COMMAND` array (lines 90-93):

```bash
REVIEW_COMMAND=(kimi-review
  --scope "pre-commit staged diff" \
  --tiers CRITICAL,WARNING \
  --changed-files "$CHANGED_FILES" \
  --profile ocrecipes)
```

- [ ] **Step 6: Update `scripts/ci-kimi-review.sh`**

(a) After the `changed_files=...` capture (lines 40-43), add a status capture:

```bash
if ! changed_status=$(git diff --name-status --diff-filter=ACMDR "$merge_base" "$head_sha"); then
  echo "::error title=Unable to compute changed files::Could not diff $merge_base..$head_sha."
  exit 1
fi
```

(b) Add `--function-context` to `review_diff` (line 45):

```bash
if ! review_diff=$(git diff --function-context --diff-filter=ACMDR "$merge_base" "$head_sha" -- '*.ts' '*.tsx'); then
```

(c) Add `--changed-files` to the `review_command` array (lines 116-121):

```bash
review_command=(
  "${reviewer_command[@]}"
  --scope "$review_scope"
  --tiers CRITICAL,WARNING
  --changed-files "$changed_status"
  --profile ocrecipes
)
```

- [ ] **Step 7: Run the harness to verify all tests pass**

Run: `bash .claude/hooks/test-kimi-review.sh`
Expected: PASS — `Results: N passed, 0 failed` (the three new wrapper assertions now pass; nothing regressed).

- [ ] **Step 8: Commit**

```bash
git add .claude/hooks/kimi-review.sh .husky/pre-commit scripts/ci-kimi-review.sh .claude/hooks/test-kimi-review.sh
git commit -m "feat(kimi): wrappers send function-context diff + --changed-files manifest"
```

---

## Task 4: End-to-end smoke verification

Confirm the documented false-positive classes are actually fixed against the
real model. Requires `WORKER_API_KEY`/`OPENROUTER_API_KEY`. **No commit** —
these are manual confirmations; record results in the final report.

**Files:** none (uses a scratch diff).

- [ ] **Step 1: Class (2) — "missing migration" must NOT fire**

Build a synthetic schema diff and a manifest that includes a `.sql` migration,
and confirm the reviewer does not emit a CRITICAL claiming the migration is
missing. Run:

```bash
printf '%s\n' \
  'diff --git a/shared/schema.ts b/shared/schema.ts' \
  'index 1111111..2222222 100644' \
  '--- a/shared/schema.ts' \
  '+++ b/shared/schema.ts' \
  '@@ -10,3 +10,4 @@ export const meals = pgTable("meals", {' \
  '   id: serial("id").primaryKey(),' \
  '   userId: varchar("user_id").notNull(),' \
  '+  servedAt: timestamp("served_at", { withTimezone: true }).notNull(),' \
  ' });' \
  | python3 scripts/kimi-review.py \
      --scope "smoke: schema + migration present" \
      --profile ocrecipes \
      --changed-files $'M\tshared/schema.ts\nA\tmigrations/0043_served_at.sql' \
      --tiers CRITICAL,WARNING
```

Expected: no `[CRITICAL] ... migration ... missing/not ...` line. A WARNING that
names the `.sql` and asks to verify its contents is acceptable (that is the
intended downgrade). If a "no migration" CRITICAL still appears, re-read the
prompt hardening in Task 2 Step 5/7.

- [ ] **Step 2: Class (1) — far context is now visible**

Confirm `--function-context` widens the engine's own diff. On a real commit
whose hunk has relevant code in the same function but >3 lines away, run:

```bash
git diff --function-context HEAD~1 | head -40
```

Expected: hunks span the enclosing function, not just ±3 lines. (This is the
exact diff the engine now sends.)

- [ ] **Step 3: Record outcomes**

Note in the final report: temperature accepted (Y/N from Task 0), Step 1 result
(no false "missing migration"), Step 2 confirmation.

---

## Task 5: Architecture reference doc

The single source of truth for the now-complex Kimi review system. Written last
so it documents the shipped end state (post Tasks 1–3).

**Files:**

- Create: `docs/kimi-review-architecture.md`

- [ ] **Step 1: Write the doc**

Create `docs/kimi-review-architecture.md` with these sections (fill each from
the actual shipped code — verify every path/flag/env var as you write):

1. **Overview** — what the gate is (DeepSeek V4 Flash via OpenRouter, branded
   "Kimi"), what it gates (staged/PR `.ts`/`.tsx` diffs), and that CRITICAL
   blocks while WARNING informs.
2. **Surfaces** — table of the three entry points:
   - `.claude/hooks/kimi-review.sh` (Claude-Code PreToolUse on `git commit`;
     blocks via `permissionDecision: deny`)
   - `.husky/pre-commit` (local commit gate; blocks via non-zero exit)
   - `scripts/ci-kimi-review.sh` (GitHub Actions "Kimi Review"; blocks the PR)
     For each: trigger, what diff it sends, how it blocks, how it skips.
3. **Engine** — the two copies (`~/.local/bin/kimi-review`,
   `scripts/kimi-review.py`), why duplicated, the hand-sync obligation, and the
   **unversioned-local-script gap** (the `~/.local/bin` copies have no repo;
   `scripts/kimi-review.py` is the in-repo mirror). List the testable seams
   (`filter_review`, `render_changed_files`, `build_diff_ref`,
   `resolve_client_config`).
4. **Data flow** — how `<diff>` (function-context), `<changed-files>` manifest,
   `--patterns`/`--rules` docs, and the `--profile` block compose into one LLM
   call; the three-dot ref behavior for manual `--base` runs.
5. **Config** — `WORKER_MODEL`, `WORKER_BASE_URL`, `WORKER_API_KEY` /
   `OPENROUTER_API_KEY` / `MOONSHOT_API_KEY`, `--tiers`, `--profile`,
   `temperature=0`, the path→domain pattern mapping (point to the `case`
   blocks; do not duplicate them).
6. **Invariants** — secret-safety (only `.ts`/`.tsx` content is sent; manifest
   is names-only); CI `pull_request_target` rule (diff data only, never execute
   PR-head files); `SKIP_KIMI_REVIEW` semantics including the inline-prefix vs.
   process-env distinction per surface; the CRITICAL-detection shape
   (`[CRITICAL] path:line`) and why it is shape-based not keyword-based.
7. **False-positive design** — the four mechanisms and their fixes; link the
   spec (`docs/superpowers/specs/2026-05-18-kimi-false-positive-prevention-design.md`).
8. **Testing** — `.claude/hooks/test-kimi-review.sh` (harness: wrappers +
   embedded engine tests) and `~/.local/bin/test-kimi-review.py` (local engine);
   how to run each.

- [ ] **Step 2: Verify the doc against the code**

Re-read each path, env var, and flag the doc cites and confirm it matches the
shipped files (spec Verification step 5). Fix any drift.

- [ ] **Step 3: Commit**

```bash
git add docs/kimi-review-architecture.md
git commit -m "docs: add Kimi review system architecture reference"
```

---

## Final report

After all tasks, report:

- Task 0 outcome: was `temperature=0` accepted? (If not, where it was dropped.)
- That `~/.local/bin/kimi-review` and `~/.local/bin/test-kimi-review.py` were
  edited outside the repo (unversioned) and must be kept in sync with
  `scripts/kimi-review.py`.
- Task 4 smoke results.
- Suggested follow-up: run a full branch review
  (`kimi-review --scope "kimi false-positive prevention" --base main --tiers CRITICAL,WARNING --profile ocrecipes`)
  before merging — it now benefits from its own fixes.
