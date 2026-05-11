// client/screens/TasteProfileScreen.tsx
import React, { useState, useCallback, useEffect } from "react";
import { View, StyleSheet, Pressable, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/ThemedText";
import { Button } from "@/components/Button";
import { TastePicksGrid } from "@/components/TastePicksGrid";
import { useQueryClient } from "@tanstack/react-query";
import { useTheme } from "@/hooks/useTheme";
import { useNavigation } from "@react-navigation/native";
import { apiRequest } from "@/lib/query-client";
import { Spacing, BorderRadius, withOpacity } from "@/constants/theme";
import type { TasteProfileScreenNavigationProp } from "@/types/navigation";
import type { RecipeCandidate } from "@shared/types/taste-picks";
import {
  tastePickCandidatesResponseSchema,
  tastePicksResponseSchema,
} from "@shared/schemas/taste-picks";

const PAGE_LIMIT = 30;

export default function TasteProfileScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<TasteProfileScreenNavigationProp>();
  const queryClient = useQueryClient();

  const [candidates, setCandidates] = useState<RecipeCandidate[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const loadPicks = useCallback(async () => {
    try {
      const res = await apiRequest("GET", "/api/taste-picks");
      if (!res.ok) {
        setLoadError(true);
        return;
      }
      const json = await res.json();
      const parsed = tastePicksResponseSchema.safeParse(json);
      if (!parsed.success) {
        console.error("loadPicks: invalid response shape", parsed.error);
        setLoadError(true);
        return;
      }
      setSelectedIds(new Set(parsed.data.picks.map((p) => p.recipeId)));
    } catch (err) {
      console.error("loadPicks failed:", err);
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    loadPicks();
  }, [loadPicks]);

  const loadCandidates = useCallback(async (pageNum: number) => {
    setLoadError(false);
    try {
      const params = new URLSearchParams({
        page: String(pageNum),
        limit: String(PAGE_LIMIT),
      });
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
  }, []);

  useEffect(() => {
    loadCandidates(1);
  }, [loadCandidates]);

  const handleToggle = useCallback((recipeId: number) => {
    setIsDirty(true);
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
    loadPicks();
    loadCandidates(1);
  }, [loadPicks, loadCandidates]);

  const handleSave = useCallback(async () => {
    setIsSubmitting(true);
    try {
      await apiRequest("PUT", "/api/taste-picks", {
        recipeIds: [...selectedIds],
      });
      // Cuisine preferences may have changed — invalidate the carousel cache
      // so the Home tab shows updated "Matches your cuisine preferences"
      // labels on return without requiring a manual pull-to-refresh.
      queryClient.invalidateQueries({ queryKey: ["/api/carousel"] });
      setIsDirty(false);
      navigation.goBack();
    } catch (err) {
      console.error("handleSave failed:", err);
      Alert.alert("Something went wrong", "Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }, [selectedIds, navigation, queryClient]);

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      <View style={styles.header}>
        <ThemedText type="body" style={{ color: theme.textSecondary }}>
          Recipes you love — used to personalise your feed.
        </ThemedText>
        <View
          style={[
            styles.chip,
            {
              backgroundColor:
                selectedIds.size > 0
                  ? theme.link
                  : withOpacity(theme.link, 0.12),
            },
          ]}
        >
          <ThemedText
            type="small"
            style={{
              color: selectedIds.size > 0 ? theme.buttonText : theme.link,
              fontWeight: "600",
            }}
          >
            {selectedIds.size} selected
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
        <Button
          onPress={handleSave}
          disabled={isSubmitting || !isDirty}
          accessibilityLabel={isSubmitting ? "Saving..." : "Save Changes"}
        >
          {isSubmitting ? "Saving..." : "Save Changes"}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.md,
    gap: Spacing.sm,
  },
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
  },
});
