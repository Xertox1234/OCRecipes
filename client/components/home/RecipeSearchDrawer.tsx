// client/components/home/RecipeSearchDrawer.tsx
import React, { useEffect, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useTrendingSearches } from "@/hooks/useTrendingSearches";
import {
  getRecentSearches,
  pushRecentSearch,
} from "@/lib/recent-recipe-searches-storage";
import {
  resolveTrendingSource,
  formatTermLabel,
} from "@/components/home/inline-drawer-utils";
import { TRENDING_FALLBACK_TERMS } from "@/components/home/trending-fallback";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import type { HomeScreenNavigationProp } from "@/types/navigation";

function Chip({ label, onPress }: { label: string; onPress: () => void }) {
  const { theme } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Search ${label}`}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: theme.backgroundSecondary,
          borderColor: theme.border,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <ThemedText
        style={[styles.chipText, { color: theme.textSecondary }]}
        numberOfLines={1}
      >
        {label}
      </ThemedText>
    </Pressable>
  );
}

interface RecipeSearchDrawerProps {
  isOpen: boolean;
  onUsed: () => void;
}

export function RecipeSearchDrawer({
  isOpen,
  onUsed,
}: RecipeSearchDrawerProps) {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const navigation = useNavigation<HomeScreenNavigationProp>();
  const [text, setText] = useState("");
  const [recent, setRecent] = useState<string[]>(getRecentSearches);

  // Refresh recent list whenever the drawer opens
  useEffect(() => {
    if (isOpen) {
      setRecent(getRecentSearches());
    } else {
      setText("");
    }
  }, [isOpen]);

  const trending = useTrendingSearches(isOpen);
  const resolved = resolveTrendingSource(
    {
      isLoading: trending.isLoading,
      isError: trending.isError,
      terms: trending.data?.terms,
    },
    TRENDING_FALLBACK_TERMS,
  );

  const runSearch = (query: string) => {
    const q = query.trim();
    if (!q) return;
    haptics.selection();
    void pushRecentSearch(q);
    onUsed();
    navigation.navigate("MealPlanTab", {
      screen: "RecipeBrowser",
      params: { searchQuery: q },
    });
  };

  return (
    <View style={styles.container}>
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
          style={[styles.input, { color: theme.text }]}
          placeholder="Search recipes…"
          placeholderTextColor={theme.textSecondary}
          value={text}
          onChangeText={setText}
          onSubmitEditing={() => runSearch(text)}
          returnKeyType="search"
          accessibilityLabel="Search recipes"
          // No auto-focus: keep chips/trending visible until the user taps in.
        />
      </View>

      {recent.length > 0 && (
        <View style={styles.section}>
          <ThemedText
            style={[styles.sectionLabel, { color: theme.textSecondary }]}
          >
            RECENT
          </ThemedText>
          <View style={styles.chipsWrap}>
            {recent.slice(0, 8).map((q) => (
              <Chip
                key={`recent-${q}`}
                label={q}
                onPress={() => runSearch(q)}
              />
            ))}
          </View>
        </View>
      )}

      <View style={styles.section}>
        <ThemedText
          style={[styles.sectionLabel, { color: theme.textSecondary }]}
        >
          TRENDING
        </ThemedText>
        {resolved.kind === "loading" ? (
          <View
            style={[
              styles.skeleton,
              { backgroundColor: withOpacity(theme.text, 0.06) },
            ]}
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel="Loading trending searches"
          />
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.carousel}
            keyboardShouldPersistTaps="handled"
          >
            {resolved.terms.map((term) => (
              <Chip
                key={`trending-${term}`}
                label={formatTermLabel(term)}
                onPress={() => runSearch(term)}
              />
            ))}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.sm },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: BorderRadius.xs,
    borderWidth: 1,
    paddingHorizontal: Spacing.sm,
  },
  input: { flex: 1, height: 40, fontSize: 14, fontFamily: FontFamily.regular },
  section: { gap: Spacing.xs },
  sectionLabel: {
    fontFamily: FontFamily.medium,
    fontSize: 12,
    letterSpacing: 0.5,
  },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
  carousel: { gap: Spacing.xs, paddingRight: Spacing.lg },
  skeleton: { height: 36, borderRadius: BorderRadius.full },
  chip: {
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    minHeight: 44,
    minWidth: 44,
    maxWidth: 160,
    justifyContent: "center",
  },
  chipText: { fontSize: 13, fontFamily: FontFamily.regular },
});
