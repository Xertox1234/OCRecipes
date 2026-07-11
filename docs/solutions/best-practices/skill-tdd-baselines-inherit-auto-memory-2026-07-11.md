---
title: "Skill-TDD baseline subagents inherit auto-memory — a passing control means write thin reference, not discipline"
track: knowledge
category: best-practices
tags: [skills, writing-skills, tdd, subagents, memory, baseline, pressure-testing, harness]
module: shared
applies_to: [".claude/skills/**/*.md", ".claude/agents/**/*.md"]
symptoms: [Baseline (no-skill) pressure scenarios pass and the transcript cites memory files by name, A drafted skill restates rules MEMORY.md already carries, A rationalization table counters excuses no test run ever produced]
created: '2026-07-11'
---

# Skill-TDD baseline subagents inherit auto-memory — a passing control means write thin reference, not discipline

## When this applies

Authoring or editing a Claude Code skill with `superpowers:writing-skills`
RED-GREEN-REFACTOR in this repo, using Agent-tool subagents as the test harness.

## Rule

The RED "control" is not knowledge-free: dispatched subagents inherit project
CLAUDE.md **and** the auto-memory index, so a baseline run measures the skill's
value ABOVE that existing context. Interpret verdicts accordingly:

- **Baseline FAILS** → a real gap. That exact failure — rationalizations captured
  verbatim — earns the discipline apparatus: rule statement, rationalization
  table, red-flags list.
- **Baseline PASSES citing memory** → the knowledge exists but only on this
  machine. Write the content as thin reference lines (checklist row, table
  entry), no discipline apparatus. The skill's remaining value is consolidation
  and portability: worktree executor sessions keyed to other project paths,
  web/cloud sessions, and other machines never load this user's
  `~/.claude/projects/<project>/memory`.
- **All baselines pass** → it is a reference skill. Verify it with application
  probes and an **over-application probe** (does it cause dogmatic refusal, or
  explain away a real case?) instead of pressure-compliance probes.

## Why

Bulletproofing failures nobody exhibited adds prohibition-style guidance with no
failure to prevent — wasted tokens at best, and `writing-skills`' own wording
tests show prohibitions can backfire on shaping problems. Meanwhile a
memory-only rule is invisible to every context that doesn't load the local
memory directory; the git-tracked skill file is the durable, reviewable home.

Evidence (2026-07-11 session, PR #577): 6 of 7 baseline scenarios passed with
agents citing memory files by name. The single observed failure — review-gate
skip under "just merge it" + time pressure — received `/land`'s only
rationalization table; `/regression-triage` shipped as pure reference with a
"when it IS real" escape hatch, and its over-application probe (a genuine
regression the ladder must not explain away) was the highest-value test of the
session.

## Exceptions

- A passing local baseline cannot prove content unnecessary for memory-less
  contexts — it only proves the gap is unmeasurable on this machine. Keep the
  content; skip the bulletproofing.
- Discipline skills need the counter-direction probe even when compliance
  passes: verify an explicit user waiver is honored (rule-following must not
  curdle into stonewalling), and that the waiver path stays scoped to exactly
  the waived step.

## Related Files

- `.claude/skills/land/SKILL.md` — mixed outcome: one bulletproofed section (the observed failure), rest thin reference
- `.claude/skills/regression-triage/SKILL.md` — all-pass baseline → reference skill with over-application escape hatch

## See Also

- [../logic-errors/symbol-existence-grep-is-not-claim-verification-2026-07-05.md](../logic-errors/symbol-existence-grep-is-not-claim-verification-2026-07-05.md) — the companion duty when the skill is written: fact-check the executable claims it carries
