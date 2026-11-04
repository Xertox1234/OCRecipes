#!/usr/bin/env python3
"""Count zsh-shell errors in Bash tool results, with the command that caused each.

Usage: python3 scripts/harness/zshscan.py <since YYYY-MM-DD> <out.jsonl>
Denominator: every Bash tool_result in transcripts (main + subagents) modified since <since>.
Harness diagnosis item 9's baseline (10-10 -> 11-01): 1,111 "no matches found" in 33,318 Bash
results, 939 of them not flagged as errors (the glob's command never ran; the rest went on).
Fixed by `setopt nonomatch` in ~/.zshenv for Claude Code shells; see docs/solutions/best-practices/
zsh-unmatched-glob-silently-skips-grep-in-claude-bash-2026-11-01.md.
"""
import json, os, re, sys, glob, collections, time

since, out = sys.argv[1], sys.argv[2]
root = os.path.expanduser("~/.claude/projects/-Users-williamtower-projects-OCRecipes")
cut = time.mktime(time.strptime(since, "%Y-%m-%d"))
PATS = [
    ("nomatch", re.compile(r"\(eval\):\d+: no matches found: (\S+)")),
    ("parse", re.compile(r"\(eval\):\d+: parse error near [`'](.{0,20})")),
    ("badpattern", re.compile(r"\(eval\):\d+: bad pattern: (\S+)")),
    ("badsubst", re.compile(r"\(eval\):\d+: bad substitution")),
    ("notfound", re.compile(r"\(eval\):\d+: command not found: (\S+)")),
    ("other-eval", re.compile(r"\(eval\):\d+: ([a-z][^:\n]{0,40})")),
]
rows, nbash, nfiles = [], 0, 0
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
        c = (o.get("message") or {}).get("content")
        if not isinstance(c, list):
            continue
        for b in c:
            if not isinstance(b, dict):
                continue
            if b.get("type") == "tool_use":
                uses[b.get("id")] = (b.get("name"), b.get("input") or {})
            elif b.get("type") == "tool_result" and ts >= since:
                name, inp = uses.get(b.get("tool_use_id"), (None, {}))
                if name != "Bash":
                    continue
                nbash += 1
                t = b.get("content")
                if isinstance(t, list):
                    t = " ".join(x.get("text", "") for x in t if isinstance(x, dict))
                t = t or ""
                for kind, rx in PATS:
                    m = rx.search(t)
                    if m:
                        rows.append({"ts": ts, "day": ts[:10], "sub": "/subagents/" in f, "kind": kind,
                                     "what": m.group(1) if m.groups() else "", "err": bool(b.get("is_error")),
                                     "cmd": inp.get("command", "")[:400], "file": f.replace(root, "")})
                        break
with open(out, "w") as fh:
    for r in rows:
        fh.write(json.dumps(r) + "\n")
print(f"files {nfiles}; Bash results {nbash}; zsh errors {len(rows)} ({len(rows)/max(nbash,1):.2%}); subagents {sum(r['sub'] for r in rows)}")
print(collections.Counter(r["kind"] for r in rows).most_common())
byday = collections.Counter(r["day"] for r in rows)
print("per day:", " ".join(f"{d[5:]}:{n}" for d, n in sorted(byday.items())))
