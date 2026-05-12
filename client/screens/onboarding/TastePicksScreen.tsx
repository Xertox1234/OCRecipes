// client/screens/onboarding/TastePicksScreen.tsx
import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  StyleSheet,
  Pressable,
  Alert,
  AccessibilityInfo,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/ThemedText";
import { Button } from "@/components/Button";
import { TastePicksGrid } from "@/components/TastePicksGrid";
import { useTheme } from "@/hooks/useTheme";
import { useOnboarding } from "@/context/OnboardingContext";
import { useAuthContext } from "@/context/AuthContext";
import { apiRequest } from "@/lib/query-client";
import { Spacing, BorderRadius, withOpacity } from "@/constants/theme";
import { Feather } from "@expo/vector-icons";
import type { RecipeCandidate } from "@shared/types/taste-picks";
import { tastePickCandidatesResponseSchema } from "@shared/schemas/taste-picks";

const MIN_PICKS = 5;
const PAGE_LIMIT = 30;

export default function TastePicksScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { data, prevStep } = useOnboarding();
  const { updateUser } = useAuthContext();

  const [candidates, setCandidates] = useState<RecipeCandidate[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const loadCandidates = useCallback(
    async (pageNum: number) => {
      setLoadError(false);
      try {
        const params = new URLSearchParams({
          page: String(pageNum),
          limit: String(PAGE_LIMIT),
        });
        if (data.dietType) params.set("dietType", data.dietType);

        const res = await apiRequest(
          "GET",
          `/api/taste-picks/candidates?${params}`,
        );
        const json = await res.json();
        const parsed = tastePickCandidatesResponseSchema.safeParse(json);
        if (!parsed.success) {
          console.error("loadCandidates: invalid response shape", parsed.error);
          setLoadError(true);
          return;
        }
        const body = parsed.data;
        setCandidates((prev) =>
          pageNum === 1 ? body.candidates : [...prev, ...body.candidates],
        );
        setHasMore(body.candidates.length === PAGE_LIMIT);
      } catch (err) {
        console.error("loadCandidates failed:", err);
        setLoadError(true);
      }
    },
    [data.dietType],
  );

  useEffect(() => {
    loadCandidates(1);
  }, [loadCandidates]);

  const handleToggle = useCallback((recipeId: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(recipeId)) {
        next.delete(recipeId);
      } else {
        next.add(recipeId);
      }
      return next;
    });
  }, []);

  const handleEndReached = useCallback(() => {
    if (!hasMore) return;
    const nextPage = page + 1;
    setPage(nextPage);
    loadCandidates(nextPage);
  }, [hasMore, page, loadCandidates]);

  const handleRetry = useCallback(() => {
    setPage(1);
    setHasMore(true);
    loadCandidates(1);
  }, [loadCandidates]);

  const handleContinue = useCallback(async () => {
    setIsSubmitting(true);
    try {
      // 1. Persist profile (creates the profile row for write-through)
      await apiRequest("POST", "/api/user/dietary-profile", data);
      // 2. Save picks — triggers cuisinePreferences write-through
      if (selectedIds.size > 0) {
        await apiRequest("PUT", "/api/taste-picks", {
          recipeIds: [...selectedIds],
        });
      }
      // 3. Mark onboarding complete
      await updateUser({ onboardingCompleted: true });
    } catch (err) {
      console.error("handleContinue failed:", err);
      Alert.alert("Something went wrong", "Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }, [data, selectedIds, updateUser]);

  const handleSkip = useCallback(async () => {
    setIsSubmitting(true);
    try {
      await apiRequest("POST", "/api/user/dietary-profile", data);
      await updateUser({ onboardingCompleted: true });
    } catch (err) {
      console.error("handleSkip failed:", err);
      Alert.alert("Something went wrong", "Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }, [data, updateUser]);

  const isFirstRender = React.useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const msg =
      selectedIds.size >= MIN_PICKS
        ? `${selectedIds.size} selected. Minimum reached.`
        : `${selectedIds.size} of ${MIN_PICKS} selected.`;
    AccessibilityInfo.announceForAccessibility(msg);
  }, [selectedIds.size]);

  const canContinue = selectedIds.size >= MIN_PICKS;
  const chipActive = selectedIds.size >= MIN_PICKS;

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      <View style={styles.header}>
        <ThemedText type="h3" style={styles.title}>
          Pick recipes you love
        </ThemedText>
        <ThemedText
          type="body"
          style={[styles.subtitle, { color: theme.textSecondary }]}
        >
          We&apos;ll personalise your recommendations. Tap at least {MIN_PICKS}.
        </ThemedText>
        <View
          style={[
            styles.chip,
            {
              backgroundColor: chipActive
                ? theme.link
                : withOpacity(theme.link, 0.12),
            },
          ]}
        >
          <ThemedText
            type="small"
            style={{
              color: chipActive ? theme.buttonText : theme.link,
              fontWeight: "600",
            }}
          >
            {chipActive
              ? `${selectedIds.size} selected ✓`
              : `${selectedIds.size} of ${MIN_PICKS} selected`}
          </ThemedText>
        </View>
      </View>

      <View style={styles.grid}>
        {loadError ? (
          <View style={styles.errorContainer}>
            <ThemedText type="body" style={{ color: theme.textSecondary }}>
              Couldn&apos;t load recipes.
            </ThemedText>
            <Pressable
              onPress={handleRetry}
              accessibilityLabel="Retry loading recipes"
              accessibilityRole="button"
            >
              <ThemedText type="body" style={{ color: theme.link }}>
                Try again
              </ThemedText>
            </Pressable>
          </View>
        ) : (
          <TastePicksGrid
            candidates={candidates}
            selectedIds={selectedIds}
            onToggle={handleToggle}
            onEndReached={handleEndReached}
          />
        )}
      </View>

      <View
        style={[styles.footer, { paddingBottom: insets.bottom + Spacing.xl }]}
      >
        <View style={styles.footerButtons}>
          <Pressable
            onPress={prevStep}
            style={({ pressed }) => [
              styles.backButton,
              {
                backgroundColor: pressed
                  ? theme.backgroundTertiary
                  : theme.backgroundSecondary,
              },
            ]}
            accessibilityLabel="Go back"
            accessibilityRole="button"
          >
            <Feather name="arrow-left" size={24} color={theme.text} />
          </Pressable>
          <Button
            onPress={handleContinue}
            disabled={!canContinue || isSubmitting}
            accessibilityLabel={
              canContinue
                ? isSubmitting
                  ? "Saving..."
                  : "Continue"
                : `Select ${MIN_PICKS - selectedIds.size} more to continue`
            }
            style={styles.continueButton}
          >
            {isSubmitting ? "Saving..." : "Continue"}
          </Button>
        </View>
        <Pressable
          onPress={handleSkip}
          disabled={isSubmitting}
          accessibilityLabel="Skip for now"
          accessibilityRole="button"
          style={styles.skipButton}
        >
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            Skip for now
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing["2xl"],
    paddingBottom: Spacing.md,
    gap: Spacing.sm,
  },
  title: {},
  subtitle: { lineHeight: 22 },
  chip: {
    alignSelf: "flex-start",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.full,
  },
  grid: { flex: 1 },
  errorContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
  },
  footer: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
    gap: Spacing.sm,
  },
  footerButtons: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  backButton: {
    width: 52,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: BorderRadius.full,
  },
  continueButton: { flex: 1 },
  skipButton: {
    alignItems: "center",
    paddingVertical: Spacing.xs,
  },
});
