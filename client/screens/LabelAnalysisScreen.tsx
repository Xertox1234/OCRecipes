import React, { useState, useEffect, useCallback } from "react";
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
import type { VerificationSubmitResponse } from "@shared/types/verification";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

type LabelAnalysisNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  "LabelAnalysis"
>;

type RouteParams = {
  imageUri: string;
  barcode?: string;
  verificationMode?: boolean;
  verifyBarcode?: string;
};

interface NutrientRow {
  label: string;
  value: number | null;
  unit: string;
  indented?: boolean;
  bold?: boolean;
}

function buildNutrientRows(data: LabelExtractionResult): NutrientRow[] {
  return [
    { label: "Calories", value: data.calories, unit: "kcal", bold: true },
    { label: "Total Fat", value: data.totalFat, unit: "g", bold: true },
    {
      label: "Saturated Fat",
      value: data.saturatedFat,
      unit: "g",
      indented: true,
    },
    { label: "Trans Fat", value: data.transFat, unit: "g", indented: true },
    { label: "Cholesterol", value: data.cholesterol, unit: "mg", bold: true },
    { label: "Sodium", value: data.sodium, unit: "mg", bold: true },
    {
      label: "Total Carbohydrates",
      value: data.totalCarbs,
      unit: "g",
      bold: true,
    },
    {
      label: "Dietary Fiber",
      value: data.dietaryFiber,
      unit: "g",
      indented: true,
    },
    {
      label: "Total Sugars",
      value: data.totalSugars,
      unit: "g",
      indented: true,
    },
    {
      label: "Added Sugars",
      value: data.addedSugars,
      unit: "g",
      indented: true,
    },
    { label: "Protein", value: data.protein, unit: "g", bold: true },
    { label: "Vitamin D", value: data.vitaminD, unit: "mcg" },
    { label: "Calcium", value: data.calcium, unit: "mg" },
    { label: "Iron", value: data.iron, unit: "mg" },
    { label: "Potassium", value: data.potassium, unit: "mg" },
  ];
}

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

  // Upload and analyze on mount
  useEffect(() => {
    let cancelled = false;

    async function analyze() {
      try {
        const result = await uploadLabelForAnalysis(imageUri, barcode);
        if (cancelled) return;
        setSessionId(result.sessionId);
        setLabelData(result.labelData);

        if (result.labelData.confidence < 0.3) {
          setError(
            "Could not read the label clearly. Try again with better lighting.",
          );
        }
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : "Failed to analyze label",
        );
      } finally {
        if (!cancelled) setIsAnalyzing(false);
      }
    }

    analyze();
    return () => {
      cancelled = true;
    };
  }, [imageUri, barcode]);

  const confirmMutation = useMutation({
    mutationFn: () => confirmLabelAnalysis(sessionId!, servings),
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

  const verifyMutation = useMutation({
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
      verifyMutation.mutate();
    } else {
      confirmMutation.mutate();
    }
  }, [
    sessionId,
    haptics,
    verificationMode,
    verifyBarcode,
    confirmMutation,
    verifyMutation,
  ]);

  const adjustServings = useCallback(
    (delta: number) => {
      haptics.impact(Haptics.ImpactFeedbackStyle.Light);
      setServings((prev) => Math.max(0.5, Math.round((prev + delta) * 2) / 2));
    },
    [haptics],
  );

  const nutrientRows = labelData ? buildNutrientRows(labelData) : [];
  const macroRows = nutrientRows.slice(0, 11);
  const microRows = nutrientRows.slice(11);

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
          <ThemedText type="h3" style={styles.nutritionTitle}>
            Nutrition Facts
          </ThemedText>
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
            disabled={
              !sessionId ||
              confirmMutation.isPending ||
              verifyMutation.isPending
            }
            loading={confirmMutation.isPending || verifyMutation.isPending}
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
  nutritionTitle: {
    marginBottom: Spacing.sm,
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
