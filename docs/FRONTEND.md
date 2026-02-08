# NutriScan Frontend Guide

## Overview

The NutriScan frontend is built with Expo SDK 54, React Native 0.81, and React 19. It uses React Navigation for routing and TanStack Query for server state management.

## Project Structure

```
client/
├── App.tsx                 # Root component with providers
├── components/             # Reusable UI components
│   ├── Button.tsx
│   ├── Card.tsx
│   ├── Chip.tsx
│   ├── ErrorBoundary.tsx
│   ├── ErrorFallback.tsx
│   ├── HeaderTitle.tsx
│   ├── KeyboardAwareScrollViewCompat.tsx
│   ├── PreparationPicker.tsx
│   ├── ProgressBar.tsx
│   ├── RecipeCard.tsx
│   ├── RecipeGenerationModal.tsx
│   ├── SaveButton.tsx
│   ├── SavedItemCard.tsx
│   ├── SkeletonLoader.tsx
│   ├── SuggestionCard.tsx
│   ├── TextInput.tsx
│   ├── ThemedText.tsx
│   ├── ThemedView.tsx
│   └── recipe-builder/
├── constants/
│   ├── animations.ts       # Shared animation configs
│   ├── dietary-options.ts   # Diet/allergy option lists
│   └── theme.ts             # Colors, spacing, typography
├── context/
│   ├── AuthContext.tsx      # Authentication state
│   ├── OnboardingContext.tsx # Onboarding data
│   ├── PremiumContext.tsx   # Premium features
│   └── ThemeContext.tsx     # Light/dark theme
├── hooks/
│   ├── useAccessibility.ts  # Accessibility helpers
│   ├── useAuth.ts           # Auth operations
│   ├── useColorScheme.ts    # System color scheme
│   ├── useHaptics.ts        # Haptic feedback
│   ├── useMealPlan.ts       # Meal planning
│   ├── usePremiumFeatures.ts # Premium feature checks
│   ├── useRecipeForm.ts     # Recipe form state
│   ├── useSavedItems.ts     # Saved items management
│   ├── useScreenOptions.ts  # Navigation options
│   └── useTheme.ts          # Theme hook
├── lib/
│   ├── image-compression.ts # Image compression utils
│   ├── ingredient-parser.ts # Ingredient text parsing
│   ├── macro-colors.ts      # Macro nutrient color mapping
│   ├── photo-upload.ts      # Photo upload helpers
│   ├── query-client.ts      # TanStack Query setup, apiRequest, getApiUrl
│   ├── serving-size-utils.ts # Serving size validation & normalization
│   └── token-storage.ts     # Auth token persistence
├── navigation/
│   ├── RootStackNavigator.tsx
│   ├── MainTabNavigator.tsx
│   ├── OnboardingNavigator.tsx
│   ├── HistoryStackNavigator.tsx
│   ├── MealPlanStackNavigator.tsx
│   ├── ScanStackNavigator.tsx
│   └── ProfileStackNavigator.tsx
└── screens/
    ├── LoginScreen.tsx
    ├── HistoryScreen.tsx
    ├── ScanScreen.tsx
    ├── ProfileScreen.tsx
    ├── ItemDetailScreen.tsx
    ├── NutritionDetailScreen.tsx
    ├── onboarding/
    │   ├── WelcomeScreen.tsx
    │   ├── AllergiesScreen.tsx
    │   ├── HealthConditionsScreen.tsx
    │   ├── DietTypeScreen.tsx
    │   ├── GoalsScreen.tsx
    │   └── PreferencesScreen.tsx
    └── meal-plan/
        ├── MealPlanHomeScreen.tsx
        ├── RecipeDetailScreen.tsx
        ├── RecipeBrowserScreen.tsx
        ├── RecipeCreateScreen.tsx
        └── RecipeImportScreen.tsx
```

---

## Navigation

### Navigation Hierarchy

```
RootStackNavigator
├── LoginScreen (unauthenticated)
├── OnboardingNavigator (needs onboarding)
│   ├── WelcomeScreen
│   ├── AllergiesScreen
│   ├── HealthConditionsScreen
│   ├── DietTypeScreen
│   ├── GoalsScreen
│   └── PreferencesScreen
└── Main (authenticated)
    ├── MainTabNavigator
    │   ├── HistoryTab → HistoryStackNavigator
    │   │   ├── HistoryScreen
    │   │   └── ItemDetailScreen
    │   ├── MealPlanTab → MealPlanStackNavigator
    │   │   ├── MealPlanHomeScreen
    │   │   ├── RecipeDetailScreen
    │   │   ├── RecipeBrowserScreen
    │   │   ├── RecipeCreateScreen
    │   │   └── RecipeImportScreen
    │   ├── ScanTab → ScanStackNavigator
    │   │   └── ScanScreen
    │   └── ProfileTab → ProfileStackNavigator
    │       └── ProfileScreen
    ├── NutritionDetailScreen (modal)
    ├── PhotoIntentScreen (modal)
    ├── PhotoAnalysisScreen (modal)
    ├── GoalSetupScreen (modal)
    └── EditDietaryProfileScreen (modal)
```

### Type-Safe Navigation

```typescript
// client/navigation/RootStackNavigator.tsx
export type RootStackParamList = {
  Login: undefined;
  Onboarding: undefined;
  Main: undefined;
  NutritionDetail: {
    barcode?: string;
    imageUri?: string;
    itemId?: number;
  };
  PhotoIntent: {
    imageUri: string;
  };
  PhotoAnalysis: {
    imageUri: string;
    intent: PhotoIntent;
  };
};

// client/navigation/MainTabNavigator.tsx
export type MainTabParamList = {
  HistoryTab: undefined;
  MealPlanTab: undefined;
  ScanTab: undefined;
  ProfileTab: undefined;
};

// client/navigation/MealPlanStackNavigator.tsx
export type MealPlanStackParamList = {
  MealPlanHome: undefined;
  RecipeDetail: { recipeId: number };
  RecipeBrowser: { mealType?: string; plannedDate?: string };
  RecipeCreate: { prefill?: ImportedRecipeData };
  RecipeImport: undefined;
};

// client/navigation/OnboardingNavigator.tsx
export type OnboardingStackParamList = {
  Welcome: undefined;
  Allergies: undefined;
  HealthConditions: undefined;
  DietType: undefined;
  Goals: undefined;
  Preferences: undefined;
};
```

### Navigation Patterns

```typescript
// Navigate to a screen
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

function MyScreen() {
  const navigation = useNavigation<NavigationProp>();

  const goToDetail = (itemId: number) => {
    navigation.navigate("NutritionDetail", { itemId });
  };

  return <Button onPress={() => goToDetail(1)} title="View Details" />;
}
```

---

## State Management

### Authentication Context

```typescript
// client/context/AuthContext.tsx
interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<User>;
  register: (username: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  updateUser: (updates: Partial<User>) => Promise<User | undefined>;
  checkAuth: () => Promise<void>;
}

// Usage
import { useAuthContext } from "@/context/AuthContext";

function ProfileScreen() {
  const { user, logout, updateUser } = useAuthContext();

  const handleLogout = async () => {
    await logout();
  };

  return (
    <View>
      <Text>Welcome, {user?.displayName}</Text>
      <Button onPress={handleLogout} title="Sign Out" />
    </View>
  );
}
```

### Onboarding Context

```typescript
// client/context/OnboardingContext.tsx
interface OnboardingContextType {
  currentStep: number;
  data: OnboardingData;
  setData: (key: keyof OnboardingData, value: any) => void;
  nextStep: () => void;
  prevStep: () => void;
  submitOnboarding: () => Promise<void>;
}

interface OnboardingData {
  allergies: Allergy[];
  healthConditions: string[];
  dietType: string;
  foodDislikes: string[];
  primaryGoal: string;
  activityLevel: string;
  householdSize: number;
  cuisinePreferences: string[];
  cookingSkillLevel: string;
  cookingTimeAvailable: string;
}

// Usage
import { useOnboarding } from "@/context/OnboardingContext";

function AllergiesScreen() {
  const { data, setData, nextStep } = useOnboarding();

  const addAllergy = (allergy: Allergy) => {
    setData("allergies", [...data.allergies, allergy]);
  };

  return (
    <View>
      {/* Allergy selection UI */}
      <Button onPress={nextStep} title="Continue" />
    </View>
  );
}
```

### TanStack Query

```typescript
// client/lib/query-client.ts
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});

// Usage in components
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

function HistoryScreen() {
  const { data: items, isLoading, refetch } = useQuery({
    queryKey: ["/api/scanned-items"],
  });

  if (isLoading) return <LoadingSpinner />;

  return (
    <FlatList
      data={items}
      renderItem={({ item }) => <ItemCard item={item} />}
      refreshing={isLoading}
      onRefresh={refetch}
    />
  );
}
```

### Premium Context

Manages subscription tier, feature flags, and usage limits. Defined in `client/context/PremiumContext.tsx`.

```typescript
interface PremiumContextType {
  tier: SubscriptionTier; // "free" | "premium"
  features: PremiumFeatures; // Feature flags for current tier
  isPremium: boolean; // tier === "premium" && isActive
  isLoading: boolean;
  dailyScanCount: number;
  canScanToday: boolean; // isPremium || count < maxDailyScans
  recipeGenerationsToday: number;
  canGenerateRecipe: boolean;
  refreshSubscription: () => Promise<void>;
  refreshScanCount: () => Promise<void>;
  refreshRecipeGenerationStatus: () => Promise<void>;
}
```

**TanStack Query keys and cache strategy:**

| Query Key                            | Stale Time | Purpose                 |
| ------------------------------------ | ---------- | ----------------------- |
| `["/api/subscription/status"]`       | 5 minutes  | Tier, features, expiry  |
| `["/api/subscription/scan-count"]`   | 30 seconds | Daily scan usage        |
| `["/api/recipes/generation-status"]` | 30 seconds | Recipe generation usage |

**Premium hooks** (`client/hooks/usePremiumFeatures.ts`):

- `usePremiumFeature(key)` — returns `boolean` for any `PremiumFeatureKey`
- `useAvailableBarcodeTypes()` — returns `ExpoBarcodeType[]` filtered by tier
- `useCanScanToday()` — returns `{ canScan, remainingScans, dailyLimit, currentCount }`
- `usePremiumCamera()` — combined hook returning barcode types, scan limits, `highQualityCapture`, and `videoRecording` flags

**Camera integration:** `ScanScreen` destructures `usePremiumCamera()` to pass `photoQuality` (0.9 for premium, 0.5 for free) and `availableBarcodeTypes` to `<CameraView>`.

---

## API Communication

### apiRequest Helper

```typescript
// client/lib/query-client.ts
export async function apiRequest(
  method: string,
  route: string,
  data?: unknown,
): Promise<Response> {
  const baseUrl = getApiUrl();
  const url = new URL(route, baseUrl);

  const headers: Record<string, string> = {};
  if (data) {
    headers["Content-Type"] = "application/json";
  }
  const token = await tokenStorage.get();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
  });

  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }

  return res;
}
```

### Usage Examples

```typescript
// Login
const response = await apiRequest("POST", "/api/auth/login", {
  username: "user",
  password: "pass",
});
const user = await response.json();

// Create scanned item
await apiRequest("POST", "/api/scanned-items", {
  productName: "Apple",
  calories: 95,
  protein: 0.5,
  carbs: 25,
  fat: 0.3,
});

// Fetch daily summary
const summaryRes = await apiRequest(
  "GET",
  "/api/daily-summary?date=2024-01-15",
);
const summary = await summaryRes.json();
```

---

## Theming

### Theme Constants

```typescript
// client/constants/theme.ts
export const Colors = {
  light: {
    text: "#1A1A1A",
    textSecondary: "#757575",
    success: "#00C853", // Primary green
    calorieAccent: "#FF6B35", // Orange
    proteinAccent: "#00C853", // Green
    carbsAccent: "#FF6B35", // Orange
    fatAccent: "#FFC107", // Yellow
    backgroundRoot: "#FAFAFA",
    backgroundDefault: "#FFFFFF",
    error: "#D32F2F",
  },
  dark: {
    text: "#ECEDEE",
    backgroundRoot: "#121212",
    // ... dark variants
  },
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  "2xl": 24,
  inputHeight: 48,
  buttonHeight: 52,
};

export const Typography = {
  h1: { fontSize: 32, lineHeight: 40, fontWeight: "700" },
  h2: { fontSize: 28, lineHeight: 36, fontWeight: "700" },
  body: { fontSize: 16, lineHeight: 24, fontWeight: "400" },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: "400" },
};

export const BorderRadius = {
  xs: 8,
  sm: 12,
  md: 18,
  lg: 24,
  full: 9999,
};
```

### useTheme Hook

```typescript
// Usage
import { useTheme } from "@/hooks/useTheme";

function MyComponent() {
  const { theme, isDark } = useTheme();

  return (
    <View style={{ backgroundColor: theme.backgroundRoot }}>
      <Text style={{ color: theme.text }}>Hello World</Text>
    </View>
  );
}
```

### Themed Components

```typescript
// ThemedText with variants
<ThemedText variant="h1">Heading</ThemedText>
<ThemedText variant="body">Body text</ThemedText>
<ThemedText variant="caption" color="textSecondary">Caption</ThemedText>

// ThemedView with backgrounds
<ThemedView bg="backgroundDefault">
  <ThemedText>Content</ThemedText>
</ThemedView>
```

---

## Components

### Button

```typescript
import { Button } from "@/components/Button";

<Button
  title="Primary Action"
  onPress={handlePress}
  variant="primary"      // "primary" | "secondary" | "outline"
  size="medium"          // "small" | "medium" | "large"
  disabled={isLoading}
  loading={isSubmitting}
/>
```

### Card

```typescript
import { Card } from "@/components/Card";

<Card
  shadow="medium"        // "small" | "medium" | "large"
  padding={Spacing.lg}
  borderRadius={BorderRadius.md}
>
  <ThemedText>Card Content</ThemedText>
</Card>
```

### ErrorBoundary

```typescript
import { ErrorBoundary } from "@/components/ErrorBoundary";

<ErrorBoundary
  fallback={<Text>Something went wrong</Text>}
  onError={(error) => console.error(error)}
>
  <MyComponent />
</ErrorBoundary>
```

---

## Screens

### LoginScreen

Features:

- Toggle between login/register modes
- Username/password inputs with icons
- Password visibility toggle
- Error handling with haptic feedback
- Loading state

```typescript
// Key functionality
const handleSubmit = async () => {
  try {
    if (isLogin) {
      await login(username, password);
    } else {
      await register(username, password);
    }
  } catch (error) {
    Haptics.notificationAsync(NotificationFeedbackType.Error);
    setError(error.message);
  }
};
```

### ScanScreen

Features:

- CameraView with barcode detection
- Animated scanning reticle
- Flashlight toggle
- Shutter button for photo capture
- Gallery image picker

Supported barcode types:

- EAN-13, EAN-8, UPC-A, UPC-E
- QR Code, Data Matrix
- Code 128, Code 39

```typescript
// Barcode detection
onBarcodeScanned={(scanningResult) => {
  navigation.navigate("NutritionDetail", {
    barcode: scanningResult.data,
  });
}}
```

### HistoryScreen

Features:

- FlatList of scanned items
- Pull-to-refresh
- Item thumbnails with fallback
- Animated item press
- Empty state illustration
- Loading skeleton

```typescript
const {
  data: items,
  isLoading,
  refetch,
} = useQuery({
  queryKey: ["/api/scanned-items"],
});
```

### ItemDetailScreen

Features:

- Product header with image
- Nutrition facts card
- AI-powered suggestions (4 cards)
- Loading/error states for suggestions

```typescript
// Fetch suggestions
const fetchSuggestions = async () => {
  const res = await apiRequest("POST", `/api/items/${itemId}/suggestions`);
  return res.json();
};
```

### NutritionDetailScreen

Displays nutrition data for a barcode scan or photo analysis. Opened as a modal from
`ScanScreen` with either `{ barcode }` or `{ imageUri }` params.

**Barcode Flow:**

1. Calls `GET /api/nutrition/barcode/:code` using **raw `fetch`** (not `apiRequest`)
   to properly handle 404 responses without throwing
2. If product found → displays nutrition data with serving controls
3. If `notInDatabase: true` → shows manual product name search UI
4. Manual search calls `GET /api/nutrition/lookup?name=...`

**Key state variables:**

- `showManualSearch` — toggles the search UI when barcode not found
- `manualSearchQuery` — user-entered food name
- `isSearching` — loading state for text search

**Serving Size Controls** (shown for barcode scans with nutrition data):

- Correction banner explaining per-100g normalization
- Chip picker: tsp / tbsp / cup / 100g / Custom
- Custom gram input (appears when "Custom" selected)
- Quantity stepper (+ / −) adjusting displayed macros

**Why raw fetch?**
The shared `apiRequest()` calls `throwIfResNotOk()` which throws on any non-2xx
response. For the barcode endpoint, a 404 is an expected outcome (product not in
database), not an error. Using raw `fetch` lets us inspect the response body to
check for `notInDatabase` and show the search UI.

```typescript
// Barcode fetch — raw fetch to handle 404 gracefully
const baseUrl = getApiUrl();
const token = await tokenStorage.getToken();
const response = await fetch(`${baseUrl}/api/nutrition/barcode/${barcode}`, {
  headers: token ? { Authorization: `Bearer ${token}` } : {},
});
const data = await response.json();

if (data.notInDatabase) {
  setShowManualSearch(true); // Show name search UI
}
```

### PhotoIntentScreen

First step after capturing a food photo. The user selects what they want to do with the image before analysis begins. Opened as a modal from `ScanScreen` with `{ imageUri }`.

**Intent Options:**

| Intent     | Label                 | Description                                           | Premium |
| ---------- | --------------------- | ----------------------------------------------------- | ------- |
| `log`      | "Log this meal"       | Identify foods, get nutrition info, save to daily log | No      |
| `calories` | "Quick calorie check" | See nutrition info without logging                    | No      |
| `recipe`   | "Find recipes"        | Identify ingredients and generate recipes             | Yes     |
| `identify` | "Just identify"       | See what foods are in the photo                       | No      |

**Key behavior:**

- Displays photo thumbnail with 4 animated intent cards (FadeInUp stagger)
- Recipe intent shows lock badge when user lacks premium (`usePremiumContext()`)
- On selection: navigates to `PhotoAnalysis` with `{ imageUri, intent }`

### PhotoAnalysisScreen

Main photo analysis screen showing detected foods, nutrition data, and user controls. Opened from `PhotoIntentScreen` with `{ imageUri, intent }`.

**Lifecycle:**

1. **Upload & Analyze** — calls `uploadPhotoForAnalysis(imageUri, intent)` which compresses the image and uploads via multipart to `POST /api/photos/analyze`. For `log`/`calories` intents, the server batch-looks up nutrition and includes it in the response
2. **Follow-up** — if overall confidence < 0.7 or foods need clarification, shows a bottom panel with AI-generated questions. User answers are sent to `POST /api/photos/analyze/:sessionId/followup`, refining the analysis
3. **Action** — intent-specific behavior (see below)

**Intent-specific behavior:**

- **log**: Checkboxes per food (all selected by default), preparation method picker per food, nutrition totals card. On confirm: `POST /api/photos/confirm` saves to `scannedItems` + `dailyLogs`
- **calories**: Read-only nutrition display. No database save
- **recipe**: Shows identified ingredients, opens `RecipeGenerationModal`
- **identify**: Read-only food list display

**Key UI components:**

- **FoodItemCard** — name, quantity, confidence badge (High ≥0.8 / Medium ≥0.6 / Low), optional clarification warning, prep picker (log only)
- **Totals Card** — aggregate calories/protein/carbs/fat for selected items
- **FollowUpModal** — absolute-positioned bottom panel with question and answer input

**Preparation method picker** (log intent only):

- Per-food dropdown sourced from `PREPARATION_OPTIONS[category]` in `shared/constants/preparation.ts`
- Changing preparation re-looks up nutrition via `GET /api/nutrition/lookup?name=<prep+food>` (e.g. "steamed broccoli 1 cup")

**Cleanup on unmount:** aborts in-flight requests, deletes temporary image from file system.

### ProfileScreen

Features:

- User avatar with display name editing
- Daily calorie progress bar
- Macros breakdown
- Dietary preferences display
- Calorie goal editing
- Sign out button

---

## Meal Planning

The meal planning feature is accessed via the "Plan" tab in the main tab navigator. It uses the `MealPlanStackNavigator` with 5 screens and a set of bottom-sheet recipe builder components.

### MealPlanHomeScreen

The main dashboard for meal planning.

Features:

- 7-day date picker strip with week navigation (swipe or arrow buttons)
- Four meal type sections: Breakfast, Lunch, Dinner, Snack
- Real-time daily nutrition totals (calories, protein, carbs, fat)
- Smart date labels ("Today", "Tomorrow", "Yesterday")
- Pull-to-refresh for syncing
- Add/remove items from meal slots
- Orphaned item detection (shows "Item removed" if linked recipe deleted)
- Memoized subcomponents for performance (DateStripItem, MealSlotItem, MealSlotSection, DailyTotals)

```typescript
// Data fetching
const { data: items } = useMealPlanItems(startDate, endDate);
```

### RecipeDetailScreen

Displays full recipe details.

Features:

- Recipe title, description, and metadata pills (time, difficulty, servings)
- Nutrition card with per-serving macros
- Full ingredients list with quantities and units
- Formatted instructions text
- Diet tag badges (Vegetarian, Vegan, etc.)

### RecipeBrowserScreen

Browse and add recipes to the meal plan.

Features:

- Two tabs: "Catalog" (Spoonacular) and "My Recipes"
- Search with 300ms debounce
- Catalog filters: Cuisines (Italian, Mexican, Asian, Mediterranean, American, Indian) and Diets (Vegetarian, Vegan, Gluten Free, Keto, Paleo)
- Header buttons to navigate to RecipeCreate and RecipeImport
- Route params: `mealType` and `plannedDate` (passed from MealPlanHomeScreen)

### RecipeCreateScreen

Create new recipes with a bottom-sheet builder UI.

Features:

- Title and description text inputs
- Five expandable sections, each opening a bottom sheet:
  - **Ingredients** (70% snap) — add/remove ingredient rows
  - **Instructions** (70% snap) — reorderable step rows
  - **Time & Servings** (45-70% snap) — stepper controls
  - **Nutrition** (50% snap) — per-serving calorie/macro inputs
  - **Tags & Cuisine** (50% snap) — cuisine text input + diet tag toggles
- Unsaved changes guard (confirmation on back navigation)
- Supports prefilled data from RecipeImportScreen via `prefill` param
- Lazy-mounted sheets (only rendered when first opened)

### RecipeImportScreen

Import recipes from URLs using schema.org structured data.

Features:

- URL input with validation
- Four states: idle, loading, success, error
- Success state displays imported recipe title and calorie count
- Error types: NO_RECIPE_DATA, FETCH_FAILED, TIMEOUT, RESPONSE_TOO_LARGE
- Actions: Import, View Recipe, Done, Try Again, Create Manually
- Haptic feedback on state changes

### Recipe Builder Components (`client/components/recipe-builder/`)

| Component               | Purpose                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| `SectionRow.tsx`        | Interactive row for each recipe section (icon, label, summary, press handler with haptics) |
| `SheetHeader.tsx`       | Bottom sheet header with drag indicator and Done button                                    |
| `IngredientsSheet.tsx`  | Add/edit/remove ingredient rows                                                            |
| `InstructionsSheet.tsx` | Add/edit/remove/reorder instruction steps                                                  |
| `TimeServingsSheet.tsx` | Stepper controls for servings, text inputs for prep/cook time                              |
| `NutritionSheet.tsx`    | Four numeric inputs: calories, protein, carbs, fat                                         |
| `TagsCuisineSheet.tsx`  | Cuisine text input + diet tag toggle buttons                                               |
| `types.ts`              | Shared types: `SheetSection`, `SheetLifecycleState`, `DIET_TAG_OPTIONS`                    |

### Meal Plan Hooks

**`useMealPlan.ts`** — Query and mutation hooks for meal plan items:

- `useMealPlanItems(start, end)` — Fetches items for a date range
- `useAddMealPlanItem()` — Adds recipe or scanned item to a meal slot
- `useRemoveMealPlanItem()` — Removes an item from the plan
- `invalidateMealPlanItems(queryClient)` — Helper to invalidate meal plan item queries (not recipe/catalog queries)

**`useRecipeForm.ts`** — Form state management for recipe creation:

- Manages title, description, ingredients, steps, time/servings, nutrition, tags
- Provides add/remove/update/move actions for ingredients and steps
- Computed summaries for each section (e.g., "3 ingredients", "250 cal · 15g protein")
- `isDirty` flag for unsaved changes detection
- `formToPayload()` serializes form state to API request format
- Accepts optional `ImportedRecipeData` for prefilling from import

---

## Onboarding Flow

The onboarding consists of 6 screens that collect dietary preferences:

1. **WelcomeScreen** - Introduction
2. **AllergiesScreen** - Add allergies with severity
3. **HealthConditionsScreen** - Select health conditions
4. **DietTypeScreen** - Choose diet type
5. **GoalsScreen** - Set primary health goal
6. **PreferencesScreen** - Activity level, cooking preferences

### Step Navigation

```typescript
const SCREENS = [
  { name: "Welcome", component: WelcomeScreen },
  { name: "Allergies", component: AllergiesScreen },
  { name: "HealthConditions", component: HealthConditionsScreen },
  { name: "DietType", component: DietTypeScreen },
  { name: "Goals", component: GoalsScreen },
  { name: "Preferences", component: PreferencesScreen },
];

// In OnboardingContext
const nextStep = () => {
  if (currentStep < SCREENS.length - 1) {
    setCurrentStep(currentStep + 1);
  }
};

const submitOnboarding = async () => {
  await apiRequest("POST", "/api/user/dietary-profile", data);
  await updateUser({ onboardingCompleted: true });
};
```

---

## Animations

Uses Reanimated 4 for smooth animations:

```typescript
import Animated, {
  FadeIn,
  FadeInDown,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";

// Enter animations
<Animated.View entering={FadeInDown.delay(100)}>
  <Text>Animated content</Text>
</Animated.View>

// Interactive animations
const scale = useSharedValue(1);

const animatedStyle = useAnimatedStyle(() => ({
  transform: [{ scale: scale.value }],
}));

const handlePressIn = () => {
  scale.value = withSpring(0.95);
};

const handlePressOut = () => {
  scale.value = withSpring(1);
};
```

---

## Camera Integration

Uses `react-native-vision-camera` (not expo-camera) for barcode scanning and photo capture.

```typescript
import { Camera, useCodeScanner, useCameraDevice } from "react-native-vision-camera";

function ScanScreen() {
  const device = useCameraDevice("back");

  const codeScanner = useCodeScanner({
    codeTypes: ["ean-13", "ean-8", "upc-a", "upc-e", "qr"],
    onCodeScanned: (codes) => {
      // Handle barcode with debouncing
    },
  });

  return (
    <Camera
      style={StyleSheet.absoluteFill}
      device={device}
      isActive={true}
      codeScanner={codeScanner}
      photo={true}
      torch={flashEnabled ? "on" : "off"}
    />
  );
}
```

---

## Development Tips

### Path Aliases

Import from `@/` for client code:

```typescript
import { useTheme } from "@/hooks/useTheme";
import { Button } from "@/components/Button";
import { Colors } from "@/constants/theme";
```

### Hot Reloading

Expo provides fast refresh. Shake device or press `r` in terminal to reload.

### Debugging

```bash
# Open React DevTools
npx react-devtools

# View logs
npx expo start --dev-client
```

### Type Checking

```bash
npm run check:types
```

### Linting

```bash
npm run lint
npm run lint:fix
```
