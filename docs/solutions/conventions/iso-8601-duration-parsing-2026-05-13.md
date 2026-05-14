---
title: "ISO 8601 duration parsing — null for missing/invalid"
track: knowledge
category: conventions
tags: [api, parsing, duration, iso-8601, recipe-import]
module: server
applies_to: ["server/services/**/*.ts"]
created: 2026-05-13
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
  const match = duration.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (!match) return null;
  const hours = parseInt(match[1] || "0", 10);
  const minutes = parseInt(match[2] || "0", 10);
  return hours * 60 + minutes;
}

// Usage
parseIsoDuration("PT1H30M"); // → 90
parseIsoDuration("PT15M"); // → 15
parseIsoDuration("PT2H"); // → 120
parseIsoDuration(undefined); // → null
parseIsoDuration("invalid"); // → null
```

## Key details

- Case-insensitive (`/i` flag) to handle mixed-case from external sources
- Seconds component is parsed but not added to the result (recipes don't need second-level precision)
- Returns `null` (not 0 or throws) for graceful handling in optional fields

## Related Files

- `server/services/recipe-import.ts` — `parseIsoDuration`
