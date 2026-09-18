---
title: "NutritionDetail's itemId/saved-item branch has no production producer — wiring gap or dead code?"
status: done
priority: medium
created: 2026-08-16
updated: 2026-09-17
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

| Producer                                        | Params it sends                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `client/screens/scan-screen-utils.ts:385`       | `buildNutritionDetailParams` — `barcode` + optional `ocrText` / `nutritionImageUri` / `frontImageUri`. Never `itemId`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `client/components/coach/CoachChat.tsx:362-365` | **CORRECTED 2026-08-16 — this row previously claimed `z.object` strips an `itemId`. It does not.** `validateNavigateParams` (`shared/schemas/coach-blocks.ts:114`) calls `schema.safeParse(val.params)` and branches on `.success` only; it never reassigns `val.params` to the stripped `result.data`. Verified by probing the live module: a payload of `{ barcode, itemId }` for `screen: "NutritionDetail"` returns `success: true` with `itemId` **still attached**, and reaches the pre-existing `params as RootStackParamList["NutritionDetail"]` cast at `CoachChat.tsx:365` intact. So validation does **not** block an `itemId` here. This is a _possible_ producer, not an observed one — it still requires the LLM to emit `itemId` in an action payload, which has not been seen in production. Read this row as "unblocked but unobserved", not as "live traffic". Tracked in `todos/P3-2026-08-16-coach-blocks-validatenavigateparams-does-not-strip-extra-params.md` |
| `client/navigation/linking.ts`                  | deep link `ocrecipes://nutrition/:barcode` — barcode only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

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

- [x] The question above is answered by a human, with the answer recorded in this file
- [x] **If (c) superseded:** delete the `itemId` branch from `useNutritionLookup` and its
      render path in `NutritionDetailScreen`, drop `itemId` from
      `RootStackParamList["NutritionDetail"]`, and remove the now-dead saved-item tests.
      Note that this **supersedes**
      `todos/P2-2026-08-15-nutritiondetail-route-params-permit-illegal-mode-combinations.md`
      — with `itemId` gone the discriminated union has only two arms and that todo shrinks
      or closes; reconcile the two rather than doing both
- [~] **If (a) a wiring gap:** n/a — answer was (c) identify the intended producer and wire it, and state
  explicitly how `NutritionDetail`-with-`itemId` differs from `ItemDetail` for a user —
  two screens showing one logged item needs a reason
- [~] **If (b) kept deliberately:** n/a — answer was (c) record why and what it is waiting on, and correct the
  comments in `useNutritionLookup.ts` that still imply the saved-item path is
  user-reachable
- [x] Whichever branch: no change to `effectivePer100g`'s guard from #819 — it is correct
      under all three answers
- [x] Closes with zero follow-ups beyond the reconciliation named above

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

### 2026-09-17 — ANSWERED: (c) superseded. Branch removed.

**The human's call, made in-session after being shown the gate reason and the
archaeology below: (c) — superseded by `ItemDetail`, remove it.** Scope was
widened by the same decision to include `nutrition-band-source.ts`'s saved-item
arm, so the "zero follow-ups" criterion is actually met rather than deferred.

#### What the git history settles

| Date       | Commit     | What it did                                                                                                                                                                                                                                               |
| ---------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-01-22 | `721df5f6` | `NutritionDetailScreen` registered in `RootStackNavigator` (1 hit for `name="NutritionDetail"`), already carrying the full `itemId` branch. `HistoryStackParamList` had only `History`. `HistoryScreen` called `navigate("NutritionDetail", { itemId })`. |
| 2026-01-28 | `d8982797` | Created `ItemDetailScreen` and registered it **in the History stack under the name `NutritionDetail`** — shadowing the root route without touching the navigate call.                                                                                     |
| 2026-01-29 | `649af17b` | Renamed that History route `NutritionDetail` → `ItemDetail` and repointed `HistoryScreen`. Subject line: "**fix** item detail navigation".                                                                                                                |

This is route-name shadowing: `navigate("X")` resolves to the NEAREST navigator
declaring `X` and only bubbles upward if none does, so registering a same-named
route in a child stack silently re-targets existing call sites with no compile
error and no diff on the call itself. The todo's grep-based producer enumeration
could never have caught it, because the producer string never changed.

**Deliberately NOT claimed:** whether the 2026-01-22 call ever resolved to the
root screen. `HistoryStackNavigator`'s nesting at that commit was not verified,
`649af17b`'s "fix" wording points the other way, and `721df5f6` is a squashed
Replit agent checkpoint. It does not bear on the answer.

#### Reachability re-verified before deleting (the todo's Risks section)

The bounding claim was traversed across every channel, not asserted:

- **Literal producers — 3, none send `itemId`:** `scan-screen-utils.ts:93`
  (`{ barcode }`), `ScanScreen.tsx:260` (`buildNutritionDetailParams` →
  barcode + label-capture companions), `CoachChat.tsx:501` (an `as` cast).
- **Dynamic targets — true zero.** A regex for a non-literal first argument to
  `navigate`/`push`/`replace` matched 0 rows in `client/`, validated against a
  synthetic positive control first (the initial attempt used a non-POSIX `\s`
  and silently matched nothing).
- **Imperative `navigationRef`** — one call, for `NotebookEntry`.
- **Deep link** — `nutrition/:barcode`, barcode-only.
- **The Coach path is now actively BLOCKED, not merely unobserved.** The table
  row above says `validateNavigateParams` does not strip an `itemId`. That was
  corrected hours before #854 (`de457c35`) landed and is itself stale:
  `coach-blocks.ts:67` declares `NutritionDetail: z.object({ barcode })` and
  `validateNavigateParams` now does `val.params = result.data`, so a plain Zod
  object strips the key before `navigate` sees it — the comment there names
  `itemId` as its example. **Zero possible producers, not zero observed ones.**

#### Two premises in this todo that had gone stale

- **The dependency already closed.** `P2-2026-08-15-...illegal-mode-combinations`
  is archived, `status: done`, shipped as `8f98dc3b` (#837). So (c) meant
  _unpicking a discriminated-union arm built a month ago_, not simplifying a
  pending design — a different price than the body implies.
- **The out-of-scope rationale was false.** The todo excludes
  `nutrition-band-source.ts`'s saved-item branch as "used by whichever screen
  wins", but `selectBandSource` branches on `input.itemId === undefined` and
  `ItemDetailScreen` has **zero** references to that module. The arm was dead
  the moment the route arm went, which is why scope was widened to include it.

#### Behaviour preservation

- `selectBandSource`'s two arms genuinely disagreed on
  `validatedData === null && nutrition != null` — and that state IS reachable on
  the scan path (USDA / API Ninjas fallback). The disagreement was resolved by
  `itemId`, and only the dead branch took the populated route, so removal is
  behaviour-preserving on every reachable state.
- `showLogBar` was `!itemId`, i.e. already `true` on every reachable path — the
  `insets.bottom` arm and the `null` bar arm were exclusively saved-item.
- `effectivePer100g`'s #819 guard is byte-identical, per the criterion above.

#### Test disposition (counts verified before and after)

| File                                   | Before | After | Why                                                                                                                                                      |
| -------------------------------------- | ------ | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RootStackNavigator.paramlist.test.ts` | 4      | 3     | −2 `itemId` exclusivity cases; **+1 `@ts-expect-error` pin** that goes red if the arm returns                                                            |
| `nutrition-band-source.test.ts`        | 21     | 15    | −6 saved-item-branch tests                                                                                                                               |
| `useNutritionLookup.test.ts`           | 26     | 25    | `isBeverage` **adapted** to the `imageUri` path; −2 steady-state guard tests removed, **+1** pinning the guard through the re-fetch reset window (below) |
| `NutritionDetailScreen.test.tsx`       | 47     | 44    | −3 tests asserting the now-removed gates; default route moved from `{ itemId: 42 }` to `{ imageUri }`                                                    |

Three files carrying `itemId` for unrelated domain objects
(`useMicronutrients`, `useGroceryList`, `useSuggestionInstructions` — 0
`NutritionDetail` references each) were deliberately left untouched.

The `servingsConsumed` band test was deleted only after confirming its invariant
is asserted at its real source: `server/routes/__tests__/photos.test.ts:537,593`.

#### One finding the removal produced

`effectivePer100g`'s guard is retained per the criterion above. An earlier draft
of this record called its back-calculation arm **defensive rather than live** —
that was FALSE, and review caught it (`mobile-reviewer`, a warning on
`useNutritionLookup.ts`). The saved-item branch was the last **steady** producer,
not the last producer: `fetchBarcodeData`'s per-lookup reset nulls
`validatedData` while resetting neither `nutrition` nor `servingSizeGrams`, so a
re-fetch on a mounted instance transits the state for the duration of the new
lookup. The arm is LIVE, and a new test
(`returns no basis mid-re-fetch…`) pins it there: a first OFF lookup whose
serving is "1 bottle" leaves `servingSizeGrams` null, a second barcode is then
held in flight, and `recalculateNutrition` is asserted to be a no-op while the
prior product's values sit on screen with no validated basis. The steady-state
enumeration stands as far as it goes — the arm needs
`validatedData === null` while `nutrition.calories` is defined, and the
saved-item branch was the last producer of that pair. Traversed, not assumed:
every `setNutrition` call that supplies calories is paired with a
`setValidatedData` on the same path (server-DB `:513`←`:480`, label-override
`:571`←`:573`, OFF fallback `:714`←`:667`, conflict `:788`←`:790`, snapshot
`:795`←`:797`, manual-search `:826`←`:849`), and the calls that are not —
"Product Not Found", "Unknown Product", "Manual Entry" — carry no calories, so
the memo returns null at its `nutrition.calories === undefined` guard. `setValidatedData` is not on the return
surface, so the state cannot be driven from a test either.

The first attempt at adapting those two tests routed them through the
manual-search path and asserted `validatedData` was null; that assertion FAILED,
which is how this was found rather than shipped as a vacuous pass. Both tests
were removed, and the status is recorded at the guard itself and in that
describe's docblock so the missing coverage reads as a conclusion rather than an
oversight. **No follow-up filed** — the guard costs nothing, returns null from
the value rather than from caller gating, and re-arms correctly if a fallback
ever publishes values without validating them.

#### The two reviewers disagreed, and the disagreement was settled by running it

`mobile-reviewer` filed the claim above as false. `code-reviewer` examined the
same reset window and explicitly declined to report it, on the grounds that the
reset block is unchanged from `main` (so not a regression) and that the plain
reading of "producer" is "setter call site", which the traversal did enumerate
correctly. Both readings are defensible about the word; neither settles the
sentence.

The sentence as written was **"it has no reachable input"** — a reachability
claim, not a call-site claim — and that is false. Rather than adjudicate by
interpretation, the state was CONSTRUCTED and RUN: the new test holds a second
lookup in flight and asserts the guard returns null with the prior product's
values on screen. It passes. That is the evidence, and the prose was corrected
to match it rather than to match either reviewer's argument.

Review verified, by measurement: all four `it()`-count deltas; that `d8982797`
and `649af17b` do what this record claims; that the `{ itemId: 42 }` →
`{ imageUri }` default-route change makes no surviving assertion vacuous; and
that `server/routes/__tests__/photos.test.ts:537,593` genuinely covers the
invariant the deleted `servingsConsumed` band test pinned. No blocking issue was
found in any round.

Two reproducible checks stand behind the #819 acceptance criterion, in place of
a character count an earlier draft of this record quoted from a review and could
not reproduce:

- The memo's code is unchanged. Extract it from either ref, drop comment and
  blank lines, and hash it — 26 lines, `md5 d172c32c8105935dc09b748aa455866b` on
  both `main` and this branch:
  `git show <ref>:client/hooks/useNutritionLookup.ts | sed -n '/const effectivePer100g = useMemo/,/^  }, \[/p' | grep -vE '^\s*//' | grep -vE '^\s*$' | md5`
  (print the line count alongside the hash — an extraction that silently matches
  nothing hashes to the empty-input digest on both sides and reads as a match).
  Take the digest from THAT pipeline, not from a `$(...)` capture piped through
  `printf '%s'`: command substitution strips the trailing newline, so the two
  differ by one byte and produce completely different hashes. The first digest
  published here was the `printf` variant's and did not match its own quoted
  command — caught in review, corrected 2026-09-17.
- The new reset-window test is attributable to THIS guard, not a sibling.
  Restoring the pre-fix `servingSizeGrams || 100` makes exactly that one test
  fail, with `calories: 236` (= 100 × 236/100) against the expected no-op `100`
  — so it falls through `recalculateNutrition`'s own `> 0` branch and lands on
  `if (!effectivePer100g) return;`, which is the line under test.
