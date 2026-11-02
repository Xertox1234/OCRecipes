#!/usr/bin/env python3
"""Token usage of subagent runs, by agent type, plus /todo executor runs.

Usage: python3 scripts/harness/agentcost.py <since YYYY-MM-DD>
Scans subagent transcripts under the OCRecipes project dir (agent type from each run's
.meta.json). Per type: runs, turns per run, first-turn context (system prompt + dispatch,
which is where an agent definition's size shows), and total cache reads/writes and output.
/todo and /todo-fast executors are general-purpose runs that read todo-executor.md; they
get their own line. Harness items 4/5 baseline (10-10 -> 11-02): code-reviewer 395 runs,
9.8 turns/run, first-turn context ~72K; executor 61 runs, ~102 turns/run. Re-measure target
after #1689/#1690: code-reviewer first-turn context ~53K.
"""
import json, os, sys, glob, collections, time

since = sys.argv[1]
root = os.path.expanduser("~/.claude/projects/-Users-williamtower-projects-OCRecipes")
cut = time.mktime(time.strptime(since, "%Y-%m-%d"))
S = collections.defaultdict(collections.Counter)
for meta in glob.glob(root + "/**/subagents/*.meta.json", recursive=True):
    f = meta[: -len(".meta.json")] + ".jsonl"
    if not os.path.exists(f) or os.path.getmtime(f) < cut:
        continue
    try:
        kind = json.load(open(meta)).get("agentType", "?")
    except (OSError, ValueError):
        continue
    lines = open(f, errors="replace").read().splitlines()
    if kind == "general-purpose" and lines and "todo-executor.md" in lines[0][:5000]:
        kind = "general-purpose (/todo executor)"
    turns, first, cr, cw, out = 0, None, 0, 0, 0
    for ln in lines:
        try:
            o = json.loads(ln)
        except ValueError:
            continue
        if o.get("timestamp", "") < since or o.get("type") != "assistant":
            continue
        u = (o.get("message") or {}).get("usage")
        if not u:
            continue
        turns += 1
        first = first or u
        cr += u.get("cache_read_input_tokens", 0)
        cw += u.get("cache_creation_input_tokens", 0)
        out += u.get("output_tokens", 0)
    if not turns:
        continue
    s = S[kind]
    s["runs"] += 1
    s["turns"] += turns
    s["cread"] += cr
    s["cwrite"] += cw
    s["out"] += out
    s["first"] += sum(first.get(k, 0) for k in ("cache_read_input_tokens", "cache_creation_input_tokens", "input_tokens"))

print(f"since {since}")
print(f"{'agent':34}{'runs':>6}{'turns/run':>10}{'1st ctx':>9}{'cread M':>9}{'cwrite M':>9}{'out M':>7}")
for a, s in sorted(S.items(), key=lambda x: -x[1]["cread"]):
    r = s["runs"]
    print(f"{a[:33]:34}{r:6d}{s['turns'] / r:10.1f}{s['first'] // r:9d}{s['cread'] / 1e6:9.1f}{s['cwrite'] / 1e6:9.1f}{s['out'] / 1e6:7.2f}")
