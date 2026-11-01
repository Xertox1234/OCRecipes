#!/usr/bin/env python3
"""Pair Claude Code worktree-isolation refusals with the command they refused.

Usage: python3 scripts/harness/isoscan.py <since YYYY-MM-DD> <out.jsonl>
Scans every transcript (main + subagents) under the OCRecipes project dir. Harness diagnosis
item 2's baseline (10-10 -> 10-30): 452 refusals, 418 in subagents.
"""
import json, os, re, sys, glob, collections, time

since, out = sys.argv[1], sys.argv[2]
root = os.path.expanduser("~/.claude/projects/-Users-williamtower-projects-OCRecipes")
cut = time.mktime(time.strptime(since, "%Y-%m-%d"))
rows, nfiles = [], 0
for f in glob.glob(root + "/**/*.jsonl", recursive=True):
    if os.path.getmtime(f) < cut:
        continue
    nfiles += 1
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
        msg = o.get("message") or {}
        c = msg.get("content")
        if not isinstance(c, list):
            continue
        for b in c:
            if not isinstance(b, dict):
                continue
            if b.get("type") == "tool_use":
                uses[b.get("id")] = (b.get("name"), b.get("input") or {})
            elif b.get("type") == "tool_result" and ts >= since:
                t = b.get("content")
                if isinstance(t, list):
                    t = " ".join(x.get("text", "") for x in t if isinstance(x, dict))
                t = t or ""
                if "isolated in the worktree" not in t:
                    continue
                m = re.search(r"but this command (.{0,90})", t)
                reason = m.group(1) if m else t[:90]
                name, inp = uses.get(b.get("tool_use_id"), (None, {}))
                rows.append({
                    "ts": ts, "file": f.replace(root, ""), "sub": "/subagents/" in f,
                    "tool": name, "cmd": inp.get("command") or inp.get("file_path") or "",
                    "reason": reason,
                })
with open(out, "w") as fh:
    for r in rows:
        fh.write(json.dumps(r) + "\n")
print(f"files scanned: {nfiles}; refusals: {len(rows)}; in subagents: {sum(r['sub'] for r in rows)}")
def bucket(reason):
    for k in ["runs rtk", "too complex", "outside", "main checkout", "cd ", "sources", "bash -c", "substitution"]:
        if k in reason:
            return k
    return reason[:50]
cnt = collections.Counter(bucket(r["reason"]) for r in rows)
for k, v in cnt.most_common():
    print(f"{v:5}  {k}")
