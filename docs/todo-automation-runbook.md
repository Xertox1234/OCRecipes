# Overnight Todo Automation Runbook (`/goal` + `/todo`)

How to let Claude Code work through the `todos/` backlog with minimal supervision —
implement, open PRs, and leave them ready for your morning batch-merge.

> **Model note (2026-07-02, harness sweep):** **no PR ever auto-merges.** The `/todo`
> executor opens a PR for **every** priority and runs `scripts/todo-automerge-guard.sh`
> as a **classification only** — it reports `MERGE_ELIGIBLE: yes/held/review-required/unknown`
> and never calls `gh pr merge`. Overnight output is a stack of open PRs; in the morning
> you ask the orchestrator to batch-merge the `MERGE_ELIGIBLE: yes` ones (it verifies
> green CI + a clean tree, then squash-merges) and you individually review the rest.
> `security`-labelled and `high`/`critical` todos are always individual-review.
> (Historical: 2026-06-26 PR #465 had the executor enable `gh pr merge --auto --squash`
> for guard-cleared low/medium PRs; that self-merge path was removed 2026-07-02.)

`/goal` is a **native Claude Code CLI command**: you set a completion condition and
Claude keeps working across turns until it's met, with a live elapsed/turns/tokens
overlay. `/todo` is the worker it drives (worktree-isolated executors).
`/goal` is the supervisor loop; `/todo` does the work.

## The safety model

No sleeping human is in the loop, and — since nothing merges overnight — no code
reaches `main` while you sleep either. The filters:

1. **No unattended merges** — the strongest guard is structural: every PR waits for
   you. The worst overnight outcome is a stack of bad open PRs, which you decline in
   the morning.
2. **CI (required)** — `main` physically refuses any PR whose 7 required checks aren't
   green (Lint·Types·Patterns, Tests 1-3/3, Coverage, Mutation goal-safety, CodeQL
   Analyze). No human approval is required by branch protection — only green CI. That
   is the repo's hard merge bar, and the morning batch-merge respects it.
3. **`scripts/todo-automerge-guard.sh`** — the executor runs this on every `low`/`medium`
   PR to classify it. It is a **fail-CLOSED allowlist** with two gates: a TODO gate
   (the archived todo's frontmatter must say priority low/medium with no `security`
   mention — enforced by the script itself, so even a fresh session with no overnight
   report can't batch-merge a high/security PR) and a PATH gate: `MERGE_ELIGIBLE: yes`
   only when **every** changed file is a known-safe surface (UI, business services,
   shared pure modules, tests, docs/todos); it HOLDs for **anything sensitive or
   unrecognized** —
   the whole sensitive backend (`server/storage`, `server/routes`, `server/middleware`),
   `.github/`, `scripts/`, migrations, `shared/schema.ts`, secrets, plus the IAP/health
   files that live inside otherwise-safe dirs. An UNKNOWN path HOLDs — so a
   mislabeled-severity todo can't get itself onto your batch-merge list. (PR #465
   revised this to fail-closed after a review found the interim denylist fail-OPEN on
   whole layers; to widen the pass, add a known-safe prefix to the allowlist in the
   script.)
4. **Bounded stop conditions** — the `/goal` condition halts on N PRs opened / token
   cap / repeated failures, so a systemic mistake can't burn the whole backlog before
   you wake.

## Rollout: debut attended, graduate to asleep

**Do NOT make the first unattended-while-asleep run your debut.** The first run is the
one most likely to surface an unmodeled edge.

- **First runs — ATTENDED.** Run `/todo` foreground and watch. Fix whatever stumbles.
- **Graduate to unattended** only after a clean attended run **and** the gate below.

### Pre-unattended gate (all must be true)

- [ ] Guard script proven on a few real PRs (HOLDs sensitive paths, clears the rest).
- [ ] Executor permission coverage confirmed during the attended debut: `git push` of
      feature branches, `gh pr create` / `mcp__github__create_pull_request`, and
      `Bash(scripts/todo-automerge-guard.sh:*)` all run without prompts. If anything
      blocks while you watch, add a tightly-scoped `autoMode.allow` entry then — do
      NOT pre-widen blind. (The executor never needs `gh pr merge` in any form — that
      permission exists for YOUR morning batch-merge, not for the overnight run.)

## Morning batch-merge

The Phase 5 summary lists PRs under "Ready for batch-merge" (`MERGE_ELIGIBLE: yes`).
Say the word (in any session — a fresh morning session works: ask it to list open
`todo/*` PRs and run the batch-merge per the /todo skill) and the orchestrator executes
the **single canonical procedure in `.claude/skills/todo/SKILL.md` Phase 5** — in short:
re-run the eligibility guard per PR (the overnight classification is advisory and can go
stale if a PR was amended), verify green CI + clean tree, squash-merge with
`--delete-branch`, skip conflicts/HOLDs. Don't restate or improvise the steps — the
skill owns them. Merging sequentially in one sitting also closes the classic
stale-merge gap (a PR passing CI against an old `main`) for practical purposes — if you
want it enforced server-side, set required-checks `strict: true`, at the cost of an
update-branch step on every manual PR too.

`held` / `review-required` / `unknown` PRs you review individually, like any other PR.

## The `/goal` completion condition (paste this)

> Selection is by **frontmatter `priority:`**, never the filename — the `P#-` prefix is
> cosmetic and can drift. The archive move must ride **inside the PR**, or a todo
> whose archive didn't land stays "actionable" and the DONE condition loops forever.

```
/goal Drive every actionable todo with frontmatter `priority: low` or `priority: medium`
in todos/ to an open-PR state (ignore the filename prefix; read the priority field). Run the
/todo skill; its worktree-isolated executors do ALL the PR work themselves — implement
the todo, archive it inside the same commit, open a PR, and run
scripts/todo-automerge-guard.sh to classify it (MERGE_ELIGIBLE). NEVER merge anything —
no `gh pr merge` in any form; every PR waits for my morning batch-merge. Your job:
dispatch /todo, watch the results, and enforce the stop conditions. A guard HOLD
(path or todo-frontmatter gate) is a valid terminal state, not a failure.
DONE when: every actionable low/medium todo appears in SOME listing group of the latest
accumulated /todo Phase 5 summary, or as blocked-with-reason, or as a `failed` row in
the Phase 5 table — AND the latest /todo Phase 5 verification line is green. Every Phase
5 listing group is a terminal state for the night (the skill guarantees this): open PR,
awaiting/gated on batch-merge, dependency not yet implemented, stale branch, "Skipped —
quality flags" (that one needs MY re-authoring). A failed todo is terminal for the night
too — leave it for my morning review. Never re-dispatch a listed or failed todo hoping
its outcome changes. Evaluate
DONE from the Phase 5 reports you already hold; do NOT re-run test:run / check:types /
lint yourself and do NOT re-query GitHub per todo (one final batched `gh pr list` sweep
to confirm PR states before reporting DONE is fine) — /todo already verified and
classified everything once per dispatch.
STOP EARLY and wait for me if: 10 PRs opened, OR 1.5M output tokens, OR 2 STATUS:
failed reports accumulated across the night — two different todos, or the same todo
failing in two dispatches (each report already represents the executor's two internal
attempts), OR any todo blocks with REASON_CODE: ORPHAN_BRANCH, PR_CHECK_FAILED,
or PR_CLOSED_UNMERGED — the ACTION NEEDED codes (an orphan branch, an unverifiable PR
state, or a PR closed without merging — each needs my one-time decision; an open-PR
collision is just "awaiting batch-merge", not a stop condition).
```

## Launch

```bash
cd /Users/williamtower/projects/OCRecipes

# Attended debut (recommended first):
claude            # then run:  /todo   (watch it; fix stumbles)

# Unattended, after the gate above is satisfied:
claude --bg       # background session — survives sleep, shows in `claude agents`
#   then paste the /goal block above
# morning:  claude agents     # elapsed / turns / tokens; then review + batch-merge PRs
```
