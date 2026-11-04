---
title: ISO 8601 duration parsing — null for missing/invalid
track: knowledge
category: conventions
module: server
tags: [api, parsing, duration, iso-8601, recipe-import]
applies_to: [server/services/**/*.ts]
created: '2026-05-13'
last_updated: '2026-10-30'
---

# ISO 8601 duration parsing — null for missing/invalid

## Rule

Parse ISO 8601 duration strings (from schema.org recipes, calendar events, etc.) into numeric minutes for storage and display. Return `null` for missing or unparseable values instead of throwing.

## When to use

Importing data from schema.org structured data, iCal/ICS feeds, or any external source using ISO 8601 durations (e.g., `PT1H30M`, `PT15M`).

## Exceptions

Internal data that already stores durations as numbers.

## Examples

```typescript
// server/services/recipe-import.ts

export function parseIsoDuration(duration: string | undefined): number | null {
  if (!duration) return null;
  const match = duration.trim().match(ISO_DURATION_RE);
  if (!match) return null;
  const [, d, h, m, sec] = match;
  if (!d && !h && !m && !sec) return null; // bare "P" / "PT"
  const n = (v: string | undefined) => (v ? parseFloat(v.replace(",", ".")) : 0);
  return Math.round(n(d) * 1440 + n(h) * 60 + n(m) + n(sec) / 60);
}
// ISO_DURATION_RE = /^P(?:(\d+(?:[.,]\d+)?)D)?(?:T(?=\d)(?:(\d+(?:[.,]\d+)?)H)?(?:(\d+(?:[.,]\d+)?)M)?(?:(\d+(?:[.,]\d+)?)S)?)?$/i

// Usage
parseIsoDuration("PT1H30M"); // → 90
parseIsoDuration("PT15M"); // → 15
parseIsoDuration("PT2H"); // → 120
parseIsoDuration(undefined); // → null
parseIsoDuration("invalid"); // → null
parseIsoDuration("P0DT30M"); // → 30   (day part, common in real markup)
parseIsoDuration("PT1.5H"); // → 90   (decimal, "." or ",")
```

## Key details

- Case-insensitive (`/i` flag) to handle mixed-case from external sources
- A `P…D` day part and decimal components (`.` or `,`) are valid ISO 8601 and appear in real recipe markup. A `PT`-only regex returned `null` for `P0DT30M`, and the time was silently lost (2026-10-30 audit R37).
- Seconds are rounded into minutes. A bare `P`/`PT` (no components) returns `null`.
- When both `prepTime` and `cookTime` are missing, fill `cookTimeMinutes` from `totalTime`. Many sites publish only `totalTime`.
- Returns `null` (not 0 or throws) for graceful handling in optional fields

## Related Files

- `server/services/recipe-import.ts` — `parseIsoDuration`
