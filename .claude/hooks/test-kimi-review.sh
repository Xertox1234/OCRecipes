#!/usr/bin/env bash
# Tests for kimi-review.sh — run from project root.
# Tests are hermetic: a stub `kimi-review` (and optionally `git`) is shimmed onto PATH
# via a temp dir, so no real review is ever invoked and no API key is needed.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HOOK="$ROOT/.claude/hooks/kimi-review.sh"
CI_SCRIPT="$ROOT/scripts/ci-kimi-review.sh"
PRE_COMMIT="$ROOT/.husky/pre-commit"
PASS=0; FAIL=0

# Make a sandbox PATH with stub binaries. The stub exercises the exit-code contract:
#   exit 2  → verified CRITICAL present (wrappers must block)
#   exit 0  → clean / warnings / placeholder (wrappers must NOT block)
# KIMI_STUB_MODE controls output and exit code:
#   critical, critical-bracket, critical-bold, critical-no-findings-desc → exit 2
#   all other modes (clean, warning, noisy-prose, critical-nobody, …)     → exit 0
make_stub_path() {
  local mode="$1"
  local dir
  dir=$(mktemp -d)
  cat > "$dir/kimi-review" <<EOF
#!/usr/bin/env bash
  input=\$(cat)  # consume stdin so the pipe doesn't SIGPIPE
case "$mode" in
  critical)         echo "[CRITICAL] server/routes/foo.ts:42 — stub finding for tests"; exit 2;;
  critical-bracket) echo "  - [CRITICAL] server/routes/foo.ts:10 — bullet+indent decorated finding"; exit 2;;
  critical-bold)    echo "**[CRITICAL]** server/routes/foo.ts:10 — markdown-bold form"; exit 2;;
  critical-nobody)  echo "[CRITICAL]";;
  warning)          echo "[WARNING] server/routes/foo.ts:5 — stub finding for tests";;
  noisy-prose)      echo "no critical issues found in stub run";;
  negative-prose)   echo "No CRITICAL or WARNING findings";;
  clean)            echo "No findings in requested tiers: CRITICAL, WARNING";;
  clean-tiered)     printf '[CRITICAL] — No findings.\n[WARNING] — No findings.\n';;
  clean-model-prose) printf '[CRITICAL] No critical issues found.\n[WARNING] No warning-level issues found.\n';;
  critical-no-findings-desc)
                    echo "[CRITICAL] server/routes/foo.ts:42 — error handler swallows the error and returns no findings to the caller"; exit 2;;
  echo-input)       printf '%s' "\$input";;
  echo-args)        printf 'ARGS: %s\n' "\$*";;
esac
EOF
  chmod +x "$dir/kimi-review"
  # Stub git to return a fake staged file list + a fake diff so the hook
  # proceeds past the "no staged files" guard without touching the real index.
  cat > "$dir/git" <<'EOF'
#!/usr/bin/env bash
case "$* " in
  "merge-base "*)                 echo "merge-base-sha";;
  "diff --cached --name-status"*) printf '%s\n' "${KIMI_TEST_CHANGED_STATUS:-M	server/routes/foo.ts}";;
  "diff --name-status"*)          printf '%s\n' "${KIMI_TEST_CHANGED_STATUS:-M	server/routes/foo.ts}";;
  "diff --cached --function-context"*) printf '%s\n' "${KIMI_TEST_REVIEW_DIFF:-diff --git a/server/routes/foo.ts b/server/routes/foo.ts}";;
  "diff --function-context"*)     printf '%s\n' "${KIMI_TEST_REVIEW_DIFF:-diff --git a/server/routes/foo.ts b/server/routes/foo.ts}";;
  "diff --cached --name-only"*)   printf '%s\n' "${KIMI_TEST_STAGED_FILES:-server/routes/foo.ts}";;
  "diff --name-only"*)            printf '%s\n' "${KIMI_TEST_CHANGED_FILES:-server/routes/foo.ts}";;
  "diff --cached"*)               printf '%s\n' "${KIMI_TEST_REVIEW_DIFF:-diff --git a/server/routes/foo.ts b/server/routes/foo.ts}";;
  "diff --diff-filter="*)         printf '%s\n' "${KIMI_TEST_REVIEW_DIFF:-diff --git a/server/routes/foo.ts b/server/routes/foo.ts}";;
  *) exec /usr/bin/env -i PATH="/usr/bin:/bin" git "$@";;
esac
EOF
  chmod +x "$dir/git"
  cat > "$dir/npx" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
  chmod +x "$dir/npx"
  printf '%s' "$dir"
}

# Run the hook with a stub PATH. $1 = kimi mode, $2 = stdin JSON.
run_hook() {
  local mode="$1" input="$2"
  local stubdir
  stubdir=$(make_stub_path "$mode")
  echo "$input" | PATH="$stubdir:$PATH" bash "$HOOK" 2>/dev/null
  local rc=$?
  rm -rf "$stubdir"
  return $rc
}

# Capture both stdout and exit code from a single run.
run_capture() {
  local mode="$1" input="$2"
  local stubdir output rc
  stubdir=$(make_stub_path "$mode")
  output=$(echo "$input" | PATH="$stubdir:$PATH" bash "$HOOK" 2>/dev/null)
  rc=$?
  rm -rf "$stubdir"
  printf '%s\n--RC--%d' "$output" "$rc"
}

run_ci_gate() {
  local mode="$1"
  local stubdir output rc
  stubdir=$(make_stub_path "$mode")
  output=$(PATH="$stubdir:$PATH" \
    KIMI_REVIEW_BASE_SHA=base-sha \
    KIMI_REVIEW_HEAD_SHA=head-sha \
    WORKER_API_KEY=test-key \
    bash "$CI_SCRIPT" 2>&1)
  rc=$?
  rm -rf "$stubdir"
  printf '%s\n--RC--%d' "$output" "$rc"
}

run_husky_gate() {
  local mode="$1"
  local stubdir output rc
  stubdir=$(make_stub_path "$mode")
  # Husky runs this hook as `sh -e` (see .husky/_/h), NOT `bash`. Invoke it the
  # same way so the harness catches errexit-only bugs — e.g. a clean review whose
  # CRITICAL grep returns 1 and would abort under `set -e`. Running it with plain
  # `bash` here previously masked exactly that bug.
  output=$(PATH="$stubdir:$PATH" sh -e "$PRE_COMMIT" 2>&1)
  rc=$?
  rm -rf "$stubdir"
  printf '%s\n--RC--%d' "$output" "$rc"
}

# Same as run_husky_gate but forces dash — the default /bin/sh on Linux. The hook
# uses bash-only syntax (arrays, `<<<`, `$'...'`) and must re-exec under bash when
# started by a non-bash sh. This guards against the Linux "Syntax error:
# redirection unexpected" regression. Only used when dash is available.
run_husky_gate_dash() {
  local mode="$1"
  local stubdir output rc
  stubdir=$(make_stub_path "$mode")
  output=$(PATH="$stubdir:$PATH" dash -e "$PRE_COMMIT" 2>&1)
  rc=$?
  rm -rf "$stubdir"
  printf '%s\n--RC--%d' "$output" "$rc"
}


run_python_credential_tests() {
  local engine="${1:-$ROOT/scripts/kimi-review.py}"
  command -v python3 >/dev/null 2>&1 || { echo "python3 not found"; return 1; }
  python3 - "$engine" <<'PY'
import importlib.util
import pathlib
import sys

module_path = pathlib.Path(sys.argv[1])
spec = importlib.util.spec_from_file_location("kimi_review", module_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

cases = [
    ({"WORKER_API_KEY": "worker", "OPENROUTER_API_KEY": "openrouter"}, ("worker", module.DEFAULT_BASE_URL)),
    ({"WORKER_API_KEY": "", "OPENROUTER_API_KEY": "openrouter"}, ("openrouter", module.DEFAULT_BASE_URL)),
    ({"MOONSHOT_API_KEY": "moonshot", "WORKER_BASE_URL": "https://api.moonshot.cn/v1"}, ("moonshot", "https://api.moonshot.cn/v1")),
]

for env, expected in cases:
    actual = module.resolve_client_config(env)
    if actual != expected:
        raise AssertionError(f"{env!r}: expected {expected!r}, got {actual!r}")

try:
    module.resolve_client_config({"MOONSHOT_API_KEY": "moonshot"})
except SystemExit as error:
    if error.code not in (1, None):
        raise AssertionError(f"unexpected SystemExit code: {error.code!r}")
else:
    raise AssertionError("MOONSHOT_API_KEY without WORKER_BASE_URL should exit")

try:
    module.resolve_client_config({})
except SystemExit as error:
    if error.code not in (1, None):
        raise AssertionError(f"unexpected missing-credential SystemExit code: {error.code!r}")
else:
    raise AssertionError("missing credentials should exit")

try:
    module.resolve_client_config({"WORKER_API_KEY": ""})
except SystemExit as error:
    if error.code not in (1, None):
        raise AssertionError(f"unexpected empty-credential SystemExit code: {error.code!r}")
else:
    raise AssertionError("empty WORKER_API_KEY without fallback credentials should exit")
PY
}

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

run_python_helper_tests() {
  local engine="${1:-$ROOT/scripts/kimi-review.py}"
  command -v python3 >/dev/null 2>&1 || { echo "python3 not found"; return 1; }
  python3 - "$engine" <<'PY'
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

run_python_profile_tests() {
  local engine="${1:-$ROOT/scripts/kimi-review.py}"
  command -v python3 >/dev/null 2>&1 || { echo "python3 not found"; return 1; }
  python3 - "$engine" "$ROOT/scripts/kimi-profiles.json" <<'PY'
import importlib.util, pathlib, sys
spec = importlib.util.spec_from_file_location("kimi_review", pathlib.Path(sys.argv[1]))
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
profiles = module.load_profiles(pathlib.Path(sys.argv[2]))
assert profiles["generic"] == "", "generic profile must be empty string"
assert "OCRecipes" in profiles["ocrecipes"], "ocrecipes profile must load"
assert module.load_profiles(pathlib.Path("/nonexistent.json")) == {}, "missing file -> {}"
PY
}

run_python_schema_tests() {
  local engine="${1:-$ROOT/scripts/kimi-review.py}"
  command -v python3 >/dev/null 2>&1 || { echo "python3 not found"; return 1; }
  python3 - "$engine" <<'PY'
import importlib.util, pathlib, sys, json
spec = importlib.util.spec_from_file_location("kimi_review", pathlib.Path(sys.argv[1]))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

findings = [
    {"tier":"CRITICAL","claim_type":"absent_symbol","file":"server/a.ts","line":42,"symbol":"requireOwner","detail":"missing ownership check"},
    {"tier":"WARNING","claim_type":"semantic","file":"server/b.ts","line":7,"symbol":None,"detail":"noisy log"},
]
text = m.findings_to_text(findings)
assert "[CRITICAL] server/a.ts:42 — missing ownership check" in text, text
assert "[WARNING] server/b.ts:7 — noisy log" in text, text

payload = '{"findings": ' + json.dumps(findings) + '}'
parsed = m.parse_findings(payload, {"CRITICAL","WARNING"})
assert len(parsed) == 2 and parsed[0]["tier"] == "CRITICAL"
parsed_c = m.parse_findings(payload, {"CRITICAL"})
assert len(parsed_c) == 1 and parsed_c[0]["tier"] == "CRITICAL"

# tier is normalized to uppercase even if the model returns lowercase
low = '{"findings":[{"tier":"critical","claim_type":"semantic","file":"x.ts","line":1,"symbol":null,"detail":"d"}]}'
pl = m.parse_findings(low, {"CRITICAL"})
assert len(pl) == 1 and pl[0]["tier"] == "CRITICAL", pl
assert "[CRITICAL] x.ts:1 — d" in m.findings_to_text(pl)

# malformed JSON -> [] (treated as clean by caller)
assert m.parse_findings("not json", {"CRITICAL"}) == []

# DEFENSE-IN-DEPTH: a finding missing required fields is DROPPED, never crashes.
# (A crash would exit non-2 and silently fail-open the gate.)
miss_file = '{"findings":[{"tier":"CRITICAL","claim_type":"semantic","line":1,"symbol":null,"detail":"d"}]}'
assert m.parse_findings(miss_file, {"CRITICAL"}) == [], "finding missing file must be dropped"
miss_detail = '{"findings":[{"tier":"CRITICAL","claim_type":"semantic","file":"a.ts","line":1,"symbol":null}]}'
assert m.parse_findings(miss_detail, {"CRITICAL"}) == [], "finding missing detail must be dropped"
# a valid finding alongside a malformed one: keep the valid, drop the bad, no crash
mixed = '{"findings":[{"tier":"CRITICAL","claim_type":"semantic","file":"a.ts","line":2,"symbol":null,"detail":"ok"},{"tier":"CRITICAL"}]}'
mp = m.parse_findings(mixed, {"CRITICAL"})
assert len(mp) == 1 and mp[0]["file"] == "a.ts", mp
# every kept finding is fully shaped, so findings_to_text never KeyErrors
assert "[CRITICAL] a.ts:2 — ok" in m.findings_to_text(mp)
# bad line type is normalized to None (no f":{line}" with a non-int)
badline = '{"findings":[{"tier":"CRITICAL","claim_type":"semantic","file":"a.ts","line":"oops","symbol":null,"detail":"d"}]}'
bp = m.parse_findings(badline, {"CRITICAL"})
assert bp[0]["line"] is None and m.findings_to_text(bp) == "[CRITICAL] a.ts — d", bp
PY
}

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
r = m.run_tool("read_file", {"path": "a.ts"}, root=d)
assert "requireOwner" in r, r
g = m.run_tool("grep", {"pattern": "requireOwner"}, root=d)
assert "requireOwner" in g, g
bad = m.run_tool("read_file", {"path": "../../../etc/passwd"}, root=d)
assert "error" in bad.lower() or bad == "", bad
assert "error" in m.run_tool("rm", {"path":"a.ts"}, root=d).lower()
# TREE DISCIPLINE: read a committed sha (CI reads PR head, not the checked-out base)
git("add","a.ts"); git("commit","-q","-m","base")
(pathlib.Path(d)/"a.ts").write_text("line1\nverifiedAtHead()\nline3\n")
git("add","a.ts"); git("commit","-q","-m","head")
head = git("rev-parse","HEAD").stdout.strip()
git("checkout","-q","HEAD~1")
assert "verifiedAtHead" not in (pathlib.Path(d)/"a.ts").read_text()
rh = m.run_tool("read_file", {"path":"a.ts"}, root=d, tree_ref=head)
assert "verifiedAtHead" in rh, "tree_ref read must see the head tree, not working tree"
gh = m.run_tool("grep", {"pattern":"verifiedAtHead"}, root=d, tree_ref=head)
assert "verifiedAtHead" in gh, gh
before = (pathlib.Path(d)/"a.ts").read_text()
m.run_tool("read_file", {"path":"a.ts"}, root=d, tree_ref=head)
assert (pathlib.Path(d)/"a.ts").read_text() == before, "tools must never mutate files"
PY
}

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

# a 'verified' verdict -> keep
class FakeVerified(FakeClient):
    def create(self, **kw):
        self.calls += 1
        return resp(msg(content=json.dumps({"verdict":"verified","corrected_detail":"real","confidence":0.9})))
assert m.verify_one_agentic(f, FakeVerified(), model="x", root=d, max_turns=5) == "keep"

# verify_agentic only targets CRITICALs; non-CRITICAL stays 'keep' without calling the model
findings = [f, {"tier":"WARNING","claim_type":"semantic","file":"a.ts","line":1,"symbol":None,"detail":"w"}]
vs = m.verify_agentic(findings, FakeVerified(), model="x", root=d)
assert vs[1] == "keep", vs
PY
}

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
f_present = {"tier":"CRITICAL","claim_type":"absent_symbol","file":"a.ts","line":None,"symbol":"requireOwner","detail":"d"}
f_missing = {"tier":"CRITICAL","claim_type":"absent_symbol","file":"a.ts","line":None,"symbol":"nonexistentGuard","detail":"d"}
f_goodline = {"tier":"CRITICAL","claim_type":"line_assertion","file":"a.ts","line":1,"symbol":"requireOwner","detail":"d"}
f_badline = {"tier":"CRITICAL","claim_type":"line_assertion","file":"a.ts","line":2,"symbol":"totallyWrongText","detail":"d"}
f_semantic = {"tier":"CRITICAL","claim_type":"semantic","file":"a.ts","line":1,"symbol":None,"detail":"d"}
verdicts = m.verify_deterministic([f_present,f_missing,f_goodline,f_badline,f_semantic], cwd=d)
assert verdicts[0] == "downgrade", verdicts
assert verdicts[1] == "keep", verdicts
assert verdicts[2] == "keep", verdicts
assert verdicts[3] == "downgrade", verdicts
assert verdicts[4] == "downgrade", verdicts
PY
}

run_python_monotonic_tests() {
  local engine="${1:-$ROOT/scripts/kimi-review.py}"
  command -v python3 >/dev/null 2>&1 || { echo "python3 not found"; return 1; }
  python3 - "$engine" <<'PY'
import importlib.util, pathlib, sys
spec = importlib.util.spec_from_file_location("kimi_review", pathlib.Path(sys.argv[1]))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
findings = [{"tier":"CRITICAL","claim_type":"absent_symbol","file":"a.ts","line":1,"symbol":"x","detail":"d"}]
out = m.apply_downgrades(findings, {0: "downgrade"})
assert out[0]["tier"] == "WARNING", "downgrade must lower CRITICAL to WARNING"
out2 = m.apply_downgrades(findings, {0: "keep"})
assert out2[0]["tier"] == "CRITICAL", "keep must preserve tier"
warn = [{"tier":"WARNING","claim_type":"semantic","file":"a.ts","line":1,"symbol":None,"detail":"d"}]
out3 = m.apply_downgrades(warn, {0: "keep"})
assert out3[0]["tier"] == "WARNING", "verify must never promote a tier"
PY
}

run_python_pattern_resolution_tests() {
  local engine="${1:-$ROOT/scripts/kimi-review.py}"
  command -v python3 >/dev/null 2>&1 || { echo "python3 not found"; return 1; }
  python3 - "$engine" <<'PY'
import importlib.util, pathlib, sys, tempfile, types
spec = importlib.util.spec_from_file_location("kimi_review", pathlib.Path(sys.argv[1]))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
d = tempfile.mkdtemp()
# A missing --patterns name must NOT exit the process. A hard sys.exit returns a
# non-2 status that fail-OPENS the local commit gate on every TS commit if a
# pattern dir is ever pruned. It must warn and skip, like --rules already does.
args = types.SimpleNamespace(paths=None, patterns="definitely-not-a-real-pattern-xyz",
                             pattern_max_chars=12000, rules=None)
assert m.context_blocks(args, d) == "", "missing pattern must be skipped, not fatal"
# --rules parity: a missing rule name is likewise skipped, not fatal.
args2 = types.SimpleNamespace(paths=None, patterns=None,
                              pattern_max_chars=12000, rules="definitely-not-a-real-rule-xyz")
assert m.context_blocks(args2, d) == "", "missing rule must be skipped"
PY
}

assert_contains() {
  local name="$1" haystack="$2" needle="$3"
  if echo "$haystack" | grep -q -- "$needle"; then
    echo "PASS: $name"; PASS=$((PASS+1))
  else
    echo "FAIL: $name (expected to find: $needle)"
    echo "  got: $(echo "$haystack" | head -3)"
    FAIL=$((FAIL+1))
  fi
}

assert_not_contains() {
  local name="$1" haystack="$2" needle="$3"
  if echo "$haystack" | grep -q -- "$needle"; then
    echo "FAIL: $name (expected NOT to find: $needle)"
    echo "  got: $(echo "$haystack" | head -3)"
    FAIL=$((FAIL+1))
  else
    echo "PASS: $name"; PASS=$((PASS+1))
  fi
}

assert_empty() {
  local name="$1" haystack="$2"
  if [ -z "$haystack" ]; then
    echo "PASS: $name"; PASS=$((PASS+1))
  else
    echo "FAIL: $name (expected empty output)"
    echo "  got: $(echo "$haystack" | head -3)"
    FAIL=$((FAIL+1))
  fi
}

# ---------- Command matcher tests ----------

# Plain `git commit` → match, hook runs (clean review → additionalContext JSON)
OUT=$(run_hook clean '{"tool_input":{"command":"git commit -m \"x\""}}')
assert_contains "git commit matches and emits review JSON" "$OUT" "additionalContext"

# `git -c user.name=x commit` → match
OUT=$(run_hook clean '{"tool_input":{"command":"git -c user.name=x commit -m y"}}')
assert_contains "git -c ... commit matches" "$OUT" "additionalContext"

# Leading env var assignment → match
OUT=$(run_hook clean '{"tool_input":{"command":"GIT_AUTHOR_NAME=foo git commit -m y"}}')
assert_contains "FOO=bar git commit matches" "$OUT" "additionalContext"

# `git commit-graph write` → NO match (silent exit 0)
OUT=$(run_hook clean '{"tool_input":{"command":"git commit-graph write"}}')
assert_empty "git commit-graph does NOT match" "$OUT"

# `echo git commit ...` → NO match
OUT=$(run_hook clean '{"tool_input":{"command":"echo git commit -m x"}}')
assert_empty "echo git commit does NOT match" "$OUT"

# Arbitrary text containing the substring → NO match
OUT=$(run_hook clean '{"tool_input":{"command":"foo git commit bar"}}')
assert_empty "substring git commit does NOT match" "$OUT"

# Unrelated git command → NO match
OUT=$(run_hook clean '{"tool_input":{"command":"git push origin main"}}')
assert_empty "git push does NOT match" "$OUT"

# ---------- Skip semantics ----------

# SKIP_KIMI_REVIEW=1 must skip even when the command matches. The env var must
# prefix `bash "$HOOK"`, not the upstream `echo` — in `VAR=val cmd1 | cmd2` the
# variable reaches cmd1 only, so prefixing `echo` would never set it for the hook.
OUT=$(echo '{"tool_input":{"command":"git commit -m x"}}' | SKIP_KIMI_REVIEW=1 bash "$HOOK" 2>/dev/null)
assert_empty "SKIP_KIMI_REVIEW=1 skips" "$OUT"

# Missing kimi-review on PATH must skip. Use a sandbox PATH with no kimi-review
# binary; keep jq + git available via /usr/bin and /bin.
EMPTY_DIR=$(mktemp -d)
OUT=$(echo '{"tool_input":{"command":"git commit -m x"}}' | \
  PATH="$EMPTY_DIR:/usr/bin:/bin" bash "$HOOK" 2>/dev/null)
rm -rf "$EMPTY_DIR"
assert_empty "missing kimi-review skips" "$OUT"

# ---------- Tier handling ----------

# WARNING-only review must NOT block — emits additionalContext JSON, no deny
OUT=$(run_hook warning '{"tool_input":{"command":"git commit -m x"}}')
assert_contains "WARNING emits additionalContext (non-blocking)" "$OUT" "additionalContext"
assert_not_contains "WARNING does not emit permissionDecision deny" "$OUT" '"permissionDecision": "deny"'

# CRITICAL review must block via permissionDecision deny
OUT=$(run_hook critical '{"tool_input":{"command":"git commit -m x"}}')
assert_contains "CRITICAL emits permissionDecision deny" "$OUT" '"permissionDecision": "deny"'
assert_contains "CRITICAL emits permissionDecisionReason" "$OUT" "permissionDecisionReason"

# Decorated [CRITICAL] finding lines must still block — the matcher is not
# anchored to line start, so leading bullets/indent and bold-wrapping fail closed.
OUT=$(run_hook critical-bracket '{"tool_input":{"command":"git commit -m x"}}')
assert_contains "bullet+indent decorated [CRITICAL] blocks" "$OUT" '"permissionDecision": "deny"'

OUT=$(run_hook critical-bold '{"tool_input":{"command":"git commit -m x"}}')
assert_contains "**[CRITICAL]** markdown-bold form blocks" "$OUT" '"permissionDecision": "deny"'

# A bare [CRITICAL] tag with no finding body must NOT block — require a body.
OUT=$(run_hook critical-nobody '{"tool_input":{"command":"git commit -m x"}}')
assert_not_contains "bare [CRITICAL] with no body does NOT block" "$OUT" '"permissionDecision": "deny"'

# Lowercase "critical" in prose must NOT trip the matcher.
OUT=$(run_hook noisy-prose '{"tool_input":{"command":"git commit -m x"}}')
assert_not_contains "lowercase 'critical' in prose does NOT block" "$OUT" '"permissionDecision": "deny"'
assert_contains "noisy-prose still emits additionalContext" "$OUT" "additionalContext"

# Regression: the word CRITICAL in kimi-review's own clean-output message and in
# the model's negative phrasing must NOT block — this is the phantom-CRITICAL bug.
OUT=$(run_hook clean '{"tool_input":{"command":"git commit -m x"}}')
assert_not_contains "clean-output message ('...tiers: CRITICAL, WARNING') does NOT block" "$OUT" '"permissionDecision": "deny"'

OUT=$(run_hook negative-prose '{"tool_input":{"command":"git commit -m x"}}')
assert_not_contains "negative phrasing ('No CRITICAL or WARNING findings') does NOT block" "$OUT" '"permissionDecision": "deny"'

# Regression: kimi-review's real clean output prints a bracketed per-tier
# section header for every requested tier (`[CRITICAL] — No findings.`). That
# header carries the bracketed `[CRITICAL]` tag with a body, so the tag alone
# cannot be the block signal — the "No findings" sentinel must NOT block.
OUT=$(run_hook clean-tiered '{"tool_input":{"command":"git commit -m x"}}')
assert_not_contains "bracketed '[CRITICAL] — No findings.' header does NOT block" "$OUT" '"permissionDecision": "deny"'
assert_contains "clean-tiered emits additionalContext" "$OUT" "additionalContext"

# Regression: the model sometimes ignores "omit empty tiers" and emits a bracketed
# [CRITICAL] line whose body is free-form "no issues" prose ("No critical issues
# found."). That body has no path:line, so it is not a finding and must NOT block.
# This is the real-world phantom-CRITICAL case the prose-keyed exclude missed.
OUT=$(run_hook clean-model-prose '{"tool_input":{"command":"git commit -m x"}}')
assert_not_contains "bracketed '[CRITICAL] No critical issues found.' prose does NOT block" "$OUT" '"permissionDecision": "deny"'
assert_contains "clean-model-prose emits additionalContext" "$OUT" "additionalContext"

# Regression: a real [CRITICAL] finding whose description happens to contain the
# phrase "no findings" MUST still block. The sentinel filter has to key on the
# sentinel's shape ([CRITICAL] followed only by non-alphanumeric separators),
# not a bare "no findings" substring — otherwise it fails open on such findings.
OUT=$(run_hook critical-no-findings-desc '{"tool_input":{"command":"git commit -m x"}}')
assert_contains "[CRITICAL] finding with 'no findings' in its description still blocks" "$OUT" '"permissionDecision": "deny"'

# ---------- Diff scoping ----------

OUT=$(KIMI_TEST_STAGED_FILES="docs/AI_WORKFLOW.md" \
  run_hook clean '{"tool_input":{"command":"git commit -m x"}}')
assert_empty "docs-only staged files skip Claude kimi-review" "$OUT"

OUT=$(KIMI_TEST_STAGED_FILES=$'docs/AI_WORKFLOW.md\nserver/routes/foo.ts' \
  KIMI_TEST_REVIEW_DIFF="diff --git a/server/routes/foo.ts b/server/routes/foo.ts" \
  run_hook echo-input '{"tool_input":{"command":"git commit -m x"}}')
assert_contains "mixed staged files send TypeScript diff" "$OUT" "server/routes/foo.ts"
assert_not_contains "mixed staged files do not send docs diff" "$OUT" "docs/AI_WORKFLOW.md"

# The hook passes a --changed-files manifest to kimi-review.
OUT=$(run_hook echo-args '{"tool_input":{"command":"git commit -m x"}}')
assert_contains "hook passes --changed-files to kimi-review" "$OUT" "--changed-files"

# The CI wrapper passes a --changed-files manifest.
OUT=$(run_ci_gate echo-args)
assert_contains "CI passes --changed-files to kimi-review" "$OUT" "--changed-files"
assert_contains "CI forwards --verify agentic" "$OUT" "--verify agentic"

# The Husky wrapper passes a --changed-files manifest.
OUT=$(run_husky_gate echo-args)
assert_contains "Husky passes --changed-files to kimi-review" "$OUT" "--changed-files"

OUT=$(run_husky_gate echo-args)
assert_contains "Husky forwards --verify deterministic" "$OUT" "--verify deterministic"

OUT=$(run_hook echo-args '{"tool_input":{"command":"git commit -m x"}}')
assert_contains "Claude hook forwards --verify deterministic" "$OUT" "--verify deterministic"

# ---------- CI/Husky gate parsing ----------

OUT=$(run_ci_gate clean-tiered)
assert_contains "CI clean tiered output exits 0" "$OUT" "--RC--0"
assert_contains "CI clean tiered output reaches completion" "$OUT" "kimi-review completed without CRITICAL findings"

OUT=$(run_ci_gate critical)
assert_contains "CI CRITICAL output exits 1" "$OUT" "--RC--1"
assert_contains "CI CRITICAL output blocks" "$OUT" "Kimi review blocked this PR"

OUT=$(run_husky_gate clean-tiered)
assert_contains "Husky clean tiered output exits 0" "$OUT" "--RC--0"

OUT=$(run_husky_gate critical)
assert_contains "Husky CRITICAL output exits 1" "$OUT" "--RC--1"
assert_contains "Husky CRITICAL output blocks" "$OUT" "Commit blocked"

# Regression: an empty-tier placeholder ([CRITICAL] No critical issues found.)
# carries no path:line, so the CI and Husky CRITICAL gates must not block on it.
OUT=$(run_ci_gate clean-model-prose)
assert_contains "CI clean-model-prose exits 0" "$OUT" "--RC--0"
assert_not_contains "CI clean-model-prose does not block" "$OUT" "Kimi review blocked this PR"

OUT=$(run_husky_gate clean-model-prose)
assert_contains "Husky clean-model-prose exits 0" "$OUT" "--RC--0"
assert_not_contains "Husky clean-model-prose does not block" "$OUT" "Commit blocked"

# Regression: on Linux /bin/sh is dash, which cannot parse the hook's bash syntax
# (arrays, `<<<`, `$'...'`). The hook must re-exec under bash. A clean review must
# still exit 0 and a CRITICAL must still block — no "Syntax error" abort. Skipped
# when dash is unavailable (e.g. some macOS setups).
if command -v dash >/dev/null 2>&1; then
  OUT=$(run_husky_gate_dash clean-tiered)
  assert_contains "Husky under dash: clean review exits 0 (re-exec works)" "$OUT" "--RC--0"
  assert_not_contains "Husky under dash: no syntax error" "$OUT" "Syntax error"

  OUT=$(run_husky_gate_dash critical)
  assert_contains "Husky under dash: CRITICAL exits 1" "$OUT" "--RC--1"
  assert_contains "Husky under dash: CRITICAL blocks" "$OUT" "Commit blocked"
else
  echo "SKIP: dash not installed — Husky-under-dash re-exec regression tests"
fi

if run_python_credential_tests; then
  echo "PASS: Python credential resolver handles aliases and provider base URL"
  PASS=$((PASS+1))
else
  echo "FAIL: Python credential resolver handles aliases and provider base URL"
  FAIL=$((FAIL+1))
fi

if run_python_budget_tests; then
  echo "PASS: Python resolve_budget_seconds env parsing"; PASS=$((PASS+1))
else
  echo "FAIL: Python resolve_budget_seconds env parsing"; FAIL=$((FAIL+1))
fi

if run_python_helper_tests; then
  echo "PASS: Python render_changed_files + build_diff_ref helpers"
  PASS=$((PASS+1))
else
  echo "FAIL: Python render_changed_files + build_diff_ref helpers"
  FAIL=$((FAIL+1))
fi

if run_python_schema_tests; then
  echo "PASS: Python parse_findings + findings_to_text schema helpers"
  PASS=$((PASS+1))
else
  echo "FAIL: Python parse_findings + findings_to_text schema helpers"
  FAIL=$((FAIL+1))
fi

if run_python_monotonic_tests; then
  echo "PASS: Python apply_downgrades is monotonic (CRITICAL→WARNING only)"; PASS=$((PASS+1))
else
  echo "FAIL: Python apply_downgrades is monotonic (CRITICAL→WARNING only)"; FAIL=$((FAIL+1))
fi

if run_python_detverify_tests; then
  echo "PASS: Python verify_deterministic staged-tree verification (Tier A)"; PASS=$((PASS+1))
else
  echo "FAIL: Python verify_deterministic staged-tree verification (Tier A)"; FAIL=$((FAIL+1))
fi

if run_python_pattern_resolution_tests; then
  echo "PASS: Python context_blocks skips missing patterns/rules (no fail-open)"; PASS=$((PASS+1))
else
  echo "FAIL: Python context_blocks skips missing patterns/rules (no fail-open)"; FAIL=$((FAIL+1))
fi

if run_python_tool_tests; then
  echo "PASS: Python run_tool read-only executor (read_file + grep + tree_ref)"; PASS=$((PASS+1))
else
  echo "FAIL: Python run_tool read-only executor (read_file + grep + tree_ref)"; FAIL=$((FAIL+1))
fi

if run_python_verifyloop_tests; then
  echo "PASS: Python verify_one_agentic + verify_agentic bounded loop (Tier B)"; PASS=$((PASS+1))
else
  echo "FAIL: Python verify_one_agentic + verify_agentic bounded loop (Tier B)"; FAIL=$((FAIL+1))
fi

CANON_ENGINE="$HOME/.local/share/claude-coworker/tools/kimi-review"
if [ -f "$CANON_ENGINE" ]; then
  # importlib requires a .py suffix to resolve the loader; the canonical engine is
  # an extensionless executable, so shim it via a temp symlink before passing in.
  CANON_TMP=$(mktemp -d)
  ln -s "$CANON_ENGINE" "$CANON_TMP/kimi_review.py"
  if run_python_helper_tests "$CANON_TMP/kimi_review.py" \
     && run_python_credential_tests "$CANON_TMP/kimi_review.py" \
     && run_python_budget_tests "$CANON_TMP/kimi_review.py" \
     && run_python_schema_tests "$CANON_TMP/kimi_review.py" \
     && run_python_monotonic_tests "$CANON_TMP/kimi_review.py" \
     && run_python_detverify_tests "$CANON_TMP/kimi_review.py" \
     && run_python_pattern_resolution_tests "$CANON_TMP/kimi_review.py" \
     && run_python_tool_tests "$CANON_TMP/kimi_review.py" \
     && run_python_verifyloop_tests "$CANON_TMP/kimi_review.py"; then
    echo "PASS: canonical engine matches vendored behavior"; PASS=$((PASS+1))
  else
    echo "FAIL: canonical engine diverges from vendored behavior"; FAIL=$((FAIL+1))
  fi
  rm -rf "$CANON_TMP"
else
  echo "SKIP: canonical engine absent — behavioral parity check"
fi

if run_python_profile_tests; then
  echo "PASS: Python profile loader reads kimi-profiles.json"; PASS=$((PASS+1))
else
  echo "FAIL: Python profile loader reads kimi-profiles.json"; FAIL=$((FAIL+1))
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
