---
name: pattern-codifier
description: Deprecated — do not spawn. Codification is handled inline in todo-executor.md Step 9 and audit SKILL.md Phase 8.
---

# Pattern Codifier — DEPRECATED

This agent has been retired. Codification is now handled inline in `.claude/agents/todo-executor.md` Step 9 and `.claude/skills/audit/SKILL.md` Phase 8.

**Do not spawn this agent.** The live codification flows write directly to the current canonical targets:

- `docs/solutions/<category>/<slug>-YYYY-MM-DD.md` — one new file per reusable rule or post-mortem (see `.claude/skills/codify/SKILL.md` for routing and body templates)
- `docs/rules/{domain}.md` — append a one-line "never do X" rule when the finding is CRITICAL/HIGH severity and fits the domain
- `.claude/agents/code-reviewer.md` — add checklist items and `Common Mistakes to Catch` entries for recurring review gaps
- Specialist agent checklists under `.claude/agents/*.md` — domain-specific review rules

The legacy monoliths `docs/patterns/*.md` and `docs/LEARNINGS.md` are no longer codification targets — do not append to them from this flow.
