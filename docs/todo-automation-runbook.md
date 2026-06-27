# Overnight Todo Automation Runbook (`/goal` + `/todo`)

How to let Claude Code work through the `todos/` backlog with minimal supervision —
implement, open PRs, and (once trusted) auto-merge low/medium work on green CI.

> **Model note (2026-06-26, PR #465):** the `/todo` executor now does the PR work
> itself — it opens a PR for **every** priority, runs `scripts/todo-automerge-guard.sh`,
> and for `low`/`medium` todos (that the guard clears) enables `gh pr merge --auto --squash`
> so the PR lands on green CI. You no longer create PRs or merge manually in the `/goal`
> loop; the supervisor's job is to dispatch `/todo`, enforce the stop conditions, and
> review what got HELD. `security`-labelled todos never auto-merge regardless of priority.

`/goal` is a **native Claude Code CLI command**: you set a completion condition and
Claude keeps working across turns until it's met, with a live elapsed/turns/tokens
overlay. `/todo` is the worker it drives (worktree-isolated executors).
`/goal` is the supervisor loop; `/todo` does the work.

## The four-filter safety model

No sleeping human is in the loop, so four independent filters stand in (the 4th is a
documented gap, not an active guard — see below):

1. **CI (required)** — `main` physically refuses any PR whose 7 required checks aren't
   green (Lint·Types·Patterns, Tests 1-3/3, Coverage, Mutation goal-safety, CodeQL
   Analyze). No human approval is required by branch protection — only green CI. That
   is the repo's real merge bar, and `gh pr merge --auto` waits on it.
2. **`scripts/todo-automerge-guard.sh`** — the `/todo` executor runs this on every
   `low`/`medium` PR _before_ enabling auto-merge. It is a **fail-CLOSED allowlist**:
   it auto-merges only when **every** changed file is a known-safe surface (UI, business
   services, shared pure modules, tests, docs/todos) and HOLDs for **anything sensitive
   or unrecognized** — the whole sensitive backend (`server/storage`, `server/routes`,
   `server/middleware`), `.github/`, `scripts/`, migrations, `shared/schema.ts`, secrets,
   plus the IAP/health files that live inside otherwise-safe dirs. An UNKNOWN path HOLDs,
   never auto-merges — so a mislabeled-severity todo can't slip a sensitive change past
   while you sleep. (PR #465 revised this to fail-closed after a review found the interim
   denylist fail-OPEN on whole layers; to widen the pass, add a known-safe prefix to the
   allowlist in the script.)
3. **Bounded stop conditions** — the `/goal` condition halts on N merges / token cap /
   2 reds, so a systemic mistake can't merge many bad PRs before you wake.
4. **Up-to-date merges** — the executor enables `gh pr merge --auto`, which merges
   asynchronously, so the old in-loop `gh pr update-branch` no longer runs per merge.
   For a sequential overnight run this is usually fine (nothing else merges meanwhile);
   to enforce it server-side, set required-checks `strict: true` (applies to all PRs).
   See the stale-merge gap below.

## Rollout: debut attended, graduate to asleep

**Do NOT make the first unattended-while-asleep run your debut.** The first run is the
one most likely to surface an unmodeled edge.

- **Tonight / first runs — ATTENDED.** Run `/todo` foreground and watch. The current
  backlog (≈11 todos, mostly P3) clears in one sitting. Fix whatever stumbles.
- **Graduate to unattended** only after a clean attended run **and** the gate below.

### Pre-unattended gate (all must be true)

- [ ] Stale-merge gap understood. With executor `--auto` the old in-loop
      `gh pr update-branch` no longer runs; for a sequential overnight run this is
      usually fine. Set branch protection `strict: true` if you want it enforced — see
      below.
- [ ] Guard script proven on a few real PRs (HOLDs sensitive paths, lets the rest pass).
- [ ] Auto-mode coverage. **Action required (NOT yet in place):** add `Bash(gh pr merge:*)`
      to `permissions.allow` — the executor's auto-merge step calls `gh pr merge --auto`,
      which is not allow-listed today (it should sit beside the existing
      `Bash(scripts/todo-automerge-guard.sh:*)` and `mcp__github__merge_pull_request`).
      Also extend the scoped `gh pr merge` `autoMode.allow` rule to include `--auto`
      (today it covers only `--squash --delete-branch`). **Confirmed in place:**
      `Bash(scripts/todo-automerge-guard.sh:*)`, `mcp__github__merge_pull_request`,
      `Bash(npm run *)`. **Unconfirmed until the debut:** whether the classifier waves
      through `git push` of feature branches, `gh pr create`, and the per-merge commands
      under `$defaults`. If any blocks while you watch, add a tightly-scoped
      `autoMode.allow` entry then — do NOT pre-widen blind.

### The stale-merge gap (with executor `--auto`)

With `strict: false`, PR-B can pass CI against an _old_ main, merge stale, and redden
main even with zero file overlap with PR-A — nothing re-runs B's checks. The executor's
`gh pr merge --auto` does **not** run `gh pr update-branch`, so this gap is open. For a
sequential overnight run (no concurrent merger while you sleep) it is usually harmless —
the only way main goes stale mid-merge is a second merger, and there isn't one.

Optional server-side enforcement: set required-checks `strict: true`. GitHub then
forces _every_ PR up-to-date before merge — but it applies to ALL your PRs, adding an
update-branch step to your normal manual merges too. Skip it unless you want the
guarantee enforced outside the automation.

## The `/goal` completion condition (paste this)

> Selection is by **frontmatter `priority:`**, never the filename — the `P#-` prefix is
> cosmetic and can drift. The archive move must ride **inside the merged PR**, or a todo
> whose archive didn't land stays "actionable" and the DONE condition loops forever.

```
/goal Drive every actionable todo with frontmatter `priority: low` or `priority: medium`
in todos/ to a merged-or-held state (ignore the filename prefix; read the priority field). Run the
/todo skill; its worktree-isolated executors do ALL the PR work themselves — implement
the todo, archive it inside the same commit, open a PR, run scripts/todo-automerge-guard.sh,
and (guard OK) enable `gh pr merge --auto --squash` so the PR lands on green CI. Do NOT
create PRs or merge yourself — the executor does. Your job: dispatch /todo, watch the
results, and enforce the stop conditions. A guard HOLD (sensitive path) leaves the PR
open for me to review — that is a valid terminal state, not a failure.
DONE when: no todos/*.md with `priority: low` or `priority: medium` remain that are neither
merged-and-archived nor sitting on an open PR (auto-merging, held, or awaiting review), and test:run /
check:types / lint are green on main.
STOP EARLY and wait for me if: 10 PRs merged, OR 1.5M output tokens, OR any 2 PRs go red,
OR any todo blocks on a diverged remote branch (needs a one-time manual branch delete).
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
