---
title: Vitest's esbuild/oxc transform strips TypeScript types without checking them — use tsc --noEmit for type-regression RED/GREEN evidence
track: knowledge
category: conventions
module: shared
tags: [vitest, typescript, testing, tdd, esbuild]
applies_to: ['**/*.test.ts', '**/*.test.tsx']
created: '2026-07-14'
---

# Vitest's esbuild/oxc transform strips TypeScript types without checking them — use tsc --noEmit for type-regression RED/GREEN evidence

## Rule

Never rely on a Vitest test run to prove a type-only regression (a removed
prop, a renamed field, a narrowed union) actually fails. This project's
Vitest config transforms TypeScript via esbuild/oxc, which strips type
annotations without validating them — a component call site passing a
prop that no longer exists, or missing one that's now required, compiles
straight through the Vitest transform and only surfaces as a *runtime*
failure if something at execution time actually depends on that prop's
value. If nothing does (e.g. a removed callback prop that a test never
invokes), the test can pass green with a genuinely broken type contract.
Use `npx tsc --noEmit` for RED/GREEN evidence on any change whose defect
would only manifest as a type error, not a behavioral one.

## Smell patterns

- A TDD "RED" step is written to expect a Vitest test failure caused by a
  prop-shape mismatch (e.g. "this should fail because the component still
  expects the old prop"), but when actually run, the test passes anyway —
  the removed/added prop was never exercised by anything the test asserts
  on.
- A task brief or plan says a test "fails due to a TypeScript error" as
  its expected RED behavior, without specifying `tsc` as the command to
  run.
- Code review needs to judge whether a prop-interface change is safe and
  the only evidence offered is "the tests still pass."

## Why

Not every TypeScript setup type-checks during test transformation —
`ts-jest`-style pipelines do, but esbuild/oxc-based transforms (used by
Vite/Vitest here) deliberately don't, for speed. A plan or task brief
written with the `ts-jest` assumption in mind will describe RED evidence
that this repo's tooling cannot actually produce. The gap is invisible
until someone actually runs the described RED step and it unexpectedly
passes — at which point the fix is to substitute `tsc --noEmit`'s error
count (before/after) as the real evidence, not to force the render test
into catching something it structurally can't.

## Examples

```bash
# Wrong way to prove a prop-interface change is a real regression/fix:
npx vitest run client/screens/__tests__/ScanScreen.test.tsx
# ...may pass even with a stale prop reference, if nothing in the test
# reads that prop's value.

# Right way — before the fix:
npx tsc --noEmit | grep ScanScreen.tsx
# client/screens/ScanScreen.tsx(632,47): error TS2322: Type '"ADD_NUTRITION_PHOTO"' not assignable ...

# After the fix:
npx tsc --noEmit
# (zero output — zero errors anywhere in the project)
```

When writing or reviewing a plan/task brief that describes a render test
as proof a type change is required, check whether the test's assertions
actually exercise the changed prop's *value* at runtime. If they don't,
call for `tsc --noEmit` output as the RED/GREEN evidence instead, and say
so explicitly in the brief rather than leaving the next implementer to
discover the gap mid-task.

## Exceptions

If the test genuinely reads and asserts on the changed prop's value at
runtime (not just passes it through unused), a Vitest failure IS valid
evidence — the esbuild/oxc gap only matters for changes whose only
consequence is a type-level contract violation with no runtime behavior
difference in the specific test being run.

## Related Files

- `vitest.config.ts` — the esbuild transform configuration with no
  type-checking plugin
- `client/screens/ScanScreen.tsx` — the prop-interface change (removed
  `onAddNutritionPhoto`/`onAddFrontPhoto`, added `screenReaderEnabled`)
  whose RED/GREEN evidence had to be recaptured via `tsc --noEmit`
