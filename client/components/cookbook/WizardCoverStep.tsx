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
import {
  WizardCoverStudio,
  type CoverStudioControls,
} from "./WizardCoverStudio";
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
  /** The cover studio's request state, owned by the screen. */
  studioControls: CoverStudioControls;
}

/**
 * Wizard step 2: choose how the cover is made — a photo of your own, or the
 * AI cover studio (describe it, pick a style, generate four, pick one).
 */
export function WizardCoverStep({
  state,
  dispatch,
  canGenerate,
  onRequestUpgrade,
  onPickPhoto,
  coverWidth,
  studioControls,
}: WizardCoverStepProps) {
  const { theme } = useTheme();
  const { cover, studio } = state;
  const studioOpen = studio.open;
  const hasPhoto = cover.kind === "photo";
  const pickedId = cover.kind === "candidate" ? cover.candidateId : null;

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
    // Tapping the selected card again closes the studio — mirrors upload.
    dispatch({ type: studioOpen ? "closeStudio" : "openStudio" });
  };

  return (
    <View style={styles.container}>
      <View style={styles.titleBlock}>
        <ThemedText type="h3" accessibilityRole="header">
          Design your cover
        </ThemedText>
        <ThemedText type="small" style={{ color: theme.textSecondary }}>
          Use a photo of your own, or describe one and let AI create it.
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
          sub="Describe it, pick a style"
          selected={studioOpen}
          locked={!canGenerate}
          onPress={handleGenerate}
          // Starts with the visible title (label-in-name, for Voice
          // Control); a locked card adds that it is a premium feature —
          // the lock badge alone is silent.
          accessibilityLabel={
            canGenerate
              ? "Generate with AI"
              : "Generate with AI, premium feature"
          }
          accessibilityHint={
            canGenerate
              ? "Opens the cover studio"
              : "Premium feature. Opens upgrade options"
          }
        />
      </View>

      <CookbookCoverPlate
        name={state.name}
        description={state.description}
        previewUri={hasPhoto ? cover.uri : null}
        coverImageUrl={cover.kind === "candidate" ? cover.imageUrl : null}
        width={coverWidth}
        generateArmed={studioOpen}
        // Tapping the cover is a shortcut to the photo picker — except while
        // the studio is open, when a tap would silently swap the choice.
        onPress={studioOpen ? undefined : onPickPhoto}
      />

      {studioOpen ? (
        <>
          {pickedId ? null : (
            <ThemedText
              type="small"
              style={[styles.hint, { color: theme.textSecondary }]}
            >
              Pick a cover, or continue with a plain one.
            </ThemedText>
          )}
          <WizardCoverStudio
            studio={studio}
            pickedId={pickedId}
            dispatch={dispatch}
            controls={studioControls}
          />
        </>
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
