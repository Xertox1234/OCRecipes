#!/usr/bin/env python3
"""Review rounds per piece of work: how many times the same work went back to review.

Usage: python3 scripts/harness/rounds.py <from YYYY-MM-DD> <to YYYY-MM-DD> [--list]  (<to> exclusive)
Reads every reviewer subagent run (code-, server-, mobile-, ai-reviewer, security-auditor)
that started in the window. Runs that share a PR number, a branch or an agent worktree are one
piece of work (a unit); a run naming none of them is grouped with others from the same session
and hour. A unit's rounds are the distinct head shas its dispatches pinned (at least 1; about a
quarter of runs pin none). Prints the distribution overall and for todo / audit / other units;
--list adds the units with 3+ rounds. Harness diagnosis baseline (10-10 -> 10-30): 680 runs,
288 units; 1: 242 · 2: 38 · 3: 6 · 4: 1 · 5: 1. Transcripts older than about three weeks are
gone, so that window can no longer be re-run in full: compare equal-length recent windows.
"""
import collections, glob, json, os, re, sys

ROOT = os.path.expanduser("~/.claude/projects/-Users-williamtower-projects-OCRecipes")
REVIEWERS = {"code-reviewer", "server-reviewer", "mobile-reviewer", "ai-reviewer", "security-auditor"}
PR_RE = re.compile(r"(?:PR\s*#?|pull/|#)(1[0-9]{3})\b")


def text_of(content):
    if isinstance(content, str):
        return content
    return "\n".join(b.get("text", "") for b in content or [] if isinstance(b, dict) and b.get("type") == "text")


def first_prompt(jsonl):
    """The dispatch prompt (first user message) and the run's start time."""
    t0 = None
    for line in open(jsonl, errors="replace"):
        try:
            d = json.loads(line)
        except ValueError:
            continue
        t0 = t0 or d.get("timestamp")
        msg = d.get("message") or {}
        if msg.get("role") == "user":
            return text_of(msg.get("content")), t0
    return "", t0


def extract(since, until):
    runs = []
    for meta_path in glob.glob(ROOT + "/**/agent-*.meta.json", recursive=True):
        try:
            meta = json.load(open(meta_path))
        except (OSError, ValueError):
            continue
        jsonl = meta_path[: -len(".meta.json")] + ".jsonl"
        if meta.get("agentType") not in REVIEWERS or not os.path.exists(jsonl):
            continue
        prompt, t0 = first_prompt(jsonl)
        if not t0 or not since <= t0 < until:
            continue
        wt = re.search(r'git -C \\?"?([^"\s`]+)', prompt)
        sha = re.search(r"short HEAD`?\s*(?:must be|=|is|==)\s*`?([0-9a-f]{7,40})", prompt) or re.search(
            r"must be `?([0-9a-f]{7,40})\b", prompt
        )
        br = (
            re.search(r"abbrev-ref HEAD`?\s*must be\s*`?([\w./-]+)", prompt)
            or re.search(r"on branch `?([\w./-]+)", prompt)
            or re.search(r"branch[:\s]+`([\w./-]+)`", prompt)
        )
        # The dispatch template pins both at once: "... must be <branch>/<short sha>".
        combo = re.search(r"must be `?([\w.-]+(?:/[\w.-]+)*)/([0-9a-f]{7,40})\b", prompt)
        branch = br.group(1) if br else (combo.group(1) if combo else None)
        head = sha.group(1) if sha else (combo.group(2) if combo else None)
        prs = PR_RE.findall(meta.get("description", "") + "\n" + prompt[:4000])
        runs.append({
            "session": jsonl.replace(ROOT + "/", "").split("/")[0],
            "ts": t0,
            "pr": prs[0] if prs else None,
            "worktree": wt.group(1).rstrip('"\\') if wt else None,
            "branch": branch,
            "head": head[:7] if head else None,
        })
    return runs


def group(runs):
    """Union runs that share a PR, a branch or an agent worktree; rounds = distinct heads."""
    parent = {}

    def find(k):
        while parent.setdefault(k, k) != k:
            k = parent[k]
        return k

    def keys(r):
        agent_wt = r["worktree"] if r["worktree"] and "/.claude/worktrees/agent-" in r["worktree"] else None
        ks = [k for k in ("PR" + r["pr"] if r["pr"] else None, r["branch"], agent_wt) if k]
        return ks or ["session:" + r["session"] + " " + r["ts"][:13]]

    for r in runs:
        ks = keys(r)
        for k in ks[1:]:
            parent[find(k)] = find(ks[0])
        find(ks[0])
    units = collections.defaultdict(list)
    for r in runs:
        units[find(keys(r)[0])].append(r)
    out = []
    for rs in units.values():
        rs.sort(key=lambda r: r["ts"])
        heads = list(dict.fromkeys(r["head"] for r in rs if r["head"]))
        branches = sorted({r["branch"] for r in rs if r["branch"]})
        prs = sorted({r["pr"] for r in rs if r["pr"]})
        kind = (
            "audit" if any("audit/" in b for b in branches)
            else "todo" if any(b.startswith(("todo/", "worktree-agent")) for b in branches)
            else "other"
        )
        name = ("PR" + prs[-1]) if prs else (branches[0] if branches else keys(rs[0])[0])
        out.append({"unit": name, "kind": kind, "runs": rs, "rounds": max(1, len(heads)), "heads": heads})
    return out


def dist(us):
    c = collections.Counter(min(u["rounds"], 6) for u in us)
    return " · ".join(f"{n if n < 6 else '6+'}: {c[n]}" for n in sorted(c))


if __name__ == "__main__":
    since, until = sys.argv[1], sys.argv[2]
    runs = extract(since, until)
    out = group(runs)
    print(f"{since} -> {until}: {len(runs)} reviewer runs, {len(out)} units")
    print(f"rounds  {dist(out)}")
    for kind in ("todo", "audit", "other"):
        us = [u for u in out if u["kind"] == kind]
        print(f"  {kind:6}{len(us):4d} units  {dist(us)}")
    if "--list" in sys.argv[3:]:
        print("\nunits with 3+ rounds (rounds, runs, kind, unit, heads):")
        for u in sorted(out, key=lambda u: -u["rounds"]):
            if u["rounds"] < 3:
                break
            print(f"  {u['rounds']} {len(u['runs']):3d} {u['kind']:6}{u['unit'][:50]:52}{' '.join(u['heads'])}")
