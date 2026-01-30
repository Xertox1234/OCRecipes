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
│   ├── ErrorBoundary.tsx
│   ├── KeyboardAwareScrollViewCompat.tsx
│   ├── ThemedText.tsx
│   └── ThemedView.tsx
├── constants/
│   └── theme.ts            # Colors, spacing, typography
├── context/
│   ├── AuthContext.tsx     # Authentication state
│   └── OnboardingContext.tsx  # Onboarding data
├── hooks/
│   ├── useAuth.ts          # Auth operations
│   ├── useScreenOptions.ts # Navigation options
│   └── useTheme.ts         # Theme hook
├── lib/
│   └── query-client.ts     # TanStack Query setup
├── navigation/
│   ├── RootStackNavigator.tsx
│   ├── MainTabNavigator.tsx
│   ├── OnboardingNavigator.tsx
│   ├── HistoryStackNavigator.tsx
│   ├── ScanStackNavigator.tsx
│   └── ProfileStackNavigator.tsx
└── screens/
    ├── LoginScreen.tsx
    ├── HistoryScreen.tsx
    ├── ScanScreen.tsx
    ├── ProfileScreen.tsx
    ├── ItemDetailScreen.tsx
    ├── NutritionDetailScreen.tsx
    └── onboarding/
        ├── WelcomeScreen.tsx
        ├── AllergiesScreen.tsx
        ├── HealthConditionsScreen.tsx
        ├── DietTypeScreen.tsx
        ├── GoalsScreen.tsx
        └── PreferencesScreen.tsx
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
    │   ├── ScanTab → ScanStackNavigator
    │   │   └── ScanScreen
    │   └── ProfileTab → ProfileStackNavigator
    │       └── ProfileScreen
    └── NutritionDetailScreen (modal)
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
};

// client/navigation/MainTabNavigator.tsx
export type MainTabParamList = {
  HistoryTab: undefined;
  ScanTab: undefined;
  ProfileTab: undefined;
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

---

## API Communication

### apiRequest Helper

```typescript
// client/lib/query-client.ts
export async function apiRequest(
  method: string,
  route: string,
  data?: unknown
): Promise<Response> {
  const baseUrl = getApiUrl();
  const url = new URL(route, baseUrl);

  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include", // Important for sessions
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
const summaryRes = await apiRequest("GET", "/api/daily-summary?date=2024-01-15");
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
    success: "#00C853",         // Primary green
    calorieAccent: "#FF6B35",   // Orange
    proteinAccent: "#00C853",   // Green
    carbsAccent: "#FF6B35",     // Orange
    fatAccent: "#FFC107",       // Yellow
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
const { data: items, isLoading, refetch } = useQuery({
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

### ProfileScreen

Features:
- User avatar with display name editing
- Daily calorie progress bar
- Macros breakdown
- Dietary preferences display
- Calorie goal editing
- Sign out button

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

```typescript
import { CameraView, useCameraPermissions } from "expo-camera";

function ScanScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [flashEnabled, setFlashEnabled] = useState(false);

  if (!permission?.granted) {
    return (
      <View>
        <Text>Camera permission required</Text>
        <Button onPress={requestPermission} title="Grant Permission" />
      </View>
    );
  }

  return (
    <CameraView
      style={StyleSheet.absoluteFill}
      facing="back"
      enableTorch={flashEnabled}
      barcodeScannerSettings={{
        barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e", "qr"],
      }}
      onBarcodeScanned={(result) => {
        // Handle barcode
      }}
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
