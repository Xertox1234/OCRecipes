#!/usr/bin/env python3
"""List and group denials by our own PreToolUse guards (tool results starting "PreToolUse:").

Usage: python3 scripts/harness/guardscan.py <since YYYY-MM-DD> [--list]
Scans every transcript (main + subagents) under the OCRecipes project dir. Prints the
tool-result denominator, then denial counts grouped by the first words of the guard's reason;
--list also prints each denial with its command. Harness item 8 baseline (10-30 -> 11-01):
31 denials, 21 friction; its re-measure target is 0 stale pass-stamp and 0 own-worktree
denials. Permission-system denials are a different source: see permscan.py.
"""
import json, os, re, sys, glob, collections, time

since = sys.argv[1]
show = "--list" in sys.argv
root = os.path.expanduser("~/.claude/projects/-Users-williamtower-projects-OCRecipes")
cut = time.mktime(time.strptime(since, "%Y-%m-%d"))
rows, total = [], 0
for f in glob.glob(root + "/**/*.jsonl", recursive=True):
    if os.path.getmtime(f) < cut:
        continue
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
        if ts < since:
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
                total += 1
                t = b.get("content")
                if isinstance(t, list):
                    t = " ".join(x.get("text", "") for x in t if isinstance(x, dict))
                if not isinstance(t, str) or not t.startswith("PreToolUse:"):
                    continue
                name, inp = uses.get(b.get("tool_use_id"), ("?", {}))
                cmd = (inp.get("command") or inp.get("file_path") or json.dumps(inp)[:300]) if isinstance(inp, dict) else str(inp)
                why = re.sub(r"^PreToolUse:\S+ hook error:\s*", "", t).replace("\n", " ")
                rows.append((ts[:16], "sub" if "/subagents/" in f else "main", name, cmd.replace("\n", " ⏎ ")[:400], why[:260]))

print(f"since {since}: {total} tool results, {len(rows)} guard denials")
groups = collections.Counter(" ".join(re.sub(r"[^\w' -]", " ", r[4]).split()[:6]) for r in rows)
for g, n in groups.most_common():
    print(f"{n:4d}  {g}")
if show:
    for r in sorted(rows):
        print("\n## " + " | ".join(r[:3]) + "\nCMD: " + r[3] + "\nWHY: " + r[4])
