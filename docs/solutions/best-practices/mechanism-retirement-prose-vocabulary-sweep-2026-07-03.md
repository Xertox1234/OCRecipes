---
title: After retiring a mechanism, sweep surviving prose for the retired vocabulary
track: knowledge
category: best-practices
module: shared
tags: [documentation, cutover, migration, agent-files, prose-drift]
applies_to: [.claude/agents/**/*.md, .claude/skills/**/*.md]
created: '2026-07-03'
---

# After retiring a mechanism, sweep surviving prose for the retired vocabulary

## Rule

A cutover PR that retires a mechanism (a store, a symlink scheme, a service, a
tool) must end with a vocabulary sweep: grep every SURVIVING prose file — agent
prompts, skills, docs — for the retired mechanism's characteristic nouns, and
rewrite any passage whose rationale still credits the deleted thing. Rewriting
the sections that obviously describe the old model is not enough; the misses
hide in *justification clauses* of instructions whose conclusions still hold.

## Why

In the PR #491 markdown-canonical cutover, `todo-executor.md` Steps 3a and 9
were deliberately and carefully inverted from the DB/symlink model — yet review
found three symlink/DB-era passages that survived: a durability rationale
("kimi-write output goes to a durable location (the main checkout)"), a triage
claim ("codification has already persisted to the solutions DB by design"), and
a freshness justification ("the post-checkout symlinks make docs/solutions/
paths resolvable"). Each was a subordinate clause inside an instruction that was
otherwise updated, so section-by-section rewriting skipped right over them. In
an agent-prompt file such stale rationale is not cosmetic — an executor that
believes a file is "already durable in the main checkout" can deprioritize the
commit that is now the sole persistence mechanism.

The sweep is cheap and mechanical: the retired mechanism has distinctive
vocabulary (`solutions DB`, `symlink`, `main checkout`, `mirror`,
`solutions:db:`), and one grep over the surviving prose surfaces every leftover
in seconds — including the ones a careful section rewrite missed.

## Smell patterns

- A parenthetical or "because ..." clause names infrastructure the same PR deletes
- Prose asserts a persistence/visibility guarantee whose mechanism changed
- Two adjacent items in one file describe different models (one updated, one not)

## Examples

```bash
# After the cutover edits, before committing the prose changes:
grep -rniE 'solutions db|symlink|main checkout|mirror|solutions:db' \
  .claude/agents .claude/skills docs/*.md --include='*.md' | grep -v docs/solutions
# Triage every hit: historical mention (fine) vs live instruction/rationale (rewrite).
```

## Exceptions

- Historical artifacts (archived todos, dated post-mortems, audit manifests)
  legitimately describe the old model — sweep the *surviving instructions*, not
  the history.
- A hit inside content that explicitly labels itself as pre-cutover (e.g. a
  "Cutover note" annotated doc) is intentional.

## Related Files

- `.claude/agents/todo-executor.md`
- `.claude/skills/codify/SKILL.md`
- `docs/PATTERNS.md`

## See Also

- [run-codify-agent-updates-before-pr-merges](../conventions/run-codify-agent-updates-before-pr-merges-2026-06-27.md) — agent-prose freshness discipline at merge time
- [agent-file-edits-take-effect-on-reload-not-save](../conventions/agent-file-edits-take-effect-on-reload-not-save-2026-07-02.md) — why stale agent prose keeps acting until the session reloads
