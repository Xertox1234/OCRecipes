#!/usr/bin/env python3
"""Canonical kimi-review engine (cross-project home).

Reads a unified diff from stdin, sends it to an OpenAI-compatible endpoint, and
prints CRITICAL / WARNING / SUGGESTION findings in the same format as the local
developer kimi-review helper.
"""

import argparse
import json
import os
import pathlib
import re
import subprocess
import sys
import time


TIER_DEFINITIONS = {
    "CRITICAL": "bugs, security holes, data loss risks, broken logic",
    "WARNING": "performance issues, bad patterns, missing error handling",
    "SUGGESTION": "style, readability, minor improvements",
}

DEFAULT_BASE_URL = "https://openrouter.ai/api/v1"


def load_profiles(path):
    """Load project profiles from a JSON file. Missing/unreadable -> {}."""
    try:
        return json.loads(pathlib.Path(path).read_text(errors="replace"))
    except (OSError, ValueError):
        return {}


PROFILES = load_profiles(pathlib.Path(__file__).resolve().parent / "kimi-profiles.json")


def parse_args():
    profile_choices = sorted({"auto", "generic"} | set(PROFILES.keys()))
    parser = argparse.ArgumentParser(description="Code review via Kimi")
    parser.add_argument("--base", default=None, help="Branch or commit to diff against")
    parser.add_argument("--scope", default=None, help="One-line context for the reviewer")
    parser.add_argument("--paths", nargs="+", help="Files to include as full content for context")
    parser.add_argument(
        "--patterns",
        default=None,
        help="Comma-separated docs/patterns names or paths to include as review context",
    )
    parser.add_argument(
        "--pattern-max-chars",
        type=int,
        default=12000,
        help="Maximum characters to include from each pattern file; 0 for full files",
    )
    parser.add_argument("--max-tokens", type=int, default=131072)
    parser.add_argument("--model", default=os.environ.get("WORKER_MODEL", "deepseek/deepseek-v4-flash"))
    parser.add_argument("--tiers", default="CRITICAL,WARNING,SUGGESTION")
    parser.add_argument("--rules", default=None, help="Comma-separated docs/rules names to include")
    parser.add_argument(
        "--changed-files",
        default=None,
        help="Newline-delimited `git diff --name-status` output for the full "
             "change-set; rendered as a <changed-files> block so the reviewer "
             "knows which non-.ts/.tsx files (migrations, config) exist.",
    )
    parser.add_argument("--profile", choices=profile_choices, default="auto")
    parser.add_argument(
        "--verify", choices=["off", "deterministic", "agentic"], default="off",
        help="Post-draft verification: off | deterministic (Tier A gate) | agentic (Tier B)",
    )
    return parser.parse_args()


def validate_tiers(tiers):
    requested = [tier.strip().upper() for tier in tiers.split(",") if tier.strip()]
    invalid = [tier for tier in requested if tier not in TIER_DEFINITIONS]
    if invalid:
        valid = ", ".join(TIER_DEFINITIONS)
        print(f"Error: invalid --tiers value(s): {', '.join(invalid)}. Valid tiers: {valid}", file=sys.stderr)
        sys.exit(2)
    if not requested:
        print("Error: --tiers must include at least one tier.", file=sys.stderr)
        sys.exit(2)
    return requested


def git_root():
    result = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True)
    return result.stdout.strip() if result.returncode == 0 else None


def get_diff(args, root):
    stdin_data = sys.stdin.read() if not sys.stdin.isatty() else ""
    if stdin_data.strip():
        return stdin_data

    if not root:
        print("Error: not inside a git repository.", file=sys.stderr)
        sys.exit(1)

    ref = build_diff_ref(args.base)
    result = subprocess.run(["git", "diff", "--function-context", ref], capture_output=True, text=True, cwd=root)
    if result.returncode != 0:
        print(f"Error: git diff failed.\n{result.stderr.strip()}", file=sys.stderr)
        sys.exit(1)
    if not result.stdout.strip():
        print(f"Error: git diff {ref} produced no output.", file=sys.stderr)
        sys.exit(1)
    return result.stdout


def detect_profile(args, root):
    if args.profile != "auto":
        return args.profile
    if not root:
        return "generic"
    root_path = pathlib.Path(root)
    claude_md = root_path / "CLAUDE.md"
    claude_head = claude_md.read_text(errors="replace")[:2000] if claude_md.exists() else ""
    if "ocrecipes" in PROFILES and (root_path.name == "OCRecipes" or "OCRecipes" in claude_head):
        return "ocrecipes"
    if "plant_id" in PROFILES and (root_path.name == "plant_id_community" or "Plant ID Community" in claude_head):
        return "plant_id"
    return "generic"


def resolve_pattern_path(pattern, root):
    candidate = pathlib.Path(pattern)
    if candidate.suffix == "":
        candidate = pathlib.Path("docs") / "patterns" / f"{pattern}.md"
    elif candidate.parts[:2] != ("docs", "patterns") and len(candidate.parts) == 1:
        candidate = pathlib.Path("docs") / "patterns" / candidate.name

    if candidate.is_absolute():
        return candidate

    base = pathlib.Path(root) if root else pathlib.Path.cwd()
    resolved = base / candidate
    if not resolved.exists() and candidate.parts[:2] == ("docs", "patterns"):
        legacy = base / "docs" / "legacy-patterns" / candidate.name
        if legacy.exists():
            return legacy
    return resolved


def context_blocks(args, root):
    paths = []
    if args.paths:
        paths.extend(pathlib.Path(path) for path in args.paths)

    if args.patterns:
        for pattern in args.patterns.split(","):
            pattern = pattern.strip()
            if not pattern:
                continue
            path = resolve_pattern_path(pattern, root)
            if not path.exists():
                # Warn and skip rather than sys.exit: a hard exit here returns a
                # non-2 status that fail-OPENS the local commit gate on every TS
                # commit if a pattern dir is ever pruned. Matches --rules below.
                print(f"Warning: pattern file not found, skipping: {path}", file=sys.stderr)
                continue
            paths.append(path)

    if args.rules:
        base = pathlib.Path(root) if root else pathlib.Path.cwd()
        for name in args.rules.split(","):
            name = name.strip()
            if not name:
                continue
            path = base / "docs" / "rules" / f"{name}.md"
            if path.exists():
                paths.append(path)

    blocks = []
    for path in paths:
        content = path.read_text(errors="replace")
        if args.pattern_max_chars > 0 and len(content) > args.pattern_max_chars:
            content = content[: args.pattern_max_chars] + "\n\n[TRUNCATED]"
        blocks.append(f"<file path='{path}'>\n{content}\n</file>")
    return "\n\n" + "\n\n".join(blocks) if blocks else ""


def resolve_client_config(env=os.environ):
    base_url = env.get("WORKER_BASE_URL") or DEFAULT_BASE_URL
    api_key = env.get("WORKER_API_KEY") or env.get("OPENROUTER_API_KEY") or ""
    if not api_key and env.get("MOONSHOT_API_KEY"):
        if not env.get("WORKER_BASE_URL"):
            print("Error: MOONSHOT_API_KEY requires WORKER_BASE_URL.", file=sys.stderr)
            sys.exit(1)
        api_key = env.get("MOONSHOT_API_KEY", "")
    if not api_key:
        print(
            "Error: set WORKER_API_KEY, OPENROUTER_API_KEY, or MOONSHOT_API_KEY with WORKER_BASE_URL.",
            file=sys.stderr,
        )
        sys.exit(1)
    return api_key, base_url


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
    requested tiers. Tier is normalized to uppercase. Every returned finding is a
    complete, well-typed dict; findings missing required fields (file/detail/tier)
    are dropped. Defense-in-depth: strict json_schema is not guaranteed across all
    providers, and a malformed finding must never KeyError-crash the engine — a
    crash exits non-2 and the local wrappers fail-open, which would silently let a
    real CRITICAL through the gate. Returns [] on malformed JSON (treated as clean)."""
    allowed = {t.upper() for t in requested_tiers}
    try:
        data = json.loads(answer)
    except (ValueError, TypeError):
        return []
    if not isinstance(data, dict):
        return []
    out = []
    for f in data.get("findings", []):
        if not isinstance(f, dict):
            continue
        tier = str(f.get("tier", "")).upper()
        file = f.get("file")
        detail = f.get("detail")
        if tier not in allowed or not file or not detail:
            continue
        line = f.get("line")
        symbol = f.get("symbol")
        out.append({
            "tier": tier,
            "claim_type": f.get("claim_type") or "semantic",
            "file": str(file),
            "line": line if isinstance(line, int) else None,
            "symbol": symbol if isinstance(symbol, str) else None,
            "detail": str(detail),
        })
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
                verdicts.append("downgrade")
            elif sym:
                verdicts.append("keep")
            else:
                verdicts.append("downgrade")
        elif ct == "line_assertion":
            content = _staged_file(f["file"], cwd)
            quote = f.get("symbol") or ""
            lines = content.splitlines() if content is not None else []
            ln = f.get("line")
            on_line = lines[ln - 1] if isinstance(ln, int) and 1 <= ln <= len(lines) else ""
            if quote and on_line and _normalize(quote) in _normalize(on_line):
                verdicts.append("keep")
            else:
                verdicts.append("downgrade")
        else:
            verdicts.append("downgrade")
    return verdicts


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
        cmd = ["git", "grep", "-n", "-F"]
        if tree_ref:
            cmd.extend(["-e", pattern, tree_ref])
        else:
            cmd.extend(["--untracked", "-e", pattern])
        r = subprocess.run(cmd, capture_output=True, text=True, cwd=root)
        return r.stdout[:8000] if r.stdout else "(no matches)"
    return f"error: unknown tool {name}"


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
    except Exception as error:
        # Any unrecoverable verify failure: never propagate — fail safe toward
        # keeping the CRITICAL for human review (the user chose keep-on-deadline).
        # A persistent empty verdict (call_with_retry exhausted its retries on
        # _verdict_acceptable) is an upstream/model hiccup, not an engine bug, so log
        # one line for it. Surface anything else with a full traceback so a genuine
        # bug (typo, bad import) is visible in CI instead of vanishing in the pool.
        if isinstance(error, RuntimeError) and str(error).startswith("empty"):
            print("[kimi verify: empty verdict after retries — keeping CRITICAL unverified]",
                  file=sys.stderr)
        else:
            import traceback
            traceback.print_exc()
        return "keep_unverified"


def _harvest_verdict(fut):
    """Resolve a future's verdict after the waiter has timed out. A future that
    already completed keeps its real result (blocker E: as_completed may time
    out before yielding an already-done future); an unfinished one is
    kept-unverified. fut.result() never raises here — verify_one_agentic always
    returns a verdict string and swallows its own exceptions."""
    return fut.result() if fut.done() else "keep_unverified"


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
        # A negative `remaining` (deadline already past) is intentional: passing it as
        # as_completed(timeout=negative) raises TimeoutError immediately -> the harvest
        # loop runs -> every unfinished CRITICAL becomes keep_unverified.
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


def main():
    args = parse_args()
    requested_tiers = validate_tiers(args.tiers)
    root = git_root()
    diff = get_diff(args, root)
    profile = detect_profile(args, root)

    focus = f"Focus: {args.scope}\n\n" if args.scope else ""
    changed_block = render_changed_files(args.changed_files)
    changed_section = f"\n\n{changed_block}" if changed_block else ""
    user_msg = f"{focus}<diff>\n{diff}\n</diff>{changed_section}{context_blocks(args, root)}"

    tier_lines = "\n".join(f"{tier} — {TIER_DEFINITIONS[tier]}" for tier in requested_tiers)
    profile_guidance = PROFILES.get(profile, "")
    profile_block = f"\n\n{profile_guidance}" if profile_guidance else ""

    try:
        from openai import OpenAI
    except ImportError:
        print("Error: missing Python package 'openai'. Install with: python -m pip install 'openai>=1.0.0,<2'", file=sys.stderr)
        sys.exit(1)

    api_key, base_url = resolve_client_config()

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

    system_prompt = (
        "You are a senior code reviewer auditing a code change. "
        "Your review is a quality gate — defects you miss reach production.\n\n"
        "Input: a unified git diff (with function-level context) inside <diff>, "
        "optionally followed by a <changed-files> block listing every file in the "
        "change-set, then optional <file> blocks containing source context, "
        "docs/patterns/* convention docs, or docs/rules/* checklists.\n\n"
        "Return findings only in these tiers:\n\n"
        f"{tier_lines}\n\n"
        "Review the change systematically, in this priority order — earlier "
        "categories outrank later ones when triaging effort:\n"
        "1. Security & access control — authn/authz, ownership and userId checks, "
        "injection, SSRF, secret or token exposure, unsafe input handling.\n"
        "2. Data integrity — transactions, race conditions, corruption of persisted "
        "state, migration and schema safety.\n"
        "3. Correctness — logic errors, wrong conditionals, off-by-one, unhandled "
        "cases, broken control flow.\n"
        "4. Error handling & resilience — unhandled rejections, swallowed errors, "
        "missing validation at boundaries.\n"
        "5. Regression risk — changed shared behavior, broken contracts, removed "
        "guards or checks.\n"
        "6. Test coverage — missing tests for the above when the diff changes "
        "shared behavior, security boundaries, or storage contracts.\n\n"
        "Treat any included docs/patterns or docs/rules file as the project's "
        "binding standards — flag violations and cite the specific convention."
        "\n\nYou see a partial view: a diff with function-level context, not "
        "necessarily whole files. The <changed-files> block lists EVERY file in "
        "this change-set; files not shown in <diff> (e.g. .sql migrations, config, "
        "JSON) were still changed and their existence is established. NEVER raise a "
        "finding claiming a file, migration, test, index, or guard is missing when "
        "it appears in <changed-files>. If a risk depends on code you cannot see, "
        "raise it only as WARNING and state explicitly what must be verified."
        f"{profile_block}\n\n"
        "Constraints:\n"
        "- Calibrate severity honestly. Do not inflate a WARNING into a CRITICAL, "
        "and never invent findings to fill a tier.\n"
        "- If the diff lacks the context to confirm a risk, report it only when the "
        "risk is concrete, and state what must be checked.\n"
        "- Report style preferences only when SUGGESTION is a requested tier.\n\n"
        'Return a JSON object {"findings": [...]}. Each finding has:\n'
        "- tier: CRITICAL | WARNING | SUGGESTION\n"
        "- claim_type: absent_symbol (you assert code/guard/test is missing) | "
        "line_assertion (you assert a specific line does/says something) | "
        "semantic (you assert behavior is wrong but it needs reasoning, not a lookup)\n"
        "- file: repo-relative path\n"
        "- line: the line number you are citing, or null\n"
        "- symbol: the identifier your claim is about (the asserted-missing or asserted-present name), or null\n"
        "- detail: one or two sentences on why it is wrong and what to fix\n"
        'Return {"findings": []} when there are no issues. Do not praise. Do not summarize the diff.'
    )

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

    finish_reason = response.choices[0].finish_reason
    answer = response.choices[0].message.content
    if finish_reason == "length":
        print("[ERROR: response truncated — raise --max-tokens]", file=sys.stderr)
        sys.exit(1)
    if not answer:
        print("[ERROR: ran out of tokens — raise --max-tokens]", file=sys.stderr)
        sys.exit(1)

    findings = parse_findings(answer, requested_tiers)

    if args.verify == "deterministic":
        verdicts = verify_deterministic(findings, cwd=root)
        findings = apply_downgrades(findings, {i: v for i, v in enumerate(verdicts)})
    elif args.verify == "agentic":
        # CI sets KIMI_REVIEW_HEAD_SHA and checks out the BASE tree, so PR-head
        # content is only reachable by sha. Local/manual runs leave it unset =>
        # working tree. This is the Tier B half of the spec's tree-discipline rule.
        head_ref = os.environ.get("KIMI_REVIEW_HEAD_SHA") or None
        verdicts = verify_agentic(findings, client, args.model, root, tree_ref=head_ref, deadline=deadline)
        findings = apply_downgrades(findings, {i: v for i, v in enumerate(verdicts)})

    text = findings_to_text(findings)
    print(text if text else f"No findings in requested tiers: {', '.join(requested_tiers)}")

    usage = response.usage
    cached = getattr(getattr(usage, "prompt_tokens_details", None), "cached_tokens", 0) or 0
    print(
        f"\n[kimi: {usage.prompt_tokens} in ({cached} cached) / "
            f"{usage.completion_tokens} out | finish: {finish_reason}]",
        file=sys.stderr,
    )

    if any(f["tier"].upper() == "CRITICAL" for f in findings):
        sys.exit(2)


if __name__ == "__main__":
    main()
