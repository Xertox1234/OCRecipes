// client/screens/TasteProfileScreen.tsx
import React, { useState, useCallback, useEffect } from "react";
import { View, StyleSheet, Pressable, AccessibilityInfo } from "react-native";

import { ThemedText } from "@/components/ThemedText";
import { Button } from "@/components/Button";
import { TastePicksGrid } from "@/components/TastePicksGrid";
import { useToast } from "@/context/ToastContext";
import { useTheme } from "@/hooks/useTheme";
import { useBottomBudget } from "@/hooks/useBottomBudget";
import { useHeaderContentInset } from "@/hooks/useHeaderContentInset";
import {
  useSaveTastePicks,
  useSavedTastePicks,
  useTastePickCandidates,
} from "@/hooks/useTastePicks";
import { useNavigation } from "@react-navigation/native";
import { logger } from "@/lib/logger";
import { Spacing, BorderRadius, withOpacity } from "@/constants/theme";
import type { TasteProfileScreenNavigationProp } from "@/types/navigation";

export default function TasteProfileScreen() {
  const { theme } = useTheme();
  const bottomBudget = useBottomBudget();
  const headerInset = useHeaderContentInset(Spacing.lg);
  const navigation = useNavigation<TasteProfileScreenNavigationProp>();
  const toast = useToast();

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isDirty, setIsDirty] = useState(false);

  const {
    data: savedPickIds,
    isError: picksError,
    refetch: refetchPicks,
  } = useSavedTastePicks();
  const {
    candidates,
    loadMore,
    isError: candidatesError,
    refetch: refetchCandidates,
  } = useTastePickCandidates();
  const { mutateAsync: savePicks, isPending: isSubmitting } =
    useSaveTastePicks();
  const loadError = picksError || candidatesError;

  // Fill the editable selection from the saved picks until the user's first
  // toggle, so a late-arriving (or refetched) list never overwrites an edit.
  useEffect(() => {
    if (!savedPickIds || isDirty) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrates the editable selection from the saved picks the query delivers, only while the user has not edited it
    setSelectedIds(new Set(savedPickIds));
  }, [savedPickIds, isDirty]);

  // Announce selection-count changes to screen readers — only for user
  // toggles. `handleToggle` arms this ref; the programmatic load of existing
  // picks (and the mount render) leave it false, so neither announces.
  const announceCountChange = React.useRef(false);
  useEffect(() => {
    if (!announceCountChange.current) return;
    announceCountChange.current = false;
    AccessibilityInfo.announceForAccessibility(`${selectedIds.size} selected`);
  }, [selectedIds.size]);

  // Announce the load-failure state so a screen-reader user focused elsewhere
  // learns the grid was replaced by the retry message.
  useEffect(() => {
    if (loadError) {
      AccessibilityInfo.announceForAccessibility(
        "Couldn't load recipes. Retry available.",
      );
    }
  }, [loadError]);

  const handleToggle = useCallback((recipeId: number) => {
    announceCountChange.current = true;
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

  const handleRetry = useCallback(() => {
    void refetchPicks();
    void refetchCandidates();
  }, [refetchPicks, refetchCandidates]);

  const handleSave = useCallback(async () => {
    try {
      // useSaveTastePicks refreshes the carousel's cuisine-match labels.
      await savePicks([...selectedIds]);
      setIsDirty(false);
      toast.success("Taste picks saved");
      navigation.goBack();
    } catch (err) {
      logger.error("handleSave failed:", err);
      // Picks stay selected (isDirty stays true) so the user can retry.
      toast.error("Couldn't save your picks. Please try again.");
    }
  }, [selectedIds, savePicks, navigation, toast]);

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      <View style={[styles.header, { paddingTop: headerInset }]}>
        <ThemedText type="body" style={{ color: theme.textSecondary }}>
          Recipes you love — used to personalize your feed.
        </ThemedText>
        <View
          style={[
            styles.chip,
            {
              backgroundColor:
                selectedIds.size > 0
                  ? theme.accentSolid
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
              style={styles.textLink}
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
            onEndReached={loadMore}
          />
        )}
      </View>

      <View
        style={[styles.footer, { paddingBottom: bottomBudget + Spacing.xl }]}
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
  // ≥44pt tap target for a text link (no hitSlop; see touch-targets tests).
  textLink: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  container: { flex: 1 },
  header: {
    paddingHorizontal: Spacing.xl,
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
