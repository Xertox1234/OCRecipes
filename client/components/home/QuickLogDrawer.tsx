import React, { useCallback, useEffect, useMemo, useRef } from "react";
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  ActivityIndicator,
  Keyboard,
  AccessibilityInfo,
  Platform,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import * as Haptics from "expo-haptics";

import { ThemedText } from "@/components/ThemedText";
import { InlineError } from "@/components/InlineError";
import { VoiceLogButton } from "@/components/VoiceLogButton";
import { HomeInlineDrawer } from "@/components/home/HomeInlineDrawer";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useToast } from "@/context/ToastContext";
import {
  useQuickLogSession,
  EMPTY_PARSE_MESSAGE,
} from "@/hooks/useQuickLogSession";
import type { ParsedFoodItem, LogSummary } from "@/hooks/useQuickLogSession";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import type { HomeScreenNavigationProp } from "@/types/navigation";
import type { HomeAction } from "./action-config";

/** Shown/announced when parsed items first appear (see the success-announce effect). */
function foundItemsMessage(count: number) {
  return `Found ${count} item${count === 1 ? "" : "s"}. Log All to save.`;
}

interface FrequentChipProps {
  productName: string;
  onPress: (productName: string) => void;
}

const FrequentChip = React.memo(function FrequentChip({
  productName,
  onPress,
}: FrequentChipProps) {
  const { theme } = useTheme();
  const handlePress = useCallback(
    () => onPress(productName),
    [onPress, productName],
  );
  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: theme.backgroundSecondary,
          borderColor: theme.border,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
      accessibilityLabel={`Use ${productName}`}
      accessibilityRole="button"
    >
      <ThemedText
        style={[styles.chipText, { color: theme.textSecondary }]}
        numberOfLines={1}
      >
        {productName}
      </ThemedText>
    </Pressable>
  );
});

interface ParsedItemRowProps {
  item: ParsedFoodItem;
  index: number;
  onRemove: (index: number) => void;
}

const ParsedItemRow = React.memo(function ParsedItemRow({
  item,
  index,
  onRemove,
}: ParsedItemRowProps) {
  const { theme } = useTheme();
  const handleRemove = useCallback(() => onRemove(index), [onRemove, index]);
  return (
    <View style={[styles.parsedItemRow, { borderBottomColor: theme.border }]}>
      <ThemedText
        style={[styles.parsedItemName, { color: theme.text }]}
        numberOfLines={1}
      >
        {item.quantity} {item.unit} {item.name}
      </ThemedText>
      <View style={styles.parsedItemRight}>
        {item.calories !== null && (
          <ThemedText
            style={[styles.parsedItemCal, { color: theme.textSecondary }]}
          >
            {item.calories} cal
          </ThemedText>
        )}
        <Pressable
          onPress={handleRemove}
          accessibilityLabel={`Remove ${item.name}`}
          accessibilityRole="button"
          // 14pt icon — hitSlop lifts the touch target past the WCAG 2.5.8
          // AA 24px floor without growing the row.
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={({ pressed }) => ({
            opacity: pressed ? 0.5 : 1,
          })}
        >
          <Feather
            name="x"
            size={14}
            color={theme.textSecondary}
            accessible={false}
          />
        </Pressable>
      </View>
    </View>
  );
});

interface QuickLogDrawerProps {
  action: HomeAction;
  /** Owned by HomeScreen, like the other inline drawers, so it can lock the
   * row and glide it into view. */
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  isLocked?: boolean;
  /** Fires when parsed items first appear, so Home can glide the row up and
   * keep the results and Log All on screen. */
  onResultsShown?: () => void;
}

export function QuickLogDrawer({
  action,
  isOpen,
  onToggle,
  onClose,
  isLocked,
  onResultsShown,
}: QuickLogDrawerProps) {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const toast = useToast();
  const navigation = useNavigation<HomeScreenNavigationProp>();

  const handleLogSuccess = useCallback(
    ({ firstName, totalCalories }: LogSummary) => {
      onClose();
      const label =
        totalCalories > 0 ? `${firstName} · ${totalCalories} cal` : firstName;
      toast.success(`Logged! ${label}`);
    },
    [onClose, toast],
  );

  const session = useQuickLogSession({
    onLogSuccess: handleLogSuccess,
    isOpen,
  });

  useEffect(() => {
    if (session.speechError) toast.error(session.speechError);
  }, [session.speechError, toast]);

  useEffect(() => {
    if (session.capWarning) toast.info(session.capWarning);
  }, [session.capWarning, toast]);

  // parse/submit errors render via <InlineError>, which fires its own
  // iOS-gated announce internally — do not announce them here too
  // (docs/rules/accessibility.md double-announce exception).

  const { reset: sessionReset } = session;

  // Home closes this drawer from several places (its header, opening another
  // drawer, leaving the tab, a successful log), so reset on the transition
  // rather than in one handler.
  const wasOpenRef = useRef(isOpen);
  useEffect(() => {
    if (wasOpenRef.current && !isOpen) sessionReset();
    wasOpenRef.current = isOpen;
  }, [isOpen, sessionReset]);

  const { handleTextSubmit } = session;
  const canSubmit = session.inputText.trim().length > 0 && !session.isParsing;
  const handleSubmitPress = useCallback(() => {
    // The return key blurs a single-line input by itself; the button must too,
    // or the keyboard covers the results.
    Keyboard.dismiss();
    handleTextSubmit();
  }, [handleTextSubmit]);

  const handleCameraPress = useCallback(() => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
    navigation.navigate("Scan", { returnAfterLog: true });
  }, [haptics, navigation]);

  const totalCalories = useMemo(
    () =>
      session.parsedItems.reduce((sum, item) => sum + (item.calories ?? 0), 0),
    [session.parsedItems],
  );
  const hasParsedItems = useMemo(
    () => session.parsedItems.length > 0,
    [session.parsedItems],
  );

  // "No food found" is an outcome, not a failure, so it is a quiet note, not
  // InlineError's assertive alert. The note's live region covers Android;
  // iOS needs the imperative announce, once per empty result.
  const wasParseEmptyRef = useRef(false);
  useEffect(() => {
    if (
      session.parseEmpty &&
      !wasParseEmptyRef.current &&
      Platform.OS === "ios"
    ) {
      AccessibilityInfo.announceForAccessibility(EMPTY_PARSE_MESSAGE);
    }
    wasParseEmptyRef.current = session.parseEmpty;
  }, [session.parseEmpty]);

  // Fires once per drawer session, when parsed items first appear, so Home
  // can glide the row up and keep the results and Log All on screen. The
  // success announce below is keyed on the parse generation instead: a
  // later parse can replace the results without `hasParsedItems` passing
  // back through false, so it can't share this false→true guard.
  const hadParsedItemsRef = useRef(false);
  useEffect(() => {
    if (hasParsedItems && !hadParsedItemsRef.current) {
      onResultsShown?.();
    }
    hadParsedItemsRef.current = hasParsedItems;
  }, [hasParsedItems, onResultsShown]);

  // A successful parse announces its item count — every parse, not just the
  // first: a later parse can replace the results without `hasParsedItems`
  // passing back through false, and the previous discriminator-keyed guard
  // (above) missed that case (docs/solutions/logic-errors/imperative-
  // announce-must-be-content-keyed-not-variant-keyed-2026-06-24.md, "Second
  // manifestation"). iOS has no live region here, so it always gets the
  // imperative announce. Android's <ThemedText accessibilityLiveRegion=
  // "polite"> below re-reads automatically whenever the count changes the
  // rendered text; only a same-count replace leaves that text identical, so
  // it needs the explicit announce too — never both, on either platform
  // (docs/rules/accessibility.md → Announcements).
  //
  // `lastRenderedCountRef` must be written on EVERY run of this effect, not
  // only when the generation changes: removeItem (and reset()) change
  // `parsedItems.length` — and so the live region's own rendered text —
  // without bumping `parseGeneration`. A version gated behind the
  // generation check went stale across exactly those changes, producing a
  // false negative (a same-count replace after a removeItem stayed silent)
  // and a false positive (a fresh session's first parse double-announced
  // when its count happened to match a prior session's last one) —
  // caught by review with a constructed probe.
  const announcedGenerationRef = useRef(0);
  const lastRenderedCountRef = useRef(0);
  useEffect(() => {
    const count = session.parsedItems.length;
    const prevRenderedCount = lastRenderedCountRef.current;
    lastRenderedCountRef.current = count;

    const generation = session.parseGeneration;
    if (generation === 0 || generation === announcedGenerationRef.current) {
      return;
    }
    announcedGenerationRef.current = generation;
    if (count === 0) return;
    if (Platform.OS === "ios" || count === prevRenderedCount) {
      AccessibilityInfo.announceForAccessibility(foundItemsMessage(count));
    }
  }, [session.parseGeneration, session.parsedItems.length]);

  return (
    <HomeInlineDrawer
      icon={action.icon}
      label={action.label}
      isOpen={isOpen}
      onToggle={onToggle}
      isLocked={isLocked}
      bodyBackgroundColor={withOpacity(theme.link, 0.04)}
    >
      {/* Text input row */}
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
          style={[styles.textInput, { color: theme.text }]}
          placeholder="What did you eat?"
          placeholderTextColor={theme.textSecondary}
          value={session.inputText}
          onChangeText={session.setInputText}
          onSubmitEditing={handleTextSubmit}
          returnKeyType="done"
          accessibilityLabel="Food description"
        />
        <Pressable
          onPress={handleSubmitPress}
          disabled={!canSubmit}
          accessibilityLabel="Find food"
          accessibilityHint="Looks up what you typed. Nothing is logged until you tap Log All."
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSubmit, busy: session.isParsing }}
          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
          style={({ pressed }) => [
            styles.iconButton,
            {
              borderColor: canSubmit ? theme.accentSolid : theme.border,
              backgroundColor: canSubmit ? theme.accentSolid : "transparent",
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          {session.isParsing ? (
            <ActivityIndicator size="small" color={theme.textSecondary} />
          ) : (
            <Feather
              name="arrow-right"
              size={20}
              color={canSubmit ? theme.buttonText : theme.textSecondary}
              accessible={false}
            />
          )}
        </Pressable>
        <VoiceLogButton
          isListening={session.isListening}
          volume={session.volume}
          onPress={session.handleVoicePress}
          disabled={session.isParsing}
        />
        <Pressable
          onPress={handleCameraPress}
          accessibilityLabel="Open camera to scan food"
          accessibilityRole="button"
          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
          style={({ pressed }) => [
            styles.iconButton,
            {
              borderColor: theme.border,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <Feather
            name="camera"
            size={20}
            color={theme.textSecondary}
            accessible={false}
          />
        </Pressable>
      </View>

      {/* Parse error, or a parse that found no food */}
      <InlineError message={session.parseError} />
      {session.parseEmpty && (
        <ThemedText
          type="small"
          style={{ color: theme.textSecondary }}
          accessibilityLiveRegion="polite"
        >
          {EMPTY_PARSE_MESSAGE}
        </ThemedText>
      )}

      {/* Frequent chips — only when no parsed items */}
      {!hasParsedItems &&
        session.frequentItems &&
        session.frequentItems.length > 0 && (
          <View style={styles.chipsRow}>
            {session.frequentItems.slice(0, 5).map((item) => (
              <FrequentChip
                key={item.productName}
                productName={item.productName}
                onPress={session.handleChipPress}
              />
            ))}
          </View>
        )}

      {/* Parsed items */}
      {hasParsedItems && (
        <View style={styles.parsedSection}>
          <ThemedText
            type="small"
            style={{ color: theme.textSecondary }}
            accessibilityLiveRegion="polite"
          >
            {foundItemsMessage(session.parsedItems.length)}
          </ThemedText>
          {session.parsedItems.map((item, index) => (
            <ParsedItemRow
              key={`${item.name}-${index}`}
              item={item}
              index={index}
              onRemove={session.removeItem}
            />
          ))}

          {/* Footer: total + Log All */}
          <View style={styles.parsedFooter}>
            <ThemedText style={[styles.totalText, { color: theme.link }]}>
              {totalCalories} cal total
            </ThemedText>
            <Pressable
              onPress={session.submitLog}
              disabled={session.isSubmitting}
              accessibilityLabel="Log all items"
              accessibilityRole="button"
              accessibilityState={{ busy: session.isSubmitting }}
              style={({ pressed }) => [
                styles.logAllButton,
                {
                  backgroundColor: theme.accentSolid,
                  opacity: pressed || session.isSubmitting ? 0.7 : 1,
                },
              ]}
            >
              {session.isSubmitting ? (
                <ActivityIndicator size="small" color={theme.buttonText} />
              ) : (
                <ThemedText
                  style={[styles.logAllText, { color: theme.buttonText }]}
                >
                  Log All
                </ThemedText>
              )}
            </Pressable>
          </View>

          <InlineError message={session.submitError} />
        </View>
      )}
    </HomeInlineDrawer>
  );
}

const styles = StyleSheet.create({
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: BorderRadius.xs,
    borderWidth: 1,
    paddingHorizontal: Spacing.sm,
    gap: Spacing.xs,
  },
  textInput: {
    flex: 1,
    height: 40,
    fontSize: 14,
    fontFamily: FontFamily.regular,
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.xs,
  },
  chip: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    maxWidth: 120,
    // WCAG 2.5.5 AAA: lift the chip to a ≥44×44pt target on BOTH axes.
    // minHeight (not hitSlop) is used because the chips sit in a flex-wrap row
    // with a 4pt gap — a hitSlop would overlap adjacent chips and cause
    // mis-taps. minHeight is vertical only, so horizontal wrapping is
    // unaffected. minWidth covers the horizontal axis for short labels (e.g.
    // "Egg"), which otherwise render ~36pt wide; it floors against the existing
    // maxWidth: 120 without breaking wrapping.
    minHeight: 44,
    minWidth: 44,
    justifyContent: "center",
  },
  chipText: {
    fontSize: 12,
    fontFamily: FontFamily.regular,
  },
  parsedSection: { gap: 2 },
  parsedItemRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: Spacing.sm,
  },
  parsedItemName: {
    flex: 1,
    fontSize: 13,
    fontFamily: FontFamily.regular,
  },
  parsedItemRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  parsedItemCal: {
    fontSize: 12,
    fontFamily: FontFamily.regular,
  },
  parsedFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: Spacing.xs,
  },
  totalText: {
    fontSize: 13,
    fontFamily: FontFamily.medium,
  },
  logAllButton: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.xs,
    minWidth: 72,
    alignItems: "center",
  },
  logAllText: {
    fontSize: 13,
    fontFamily: FontFamily.medium,
    fontWeight: "600",
  },
  errorText: {
    fontSize: 12,
    fontFamily: FontFamily.regular,
  },
});
