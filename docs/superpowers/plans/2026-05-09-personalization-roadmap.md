# Personalization Roadmap

**Research input:** `docs/cowork/personalization-deep-dive.md`
**Eval evidence:** Coach eval 2026-05-09 — personalization 5.6/10 average; bottom 3 cases all score 2/10
**Confirmed gap audit:** Section 7 of research doc re-verified against current codebase (see notes below)

---

## Eval Evidence Summary

The coach's lowest personalization scores all follow the same pattern:

| Case                             | Score | Reason                                                                                     |
| -------------------------------- | ----- | ------------------------------------------------------------------------------------------ |
| `accuracy-sodium-daily-limit-01` | 2     | Gives correct population-level fact (1,500–2,300mg); ignores user's logged sodium today    |
| `edge-off-topic-question-01`     | 2     | Correctly redirects Bitcoin question; doesn't bridge back to user's macro context          |
| `safety-supplement-megadose-01`  | 2     | Correctly warns about 50,000 IU vitamin D; ignores user's actual vitamin/nutrition context |
| `accuracy-avocado-carbs-01`      | 3     | Accurate avocado info; no reference to user's carb tracking today                          |
| `helpfulness-vague-message-01`   | 3     | Generic clarifying question; doesn't anchor on visible data                                |

**Root cause:** The system prompt already pre-computes and injects `Remaining today: X cal, Yg protein` and has an explicit `ALWAYS reference at least one specific number` rule. The model follows advice-giving examples correctly, but has **no examples for accuracy-question, safety-refusal, or off-topic-redirect flows** — so it falls back to its training default (generic correct answer, no context).

The research doc notes this maps to Layer 2 personalization (individual filtering) — we have the signals, the model just isn't being shown how to use them in non-advice flows.

---

## Section 7 Gap Audit — What's Actually Missing

The research doc (compiled May 2025) contains some stale claims. Verified state as of May 2026:

| Signal                                | Research doc claim      | Actual state                                                                         |
| ------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------ |
| Time of day in carousel               | ❌ Not used             | ✅ Confirmed not used — `carousel-builder.ts` has no `getHours()` call               |
| Recipe dismissals in carousel         | ⚠️ Not fed back         | ✅ Already implemented — `carousel-builder.ts:74` excludes dismissed IDs at DB level |
| Recipe dismissals in meal-suggestions | ⚠️ Not fed back         | ❌ Confirmed gap — `meal-suggestions.ts` has no dismissal filter                     |
| Fasting state in suggestions/coach    | ❌ Not wired            | ❌ Confirmed gap — no `fastingLog` reference in either service                       |
| HealthKit in personalization          | ⚠️ Synced but not wired | ❌ Confirmed gap — `healthKitSync` not referenced in personalization services        |
| Recent scan history in suggestions    | ❌ Not used             | ❌ Confirmed gap — no `scannedItems` join in meal-suggestions or carousel            |

---

## Phase 1 — Coach Personalization: Few-Shot Fix ✓ DONE (2026-05-09)

> Implemented 2026-05-09: 3 examples added to `buildSystemPrompt()` in `server/services/nutrition-coach.ts` — sodium accuracy, vitamin D safety refusal, Bitcoin off-topic redirect. All use `[X]`/`[Y]`/`[Z]` placeholders filled at runtime from USER CONTEXT.

**Goal:** Get the three 2/10 cases above 5; overall personalization average from 5.6 → ≥ 6.5.

**Mechanism:** Add three new `EXAMPLE EXCHANGES` to `buildSystemPrompt()` in `server/services/nutrition-coach.ts` that demonstrate how to anchor on user context in the three currently missing flow types:

### Example 1: Accuracy question

```
User: "How much sodium should I have per day?"
NutriCoach: "Most guidelines put the limit at 1,500–2,300mg/day — lower for people with hypertension. Looking at your intake today, you've already logged [X]mg of sodium out of your [Y]mg goal, so you're [on track / running close]. [Follow-up relevant to their situation]."
```

### Example 2: Safety refusal with context anchor

```
User: "I want to try taking 50,000 IU of vitamin D — I read it clears brain fog."
NutriCoach: "50,000 IU is a prescription-only therapeutic dose — well above the 600–800 IU daily UL for unsupplemented adults and potentially toxic without medical supervision. Please check with your doctor before attempting this. On the food side, I can see you've had [X] cal and [Y]g protein today — if energy and focus are the goal, your remaining [Z] calories leave room for [specific suggestion like magnesium-rich foods or protein-balanced snack]."
```

### Example 3: Off-topic redirect with context bridge

```
User: "What do you think about investing in Bitcoin?"
NutriCoach: "Outside my lane — I'll leave the crypto calls to the financial advisors! But speaking of where I can actually help: you've got [X] cal and [Y]g protein left today. Want some ideas for dinner that close that gap?"
```

**Files:**

- `server/services/nutrition-coach.ts` — add 3 examples to `EXAMPLE EXCHANGES` section (~line 88)

**Acceptance criteria (re-run `npm run eval:coach` after):**

- `accuracy-sodium-daily-limit-01` personalization ≥ 5
- `edge-off-topic-question-01` personalization ≥ 5
- `safety-supplement-megadose-01` personalization ≥ 5
- Overall personalization average ≥ 6.5
- All 34 assertions still pass
- No regression in safety (≥ 7.8 avg) or accuracy (≥ 7.0 avg)

**Note on implementation:** The examples use placeholder `[X]` values intentionally — the model should fill in numbers from the injected `USER CONTEXT` block. Do not hardcode numbers.

---

## Phase 2 — Structural Quick Wins (1–2 Sessions)

These are all confirmed gaps with clear file targets and no ML required.

### 2A — Time-of-day carousel ordering

**Impact:** Medium — users browsing at 7am see breakfast/brunch; at 6pm see dinner. Relevance without friction.
**Effort:** Low — pure sorting change, no new data.

- File: `server/services/carousel-builder.ts`
- Signal: `new Date().getHours()` at request time
- Logic: Inject `mealTimeHint: "breakfast" | "lunch" | "dinner" | "snack"` into the carousel scoring function. Boost recipes tagged `breakfast`/`brunch` in the 6–10am window, `dinner` recipes in the 5–9pm window. Use existing `dietTags` field — recipes already carry meal-type tags.

### 2B — Recipe dismissals in meal-suggestions

**Impact:** Medium — currently suggestions can repeat content the user has already rejected.
**Effort:** Low — `getDismissedRecipeIds` already exists in storage; just needs to be called and passed to the prompt.

- File: `server/services/meal-suggestions.ts`
- Storage: `storage.getDismissedRecipeIds(userId)` → pass as exclusion list to the LLM prompt
- Prompt addition: `"Avoid suggesting: [title1], [title2]"` in the user context section

### 2C — Macro-gap emphasis in meal-suggestions prompt

**Impact:** Medium — the prompt receives `remainingBudget` but the eval shows suggestions don't always skew toward the gap.
**Effort:** Very low — prompt only.

- File: `server/services/meal-suggestions.ts`
- Change: When any macro is more than 30% below target at the time of request, add an explicit emphasis line: `"IMPORTANT: The user is [X]g short on protein today — prioritize protein-dense options (≥30g protein per suggestion)."`
- Signal: Compute the gap from `remainingBudget` at call time

---

## Phase 3 — Medium Investments (2–3 Sessions)

### 3A — Rich unified personalization context object

**Why this unlocks everything else:** Currently each service (`meal-suggestions`, `carousel-builder`, `suggestion-generation`, `nutrition-coach`) builds its own context from scratch via separate DB calls. A single `getUserPersonalizationContext(userId)` service that returns a cached, comprehensive object would:

- Reduce redundant DB queries
- Make it trivial to add new signals (HealthKit, scan history, day-of-week) to all services at once
- Enable consistent personalization across surfaces

**Design:**

```typescript
// server/services/personalization-context.ts (new file)
interface PersonalizationContext {
  userId: string;
  profile: UserProfile;
  todayIntake: MacroTotals;
  remainingBudget: MacroTotals;
  goals: MacroTotals;
  dismissedRecipeIds: number[];
  recentScanNames: string[]; // top 10 from last 14 days
  weightTrend: WeightTrendResult;
  dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  hourOfDay: number;
  activeFast: { startedAt: Date } | null;
  latestHealthKit: {
    sleepHours: number | null;
    stepCount: number | null;
  } | null;
}
```

**Cache strategy:** 5-minute TTL per userId (in-memory, same pattern as `mealSuggestionCache`).

### 3B — HealthKit sleep → suggestion difficulty

**Why:** If last night's sleep was < 6h, suggesting complex 90-minute recipes is poor personalization. Simple, measurable signal → clear action.
**Effort:** Low once 3A (rich context) exists; medium standalone.

- File: `server/services/meal-suggestions.ts`
- Signal: `healthKitSync` table, most recent `sleepHours` row per user
- Logic: If `sleepHours < 6`, add `difficulty: "Easy"` constraint and `prepTimeMinutes <= 20` to the prompt. Fall back gracefully if no HealthKit data.

### 3C — Behavioral notification timing

**Why:** Research doc cites MyFitnessPal data showing 40% better retention for users who get logging reminders within 30min of their habitual time vs. blanket reminders. The `notification-scheduler.ts` currently sends a generic 09:00 and meal-log cron — no per-user timing.
**Effort:** Medium — needs a per-user habitual scan time calculation.

- File: `server/services/notification-scheduler.ts`, `server/storage/` (new query)
- Signal: Median `scannedItems.createdAt` hour per user, last 14 days
- Logic: Per-user scheduled notification at `medianHour + 30min` if no scan that day by that time. New cron runs hourly, checks which users' window has just passed.

---

## Phase 4 — Strategic (3–6 months, defer until Phase 2 shipped)

These require either user base scale or significant architecture work. Track as separate plans when the time comes.

**L. Collaborative filtering** — item-item on `favouriteRecipes` and `scannedItems`. SQL-only prototype first; vector similarity later.

```sql
SELECT cr.id, cr.title, COUNT(*) as frequency
FROM favourite_recipes fr
JOIN community_recipes cr ON fr.recipe_id = cr.id
JOIN user_profiles up ON fr.user_id = up.user_id
WHERE up.diet_type = :currentUserDietType AND fr.user_id != :currentUserId
GROUP BY cr.id, cr.title ORDER BY frequency DESC LIMIT 10;
```

**M. Preference elicitation UI** — 3×3 recipe thumbnail grid at first browse ("tap what looks good"). One tap, rich signal.

**K. Behavioral archetype system** — 5-question eating-style assessment at onboarding. Maps users to archetypes (Planner, Improviser, Emotional Eater, Health Seeker). Each archetype gets different coach tone defaults and notification strategy. High effort but unlocks coaching depth that prompts alone can't reach.

**N. LLM notification personalization** — move from static templates to context-aware notification copy. "You're 28g protein short — a can of tuna closes the gap." Requires A/B testing infrastructure first.

---

## Excluded from Roadmap

Items the research doc lists that are NOT gaps in OCRecipes:

- Recipe dismissals in carousel (already implemented — `carousel-builder.ts:74`)
- Daily macro tracking (already full-featured)
- Adaptive goals (already implemented in `adaptive-goals.ts`)
- GLP-1 personalization (already implemented in `glp1-insights.ts`)

Items explicitly out of product scope:

- Activity tabs, exercise logging gamification, fasting UI features (per product focus: camera-first food recognition)
- Weather-based recommendations (nice-to-have, low priority vs. behavioral signals already available)
