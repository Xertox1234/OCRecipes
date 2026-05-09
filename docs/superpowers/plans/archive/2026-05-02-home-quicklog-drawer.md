# Home Tab — Inline Quick Log Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Quick Log navigation action on the Home tab with an inline expandable drawer that shows text input, voice, camera, and frequent-item chips without leaving the Home screen; also add a scan confirm card to ScanScreen for returning directly to Home after a scan.

**Architecture:** Extract all quick-log logic from `QuickLogScreen` into a shared `useQuickLogSession` hook, then build a `QuickLogDrawer` component that consumes it. HomeScreen renders the drawer inline in the Nutrition & Health section. ScanScreen gains a `returnAfterLog` route param that shows a confirm overlay instead of navigating to NutritionDetail.

**Tech Stack:** React Native, Expo, Reanimated 4, TanStack Query v5, `useSpeechToText` (expo-speech-recognition), Vitest

---

## File Map

| Status | Path                                                       | Responsibility                                                                                        |
| ------ | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Create | `client/hooks/useQuickLogSession.ts`                       | All quick-log state: text input, voice, parse, submit, frequent items                                 |
| Create | `client/hooks/__tests__/useQuickLogSession.test.ts`        | Unit tests for the hook                                                                               |
| Create | `client/components/home/QuickLogDrawer.tsx`                | Inline expandable panel, consumes `useQuickLogSession`                                                |
| Create | `client/components/home/__tests__/QuickLogDrawer.test.tsx` | Render tests for drawer states                                                                        |
| Modify | `client/screens/QuickLogScreen.tsx`                        | Use `useQuickLogSession` instead of inline logic                                                      |
| Modify | `client/components/home/action-config.ts`                  | Add `renderInline?: boolean` to `HomeAction`; remove Voice Log; add `renderInline: true` to Quick Log |
| Modify | `client/screens/HomeScreen.tsx`                            | Render `QuickLogDrawer` for `renderInline` actions                                                    |
| Modify | `client/navigation/RootStackNavigator.tsx`                 | Add `returnAfterLog?: boolean` to `Scan` param                                                        |
| Modify | `client/screens/ScanScreen.tsx`                            | Read `returnAfterLog` param; show confirm overlay on SESSION_COMPLETE                                 |

---

## Task 1: Extract `useQuickLogSession` hook

**Files:**

- Create: `client/hooks/useQuickLogSession.ts`
- Create: `client/hooks/__tests__/useQuickLogSession.test.ts`

- [ ] **Step 1: Write failing tests**

Create `client/hooks/__tests__/useQuickLogSession.test.ts`:

```ts
// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";
import { useQuickLogSession } from "../useQuickLogSession";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";

const { mockApiRequest, mockTokenStorage } = vi.hoisted(() => ({
  mockApiRequest: vi.fn(),
  mockTokenStorage: {
    get: vi.fn(),
    set: vi.fn(),
    clear: vi.fn(),
    invalidateCache: vi.fn(),
  },
}));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
  getApiUrl: () => "http://localhost:3000",
}));

vi.mock("@/lib/token-storage", () => ({ tokenStorage: mockTokenStorage }));

vi.mock("@/hooks/useSpeechToText", () => ({
  useSpeechToText: () => ({
    isListening: false,
    transcript: "",
    isFinal: false,
    volume: -2,
    error: null,
    startListening: vi.fn(),
    stopListening: vi.fn(),
  }),
}));

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({ impact: vi.fn(), notification: vi.fn() }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockTokenStorage.get.mockResolvedValue("test-token");
});

describe("useQuickLogSession", () => {
  it("parses food text and populates parsedItems on success", async () => {
    const { wrapper } = createQueryWrapper();
    mockApiRequest.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          items: [
            {
              name: "eggs",
              quantity: 2,
              unit: "large",
              calories: 143,
              protein: 12,
              carbs: 1,
              fat: 10,
              servingSize: null,
            },
          ],
        }),
    });

    const { result } = renderHook(() => useQuickLogSession(), { wrapper });

    act(() => result.current.setInputText("2 eggs"));
    act(() => result.current.handleTextSubmit());

    await waitFor(() => expect(result.current.parsedItems).toHaveLength(1));
    expect(result.current.parsedItems[0].name).toBe("eggs");
    expect(result.current.parseError).toBeNull();
  });

  it("sets parseError when parse fails", async () => {
    const { wrapper } = createQueryWrapper();
    mockApiRequest.mockRejectedValueOnce(new Error("network error"));

    const { result } = renderHook(() => useQuickLogSession(), { wrapper });

    act(() => result.current.setInputText("some food"));
    act(() => result.current.handleTextSubmit());

    await waitFor(() => expect(result.current.parseError).not.toBeNull());
    expect(result.current.parsedItems).toHaveLength(0);
  });

  it("removes item by index", async () => {
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useQuickLogSession(), { wrapper });

    // Seed parsedItems via act to simulate post-parse state
    mockApiRequest.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          items: [
            {
              name: "eggs",
              quantity: 2,
              unit: "large",
              calories: 143,
              protein: 12,
              carbs: 1,
              fat: 10,
              servingSize: null,
            },
            {
              name: "coffee",
              quantity: 1,
              unit: "cup",
              calories: 5,
              protein: 0,
              carbs: 1,
              fat: 0,
              servingSize: null,
            },
          ],
        }),
    });

    act(() => result.current.setInputText("2 eggs and coffee"));
    act(() => result.current.handleTextSubmit());

    await waitFor(() => expect(result.current.parsedItems).toHaveLength(2));

    act(() => result.current.removeItem(0));

    expect(result.current.parsedItems).toHaveLength(1);
    expect(result.current.parsedItems[0].name).toBe("coffee");
  });

  it("calls onLogSuccess with summary after submitLog succeeds", async () => {
    const { wrapper } = createQueryWrapper();
    const onLogSuccess = vi.fn();

    // First call: parse; second call: log item
    mockApiRequest
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            items: [
              {
                name: "chicken",
                quantity: 1,
                unit: "breast",
                calories: 320,
                protein: 58,
                carbs: 0,
                fat: 7,
                servingSize: null,
              },
            ],
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 1 }),
      });

    const { result } = renderHook(() => useQuickLogSession({ onLogSuccess }), {
      wrapper,
    });

    act(() => result.current.setInputText("chicken breast"));
    act(() => result.current.handleTextSubmit());

    await waitFor(() => expect(result.current.parsedItems).toHaveLength(1));

    act(() => result.current.submitLog());

    await waitFor(() => expect(onLogSuccess).toHaveBeenCalledOnce());
    expect(onLogSuccess).toHaveBeenCalledWith({
      itemCount: 1,
      totalCalories: 320,
      firstName: "chicken",
    });
    expect(result.current.parsedItems).toHaveLength(0);
    expect(result.current.inputText).toBe("");
  });

  it("sets submitError when log fails", async () => {
    const { wrapper } = createQueryWrapper();
    mockApiRequest
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            items: [
              {
                name: "eggs",
                quantity: 1,
                unit: "large",
                calories: 72,
                protein: 6,
                carbs: 0,
                fat: 5,
                servingSize: null,
              },
            ],
          }),
      })
      .mockRejectedValueOnce(new Error("server error"));

    const { result } = renderHook(() => useQuickLogSession(), { wrapper });

    act(() => result.current.setInputText("egg"));
    act(() => result.current.handleTextSubmit());
    await waitFor(() => expect(result.current.parsedItems).toHaveLength(1));

    act(() => result.current.submitLog());

    await waitFor(() => expect(result.current.submitError).not.toBeNull());
  });

  it("reset clears inputText, parsedItems, and errors", async () => {
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useQuickLogSession(), { wrapper });

    act(() => result.current.setInputText("some food"));

    act(() => result.current.reset());

    expect(result.current.inputText).toBe("");
    expect(result.current.parsedItems).toHaveLength(0);
    expect(result.current.parseError).toBeNull();
    expect(result.current.submitError).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests — expect all to fail**

```bash
npm run test:run -- client/hooks/__tests__/useQuickLogSession.test.ts
```

Expected: all tests fail with "Cannot find module '../useQuickLogSession'".

- [ ] **Step 3: Create the hook**

Create `client/hooks/useQuickLogSession.ts`:

```ts
import { useState, useCallback, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useHaptics } from "@/hooks/useHaptics";
import { useSpeechToText } from "@/hooks/useSpeechToText";
import { useParseFoodText, type ParsedFoodItem } from "@/hooks/useFoodParse";
import { apiRequest } from "@/lib/query-client";
import { QUERY_KEYS } from "@/lib/query-keys";

export type { ParsedFoodItem };

export interface LogSummary {
  itemCount: number;
  totalCalories: number;
  firstName: string;
}

interface UseQuickLogSessionOptions {
  onLogSuccess?: (summary: LogSummary) => void;
}

export function useQuickLogSession({
  onLogSuccess,
}: UseQuickLogSessionOptions = {}) {
  const queryClient = useQueryClient();
  const haptics = useHaptics();

  const [inputText, setInputText] = useState("");
  const [parsedItems, setParsedItems] = useState<ParsedFoodItem[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    isListening,
    transcript,
    isFinal,
    volume,
    error: speechError,
    startListening,
    stopListening,
  } = useSpeechToText();

  const { mutate: parseFoodTextMutate, isPending: isParsing } =
    useParseFoodText();

  const { data: frequentItems } = useQuery({
    queryKey: QUERY_KEYS.frequentItems,
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        "/api/scanned-items/frequent?limit=5",
      );
      const data = (await res.json()) as { items: { productName: string }[] };
      return data.items;
    },
    staleTime: 5 * 60 * 1000,
  });

  // Stream transcript into text input while listening
  useEffect(() => {
    if (isListening && transcript) {
      setInputText(transcript);
    }
  }, [isListening, transcript]);

  // Auto-trigger parse when recognition produces a final result
  useEffect(() => {
    if (isFinal && transcript && !isParsing) {
      setInputText(transcript);
      setParseError(null);
      parseFoodTextMutate(transcript, {
        onSuccess: (data) => {
          setParsedItems(data.items);
          haptics.notification(Haptics.NotificationFeedbackType.Success);
        },
        onError: () => {
          haptics.notification(Haptics.NotificationFeedbackType.Error);
          setParseError("Failed to parse food text. Please try again.");
        },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFinal, transcript]);

  const handleTextSubmit = useCallback(() => {
    if (!inputText.trim()) return;
    setParseError(null);
    haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    parseFoodTextMutate(inputText.trim(), {
      onSuccess: (data) => {
        setParsedItems(data.items);
        haptics.notification(Haptics.NotificationFeedbackType.Success);
      },
      onError: () => {
        haptics.notification(Haptics.NotificationFeedbackType.Error);
        setParseError("Failed to parse food text. Please try again.");
      },
    });
  }, [inputText, haptics, parseFoodTextMutate]);

  const handleVoicePress = useCallback(() => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening, haptics]);

  const removeItem = useCallback((index: number) => {
    setParsedItems((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleChipPress = useCallback(
    (text: string) => {
      setInputText(text);
      haptics.impact(Haptics.ImpactFeedbackStyle.Light);
    },
    [haptics],
  );

  const logAllMutation = useMutation({
    mutationFn: async (items: ParsedFoodItem[]) => {
      const results = [];
      for (const item of items) {
        const res = await apiRequest("POST", "/api/scanned-items", {
          productName: `${item.quantity} ${item.unit} ${item.name}`,
          sourceType: "voice",
          calories: item.calories?.toString(),
          protein: item.protein?.toString(),
          carbs: item.carbs?.toString(),
          fat: item.fat?.toString(),
          servingSize: item.servingSize,
        });
        results.push(await res.json());
      }
      return results;
    },
    onSuccess: (_data, items) => {
      const summary: LogSummary = {
        itemCount: items.length,
        totalCalories: items.reduce(
          (sum, item) => sum + (item.calories ?? 0),
          0,
        ),
        firstName: items[0]?.name ?? "Food",
      };
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dailySummary });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.scannedItems });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.frequentItems });
      haptics.notification(Haptics.NotificationFeedbackType.Success);
      setParsedItems([]);
      setInputText("");
      setSubmitError(null);
      onLogSuccess?.(summary);
    },
    onError: () => {
      haptics.notification(Haptics.NotificationFeedbackType.Error);
      setSubmitError("Failed to log some items. Please try again.");
    },
  });

  const submitLog = useCallback(() => {
    if (parsedItems.length === 0) return;
    haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    logAllMutation.mutate(parsedItems);
  }, [parsedItems, haptics, logAllMutation]);

  const reset = useCallback(() => {
    setInputText("");
    setParsedItems([]);
    setParseError(null);
    setSubmitError(null);
  }, []);

  return {
    inputText,
    setInputText,
    isListening,
    volume,
    isParsing,
    parsedItems,
    frequentItems,
    parseError,
    submitError,
    isSubmitting: logAllMutation.isPending,
    speechError,
    handleTextSubmit,
    handleVoicePress,
    removeItem,
    handleChipPress,
    submitLog,
    reset,
  };
}
```

- [ ] **Step 4: Run tests — expect all to pass**

```bash
npm run test:run -- client/hooks/__tests__/useQuickLogSession.test.ts
```

Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add client/hooks/useQuickLogSession.ts client/hooks/__tests__/useQuickLogSession.test.ts
git commit -m "feat: add useQuickLogSession hook extracted from QuickLogScreen"
```

---

## Task 2: Refactor `QuickLogScreen` to use `useQuickLogSession`

**Files:**

- Modify: `client/screens/QuickLogScreen.tsx`

- [ ] **Step 1: Replace inline logic with the hook**

In `client/screens/QuickLogScreen.tsx`, replace the imports and state/logic block (lines 20–238) as follows.

Replace the top of the file (imports through the end of `handleLogAll`). The screen keeps `showCheckmark`, `handleCameraPress` (needs navigation), and the accessibility announcement — these are screen-specific.

New `QuickLogScreen.tsx`:

```tsx
import React, { useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  ScrollView,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  AccessibilityInfo,
  InteractionManager,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { ThemedText } from "@/components/ThemedText";
import { Card } from "@/components/Card";
import { VoiceLogButton } from "@/components/VoiceLogButton";
import { ParsedFoodPreview } from "@/components/ParsedFoodPreview";
import { AdaptiveGoalCard } from "@/components/AdaptiveGoalCard";
import { AnimatedCheckmark } from "@/components/AnimatedCheckmark";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useToast } from "@/context/ToastContext";
import { useQuickLogSession } from "@/hooks/useQuickLogSession";
import { usePremiumContext } from "@/context/PremiumContext";
import { useAdaptiveGoals } from "@/hooks/useAdaptiveGoals";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";

const QUICK_LOG_TIPS = [
  { text: "Did you have a beverage with your meal?", icon: "coffee" as const },
  { text: "Snap a pic to log it!", icon: "camera" as const },
  { text: "Try voice input — tap the mic and speak", icon: "mic" as const },
  { text: "Don’t forget condiments and sauces", icon: "droplet" as const },
  { text: "You can log multiple items at once", icon: "list" as const },
];

function randomTip() {
  return QUICK_LOG_TIPS[Math.floor(Math.random() * QUICK_LOG_TIPS.length)];
}

const EXAMPLE_ITEMS = [
  "2 eggs and toast with butter",
  "chicken salad with ranch dressing",
  "a bowl of oatmeal with blueberries",
  "grande latte and a banana",
];

export default function QuickLogScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const toast = useToast();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { isPremium } = usePremiumContext();
  const { data: adaptiveGoalData } = useAdaptiveGoals(isPremium);
  const [tip] = useState(randomTip);
  const [showCheckmark, setShowCheckmark] = useState(false);

  const session = useQuickLogSession({
    onLogSuccess: () => {
      AccessibilityInfo.announceForAccessibility("Food items logged");
      setShowCheckmark(true);
    },
  });

  // Show speech errors as toasts (screen-specific concern)
  React.useEffect(() => {
    if (session.speechError) {
      haptics.notification(Haptics.NotificationFeedbackType.Error);
      toast.error(session.speechError);
    }
  }, [session.speechError, toast, haptics]);

  // Show parse/submit errors as toasts
  React.useEffect(() => {
    if (session.parseError) toast.error(session.parseError);
  }, [session.parseError, toast]);

  React.useEffect(() => {
    if (session.submitError) toast.error(session.submitError);
  }, [session.submitError, toast]);

  const handleCameraPress = useCallback(() => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
    navigation.goBack();
    InteractionManager.runAfterInteractions(() => {
      navigation.navigate("Scan");
    });
  }, [haptics, navigation]);

  const handleCheckmarkComplete = useCallback(() => {
    setShowCheckmark(false);
    navigation.goBack();
  }, [navigation]);

  const hasPreviousItems =
    session.frequentItems !== undefined && session.frequentItems.length > 0;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
        contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.xl }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <Card elevation={1} style={styles.inputCard}>
          <ThemedText
            type="caption"
            style={[styles.hint, { color: theme.textSecondary }]}
          >
            Type or speak what you ate
          </ThemedText>
          <View style={styles.inputRow}>
            <TextInput
              style={[
                styles.textInput,
                {
                  backgroundColor: theme.backgroundSecondary,
                  color: theme.text,
                  borderColor: theme.border,
                },
              ]}
              placeholder={
                session.isListening
                  ? "Listening..."
                  : "e.g., 2 eggs and toast with butter"
              }
              placeholderTextColor={theme.textSecondary}
              value={session.inputText}
              onChangeText={session.setInputText}
              onSubmitEditing={session.handleTextSubmit}
              returnKeyType="search"
              multiline
              accessibilityLabel="Food description"
            />
          </View>
          <View style={styles.actionRow}>
            <Pressable
              onPress={handleCameraPress}
              accessibilityLabel="Take a photo to log food"
              accessibilityHint="Closes quick log and opens the camera"
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.cameraButton,
                {
                  backgroundColor: "transparent",
                  borderWidth: 1.5,
                  borderColor: theme.border,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Feather name="camera" size={22} color={theme.textSecondary} />
            </Pressable>
            <Pressable
              onPress={session.handleTextSubmit}
              disabled={session.isParsing || !session.inputText.trim()}
              accessibilityLabel="Parse food text"
              accessibilityRole="button"
              accessibilityState={{
                disabled: session.isParsing || !session.inputText.trim(),
                busy: session.isParsing,
              }}
              style={({ pressed }) => [
                styles.parseButton,
                {
                  backgroundColor: theme.link,
                  opacity:
                    pressed || session.isParsing || !session.inputText.trim()
                      ? 0.6
                      : 1,
                },
              ]}
            >
              {session.isParsing ? (
                <ActivityIndicator size="small" color={theme.buttonText} />
              ) : (
                <>
                  <Feather name="search" size={18} color={theme.buttonText} />
                  <ThemedText
                    style={[
                      styles.parseButtonText,
                      { color: theme.buttonText },
                    ]}
                  >
                    Parse
                  </ThemedText>
                </>
              )}
            </Pressable>
            {isPremium && (
              <VoiceLogButton
                isListening={session.isListening}
                volume={session.volume}
                onPress={session.handleVoicePress}
                disabled={session.isParsing}
              />
            )}
          </View>
        </Card>

        {adaptiveGoalData?.hasRecommendation &&
          adaptiveGoalData.recommendation && (
            <AdaptiveGoalCard
              recommendation={adaptiveGoalData.recommendation}
            />
          )}

        <ParsedFoodPreview
          items={session.parsedItems}
          onRemoveItem={session.removeItem}
          onLogAll={session.submitLog}
          isLogging={session.isSubmitting}
        />

        {session.parsedItems.length === 0 && !session.isParsing && (
          <View style={styles.helpSection}>
            <ThemedText
              type="caption"
              accessibilityRole="header"
              style={[styles.helpText, { color: theme.textSecondary }]}
            >
              {hasPreviousItems ? "Previous Items:" : "Examples:"}
            </ThemedText>
            {(hasPreviousItems
              ? (session.frequentItems ?? []).map((item) => ({
                  key: item.productName,
                  label: item.productName,
                  a11yPrefix: "Use previous item",
                }))
              : EXAMPLE_ITEMS.map((example) => ({
                  key: example,
                  label: example,
                  a11yPrefix: "Use example",
                }))
            ).map(({ key, label, a11yPrefix }) => (
              <Pressable
                key={key}
                onPress={() => session.handleChipPress(label)}
                accessibilityLabel={`${a11yPrefix}: ${label}`}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.exampleChip,
                  {
                    backgroundColor: theme.backgroundSecondary,
                    borderLeftWidth: 3,
                    borderLeftColor: withOpacity(theme.link, 0.4),
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <ThemedText style={[styles.exampleText, { color: theme.text }]}>
                  {label}
                </ThemedText>
              </Pressable>
            ))}

            <View
              style={[
                styles.tipCard,
                {
                  backgroundColor: theme.backgroundSecondary,
                  borderColor: theme.border,
                },
              ]}
              accessible={true}
              accessibilityLabel={tip.text}
            >
              <Feather
                name={tip.icon}
                size={20}
                color={theme.textSecondary}
                style={styles.tipIcon}
              />
              <ThemedText
                style={[styles.tipText, { color: theme.textSecondary }]}
                numberOfLines={2}
              >
                {tip.text}
              </ThemedText>
            </View>
          </View>
        )}
      </ScrollView>
      {showCheckmark && (
        <View style={styles.checkmarkOverlay} pointerEvents="none">
          <AnimatedCheckmark
            visible={showCheckmark}
            size={64}
            onComplete={handleCheckmarkComplete}
          />
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inputCard: { margin: Spacing.lg, marginTop: 80, marginBottom: Spacing.sm },
  hint: { marginBottom: Spacing.md },
  inputRow: { marginBottom: Spacing.md },
  textInput: {
    minHeight: 60,
    borderRadius: BorderRadius.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: 16,
    fontFamily: FontFamily.regular,
    borderWidth: 1,
    textAlignVertical: "top",
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.md,
  },
  cameraButton: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.full,
    justifyContent: "center",
    alignItems: "center",
  },
  parseButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    height: 44,
    borderRadius: BorderRadius.xs,
  },
  parseButtonText: {
    fontSize: 16,
    fontFamily: FontFamily.medium,
    fontWeight: "500",
  },
  helpSection: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.xl },
  tipCard: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    marginTop: Spacing.lg,
  },
  tipIcon: { marginRight: Spacing.md },
  tipText: { flex: 1, fontSize: 14, fontFamily: FontFamily.medium },
  helpText: { marginBottom: Spacing.sm },
  exampleChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.xs,
    marginBottom: Spacing.sm,
  },
  exampleText: { fontSize: 14, fontFamily: FontFamily.regular },
  checkmarkOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
  },
});
```

- [ ] **Step 2: Run all tests to confirm no regression**

```bash
npm run test:run
```

Expected: all existing tests pass (QuickLogScreen has no unit tests of its own; the hook tests added in Task 1 still pass).

- [ ] **Step 3: Commit**

```bash
git add client/screens/QuickLogScreen.tsx
git commit -m "refactor: migrate QuickLogScreen to use useQuickLogSession hook"
```

---

## Task 3: Update `action-config.ts`

**Files:**

- Modify: `client/components/home/action-config.ts`

- [ ] **Step 1: Add `renderInline` to the interface, remove Voice Log, update Quick Log**

Replace `client/components/home/action-config.ts` with the following changes:

1. Add `renderInline?: boolean` to `HomeAction` interface (line 3–10):

```ts
export interface HomeAction {
  id: string;
  group: "scanning" | "nutrition" | "recipes" | "planning";
  icon: string;
  label: string;
  subtitle?: string;
  premium?: boolean;
  renderInline?: boolean;
}
```

2. Remove `case "voice-log"` from `navigateAction` (lines 42–44):

Delete these lines:

```ts
    case "voice-log":
      navigation.navigate("QuickLog");
      break;
```

3. Add `renderInline: true` to the quick-log action and remove the voice-log action entry from `HOME_ACTIONS`. The nutrition section becomes:

```ts
  // Nutrition & Health
  {
    id: "quick-log",
    group: "nutrition",
    icon: "edit-3",
    label: "Quick Log",
    renderInline: true,
  },
  {
    id: "fasting-timer",
    group: "nutrition",
    icon: "clock",
    label: "Fasting Timer",
  },
  {
    id: "log-weight",
    group: "nutrition",
    icon: "trending-down",
    label: "Log Weight",
  },
  {
    id: "ai-coach",
    group: "nutrition",
    icon: "message-circle",
    label: "AI Coach",
  },
```

- [ ] **Step 2: Run all tests**

```bash
npm run test:run
```

Expected: all tests pass. The `getActionsByGroup("nutrition")` now returns 4 actions instead of 5 (Voice Log removed).

- [ ] **Step 3: Commit**

```bash
git add client/components/home/action-config.ts
git commit -m "feat: add renderInline flag to HomeAction, remove voice-log entry"
```

---

## Task 4: Build `QuickLogDrawer` component

**Files:**

- Create: `client/components/home/QuickLogDrawer.tsx`
- Create: `client/components/home/__tests__/QuickLogDrawer.test.tsx`

- [ ] **Step 1: Write failing render tests**

Create `client/components/home/__tests__/QuickLogDrawer.test.tsx`:

```tsx
// @vitest-environment jsdom
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { QuickLogDrawer } from "../QuickLogDrawer";

// Mock the hook so we test rendering, not hook logic
const mockSession = {
  inputText: "",
  setInputText: vi.fn(),
  isListening: false,
  volume: -2,
  isParsing: false,
  parsedItems: [],
  frequentItems: [{ productName: "Coffee" }, { productName: "Eggs" }],
  parseError: null,
  submitError: null,
  isSubmitting: false,
  speechError: null,
  handleTextSubmit: vi.fn(),
  handleVoicePress: vi.fn(),
  removeItem: vi.fn(),
  handleChipPress: vi.fn(),
  submitLog: vi.fn(),
  reset: vi.fn(),
};

vi.mock("@/hooks/useQuickLogSession", () => ({
  useQuickLogSession: vi.fn(() => mockSession),
}));

vi.mock("@/hooks/useTheme", () => ({
  useTheme: () => ({
    theme: {
      text: "#000",
      textSecondary: "#666",
      backgroundRoot: "#fff",
      backgroundSecondary: "#f5f5f5",
      border: "#e0e0e0",
      link: "#007AFF",
      buttonText: "#fff",
      error: "#ff3b30",
    },
  }),
}));

vi.mock("@/hooks/useAccessibility", () => ({
  useAccessibility: () => ({ reducedMotion: false }),
}));

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({ impact: vi.fn(), notification: vi.fn() }),
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: vi.fn() }),
}));

vi.mock("@/hooks/usePremiumFeatures", () => ({
  usePremiumFeatures: () => ({ isPremium: true }),
}));

const testAction = {
  id: "quick-log",
  group: "nutrition" as const,
  icon: "edit-3",
  label: "Quick Log",
  renderInline: true,
};

describe("QuickLogDrawer", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders collapsed by default — drawer body not visible", () => {
    render(<QuickLogDrawer action={testAction} />);
    expect(screen.getByRole("button", { name: /quick log/i })).toBeTruthy();
    expect(screen.queryByPlaceholderText(/what did you eat/i)).toBeNull();
  });

  it("shows input and chips after tapping header", () => {
    render(<QuickLogDrawer action={testAction} />);
    fireEvent.press(screen.getByRole("button", { name: /quick log/i }));
    expect(screen.getByPlaceholderText(/what did you eat/i)).toBeTruthy();
    expect(screen.getByText("Coffee")).toBeTruthy();
    expect(screen.getByText("Eggs")).toBeTruthy();
  });

  it("shows parsed items and Log All when parsedItems is non-empty", () => {
    const { useQuickLogSession } = require("@/hooks/useQuickLogSession");
    useQuickLogSession.mockReturnValue({
      ...mockSession,
      parsedItems: [
        {
          name: "chicken",
          quantity: 1,
          unit: "breast",
          calories: 320,
          protein: 58,
          carbs: 0,
          fat: 7,
          servingSize: null,
        },
      ],
    });

    render(<QuickLogDrawer action={testAction} />);
    fireEvent.press(screen.getByRole("button", { name: /quick log/i }));

    expect(screen.getByText(/chicken/i)).toBeTruthy();
    expect(screen.getByText("320 cal")).toBeTruthy();
    expect(screen.getByRole("button", { name: /log all/i })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests — expect all to fail**

```bash
npm run test:run -- client/components/home/__tests__/QuickLogDrawer.test.tsx
```

Expected: all 3 tests fail with "Cannot find module '../QuickLogDrawer'".

- [ ] **Step 3: Create the component**

Create `client/components/home/QuickLogDrawer.tsx`:

```tsx
import React, { useState, useCallback } from "react";
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  ActivityIndicator,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from "react-native-reanimated";
import { useNavigation } from "@react-navigation/native";
import * as Haptics from "expo-haptics";

import { ThemedText } from "@/components/ThemedText";
import { VoiceLogButton } from "@/components/VoiceLogButton";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useToast } from "@/context/ToastContext";
import { useCollapsibleHeight } from "@/hooks/useCollapsibleHeight";
import { useQuickLogSession } from "@/hooks/useQuickLogSession";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import {
  expandTimingConfig,
  collapseTimingConfig,
} from "@/constants/animations";
import type { HomeAction } from "./action-config";
import type { HomeScreenNavigationProp } from "@/types/navigation";

interface QuickLogDrawerProps {
  action: HomeAction;
}

export function QuickLogDrawer({ action }: QuickLogDrawerProps) {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const toast = useToast();
  const navigation = useNavigation<HomeScreenNavigationProp>();
  const { reducedMotion } = useAccessibility();

  const [isOpen, setIsOpen] = useState(false);
  const chevronRotation = useSharedValue(-90);
  const { animatedStyle, onContentLayout } = useCollapsibleHeight(
    isOpen,
    reducedMotion,
  );

  const session = useQuickLogSession({
    onLogSuccess: ({ firstName, totalCalories }) => {
      setIsOpen(false);
      const label =
        totalCalories > 0 ? `${firstName} · ${totalCalories} cal` : firstName;
      toast.success(`Logged! ${label}`);
    },
  });

  const handleToggle = useCallback(() => {
    const next = !isOpen;
    if (!next) session.reset();
    setIsOpen(next);
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
    chevronRotation.value = reducedMotion
      ? next
        ? 0
        : -90
      : withTiming(
          next ? 0 : -90,
          next ? expandTimingConfig : collapseTimingConfig,
        );
  }, [isOpen, session, haptics, chevronRotation, reducedMotion]);

  const handleCameraPress = useCallback(() => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
    navigation.navigate("Scan", { returnAfterLog: true });
  }, [haptics, navigation]);

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${chevronRotation.value}deg` }],
  }));

  const totalCalories = session.parsedItems.reduce(
    (sum, item) => sum + (item.calories ?? 0),
    0,
  );
  const hasParsedItems = session.parsedItems.length > 0;

  return (
    <View>
      {/* Header row — same layout as ActionRow */}
      <Pressable
        onPress={handleToggle}
        style={styles.header}
        accessibilityRole="button"
        accessibilityLabel={action.label}
        accessibilityState={{ expanded: isOpen }}
        accessibilityHint={`Double tap to ${isOpen ? "collapse" : "expand"} quick log`}
      >
        <View
          style={[
            styles.iconCircle,
            { backgroundColor: withOpacity(theme.link, 0.1) },
          ]}
        >
          <Feather
            name={action.icon as keyof typeof Feather.glyphMap}
            size={18}
            color={theme.link}
            accessible={false}
          />
        </View>
        <ThemedText type="body" style={styles.label}>
          {action.label}
        </ThemedText>
        <Animated.View style={chevronStyle}>
          <Feather
            name="chevron-down"
            size={16}
            color={theme.textSecondary}
            accessible={false}
          />
        </Animated.View>
      </Pressable>

      {/* Animated drawer body */}
      <Animated.View style={[animatedStyle, styles.clipContainer]}>
        <View
          style={[
            styles.drawerBody,
            { backgroundColor: withOpacity(theme.link, 0.04) },
          ]}
          onLayout={onContentLayout}
        >
          {/* Text input row */}
          <View
            style={[
              styles.inputRow,
              {
                backgroundColor: theme.backgroundSecondary,
                borderColor: theme.border,
              },
            ]}
          >
            <TextInput
              style={[styles.textInput, { color: theme.text }]}
              placeholder="What did you eat?"
              placeholderTextColor={theme.textSecondary}
              value={session.inputText}
              onChangeText={session.setInputText}
              onSubmitEditing={session.handleTextSubmit}
              returnKeyType="search"
              accessibilityLabel="Food description"
            />
            <VoiceLogButton
              isListening={session.isListening}
              volume={session.volume}
              onPress={session.handleVoicePress}
              disabled={session.isParsing}
            />
            <Pressable
              onPress={handleCameraPress}
              accessibilityLabel="Open camera to scan food"
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.iconButton,
                {
                  borderColor: theme.border,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Feather name="camera" size={20} color={theme.textSecondary} />
            </Pressable>
          </View>

          {/* Parse error */}
          {session.parseError && (
            <ThemedText
              style={[styles.errorText, { color: theme.error }]}
              accessibilityLiveRegion="polite"
            >
              {session.parseError}
            </ThemedText>
          )}

          {/* Frequent chips — only when no parsed items */}
          {!hasParsedItems &&
            session.frequentItems &&
            session.frequentItems.length > 0 && (
              <View style={styles.chipsRow}>
                {session.frequentItems.map((item) => (
                  <Pressable
                    key={item.productName}
                    onPress={() => session.handleChipPress(item.productName)}
                    style={({ pressed }) => [
                      styles.chip,
                      {
                        backgroundColor: theme.backgroundSecondary,
                        borderColor: theme.border,
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                    accessibilityLabel={`Use ${item.productName}`}
                    accessibilityRole="button"
                  >
                    <ThemedText
                      style={[styles.chipText, { color: theme.textSecondary }]}
                      numberOfLines={1}
                    >
                      {item.productName}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>
            )}

          {/* Parsed items */}
          {hasParsedItems && (
            <View style={styles.parsedSection}>
              {session.parsedItems.map((item, index) => (
                <View
                  key={`${item.name}-${index}`}
                  style={[
                    styles.parsedItemRow,
                    { borderBottomColor: theme.border },
                  ]}
                >
                  <ThemedText
                    style={[styles.parsedItemName, { color: theme.text }]}
                    numberOfLines={1}
                  >
                    {item.quantity} {item.unit} {item.name}
                  </ThemedText>
                  <View style={styles.parsedItemRight}>
                    {item.calories !== null && (
                      <ThemedText
                        style={[
                          styles.parsedItemCal,
                          { color: theme.textSecondary },
                        ]}
                      >
                        {item.calories} cal
                      </ThemedText>
                    )}
                    <Pressable
                      onPress={() => session.removeItem(index)}
                      accessibilityLabel={`Remove ${item.name}`}
                      accessibilityRole="button"
                      style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
                    >
                      <Feather name="x" size={14} color={theme.textSecondary} />
                    </Pressable>
                  </View>
                </View>
              ))}

              {/* Footer: total + Log All */}
              <View style={styles.parsedFooter}>
                <ThemedText style={[styles.totalText, { color: theme.link }]}>
                  {totalCalories} cal total
                </ThemedText>
                <Pressable
                  onPress={session.submitLog}
                  disabled={session.isSubmitting}
                  accessibilityLabel="Log all items"
                  accessibilityRole="button"
                  accessibilityState={{ busy: session.isSubmitting }}
                  style={({ pressed }) => [
                    styles.logAllButton,
                    {
                      backgroundColor: theme.link,
                      opacity: pressed || session.isSubmitting ? 0.7 : 1,
                    },
                  ]}
                >
                  {session.isSubmitting ? (
                    <ActivityIndicator size="small" color={theme.buttonText} />
                  ) : (
                    <ThemedText
                      style={[styles.logAllText, { color: theme.buttonText }]}
                    >
                      Log All
                    </ThemedText>
                  )}
                </Pressable>
              </View>

              {session.submitError && (
                <ThemedText
                  style={[styles.errorText, { color: theme.error }]}
                  accessibilityLiveRegion="polite"
                >
                  {session.submitError}
                </ThemedText>
              )}
            </View>
          )}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    minHeight: 48,
    gap: Spacing.md,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  label: { flex: 1 },
  clipContainer: { overflow: "hidden" },
  drawerBody: {
    position: "absolute",
    width: "100%",
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
    paddingTop: Spacing.sm,
    gap: Spacing.sm,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: BorderRadius.xs,
    borderWidth: 1,
    paddingHorizontal: Spacing.sm,
    gap: Spacing.xs,
  },
  textInput: {
    flex: 1,
    height: 40,
    fontSize: 14,
    fontFamily: FontFamily.regular,
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.xs,
  },
  chip: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    maxWidth: 120,
  },
  chipText: {
    fontSize: 12,
    fontFamily: FontFamily.regular,
  },
  parsedSection: { gap: 2 },
  parsedItemRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: Spacing.sm,
  },
  parsedItemName: {
    flex: 1,
    fontSize: 13,
    fontFamily: FontFamily.regular,
  },
  parsedItemRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  parsedItemCal: {
    fontSize: 12,
    fontFamily: FontFamily.regular,
  },
  parsedFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: Spacing.xs,
  },
  totalText: {
    fontSize: 13,
    fontFamily: FontFamily.medium,
  },
  logAllButton: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.xs,
    minWidth: 72,
    alignItems: "center",
  },
  logAllText: {
    fontSize: 13,
    fontFamily: FontFamily.medium,
    fontWeight: "600",
  },
  errorText: {
    fontSize: 12,
    fontFamily: FontFamily.regular,
  },
});
```

- [ ] **Step 4: Run tests — expect all to pass**

```bash
npm run test:run -- client/components/home/__tests__/QuickLogDrawer.test.tsx
```

Expected: all 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add client/components/home/QuickLogDrawer.tsx client/components/home/__tests__/QuickLogDrawer.test.tsx
git commit -m "feat: add QuickLogDrawer inline expandable component"
```

---

## Task 5: Wire `QuickLogDrawer` into `HomeScreen`

**Files:**

- Modify: `client/screens/HomeScreen.tsx`

- [ ] **Step 1: Import and render `QuickLogDrawer` for `renderInline` actions**

In `client/screens/HomeScreen.tsx`:

Add import at line 17 (after `ActionRow` import):

```tsx
import { QuickLogDrawer } from "@/components/home/QuickLogDrawer";
```

Replace the `getActionsByGroup(key).map(...)` block inside `CollapsibleSection` (lines 188–197):

```tsx
{
  getActionsByGroup(key).map((action) =>
    action.renderInline ? (
      <QuickLogDrawer key={action.id} action={action} />
    ) : (
      <ActionRow
        key={action.id}
        icon={action.icon}
        label={action.label}
        subtitle={action.subtitle}
        onPress={() => handleActionPress(action)}
        isLocked={action.premium && !isPremium}
      />
    ),
  );
}
```

- [ ] **Step 2: Run all tests**

```bash
npm run test:run
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add client/screens/HomeScreen.tsx
git commit -m "feat: render QuickLogDrawer inline in Home Nutrition section"
```

---

## Task 6: Add `returnAfterLog` to Scan flow

**Files:**

- Modify: `client/navigation/RootStackNavigator.tsx` (line 58)
- Modify: `client/screens/ScanScreen.tsx`

- [ ] **Step 1: Add `returnAfterLog` to `RootStackParamList`**

In `client/navigation/RootStackNavigator.tsx`, update the `Scan` param type (line 58):

```ts
Scan:
  | { mode?: "label" | "front-label"; verifyBarcode?: string; returnAfterLog?: boolean }
  | undefined;
```

- [ ] **Step 2: Add confirm overlay state and logic to `ScanScreen`**

At the top of `ScanScreen.tsx`, add new imports after existing imports:

```tsx
import { useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { useToast } from "@/context/ToastContext";
```

Inside the `ScanScreen` function body, add after the existing state declarations:

```tsx
const route = useRoute<RouteProp<RootStackParamList, "Scan">>();
const returnAfterLog = route.params?.returnAfterLog ?? false;
const toast = useToast();

const [confirmCard, setConfirmCard] = useState<{
  barcode: string;
  name: string;
  calories: number | null;
  isLoading: boolean;
  isLogging: boolean;
} | null>(null);
```

- [ ] **Step 3: Intercept SESSION_COMPLETE when `returnAfterLog` is true**

Find the existing `useEffect` that handles `SESSION_COMPLETE` (starts at line ~139). Replace it with:

```tsx
// Navigate to NutritionDetail when session is complete — fire exactly once per session.
// When returnAfterLog is true, show a confirm card instead.
useEffect(() => {
  if (scanPhase.type !== "SESSION_COMPLETE") {
    sessionNavigatedRef.current = false;
    return;
  }
  if (sessionNavigatedRef.current) return;
  sessionNavigatedRef.current = true;

  if (!reducedMotion) {
    setShowConfetti(true);
  }

  const { barcode, nutritionImageUri, frontImageUri, ocrText } = scanPhase;

  if (returnAfterLog) {
    setConfirmCard({
      barcode,
      name: "Loading...",
      calories: null,
      isLoading: true,
      isLogging: false,
    });
    apiRequest("GET", `/api/nutrition/barcode/${barcode}`)
      .then((res) => res.json())
      .then((data: { productName?: string; calories?: number }) => {
        setConfirmCard({
          barcode,
          name: data.productName ?? "Food item",
          calories: data.calories ?? null,
          isLoading: false,
          isLogging: false,
        });
      })
      .catch(() => {
        setConfirmCard({
          barcode,
          name: "Food item",
          calories: null,
          isLoading: false,
          isLogging: false,
        });
      });
    return;
  }

  const timer = setTimeout(() => {
    refreshScanCount();
    navigation.navigate("NutritionDetail", {
      barcode,
      nutritionImageUri,
      frontLabelImageUri: frontImageUri,
      localOCRText: ocrText,
    });
  }, 700);
  return () => clearTimeout(timer);
}, [scanPhase, navigation, refreshScanCount, reducedMotion, returnAfterLog]);
```

- [ ] **Step 4: Add confirm card handlers**

Add these two handlers in `ScanScreen`, after the existing callbacks:

```tsx
const handleConfirmLog = useCallback(async () => {
  if (!confirmCard || confirmCard.isLogging) return;
  setConfirmCard((prev) => prev && { ...prev, isLogging: true });
  try {
    await apiRequest("POST", "/api/scanned-items", {
      productName: confirmCard.name,
      sourceType: "scan",
      calories: confirmCard.calories?.toString(),
    });
    refreshScanCount();
    toast.success(
      `Logged! ${confirmCard.name}${confirmCard.calories ? ` · ${confirmCard.calories} cal` : ""}`,
    );
    navigation.goBack();
  } catch {
    setConfirmCard((prev) => prev && { ...prev, isLogging: false });
    toast.error("Failed to log item. Please try again.");
  }
}, [confirmCard, navigation, toast, refreshScanCount]);

const handleConfirmDismiss = useCallback(() => {
  setConfirmCard(null);
  dispatch({ type: "RESET" });
}, []);
```

- [ ] **Step 5: Render the confirm overlay**

In the JSX return of `ScanScreen`, add the overlay just before the closing `</View>` of the outermost container. Place it after the confetti cannon rendering:

```tsx
{
  /* Confirm card overlay — shown when returnAfterLog and scan is complete */
}
{
  confirmCard && (
    <View
      style={[
        styles.confirmOverlay,
        { backgroundColor: withOpacity(theme.backgroundRoot, 0.95) },
      ]}
      accessibilityViewIsModal
    >
      {confirmCard.isLoading ? (
        <View style={styles.confirmLoadingRow}>
          <ActivityIndicator color={theme.link} />
          <ThemedText
            style={{ color: theme.textSecondary, marginLeft: Spacing.sm }}
          >
            Identifying food…
          </ThemedText>
        </View>
      ) : (
        <View
          style={[
            styles.confirmCard,
            {
              backgroundColor: theme.backgroundSecondary,
              borderColor: theme.border,
            },
          ]}
        >
          <View style={styles.confirmInfo}>
            <ThemedText
              type="body"
              style={{ color: theme.text, fontFamily: FontFamily.semiBold }}
              numberOfLines={2}
            >
              {confirmCard.name}
            </ThemedText>
            {confirmCard.calories !== null && (
              <ThemedText style={{ color: theme.link, fontSize: 14 }}>
                {confirmCard.calories} cal
              </ThemedText>
            )}
          </View>
          <View style={styles.confirmButtons}>
            <Pressable
              onPress={handleConfirmDismiss}
              style={({ pressed }) => [
                styles.confirmDismissButton,
                { borderColor: theme.border, opacity: pressed ? 0.7 : 1 },
              ]}
              accessibilityLabel="Dismiss"
              accessibilityRole="button"
            >
              <ThemedText style={{ color: theme.textSecondary, fontSize: 14 }}>
                Dismiss
              </ThemedText>
            </Pressable>
            <Pressable
              onPress={handleConfirmLog}
              disabled={confirmCard.isLogging}
              style={({ pressed }) => [
                styles.confirmLogButton,
                {
                  backgroundColor: theme.link,
                  opacity: pressed || confirmCard.isLogging ? 0.7 : 1,
                },
              ]}
              accessibilityLabel="Log it"
              accessibilityRole="button"
              accessibilityState={{ busy: confirmCard.isLogging }}
            >
              {confirmCard.isLogging ? (
                <ActivityIndicator size="small" color={theme.buttonText} />
              ) : (
                <ThemedText
                  style={{
                    color: theme.buttonText,
                    fontSize: 14,
                    fontFamily: FontFamily.medium,
                  }}
                >
                  ✓ Log It
                </ThemedText>
              )}
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}
```

Add styles for the overlay to the `StyleSheet.create` block in `ScanScreen.tsx`:

```ts
confirmOverlay: {
  position: "absolute",
  bottom: 0,
  left: 0,
  right: 0,
  paddingHorizontal: Spacing.lg,
  paddingBottom: Spacing.xl,
  paddingTop: Spacing.lg,
},
confirmLoadingRow: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
  padding: Spacing.lg,
},
confirmCard: {
  borderRadius: BorderRadius.card,
  borderWidth: 1,
  padding: Spacing.lg,
  gap: Spacing.md,
},
confirmInfo: {
  gap: 4,
},
confirmButtons: {
  flexDirection: "row",
  gap: Spacing.sm,
},
confirmDismissButton: {
  flex: 1,
  borderWidth: 1,
  borderRadius: BorderRadius.xs,
  paddingVertical: Spacing.sm,
  alignItems: "center",
},
confirmLogButton: {
  flex: 2,
  borderRadius: BorderRadius.xs,
  paddingVertical: Spacing.sm,
  alignItems: "center",
},
```

Add any missing imports to ScanScreen (check that `ActivityIndicator`, `withOpacity`, `FontFamily`, `Spacing`, `BorderRadius` are imported; add any that are missing).

- [ ] **Step 6: Run all tests**

```bash
npm run test:run
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add client/navigation/RootStackNavigator.tsx client/screens/ScanScreen.tsx
git commit -m "feat: add returnAfterLog confirm overlay to ScanScreen"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement                                               | Task                              |
| -------------------------------------------------------------- | --------------------------------- |
| Inline Quick Log drawer, slides out beneath row                | Task 4 + 5                        |
| Drawer: text input + mic + camera + frequent chips             | Task 4                            |
| Parsed items expand inline with Log All                        | Task 4                            |
| Toggle closed by tapping row                                   | Task 4                            |
| Auto-close after successful log + toast                        | Task 1 (`onLogSuccess`) + Task 4  |
| Voice Log removed from Nutrition & Health                      | Task 3                            |
| Voice accessible via mic in drawer                             | Task 4                            |
| Scan → progress/loading → confirm card → Log It → Home + toast | Task 6                            |
| Confirm card: name + calories                                  | Task 6                            |
| `useQuickLogSession` shared with QuickLogScreen                | Task 1 + 2                        |
| QuickLogScreen behaviour unchanged                             | Task 2                            |
| Deep link to QuickLog still works                              | Unchanged (modal route untouched) |

All spec requirements are covered. ✓
