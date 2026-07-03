---
title: Progressive disclosure via usage counting (verbose → compact)
track: knowledge
category: design-patterns
module: client
tags: [react-native, ux, async-storage, progressive-disclosure]
applies_to: [client/components/**/*.tsx, client/lib/**/*.ts]
created: '2026-05-13'
---

# Progressive disclosure via usage counting (verbose → compact)

## When this applies

Transition UI elements from verbose (icon + label) to compact (icon-only) after the user has interacted with them enough times to learn what they mean. Track per-element usage counts in AsyncStorage with an in-memory cache, and apply a threshold to conditionally hide labels.

## Examples

```typescript
// 1. Storage layer (home-actions-storage.ts) — same cache pattern as other storage
const USAGE_COUNTS_KEY = "@ocrecipes_action_usage_counts";
let usageCountsCache: Record<string, number> | null = null;

export function getActionUsageCounts(): Record<string, number> {
  return usageCountsCache ?? {};
}

export async function incrementActionUsage(actionId: string): Promise<void> {
  const counts = getActionUsageCounts();
  const updated = { ...counts, [actionId]: (counts[actionId] ?? 0) + 1 };
  usageCountsCache = updated;
  await AsyncStorage.setItem(USAGE_COUNTS_KEY, JSON.stringify(updated));
}

// 2. Component layer — threshold-based rendering
const ICON_ONLY_THRESHOLD = 5;

function ActionChip({ action, usageCounts }: Props) {
  const iconOnly = (usageCounts[action.id] ?? 0) >= ICON_ONLY_THRESHOLD;

  return (
    <Pressable accessibilityLabel={action.label}>
      <Feather name={action.icon} size={iconOnly ? 16 : 14} />
      {!iconOnly && <ThemedText>{action.label}</ThemedText>}
    </Pressable>
  );
}
```

## Why

**Key requirements:**

- Always keep `accessibilityLabel` on icon-only elements for screen readers
- Bump icon size slightly when removing label to maintain visual weight
- Use a low threshold (5-10) so the transition happens naturally during normal use

## Exceptions

When to use:

- Repeated-action toolbars or shortcut rows where space is limited
- Any UI where familiarity reduces the need for text labels

When NOT to use:

- Primary navigation (tabs should always show labels)
- Destructive or infrequent actions where clarity matters more than space
- Actions where icons are ambiguous without labels

## Related Files

- `client/components/home/RecentActionsRow.tsx` — `ICON_ONLY_THRESHOLD`, conditional label rendering
- `client/lib/home-actions-storage.ts` — `usageCountsCache`, `incrementActionUsage()`
- `client/hooks/useHomeActions.ts` — exposes `usageCounts` to components

## See Also

- [Config-driven screen rendering](config-driven-screen-rendering-2026-05-13.md)
