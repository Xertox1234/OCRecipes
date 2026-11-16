import React from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { Chip } from "@/components/Chip";
import { SheetDragHandle } from "@/components/sheet/SheetChrome";
import { ThemedText } from "@/components/ThemedText";
import { FontFamily, Spacing } from "@/constants/theme";
import type { FamilyProfile } from "@shared/schema";
import type { MealAudience } from "@shared/types/family";

export interface AudienceChoiceValue {
  audience: MealAudience;
  familyProfileId: number | null;
}

/**
 * "Everyone · Just me · {each name}" — who a meal is for. A radiogroup of
 * chips (Chip ticks the selection haptic); the caller owns what a choice does.
 */
export function AudienceChoice({
  profiles,
  value,
  onChange,
}: {
  profiles: FamilyProfile[];
  value: AudienceChoiceValue;
  onChange: (choice: AudienceChoiceValue) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.scroll}
      contentContainerStyle={styles.row}
    >
      <View
        style={styles.row}
        accessibilityRole="radiogroup"
        accessibilityLabel="Who's it for?"
      >
        <Chip
          variant="filter"
          label="Everyone"
          accessibilityRole="radio"
          selected={value.audience === "shared"}
          onPress={() =>
            onChange({ audience: "shared", familyProfileId: null })
          }
        />
        <Chip
          variant="filter"
          label="Just me"
          accessibilityRole="radio"
          selected={value.audience === "self"}
          onPress={() => onChange({ audience: "self", familyProfileId: null })}
        />
        {profiles.map((profile) => (
          <Chip
            key={profile.id}
            variant="filter"
            label={profile.name}
            accessibilityRole="radio"
            selected={
              value.audience === "profile" &&
              value.familyProfileId === profile.id
            }
            onPress={() =>
              onChange({ audience: "profile", familyProfileId: profile.id })
            }
          />
        ))}
      </View>
    </ScrollView>
  );
}

export const AUDIENCE_SHEET_SNAP_POINTS = ["32%"];

/**
 * The day view's "Who's it for?" sheet. The BottomSheetModal itself stays in
 * the screen; this is its content.
 */
export function AudienceSheetContent({
  profiles,
  value,
  onChange,
}: {
  profiles: FamilyProfile[];
  value: AudienceChoiceValue;
  onChange: (choice: AudienceChoiceValue) => void;
}) {
  return (
    <View style={styles.sheet} accessibilityViewIsModal>
      <SheetDragHandle />
      <ThemedText style={styles.sheetTitle}>{"Who's it for?"}</ThemedText>
      <AudienceChoice profiles={profiles} value={value} onChange={onChange} />
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    alignItems: "center",
    paddingTop: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
  },
  sheetTitle: {
    fontSize: 17,
    fontFamily: FontFamily.semiBold,
    alignSelf: "flex-start",
    marginBottom: Spacing.md,
  },
  scroll: {
    flexGrow: 0,
    alignSelf: "stretch",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
});
