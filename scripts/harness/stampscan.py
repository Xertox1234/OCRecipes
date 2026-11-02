#!/usr/bin/env python3
"""Review-stamp misses: reviewer replies that met the stamp writer's contract but left no stamp.

Usage: python3 scripts/harness/stampscan.py <from YYYY-MM-DD> <to YYYY-MM-DD> [--list]  (<to> exclusive)
Run from the repo root (the stamp directory comes from .claude/hooks/lib/review-stamp-path.sh).
Reads every reviewer subagent run that started in the window. A run is expected to leave a stamp
when its final report carries a full 40-char REVIEWED-SHA, a REVIEWED-FILES block and a deciding
last line (CRITICAL / "No findings" / "No blocking findings"); a miss is an expected run with no
<stamp dir>/<sha>/<agent>.json. Stamps live in /tmp, which loses them at reboot and thins out
files older than a few days (10-26 had 39 stamps on 10-30, 14 on 11-02), so only runs that ended
in the last 3 days are judged; older expected runs count as "too old". Run it at the end of the
window you measure. Prints misses / expected by Claude Code version; --list prints each miss. Harness diagnosis baseline (10-10 -> 10-30): 2.1.305 0/50,
2.1.308-312 11/46, since the writer's polling fix 0/12.
"""
import collections, glob, json, os, re, subprocess, sys, time

since, until = sys.argv[1], sys.argv[2]
ROOT = os.path.expanduser("~/.claude/projects/-Users-williamtower-projects-OCRecipes")
REVIEWERS = {"code-reviewer", "server-reviewer", "mobile-reviewer", "ai-reviewer", "security-auditor"}
SHA40 = re.compile(r"^REVIEWED-SHA:\s*([0-9a-f]{40})", re.M)
CRIT = re.compile(r"^\s*(\[CRITICAL\]|\*\*CRITICAL\*\*|CRITICAL:)", re.M)
STAMPS = os.path.dirname(subprocess.run(
    ["bash", "-c", 'source .claude/hooks/lib/review-stamp-path.sh && review_stamp_dir x'],
    capture_output=True, text=True, check=True).stdout.strip())
JUDGED_FROM = time.time() - 3 * 86400


def text_of(content):
    if isinstance(content, str):
        return content
    return "\n".join(b.get("text", "") for b in content or [] if isinstance(b, dict) and b.get("type") == "text")


def report_of(jsonl):
    """Start time, version, and the final report: the hand-back message, else the last text."""
    t0, version, handbacks, last_text = None, None, [], ""
    for line in open(jsonl, errors="replace"):
        try:
            d = json.loads(line)
        except ValueError:
            continue
        t0 = t0 or d.get("timestamp")
        version = version or d.get("version")
        content = (d.get("message") or {}).get("content")
        if (d.get("message") or {}).get("role") == "assistant" and isinstance(content, list):
            for b in content:
                if b.get("type") == "tool_use" and b.get("name") == "SubagentHandback":
                    handbacks.append((b.get("input") or {}).get("message", ""))
                elif b.get("type") == "text" and b.get("text", "").strip():
                    last_text = b["text"]
    report = handbacks[-1] if len(handbacks) == 1 and not SHA40.search(last_text) else (
        last_text or (handbacks[-1] if handbacks else ""))
    return t0, version or "?", report


by_version = collections.defaultdict(collections.Counter)
misses = []
for meta_path in glob.glob(ROOT + "/**/agent-*.meta.json", recursive=True):
    try:
        agent = json.load(open(meta_path)).get("agentType")
    except (OSError, ValueError):
        continue
    jsonl = meta_path[: -len(".meta.json")] + ".jsonl"
    if agent not in REVIEWERS or not os.path.exists(jsonl):
        continue
    t0, version, report = report_of(jsonl)
    if not t0 or not since <= t0 < until:
        continue
    lines = [l.strip() for l in report.splitlines() if l.strip()]
    last = lines[-1].rstrip(".") if lines else ""
    sha = SHA40.search(report)
    decided = bool(CRIT.search(report)) or last in ("No findings", "No blocking findings")
    c = by_version[version]
    c["runs"] += 1
    if not (sha and "REVIEWED-FILES:" in report and decided):
        continue
    if os.path.getmtime(jsonl) < JUDGED_FROM:
        c["too old"] += 1
        continue
    c["expected"] += 1
    if not os.path.exists(os.path.join(STAMPS, sha.group(1), agent + ".json")):
        c["missed"] += 1
        misses.append((t0, version, agent, sha.group(1)[:7], jsonl))

judged = time.strftime("%Y-%m-%d %H:%M", time.localtime(JUDGED_FROM))
print(f"{since} -> {until}; stamps in {STAMPS}; runs judged if they ended after {judged}")
print(f"{'version':12}{'runs':>6}{'too old':>9}{'missed / expected':>20}")
for v in sorted(by_version):
    c = by_version[v]
    print(f"{v:12}{c['runs']:6d}{c['too old']:9d}{c['missed']:>12d} / {c['expected']}")
if "--list" in sys.argv[3:]:
    for m in sorted(misses):
        print("  ", *m)
