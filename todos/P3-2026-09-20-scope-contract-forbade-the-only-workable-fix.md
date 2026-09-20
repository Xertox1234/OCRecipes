---
title: "PR #1000's Scope Contract forbade the only structurally possible fix — revisit how contracts name files, so a correct implementation stops reading as a CRITICAL violation"
status: backlog
priority: low
created: 2026-09-20
updated: 2026-09-20
assignee:
labels: [deferred, harness]
github_issue:
human_led: true
blocked_reason: "The acceptance criteria are a DECISION about a project-wide review convention, not a spec. The todo asks which way to resolve a stated tension -- a Scope Contract written before implementation can only guess where the fix lands, but one written loosely enough never to be wrong constrains nothing -- and the three candidate directions have materially different costs and opposite failure modes. Whatever is chosen is written into docs/AI_WORKFLOW.md's Tier handling section, which every reviewer dispatch and the generated Copilot instructions read, so it changes reviewer behaviour everywhere at once. An unattended run would pick whichever direction is cheapest to implement and record it as settled convention with no human in the loop -- and the specific risk is that it weakens 'scope-contract violation = CRITICAL' into decoration, which is the one outcome this todo exists to prevent. A human decides the direction before anyone writes it."
---

# A Scope Contract that excludes the only workable fix

## Summary

`todos/archive/P3-2026-09-14-bottomsheetmodal-background-trap-and-on-device-pass.md` carried a Scope
Contract naming `MealPlanHomeScreen.tsx` as the file in scope and excluding "no new component, no
wrapper, no context". Both constraints turned out to be impossible to satisfy: the fix **cannot**
live in the file the contract named, and one site **had** to gain a wrapper. The implementation was
correct, and review nonetheless had to file it as a **CRITICAL** — because this project treats a
scope-contract violation as a correctness failure by convention.

That is the defect worth fixing. It is not about that one PR, which is merged (`fdb7e510`) with the
deviation ratified. It is that a contract written from a guess about where the fix would land turns a
correct implementation into a blocking finding, and the only escape is a human ratification at merge.

## Background — what actually happened

Verified during the PR #1000 review rounds:

1. **The named file could not hold the fix.** `accessibilityViewIsModal` only functions on each
   sheet's **own content root**. `@gorhom/bottom-sheet`'s `DraggableView` forwards only `accessible`,
   `accessibilityRole`, `accessibilityLabel` and `accessibilityHint` to its children wrapper, so a
   prop set from `MealPlanHomeScreen.tsx` never reaches a node where it does anything. Both reviewers
   traced this in `node_modules` rather than asserting it.
2. **The excluded wrapper was unavoidable.** `QuickAddSheet.tsx` returned a Fragment with three
   children and had no single content root to carry the prop. A Fragment cannot take one. The
   contract's "no wrapper" clause excluded the only option.
3. **Shared test infrastructure had to change.** `accessibilityViewIsModal` is invisible to jsdom
   without a mock mapping, so the co-located-tests-only framing could not produce a falsifiable test.

All three were judged necessary on the merits by two independent reviewers, and the CRITICAL was
filed explicitly to force a recorded human decision rather than to block. The user ratified it at
merge on 2026-09-20 and asked for this follow-up.

## The question to answer

Contracts exist for a real reason — they stop an executor inventing scope — and this todo must not
end by weakening them into decoration. The live tension:

- A contract written **before** implementation can only guess where the fix lands. When the guess is
  wrong, the executor must either violate the contract or ship a fix that does not work.
- A contract written **loosely enough** to never be wrong constrains nothing.

## Acceptance Criteria

- [ ] A decision is recorded either way, in `todos/TEMPLATE.md`'s Scope Contract section and in
      `docs/AI_WORKFLOW.md` → Tier handling (which is where "scope-contract violation = CRITICAL"
      lives). Leaving it unstated is the one outcome this todo exists to prevent.
- [ ] Whatever is chosen, the executor and the reviewers agree on it — the rule is stated in one
      place and referenced from the others, not restated in three files that can drift apart.
- [ ] The change does NOT make an invented-scope deviation cheaper to ship. Show this with a
      worked example of a deviation that should still be CRITICAL under the new rule.
- [ ] `todos/TEMPLATE.md`'s guidance tells an author how to write a contract that constrains
      MECHANISM without over-committing to FILES, if that is the chosen direction.

## Implementation Notes

Three candidate directions, with honestly different costs:

1. **Constrain mechanism, not file paths.** "No new gate, no new abstraction, no new API call" is
   checkable without predicting the call site; "Files in scope: X.tsx" is a prediction. Cheapest, and
   keeps the CRITICAL rule intact for what it is actually good at. Weakens the contract's ability to
   stop a sprawling diff, which is the thing to test with the worked example.
2. **Keep file lists, add a first-class amendment path.** Let an executor amend its own contract
   in-PR when it can show the named scope is impossible, with the amendment itself reviewed. This is
   what both PR #999 and PR #1000 did ad hoc; it works, but it is currently an improvisation that
   reads as a violation until a human ratifies it.
3. **Keep everything, downgrade the tier when the deviation is disclosed and justified in-PR.**
   Smallest change to the convention, but it makes the CRITICAL/WARNING boundary depend on how well
   the author wrote their own justification, which is a poor thing to hinge a gate on.

Direction 2 has the most evidence behind it: two PRs in one run independently invented it, which is
usually a sign the process is missing a step rather than that both authors erred.

## Scope Contract

- **Mechanisms to use:** the existing Scope Contract section and the existing tier convention. No new
  gate, no new file, no new automation.
- **Files in scope:** `todos/TEMPLATE.md`, `docs/AI_WORKFLOW.md`, and
  `.claude/agents/todo-executor.md` if the executor's own instructions need to reference the rule.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. PR #1000 is merged and its deviation is ratified; this is a process improvement, not a fix.

## Risks

- The obvious failure mode is over-correcting into a contract that never blocks anything. The worked
  example in the acceptance criteria exists specifically to catch that.
- `docs/AI_WORKFLOW.md` is consumed by every reviewer dispatch and by generated Copilot
  instructions — changing the tier rule changes reviewer behaviour everywhere at once, so the
  wording matters more than its length suggests.

## Updates

### 2026-09-20

- Filed at the user's request when ratifying PR #1000's deviation at merge. The three impossibility
  findings were verified against `@gorhom/bottom-sheet` source by two reviewers before this was
  filed, not inferred from the complaint.
