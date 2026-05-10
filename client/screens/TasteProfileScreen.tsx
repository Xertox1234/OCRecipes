// client/screens/TasteProfileScreen.tsx
import React, { useState, useCallback, useEffect } from "react";
import { View, StyleSheet, Pressable } from "react-native";

import { ThemedText } from "@/components/ThemedText";
import { Button } from "@/components/Button";
import { TastePicksGrid } from "@/components/TastePicksGrid";
import { useTheme } from "@/hooks/useTheme";
import { useNavigation } from "@react-navigation/native";
import { apiRequest } from "@/lib/query-client";
import { Spacing, BorderRadius, withOpacity } from "@/constants/theme";
import type { TasteProfileScreenNavigationProp } from "@/types/navigation";
import type { RecipeCandidate } from "@shared/types/taste-picks";

const PAGE_LIMIT = 30;

export default function TasteProfileScreen() {
  const { theme } = useTheme();
  const navigation = useNavigation<TasteProfileScreenNavigationProp>();

  const [candidates, setCandidates] = useState<RecipeCandidate[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    async function loadPicks() {
      const res = await apiRequest("GET", "/api/taste-picks");
      if (!res.ok) return;
      const body = await res.json();
      setSelectedIds(
        new Set(body.picks.map((p: { recipeId: number }) => p.recipeId)),
      );
    }
    loadPicks();
  }, []);

  const loadCandidates = useCallback(async (pageNum: number) => {
    setLoadError(false);
    const params = new URLSearchParams({
      page: String(pageNum),
      limit: String(PAGE_LIMIT),
    });
    const res = await apiRequest(
      "GET",
      `/api/taste-picks/candidates?${params}`,
    );
    if (!res.ok) {
      setLoadError(true);
      return;
    }
    const body = await res.json();
    setCandidates((prev) =>
      pageNum === 1 ? body.candidates : [...prev, ...body.candidates],
    );
    setHasMore(body.candidates.length === PAGE_LIMIT);
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
    loadCandidates(1);
  }, [loadCandidates]);

  const handleSave = useCallback(async () => {
    setIsSubmitting(true);
    try {
      await apiRequest("PUT", "/api/taste-picks", {
        recipeIds: [...selectedIds],
      });
      setIsDirty(false);
      navigation.goBack();
    } finally {
      setIsSubmitting(false);
    }
  }, [selectedIds, navigation]);

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

      <View style={styles.footer}>
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
    paddingBottom: Spacing.xl,
  },
});
