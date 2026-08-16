---
title: "NutritionDetail's itemId/saved-item branch has no production producer — wiring gap or dead code?"
status: backlog
priority: medium
created: 2026-08-16
updated: 2026-08-16
assignee:
labels: [deferred, react-native, navigation, client-state]
github_issue:
human_led: true
blocked_reason: "The only acceptance criterion is a product decision: whether tapping a logged item is meant to open NutritionDetail (currently unreachable) or ItemDetail (what actually happens today). An unattended run would pick whichever is cheaper to implement, write it up as a settled decision record, and delete or wire a user-facing screen path on that basis. Every file in the Scope Contract is on todo-automerge-guard's SAFE_ALLOWLIST, so nothing else would stop it."
---

# NutritionDetail's saved-item branch is wired, typed, tested — and unreachable

## Summary

`useNutritionLookup` has a fully-implemented `itemId` branch: it queries
`/api/scanned-items/:id`, populates `nutrition`, drives a distinct render path in
`NutritionDetailScreen` (no serving controls, no log bar), and is covered by tests. **No
production code navigates to `NutritionDetail` with an `itemId`.** Either something was
meant to route there and doesn't, or the branch is dead code — and the two answers imply
opposite work.

## Background

Surfaced by a `code-reviewer` pass over `be3ba334..ca4b1894` on 2026-08-15 (PRs
#819/#821/#823/#828) as a `[SUGGESTION]`. It was raised because those PRs' comments and
decision records repeatedly described the saved-item path as live user-facing behaviour —
"the same product bands differently depending on whether it was opened from a scan or from
Today" — which overstates present-day reachability. Those comments were corrected in #828;
the underlying question was not, and is this todo.

### Enumerated 2026-08-15 against `ca4b1894`

Every non-test reference that navigates to `NutritionDetail`:

| Producer                                        | Params it sends                                                                                                                                                                                |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client/screens/scan-screen-utils.ts:385`       | `buildNutritionDetailParams` — `barcode` + optional `ocrText` / `nutritionImageUri` / `frontImageUri`. Never `itemId`.                                                                         |
| `client/components/coach/CoachChat.tsx:362-365` | Zod-narrowed by `screenParamSchemas.NutritionDetail = z.object({ barcode: z.string() })` (`shared/schemas/coach-blocks.ts`) — `z.object` strips an `itemId` an LLM-generated action might emit |
| `client/navigation/linking.ts`                  | deep link `ocrecipes://nutrition/:barcode` — barcode only                                                                                                                                      |

And the flow that _would_ be the natural producer goes elsewhere:

| Flow                             | Where it actually goes                                                                                                              |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Tapping a logged item in history | `client/hooks/useHistoryData.ts:186` → `navigation.navigate("ItemDetail", { itemId })`                                              |
| `ItemDetailScreen`               | Independent implementation. Does **not** use `useNutritionLookup` (only names it in a comment about a matching query key at `:142`) |

So `ItemDetail` is today's saved-item screen, and `NutritionDetail`'s `itemId` branch is a
parallel, unreachable implementation of the same idea.

### Why it matters beyond dead code

Two shipped decisions reason about the saved-item path as though it were live:

- **PR #819's** `effectivePer100g` null guard — its case analysis and its comments are
  written around saved-item behaviour.
- **The archived won't-do** in
  `todos/archive/P3-2026-08-15-should-saved-item-path-populate-servingsizegrams.md` —
  declined partly because "saved-item bands already work", which is true of
  `nutrition-band-source` but describes a screen nobody opens.

Neither is _wrong_. Both would read differently if the branch is dead. And if it is
instead a wiring gap, then the FSA-banding behaviour those decisions describe is a feature
users were supposed to have and don't.

## The question

**Is `NutritionDetail`'s `itemId` branch (a) an intended destination that lost its
producer, (b) a deliberate alternative kept for a near-term wiring, or (c) superseded by
`ItemDetail` and removable?**

Answer that first. The work follows from it and is small in every direction — do not start
implementing before the call is made.

## Acceptance Criteria

- [ ] The question above is answered by a human, with the answer recorded in this file
- [ ] **If (c) superseded:** delete the `itemId` branch from `useNutritionLookup` and its
      render path in `NutritionDetailScreen`, drop `itemId` from
      `RootStackParamList["NutritionDetail"]`, and remove the now-dead saved-item tests.
      Note that this **supersedes**
      `todos/P2-2026-08-15-nutritiondetail-route-params-permit-illegal-mode-combinations.md`
      — with `itemId` gone the discriminated union has only two arms and that todo shrinks
      or closes; reconcile the two rather than doing both
- [ ] **If (a) a wiring gap:** identify the intended producer and wire it, and state
      explicitly how `NutritionDetail`-with-`itemId` differs from `ItemDetail` for a user —
      two screens showing one logged item needs a reason
- [ ] **If (b) kept deliberately:** record why and what it is waiting on, and correct the
      comments in `useNutritionLookup.ts` that still imply the saved-item path is
      user-reachable
- [ ] Whichever branch: no change to `effectivePer100g`'s guard from #819 — it is correct
      under all three answers
- [ ] Closes with zero follow-ups beyond the reconciliation named above

## Implementation Notes

- The saved-item render path is real, not a stub: `NutritionDetailScreen.tsx` gates
  `showLogBar` on `!itemId` (`:259`) and `showServingControls` on
  `!itemId && !!barcode && …` (`:261`), and `selectBandSource` has a dedicated saved-item
  branch (`client/components/nutrition/nutrition-band-source.ts:143-163`). Deleting the
  branch means unpicking all of that.
- `ItemDetailScreen` uses a tuple query key deliberately matched to `useNutritionLookup`'s
  `existingItem` read (see its comment at `:142`) — evidence the two were once intended to
  share cache. That history is worth reading before assuming (c).
- Check git history for a producer that was removed rather than never written; a deleted
  `navigate("NutritionDetail", { itemId })` would settle the question immediately.

## Scope Contract

- **Mechanisms to use:** deletion, or a single `navigation.navigate` call — no new screen,
  no new hook, no schema change
- **Files in scope:** `client/hooks/useNutritionLookup.ts`,
  `client/screens/NutritionDetailScreen.tsx`,
  `client/navigation/RootStackNavigator.tsx`, `client/hooks/useHistoryData.ts`, and the
  co-located tests for those
- Explicitly OUT of scope: `ItemDetailScreen`'s own implementation, and
  `nutrition-band-source.ts`'s saved-item branch (used by whichever screen wins)
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- Interacts with
  `todos/P2-2026-08-15-nutritiondetail-route-params-permit-illegal-mode-combinations.md` —
  see the (c) acceptance criterion. Decide this one FIRST; it can shrink or close that one.

## Risks

- **Deleting a branch someone is mid-way through wiring** is the expensive wrong answer,
  which is why this is human-gated rather than an implementation task.
- The reachability enumeration is a bounding claim ("no producer"), and a negative is the
  kind of claim that hides a live instance. It was made by grep over `client/` — re-verify
  before deleting anything, including any dynamic/`as`-cast navigation the enumeration
  would miss.

## Updates

### 2026-08-16

- Filed at the user's request from a `code-reviewer` `[SUGGESTION]` on the
  `be3ba334..ca4b1894` review pass. Producer enumeration verified against `ca4b1894`
  2026-08-15; the comments that overstated reachability were corrected in PR #828.
