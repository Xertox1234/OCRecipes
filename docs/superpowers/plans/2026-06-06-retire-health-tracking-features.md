# Retire Health-Tracking Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fully remove 5 health-tracking features (Weight, Fasting, HealthKit sync, GLP-1 companion, Adaptive goals) — code and DB tables — to refocus the app on its camera/food-recognition core.

**Architecture:** Atomic single-branch teardown. Work is grouped by **shared storage-module cohesion** so each commit leaves a green build: Group 1 (GLP-1 + Adaptive Goals, both in `medication.ts`), Group 2 (Weight + HealthKit, both in `health.ts`), Group 3 (Fasting, standalone). Group 1 runs before Group 2 because the adaptive-goals service consumes weight storage. Within each task the order is: strip inbound references → delete now-orphaned feature files → drop schema tables → verify → commit.

**Tech Stack:** Expo/React Native + TypeScript client, Express + Drizzle ORM (Postgres) server, Vitest. Drizzle uses stateless `push` (no migration files). No production DB → zero data-loss risk.

**This is a REMOVAL plan — not test-first.** There are no new failing tests to write. The verification target after every task is: `npm run check:types` passes AND a feature-scoped orphan grep returns zero hits. Existing co-located tests for removed modules are deleted with them.

**Spec:** `docs/superpowers/specs/2026-06-06-retire-health-tracking-features-design.md`

---

## Pre-flight

- [ ] **Step 0a: Branch off main**

```bash
git switch -c chore/retire-health-features
git rev-parse --abbrev-ref HEAD   # expect: chore/retire-health-features
```

- [ ] **Step 0b: Warm the LSP server** (first query is unreliable cold)

Use the LSP tool: `hover` on `withOpacity` in `client/constants/theme.ts`. Then prefer LSP `findReferences` over grep when confirming a symbol's blast radius before editing a shared file (resolves `@/` and `@shared/` aliases).

---

## Task 1: Remove GLP-1 Companion + Adaptive Goals

Both features' storage lives in `server/storage/medication.ts`, which deletes wholesale once both leave. Adaptive goals is removed here (before weight) because its service reads weight storage — deleting the service now means weight removal in Task 2 has no dependent.

**Files — strip references (edit):**

- `server/routes.ts` — remove import + `register…(app)` for `medication` and `adaptive-goals`
- `server/storage/index.ts` — remove `import * as medication from "./medication"` and all 8 facade exports it contributes (`getMedicationLogs`, `createMedicationLog`, `updateMedicationLog`, `deleteMedicationLog`, `createGoalAdjustmentLog`, `applyAdaptiveGoalsAtomically`, `dismissAdaptiveGoalsAtomically`, `getGoalAdjustmentLogs`)
- `client/navigation/ProfileStackNavigator.tsx` — remove `GLP1Companion` import, `Stack.Screen`, and `ProfileStackParamList` entry
- `client/screens/SettingsScreen.tsx` — remove the GLP-1 and Adaptive-Goals items from `SETTINGS_ITEMS`; drop `glp1Companion` and `adaptiveGoals` from the `premiumKey` union; remove their `usePremiumFeature("glp1Companion")` / `usePremiumFeature("adaptiveGoals")` calls
- `shared/types/premium.ts` — remove `glp1Companion` and `adaptiveGoals` from the `PremiumFeatures` interface and from BOTH `TIER_FEATURES.free` and `TIER_FEATURES.premium`
- `server/storage/export.ts` — remove the `medicationLogs` and `goalAdjustmentLogs` imports, type-struct fields, and fetches

**Files — delete (git rm):**

- `client/screens/GLP1CompanionScreen.tsx`
- `client/components/HighProteinSuggestions.tsx`
- `client/hooks/useMedication.ts`
- `server/routes/medication.ts`, `server/routes/adaptive-goals.ts`
- `server/services/glp1-insights.ts`, `server/services/adaptive-goals.ts`
- `server/storage/medication.ts`
- All co-located `__tests__` for the above (e.g. `server/routes/__tests__/medication.test.ts`, `server/services/__tests__/glp1-insights.test.ts`, `server/services/__tests__/adaptive-goals*.test.ts`, `server/storage/__tests__/medication.test.ts`). Confirm the exact set with: `git ls-files '*medication*' '*glp1*' '*adaptive-goal*'`

**Files — drop schema (edit `shared/schema.ts`):**

- Remove table defs `medicationLogs` (+ `medicationLogsRelations`) and `goalAdjustmentLogs` (+ its relations)
- Remove `medicationLogs: many(medicationLogs)` from `usersRelations` (note: `goalAdjustmentLogs` is not in `usersRelations` per the trace — verify and remove if present)

- [ ] **Step 1: Strip all inbound references** (the "edit" files above). After this the GLP-1/adaptive-goals route/service/storage files are orphaned but still compile.

- [ ] **Step 2: Verify build is green with files still present**

Run: `npm run check:types`
Expected: PASS (orphaned files compile; nothing references them)

- [ ] **Step 3: Delete the orphaned feature files + their tests** (the "delete" list above)

```bash
git rm client/screens/GLP1CompanionScreen.tsx client/components/HighProteinSuggestions.tsx client/hooks/useMedication.ts \
  server/routes/medication.ts server/routes/adaptive-goals.ts \
  server/services/glp1-insights.ts server/services/adaptive-goals.ts \
  server/storage/medication.ts
# plus the confirmed __tests__ files
```

- [ ] **Step 4: Drop the schema tables** (edit `shared/schema.ts` per the "drop schema" list)

- [ ] **Step 5: Verify — types green + zero orphans**

Run: `npm run check:types`
Expected: PASS

Run: `grep -rniE "medicationLog|glp1|computeAdaptiveGoals|adaptiveGoals|goalAdjustment|useMedication|HighProteinSuggestions" client server shared`
Expected: ZERO hits (allowed survivor: none for these symbols)

- [ ] **Step 6: Run the test suite**

Run: `npm run test:run`
Expected: PASS (no broken imports; deleted tests gone)

- [ ] **Step 7: Commit** (Kimi gate may false-CRITICAL on the table drop — stateless-push pattern; if it blocks, run the commit in a terminal with `SKIP_KIMI_REVIEW=1` per project convention)

```bash
git add -A
git commit -m "refactor: remove GLP-1 companion and adaptive goals features"
```

---

## Task 2: Remove Weight Tracking + HealthKit Sync

Both live in `server/storage/health.ts` (verified: weight + healthkit only), which deletes wholesale. This task also strips weight awareness from the AI coach and the profile widget.

**Files — strip references (edit):**

- `server/routes.ts` — remove import + register for `weight` and `healthkit`
- `server/storage/index.ts` — remove `import * as health from "./health"` and its 8 facade exports (`getWeightLogs`, `createWeightLog`, `createWeightLogAndUpdateUser`, `deleteWeightLog`, `getLatestWeight`, `getHealthKitSyncSettings`, `upsertHealthKitSyncSetting`, `updateHealthKitLastSync`)
- `client/navigation/RootStackNavigator.tsx` — remove `WeightTracking` import, `Stack.Screen`, and `RootStackParamList` entry
- `client/navigation/ProfileStackNavigator.tsx` — remove `HealthKitSettings` import, screen, ParamList entry
- `client/screens/SettingsScreen.tsx` — remove the HealthKit item from `SETTINGS_ITEMS`; drop `healthKitSync` from the `premiumKey` union; remove `usePremiumFeature("healthKitSync")`
- `client/screens/ProfileScreen.tsx` — remove `onWeightPress`/weight widget wiring and `usePremiumFeature("weightTrend")`
- `client/hooks/useProfileData.ts` — remove `handleWeightPress`
- `client/components/home/action-config.ts` — remove the `log-weight` action + its `navigateAction` case
- `client/components/coach/CoachChat.tsx` — remove the `navigation.navigate("WeightTracking")` case
- `client/screens/HomeScreen.tsx` — remove `WeightLogDrawer` import + render case
- `server/services/nutrition-coach.ts` — remove `weightTrend` field from `CoachContext`, the weight-display block in the prompt builder, and `weightTrend` from `emptyContext`
- `server/services/coach-pro-chat.ts` — remove `import { calculateWeeklyRate } from "./weight-trend"`, the latest-weight fetch, and the `weightTrend` context field. **KEEP** the safety refusal examples (72-hour fast / Ozempic / vitamin D)
- `server/services/profile-hub.ts` — remove `latestWeight` from `ProfileWidgetData` and the `storage.getLatestWeight` fetch
- `shared/types/premium.ts` — remove `weightTrend` and `healthKitSync` from `PremiumFeatures` and both `TIER_FEATURES` tiers
- `server/storage/export.ts` — remove the `weightLogs` import, struct field, and fetch

**Files — delete (git rm):**

- `client/screens/WeightTrackingScreen.tsx`, `client/screens/HealthKitSettingsScreen.tsx`
- `client/components/WeightChart.tsx`, `client/components/home/WeightLogDrawer.tsx`, `client/components/HealthKitSyncIndicator.tsx`
- `client/components/weight-chart-utils.ts`, `client/components/healthkit-sync-utils.ts`
- `client/hooks/useWeightLogs.ts`, `client/hooks/useHealthKit.ts`
- `server/routes/weight.ts`, `server/routes/healthkit.ts`
- `server/services/weight-trend.ts`, `server/services/healthkit-sync.ts`
- `server/storage/health.ts`
- All co-located `__tests__` for the above. Confirm with: `git ls-files '*weight*' '*healthkit*' '*health-kit*'`

**Files — drop schema (edit `shared/schema.ts`):**

- Remove `weightLogs` (+ `weightLogsRelations`) and `healthKitSync` (+ `healthKitSyncRelations`)
- Remove `weightLogs: many(weightLogs)` and `healthKitSync: many(healthKitSync)` from `usersRelations`
- **DO NOT** touch the `users.weight` / `users.goalWeight` columns — kept for the goal calculator

- [ ] **Step 1: Strip all inbound references** (the "edit" files above)

- [ ] **Step 2: Verify build green with files still present**

Run: `npm run check:types`
Expected: PASS

- [ ] **Step 3: Delete orphaned feature files + tests**

```bash
git rm client/screens/WeightTrackingScreen.tsx client/screens/HealthKitSettingsScreen.tsx \
  client/components/WeightChart.tsx client/components/home/WeightLogDrawer.tsx client/components/HealthKitSyncIndicator.tsx \
  client/components/weight-chart-utils.ts client/components/healthkit-sync-utils.ts \
  client/hooks/useWeightLogs.ts client/hooks/useHealthKit.ts \
  server/routes/weight.ts server/routes/healthkit.ts \
  server/services/weight-trend.ts server/services/healthkit-sync.ts \
  server/storage/health.ts
# plus confirmed __tests__ files
```

- [ ] **Step 4: Drop the schema tables** (edit `shared/schema.ts`)

- [ ] **Step 5: Verify — types green + zero orphans**

Run: `npm run check:types`
Expected: PASS

Run: `grep -rniE "weightLog|healthKitSync|weight-trend|weightTrend|calculateWeeklyRate|useWeightLogs|useHealthKit|getLatestWeight|WeightChart|HealthKitSync" client server shared`
Expected: ZERO hits. Allowed survivors to eyeball: `users.weight` / `goalWeight` column refs and the goal-calculator usage — confirm any hit is one of those, not a removed symbol.

- [ ] **Step 6: Run the test suite**

Run: `npm run test:run`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: remove weight tracking and HealthKit sync; strip weight context from coach"
```

---

## Task 3: Remove Fasting

Standalone — `server/storage/fasting.ts` is fasting-only.

**Files — strip references (edit):**

- `server/routes.ts` — remove import + register for `fasting`
- `server/storage/index.ts` — remove `import * as fasting from "./fasting"` and its 6 facade exports (`getFastingSchedule`, `upsertFastingSchedule`, `getActiveFastingLog`, `getFastingLogs`, `createFastingLog`, `endFastingLog`)
- `client/navigation/RootStackNavigator.tsx` — remove `FastingModal` import, screen, ParamList entry
- `client/navigation/HomeStackNavigator.tsx` — remove `Fasting` import, screen, ParamList entry
- `client/screens/ProfileScreen.tsx` — remove `onFastingPress`/fasting widget wiring
- `client/hooks/useProfileData.ts` — remove `handleFastingPress`
- `client/components/home/action-config.ts` — remove the `fasting-timer` action + its `navigateAction` case
- `client/screens/HomeScreen.tsx` — remove `FastingDrawer` import + render case
- `server/services/profile-hub.ts` — remove `fasting` from `ProfileWidgetData` and the `getFastingSchedule` / `getActiveFastingLog` fetches; also fix the stale comment in `server/routes/profile-hub.ts`
- `shared/types/premium.ts` — remove `advancedFasting` from `PremiumFeatures` and both `TIER_FEATURES` tiers
- `server/storage/export.ts` — remove the `fastingSchedules` / `fastingLogs` imports, struct field, and fetch

**Files — delete (git rm):**

- `client/screens/FastingScreen.tsx`
- `client/components/FastingTimer.tsx`, `FastingStreakBadge.tsx`, `FastingSetupModal.tsx`, `WeeklyFastingChart.tsx`, `client/components/home/FastingDrawer.tsx`
- `client/components/fasting-setup-utils.ts`, `client/components/fasting-display-utils.ts`
- `client/lib/fasting-notifications.ts`
- `client/hooks/useFasting.ts`, `client/hooks/useFastingTimer.ts`
- `server/routes/fasting.ts`, `server/services/fasting-stats.ts`, `server/storage/fasting.ts`
- All co-located `__tests__`. Confirm with: `git ls-files '*fasting*'`

**Files — drop schema (edit `shared/schema.ts`):**

- Remove `fastingSchedules` and `fastingLogs` (+ their relations)
- Remove `fastingSchedules: many(...)` and `fastingLogs: many(...)` from `usersRelations`

- [ ] **Step 1: Strip all inbound references**

- [ ] **Step 2: Verify build green with files still present**

Run: `npm run check:types`
Expected: PASS

- [ ] **Step 3: Delete orphaned feature files + tests**

```bash
git rm client/screens/FastingScreen.tsx \
  client/components/FastingTimer.tsx client/components/FastingStreakBadge.tsx client/components/FastingSetupModal.tsx \
  client/components/WeeklyFastingChart.tsx client/components/home/FastingDrawer.tsx \
  client/components/fasting-setup-utils.ts client/components/fasting-display-utils.ts \
  client/lib/fasting-notifications.ts \
  client/hooks/useFasting.ts client/hooks/useFastingTimer.ts \
  server/routes/fasting.ts server/services/fasting-stats.ts server/storage/fasting.ts
# plus confirmed __tests__ files
```

- [ ] **Step 4: Drop the schema tables** (edit `shared/schema.ts`)

- [ ] **Step 5: Verify — types green + zero orphans**

Run: `npm run check:types`
Expected: PASS

Run: `grep -rniE "fasting|FastingModal|advancedFasting" client server shared`
Expected: ZERO hits

- [ ] **Step 6: Run the test suite**

Run: `npm run test:run`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: remove fasting feature"
```

---

## Task 4: Final verification + open PR

- [ ] **Step 1: Full-scope orphan sweep** (the spec's master grep)

Run:

```bash
grep -rniE "weightLog|fastingSchedule|fastingLog|healthKitSync|medicationLog|goalAdjustment|computeAdaptiveGoals|calculateWeeklyRate|weightTrend|advancedFasting|glp1Companion|adaptiveGoals|useFasting|useWeightLogs|useHealthKit|useMedication" client server shared
```

Expected: ZERO hits except allowed survivors — `users.weight`/`goalWeight` columns, onboarding consent screens, and the dormant `exerciseAnalytics` flag (untouched). Eyeball each remaining hit.

- [ ] **Step 2: Full type + lint + test gate**

Run: `npm run check:types && npm run lint && npm run test:run`
Expected: all PASS

- [ ] **Step 3: Confirm schema pushes cleanly to the dev DB**

Run: `npm run db:push`
Expected: Drizzle reports the 6 tables to drop and applies cleanly (dev DB only; no prod). Accept the drops.

- [ ] **Step 4: Manual smoke test**

Boot the app (`npm run server:dev` + `npx expo run:ios`). Confirm Home, Profile, and Settings render with no dangling navigation targets and no console errors referencing removed screens.

- [ ] **Step 5: Push + open PR**

```bash
git push -u origin chore/retire-health-features
```

Open a PR to `main`. It will run the 5-check CI gate. Watch it green, then squash-merge and delete the branch.

---

## Self-Review Notes (author)

- **Spec coverage:** All 5 features mapped to tasks (Group1: GLP-1+adaptive, Group2: weight+healthkit, Group3: fasting). All 16 spine-edit files covered. Boundaries (users columns, onboarding screens, coach safety examples, exerciseAnalytics) called out as DO-NOT-TOUCH.
- **Ordering invariant:** Group 1 (adaptive goals) precedes Group 2 (weight) so weight's last dependent is gone first. Within each task, references are stripped before files are deleted before tables are dropped — keeps every intermediate `check:types` green.
- **No placeholders:** file lists are exact; `git ls-files` globs resolve the test-file set the trace couldn't enumerate authoritatively.
- **Premium flag set:** 5 flags removed across tasks (glp1Companion, adaptiveGoals in T1; weightTrend, healthKitSync in T2; advancedFasting in T3) — matches `premium.ts`.
