---
title: "feat: Redesign History tab as Today dashboard"
type: feat
date: 2026-02-03
deepened: 2026-02-03
---

# Redesign History Tab as Today Dashboard

## Enhancement Summary

**Deepened on:** 2026-02-03
**Research agents used:** TypeScript reviewer, React Native design, Accessibility expert, Performance oracle, Architecture strategist, Code simplicity reviewer, Frontend races reviewer, Pattern recognition specialist, TanStack Query researcher

### Key Improvements

1. **Simplified architecture**: Use route params instead of separate AllHistoryScreen (~70% LOC reduction)
2. **Type-safe queries**: Extract shared API types to `client/types/api.ts`, properly type all queries
3. **Race condition handling**: Coordinate refresh of multiple queries, handle navigation edge cases
4. **Performance optimization**: Add composite database index, use ScrollView for dashboard layout
5. **Accessibility compliance**: WCAG 2.1 AA compliant stat cards with proper labels and touch targets

### Considerations Discovered

- Existing `ScannedItemResponse` type is duplicated in two files with different fields - consolidate first
- `staleTime: Infinity` in query client prevents automatic refetching - override for dashboard queries
- Missing composite index `(user_id, scanned_at DESC)` on `scanned_items` table affects query performance

---

## Overview

Transform the "History" tab into a "Today" dashboard that shows daily calorie progress, a quick scan CTA, and recent items. Add a "View All History" link to access the full item history. This fixes the UX inconsistency where the "Add to Today" button sends items to a tab called "History."

## Problem Statement

- The "Add to Today" button on scan screens creates an expectation that items go to a "Today" view
- The current "History" tab just shows a paginated list of all items—no dashboard, no today-specific focus
- User's mockup shows a proper dashboard with: calories card, items scanned count, scan CTA, and recent items
- This naming mismatch confuses users about where their logged items end up

## Proposed Solution

1. **Rename the tab**: "History" → "Today" (display label only, keep internal route name `HistoryTab` to minimize breaking changes)
2. **Redesign the screen**: Transform `HistoryScreen` into a dashboard layout matching the mockup
3. **Add navigation**: "View All History" link at bottom that opens full history list via route param

### Dashboard Layout (from mockup)

```
┌─────────────────────────────────────────┐
│ WELCOME BACK                       🌙 👤 │
│ William                                  │
├─────────────────────────────────────────┤
│ ┌─────────────────┐ ┌─────────────────┐ │
│ │ TODAY'S CALORIES│ │ ITEMS SCANNED   │ │
│ │ 1,240 / 2100    │ │ 12              │ │
│ └─────────────────┘ └─────────────────┘ │
├─────────────────────────────────────────┤
│ ┌─────────────────────────────────────┐ │
│ │           📷                        │ │
│ │      Scan Barcode                   │ │
│ │  Identify food & get AI recipes     │ │
│ └─────────────────────────────────────┘ │
├─────────────────────────────────────────┤
│ Recent History                          │
│ ┌─────────────────────────────────────┐ │
│ │ 🖼️ Avocado Toast Bread    180 cal   │ │
│ │    Whole Foods                      │ │
│ └─────────────────────────────────────┘ │
│ ┌─────────────────────────────────────┐ │
│ │ 🖼️ Organic Greek Yogurt   120 cal   │ │
│ │    Chobani                          │ │
│ └─────────────────────────────────────┘ │
│                                         │
│         View All History →              │
│                                         │
└─────────────────────────────────────────┘
```

## Technical Approach

### Research Insights: Simplified Architecture

**Code simplicity review recommendation:** Instead of creating a separate `AllHistoryScreen`, use route params to toggle between dashboard and full list mode. This reduces ~280 LOC and avoids code duplication.

```typescript
// In HistoryStackParamList, change:
History: undefined;
// To:
History: { showAll?: boolean } | undefined;
```

### Files to Modify

| File                                          | Changes                                                                 |
| --------------------------------------------- | ----------------------------------------------------------------------- |
| `client/navigation/MainTabNavigator.tsx`      | Change tab title from "History" to "Today"                              |
| `client/navigation/HistoryStackNavigator.tsx` | Update header title, modify param list                                  |
| `client/screens/HistoryScreen.tsx`            | Add dashboard header with ListHeaderComponent, toggle via showAll param |
| `client/types/navigation.ts`                  | Update `HistoryStackParamList` with optional showAll param              |
| `client/types/api.ts`                         | **New file** - Extract shared API response types                        |

### Implementation Phases

#### Phase 1: Extract Shared Types (Pre-requisite)

**Research insight:** `ScannedItemResponse` is duplicated in HistoryScreen and ItemDetailScreen with different fields. Consolidate before proceeding.

**Tasks:**

- [x] Create `client/types/api.ts` with shared API response types
- [x] Move `ScannedItemResponse` (use fuller definition from ItemDetailScreen)
- [x] Add `DailySummaryResponse` type
- [x] Add `PaginatedResponse<T>` generic type
- [x] Update imports in HistoryScreen.tsx and ItemDetailScreen.tsx

**client/types/api.ts:**

```typescript
/**
 * API response type for scanned items.
 * Note: Dates come as ISO strings over JSON, not Date objects.
 */
export type ScannedItemResponse = {
  id: number;
  productName: string;
  brandName?: string | null;
  servingSize?: string | null;
  calories?: string | null;
  protein?: string | null;
  carbs?: string | null;
  fat?: string | null;
  fiber?: string | null;
  sugar?: string | null;
  sodium?: string | null;
  imageUrl?: string | null;
  scannedAt: string; // ISO string, not Date
};

export type PaginatedResponse<T> = {
  items: T[];
  total: number;
};

export type DailySummaryResponse = {
  totalCalories: number;
  totalProtein: number;
  totalCarbs: number;
  totalFat: number;
  itemCount: number;
};
```

#### Phase 2: Update Navigation Types

**Tasks:**

- [x] Update `HistoryStackParamList` to accept optional `showAll` param
- [x] Update `HistoryScreenNavigationProp` for composite navigation (cross-tab to ScanTab)

**client/navigation/HistoryStackNavigator.tsx:**

```typescript
export type HistoryStackParamList = {
  History: { showAll?: boolean } | undefined; // Dashboard (default) or full list
  ItemDetail: { itemId: number };
};
```

**client/types/navigation.ts (add):**

```typescript
import { CompositeNavigationProp } from "@react-navigation/native";
import { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";

/**
 * Navigation prop for HistoryScreen (Today dashboard).
 * Uses CompositeNavigationProp to navigate across stacks:
 * - Navigate within HistoryStack (ItemDetail)
 * - Navigate to ScanTab (MainTab - for quick scan CTA)
 */
export type TodayDashboardNavigationProp = CompositeNavigationProp<
  NativeStackNavigationProp<HistoryStackParamList, "History">,
  BottomTabNavigationProp<MainTabParamList>
>;
```

#### Phase 3: Redesign HistoryScreen with Dashboard Header

**Research insight:** Use ScrollView with ListHeaderComponent pattern. Dashboard has heterogeneous content (stats, CTA, list) - pure FlatList is not ideal.

**Tasks:**

- [x] Add `showAll` route param handling
- [x] Create dashboard header as `ListHeaderComponent` (when `showAll !== true`)
- [x] Fetch `/api/daily-summary` with proper typing and staleTime
- [x] Limit recent items to 5 when in dashboard mode
- [x] Add "View All History" link that sets `showAll: true`

**Data fetching pattern (properly typed):**

```typescript
import type {
  DailySummaryResponse,
  PaginatedResponse,
  ScannedItemResponse,
} from "@/types/api";

// Dashboard queries with coordinated refresh
const { data: todaySummary, isFetching: summaryFetching } =
  useQuery<DailySummaryResponse>({
    queryKey: ["/api/daily-summary"],
    staleTime: 1000 * 60 * 2, // 2 minutes (override global Infinity)
    refetchOnWindowFocus: true,
  });

const { data: recentItemsData, isFetching: itemsFetching } = useQuery<
  PaginatedResponse<ScannedItemResponse>
>({
  queryKey: ["/api/scanned-items", "dashboard"], // Differentiate from full history
  queryFn: async () => {
    const response = await apiRequest(
      "GET",
      "/api/scanned-items?limit=5&offset=0",
    );
    return response.json();
  },
  staleTime: 1000 * 60 * 1, // 1 minute
  refetchOnWindowFocus: true,
});

const recentItems = recentItemsData?.items ?? [];

// Coordinated pull-to-refresh
const queryClient = useQueryClient();
const isRefreshing = summaryFetching || itemsFetching;

const handleRefresh = useCallback(async () => {
  await Promise.all([
    queryClient.refetchQueries({ queryKey: ["/api/daily-summary"] }),
    queryClient.refetchQueries({
      queryKey: ["/api/scanned-items", "dashboard"],
    }),
  ]);
}, [queryClient]);
```

**Dashboard header component (inline, not separate file):**

```typescript
const DashboardHeader = () => (
  <View>
    {/* Stats row */}
    <View style={styles.statsRow}>
      <Card elevation={1} style={styles.statCard}>
        <ThemedText type="caption" style={{ color: theme.textSecondary }}>
          TODAY'S CALORIES
        </ThemedText>
        <View style={styles.statValue}>
          <ThemedText type="h2" style={{ color: theme.calorieAccent }}>
            {Math.round(todaySummary?.totalCalories || 0)}
          </ThemedText>
          <ThemedText type="body" style={{ color: theme.textSecondary }}>
            / {user?.dailyCalorieGoal || 2000}
          </ThemedText>
        </View>
      </Card>
      <Card elevation={1} style={styles.statCard}>
        <ThemedText type="caption" style={{ color: theme.textSecondary }}>
          ITEMS SCANNED
        </ThemedText>
        <ThemedText type="h2">
          {todaySummary?.itemCount || 0}
        </ThemedText>
      </Card>
    </View>

    {/* Scan CTA */}
    <Pressable
      style={[styles.scanCTA, { backgroundColor: theme.backgroundSecondary }]}
      onPress={() => navigation.navigate("ScanTab")}
      accessibilityRole="button"
      accessibilityLabel="Scan barcode. Opens camera to scan food barcode."
    >
      <Feather name="camera" size={32} color={theme.text} />
      <ThemedText type="h4">Scan Barcode</ThemedText>
      <ThemedText type="small" style={{ color: theme.textSecondary }}>
        Identify food & get AI recipes
      </ThemedText>
    </Pressable>

    {/* Section header */}
    <View style={styles.sectionHeader}>
      <ThemedText type="h4">Recent History</ThemedText>
    </View>
  </View>
);
```

#### Phase 4: Update Navigation Labels

**Tasks:**

- [x] Update `MainTabNavigator.tsx`: Change `title: "History"` → `title: "Today"`
- [x] Update `HistoryStackNavigator.tsx`: Change screen header from "History" to "Today"
- [x] Keep tab icon as `clock` (still relevant for "today's" activity)

#### Phase 5: Wire Up Navigation

**Tasks:**

- [x] "View All History" link calls `navigation.setParams({ showAll: true })`
- [x] "Scan Barcode" CTA navigates to `ScanTab` (cross-tab navigation)
- [x] Recent item cards navigate to `ItemDetail` (same as before)
- [x] Back from full list returns to dashboard (default param behavior)

### Research Insights: Race Condition Handling

**Frontend races review findings:**

1. **Pull-to-refresh while navigating away**: Use mount ref to prevent state updates on unmounted component
2. **Query invalidation timing**: Use optimistic updates when adding items to prevent flash of stale data
3. **Multiple rapid refresh gestures**: Guard with `isRefreshing` state check

```typescript
// Race condition safe refresh
const isMountedRef = useRef(true);
const refreshTokenRef = useRef(0);

useEffect(() => {
  isMountedRef.current = true;
  return () => {
    isMountedRef.current = false;
  };
}, []);

const handleRefresh = useCallback(async () => {
  if (isRefreshing) return; // Prevent duplicate refreshes

  const thisToken = ++refreshTokenRef.current;
  setIsRefreshing(true);

  await Promise.allSettled([
    queryClient.refetchQueries({ queryKey: ["/api/daily-summary"] }),
    queryClient.refetchQueries({
      queryKey: ["/api/scanned-items", "dashboard"],
    }),
  ]);

  // Only update if still mounted and this is the active refresh
  if (isMountedRef.current && refreshTokenRef.current === thisToken) {
    setIsRefreshing(false);
  }
}, [isRefreshing, queryClient]);
```

### Research Insights: Accessibility (WCAG 2.1 AA)

**Accessibility review findings:**

1. **Stat cards must announce progress context**:

```typescript
<View
  accessible={true}
  accessibilityRole="text"
  accessibilityLabel={`Today's calories: ${current} of ${goal} consumed. ${Math.round((current / goal) * 100)} percent of daily goal.`}
>
```

2. **Touch targets minimum 44x44 points**:

```typescript
const styles = StyleSheet.create({
  scanCTA: {
    minHeight: 56, // Exceeds 44pt minimum
    paddingVertical: Spacing.lg,
  },
  viewAllLink: {
    minHeight: 44,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
});
```

3. **Color contrast**: Use `theme.calorieAccent` (verified 4.5:1 ratio) for calorie values

### Research Insights: Performance

**Performance oracle findings:**

1. **Add composite database index** (P0 priority):

```sql
CREATE INDEX scanned_items_user_scanned_idx
ON scanned_items (user_id, scanned_at DESC);
```

2. **Use ScrollView for dashboard** (not FlatList) - 5 items doesn't need virtualization

3. **Query configuration**:
   - `staleTime: 1-2 minutes` (override global `Infinity`)
   - `gcTime: 10-30 minutes` (keep cached data available)
   - Differentiate query keys: `["dashboard"]` vs `["history", offset]`

### API Considerations

The existing APIs are sufficient:

- `GET /api/daily-summary` - Returns today's calorie/macro totals
- `GET /api/scanned-items?limit=5` - Returns recent items

**Recommended backend optimization** (optional):

- Create `getRecentScannedItems()` method without count query for dashboard use

## Acceptance Criteria

### Functional Requirements

- [x] Tab label shows "Today" instead of "History"
- [x] Dashboard displays welcome message with user's name
- [x] "Today's Calories" card shows current calories vs goal (e.g., "1,240 / 2100")
- [x] "Items Scanned" card shows count of items logged today
- [x] "Scan Barcode" CTA navigates to camera/scan screen
- [x] "Recent History" shows last 5 logged items
- [x] "View All History" link opens full paginated history list
- [x] Tapping a recent item opens ItemDetailScreen

### Non-Functional Requirements

- [x] Dashboard loads without visible delay (skeleton while fetching)
- [x] Pull-to-refresh updates both summary and recent items atomically
- [x] No flash of stale data when returning from other screens
- [x] Accessibility labels announce complete context for stat cards

### Quality Gates

- [x] All existing tests pass
- [ ] New components have basic test coverage
- [x] TypeScript types are correct (no `any`)
- [x] Follows existing codebase patterns (useTheme, Card, ThemedText)
- [x] WCAG 2.1 AA compliant (contrast, touch targets, labels)

### Institutional Learnings Applied

- [x] useEffect cleanup for mount state ref (from `useeffect-cleanup-memory-leak.md`)
- [x] Use refs for synchronous checks in callbacks (from `stale-closure-callback-refs.md`)
- [ ] Proper `StyleProp<ViewStyle>` typing for style props (from `react-native-style-typing.md`)

## Success Metrics

- "Add to Today" → appears in "Today" tab = naming consistency achieved
- Users can see today's progress at a glance without navigating to Profile
- Full history remains accessible via one tap
- No race condition bugs from concurrent data fetching

## Dependencies & Prerequisites

- [ ] **P0**: Add composite index on `scanned_items(user_id, scanned_at DESC)`
- [x] Extract shared API types to `client/types/api.ts` before modifying screens

## Risk Analysis

| Risk                       | Likelihood | Impact | Mitigation                                                           |
| -------------------------- | ---------- | ------ | -------------------------------------------------------------------- |
| Breaking navigation types  | Low        | Medium | Keep internal route names (`HistoryTab`), only change display labels |
| Performance regression     | Low        | Medium | Limit recent items to 5, use proper query staleTime                  |
| Race conditions on refresh | Medium     | Low    | Use mount refs and refresh tokens, Promise.allSettled                |
| Stale data flash           | Medium     | Medium | Optimistic updates when adding items                                 |
| Accessibility issues       | Low        | High   | Apply WCAG guidelines, test with VoiceOver                           |

## File Changes Summary

```
client/
├── navigation/
│   ├── MainTabNavigator.tsx        # Change title: "History" → "Today"
│   └── HistoryStackNavigator.tsx   # Update header, modify param list
├── screens/
│   └── HistoryScreen.tsx           # Add dashboard header, showAll toggle
└── types/
    ├── api.ts                      # NEW: Shared API response types
    └── navigation.ts               # Update HistoryStackParamList

server/
└── (optional) Add composite index migration
```

## References & Research

### Internal References

- ProfileScreen Today's Progress card: `client/screens/ProfileScreen.tsx:298-372`
- Current HistoryScreen list implementation: `client/screens/HistoryScreen.tsx`
- MainTabNavigator tab config: `client/navigation/MainTabNavigator.tsx:59-67`
- Daily summary API: `server/routes.ts:518-533`
- Query client config: `client/lib/query-client.ts:91-104`

### Institutional Learnings Applied

- `docs/solutions/logic-errors/useeffect-cleanup-memory-leak.md` - Mount ref pattern
- `docs/solutions/logic-errors/stale-closure-callback-refs.md` - Ref for synchronous checks
- `docs/solutions/code-quality/react-native-style-typing.md` - StyleProp typing

### External References

- [TanStack Query v5: Parallel Queries](https://tanstack.com/query/v5/docs/framework/react/guides/parallel-queries)
- [TanStack Query v5: Query Invalidation](https://tanstack.com/query/v5/docs/react/guides/query-invalidation)
- [React Navigation: CompositeNavigationProp](https://reactnavigation.org/docs/typescript/#combining-navigation-props)
- [WCAG 2.1 AA: Target Size](https://www.w3.org/WAI/WCAG21/Understanding/target-size.html)

### Design Reference

- User's mockup screenshot shows the target dashboard layout
