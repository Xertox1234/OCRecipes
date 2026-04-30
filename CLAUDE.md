# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OCRecipes is a mobile nutrition tracking app built with Expo/React Native (frontend) and Express.js (backend). Users scan food barcodes/labels with their camera, track nutritional intake, plan meals with recipes, and receive AI-powered nutrition advice via chat.

## Development Commands

```bash
# Start development - iOS Simulator (recommended for testing camera features)
npm run server:dev    # Express backend on port 3000
npx expo run:ios      # Build and run in iOS simulator with native modules

# Start development - Expo Go (simpler, but no camera support)
npm run server:dev    # Express backend on port 3000
npm run expo:dev      # Expo frontend with tunneling (camera won't work in Expo Go)

# Database
npm run db:push       # Push Drizzle schema to PostgreSQL

# Seed data (dev/test only — refuses NODE_ENV=production without --allow-prod-seed)
npm run seed:recipes              # ~1.5 min (3 recipes in parallel, 25 targets)
npm run seed:recipes -- --allow-prod-seed   # required if NODE_ENV=production
SEED_CONCURRENCY=5 npm run seed:recipes     # raise concurrency if your OpenAI quota allows
SEED_DEMO_PASSWORD=... npm run seed:recipes # reproducible demo login (default: random 24 hex chars, printed once)
npm run cleanup:seeds             # remove seed + test recipes (orphan/demo-authored only)

# Code quality
npm run lint          # ESLint check
npm run lint:fix      # ESLint auto-fix
npm run check:types   # TypeScript type check
npm run format        # Prettier formatting

# Testing
npm run test          # Run tests in watch mode
npm run test:run      # Run tests once
npm run test:coverage # Run tests with coverage report

# Production build
npm run server:build  # Bundle server with esbuild → server_dist/
npm run expo:static:build  # Build static Expo bundle
```

## Architecture

### Monorepo Structure

- `client/` - React Native/Expo frontend
- `server/` - Express.js backend
  - `server/routes/` - 40+ modular route files (registered via `server/routes.ts`)
  - `server/storage/` - 20+ domain-split storage modules (composed via `server/storage/index.ts`)
  - `server/services/` - 30+ service files (nutrition, AI, recipes, health, etc.)
- `shared/` - Code shared between client/server (database schema, models, constants, types)

### Path Aliases

- `@/` → `./client`
- `@shared/` → `./shared`

### Frontend Stack

- **Expo SDK 54** with React Native 0.81, React 19
- **Navigation**: React Navigation v7 (native-stack + bottom-tabs)
- **State**: TanStack Query v5 for server state, React Context for auth/onboarding
- **Styling**: StyleSheet with custom theme system (`client/constants/theme.ts`)
- **Animations**: Reanimated 4

### Backend Stack

- **Express.js 5** with TypeScript
- **Drizzle ORM** with PostgreSQL
- **JWT auth** with bcrypt (Bearer tokens via Authorization header)

### Navigation Flow

1. **Login** → 2. **Onboarding** (6 screens) → 3. **Main App** (4 tabs + Scan FAB)

Main tabs: **Home**, **Plan**, **Coach**, **Profile** — Scan is a floating action button (FAB) that opens a fullScreenModal, not a tab.

Navigator files: `HomeStackNavigator`, `MealPlanStackNavigator`, `ChatStackNavigator`, `ProfileStackNavigator`

Root-level modal screens: Scan, NutritionDetail, PhotoIntent, PhotoAnalysis, GoalSetup, EditDietaryProfile, FeaturedRecipeDetail, QuickLog, MenuScanResult, DailyNutritionDetail, LabelAnalysis, FrontLabelConfirm, BatchScan, BatchSummary, ReceiptCapture, ReceiptReview, ReceiptMealPlan, CookSessionCapture, CookSessionReview, SubstitutionResult, WeightTracking, CoachChat, RecipeChat, CookbookListModal, GroceryListsModal, PantryModal, RecipeBrowserModal, FastingModal

**Deep linking** is configured in `client/navigation/linking.ts` (wired via `linking` prop on `NavigationContainer` in `App.tsx`). Supported prefixes: `ocrecipes://`, `https://ocrecipes.app`. Supported paths: `ocrecipes://recipe/:recipeId`, `ocrecipes://nutrition/:barcode`, `ocrecipes://chat/:conversationId`, `ocrecipes://recipe-chat/:conversationId`, `ocrecipes://scan`. See `docs/patterns/react-native.md` → "Deep Linking Configuration" for the full pattern.

### Database Schema (`shared/schema.ts`)

40+ tables organized by domain:

- **Core**: `users`, `userProfiles`, `scannedItems`, `dailyLogs`, `savedItems`, `favouriteScannedItems`
- **Nutrition cache**: `nutritionCache`, `micronutrientCache`, `suggestionCache`, `instructionCache`, `mealSuggestionCache`, `coachResponseCache`, `carouselSuggestionCache`
- **Recipes & meal planning**: `communityRecipes`, `recipeGenerationLog`, `mealPlanRecipes`, `recipeIngredients`, `mealPlanItems`
- **Recipe engagement**: `recipeDismissals`, `favouriteRecipes`
- **Cookbooks**: `cookbooks`, `cookbookRecipes`
- **Grocery & pantry**: `groceryLists`, `groceryListItems`, `pantryItems`
- **Exercise & activity**: `exerciseLibrary`, `exerciseLogs`
- **Health tracking**: `weightLogs`, `healthKitSync`, `fastingSchedules`, `fastingLogs`, `medicationLogs`, `goalAdjustmentLogs`
- **Chat**: `chatConversations`, `chatMessages`
- **Menu & receipt scanning**: `menuScans`, `receiptScans`
- **Verification & API**: `barcodeVerifications`, `verificationHistory`, `reformulationFlags`, `barcodeNutrition`, `apiKeys`, `apiKeyUsage`
- **Subscriptions**: `transactions`

### Services (`server/services/`)

**Nutrition & food:**

- `nutrition-lookup.ts` - Multi-source nutrition pipeline (CNF → USDA → API Ninjas)
- `micronutrient-lookup.ts` - Micronutrient data lookup
- `food-nlp.ts` - Natural language food parsing
- `cultural-food-map.ts` - Cultural food name mapping

**AI & vision:**

- `photo-analysis.ts` - OpenAI Vision food photo analysis (4 intents: log/calories/recipe/identify, confidence scoring, follow-up refinement when confidence < 0.7)
- `front-label-analysis.ts` - Front-of-package label scanning
- `receipt-analysis.ts` - Receipt photo analysis
- `menu-analysis.ts` - Restaurant menu photo scanning & analysis
- `voice-transcription.ts` - Voice-to-text for food logging
- `nutrition-coach.ts` - AI nutrition coaching (chat)
- `recipe-chat.ts` - Recipe-specific AI chat
- `meal-suggestions.ts` - AI meal suggestions

**Goals & health:**

- `goal-calculator.ts` - Calculates nutritional goals from user profiles (Mifflin-St Jeor)
- `adaptive-goals.ts` - Dynamic goal adjustment based on progress
- `weight-trend.ts` - Weight trend analysis
- `fasting-stats.ts` - Intermittent fasting statistics
- `glp1-insights.ts` - GLP-1 medication insights
- `healthkit-sync.ts` - Apple HealthKit integration

**Recipes & planning:**

- `recipe-generation.ts` - AI recipe generation (premium)
- `recipe-catalog.ts` - Spoonacular recipe catalog integration
- `recipe-import.ts` - Import recipes from URLs (schema.org LD+JSON)
- `grocery-generation.ts` - Auto-generate grocery lists from meal plans
- `pantry-deduction.ts` - Pantry item deduction logic
- `cooking-session.ts` - Live cooking with photo analysis
- `cooking-adjustment.ts` - Cooking portion adjustments
- `ingredient-substitution.ts` - AI ingredient swaps
- `carousel-builder.ts` - Recipe carousel generation
- `meal-type-inference.ts` - Meal type detection
- `pantry-meal-plan.ts` - Pantry-based meal planning
- `suggestion-generation.ts` - AI suggestion generation

**Verification:**

- `reformulation-detection.ts` - Product reformulation flagging
- `verification-comparison.ts` - Nutrition verification comparison

**Payments:**

- `receipt-validation.ts` - Apple/Google IAP receipt validation

**Other:**

- `profile-hub.ts` - Profile widget data aggregation

## Key Patterns

**CRITICAL:** Follow established patterns in `docs/patterns/` for all code changes. This ensures consistency, prevents common issues, and maintains code quality across the project.

### Pattern Documentation

- **`docs/PATTERNS.md`** - Index linking to domain-specific pattern files in `docs/patterns/`:
  - `security.md` - IDOR protection, SSRF, token versioning, AI input sanitization
  - `typescript.md` - Type guards, Zod schemas, shared types, discriminated unions
  - `api.md` - Error responses, auth, env validation, external API handling
  - `database.md` - Drizzle ORM, caching, soft delete, transactions, JSONB safety
  - `client-state.md` - In-memory caching, Authorization headers, TanStack Query
  - `react-native.md` - Navigation, safe areas, accessibility, forms, bottom sheets
  - `animation.md` - Reanimated configs, SVG arcs, gestures, layout animations
  - `performance.md` - React.memo, FlatList optimization, useMemo, TTL caches
  - `design-system.md` - Color opacity, semantic theme values, border radius
  - `architecture.md` - Storage module decomposition, route/service patterns
  - `hooks.md` - TanStack Query CRUD modules, FormData uploads, SSE streaming
  - `testing.md` - Pure function extraction, pre-commit hooks, ESLint rules
  - `documentation.md` - Todo structure, design decisions, form state hooks

**Before implementing:** Check if a pattern exists. **After implementing:** Consider if your solution should become a pattern.

### Code Audits

Use `/audit [scope]` to run a structured audit (skill in `.claude/skills/audit/SKILL.md`). This enforces:

- **Manifest tracking** — every finding is serialized to `docs/audits/YYYY-MM-DD-[scope].md`
- **Per-fix verification** — each fix is confirmed by re-reading code + running tests before marking `verified`
- **Dedup against previous audits** — checks `docs/audits/CHANGELOG.md` to avoid re-reporting fixed items
- **Zero open findings at close** — everything must be verified, deferred (with todo), or marked false-positive

Scopes: `full`, `pre-launch`, `security`, `performance`, `data-integrity`, `architecture`, `code-quality`

### Quick Pattern Reference

#### API Calls

Client uses `apiRequest()` from `client/lib/query-client.ts` for all server communication with automatic error handling. Always use Authorization header (not cookies) for auth tokens.

#### Theming

Use `useTheme()` hook. Colors, spacing, typography defined in `client/constants/theme.ts`. Supports light/dark modes.

#### Authentication

`AuthContext` manages auth state with AsyncStorage persistence. `useAuth()` hook provides login/register/logout. Token stored via in-memory cached storage (`client/lib/token-storage.ts`).

#### Onboarding

`OnboardingContext` collects dietary info across 6 screens. Data saved to `userProfiles` table on completion.

#### Safe Areas (React Native)

Always use `useSafeAreaInsets()` for screen layouts to handle iOS notch/dynamic island. Add theme spacing for visual breathing room.

#### Camera Scanning

Debounce barcode scans using ref tracking and `isScanning` state to prevent duplicate triggers. Always provide haptic feedback on successful scan.

## Testing

Unit tests use **Vitest** (~3400+ tests across 240+ files) with tests co-located in `__tests__/` directories:

- `server/__tests__/` - Auth middleware, storage interface tests
- `server/routes/__tests__/` - Route-level tests for all 23 route modules
- `server/services/__tests__/` - Service unit tests
- `client/lib/__tests__/` - Query client, token storage, format utilities
- `client/context/__tests__/` - AuthContext tests
- `client/hooks/__tests__/` - Hook tests
- `client/components/*-utils.ts` - Extracted pure functions tested via Vitest
- `shared/__tests__/` - Zod schemas, type guards

**Pre-commit hooks** (via Husky) automatically run on every commit:

1. `npm run test:run` - All tests must pass
2. `lint-staged` - ESLint + Prettier on staged files (also runs accessibility & hardcoded color checks on `.tsx` files)

If tests fail or linting errors occur, the commit is blocked.

## Environment Variables

- `DATABASE_URL` - PostgreSQL connection
- `JWT_SECRET` - JWT signing secret
- `AI_INTEGRATIONS_OPENAI_API_KEY` - OpenAI API
- `AI_INTEGRATIONS_OPENAI_BASE_URL` - Custom OpenAI endpoint
- `RUNWARE_API_KEY` - Runware API key for image generation (primary provider, falls back to DALL-E)
- `SPOONACULAR_API_KEY` - Spoonacular recipe catalog API
- `EXPO_PUBLIC_DOMAIN` - Public API domain for mobile client
- `EXPO_ACCESS_TOKEN` - Expo push notification service token (server-side); omit to disable server-driven push (local notifications still work)
- `EXPO_PUBLIC_PROJECT_ID` - Expo project ID for push token registration (client-side); required alongside `EXPO_ACCESS_TOKEN`
- `APPLE_ISSUER_ID` - Apple App Store Connect issuer ID (for IAP receipt validation)
- `APPLE_KEY_ID` - Apple App Store Connect API key ID
- `APPLE_PRIVATE_KEY` - Apple App Store Connect private key (PEM)
- `APPLE_BUNDLE_ID` - iOS app bundle identifier (e.g. `com.ocrecipes.app`)
- `APPLE_ENVIRONMENT` - Apple API environment (`sandbox` or `production`, defaults to `sandbox`)
- `APPLE_APP_ID` - Numeric App Apple ID (required for production JWS verification)
- `APPLE_ROOT_CA_DIR` - Override path for Apple root CA certificates directory (defaults to `server/certs/`)
- `RECEIPT_VALIDATION_STUB` - Set `"true"` to enable stub mode in dev (auto-approves receipts when no credentials configured)
- `GOOGLE_PACKAGE_NAME` - Android app package name (e.g. `com.ocrecipes.app`)
- `GOOGLE_SERVICE_ACCOUNT_EMAIL` - Google service account email (for IAP receipt validation)
- `GOOGLE_SERVICE_ACCOUNT_KEY` - Google service account private key (PEM, use `\n` for newlines)
- `USDA_API_KEY` - USDA nutrition data lookup
- `API_NINJAS_KEY` - API Ninjas nutrition fallback
- `ADMIN_USER_IDS` - Comma-separated admin user IDs
- `LOG_LEVEL` - Server log level (fatal/error/warn/info/debug/trace)
- `ANTHROPIC_API_KEY` - Anthropic API key used by the eval runner (`evals/runner.ts`) to call the LLM judge. Not used by the production server — evals only.
- `EVAL_JUDGE_MODEL` - Override the default judge model (`claude-sonnet-4-6`) for reproducible regression comparisons. Pin to a dated snapshot when comparing scores across runs.
- `EVAL_SAMPLES_PER_CASE` - Optional integer 1-10 (default `1`). Number of times each eval case is run; scores are pooled for bootstrapped 95% confidence intervals in the run output.
- `EVAL_PARALLELISM` - Optional integer 1-10 (default `1`). Concurrent case×sample evaluations in `evals/runner.ts`. Default `1` keeps runs serial and debug-friendly (live streaming logs); raise to cut wall time on large datasets at the cost of higher Anthropic + OpenAI concurrency. Logs are buffered per sample and flushed in submission order when `EVAL_PARALLELISM > 1`.

**Eval runner safety:** `evals/runner.ts` refuses to run when `NODE_ENV=production` unless you pass `--allow-prod` explicitly. Evals hit real Anthropic + OpenAI APIs — running against production keys can pollute analytics and burn budget.

## iOS Simulator Setup

### First Time Setup

The app uses `react-native-vision-camera` which requires native code compilation. You cannot use Expo Go for camera features.

1. **Start Backend Server**

   ```bash
   npm run server:dev
   ```

   Backend will run on `http://localhost:3000`

2. **Configure API URL**
   The simulator and physical devices cannot reach `localhost` — they need your Mac's LAN IP. **This IP changes when you switch networks**, so always verify before starting:

   ```bash
   # Check current IP and update .env in one step:
   CURRENT_IP=$(ipconfig getifaddr en0) && echo "Current IP: $CURRENT_IP" && sed -i '' "s|EXPO_PUBLIC_DOMAIN=.*|EXPO_PUBLIC_DOMAIN=http://$CURRENT_IP:3000|" .env && grep EXPO_PUBLIC_DOMAIN .env
   ```

   If the IP changed, you must restart Metro with `--clear` for the new value to take effect (see step 3).

3. **Build & Launch Development Client**
   ```bash
   npx expo run:ios
   ```
   This will:
   - Install CocoaPods dependencies (~2 minutes)
   - Build the native iOS app with camera support (~5-10 minutes first time)
   - Launch in iOS Simulator
   - Enable hot reloading for future code changes

### Subsequent Runs

After the first build, you can launch faster. **Always verify the IP first** — it changes when you switch networks:

```bash
# Step 0: Verify IP (ALWAYS do this first)
CURRENT_IP=$(ipconfig getifaddr en0) && sed -i '' "s|EXPO_PUBLIC_DOMAIN=.*|EXPO_PUBLIC_DOMAIN=http://$CURRENT_IP:3000|" .env && echo "API URL: http://$CURRENT_IP:3000"

# Terminal 1: Backend
npm run server:dev

# Terminal 2: Launch app (much faster after first build)
npx expo run:ios
```

The app will automatically reload when you make code changes (hot reload).

### Troubleshooting

**Build Errors (expo-barcode-scanner)**

- If you see `EXBarcodeScannerInterface.h` not found errors:
  ```bash
  npm uninstall expo-barcode-scanner
  cd ios && rm -rf Pods Podfile.lock && cd ..
  npx pod-install
  npx expo run:ios
  ```

**Network Errors (408, 503)**

- Ensure backend is running: check for "express server serving on port 3000"
- Verify `.env` has correct local IP, not a tunnel URL
- If using a physical device, ensure it's on the same WiFi network

**Camera Not Working in Expo Go**

- `react-native-vision-camera` is NOT supported in Expo Go
- You must use the development client: `npx expo run:ios`

## Physical Device Setup (iPhone)

The app requires a physical device for full camera functionality testing. **Your iPhone must be connected via USB cable to build the app.**

### Prerequisites

1. **Install expo-dev-client**:

   ```bash
   npx expo install expo-dev-client
   ```

2. **Enable Developer Mode on iPhone** (iOS 16+):
   - Go to **Settings → Privacy & Security → Developer Mode**
   - Turn it **ON**
   - iPhone will **restart**
   - After restart, tap **Turn On** to confirm

### First Time Build & Install

1. **Connect your iPhone to MacBook** via USB cable

2. **Unlock iPhone** and tap **"Trust This Computer"** when prompted

3. **Set up code signing in Xcode**:

   ```bash
   open ios/OCRecipes.xcworkspace
   ```

   In Xcode:
   - Click **"OCRecipes"** project (blue icon) in left sidebar
   - Select **"OCRecipes"** target under TARGETS
   - Click **"Signing & Capabilities"** tab
   - Enable **"Automatically manage signing"** checkbox
   - Select your **Team** (your Apple ID) from dropdown
   - If bundle identifier conflict: change to `com.yourname.ocrecipes`
   - Also update `app.json` to match: `"bundleIdentifier": "com.yourname.ocrecipes"`

4. **Build and install** (takes 5-10 minutes first time):

   ```bash
   xcodebuild -workspace ios/OCRecipes.xcworkspace -scheme OCRecipes \
     -configuration Debug -destination id=YOUR_DEVICE_ID \
     -allowProvisioningUpdates build
   ```

   To find your device ID:

   ```bash
   xcrun xctrace list devices | grep "iPhone"
   ```

5. **Install the built app**:

   ```bash
   xcrun devicectl device install app --device YOUR_DEVICE_ID \
     /Users/YOUR_USERNAME/Library/Developer/Xcode/DerivedData/OCRecipes-*/Build/Products/Debug-iphoneos/OCRecipes.app
   ```

6. **Trust developer certificate on iPhone**:
   - Go to **Settings → General → VPN & Device Management**
   - Tap your Apple ID under "Developer App"
   - Tap **"Trust [Your Name] (Personal Team)"**
   - Tap **Trust** in popup

### Running the App

1. **Start backend server**:

   ```bash
   npm run server:dev
   ```

2. **Start Metro bundler**:

   ```bash
   npx expo start --dev-client --lan
   ```

3. **Open OCRecipes app on iPhone**
   - If it shows "No development servers found":
     - Ensure iPhone and Mac are on **same WiFi network**
     - Tap **"Enter URL manually"**
     - Enter: `http://YOUR_MAC_IP:8081` (run `ipconfig getifaddr en0` to find it)
     - Tap **Connect**

### Subsequent Development

After first install, **USB cable is NOT required**. Just ensure both devices are on same WiFi:

```bash
# Step 0: Verify IP (ALWAYS do this first — IP changes when you switch networks)
CURRENT_IP=$(ipconfig getifaddr en0) && sed -i '' "s|EXPO_PUBLIC_DOMAIN=.*|EXPO_PUBLIC_DOMAIN=http://$CURRENT_IP:3000|" .env && echo "API URL: http://$CURRENT_IP:3000"

# Terminal 1: Backend (MUST start this first!)
npm run server:dev
# Wait for: "express server serving on port 3000"

# Terminal 2: Metro bundler
npx expo start --dev-client --lan --clear
# The --clear flag ensures fresh bundle with latest .env variables
```

**On your iPhone:**

1. Open the OCRecipes app
2. If it shows "No development servers found":
   - Tap **"Enter URL manually"**
   - Enter: `http://YOUR_MAC_IP:8081` (run `ipconfig getifaddr en0` to find it)
   - Tap **Connect**
3. App should load and connect to the backend

**Troubleshooting:**

- If login fails with "Network request failed": The backend server isn't running or isn't reachable
  - Verify backend is running: `curl http://localhost:3000/api/health` should return `{"status":"ok"}`
  - Check `.env` IP matches current network: `ipconfig getifaddr en0` then compare with `grep EXPO_PUBLIC_DOMAIN .env`
  - Restart Metro with `--clear` flag to reload environment variables
- If app can't connect to Metro: Both devices must be on same WiFi network
- To force reload on phone: Shake device → tap "Reload"

### Quick Start Commands

```bash
# Start both servers (run in separate terminals)
npm run server:dev
npx expo start --dev-client --lan

# Or use screen/tmux for persistent sessions
```

### Important Notes

- **USB cable is required** for the initial build only
- After installation, you can develop wirelessly (phone and Mac on same WiFi)
- **ALWAYS start backend server before Metro bundler** - Metro needs the backend running
- **ALWAYS verify `EXPO_PUBLIC_DOMAIN` IP** before launching — stale IPs cause silent API failures (skeleton placeholders, no data loading). Run: `CURRENT_IP=$(ipconfig getifaddr en0) && sed -i '' "s|EXPO_PUBLIC_DOMAIN=.*|EXPO_PUBLIC_DOMAIN=http://$CURRENT_IP:3000|" .env`
- QR codes from `npx expo start` **do NOT work** - the app needs the native camera module
- Always use `--dev-client` flag, NOT Expo Go
