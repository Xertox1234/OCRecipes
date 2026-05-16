---
title: "Dead UI branch from a context builder hardcoding a placeholder field"
track: bug
category: logic-errors
tags: [typescript, api, client-state, architecture]
module: server
applies_to: ["server/services/*context*.ts", "server/services/*-builder.ts"]
symptoms:
  - "A client component's conditional render branch always shows the fallback"
  - "A service builder returns a literal null / [] / 0 for a field whose type allows real values"
  - "tsc passes but a feature's data silently never appears in the UI"
created: 2026-05-16
severity: medium
---

# Dead UI branch from a context builder hardcoding a placeholder field

## Problem

A backend "context builder" service returns a response object with a field
hardcoded to a placeholder (`null`, `[]`, `0`). The field's declared type
permits real values, and a client component is built to render it — so the
client's render branch is permanently dead. `tsc` cannot catch it because
`field: null` is assignable to `field: T | null`.

Found in audit `2026-05-16-unfinished-features` (M2): `buildCoachContext`
returned `goals: null` unconditionally. The `GET /api/coach/context`
endpoint therefore never sent goal data, and `CoachDashboard`'s
remaining-calories display (`goals ? goals.calories - todayIntake : "—"`)
always rendered the `"—"` fallback — even for users who had calculated
goals stored in `users.dailyCalorieGoal` etc.

## Symptoms

- A client component has a `{x ? <render x/> : <fallback/>}` branch that, in
  practice, always shows the fallback.
- The server builder for that data has a literal `field: null` (often with a
  `// TODO` comment) where the type is `field: T | null`.
- The real data needed to populate the field is already fetched in the same
  builder function (so it is not even a missing-query problem).

## Root Cause

OCRecipes deliberately keeps API response types **inline / duplicated** at
the call site rather than sharing one type from `@shared` (see
`docs/solutions/conventions/response-types-inline-over-shared-2026-05-13.md`).
The server builder and the client consumer each declare their own copy of
the shape. They share no compile-time contract, so a server-side placeholder
that drifts from the client's expectations is invisible to the type checker
and to any single-file review.

A `goals: null` literal also satisfies a `goals: SomeType | null` field
without complaint, so the gap survives `tsc`.

## Solution

Populate the field from data the builder already has. For M2, the `user`
row (with `dailyCalorieGoal` / `dailyProteinGoal` / `dailyCarbsGoal` /
`dailyFatGoal`) was already fetched in the builder's `Promise.all`:

```ts
goals: user?.dailyCalorieGoal
  ? {
      calories: user.dailyCalorieGoal,
      protein: user.dailyProteinGoal || 0,
      carbs: user.dailyCarbsGoal || 0,
      fat: user.dailyFatGoal || 0,
    }
  : null,
```

Mirror an existing populated path if one exists — here `coach-pro-chat.ts`
already assembled the same shape for the AI prompt context. Widen the
builder's response type from the placeholder literal (`null`) to the real
union.

## Prevention

- When reviewing or auditing a context-builder service, check **every field**
  of its return type: is it populated from real data, or hardcoded? For each
  hardcoded field, grep the client consumer(s) — a rendered field with a dead
  source is a bug.
- A `// TODO` next to a hardcoded field is a strong smell; verify whether the
  blocker the TODO cites is even real. The M2 TODO claimed physical-profile
  data was needed (`calculateGoals`); in fact persisted goal columns already
  existed and the prescribed fix was wrong. **Verify the mechanism before
  applying a prescribed fix** — discovery findings (and prior-audit manifests)
  can carry an incorrect prescription even when the symptom is real.

## Related Files

- `server/services/coach-context-builder.ts` — the fixed builder
- `client/hooks/useCoachContext.ts` — client's duplicated `CoachContextData`
- `client/components/coach/CoachDashboard.tsx` — the consumer with the branch
- `server/services/coach-pro-chat.ts` — the already-populated sibling path

## See Also

- `docs/solutions/conventions/response-types-inline-over-shared-2026-05-13.md`
- `docs/audits/2026-05-16-unfinished-features.md` — finding M2
