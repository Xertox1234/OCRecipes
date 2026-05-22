#!/usr/bin/env python3
"""Minimal kimi-review CLI for CI.

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

PROJECT_PROFILES = {
    "generic": "",
    "ocrecipes": """
Project profile: OCRecipes (Expo/React Native + Express/Drizzle/PostgreSQL nutrition app).

Review priorities:
- Auth/security: Bearer JWT auth only; flag missing ownership/userId checks, IDOR risks, token leaks, secret exposure, unsafe admin paths.
- Health/nutrition data: flag cross-user data access, unsafe medical/nutrition advice paths, and changes that could corrupt logs, meal plans, receipts, pantry, or IAP state.
- API/backend: Express route handlers should use existing error/auth patterns; Drizzle queries should preserve transactions, soft-delete/ownership filters, and JSONB safety.
- Client: React Native/Expo code should follow existing navigation, safe-area, accessibility, TanStack Query, and theme patterns; flag web-only assumptions.
- AI/evals: prompt, classifier, and eval changes should preserve safety/accuracy gates, cache-key isolation, deterministic behavior where intended, and avoid prompt-injection regressions.
- Tests: flag missing focused tests only when the diff changes shared behavior, security boundaries, storage contracts, navigation flows, or AI routing/eval semantics.
""".strip(),
}


def load_profiles(path):
    """Load project profiles from a JSON file. Missing/unreadable -> {}."""
    try:
        return json.loads(pathlib.Path(path).read_text(errors="replace"))
    except (OSError, ValueError):
        return {}


def parse_args():
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
    parser.add_argument("--profile", choices=["auto", "generic", "ocrecipes"], default="auto")
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
    if root_path.name == "OCRecipes" or "OCRecipes" in claude_head:
        return "ocrecipes"
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


# A real finding cites a file location, per the mandated format
# `[TIER] path/to/file.ts:42 — description`. A bracketed line that cites no file
# ("[CRITICAL] No critical issues found.") is the model decorating an empty tier
# against instructions — a placeholder. We err toward keeping anything file-like:
# dropping a real finding is unrecoverable, whereas a stray placeholder is caught
# by the CI/Husky gate's stricter [CRITICAL]+:line grep.
_FILE_REF_RE = re.compile(r"/|:\d|\.\w{1,6}\b")


def filter_review(answer, requested_tiers):
    """Return the review text to print: allowed-tier findings, else the clean message.

    A bracketed `[TIER]` line counts as a real finding only when its body
    references a file location. A bracketed line that references no file is an
    empty-tier placeholder the model emitted against instructions — it is
    dropped and does not count as a finding.
    """
    allowed_tiers = {t.upper() for t in requested_tiers}
    filtered_lines = []
    keep_current_finding = False
    saw_finding = False
    for line in answer.splitlines():
        stripped = line.lstrip()
        if stripped.startswith("[") and "]" in stripped:
            tier = stripped[1 : stripped.index("]")].strip().upper()
            body = stripped[stripped.index("]") + 1 :]
            is_finding = bool(_FILE_REF_RE.search(body))
            saw_finding = True
            keep_current_finding = is_finding and tier in allowed_tiers
            if keep_current_finding:
                filtered_lines.append(line)
        elif keep_current_finding or not saw_finding:
            filtered_lines.append(line)
    filtered = "\n".join(filtered_lines).strip()
    return filtered or f"No findings in requested tiers: {', '.join(requested_tiers)}"


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
    profile_guidance = PROJECT_PROFILES[profile]
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

    try:
        response = client.chat.completions.create(
            model=args.model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a senior code reviewer auditing a code change. "
                        "Your review is a quality gate; defects you miss reach production.\n\n"
                        "Input: a unified git diff (with function-level context) inside <diff>, "
                        "optionally followed by a <changed-files> block listing every file in the "
                        "change-set, then optional <file> blocks.\n\n"
                        "Return findings only in these tiers:\n\n"
                        f"{tier_lines}\n\n"
                        "Review in this priority order: security/access control, data integrity, "
                        "correctness, error handling, regression risk, then test coverage. "
                        "Treat included rules or patterns as binding project standards."
                        "\n\nYou see a partial view, not whole files. The <changed-files> block "
                        "lists EVERY file in this change-set; files not shown in <diff> (e.g. .sql "
                        "migrations, config) were still changed and their existence is established. "
                        "NEVER claim a file, migration, test, index, or guard is missing when it "
                        "appears in <changed-files>. If a risk depends on code you cannot see, "
                        "raise it only as WARNING and say what must be verified."
                        f"{profile_block}\n\n"
                        "Format every finding exactly as:\n"
                        "[TIER] path/to/file.ts:42 — short description\n"
                        "  Detail: one or two sentences on why it is wrong and what to fix.\n\n"
                        "Order findings most-severe first within each tier. Omit tiers with no findings. "
                        "Do not summarize the diff. Do not praise. Find problems."
                    ),
                },
                {"role": "user", "content": user_msg},
            ],
            max_tokens=args.max_tokens,
            temperature=0,
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

    print(filter_review(answer, requested_tiers))

    usage = response.usage
    cached = getattr(getattr(usage, "prompt_tokens_details", None), "cached_tokens", 0) or 0
    print(
        f"\n[kimi: {usage.prompt_tokens} in ({cached} cached) / "
            f"{usage.completion_tokens} out | finish: {finish_reason}]",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()