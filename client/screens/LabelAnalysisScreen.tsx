import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import {
  StyleSheet,
  View,
  ScrollView,
  ActivityIndicator,
  Pressable,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useNavigation, useRoute, RouteProp } from "@react-navigation/native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, { FadeInUp } from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useAccessibility } from "@/hooks/useAccessibility";
import { Spacing, BorderRadius, withOpacity } from "@/constants/theme";
import { QUERY_KEYS } from "@/lib/query-keys";
import {
  uploadLabelForAnalysis,
  confirmLabelAnalysis,
  type LabelExtractionResult,
} from "@/lib/photo-upload";
import { apiRequest } from "@/lib/query-client";
import { parseNutritionFromOCR } from "@/lib/nutrition-ocr-parser";
import type { VerificationSubmitResponse } from "@shared/types/verification";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import {
  buildNutrientRows,
  localDataToExtractionResult,
  shouldReplaceWithAI,
} from "./label-analysis-utils";

type LabelAnalysisNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  "LabelAnalysis"
>;

type RouteParams = {
  imageUri: string;
  barcode?: string;
  verificationMode?: boolean;
  verifyBarcode?: string;
  localOCRText?: string;
};

export default function LabelAnalysisScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const { reducedMotion } = useAccessibility();
  const navigation = useNavigation<LabelAnalysisNavigationProp>();
  const route = useRoute<RouteProp<{ params: RouteParams }, "params">>();
  const queryClient = useQueryClient();

  const { imageUri, barcode, verificationMode, verifyBarcode } = route.params;

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [labelData, setLabelData] = useState<LabelExtractionResult | null>(
    null,
  );
  const [servings, setServings] = useState(1);
  const [isAnalyzing, setIsAnalyzing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showMicros, setShowMicros] = useState(false);
  const [dataSource, setDataSource] = useState<"local" | "ai" | null>(null);
  const [showUpdatedToast, setShowUpdatedToast] = useState(false);

  const dataSourceRef = useRef<"local" | "ai" | null>(null);
  const labelDataRef = useRef<LabelExtractionResult | null>(null);

  // Parse local OCR data for instant preview (if available)
  useEffect(() => {
    if (route.params.localOCRText) {
      const localData = parseNutritionFromOCR(route.params.localOCRText);
      if (localData.confidence >= 0.6) {
        const extractionResult = localDataToExtractionResult(localData);
        setLabelData(extractionResult);
        labelDataRef.current = extractionResult;
        setDataSource("local");
        dataSourceRef.current = "local";
        setIsAnalyzing(false);
      }
    }
  }, [route.params.localOCRText]);

  // Upload to OpenAI (always, even with local preview)
  useEffect(() => {
    let cancelled = false;
    let toastTimer: ReturnType<typeof setTimeout> | null = null;

    async function analyze() {
      try {
        const result = await uploadLabelForAnalysis(imageUri, barcode);
        if (cancelled) return;
        setSessionId(result.sessionId);

        if (dataSourceRef.current === "local" && labelDataRef.current) {
          // Compare local vs AI: if significantly different, replace
          const aiData = result.labelData;
          if (shouldReplaceWithAI(labelDataRef.current, aiData)) {
            setLabelData(aiData);
            setDataSource("ai");
            setShowUpdatedToast(true);
            toastTimer = setTimeout(() => setShowUpdatedToast(false), 3000);
          } else {
            // AI confirms local data — just record the session ID
            setDataSource("ai");
          }
        } else {
          // No local preview or low confidence — use AI data directly
          setLabelData(result.labelData);
          setDataSource("ai");

          if (result.labelData.confidence < 0.3) {
            setError(
              "Could not read the label clearly. Try again with better lighting.",
            );
          }
        }
      } catch (err) {
        if (cancelled) return;
        // If we have local data, keep showing it; only set error if no data at all
        if (!labelDataRef.current) {
          setError(
            err instanceof Error ? err.message : "Failed to analyze label",
          );
        }
      } finally {
        if (!cancelled) setIsAnalyzing(false);
      }
    }

    analyze();
    return () => {
      cancelled = true;
      if (toastTimer) clearTimeout(toastTimer);
    };
  }, [imageUri, barcode]);

  const { mutate: confirmLog, isPending: isConfirming } = useMutation({
    mutationFn: () => {
      if (!sessionId) throw new Error("No session");
      return confirmLabelAnalysis(sessionId, servings);
    },
    onSuccess: () => {
      haptics.notification(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.scannedItems });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dailySummary });
      navigation.goBack();
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Failed to log");
    },
  });

  const [verificationResult, setVerificationResult] =
    useState<VerificationSubmitResponse | null>(null);

  const { mutate: verifyLog, isPending: isVerifying } = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/verification/submit", {
        barcode: verifyBarcode,
        sessionId,
      });
      return (await response.json()) as VerificationSubmitResponse;
    },
    onSuccess: (data) => {
      haptics.notification(Haptics.NotificationFeedbackType.Success);
      setVerificationResult(data);
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Verification failed");
    },
  });

  const handleLog = useCallback(() => {
    if (!sessionId) return;
    haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    if (verificationMode && verifyBarcode) {
      verifyLog();
    } else {
      confirmLog();
    }
  }, [
    sessionId,
    haptics,
    verificationMode,
    verifyBarcode,
    confirmLog,
    verifyLog,
  ]);

  const adjustServings = useCallback(
    (delta: number) => {
      haptics.impact(Haptics.ImpactFeedbackStyle.Light);
      setServings((prev) => Math.max(0.5, Math.round((prev + delta) * 2) / 2));
    },
    [haptics],
  );

  const nutrientRows = useMemo(
    () => (labelData ? buildNutrientRows(labelData) : []),
    [labelData],
  );
  const macroRows = useMemo(() => nutrientRows.slice(0, 11), [nutrientRows]);
  const microRows = useMemo(() => nutrientRows.slice(11), [nutrientRows]);

  if (isAnalyzing) {
    return (
      <ThemedView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator
            size="large"
            color={theme.success}
            accessibilityLabel="Analyzing nutrition label"
          />
          <ThemedText
            type="body"
            style={[styles.loadingText, { color: theme.textSecondary }]}
          >
            Reading nutrition label...
          </ThemedText>
        </View>
      </ThemedView>
    );
  }

  if (error && !labelData) {
    return (
      <ThemedView style={styles.container}>
        <View style={styles.loadingContainer}>
          <Feather name="alert-circle" size={48} color={theme.error} />
          <ThemedText
            type="body"
            style={[styles.loadingText, { color: theme.error }]}
          >
            {error}
          </ThemedText>
          <Button
            onPress={() => navigation.goBack()}
            style={{ marginTop: Spacing.lg }}
          >
            Try Again
          </Button>
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: headerHeight + Spacing.md,
            paddingBottom: insets.bottom + Spacing.xl + 80,
          },
        ]}
      >
        {/* Product Name */}
        {labelData?.productName && (
          <ThemedText type="h3" style={styles.productName}>
            {labelData.productName}
          </ThemedText>
        )}

        {/* Serving Size */}
        <Card elevation={1} style={styles.servingCard}>
          <View style={styles.servingSizeRow}>
            <ThemedText type="body" style={{ fontWeight: "600" }}>
              Serving Size
            </ThemedText>
            <ThemedText type="body" style={{ color: theme.textSecondary }}>
              {labelData?.servingSize || "—"}
            </ThemedText>
          </View>

          <View style={styles.servingAdjuster}>
            <ThemedText type="body" style={{ fontWeight: "600" }}>
              Servings consumed
            </ThemedText>
            <View style={styles.servingControls}>
              <Pressable
                onPress={() => adjustServings(-0.5)}
                accessibilityLabel="Decrease servings"
                accessibilityRole="button"
                style={[
                  styles.servingButton,
                  { backgroundColor: withOpacity(theme.link, 0.1) },
                ]}
              >
                <Feather name="minus" size={18} color={theme.link} />
              </Pressable>
              <ThemedText
                type="h3"
                style={styles.servingValue}
                accessibilityLabel={`${servings} servings`}
              >
                {servings}
              </ThemedText>
              <Pressable
                onPress={() => adjustServings(0.5)}
                accessibilityLabel="Increase servings"
                accessibilityRole="button"
                style={[
                  styles.servingButton,
                  { backgroundColor: withOpacity(theme.link, 0.1) },
                ]}
              >
                <Feather name="plus" size={18} color={theme.link} />
              </Pressable>
            </View>
          </View>
        </Card>

        {/* Nutrition Table */}
        <Card elevation={1} style={styles.nutritionCard}>
          <View style={styles.nutritionTitleRow}>
            <ThemedText type="h3" style={styles.nutritionTitle}>
              Nutrition Facts
            </ThemedText>
            {dataSource === "local" && (
              <View
                style={[
                  styles.sourceBadge,
                  { backgroundColor: withOpacity(theme.info, 0.12) },
                ]}
              >
                <Feather name="smartphone" size={12} color={theme.info} />
                <ThemedText
                  type="small"
                  style={{ color: theme.info, fontWeight: "600" }}
                >
                  Scanned locally
                </ThemedText>
              </View>
            )}
          </View>
          <View
            style={[styles.dividerThick, { backgroundColor: theme.text }]}
          />

          {macroRows.map((row, index) => {
            const scaledValue =
              row.value != null
                ? Math.round(row.value * servings * 10) / 10
                : null;
            return (
              <Animated.View
                key={row.label}
                entering={
                  reducedMotion
                    ? undefined
                    : FadeInUp.delay(index * 30).duration(250)
                }
              >
                <View
                  style={[
                    styles.nutrientRow,
                    row.bold && styles.nutrientRowBold,
                    { borderBottomColor: withOpacity(theme.text, 0.1) },
                  ]}
                >
                  <ThemedText
                    type="body"
                    style={[
                      row.indented && styles.indented,
                      row.bold && { fontWeight: "700" },
                    ]}
                  >
                    {row.label}
                  </ThemedText>
                  <ThemedText
                    type="body"
                    style={row.bold ? { fontWeight: "700" } : undefined}
                  >
                    {scaledValue != null ? `${scaledValue}${row.unit}` : "—"}
                  </ThemedText>
                </View>
              </Animated.View>
            );
          })}

          {/* Micronutrients (collapsible) */}
          {microRows.some((r) => r.value != null) && (
            <>
              <Pressable
                onPress={() => setShowMicros(!showMicros)}
                accessibilityRole="button"
                accessibilityLabel={
                  showMicros
                    ? "Hide vitamins and minerals"
                    : "Show vitamins and minerals"
                }
                style={[
                  styles.microToggle,
                  { borderBottomColor: withOpacity(theme.text, 0.1) },
                ]}
              >
                <ThemedText
                  type="body"
                  style={{ color: theme.link, fontWeight: "600" }}
                >
                  Vitamins & Minerals
                </ThemedText>
                <Feather
                  name={showMicros ? "chevron-up" : "chevron-down"}
                  size={18}
                  color={theme.link}
                />
              </Pressable>

              {showMicros &&
                microRows.map((row) => {
                  const scaledValue =
                    row.value != null
                      ? Math.round(row.value * servings * 10) / 10
                      : null;
                  return (
                    <View
                      key={row.label}
                      style={[
                        styles.nutrientRow,
                        {
                          borderBottomColor: withOpacity(theme.text, 0.1),
                        },
                      ]}
                    >
                      <ThemedText type="body">{row.label}</ThemedText>
                      <ThemedText type="body">
                        {scaledValue != null
                          ? `${scaledValue}${row.unit}`
                          : "—"}
                      </ThemedText>
                    </View>
                  );
                })}
            </>
          )}
        </Card>

        {dataSource === "local" && !sessionId && (
          <View style={styles.aiProgressRow}>
            <ActivityIndicator size="small" color={theme.textSecondary} />
            <ThemedText type="small" style={{ color: theme.textSecondary }}>
              Verifying with AI...
            </ThemedText>
          </View>
        )}

        {/* Confidence indicator */}
        {labelData && labelData.confidence < 0.7 && (
          <View
            style={[
              styles.warningBanner,
              { backgroundColor: withOpacity(theme.warning, 0.12) },
            ]}
          >
            <Feather name="alert-triangle" size={16} color={theme.warning} />
            <ThemedText type="small" style={{ color: theme.warning, flex: 1 }}>
              Some values may be inaccurate. Review before logging.
            </ThemedText>
          </View>
        )}
      </ScrollView>

      {/* Verification success feedback */}
      {verificationResult && (
        <View
          style={[
            styles.verificationFeedback,
            {
              backgroundColor: withOpacity(
                verificationResult.isMatch ? theme.success : theme.warning,
                0.12,
              ),
            },
          ]}
          accessibilityRole="alert"
        >
          <Feather
            name={verificationResult.isMatch ? "check-circle" : "info"}
            size={20}
            color={verificationResult.isMatch ? theme.success : theme.warning}
          />
          <ThemedText
            type="body"
            style={{
              color: verificationResult.isMatch ? theme.success : theme.warning,
              flex: 1,
            }}
          >
            {verificationResult.isMatch
              ? `Thanks for verifying! (${verificationResult.verificationCount}/3 confirmations)`
              : "Values differ from other scans. We've recorded your data."}
          </ThemedText>
        </View>
      )}

      {/* Front-label CTA after verification */}
      {verificationResult?.canScanFrontLabel && verifyBarcode && (
        <View
          style={[
            styles.frontLabelCta,
            { backgroundColor: withOpacity(theme.info, 0.08) },
          ]}
        >
          <ThemedText type="body" style={{ color: theme.textSecondary }}>
            Want to add more detail? Scan the front of the package to capture
            brand, dietary claims, and more.
          </ThemedText>
          <Button
            onPress={() =>
              navigation.replace("Scan", {
                mode: "front-label",
                verifyBarcode,
              })
            }
            variant="secondary"
            style={{ marginTop: Spacing.sm }}
            accessibilityLabel="Scan front of package label"
          >
            Scan Front Label
          </Button>
        </View>
      )}

      {showUpdatedToast && (
        <Animated.View
          entering={FadeInUp.duration(200)}
          style={[
            styles.updatedToast,
            { backgroundColor: withOpacity(theme.info, 0.12) },
          ]}
        >
          <Feather name="check-circle" size={14} color={theme.info} />
          <ThemedText type="small" style={{ color: theme.info }}>
            Updated with AI analysis
          </ThemedText>
        </Animated.View>
      )}

      {/* Fixed Action Button */}
      <View
        style={[
          styles.bottomBar,
          {
            paddingBottom: insets.bottom + Spacing.md,
            backgroundColor: theme.backgroundDefault,
            borderTopColor: withOpacity(theme.text, 0.08),
          },
        ]}
      >
        {verificationResult ? (
          <Button onPress={() => navigation.goBack()} style={{ flex: 1 }}>
            Done
          </Button>
        ) : (
          <Button
            onPress={handleLog}
            disabled={!sessionId || isConfirming || isVerifying}
            loading={isConfirming || isVerifying}
            style={{ flex: 1 }}
          >
            {verificationMode
              ? "Submit Verification"
              : `Log ${labelData?.calories != null ? Math.round(labelData.calories * servings) : "—"} cal`}
          </Button>
        )}
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing["2xl"],
  },
  loadingText: {
    marginTop: Spacing.lg,
    textAlign: "center",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.lg,
  },
  productName: {
    marginBottom: Spacing.md,
  },
  servingCard: {
    padding: Spacing.lg,
    marginBottom: Spacing.md,
    gap: Spacing.md,
  },
  servingSizeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  servingAdjuster: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  servingControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  servingButton: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.full,
    justifyContent: "center",
    alignItems: "center",
  },
  servingValue: {
    minWidth: 32,
    textAlign: "center",
  },
  nutritionCard: {
    padding: Spacing.lg,
    marginBottom: Spacing.md,
  },
  nutritionTitleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.sm,
  },
  nutritionTitle: {},
  sourceBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
  },
  updatedToast: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    padding: Spacing.sm,
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
    borderRadius: BorderRadius.sm,
    justifyContent: "center",
  },
  aiProgressRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  dividerThick: {
    height: 3,
    marginBottom: Spacing.sm,
  },
  nutrientRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  nutrientRowBold: {
    borderBottomWidth: 1,
  },
  indented: {
    paddingLeft: Spacing.lg,
  },
  microToggle: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  warningBanner: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    gap: Spacing.sm,
  },
  bottomBar: {
    flexDirection: "row",
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  verificationFeedback: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.md,
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
    borderRadius: BorderRadius.sm,
  },
  frontLabelCta: {
    padding: Spacing.md,
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
    borderRadius: BorderRadius.sm,
  },
});
