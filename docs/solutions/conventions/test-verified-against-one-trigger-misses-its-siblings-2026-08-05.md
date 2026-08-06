---
title: "Verifying a test fails without its fix proves it catches THAT bug, not the class — enumerate the triggers of whatever you removed"
track: knowledge
category: conventions
tags: [testing, regression-tests, verification, negative-control, accessibility, refactoring]
module: client
applies_to: ["**/__tests__/**/*.test.ts", "**/__tests__/**/*.test.tsx"]
symptoms: ["A regression test was confirmed red-then-green, and a near neighbour of the same bug still slips past it", "A test asserts a not-called/absent condition but exercises only one of the removed code's inputs", "An assertion pins an input that could not occur in reality as expected output", "A test passes before the whole operation under test has finished"]
created: 2026-08-05
---

# Verifying a test fails without its fix proves it catches THAT bug, not the class — enumerate the triggers of whatever you removed

## Rule

Temporarily reverting a fix to watch its test go red is the right habit, and it
proves less than it feels like. It shows the test catches **the specific defect
you fixed**. When the fix *removes* code, the test must exercise every input
that code responded to — otherwise it silently proves one leg and assumes the
rest.

Two companion rules from the same session:

- A test asserting "nothing happened" must wait until the whole operation has
  run. Asserting at the first observable state change leaves most of the
  lifecycle unobserved.
- Never pin an input that cannot occur in reality as expected output, even when
  it makes a bug easier to demonstrate.

## Smell patterns

- `expect(spy).not.toHaveBeenCalled()` where the removed code had a dependency
  array with more than one entry, and the test populates one of them
- A `waitFor` on the *first* piece of state the operation sets, followed
  immediately by the assertions
- A fixture asserting a relationship the domain forbids (a child value exceeding
  its parent, a total below its parts) as the correct answer
- A docblock claiming coverage "across the states that X in turn" where only one
  of the listed cases actually discriminates fixed-from-broken

## Why

An effect deleted from a hook ran on `[correctionNotice, labelReadNotice]`. Its
replacement test set only `labelReadNotice`, and asserted the moment that
appeared — before the `await fetch(...)` that would have set the other. Red-then-
green verification passed. Then reinstating a **corrections-only** duplicate
announcer left the test green while reintroducing the bug, because the surviving
trigger was never exercised and the assertion fired too early to see a later
call at all.

The failure is not laziness, it is scope confusion. "Does this test fail without
the fix?" answers a narrower question than "does this test guard the property the
fix established". A removal establishes a property over the removed code's whole
input surface; the test has to cover that surface, not one point on it.

The impossible-input rule has a different cost. A test pinned
`Sugars 39` against `Carbohydrate 5` — sugars exceeding total carbohydrate,
physically impossible — because a small parent made the bug produce a visibly
wrong number. It worked, and it also wrote down "a child may exceed its parent,
adopted anyway" as intended behaviour. Harden the validation later and that test
goes red while reading like an intentional regression.

## Examples

```ts
// ✅ Both triggers of the deleted effect, each with a negative control, and
//    each waiting for the operation to finish rather than for its first side effect.
it("does not announce the notice itself — that belongs to NoticeStack", async () => {
  const { result } = render(null);
  await waitFor(() => expect(result.current.labelReadNotice).not.toBeNull());
  await waitFor(() => expect(result.current.isLoading).toBe(false)); // <-- whole lookup
  expect(result.current.labelReadNotice).toContain("couldn't read"); // negative control
  expect(announce).not.toHaveBeenCalled();
});

it("does not announce a serving correction either", async () => { /* the OTHER trigger */ });
```

```ts
// ❌ Discriminates, but asserts an impossible label as expected input
expect(parseNutritionFromOCR("Carbohydrate 5 g\nSugars 39 9").totalSugars).toBe(39);

// ✅ Still discriminates (the buggy path yields null here), coherent label
expect(parseNutritionFromOCR("Carbohydrate 45 g\nSugars 39 9").totalSugars).toBe(39);
```

Also check the platform assumptions that make a test meaningful: `Platform.OS`
is `"ios"` in `test/mocks/react-native.ts`, so an iOS-gated announcer does fire
under test. Had the mock said `"android"`, the not-called assertion would have
passed against the unfixed code and guarded nothing.

## Exceptions

For a fix that *adds* a single narrow behaviour with one input, red-then-green on
that input is complete — there is no other trigger to enumerate. The rule bites
on removals, on consolidations (two announcers into one), and on any fix whose
subject had multiple entry points.

## Related Files

- `client/hooks/__tests__/useNutritionLookup.labelRead.test.tsx` — both announcement triggers, each with a negative control
- `client/screens/__tests__/NutritionDetailScreen.test.tsx` — the disclaimer loop test, whose docblock now says which case discriminates
- `client/lib/__tests__/nutrition-ocr-parser.test.ts` — the coherent-parent fixture
- `test/mocks/react-native.ts` — `Platform.OS`, which decides whether a platform-gated assertion means anything

## See Also

- [a gate test must be two-sided](gate-test-needs-two-sided-negative-control-2026-07-25.md) — the negative-control half of this
- [a fixture stops guarding the moment you fix the defect it documents](fixture-stops-guarding-when-its-defect-is-fixed-2026-08-05.md) — the same blindness from the other direction: a still-green test whose evidence has evaporated
- [broadened matcher needs new input regression tests](../best-practices/broadened-matcher-needs-new-input-regression-tests-2026-07-20.md) — the widening counterpart to this removal rule
- The removal this rule came from is the duplicate iOS announcer deleted from
  `useNutritionLookup`; its own solution doc
  (`child-before-parent-effect-order-is-a-single-commit-guarantee-2026-08-05`)
  lands with PR #753, so it is named rather than linked to avoid a pointer that
  is dead until then.
