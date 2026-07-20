---
title: Operative agent advice must ship in a channel that reaches the acting agent — a doc outside its injection domains is a record, not a fix
track: knowledge
category: conventions
module: shared
tags: [agents, injection, delivery-channel, docs-solutions, harness, worktrees]
applies_to: [.claude/agents/**, .claude/skills/**, docs/solutions/**]
created: '2026-07-20'
---

# Operative agent advice must ship in a channel that reaches the acting agent — a doc outside its injection domains is a record, not a fix

## Rule

When a fix for an agent-workflow failure is written as **advice to a future agent**
("any executor should run X near the start"), verify the delivery channel actually
reaches that agent **at the moment of failure** — and if none does, put the operative
step in the agent's own definition file (or the skill that dispatches it). The
solution doc then records the incident and points at the definition; it is not the
fix itself.

## Smell patterns

- A solution doc paragraph addressed to "any executor/agent" whose frontmatter tags
  match **no injection domain** in `.claude/hooks/lib/domain-map.sh` (e.g.
  `[git, worktree, tooling, husky]` — no such domains exist), so the inject hook can
  never deliver it for the file paths that agent actually edits.
- The advised agent's definition file has **zero mentions** of the advised step
  (`grep -c` it before claiming the advice is actionable).
- The audience is a read-only or research-phase agent — per project memory, those get
  **no pattern injection at all**, so even a well-tagged doc never reaches them.

## Why

The 2026-07-19/20 instance: a `todo-executor` hit a broken `node_modules` in its
`isolation:"worktree"` dispatch (the `PostToolUse:EnterWorktree` provisioning trigger
didn't fire). The executor's fix commit added an accurate counter-case paragraph to
`docs/solutions/conventions/adhoc-worktree-missing-node-modules-symlink-2026-07-06.md`
instructing future executors to self-heal — but that doc's tags map to no injection
domain, its `applies_to` (`.husky/post-checkout`) matches no app-code path, and
`todo-executor.md` contained no such step. The next executor to hit the same failure
would, definitionally, not have the advice in context: the paragraph was a correct
post-mortem with zero delivery mechanism. The review moved the operative step into
`todo-executor.md` Step 0 (and confirmed `/todo-fast` already had its equivalent
inline in its SKILL.md).

## Examples

- Correct placements, by audience: executor behavior → `.claude/agents/todo-executor.md`
  numbered step; skill-phase behavior → that skill's `SKILL.md` phase; review rule →
  the owning reviewer file per the `/codify` Step 5 table.
- Verifying reachability: check the doc's `tags:` against the domain list emitted by
  `scripts/lib/path-domains.ts` (or `.claude/hooks/lib/domain-map.sh`), and grep the
  target agent's definition for the operative command.

## Exceptions

- Advice aimed at **humans** (runbooks, one-time migration notes) doesn't need an
  injection channel — humans browse `docs/`; agents don't.
- Advice that IS reachable — tags matching a real domain, for an agent that edits
  matching paths with injection enabled — can stay doc-only; the doc is the channel.

## Related Files

- `.claude/agents/todo-executor.md` — Step 0 self-heal step (the operative fix)
- `docs/solutions/conventions/adhoc-worktree-missing-node-modules-symlink-2026-07-06.md` — the incident record that stayed advisory
- `.claude/hooks/lib/domain-map.sh` — the generated tag→domain reality check

## See Also

- [Agent file edits take effect on reload, not save](agent-file-edits-take-effect-on-reload-not-save-2026-07-02.md) — the sibling delivery-timing gotcha once advice DOES live in an agent file
