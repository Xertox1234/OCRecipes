---
title: "Re-verify an agent report's BOUNDING claims — the negative is what hides the live instance"
track: knowledge
category: conventions
tags: [harness, agents, testing, verification, review, delegation]
module: shared
applies_to: [.claude/agents/**/*.md, .claude/skills/**/*.md, docs/solutions/**/*.md, todos/**/*.md]
symptoms: ["A review or research report bounds a defect with a negative — \"no caller does X\", \"only these N sites\", \"not currently reachable\"", A finding is filed at lower severity because the report said nothing triggers it, A todo written from a report turns out to understate the defect once someone opens the files, Two agents reviewing the same code disagree about which call sites exist]
created: '2026-08-15'
---

# Re-verify an agent report's BOUNDING claims — the negative is what hides the live instance

## Rule

When a subagent report — code review, exploration, research digest — hands you a finding,
its **positive** claims ("this line does X") are cheap to trust: they cite a path and you
will read that path anyway while acting on them.

Its **negative, bounding** claims are the dangerous ones:

- "no caller passes that param"
- "only these three sites use it"
- "not currently reachable"
- "this is the last instance"

Those are the claims that set **severity and scope**, they are the ones you will quote into
a todo or a PR body, and they are the ones nobody re-reads — precisely because they say
there is nothing there to look at.

Open the files behind every bounding claim before you act on it.

## Smell patterns

- A report's severity rests on a phrase like "not currently firing" or "no live caller".
- You are about to write "not currently triggered" into a todo, quoting a report rather than
  a command you ran.
- A report enumerates call sites without showing the search that produced the enumeration.
- Two reports about the same code disagree on which callers exist — at least one enumerated
  rather than searched.

## Why

A negative claim is a **completeness** claim, and completeness is exactly what a reading pass
is worst at. The agent saw the sites it happened to open. "No caller does X" is really "I did
not open a caller that does X", and the two are indistinguishable in the report.

The failure is asymmetric, which is what makes it worth a rule:

- A wrong **positive** claim gets caught, because acting on it means opening the file.
- A wrong **negative** claim is self-concealing. It tells you there is nothing to check, so
  you do not check, so it survives into the artifact — at the lower severity it caused.

### The case

A `mobile-reviewer` pass surfaced a route-param divergence: `RecipeBrowserModal` declares
`date`, while the screen shared with the other navigator reads `plannedDate`. The report
bounded it:

> The two in-app callers only pass `planDays` or nothing, so it isn't tripped today.

That bound was the whole severity argument — a latent trap rather than a live bug. Opening
the two callers to write the todo took one command:

```bash
sed -n '57,68p' client/components/coach/blocks/RecipeCard.tsx
#   params: { recipeId: recipe.recipeId },     ← neither planDays nor nothing
```

`recipeId` is not declared in that ParamList and is not read by the screen. So a *second*
instance of the same defect existed, it fires on every "Add to meal plan" tap, and it was
invisible precisely because the bounding sentence said not to look.

The correct positive findings in the same report were all accurate. Only the negative was
wrong, and only the negative changed what got written down.

## Examples

```md
<!-- BAD — the severity rests on a sentence, and the sentence is the unverified part -->
**Not currently firing.** The two in-app callers pass `planDays` or nothing.
```

```md
<!-- GOOD — the bound cites what was run, so a reader can falsify it -->
**Callers, enumerated 2026-08-15** (`grep -rn "RecipeBrowserModal" client/`):
- `CoachChat.tsx:411` → `{ planDays }`
- `RecipeCard.tsx:61`  → `{ recipeId }`  ← undeclared and unread; this one fires
```

Two habits:

1. **Turn every bound into a command.** A bound you can paste as a grep is a bound the next
   reader can re-run. "No caller does X" with no command behind it is an opinion.
2. **Prefer the report's leads over its conclusions.** Subagent reports are excellent at
   pointing at a file and poor at proving a negative about a tree. Take the pointer; redo
   the enumeration.

## Exceptions

- Bounds the agent produced by a **mechanical** check it shows you — a `grep` with its
  output, a `tsc` run, a test count — are as trustworthy as the command. Re-run it if it is
  load-bearing; do not re-derive it by hand.
- A bound whose only consequence is prioritisation *within* your own next step is not worth a
  round trip. The rule bites when the bound leaves your head — into a todo, a PR body, a
  severity rating, or a decision not to fix.

## Related Files

- `todos/P2-2026-08-15-recipe-browser-modal-param-contract-unenforced.md` — the todo this
  produced; its Updates section records the corrected bound and why it mattered
- `client/components/coach/blocks/RecipeCard.tsx` — the caller the bound said did not exist
- `docs/AI_WORKFLOW.md` → Review Policy — the roster whose reports this applies to

## See Also

- [A completeness claim backed by a single-line grep is unverified](completeness-claim-from-single-line-grep-is-unverified-2026-08-15.md) — the same completeness problem one layer down, where the unverified bound is a grep rather than an agent
- [A symbol-existence grep is not claim verification](../logic-errors/symbol-existence-grep-is-not-claim-verification-2026-07-05.md) — verifying the wrong predicate about a claim
- [A lint harness that matched no config still returns messages](../code-quality/harness-that-never-bound-its-config-reads-as-a-verdict-2026-08-15.md) — same session; a tool, rather than an agent, reporting a confident non-answer
