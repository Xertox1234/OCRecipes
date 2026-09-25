---
title: Relaxing or extending a shared contract requires auditing what relied on the old guarantee
track: knowledge
category: conventions
tags: [architecture, typescript, validation, shared-types, preconditions, discriminated-union, fail-silent, review-checklist, harness]
module: shared
applies_to: ["shared/types/**/*.ts", "server/services/**/*.ts", "client/lib/**/*.ts", ".claude/agents/**/*.md", ".claude/hooks/**/*.sh"]
symptoms: ["A gate is loosened and something unrelated downstream quietly stops working", "A new union member is added and never appears in the UI", "No test fails, no type error appears, and the regression is only visible on a device", "A correct, well-commented, tested behaviour becomes a bug without its code changing"]
created: 2026-07-30
last_updated: 2026-09-24
---

# Relaxing or extending a shared contract requires auditing what relied on the old guarantee

## Rule

When you **remove a precondition** or **add a member to a shared union**, the
risk is not in the code you changed. It is in the code that was silently
depending on the guarantee you just removed, or on the set being closed.

Before landing the change, enumerate the consumers and check each one against
the *new* possibility space.

## Smell patterns

- A diff that deletes a clause from a validation gate and touches nothing else.
- A diff that adds a case to a `type X = "a" | "b"` union and touches nothing else.
- A comment downstream that reasons "at most one of these can be missing" or
  "this is always present" without a type that enforces it.
- A `Set<Kind>` / lookup table / `if-else` chain keyed on a union, with a
  defensive `else` that logs rather than fails.

## Why

Two instances from one change in one session, and a third from a harness gate
(below):

**1. Removing a precondition.** `buildLabelConflict` blanks the macros a label
did not read, with a well-argued comment: the record is demonstrably mis-scaled,
so inheriting its other values would create impossible relationships
(sugar > carbs). That reasoning silently assumed *at least one macro was read* —
true by construction, because the presence gate required `sugars OR fat`.

Relaxing the gate to `calories + serving` made **total blanking the normal
path**. `evaluateUniversalFlags` then saw `undefined` for every nutrient and
emitted nothing — so a label-corrected result rendered identically to a
genuinely clean product. "High in sugar", high sodium and high saturated fat all
vanished, on the screen that tells the user to trust the label. Nothing errored,
no test failed, and the comment explaining the blanking was still accurate about
its own logic.

**2. Extending a union.** Adding `"nutrient-unavailable"` to `ScanFlagKind`
compiled fine. But `partitionScanFlags` routes by two `Set<ScanFlag["kind"]>`
membership tests and sends anything unmatched to a defensive `else` that
`logger.warn`s and **drops the flag from both display sections**. Registering
the new kind in `UNIVERSAL_KINDS` was load-bearing: without it, a flag whose
entire purpose is to prevent a silently-missing warning would itself have been
silently dropped.

The common shape: a set-membership or presence check degrades **quietly** when
the set grows or the guarantee shrinks. A `switch` with no `default` would have
failed the build; a `Set` lookup with an `else` branch will not.

**3. A consumer written in prose (2026-09-24).** The 2026-09-22 one-review-pass
ruling (#1015) grew `merge-review-guard.sh`'s accepted verdict set from `clean`
to `clean | advisory`, and updated `docs/AI_WORKFLOW.md` to match. That left one
consumer: `todo-executor.md` Step 10.7c, a jq check that copies the gate's
predicate so an executor can confirm its PR will pass before reporting. It still
selected `.verdict=="clean"` only. For an advisory-only review, that returned
empty, used up the re-dispatch, and reported `REVIEW_STAMP: none at` for a PR the
gate would admit. Nothing could flag it: CI does not run agent markdown. Six
real executor runs (#1038–#1040, #1047, #1049, #1055) worked around it by
improvising a report, and five of them labelled an `advisory` record `clean at`.
Found by reading the stamps on disk against each executor's report.

A consumer can be a copied predicate in documentation or an agent prompt, not
only an importer. `git grep` for the set's literal members (`"clean"`,
`verdict==`) finds those copies. A symbol search does not. The fixed copy now
says which gate line it mirrors and that the two change in the same PR.

## Examples

Prefer a shape that fails loudly when the contract moves:

```ts
// Forces every exit to declare itself — adding a required field surfaced all
// three return sites in buildLabelConflict at once.
export interface LabelConflict {
  conflict: boolean;
  compared: boolean;
  nutrientsUnknown: boolean; // required, not optional
}
```

An **optional** field here would have let the refusal paths default quietly and
never prompted a re-read of them. Same reason `getCapturePlan` in
`client/screens/scan-screen-utils.ts` uses an exhaustive `switch` with **no
`default:`** — omitting a future phase is a TS2366 build error, not a runtime
surprise.

Audit checklist for a contract change:

1. `git grep` the symbol and every set/table keyed on it.
2. For each consumer, ask: what did it assume that is no longer true?
3. Prefer a compile-time failure (required field, exhaustive switch) over a
   runtime warn-and-drop.

## Exceptions

A genuinely additive change to a **closed** consumer set — one where every
consumer already has an explicit, tested branch for the new case — does not need
the sweep. That is rare; verify rather than assume it.

## Related Files

- `server/services/label-override.ts` — the presence gate and the blanking block
- `shared/types/scan-flags.ts` — `ScanFlagKind`, `createNutrientUnavailableFlag`
- `client/screens/nutrition-detail-flags-utils.ts` — `UNIVERSAL_KINDS` and the warn-and-drop default
- `client/screens/scan-screen-utils.ts` — `getCapturePlan`, the exhaustive-switch precedent
- `.claude/hooks/merge-review-guard.sh` — the `VERDICT` accept set (`clean` or `advisory`), instance 3's contract
- `.claude/agents/todo-executor.md` — Step 10.7c's jq, the prose-side copy of that set

## See Also

- [A disjunctive gate whose alternatives fail to the same root cause](../logic-errors/disjunctive-gate-alternatives-sharing-one-failure-mode-2026-07-30.md) — the gate whose relaxation triggered instance 1
- [A replacement must accept everything its predecessors accepted](replacement-must-accept-predecessor-inputs-2026-07-30.md) — the same blind spot in the opposite direction: verifying new intent instead of preserved behaviour
- [Discriminated-union case collapse must audit the absorbed semantics](discriminated-union-case-collapse-audit-absorbed-semantics-2026-07-14.md) — the mirror case: collapsing a union member, not adding one
