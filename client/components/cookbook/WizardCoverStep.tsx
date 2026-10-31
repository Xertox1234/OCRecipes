import React, { type Dispatch } from "react";
import { StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { SelectableTile } from "@/components/SelectableTile";
import { useTheme } from "@/hooks/useTheme";
import {
  BorderRadius,
  FontFamily,
  Spacing,
  withOpacity,
} from "@/constants/theme";
import { CookbookCoverPlate } from "./CookbookCoverPlate";
import { coverGenerateActionLabel } from "./cookbook-cover-utils";
import type { WizardAction, WizardState } from "./cookbook-wizard-utils";

type FeatherIconName = React.ComponentProps<typeof Feather>["name"];

interface WizardCoverStepProps {
  state: WizardState;
  dispatch: Dispatch<WizardAction>;
  /** Premium entitlement for AI covers; false shows the lock and upsells. */
  canGenerate: boolean;
  onRequestUpgrade: () => void;
  /** Opens the photo library; the screen dispatches the chosen photo. */
  onPickPhoto: () => void;
  coverWidth: number;
}

/**
 * Wizard step 2: choose how the cover is made — a photo of your own, or AI
 * art generated from the name and description once the book is created.
 */
export function WizardCoverStep({
  state,
  dispatch,
  canGenerate,
  onRequestUpgrade,
  onPickPhoto,
  coverWidth,
}: WizardCoverStepProps) {
  const { theme } = useTheme();
  const { cover } = state;
  const generateArmed = cover.kind === "generate";
  const hasPhoto = cover.kind === "photo";

  const handleUpload = () => {
    // Tapping the selected card again drops the photo, back to the plain
    // cloth cover — mirrors the generate toggle.
    if (hasPhoto) {
      dispatch({ type: "setCover", cover: { kind: "none" } });
      return;
    }
    onPickPhoto();
  };

  const handleGenerate = () => {
    if (!canGenerate) {
      onRequestUpgrade();
      return;
    }
    // Tapping the armed card again turns generate off.
    dispatch({
      type: "setCover",
      cover: generateArmed ? { kind: "none" } : { kind: "generate" },
    });
  };

  return (
    <View style={styles.container}>
      <View style={styles.titleBlock}>
        <ThemedText type="h3" accessibilityRole="header">
          Design your cover
        </ThemedText>
        <ThemedText type="small" style={{ color: theme.textSecondary }}>
          Use a photo of your own, or let AI create one from your
          cookbook&apos;s name.
        </ThemedText>
      </View>

      <View
        style={styles.cards}
        accessibilityRole="radiogroup"
        accessibilityLabel="Cover source"
      >
        <CoverChoiceCard
          icon="image"
          title="Upload a photo"
          sub="From your camera roll"
          selected={hasPhoto}
          onPress={handleUpload}
          accessibilityHint={
            hasPhoto
              ? "Removes the photo"
              : "Choose a cover image from your photo library"
          }
        />
        <CoverChoiceCard
          icon="feather"
          title="Generate with AI"
          sub="Made from your name and description"
          selected={generateArmed}
          locked={!canGenerate}
          onPress={handleGenerate}
          // Spoken rather than the title, so a locked card says it is a
          // premium feature — the lock badge alone is silent.
          accessibilityLabel={coverGenerateActionLabel(
            cover.kind !== "none",
            canGenerate,
          )}
          accessibilityHint={
            canGenerate
              ? "Creates cover art from the name and description"
              : "Premium feature. Opens upgrade options"
          }
        />
      </View>

      <CookbookCoverPlate
        name={state.name}
        description={state.description}
        previewUri={hasPhoto ? cover.uri : null}
        width={coverWidth}
        generateArmed={generateArmed}
        // Tapping the cover is a shortcut to the photo picker — except while
        // generate is armed, when a tap would silently swap the choice.
        onPress={generateArmed ? undefined : onPickPhoto}
      />

      {generateArmed ? (
        <ThemedText
          type="small"
          style={[styles.hint, { color: theme.textSecondary }]}
        >
          Your cover is made from the name and description when you create the
          book.
        </ThemedText>
      ) : null}
    </View>
  );
}

function CoverChoiceCard({
  icon,
  title,
  sub,
  selected,
  locked = false,
  onPress,
  accessibilityLabel = title,
  accessibilityHint,
}: {
  icon: FeatherIconName;
  title: string;
  sub: string;
  selected: boolean;
  locked?: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
  accessibilityHint: string;
}) {
  const { theme } = useTheme();

  return (
    <SelectableTile
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      style={[
        styles.card,
        {
          borderColor: selected ? theme.link : theme.border,
          backgroundColor: selected
            ? withOpacity(theme.link, 0.08)
            : theme.surface,
        },
      ]}
    >
      <View style={styles.cardTop}>
        <View
          style={[
            styles.iconChip,
            { backgroundColor: withOpacity(theme.link, 0.12) },
          ]}
        >
          <Feather
            name={icon}
            size={18}
            color={theme.link}
            accessible={false}
          />
        </View>
        {locked ? (
          <View
            style={[
              styles.lock,
              { backgroundColor: withOpacity(theme.link, 0.14) },
            ]}
          >
            <Feather
              name="lock"
              size={11}
              color={theme.link}
              accessible={false}
            />
          </View>
        ) : null}
      </View>
      <ThemedText style={styles.cardTitle} numberOfLines={1}>
        {title}
      </ThemedText>
      <ThemedText
        type="caption"
        style={{ color: theme.textSecondary }}
        numberOfLines={2}
      >
        {sub}
      </ThemedText>
    </SelectableTile>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.lg,
  },
  titleBlock: {
    gap: Spacing.xs,
  },
  cards: {
    flexDirection: "row",
    gap: Spacing.md,
  },
  card: {
    flex: 1,
    gap: Spacing.xs,
    padding: Spacing.md,
    borderRadius: BorderRadius.card,
    borderWidth: 1.5,
  },
  cardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: Spacing.xs,
  },
  iconChip: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.xs,
    alignItems: "center",
    justifyContent: "center",
  },
  lock: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontFamily: FontFamily.semiBold,
  },
  hint: {
    textAlign: "center",
  },
});
