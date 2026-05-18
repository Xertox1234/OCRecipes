---
title: "Unit conversion at display boundary — canonical metric storage with leaf conversion"
track: knowledge
category: design-patterns
tags:
  - unit-conversion
  - display-boundary
  - measurement-unit
  - canonical-units
  - input-validation
  - rounding
module: shared
applies_to:
  - "shared/lib/units.ts"
  - "client/**/*.tsx"
  - "server/**/*.ts"
created: 2026-05-18
---

# Unit conversion at display boundary — canonical metric storage with leaf conversion

## When this applies

Any feature that stores physical quantities (weight in kg, height in cm, distance in km) and must display or accept input in a user-preferred unit system (imperial or metric). The pattern applies:

- When a per-user measurement preference exists (e.g. `unitSystem: "imperial" | "metric"`).
- When the canonical storage unit is metric (kg, cm, km) but the UI should show imperial equivalents (lb, ft/in, mi).
- When input validation must accept values in the user’s unit system but enforce bounds in canonical units.
- When derived values (percentage, ratio, direction) do not need conversion.

Do **not** apply when the stored unit is already the display unit (e.g. a country-specific app that only ever shows metric) or when conversion is needed for internal computation (e.g. adding two values in different units – always convert to canonical before arithmetic).

## Why

Storing in a single, well-known canonical unit eliminates conversion complexity, prevents rounding drift, and makes every part of the system interpretable without context. Converting only at the display/input boundary (the “leaf” of the data flow) keeps business logic and storage unit-agnostic.

Key rules enforced by the pattern:

1. **Storage always canonical** — convert only at display/input edges.
2. **Round (`.toFixed`) only at the leaf render site**, never before storage — re‑deriving rounded values on every render drifts the stored value.
3. **Input validation must validate the _converted_ (storage‑unit) value** against storage‑unit bounds, not the raw entered value — otherwise imperial inputs get wrongly rejected by a metric‑only cap.
4. **Compute the converted value _after_ the NaN/empty guard**, not before — so a mutation never fires with `NaN`.
5. **Ratio/sign‑only logic** (goal‑progress percentage, trend‑direction color) is unit‑agnostic and needs no conversion.

## Examples

### Shared conversion factors – `shared/lib/units.ts`

All conversion factors live in a single file. No magic numbers like 0.453592 appear anywhere else.

```typescript
// shared/lib/units.ts
export const KG_TO_LB = 2.20462;
export const LB_TO_KG = 1 / KG_TO_LB;

export const CM_TO_IN = 0.393701;
export const IN_TO_CM = 1 / CM_TO_IN;
```

### Hook retrieving user preference – `client/hooks/useMeasurementUnit.ts`

```typescript
// client/hooks/useMeasurementUnit.ts
import { useUser } from "./useUser";

export type UnitSystem = "metric" | "imperial";

export function useMeasurementUnit(): UnitSystem {
  const user = useUser();
  return user?.preferences?.unitSystem ?? "metric";
}
```

### Display conversion at the leaf – `client/screens/WeightTrackingScreen.tsx`

Rounds only when rendering, never before storing.

```typescript
// client/screens/WeightTrackingScreen.tsx
import { useMeasurementUnit } from "../hooks/useMeasurementUnit";
import { KG_TO_LB } from "../../shared/lib/units";

function WeightDisplay({ weightKg }: { weightKg: number }) {
  const unit = useMeasurementUnit();
  const displayWeight =
    unit === "imperial" ? weightKg * KG_TO_LB : weightKg;
  return <Text>{displayWeight.toFixed(1)}</Text>;
}
```

### Input validation on _converted_ value – `client/screens/WeightTrackingScreen.tsx`

Always convert the entered value to canonical before checking min/max.

```typescript
// Within a weight input handler
const handleWeightInput = (raw: string) => {
  const parsed = parseFloat(raw);
  if (isNaN(parsed) || raw.trim() === "") return; // guard before conversion

  const unit = useMeasurementUnit();
  const kg = unit === "imperial" ? parsed * LB_TO_KG : parsed;

  // Validate against storage bounds (in kg)
  if (kg < 20 || kg > 300) {
    setError("Weight must be between 20 and 300 kg");
    return;
  }
  // Store canonical value (rounded later only at render)
  saveWeight(kg);
};
```

### Unit-agnostic ratio – no conversion needed

```typescript
// client/screens/WeightTrackingScreen.tsx
const goalProgress = currentKg / goalKg; // ratio is unit‑agnostic
```

### Server‑side validation – `server/routes/weight.ts`

The API also validates in canonical units after receiving an already‑canonical value (the client always sends metric).

```typescript
// server/routes/weight.ts
router.post("/weight", async (req, res) => {
  const { weightKg } = req.body;
  if (typeof weightKg !== "number" || weightKg < 20 || weightKg > 300) {
    return res.status(400).json({ error: "Invalid weight" });
  }
  // store in DB (canonical)
  await saveWeight(userId, weightKg);
});
```

### User profile service – `server/services/profile-hub.ts`

The profile service stores the user’s unit preference but never converts values itself; it only returns the preference to the client.

```typescript
// server/services/profile-hub.ts
export async function getUserPreferences(userId: string) {
  const user = await db.users.findUnique(userId);
  return {
    unitSystem: user.preferences?.unitSystem ?? "metric",
  };
}
```

## Exceptions

- When internal arithmetic involves mixed units (e.g., adding kg + lb) — convert both to canonical _before_ arithmetic, not at the leaf.
- When a component needs to display both metric and imperial simultaneously (e.g., a dual‑scale widget) — perform both conversions at the leaf but still round only at render.
- When the user preference is unknown (e.g., before profile load) — default to metric, do not guess imperial.

## Related Files

- `shared/lib/units.ts` — single source of conversion constants
- `client/hooks/useMeasurementUnit.ts` — hook to read user’s unit preference
- `client/screens/WeightTrackingScreen.tsx` — example display & input leaf
- `server/services/profile-hub.ts` — user preference service
- `server/routes/weight.ts` — weight write endpoint

## See Also

- [Accessibility‑aware haptics pattern](accessibility-aware-haptics-pattern-2026-05-13.md)
- [Reduced motion animation pattern](reduced-motion-animation-pattern-2026-05-13.md)
