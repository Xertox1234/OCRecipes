// Spec 2026-10-06 §3: "Want me to make this into a recipe?" [Yes] [Search] [No].
import React from "react";
import { StyleSheet, View } from "react-native";
import { MarkdownText } from "@/components/MarkdownText";
import { spokenMarkdown } from "@/components/markdown-text-utils";
import { PressableScale } from "@/components/PressableScale";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import {
  BorderRadius,
  Spacing,
  Typography,
  withOpacity,
} from "@/constants/theme";
import type {
  FinderAction,
  RecipeOfferBlock,
} from "@shared/schemas/recipe-finder";
import { offerDisplayText } from "./recipe-offer-utils";
import { useCardArrivalAnnouncement } from "./useCardArrivalAnnouncement";

type OfferActionType = "offer_yes" | "offer_search" | "offer_no";

const OFFER_BUTTONS: { type: OfferActionType; label: string }[] = [
  { type: "offer_yes", label: "Yes" },
  { type: "offer_search", label: "Search" },
  { type: "offer_no", label: "No" },
];

export interface RecipeOfferProps {
  block: RecipeOfferBlock;
  /** The message text the server wrote — the offer copy lives there. */
  content?: string;
  /** Only the latest finder message's buttons are live (spec §4). */
  isActive: boolean;
  /** False in RecipeChef's pending bubble; see RecipeResultsListProps. */
  announceArrival?: boolean;
  /** `label` is the visible user bubble and the request `content`. */
  onAction: (action: FinderAction, label: string) => void;
}

const ARRIVAL_ANNOUNCEMENT = `Recipe offer: ${OFFER_BUTTONS[0].label}, ${OFFER_BUTTONS[1].label}, or ${OFFER_BUTTONS[2].label}`;

export const RecipeOffer = React.memo(function RecipeOffer({
  block,
  content,
  isActive,
  announceArrival = true,
  onAction,
}: RecipeOfferProps) {
  const { theme } = useTheme();
  const text = offerDisplayText(content);
  useCardArrivalAnnouncement(
    `offer:${block.flow.flowId}`,
    ARRIVAL_ANNOUNCEMENT,
    { enabled: announceArrival, isActive },
  );

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: withOpacity(theme.text, 0.04) },
      ]}
    >
      {text ? (
        <View
          accessible
          accessibilityRole="text"
          accessibilityLabel={spokenMarkdown(text)}
        >
          <MarkdownText style={{ ...Typography.body, color: theme.text }}>
            {text}
          </MarkdownText>
        </View>
      ) : null}
      <View style={styles.buttons}>
        {OFFER_BUTTONS.map(({ type, label }) => {
          const filled = type === "offer_yes";
          return (
            <PressableScale
              key={type}
              onPress={() => {
                if (!isActive) return;
                onAction({ type, flowId: block.flow.flowId }, label);
              }}
              disabled={!isActive}
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={{ disabled: !isActive }}
              style={[
                styles.button,
                filled
                  ? { backgroundColor: theme.accentSolid }
                  : { borderWidth: 1, borderColor: theme.link },
                !isActive && styles.inactive,
              ]}
            >
              <ThemedText
                style={[
                  styles.buttonText,
                  { color: filled ? theme.buttonText : theme.link },
                ]}
              >
                {label}
              </ThemedText>
            </PressableScale>
          );
        })}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    borderRadius: BorderRadius.sm,
    padding: Spacing.md,
    marginTop: Spacing.sm,
    gap: Spacing.md,
  },
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  button: {
    minHeight: 44,
    minWidth: 72,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { fontSize: 14, fontWeight: "600" },
  inactive: { opacity: 0.45 },
});
