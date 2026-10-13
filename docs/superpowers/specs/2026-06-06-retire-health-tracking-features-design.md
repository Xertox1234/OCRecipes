# Spec: Retire 5 health-tracking features, refocus on camera/food

**Date:** 2026-06-06
**Status:** Approved (design), pending implementation plan
**Author:** brainstorming session

## Problem & Intent

OCRecipes' identity is **camera-first food recognition** (scan barcodes / labels /
menus / receipts → nutrition lookup). Several general health/fitness-tracking
features have accreted that dilute that focus and add maintenance surface without
serving the core. This spec retires them.

No production deployment exists and there is no production database, so full table
drops carry **zero data-loss risk**. Drizzle uses stateless `push`, so removing a
table definition simply stops it being created.

## Scope — features removed (FULL removal: code AND tables)

1. **Weight tracking**
2. **Fasting**
3. **HealthKit sync**
4. **GLP-1 companion**
5. **Adaptive goals** — included because it is _100% weight-driven_
   (`computeAdaptiveGoals` requires ≥4 weight logs, `adaptive-goals.ts:173`).
   With weight logging removed it could never fire, so it joins the cluster rather
   than surviving as a permanent no-op. Confirmed during brainstorming.

### Why adaptive goals is in scope (decision record)

The first feature sweep mislabeled the four trackers as "clean standalone cuts."
A dependency trace proved otherwise: adaptive goals (initially in the "keep" pile)
reads `storage.getWeightLogs()` and computes TDEE from weight change. Keeping it
while removing its only data source ships a premium feature that can never run.
The user chose to drop it. This also makes `storage/medication.ts` delete _whole_
(no split), since its adaptive-goals methods go too.

## Inventory

### A. Files that DELETE wholesale

**Client screens**

- `client/screens/WeightTrackingScreen.tsx`
- `client/screens/FastingScreen.tsx`
- `client/screens/HealthKitSettingsScreen.tsx`
- `client/screens/GLP1CompanionScreen.tsx`

**Server routes**

- `server/routes/weight.ts`
- `server/routes/fasting.ts`
- `server/routes/healthkit.ts`
- `server/routes/medication.ts`
- `server/routes/adaptive-goals.ts`

**Server services**

- `server/services/weight-trend.ts`
- `server/services/fasting-stats.ts`
- `server/services/healthkit-sync.ts`
- `server/services/glp1-insights.ts`
- `server/services/adaptive-goals.ts`

**Server storage** (each verified to contain only in-scope code)

- `server/storage/health.ts` (weight + HealthKit, nothing else)
- `server/storage/fasting.ts`
- `server/storage/medication.ts` (GLP-1 + adaptive-goals methods — both in scope)

**Client hooks**

- `client/hooks/useWeightLogs.ts`
- `client/hooks/useFasting.ts`
- `client/hooks/useFastingTimer.ts`
- `client/hooks/useHealthKit.ts`
- `client/hooks/useMedication.ts`

**Client components**

- `client/components/home/WeightLogDrawer.tsx`
- `client/components/home/FastingDrawer.tsx`
- `client/components/WeightChart.tsx`
- `client/components/WeeklyFastingChart.tsx`
- `client/components/FastingTimer.tsx`
- `client/components/FastingStreakBadge.tsx`
- `client/components/FastingSetupModal.tsx`
- `client/components/HealthKitSyncIndicator.tsx`
- `client/components/HighProteinSuggestions.tsx`

**Utilities**

- `client/lib/fasting-notifications.ts`
- `client/components/weight-chart-utils.ts`
- `client/components/healthkit-sync-utils.ts`
- `client/components/fasting-setup-utils.ts`
- `client/components/fasting-display-utils.ts`

**Tests** — every co-located `__tests__` file for the above (route/service/storage/
component/lib tests for weight, fasting, healthkit, medication, glp1).
_Verify the full list at implementation time via the verification grep below; the
sweep is a strong guide, not authoritative on test filenames._

### B. Files that get SURGICALLY EDITED (the shared "spine")

> Line numbers below come from the dependency trace and are **approximate — verify
> each before editing**. `check:types` is the backstop that proves no reference was
> missed.

**Navigation**

- `client/navigation/RootStackNavigator.tsx` — remove `WeightTracking` +
  `FastingModal` `Stack.Screen`s, their imports, and their `RootStackParamList` entries.
- `client/navigation/HomeStackNavigator.tsx` — remove `Fasting` screen + ParamList entry + import.
- `client/navigation/ProfileStackNavigator.tsx` — remove `HealthKitSettings` +
  `GLP1Companion` screens + ParamList entries + imports.

**Server wiring**

- `server/routes.ts` — remove the import + `register*(app)` call for weight,
  healthkit, fasting, medication, adaptive-goals.
- `server/storage/index.ts` — remove imports of `./health`, `./fasting`,
  `./medication` and all facade method exports they contribute (weight, healthkit,
  fasting, medication, AND the adaptive-goals methods `createGoalAdjustmentLog`,
  `applyAdaptiveGoalsAtomically`, `dismissAdaptiveGoalsAtomically`,
  `getGoalAdjustmentLogs`).

**Coach context (strip weight awareness)**

- `server/services/nutrition-coach.ts` — remove the `weightTrend` field from
  `CoachContext`, the weight-display block in the prompt builder, and the
  `weightTrend` entry in `emptyContext`.
- `server/services/coach-pro-chat.ts` — remove `import { calculateWeeklyRate } from
"./weight-trend"`, the latest-weight fetch, and the `weightTrend` context field.
  **Keep** the safety refusal examples (72-hour fast, Ozempic, vitamin D) — they are
  guardrails, not feature wiring.

**Profile widget**

- `server/services/profile-hub.ts` — remove `fasting` and `latestWeight` from
  `ProfileWidgetData` and the corresponding `storage.getFastingSchedule` /
  `getActiveFastingLog` / `getLatestWeight` fetches.
- `server/routes/profile-hub.ts` — update the stale "fasting status, weight trend" comment.

**Client UI**

- `client/screens/SettingsScreen.tsx` — remove the HealthKit, GLP-1, and Adaptive-Goals
  items from `SETTINGS_ITEMS`; narrow the `premiumKey` union (drop `healthKitSync`,
  `glp1Companion`, `adaptiveGoals`); remove their `usePremiumFeature` calls.
- `client/screens/ProfileScreen.tsx` — remove the weight/fasting press handlers,
  the `weightTrend` `usePremiumFeature` call, and the widgets that render them.
- `client/hooks/useProfileData.ts` — remove `handleFastingPress` / `handleWeightPress`.
- `client/screens/HomeScreen.tsx` — remove `FastingDrawer` / `WeightLogDrawer` imports + render cases.
- `client/components/home/action-config.ts` — remove the `fasting-timer` and
  `log-weight` actions + their `navigateAction` cases.
- `client/components/coach/CoachChat.tsx` — remove the `navigation.navigate("WeightTracking")` case.

**Shared**

- `shared/types/premium.ts` — remove 5 keys from `PremiumFeatures`, both `TIER_FEATURES`
  tiers: `weightTrend`, `healthKitSync`, `advancedFasting`, `glp1Companion`, `adaptiveGoals`.
- `shared/schema.ts` — drop tables `weightLogs`, `healthKitSync`, `fastingSchedules`,
  `fastingLogs`, `medicationLogs`, `goalAdjustmentLogs` (+ their `*Relations`); remove
  the matching lines from `usersRelations` (keep `chatConversations`).
- `server/storage/export.ts` — remove the weight / fasting / medication / goalAdjustment
  sections from the user-data export struct, imports, and fetches.

### C. Explicit boundaries — DO NOT TOUCH

- **`users` table columns** `weight`, `height`, `age`, `gender`, `goalWeight` — profile
  fields the Mifflin-St-Jeor goal calculator still uses. (Note: `health.ts` writes
  `users.weight` on weight-log create/delete; deleting `health.ts` removes those
  _writes_, but the column and its onboarding/profile writers stay.)
- **Onboarding `HealthDataConsentScreen` + `HealthConditionsScreen`** — general
  dietary-profile screens, not HealthKit-specific. Keep, including their
  `OnboardingStackParamList` entries and flow position.
- **Coach safety examples** in `coach-pro-chat.ts` — keep.
- **`exerciseAnalytics` premium flag** (`premium.ts`) — dormant, no screen behind it,
  out of scope. Leave untouched.
- **Deep linking** (`client/navigation/linking.ts`) — no references to these screens; no edit.

## Execution approach (chosen: A — atomic)

Single feature branch → single PR. Every removed feature collides on the same spine
files (`premium.ts`, `schema.ts`, `storage/index.ts`, `routes.ts`, coach context),
and adaptive-goals removal depends on weight removal, so per-feature PRs would mean
constant self-rebasing. Atomic teardown is cleaner; no-prod-DB removes data risk.

### Recommended ordering (build stays green-ish, final tsc is the gate)

1. **Strip inbound wiring** in the spine files (navigation, `routes.ts`,
   `storage/index.ts`, coach context, profile-hub, SettingsScreen, ProfileScreen,
   HomeScreen, action-config, CoachChat, export.ts) so nothing imports the
   to-be-deleted modules.
2. **Delete feature files** (screens, routes, services, storage, hooks, components, utils).
3. **Remove premium flags** (`premium.ts`).
4. **Drop schema tables + relations** (`schema.ts`).
5. **Delete co-located tests** for everything removed.
6. **Verify** (below). Run `db:push` against the dev DB last to confirm the schema
   still pushes cleanly without the dropped tables.

## Verification gate

- `npm run check:types` — authoritative catch for any missed reference.
- `npm run test:run` — confirms no broken imports remain after test deletion.
- `npm run lint`.
- Orphan grep — zero hits expected:
  `grep -rniE "weightLog|fastingSchedule|fastingLog|healthKitSync|medicationLog|goalAdjustment|computeAdaptiveGoals|calculateWeeklyRate|weightTrend|advancedFasting|glp1Companion|adaptiveGoals|useFasting|useWeightLogs|useHealthKit|useMedication" client server shared`
  (review each hit; allowed survivors: `users.weight`/`goalWeight` columns, onboarding consent screens, `exerciseAnalytics`).
- Manual smoke test — app boots; Home, Profile, Settings render with no dangling nav targets.

## Risks & mitigations

- **Missed inbound reference breaks the TS build** → `check:types` catches it; the orphan grep is the second net.
- **Premium-flag removal ripples** → `PremiumFeatureKey` is `keyof PremiumFeatures`, so any stale string reference to a removed flag becomes a type error (good — surfaces at compile time).
- **Coach prompt regression** → removing the weight block changes coach output; acceptable and intended. Keep safety examples intact.
- **Kimi review false-CRITICAL on schema table drops** → expected pattern for stateless-push schema changes; triage per project memory, not a blocker.
