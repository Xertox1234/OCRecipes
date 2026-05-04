import React, {
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
} from "react";
import {
  AccessibilityInfo,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  ActivityIndicator,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  cancelAnimation,
} from "react-native-reanimated";
import { useNavigation } from "@react-navigation/native";
import * as Haptics from "expo-haptics";

import { ThemedText } from "@/components/ThemedText";
import { VoiceLogButton } from "@/components/VoiceLogButton";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useToast } from "@/context/ToastContext";
import { useCollapsibleHeight } from "@/hooks/useCollapsibleHeight";
import { useQuickLogSession } from "@/hooks/useQuickLogSession";
import type { ParsedFoodItem, LogSummary } from "@/hooks/useQuickLogSession";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import {
  expandTimingConfig,
  collapseTimingConfig,
} from "@/constants/animations";
import type { HomeScreenNavigationProp } from "@/types/navigation";
import type { HomeAction } from "./action-config";

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
          style={({ pressed }) => ({
            opacity: pressed ? 0.5 : 1,
          })}
        >
          <Feather name="x" size={14} color={theme.textSecondary} />
        </Pressable>
      </View>
    </View>
  );
});

interface QuickLogDrawerProps {
  action: HomeAction;
}

export function QuickLogDrawer({ action }: QuickLogDrawerProps) {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const toast = useToast();
  const navigation = useNavigation<HomeScreenNavigationProp>();
  const { reducedMotion } = useAccessibility();

  const [isOpen, setIsOpen] = useState(false);
  const isOpenRef = useRef(false);
  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);
  const chevronRotation = useSharedValue(0);
  const { animatedStyle, onContentLayout } = useCollapsibleHeight(
    isOpen,
    reducedMotion,
  );

  const handleLogSuccess = useCallback(
    ({ firstName, totalCalories }: LogSummary) => {
      setIsOpen(false);
      const label =
        totalCalories > 0 ? `${firstName} · ${totalCalories} cal` : firstName;
      toast.success(`Logged! ${label}`);
    },
    [toast],
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

  useEffect(() => {
    if (Platform.OS === "ios" && session.parseError) {
      AccessibilityInfo.announceForAccessibility(session.parseError);
    }
  }, [session.parseError]);

  useEffect(() => {
    if (Platform.OS === "ios" && session.submitError) {
      AccessibilityInfo.announceForAccessibility(session.submitError);
    }
  }, [session.submitError]);

  const { reset: sessionReset } = session;

  const handleToggle = useCallback(() => {
    const next = !isOpen;
    if (!next) sessionReset();
    setIsOpen(next);
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
    if (reducedMotion) {
      chevronRotation.value = next ? 90 : 0;
    } else {
      chevronRotation.value = withTiming(
        next ? 90 : 0,
        next ? expandTimingConfig : collapseTimingConfig,
      );
    }
  }, [isOpen, sessionReset, haptics, chevronRotation, reducedMotion]);

  const handleCameraPress = useCallback(() => {
    haptics.impact(Haptics.ImpactFeedbackStyle.Light);
    navigation.navigate("Scan", { returnAfterLog: true });
  }, [haptics, navigation]);

  // Keep chevron in sync if reducedMotion changes while open
  useEffect(() => {
    if (reducedMotion) {
      cancelAnimation(chevronRotation);
      chevronRotation.value = isOpenRef.current ? 90 : 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- shared value + isOpenRef are stable refs
  }, [reducedMotion]);

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${chevronRotation.value}deg` }],
  }));

  const totalCalories = useMemo(
    () =>
      session.parsedItems.reduce((sum, item) => sum + (item.calories ?? 0), 0),
    [session.parsedItems],
  );
  const hasParsedItems = useMemo(
    () => session.parsedItems.length > 0,
    [session.parsedItems],
  );

  return (
    <View>
      {/* Header row */}
      <Pressable
        onPress={handleToggle}
        style={styles.header}
        accessibilityRole="button"
        accessibilityLabel={action.label}
        accessibilityState={{ expanded: isOpen }}
        accessibilityHint={`Double tap to ${isOpen ? "collapse" : "expand"} quick log`}
      >
        <View
          style={[
            styles.iconCircle,
            { backgroundColor: withOpacity(theme.link, 0.1) },
          ]}
        >
          <Feather
            name={action.icon as keyof typeof Feather.glyphMap}
            size={18}
            color={theme.link}
            accessible={false}
          />
        </View>
        <ThemedText type="body" style={styles.label}>
          {action.label}
        </ThemedText>
        <Animated.View style={chevronStyle}>
          <Feather
            name="chevron-right"
            size={16}
            color={theme.textSecondary}
            accessible={false}
          />
        </Animated.View>
      </Pressable>

      {/* Animated drawer body — always mounted so collapse animation can play */}
      <Animated.View style={[animatedStyle, styles.clipContainer]}>
        <View
          style={[
            styles.drawerBody,
            { backgroundColor: withOpacity(theme.link, 0.04) },
          ]}
          onLayout={onContentLayout}
          importantForAccessibility={isOpen ? "yes" : "no-hide-descendants"}
          aria-hidden={!isOpen}
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
              onSubmitEditing={session.handleTextSubmit}
              returnKeyType="search"
              accessibilityLabel="Food description"
            />
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
              style={({ pressed }) => [
                styles.iconButton,
                {
                  borderColor: theme.border,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Feather name="camera" size={20} color={theme.textSecondary} />
            </Pressable>
          </View>

          {/* Parse error */}
          {session.parseError && (
            <ThemedText
              style={[styles.errorText, { color: theme.error }]}
              accessibilityLiveRegion="polite"
            >
              {session.parseError}
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
                      backgroundColor: theme.link,
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

              {session.submitError && (
                <ThemedText
                  style={[styles.errorText, { color: theme.error }]}
                  accessibilityLiveRegion="polite"
                >
                  {session.submitError}
                </ThemedText>
              )}
            </View>
          )}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    minHeight: 48,
    gap: Spacing.md,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  label: { flex: 1 },
  clipContainer: { overflow: "hidden" },
  drawerBody: {
    position: "absolute",
    width: "100%",
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
    paddingTop: Spacing.sm,
    gap: Spacing.sm,
  },
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
