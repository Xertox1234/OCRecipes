# Overnight Todo Automation Runbook (`/goal` + `/todo`)

How to let Claude Code work through the `todos/` backlog with minimal supervision —
implement, open PRs, and (once trusted) auto-merge low-priority work on green CI.

`/goal` is a **native Claude Code CLI command**: you set a completion condition and
Claude keeps working across turns until it's met, with a live elapsed/turns/tokens
overlay. `/todo` is the worker it drives (worktree-isolated executors, kimi-gated).
`/goal` is the supervisor loop; `/todo` does the work.

## The five-filter safety model

No sleeping human is in the loop, so five independent filters stand in:

1. **CI (required)** — `main` physically refuses any PR whose 5 checks aren't green
   (Lint·Types·Patterns, Tests 1-3/3, Coverage). No human approval is required by
   branch protection — only green CI. That is the repo's real merge bar.
2. **kimi-review** — CRITICAL findings block the commit (semantic skim at commit time).
3. **`scripts/todo-automerge-guard.sh`** — fail-CLOSED allowlist; HOLDs any PR that
   touches a path outside the known-safe set (catches a mislabeled-severity todo).
4. **Bounded stop conditions** — the `/goal` condition halts on N merges / token cap /
   2 reds, so a systemic mistake can't merge many bad PRs before you wake.
5. **In-loop `update-branch`** — the loop runs `gh pr update-branch` right before each
   merge, re-passing CI against current main and closing the stale-merge hole (see gate).

## Rollout: debut attended, graduate to asleep

**Do NOT make the first unattended-while-asleep run your debut.** The first run is the
one most likely to surface an unmodeled edge.

- **Tonight / first runs — ATTENDED.** Run `/todo` foreground and watch. The current
  backlog (≈11 todos, mostly P3) clears in one sitting. Fix whatever stumbles.
- **Graduate to unattended** only after a clean attended run **and** the gate below.

### Pre-unattended gate (all must be true)

- [ ] Stale-merge gap closed. The `/goal` block already runs `gh pr update-branch`
      immediately before each merge (the surgical, automation-only fix). Branch
      protection `strict: true` is an OPTIONAL belt-and-suspenders — see below.
- [ ] Guard script proven on a few real PRs (HOLDs the right things).
- [ ] Auto-mode coverage confirmed by an attended run. **Already in place:** the
      scoped `gh pr merge --squash --delete-branch` rule, `Bash(git:*)` /
      `Bash(gh pr:*)` / `Bash(npm run *)`, and `Bash(scripts/todo-automerge-guard.sh:*)`.
      **Unconfirmed until the debut:** whether the classifier waves through `git push`
      of feature branches and `gh pr create` under `$defaults` (low-impact, likely
      fine). If either blocks while you watch, add a tightly-scoped `autoMode.allow`
      entry then — do NOT pre-widen blind.

### The stale-merge gap (why the loop runs `update-branch`)

With `strict: false`, PR-B can pass CI against an _old_ main, merge stale, and redden
main even with zero file overlap with PR-A — nothing re-runs B's checks. The `/goal`
block closes this **in-loop**: `gh pr update-branch <pr>` immediately before merge
re-runs CI against current main. For a sequential overnight run (no concurrent merger
while you sleep) this is sufficient — the only way main goes stale mid-merge is a
second merger, and there isn't one.

Optional server-side enforcement: set required-checks `strict: true`. GitHub then
forces _every_ PR up-to-date before merge — but it applies to ALL your PRs, adding an
update-branch step to your normal manual merges too. Skip it unless you want the
guarantee enforced outside the automation.

## The `/goal` completion condition (paste this)

> Selection is by **frontmatter `priority:`**, never the filename — the `P#-` prefix is
> cosmetic and can drift. The archive move must ride **inside the merged PR**, or a todo
> whose archive didn't land stays "actionable" and the DONE condition loops forever.

```
/goal Drive every actionable todo with frontmatter `priority: low` in todos/ to a merged
state (ignore the filename prefix; read the priority field). For each:
  1. Implement it via the /todo executor flow (worktree-isolated, kimi-gated).
  2. In the SAME branch/commit, move the todo file to todos/archive/ so archival is
     atomic with the change.
  3. Push the branch and OPEN A PR (low todos get no PR by default — you must create one
     so CI runs; protected main rejects any commit that hasn't passed the 5 checks).
  4. Run scripts/todo-automerge-guard.sh <pr>. HOLD => comment why, leave PR open, skip.
  5. OK => `gh pr update-branch <pr>` (close the strict gap), then
     `gh pr checks <pr> --watch`. Green => `gh pr merge <pr> --squash --delete-branch`.
     Red => leave PR open, note the failing check.
DONE when: no todos/*.md with `priority: low` remain that are neither merged-and-archived
nor held with an open PR, and test:run / check:types / lint are green on main.
STOP EARLY and wait for me if: 10 PRs merged, OR 1.5M output tokens, OR any 2 PRs go red.
```

## Launch

```bash
cd /Users/williamtower/projects/OCRecipes

# Attended debut (recommended first):
claude            # then run:  /todo   (watch it; fix stumbles)

# Unattended, after the gate above is satisfied:
claude --bg       # background session — survives sleep, shows in `claude agents`
#   then paste the /goal block above
# morning:  claude agents     # elapsed / turns / tokens + what merged vs held
```
