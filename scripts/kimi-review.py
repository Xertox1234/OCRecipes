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
                print(f"Error: pattern file not found: {path}", file=sys.stderr)
                sys.exit(1)
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
    requested tiers. Tier is normalized to uppercase. Returns [] on malformed
    JSON (caller treats as clean)."""
    allowed = {t.upper() for t in requested_tiers}
    try:
        data = json.loads(answer)
    except (ValueError, TypeError):
        return []
    out = []
    for f in data.get("findings", []):
        tier = f.get("tier", "").upper()
        if tier in allowed:
            f = dict(f)
            f["tier"] = tier
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
        timeout=90.0,
    )

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

    finish_reason = response.choices[0].finish_reason
    answer = response.choices[0].message.content
    if finish_reason == "length":
        print("[ERROR: response truncated — raise --max-tokens]", file=sys.stderr)
        sys.exit(1)
    if not answer:
        print("[ERROR: ran out of tokens — raise --max-tokens]", file=sys.stderr)
        sys.exit(1)

    findings = parse_findings(answer, requested_tiers)
    text = findings_to_text(findings)
    print(text if text else f"No findings in requested tiers: {', '.join(requested_tiers)}")

    usage = response.usage
    cached = getattr(getattr(usage, "prompt_tokens_details", None), "cached_tokens", 0) or 0
    print(
        f"\n[kimi: {usage.prompt_tokens} in ({cached} cached) / "
            f"{usage.completion_tokens} out | finish: {finish_reason}]",
        file=sys.stderr,
    )

    # (Phase 3/4 insert verification here, mutating `findings` before this point.)
    if any(f["tier"].upper() == "CRITICAL" for f in findings):
        sys.exit(2)


if __name__ == "__main__":
    main()
