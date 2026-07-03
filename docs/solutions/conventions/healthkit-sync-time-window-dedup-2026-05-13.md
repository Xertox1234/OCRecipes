---
title: 'Deduplicate health-API imports by time window, not exact timestamp'
track: knowledge
category: conventions
module: server
tags: [healthkit, google-fit, deduplication, timestamps, integration]
applies_to: [server/services/healthkit-sync.ts, server/services/*-sync.ts]
created: '2026-02-24'
---

# Deduplicate health-API imports by time window, not exact timestamp

## Rule

When importing data from external health/fitness APIs (HealthKit, Google Fit), check for an existing record within a **30 s - 2 min** time window around the incoming sample's timestamp. Do not use exact timestamp equality.

```typescript
const existing = await storage.getWeightLogs(userId, {
  from: new Date(sample.date),
  to: new Date(new Date(sample.date).getTime() + 60_000), // 1 min window
  limit: 1,
});
if (existing.length === 0) {
  await storage.createWeightLog({
    userId,
    weight: sample.weight.toString(),
    source: "healthkit",
  });
}
```

## Why

HealthKit records timestamps with millisecond precision (`2026-02-24T10:15:23.456Z`). PostgreSQL `timestamp` columns may round or truncate sub-second precision depending on the column definition. A re-sync minutes later would see a "different" timestamp and create a duplicate row.

## Examples

The window must be:

- **Large enough** to absorb precision differences between source and destination (millisecond vs second).
- **Small enough** that two genuinely separate measurements (e.g., two weight readings 5 minutes apart) are not collapsed.

1 minute is a good default for weight; 30 seconds is appropriate for higher-frequency samples (heart rate); 2 minutes works for slow-changing values.

## Exceptions

- For sample types that carry a stable external ID (`sample.uuid`), prefer ID-based dedup over time-window dedup.
- When the external API supports "anchored queries" (HealthKit) or change tokens (Google Fit), use those to fetch only new samples — dedup becomes a safety net rather than the primary defence.

## Related Files

- `server/services/healthkit-sync.ts`

## See Also

- [Apple HealthKit query anchors](https://developer.apple.com/documentation/healthkit/hkanchoredobjectquery)
