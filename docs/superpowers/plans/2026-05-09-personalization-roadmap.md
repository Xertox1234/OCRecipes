# Personalization Follow-Up Plan

**Research input:** `docs/cowork/personalization-deep-dive.md`
**Current audit:** 2026-05-10 code review against the deep-dive recommendations
**Goal:** Move OCRecipes from profile-aware personalization to context-aware personalization, while fixing the one incorrect macro-gap implementation before building more on top of it.

---

## Current State

Recent work made real progress on the Tier 1 personalization layer:

| Area                               | Current state | Notes                                                                                                                                   |
| ---------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Coach intent routing               | Shipped       | `coach-intent-classifier.ts` routes safety, general fact, vague request, and personalized advice into intent-specific prompt bundles.   |
| Coach cache isolation              | Shipped       | `hashCoachCacheKey()` includes prompt template version, user, Pro/free, day bucket, context hash, and intent.                           |
| Meal suggestion dismissal feedback | Shipped       | Recent dismissed recipe titles are injected into the meal-suggestion prompt and dismissal IDs are included in the suggestion cache key. |
| Carousel dismissal feedback        | Shipped       | `getRecentCommunityRecipes()` filters dismissed community recipes at the DB layer.                                                      |
| Time-of-day carousel ordering      | Shipped       | `inferMealTimeHint()` boosts breakfast/lunch/dinner/snack recipes by current hour.                                                      |
| Static meal-log reminders          | Shipped       | Scheduler creates fixed noon `meal-log` pending reminders for users with no logs today.                                                 |
| Pantry meal planning               | Shipped       | Multi-day pantry meal plan generation exists, but it is separate from barcode/scan suggestions.                                         |

The remaining work should not start with another broad prompt iteration. The next step is to correct the macro signal, then create a shared personalization context so later upgrades reuse the same data instead of each service rebuilding its own partial view.

---

## Phase 0 - Fix Macro-Gap Semantics And Cache Staleness

**Priority:** Immediate
**Effort:** Low
**Risk:** Medium, because the existing tests currently encode the bug

### Problem

`buildMacroGapEmphasis()` currently treats `target - remainingBudget` as the amount the user is short. That is backwards if `remainingBudget` means amount left to consume. Example: target 150g protein, remaining 30g protein should mean "30g left", not "120g short".

The meal suggestion cache key also includes profile, meal plan titles, and dismissals, but not actual confirmed intake from `getDailySummary()`. Since the prompt uses confirmed intake to calculate `remainingBudget`, a user can log food and still receive a cached suggestion generated from an earlier macro state for up to 6 hours.

### Files

- `server/lib/macro-gap-context.ts`
- `server/services/meal-suggestions.ts`
- `server/routes/meal-suggestions.ts`
- `server/services/__tests__/meal-suggestions.test.ts`
- `server/lib/__tests__/macro-gap-context.test.ts` if split tests are preferred

### Implementation

1. Rename local concepts from `gapAmount` to `remainingAmount` or similar so the code reflects the domain language.
2. Trigger emphasis when `remainingBudget[macro]` is a meaningful remaining need. Use consistent thresholds such as:

- protein emphasis when remaining protein >= 30g or remaining protein ratio >= 0.20
- carb/fat/calorie emphasis when they are the largest meaningful remaining need and exceed their configured minimum amount

3. Prompt text should say: `The user still has 30g protein remaining today`, not `The user is 120g short`.
4. Add an intake-sensitive cache component. Options:
   - include a rounded `remainingBudget` hash in `buildSuggestionCacheKey()`, or
   - include a `dailySummaryHash` built from calories/protein/carbs/fat consumed.
5. Update existing tests that currently assert the inverted math.

### Acceptance Gates

- A target of 150g protein with 30g remaining produces an emphasis around `30g protein remaining`.
- A target of 150g protein with 120g remaining does not claim the user is only 30g short.
- Cache keys differ when confirmed intake changes enough to alter `remainingBudget`.
- Dismissal cache isolation still holds.

### Verification

```bash
npm run test:run -- meal-suggestions macro-gap
```

Run only this focused suite locally. Let CI handle full lint/types/tests.

---

## Phase 1 - Shared Personalization Context Service

**Priority:** Next structural investment
**Effort:** Medium
**Risk:** Medium, because this becomes a shared dependency across surfaces

### Goal

Create one service that gathers the reusable personalization signals once and exposes a stable object to coach, meal suggestions, carousel, scan suggestions, and notifications.

### New Service

`server/services/personalization-context.ts`

```ts
export interface PersonalizationContext {
  userId: string;
  now: Date;
  dayOfWeek: number;
  hourOfDay: number;
  profile: UserProfile | null;
  goals: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  };
  todayIntake: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  };
  remainingBudget: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  };
  dismissedRecipeIds: number[];
  dismissedRecipeTitles: string[];
  recentScanNames: string[];
  pantrySummary: {
    totalItems: number;
    expiringSoonNames: string[];
    usefulIngredientNames: string[];
  };
  fasting: {
    activeFastStartedAt: Date | null;
  };
  health: {
    latestWeightKg: number | null;
    weeklyWeightRateKg: number | null;
    lastNightSleepHours: number | null;
    recentSteps: number | null;
  };
}
```

### Implementation Notes

1. Start with data already available today: profile, user goals, daily summary, meal plan items, dismissals, fasting state, latest weight, pantry summary.
2. Keep HealthKit sleep nullable until storage supports it.
3. The service must preserve the route-level auth boundary. It should either accept only the authenticated user ID, or explicitly reject requests where `authenticatedUserId !== targetUserId` before reading profile, weight, fasting, HealthKit, or other personal data.
4. Use parallel storage reads and bounded queries.
5. Treat caching as deployment-sensitive. Prefer request-scoped reuse first; if a TTL cache is added, use Redis/shared cache for multi-instance deployments or document a single-instance constraint. Any cache key must include user ID plus the date/hour buckets needed to avoid stale macro budget and fasting-state responses.
6. Do not move every consumer in the first PR. Start with meal suggestions, then add the carousel and coach context in follow-up PRs.

### Files

- `server/services/personalization-context.ts` new
- `server/services/__tests__/personalization-context.test.ts` new
- `server/routes/meal-suggestions.ts`
- `server/services/meal-suggestions.ts`
- later: `server/services/carousel-builder.ts`, `server/services/coach-pro-chat.ts`, `server/services/coach-context-builder.ts`

### Acceptance Gates

- Meal suggestions no longer calculate daily targets and remaining budget inline in the route.
- Dismissal title lookup is centralized.
- Context builder handles missing profile/user rows gracefully.
- Context builder cannot be called for another user's ID without an explicit authorization failure.
- Tests cover no profile, no logs, active fast, dismissed recipes, and pantry summary bounds.

---

## Phase 2 - Apply Context To User-Facing Surfaces

### 2A - Meal Suggestions Consume Rich Context

**Goal:** Make AI meal suggestions respond to the user's actual day, not just profile + meal type.

Add to prompt:

- remaining macro emphasis from Phase 0
- day of week and time of day
- active fast guardrail when present
- recent scan names when available
- pantry ingredients that are useful or expiring soon

Acceptance:

- If an active fast exists, suggestions should avoid normal recipe pushes and either decline or suggest appropriate post-fast planning depending on product decision.
- If pantry items are available, at least one suggestion should reason about using pantry inventory when compatible with allergies/diet.
- Prompt context remains bounded and sanitized.

### 2B - Carousel Uses More Than Recency And Meal Type

**Goal:** Keep time-of-day sorting, then add lightweight contextual ranking.

Ranking inputs:

- dismissed recipe exclusion
- meal-time hint
- diet type/allergy/cuisine match
- quick recipes after poor sleep once HealthKit sleep exists
- pantry overlap if recipe ingredients are available in candidate data

Acceptance:

- Existing time-of-day tests still pass.
- New tests prove dismissed recipes stay excluded and meal-time matches remain stable after additional scoring.

### 2C - Scan Suggestions Become Pantry-Aware

**Goal:** When a user scans an item, suggestions should combine that item with what they already have.

Current gap: `suggestion-generation.ts` only uses scanned item + dietary profile. It should receive a compact pantry summary from `PersonalizationContext`.

Prompt example:

```text
The user scanned ground beef. They already have tomatoes, onion, and pasta expiring soon. Prefer suggestions that combine the scanned item with pantry ingredients when practical.
```

Acceptance:

- `generateSuggestions()` accepts optional pantry context.
- Route passes pantry context when authenticated.
- Tests prove pantry names are included in the prompt and sanitized.

---

## Phase 3 - Behavioral Notification Timing

**Priority:** High after context service
**Effort:** Medium
**Risk:** Medium, because notification timing can annoy users if wrong

### Goal

Replace the fixed noon meal-log nudge with a user-specific reminder based on observed logging/scanning behavior.

### Implementation

1. Add storage query: median or modal scan/log hour over the last 14 days.
2. Add the supporting indexes before enabling the scheduler, e.g. user/time indexes on scan and log timestamps used by the query.
3. Add scheduler job that runs hourly and processes users in cursor-based pages, not one unbounded all-user aggregation.
4. For each user whose habitual window has passed by 30 minutes, create a `meal-log` pending reminder only if no logs exist today.
5. Keep the existing mute controls.
6. Add frequency cap: no more than one meal-log reminder per day.
7. Store enough context to explain the nudge in-app, e.g. `{ habitualHour, calories, proteinRemaining }`.

### Files

- `server/services/notification-scheduler.ts`
- `server/storage/scanned-items.ts` or the relevant storage module
- `shared/schemas/reminders.ts`
- `shared/types/reminders.ts`
- `server/services/__tests__/notification-scheduler.test.ts`

### Acceptance Gates

- Users with no history fall back to a conservative default or receive no behavioral reminder.
- Users with logs today do not receive a meal-log reminder.
- Muted users are skipped.
- Hourly scheduler work is paged/bounded and backed by timestamp indexes.
- Existing daily check-in and commitment reminders are unaffected.

---

## Phase 4 - HealthKit Sleep And Activity Signals

**Priority:** Medium
**Effort:** Medium, because the data model must grow first

### Goal

Use last night's sleep and recent activity to adjust suggestion difficulty and coach tone.

### Data Work

1. Extend HealthKit sync input beyond weights and placeholder steps.
2. Store sleep samples and step summaries in a queryable table or typed health metric table.
3. Add `getLatestSleepSummary(userId)` and `getRecentStepSummary(userId)` storage methods.
4. Feed nullable values into `PersonalizationContext.health`.

### Product Rules

- Sleep under 6h: prefer easy meals, prep time <= 20 minutes, gentler coach tone.
- High activity day: allow higher calorie/protein suggestions when compatible with goals.
- Missing data: do nothing. Never imply a user slept poorly unless the data is present and recent.

### Acceptance Gates

- HealthKit sync remains backward compatible with existing weight sync.
- Meal suggestions and coach prompts only mention sleep/activity when data exists.
- Tests cover missing sleep, stale sleep, and low sleep.

---

## Phase 5 - Weekly Food Story

**Priority:** Medium after Phase 1 and 3
**Effort:** Medium

### Goal

Generate a weekly narrative summary that gives users one useful insight from their own behavior without creating shame or pressure.

### Inputs

- daily logs by day
- macro target adherence
- meal timing patterns
- top scanned foods
- pantry waste/expiring items if available
- weight trend if present
- coach notebook commitments if Coach Pro

### Output

- one positive pattern
- one opportunity for next week
- one concrete suggestion
- optional deep link to Coach or Meal Plan

### Guardrails

- No guilt language.
- No scary projections.
- No calorie restriction pressure.
- Respect notification mutes and frequency caps.

---

## Deferred Strategic Work

These are valuable, but not before the context foundation exists:

- Collaborative filtering on recipe favorites and scan history
- Item-item recommendations from scan co-occurrence
- **Preference elicitation UI with recipe thumbnail picks** — ✅ spec approved 2026-05-10, implementation plan in progress. See `docs/superpowers/specs/2026-05-10-taste-picks-design.md`.
- Behavioral archetype onboarding/progressive profiling
- LLM-generated notification copy with A/B testing
- Event-driven adaptive goals beyond the current scheduled analysis

---

## Recommended Execution Order

1. Phase 0: macro-gap semantics + cache staleness fix
2. Phase 1: shared personalization context, initially consumed by meal suggestions
3. Phase 2C: pantry-aware scan suggestions, because it creates a visible "wow" moment
4. Phase 3: behavioral notification timing
5. Phase 4: HealthKit sleep/activity after data model support
6. Phase 5: weekly Food Story

This order fixes correctness first, then builds the reusable foundation, then ships the most visible personalization wins.
