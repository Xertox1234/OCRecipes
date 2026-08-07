---
title: Mutual exclusion proven per call site holds only within one invocation
track: knowledge
category: conventions
module: client
tags: [client-state, hooks, react-native, accessibility, code-review, invariants]
applies_to: [client/hooks/**/*.ts, client/hooks/**/*.tsx, client/screens/**/*.tsx]
symptoms: ["A review verdict of verified mutually exclusive justified by enumerating assignment sites", "A setX with no corresponding reset anywhere in the file", "A per-invocation reset block that covers some fields of a related group but not others", "A bug that only reproduces on the second run of the same flow (a retake / retry / re-fetch)"]
created: '2026-08-06'
---

# Mutual exclusion proven per call site holds only within one invocation

## Rule

Proving that two pieces of state cannot be true together by inspecting **each
assignment site** is valid only **within a single invocation**. If either value has no
reset, a later invocation carries a stale one into exactly the combination the
per-site analysis ruled out.

A per-call-site analysis answers _"can these be **assigned** together?"_ The question
that decides whether a user hits the bug is _"can these be **true** together?"_ — and
for state with no reset, that spans invocations.

## Smell patterns

- **"Verified mutually exclusive" justified by enumerating assignment sites.** The enumeration is evidence about one pass through a function; the claim being made is about the whole lifetime of the hook or component instance.
- **A `setX` with no corresponding reset anywhere in the file.** If `setX(null)` / `setX(false)` appears nowhere, `X` is monotone: once set, it survives every subsequent invocation until unmount.
- **A per-invocation reset block that covers some fields of a related group but not others.** The asymmetry is the tell, and it sits in the same function the reviewer is already reading.

## Why

Two reviewers reached **opposite conclusions on the same code**, and both analyses were
internally correct — which is what makes this worth codifying rather than filing as one
reviewer's mistake.

Reviewer A worked per call site and concluded:

> verified — `correctionNotice` and `isPer100g` are set exclusively in success branches
> that are mutually exclusive, in this hook instance's lifetime, with every `setError`
> call site.

That is true of **one lookup**. Every place that sets a notice is in a branch that
cannot also reach `setError` on the same pass.

Reviewer B probed the real, unmocked hook across **two sequential lookups** and found the
combination reachable. The per-site enumeration never became wrong; it answered a
narrower question than the one asked, and the phrase "in this hook instance's lifetime"
is precisely where the scope silently slipped — an instance's lifetime spans many
invocations of `fetchBarcodeData`, not one.

**The reset list's own asymmetry is the tell.** `fetchBarcodeData` in
`client/hooks/useNutritionLookup.ts` opens with an explicit, commented reset block —
`setFlags([])`, `setConflict(null)`, `setLabelReadNotice(null)`, `setLabelUsed(false)`,
`setDbSnapshot(null)`, `setActiveSource("database")`, `setIsBeverage(null)`,
`setValidatedData(null)` — each carrying a "fail-safe by construction" rationale for why
a failing path must not inherit the previous product's value. `correctionNotice` and
`isPer100g` are **not in that block**, and there is no `setCorrectionNotice(null)`
anywhere in the file. Eight members of a related group are reset per invocation and two
are not, in the function the reviewer was already reading.

The consequence, measured rather than predicted: a label **retake** (a second lookup
after a serving-size correction in the first) carries the stale `correctionNotice` into
a lookup that errors, so `NoticeStack` and `InlineError` both announce in the same
commit — two `announceForAccessibility` calls, and on iOS
`UIAccessibility.post(.announcement)` does not queue, so the first is cut off.

## Examples

- Bad (the analysis, not the code): enumerate every `setCorrectionNotice` and every `setError`, observe no branch reaches both, report "verified mutually exclusive."
- Good: enumerate the same sites, then ask **"is either value reset per invocation?"** — `grep -n 'setCorrectionNotice' client/hooks/useNutritionLookup.ts` returns a declaration and two assignments and no reset, which ends the analysis immediately.
- Good: diff the per-invocation reset block against the state the claim ranges over. Any member of the group that is missing from the block is a value that outlives the invocation.

## Exceptions

- **State that genuinely cannot outlive one invocation.** Locals, values recomputed every render, and refs explicitly cleared on mount are bounded by construction — the per-call-site analysis is the whole analysis there.
- **A value whose staleness is the intended behaviour** (a sticky preference, a "seen this once" flag). Then the claim to check is not mutual exclusion but whether every consumer is correct on a carried-over value.

## Related Files

- `client/hooks/useNutritionLookup.ts` — `fetchBarcodeData`'s reset block; `correctionNotice` and `isPer100g` are the two omissions
- `client/screens/__tests__/NutritionDetailScreen.test.tsx` — the characterization assertion pinning the residual two-announce collision

## See Also

- [a-stated-invariant-is-not-an-enforced-one-2026-08-06.md](a-stated-invariant-is-not-an-enforced-one-2026-08-06.md) — the sibling failure, and the discriminator: that rule covers a **written claim** that no code enforces, where the fix is to add structure; this one covers a **verification method** that was sound but scoped to one invocation, where the fix is to widen the analysis window
- [reset-derived-state-on-prop-change-2026-05-13.md](reset-derived-state-on-prop-change-2026-05-13.md) — the same hazard from the writing side: derived state needs an explicit reset keyed on what it derives from
- [../logic-errors/two-announceforaccessibility-same-commit-collide-ios-2026-07-21.md](../logic-errors/two-announceforaccessibility-same-commit-collide-ios-2026-07-21.md) — why two announces in one commit is the harm, and why iOS loses the first
- [../logic-errors/imperative-announce-must-be-content-keyed-not-variant-keyed-2026-06-24.md](../logic-errors/imperative-announce-must-be-content-keyed-not-variant-keyed-2026-06-24.md) — why a content-keyed `lastAnnouncedRef` does **not** absorb this: suppressing one contributor makes the composed key shorter, not absent
