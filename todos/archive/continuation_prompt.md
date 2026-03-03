# Photo Calorie Tracker - Continuation Prompt

Use this prompt to continue implementing the photo-based calorie tracker feature.

---

## Context

I'm implementing a photo-based calorie tracker feature for the NutriScan app. The feature allows users to:

- Snap a photo of any meal and get AI-estimated calories/macros using GPT-4o Vision
- Cross-reference with CalorieNinjas API for verified nutrition data
- Set daily calorie and macro goals (AI-calculated from physical profile)
- This is a premium upsell feature

## Branch

Currently on branch: `feat/photo-calorie-tracker`

## What's Done

### Phase 1: Schema & Types ✅

- `shared/schema.ts` - Added user physical profile fields (weight, height, age, gender, macro goals), scannedItems fields (sourceType, photoUrl, aiConfidence), and nutrition_cache table
- `shared/types/premium.ts` - Added `photoAnalysis` and `macroGoals` features to PremiumFeatures

### Phase 2: Backend Services ✅

- `server/services/goal-calculator.ts` - TDEE/macro calculation with Mifflin-St Jeor formula
- `server/services/photo-analysis.ts` - GPT-4o Vision integration with Zod validation
- `server/services/nutrition-lookup.ts` - CalorieNinjas + USDA fallback with caching and parallel lookup
- `server/routes.ts` - Added endpoints: POST `/api/photos/analyze`, POST `/api/photos/analyze/:sessionId/followup`, POST `/api/photos/confirm`, GET `/api/goals`, POST `/api/goals/calculate`, PUT `/api/goals`

### Phase 3: Client Utilities ✅

- `client/lib/image-compression.ts` - Expo image manipulator with adaptive quality reduction
- `client/lib/photo-upload.ts` - Multipart upload with compression, types for API responses

### Environment ✅

- CalorieNinjas API key added to `.env` as `CALORIENINJAS_API_KEY`

## What Remains

### Phase 4: Frontend Screens (COMPLETE)

1. **Task #9: Create PhotoAnalysisScreen** (`client/screens/PhotoAnalysisScreen.tsx`) ✅
   - Shows AI analysis results with food items and nutrition
   - Follow-up question modal when AI confidence < 70%
   - Inline editing of food items before confirming
   - Memory cleanup on unmount (see `docs/solutions/logic-errors/useeffect-cleanup-memory-leak.md`)

2. **Task #10: Update ScanScreen with shutter button** (`client/screens/ScanScreen.tsx`) ✅
   - Add camera shutter button alongside barcode scanning
   - Navigate to PhotoAnalysisScreen with captured image URI
   - Premium gate check (shared limit with barcode scans)

3. **Task #11: Create GoalSetupScreen** (`client/screens/GoalSetupScreen.tsx`) ✅
   - Collect physical profile: age, weight, height, gender, activity level, goal
   - Call `/api/goals/calculate` endpoint
   - Display calculated goals with manual adjustment option

4. **Task #12: Add goal section to ProfileScreen** (`client/screens/ProfileScreen.tsx`) ✅
   - Show current goals (calories + macros)
   - Link to GoalSetupScreen for setup/editing
   - Daily progress indicators

### Phase 5: Navigation (COMPLETE)

5. **Task #13: Update navigation types** (`client/types/navigation.ts`) ✅
   - Add PhotoAnalysisScreen and GoalSetupScreen to navigation types
   - Update stack navigator

### Phase 6: Testing (COMPLETE)

6. **Task #14: Write unit tests** ✅
   - Goal calculator tests (TDEE formula, macro splits)
   - Zod schema validation tests
   - Photo upload utility tests

## Key Files to Reference

- **Plan document**: `docs/plans/2026-02-01-feat-photo-calorie-tracker-plan.md`
- **Brainstorm**: `docs/brainstorms/2026-02-01-photo-calorie-tracker-brainstorm.md`
- **Patterns**: `docs/PATTERNS.md`
- **Learnings**:
  - `docs/solutions/runtime-errors/unsafe-type-cast-zod-validation.md` (use Zod for API responses)
  - `docs/solutions/logic-errors/useeffect-cleanup-memory-leak.md` (cleanup timers/requests on unmount)

## Database Migration Needed

Run `npm run db:push` to apply schema changes. It will ask to confirm creating the `nutrition_cache` table - select that option.

## Commands

```bash
npm run server:dev    # Express backend on port 3000
npm run expo:dev      # Expo frontend
npm run check:types   # TypeScript check
npm run test:run      # Run tests
```

## Resume Prompt

Copy and paste this to continue:

---

Continue implementing the photo-based calorie tracker feature. I'm on branch `feat/photo-calorie-tracker`.

**Completed:** Schema changes, premium types, all backend services (goal-calculator, photo-analysis, nutrition-lookup), API endpoints, client utilities (image-compression, photo-upload).

**Next up:** Frontend screens - start with Task #9 (PhotoAnalysisScreen), then Task #10 (update ScanScreen), Task #11 (GoalSetupScreen), Task #12 (ProfileScreen goals section), Task #13 (navigation types), and Task #14 (unit tests).

Reference the plan at `docs/plans/2026-02-01-feat-photo-calorie-tracker-plan.md` for implementation details and code examples.

Use `/workflows:work docs/plans/2026-02-01-feat-photo-calorie-tracker-plan.md` to continue with the workflow.

---
