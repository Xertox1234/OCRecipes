---
title: 'Values a downstream consumer routes on need a machine form (enum field), never prose markers'
track: knowledge
category: conventions
module: shared
tags: [agents, orchestration, prose-state-machine, enums, routing, skills, runbooks, drift, reason-codes, lookup-table, vocabulary]
applies_to: [.claude/agents/**/*.md, .claude/skills/**/*.md, docs/todo-automation-runbook.md]
created: '2026-07-02'
last_updated: '2026-07-02'
---

# Values a downstream consumer routes on need a machine form (enum field), never prose markers

## Rule

In agent-instruction state machines (executor reports, skill phases, `/goal` supervisor
conditions), any value that another agent or a later step **branches on** must be an
explicit enumerated field (e.g. `REASON_CODE: ORPHAN_BRANCH`). Free text is display prose
for humans. Never route on reason-string prefixes, embedded substring markers, or an
enumerated list of category names defined in a *different* file.

## Smell patterns

- "if the reason begins with `already implemented` → group X" (prefix routing)
- "report this reason text VERBATIM — a paraphrase gets buried" (the doc is begging
  because the router is fragile)
- A DONE/stop condition that enumerates bucket names whose definitions live in another
  file (they drift independently and no check catches it)
- A threshold condition whose parenthetical can be read two ways ("2 executor failures
  (…or one todo failing twice)")
- **(consumer half)** A lookup / routing table whose keys are meant to match another
  tool's **emitted** labels, but keyed on invented synonyms the tool never outputs
  (`ai`/`llm` when the emitter prints `ai-prompting`) — or missing a row for a label the
  tool *does* emit. The mismatched input silently finds no row and falls through to the
  default branch. This is the same drift as "category names defined in a different file,"
  now on the receiving end.

## Why

Prose state machines fail by being **literally obeyed** — the failure mode is not a crash
but a wrong branch taken confidently. The `/review` of PR #489 traced 4 of its 8 headline
findings to this single root cause: reason-prefix routing in the /todo Phase 5 summary,
an "ACTION NEEDED" substring doubling as a stop-condition trigger, a stop-condition
parenthetical that halved the intended failure threshold when read literally, and a DONE
condition whose enumerated group names had already drifted from the producer before the
PR merged. All were in the *reporting* half of the system; the enum fix removed the whole
class.

## Examples

- `.claude/agents/todo-executor.md` Step 11: `REASON_CODE` enum with a canonical-text
  table; `.claude/skills/todo/SKILL.md` Phase 5 routes on the code first, keeps text
  prefixes only as a legacy fallback.
- **Producer contract at the definition site**: SKILL.md Phase 5 declares "every listing
  group is terminal for the run; never add a 'retry tonight' group without updating the
  /goal DONE condition" — the consumer *derives* ("appears in some listing group")
  instead of enumerating, and the producer carries the invariant.
- **Consumer keyed on the emitter's exact vocabulary** (#490 review): the `/codify`
  Step 2 domain→reviewer table keyed rows on `ai`/`llm` while
  `scripts/lib/path-domains.ts` emits `ai-prompting`, and had no `design-system` row.
  An AI-service or theme diff got its real CLI label, matched no row, and fell through to
  "code-reviewer only" — the ai-reviewer / mobile-reviewer lens silently skipped. Fix:
  key the table on the CLI's exact label set (the 13 rules-domains + `camera`). Verify by
  **diffing keys against the emitter**: dump the label union
  (`npx tsx scripts/lib/path-domains.ts --routing <files>` / read the source enum) and
  assert every table key is a real label — the two ends of one closed vocabulary, checked,
  not assumed.

## Exceptions

- Human-facing call-to-action markers (`ACTION NEEDED (human): …`) stay in the prose —
  they serve the reader — and may remain a documented **legacy fallback** for routers
  that predate the enum. Route on the enum first.
- A single-consumer verdict line the prompt itself defines (e.g. the advisor's
  `GREEN`/`YELLOW:`/`RED:` contract) is already enum-shaped; no field needed.

## Related Files

- `.claude/agents/todo-executor.md` — Step 11 `REASON_CODE` enum + canonical-text table
- `.claude/skills/todo/SKILL.md` — Phase 5 code-first routing + producer contract
- `docs/todo-automation-runbook.md` — /goal STOP-EARLY keyed on the ACTION NEEDED codes

## See Also

- [bounded CLI fetch must self-check truncation](bounded-cli-fetch-guard-count-equals-limit-2026-07-02.md) — sibling finding from the same review: constants that decay instead of self-checking
- [../best-practices/grep-verify-single-ownership-after-dedup-consolidation-2026-07-02.md](../best-practices/grep-verify-single-ownership-after-dedup-consolidation-2026-07-02.md) — a routing table restated as a paraphrase instead of a pointer is the drift a single-ownership grep catches
