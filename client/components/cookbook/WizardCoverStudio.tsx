import React, { type Dispatch } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Image } from "expo-image";

import { ThemedText } from "@/components/ThemedText";
import { TextInput } from "@/components/TextInput";
import { Chip } from "@/components/Chip";
import { Button } from "@/components/Button";
import { InlineError } from "@/components/InlineError";
import { SelectableTile } from "@/components/SelectableTile";
import { SkeletonBox } from "@/components/SkeletonLoader";
import { useTheme } from "@/hooks/useTheme";
import { resolveImageUrl } from "@/lib/query-client";
import { BorderRadius, FontFamily, Spacing } from "@/constants/theme";
import {
  COOKBOOK_COVER_PROMPT_MAX,
  COOKBOOK_COVER_STYLE_LABELS,
  COOKBOOK_COVER_STYLES,
  type CookbookCoverStyle,
} from "@shared/constants/cookbook-cover-styles";
import { COVER_IDEAS, generateButtonLabel } from "./cover-studio-utils";
import type { CoverStudioState, WizardAction } from "./cookbook-wizard-utils";

/** The screen owns the request; the studio only shows its state. */
export interface CoverStudioControls {
  generating: boolean;
  /** User-facing copy for the last failed set, or null. */
  error: string | null;
  /** The last set fell back to food scenes because the request wasn't food. */
  promptIgnored: boolean;
  onGenerate: () => void;
}

interface WizardCoverStudioProps {
  studio: CoverStudioState;
  /** The candidate currently on the cover, if any. */
  pickedId: string | null;
  dispatch: Dispatch<WizardAction>;
  controls: CoverStudioControls;
}

type SwatchToken =
  | "coverStyleRustic"
  | "coverStyleBotanical"
  | "coverStyleGolden"
  | "coverStyleMidnight";

const SWATCH: Record<CookbookCoverStyle, SwatchToken> = {
  "rustic-terracotta": "coverStyleRustic",
  "botanical-parchment": "coverStyleBotanical",
  "golden-hour": "coverStyleGolden",
  "midnight-coral": "coverStyleMidnight",
};

const TILE_COUNT = 4;

/**
 * The AI cover studio under the cover plate: describe the cover, pick a
 * style, generate four, pick one. Shown while "Generate with AI" is selected.
 */
export function WizardCoverStudio({
  studio,
  pickedId,
  dispatch,
  controls,
}: WizardCoverStudioProps) {
  const { theme } = useTheme();
  const { generating, error, promptIgnored, onGenerate } = controls;
  const hasCandidates = studio.candidates.length > 0;

  return (
    <View style={styles.container}>
      <View>
        <TextInput
          label="Describe your cover"
          placeholder="e.g. A rustic table with fresh bread and herbs, warm morning light"
          value={studio.prompt}
          onChangeText={(text) =>
            dispatch({
              type: "setCoverPrompt",
              value: text.slice(0, COOKBOOK_COVER_PROMPT_MAX),
            })
          }
          maxLength={COOKBOOK_COVER_PROMPT_MAX}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
          style={styles.multilineInput}
        />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.ideas}
          style={styles.ideasScroller}
          keyboardShouldPersistTaps="handled"
        >
          {COVER_IDEAS.map((idea) => (
            <Chip
              key={idea}
              label={idea}
              variant="outline"
              onPress={() => dispatch({ type: "setCoverPrompt", value: idea })}
              accessibilityLabel={idea}
            />
          ))}
        </ScrollView>
      </View>

      <View style={styles.section}>
        <ThemedText style={styles.sectionLabel}>Style</ThemedText>
        <View
          style={styles.styles}
          accessibilityRole="radiogroup"
          accessibilityLabel="Cover style"
        >
          {COOKBOOK_COVER_STYLES.map((style) => (
            <Chip
              key={style}
              label={COOKBOOK_COVER_STYLE_LABELS[style]}
              variant="outline"
              selected={studio.style === style}
              accessibilityRole="radio"
              accessibilityLabel={`${COOKBOOK_COVER_STYLE_LABELS[style]} style`}
              onPress={() => dispatch({ type: "setCoverStyle", style })}
              leading={
                <View
                  style={[
                    styles.swatch,
                    {
                      backgroundColor: theme[SWATCH[style]],
                      borderColor: theme.border,
                    },
                  ]}
                  accessible={false}
                />
              }
            />
          ))}
        </View>
      </View>

      <Button
        variant="outline"
        onPress={onGenerate}
        disabled={generating}
        loading={generating}
        loadingText="Generating…"
        accessibilityHint="Makes four covers from your description and style"
      >
        {generateButtonLabel(generating, hasCandidates)}
      </Button>
      <InlineError message={error} />
      {promptIgnored && !generating ? (
        <ThemedText type="small" style={{ color: theme.textSecondary }}>
          We kept your covers to food scenes.
        </ThemedText>
      ) : null}

      {generating || hasCandidates ? (
        <View style={styles.section}>
          <ThemedText style={styles.sectionLabel}>Pick a cover</ThemedText>
          {generating ? (
            <View style={styles.tiles} accessible={false}>
              {Array.from({ length: TILE_COUNT }, (_, i) => (
                <View key={i} style={styles.tileSlot}>
                  <SkeletonBox
                    height={undefined}
                    borderRadius={BorderRadius.xs}
                    style={styles.tileArt}
                  />
                </View>
              ))}
            </View>
          ) : (
            <View
              style={styles.tiles}
              accessibilityRole="radiogroup"
              accessibilityLabel="Pick a cover"
            >
              {studio.candidates.map((candidate, i) => {
                const selected = candidate.id === pickedId;
                return (
                  <SelectableTile
                    key={candidate.id}
                    onPress={() =>
                      dispatch({ type: "pickCandidate", candidate })
                    }
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`Cover option ${i + 1} of ${studio.candidates.length}`}
                    style={[
                      styles.tileSlot,
                      styles.tile,
                      { borderColor: selected ? theme.link : "transparent" },
                    ]}
                  >
                    <Image
                      source={{
                        uri: resolveImageUrl(candidate.imageUrl) ?? undefined,
                      }}
                      style={styles.tileArt}
                      contentFit="cover"
                      accessible={false}
                    />
                  </SelectableTile>
                );
              })}
            </View>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.md,
  },
  multilineInput: {
    minHeight: 72,
  },
  ideasScroller: {
    marginTop: Spacing.sm,
    // Bleed to the screen edge so the row reads as scrollable.
    marginHorizontal: -Spacing.lg,
  },
  ideas: {
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  section: {
    gap: Spacing.sm,
  },
  sectionLabel: {
    fontSize: 14,
    fontFamily: FontFamily.semiBold,
  },
  styles: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  swatch: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1,
  },
  tiles: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  tileSlot: {
    flex: 1,
    aspectRatio: 3 / 4,
  },
  tile: {
    borderWidth: 2,
    borderRadius: BorderRadius.xs + 2,
    padding: 2,
  },
  tileArt: {
    flex: 1,
    width: "100%",
    borderRadius: BorderRadius.xs,
  },
});
