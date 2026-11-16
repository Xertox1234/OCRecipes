import React from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { Chip } from "@/components/Chip";
import { Spacing } from "@/constants/theme";
import { useHaptics } from "@/hooks/useHaptics";
import type { FamilyProfile } from "@shared/schema";

import type { AudienceFilter } from "./family-utils";

/**
 * "All · Me · {each name} · +" above the week grid. The filters are radios in
 * a radiogroup (Chip ticks the selection haptic for a selectable chip); the
 * "+" is a plain button that goes to the family profiles.
 */
export function AudienceFilterChips({
  profiles,
  filter,
  onChange,
  onAddProfile,
}: {
  profiles: FamilyProfile[];
  filter: AudienceFilter;
  onChange: (filter: AudienceFilter) => void;
  onAddProfile: () => void;
}) {
  const haptics = useHaptics();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.scroll}
      contentContainerStyle={styles.row}
    >
      <View
        style={styles.group}
        accessibilityRole="radiogroup"
        accessibilityLabel="Show meals for"
      >
        <Chip
          variant="filter"
          label="All"
          accessibilityRole="radio"
          selected={filter.kind === "all"}
          onPress={() => onChange({ kind: "all" })}
        />
        <Chip
          variant="filter"
          label="Me"
          accessibilityRole="radio"
          selected={filter.kind === "me"}
          onPress={() => onChange({ kind: "me" })}
        />
        {profiles.map((profile) => (
          <Chip
            key={profile.id}
            variant="filter"
            label={profile.name}
            accessibilityRole="radio"
            selected={
              filter.kind === "profile" && filter.profileId === profile.id
            }
            onPress={() => onChange({ kind: "profile", profileId: profile.id })}
          />
        ))}
      </View>
      <Chip
        variant="filter"
        label="+"
        accessibilityLabel="Add a family member"
        accessibilityRole="button"
        onPress={() => {
          haptics.selection();
          onAddProfile();
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 0,
    marginBottom: Spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  // The radiogroup inside the row: same layout, no second side padding.
  group: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
});
