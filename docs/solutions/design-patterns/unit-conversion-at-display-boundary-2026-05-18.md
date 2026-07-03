---
title: Unit conversion at display boundary — canonical metric storage with leaf conversion
track: knowledge
category: design-patterns
module: shared
tags: [unit-conversion, display-boundary, measurement-unit, canonical-units, input-validation, rounding]
applies_to: [shared/lib/units.ts, client/**/*.tsx, server/**/*.ts]
created: '2026-05-18'
---

# Unit conversion at display boundary — canonical metric storage with leaf conversion

## When this applies

Any feature that stores physical quantities (weight in kg, height in cm) and must display or accept input in a user-preferred unit system (imperial or metric). The pattern applies:

- When a per-user measurement preference exists (`users.measurementUnit: "metric" | "imperial"`).
- When the canonical storage unit is metric (kg, cm) but the UI should show imperial equivalents (lbs, in).
- When input validation must accept values in the user's unit system but enforce bounds in canonical units.
- When derived values (percentage, ratio, direction) do not need conversion.

Do **not** apply when the stored unit is already the display unit, or when conversion is needed for internal computation (e.g. adding two values in different units — always convert to canonical before arithmetic).

## Why

Storing in a single, well-known canonical unit eliminates conversion complexity, prevents rounding drift, and makes every part of the system interpretable without context. Converting only at the display/input boundary (the "leaf" of the data flow) keeps business logic and storage unit-agnostic.

Key rules enforced by the pattern:

1. **Storage always canonical** — convert only at display/input edges.
2. **Round (`.toFixed`) only at the leaf render site**, never before storage — re-deriving rounded values on every render drifts the stored value.
3. **Input validation must validate the _converted_ (storage-unit) value** against storage-unit bounds, not the raw entered value — otherwise imperial inputs get wrongly rejected by a metric-only cap.
4. **Compute the converted value _after_ the NaN/empty guard**, not before — so a mutation never fires with `NaN`.
5. **Ratio/sign-only logic** (goal-progress percentage, trend-direction color) is unit-agnostic and needs no conversion.

## Examples

All snippets below are the actual implementation from the measurement-unit feature.

### Shared conversion helpers — `shared/lib/units.ts`

Every conversion factor and helper lives in one file. No magic numbers like `0.453592` appear anywhere else.

```typescript
// shared/lib/units.ts
import { z } from "zod";

export const measurementUnitSchema = z.enum(["metric", "imperial"]);
export type MeasurementUnit = z.infer<typeof measurementUnitSchema>;
export const DEFAULT_MEASUREMENT_UNIT: MeasurementUnit = "metric";

export const KG_PER_LB = 0.45359237;
export const LBS_PER_KG = 2.2046226218;

/** Stored kg → user's display unit. Round only at the leaf, never here. */
export function weightFromKg(kg: number, unit: MeasurementUnit): number {
  return unit === "imperial" ? kg * LBS_PER_KG : kg;
}

/** User-entered value (in their unit) → kg for storage. Full precision. */
export function weightToKg(value: number, unit: MeasurementUnit): number {
  return unit === "imperial" ? value * KG_PER_LB : value;
}

export function weightUnitLabel(unit: MeasurementUnit): "kg" | "lbs" {
  return unit === "imperial" ? "lbs" : "kg";
}
```

### Hook retrieving the user preference — `client/hooks/useMeasurementUnit.ts`

```typescript
// client/hooks/useMeasurementUnit.ts
import { useAuthContext } from "@/context/AuthContext";
import {
  DEFAULT_MEASUREMENT_UNIT,
  type MeasurementUnit,
} from "@shared/lib/units";

export function useMeasurementUnit(): MeasurementUnit {
  const { user } = useAuthContext();
  return user?.measurementUnit ?? DEFAULT_MEASUREMENT_UNIT;
}
```

### Display conversion at the leaf — `client/screens/WeightTrackingScreen.tsx`

The stored value is kg; convert and round only when rendering.

```typescript
// client/screens/WeightTrackingScreen.tsx
import {
  weightFromKg,
  weightUnitLabel,
  type MeasurementUnit,
} from "@shared/lib/units";

function formatWeight(weightKg: string, unit: MeasurementUnit): string {
  return `${weightFromKg(parseFloat(weightKg), unit).toFixed(1)} ${weightUnitLabel(unit)}`;
}
```

### Input validation on the _converted_ value — `client/screens/WeightTrackingScreen.tsx`

Guard for `NaN` first, then convert to kg, then validate against the kg storage cap.

```typescript
// inside handleLogWeight — `unit` from useMeasurementUnit()
const entered = parseFloat(weightInput);
if (isNaN(entered) || entered <= 0) {
  setWeightError(`Please enter a valid weight in ${unitLabel}.`);
  return;
}
// Storage is always kg — convert and validate against the kg cap (999) so
// imperial inputs are not rejected by a metric-only bound.
const weight = weightToKg(entered, unit);
if (weight > 999) {
  setWeightError(`Please enter a valid weight in ${unitLabel}.`);
  return;
}
logWeight.mutate({ weight }); // server receives kg
```

### Server-side display conversion — `server/services/profile-hub.ts`

The service reads the user's preference and converts stored kg for display — it never stores a converted value.

```typescript
// server/services/profile-hub.ts
import { weightFromKg, weightUnitLabel } from "@shared/lib/units";

latestWeight: latestWeight
  ? {
      // Body weight is stored in kg; convert to the user's preferred unit
      // and round to 1 decimal at this leaf.
      value: Number(
        weightFromKg(
          Number(latestWeight.weight),
          user.measurementUnit,
        ).toFixed(1),
      ),
      unit: weightUnitLabel(user.measurementUnit),
      date: new Date(latestWeight.loggedAt).toISOString(),
    }
  : null,
```

### Unit-agnostic ratio — no conversion needed

```typescript
// goal-progress is a ratio of two kg values — unit-agnostic, no conversion
const progress = currentWeightKg / goalWeightKg;
```

## Exceptions

- When internal arithmetic involves mixed units — convert both to canonical _before_ arithmetic, not at the leaf.
- When a component must display metric and imperial simultaneously — perform both conversions at the leaf but still round only at render.
- When the user preference is unknown (before profile load) — default to `metric` via `DEFAULT_MEASUREMENT_UNIT`; do not guess imperial.

## Related Files

- `shared/lib/units.ts` — conversion factors, helpers, and `measurementUnitSchema`
- `client/hooks/useMeasurementUnit.ts` — reads the preference from auth context
- `client/screens/WeightTrackingScreen.tsx` — display + input leaf example
- `client/screens/SettingsScreen.tsx` — the metric/imperial toggle (persists via `/api/auth/profile`)
- `server/services/profile-hub.ts` — server-side display conversion

## See Also

- [Unit normalization at API boundary (weight)](../conventions/unit-normalization-at-api-boundary-weight-2026-05-13.md) — the complementary write-side pattern: normalize an inbound unit to canonical kg before storage
