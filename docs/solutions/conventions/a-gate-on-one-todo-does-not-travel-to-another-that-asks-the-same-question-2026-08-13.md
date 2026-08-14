---
title: A human_led gate protects a todo file, not a decision — an older ungated todo asking the same question is still dispatchable
track: knowledge
category: conventions
tags: [harness, todos, automation, workflow, human-led, gating, todo-executor, orchestration]
module: shared
applies_to: [".claude/skills/todo/**", ".claude/skills/todo-fast/**", "scripts/todo-gate-check.sh", "todos/*.md"]
symptoms: ["An autonomous run implements a decision that a human_led todo explicitly reserved for a human", "Two todos in the backlog ask for the same design call, and only the newer one carries the gate", "scripts/todo-gate-check.sh returns clean for a todo whose acceptance criteria are a decision", "A gated todo's scope is a superset of an ungated todo's, and the ungated one runs first"]
created: '2026-08-13'
---

# A human_led gate protects a todo file, not a decision — an older ungated todo asking the same question is still dispatchable

## Rule

`scripts/todo-gate-check.sh` reads `human_led` / `blocked_until` **per file**. It
has no notion of what a todo is *about*. So a gate placed on todo B never reaches
todo A, even when A's acceptance criteria ask for the identical decision.

Before dispatching an actionable todo whose AC contains a **decision**, grep the
backlog for a gated todo that claims the same decision space. If one exists, the
gate applies to that criterion — treat it as gated even though the checker passed.

The ordering that makes this bite is the common one: gates get added as the team
learns which calls need a human, so **the gated todo is usually the newer file**
and the ungated one has been sitting in the backlog since before anyone knew the
decision was contentious.

## Smell patterns

- An AC line beginning "A decision is recorded on whether…", "Choose between…",
  "Decide whether…" — on a todo with **no** `human_led: true`. (That the todo
  *should* have carried the gate is the sibling rule,
  [todo-needing-human-judgment-must-carry-human-led-gate](todo-needing-human-judgment-must-carry-human-led-gate-2026-07-25.md);
  this rule is about what to do when it doesn't.)
- A gated todo whose `blocked_reason` names a **surface or class** ("per-surface
  routing tradeoff", "package.json/ios edits") rather than one file — a
  class-shaped reason almost always overlaps some older, narrower todo.
- Two todos whose titles differ but whose Scope Contracts list the same source
  file. Scope-contract overlap is a much stronger signal than title similarity.

## Why

The gate exists to stop an unattended run from writing a contested tradeoff into
the record **as settled fact**. That harm does not care which file number the work
was filed under. Implementing the reserved decision under the older todo's number
is the same outcome the gate was placed to prevent — it just routes around the
checker instead of through it.

This is also why the fix is never to edit the gated todo's frontmatter. Clearing
`human_led` to "unblock" the work is the documented bypass
(`.claude/skills/todo/SKILL.md` Phase 2 step 3a: *"Never edit `blocked_until`,
`human_led`, or `status` on a gated todo to make it pass this check"*). Silently
doing the same work from the ungated side is that bypass wearing a different hat.

## Examples

**The 2026-08-13 case.** `todos/P3-2026-07-26-ios-path-domain-mapping-gap-and-doc-nits.md`
(ungated, created 2026-07-26) had as its first AC:

> A decision is recorded on whether `ios/**` gets its own domain (e.g.
> `native-build`) or maps onto an existing one

`todos/P3-2026-08-11-unrouted-surfaces-domain-map-decision.md` (created **16 days
later**) carried:

```yaml
human_led: true
blocked_reason: "Per-surface routing-vs-general-tier tradeoff (injection noise on
  package.json/ios edits vs anchored-doc value) is a human call — an unattended
  run would write the tradeoff into the todo as settled fact"
```

`todo-gate-check.sh` listed only the 08-11 file. The 07-26 file was fully
actionable and would have had its `ios/**` routing decided by an executor.

**What to do instead — three options, in order of preference:**

1. **Ask the human, in-session.** `human_led` means *human in the loop*, not
   *never*. If the user is present, put the decision to them with the facts the
   todos lack; a resolved decision satisfies the gate properly. (This is what
   happened here — the human chose `ios/** → react-native`.)
2. **Split the todo.** Ship the criteria that aren't gated, hand the gated
   criterion to the todo that owns it, and migrate any evidence the closing todo
   holds so it isn't stranded in an archived file. Many todos pre-authorize
   exactly this — the 07-26 file said *"The two doc/comment items are independent
   of the mapping work and can land separately if the domain decision stalls."*
3. **Skip and surface.** If neither is possible, report the todo as gated with a
   pointer to the owning todo, rather than deciding.

**Whichever you pick, record the resolution in the gated todo** with a dated
`## Updates` entry — which surface was decided, by whom, and which remain open —
and leave its `human_led` / `status` untouched if any part is still open. One
owner per decision; a gated todo that silently loses half its scope to another
PR is worse than one that never ran.

## Exceptions

- **Genuinely disjoint scope.** Two todos touching the same *file* are not
  necessarily asking the same *question*. The overlap test is the decision, not
  the path: "would satisfying A's criterion also answer B's open question?"
- **The gated todo is stale.** If the gated todo's decision was already made and
  recorded elsewhere, it isn't reserving anything — verify against its `## Updates`
  rather than assuming the frontmatter is current.

## Related Files

- `scripts/todo-gate-check.sh` — the per-file checker; reads frontmatter only,
  never todo content or cross-todo relationships
- `.claude/skills/todo/SKILL.md` — Phase 2 step 3a, the gate-check call and the
  no-override rule
- `.claude/skills/todo-fast/SKILL.md` — Phase 0, the *only* sanctioned path for
  running a gated todo (interactive human confirmation)
- `todos/README.md` — "Date & Human-Led Gates"

## See Also

- [todo-needing-human-judgment-must-carry-human-led-gate](todo-needing-human-judgment-must-carry-human-led-gate-2026-07-25.md) — the authoring-side rule: put the gate on at file time. This doc covers the case where that didn't happen.
- [an-advisory-tier-must-not-fail-the-build-and-must-reach-a-human](an-advisory-tier-must-not-fail-the-build-and-must-reach-a-human-2026-08-07.md) — same family: a check that runs but never reaches the human who needed it
- [../logic-errors/guard-script-field-quote-strip-fail-closed](../logic-errors/guard-script-field-quote-strip-fail-closed-2026-07-16.md) — the gate script's own fail-closed behaviour on unparseable fields
- [tags-and-applies-to-are-a-two-part-routing-precondition](tags-and-applies-to-are-a-two-part-routing-precondition-2026-08-06.md) — the other "looks wired, delivers nothing" trap this session hit
