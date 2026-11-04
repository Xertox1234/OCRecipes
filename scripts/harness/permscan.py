#!/usr/bin/env python3
"""Count Claude Code permission-system denials, by source: a settings deny rule ("Permission to
use X ... has been denied"), a built-in safety check, or the auto-mode classifier.

Usage: python3 scripts/harness/permscan.py <from YYYY-MM-DD> <to YYYY-MM-DD> [--list]
Scans every transcript (main + subagents) under the OCRecipes project dir; <to> is exclusive.
Prints the tool-result denominator per kind, then denials by source, tool, agent type and
command shape; --list prints each subagent denial. Our own guards ("PreToolUse: ... hook error")
are excluded: see guardscan.py. Harness item 10 baseline (10-10 -> 10-31): 41 subagent denials
of 20,866 subagent tool results, 36 of them `rm -r` (the owner's `Bash(rm -rf:*)` deny rule);
27 were reviewers deleting probe-* folders; the other 5 were safety-check denials.
Re-measure target: 0 reviewer `rm -r` denials.
"""
import json, os, re, sys, glob, collections

lo, hi = sys.argv[1], sys.argv[2]
show = "--list" in sys.argv
root = os.path.expanduser("~/.claude/projects/-Users-williamtower-projects-OCRecipes")
total, den = collections.Counter(), []
for f in glob.glob(root + "/**/*.jsonl", recursive=True):
    kind = "sub" if "/subagents/" in f else "main"
    agent = None
    if kind == "sub" and os.path.exists(f[:-6] + ".meta.json"):
        try:
            agent = json.load(open(f[:-6] + ".meta.json")).get("agentType")
        except (OSError, ValueError):
            pass
    uses = {}
    try:
        lines = open(f, errors="replace").read().splitlines()
    except OSError:
        continue
    for ln in lines:
        try:
            o = json.loads(ln)
        except ValueError:
            continue
        ts = o.get("timestamp", "")
        if not ts or ts < lo or ts >= hi:
            continue
        c = (o.get("message") or {}).get("content")
        if not isinstance(c, list):
            continue
        for b in c:
            if not isinstance(b, dict):
                continue
            if b.get("type") == "tool_use":
                uses[b.get("id")] = (b.get("name"), b.get("input"))
            elif b.get("type") == "tool_result":
                total[kind] += 1
                if not b.get("is_error"):
                    continue
                t = b.get("content")
                if isinstance(t, list):
                    t = " ".join(x.get("text", "") for x in t if isinstance(x, dict))
                t = str(t)
                if "hook error" in t:
                    continue
                if re.search(r"Permission to use \S+.*has been denied", t):
                    src = "deny rule"
                elif "built-in Claude Code safety check" in t:
                    src = "safety check"
                elif "auto mode classifier" in t:
                    src = "auto-mode classifier"
                else:
                    continue
                name, inp = uses.get(b.get("tool_use_id"), (None, None))
                cmd = (inp.get("command") or inp.get("file_path") or "") if isinstance(inp, dict) else ""
                den.append(dict(kind=kind, src=src, ts=ts, tool=name, agent=agent, cmd=str(cmd)))


def shape(cmd):
    first = re.split(r"[;&|\n]", cmd.strip(), maxsplit=1)[0].strip()
    if re.search(r"\brm\s+-[a-z]*r", cmd):
        return "rm -r"
    if re.match(r"^[A-Za-z_]\w*=", first):
        return "var-assign prefix"
    if re.search(r"<<\s*['\"]?\w+", cmd):
        return "heredoc"
    if re.match(r"^cd\s", first) and re.search(r"&&|;", cmd):
        return "cd-chain"
    return "other: " + (first.split() or ["?"])[0][:20]


print(f"{lo} -> {hi}: tool results {dict(total)}")
for kind in ("main", "sub"):
    rows = [r for r in den if r["kind"] == kind]
    print(f"\n{kind}: {len(rows)} permission denials")
    print("  by source", collections.Counter(r["src"] for r in rows).most_common())
    print("  by tool  ", collections.Counter(r["tool"] for r in rows).most_common())
    if kind == "sub":
        print("  by agent ", collections.Counter(r["agent"] for r in rows).most_common())
    print("  by shape ", collections.Counter(shape(r["cmd"]) for r in rows if r["tool"] == "Bash").most_common())
if show:
    for r in sorted((r for r in den if r["kind"] == "sub"), key=lambda r: r["ts"]):
        print(f"\n## {r['ts'][:16]} | {r['src']} | {r['agent']} | {r['tool']}\nCMD: " + r["cmd"][:400].replace("\n", " ⏎ "))
