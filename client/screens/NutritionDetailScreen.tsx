import React from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  StyleSheet,
  View,
  ScrollView,
  Pressable,
  TextInput as RNTextInput,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useNavigation, useRoute, RouteProp } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import Animated, { FadeInUp, FadeIn } from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { SkeletonBox } from "@/components/SkeletonLoader";
import { FallbackImage } from "@/components/FallbackImage";
import { useTheme } from "@/hooks/useTheme";
import { useAccessibility } from "@/hooks/useAccessibility";
import { Spacing, BorderRadius, withOpacity } from "@/constants/theme";
import { MicronutrientSection } from "@/components/MicronutrientSection";
import { VerificationBadge } from "@/components/VerificationBadge";
import { ServingControls } from "@/components/ServingControls";
import { useNutritionLookup } from "@/hooks/useNutritionLookup";
import type { NutritionDetailScreenNavigationProp } from "@/types/navigation";

type RouteParams = {
  barcode?: string;
  imageUri?: string;
  itemId?: number;
};

function MacroCard({
  label,
  value,
  unit,
  color,
  index,
  reducedMotion,
}: {
  label: string;
  value?: number;
  unit: string;
  color: string;
  index: number;
  reducedMotion: boolean;
}) {
  const { theme } = useTheme();

  // Skip entrance animation when reduced motion is preferred
  const enteringAnimation = reducedMotion
    ? undefined
    : FadeInUp.delay(index * 100).duration(400);

  return (
    <Animated.View entering={enteringAnimation} style={styles.macroCardWrapper}>
      <Card elevation={1} style={styles.macroCard}>
        <View style={[styles.macroAccent, { backgroundColor: color }]} />
        <View style={styles.macroContent}>
          <ThemedText type="h3" style={{ color }}>
            {value !== undefined ? Math.round(value) : "—"}
          </ThemedText>
          <ThemedText type="small" style={{ color: theme.textSecondary }}>
            {unit}
          </ThemedText>
        </View>
        <ThemedText type="small" style={styles.macroLabel}>
          {label}
        </ThemedText>
      </Card>
    </Animated.View>
  );
}

function NutritionDetailSkeleton() {
  React.useEffect(() => {
    AccessibilityInfo.announceForAccessibility("Loading");
  }, []);

  return (
    <View
      accessibilityElementsHidden
      style={{ alignItems: "center", padding: Spacing.lg }}
    >
      {/* Product image */}
      <SkeletonBox width={160} height={160} borderRadius={BorderRadius.lg} />
      {/* Product name */}
      <SkeletonBox width="60%" height={24} style={{ marginTop: Spacing.xl }} />
      {/* Brand name */}
      <SkeletonBox width="40%" height={16} style={{ marginTop: Spacing.sm }} />
      {/* Serving size */}
      <SkeletonBox width="30%" height={14} style={{ marginTop: Spacing.sm }} />

      {/* Hero calorie card */}
      <View
        style={{
          width: "100%",
          alignItems: "center",
          padding: Spacing["2xl"],
          marginTop: Spacing.xl,
          marginBottom: Spacing["2xl"],
        }}
      >
        <SkeletonBox width={120} height={48} />
        <SkeletonBox width={80} height={16} style={{ marginTop: Spacing.sm }} />
      </View>

      {/* Macro cards row */}
      <View
        style={{
          flexDirection: "row",
          gap: Spacing.md,
          width: "100%",
          marginBottom: Spacing["2xl"],
        }}
      >
        <View style={{ flex: 1, alignItems: "center", gap: Spacing.xs }}>
          <SkeletonBox width="80%" height={28} />
          <SkeletonBox width="60%" height={14} />
        </View>
        <View style={{ flex: 1, alignItems: "center", gap: Spacing.xs }}>
          <SkeletonBox width="80%" height={28} />
          <SkeletonBox width="60%" height={14} />
        </View>
        <View style={{ flex: 1, alignItems: "center", gap: Spacing.xs }}>
          <SkeletonBox width="80%" height={28} />
          <SkeletonBox width="60%" height={14} />
        </View>
      </View>

      {/* Additional nutrients title */}
      <View style={{ width: "100%" }}>
        <SkeletonBox
          width={180}
          height={20}
          style={{ marginBottom: Spacing.md }}
        />
        {/* Nutrient rows */}
        <View style={{ gap: Spacing.sm }}>
          <View
            style={{ flexDirection: "row", justifyContent: "space-between" }}
          >
            <SkeletonBox width={60} height={16} />
            <SkeletonBox width={40} height={16} />
          </View>
          <View
            style={{ flexDirection: "row", justifyContent: "space-between" }}
          >
            <SkeletonBox width={50} height={16} />
            <SkeletonBox width={40} height={16} />
          </View>
          <View
            style={{ flexDirection: "row", justifyContent: "space-between" }}
          >
            <SkeletonBox width={70} height={16} />
            <SkeletonBox width={50} height={16} />
          </View>
        </View>
      </View>
    </View>
  );
}

export default function NutritionDetailScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();
  const navigation = useNavigation<NutritionDetailScreenNavigationProp>();
  const route = useRoute<RouteProp<{ params: RouteParams }, "params">>();

  const { barcode, imageUri, itemId } = route.params || {};

  const {
    nutrition,
    verificationLevel,
    hasFrontLabelData,
    isLoading,
    error,
    isPer100g,
    servingQuantity,
    setServingQuantity,
    servingSizeGrams,
    setServingSizeGrams,
    customGramsInput,
    setCustomGramsInput,
    showCustomInput,
    setShowCustomInput,
    correctionNotice,
    showManualSearch,
    manualSearchQuery,
    setManualSearchQuery,
    isSearching,
    servingOptions,
    recalculateNutrition,
    micronutrientData,
    micronutrientsLoading,
    handleManualSearch,
    addToLogMutation,
    handleAddToLog,
  } = useNutritionLookup({ barcode, imageUri, itemId });

  if (isLoading) {
    return (
      <ThemedView style={styles.container}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[
            styles.content,
            {
              paddingTop: headerHeight + Spacing.xl,
              paddingBottom: insets.bottom + Spacing["3xl"],
            },
          ]}
        >
          <NutritionDetailSkeleton />
        </ScrollView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: headerHeight + Spacing.xl,
            paddingBottom: insets.bottom + Spacing["3xl"],
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {nutrition?.imageUrl ? (
          <Animated.View
            entering={reducedMotion ? undefined : FadeIn.duration(400)}
            style={styles.imageContainer}
          >
            <FallbackImage
              source={{ uri: nutrition.imageUrl ?? undefined }}
              style={styles.productImage}
              fallbackIcon="package"
              fallbackIconSize={40}
              resizeMode="contain"
              accessibilityLabel={`Image of ${nutrition.productName || "product"}`}
            />
          </Animated.View>
        ) : null}

        <Animated.View
          entering={
            reducedMotion ? undefined : FadeInUp.delay(100).duration(400)
          }
        >
          <ThemedText type="h2" style={styles.productName}>
            {nutrition?.productName || "Unknown Product"}
          </ThemedText>
          {nutrition?.brandName ? (
            <ThemedText
              type="body"
              style={[styles.brandName, { color: theme.textSecondary }]}
            >
              {nutrition.brandName}
            </ThemedText>
          ) : null}
          {nutrition?.servingSize ? (
            <ThemedText
              type="small"
              style={[styles.servingSize, { color: theme.textSecondary }]}
            >
              Serving size: {nutrition.servingSize}
            </ThemedText>
          ) : null}
        </Animated.View>

        {correctionNotice && !itemId ? (
          <View
            accessibilityLiveRegion="polite"
            style={[
              styles.correctionContainer,
              { backgroundColor: withOpacity(theme.warning, 0.1) },
            ]}
          >
            <Feather name="zap" size={16} color={theme.warning} />
            <View style={{ flex: 1 }}>
              <ThemedText
                type="small"
                style={{ color: theme.warning, fontWeight: "600" }}
              >
                Serving size adjusted
              </ThemedText>
              <ThemedText type="small" style={{ color: theme.warning }}>
                {correctionNotice}
              </ThemedText>
            </View>
          </View>
        ) : null}

        {/* ── Serving size & quantity controls ── */}
        {!itemId && barcode && nutrition?.calories !== undefined ? (
          <ServingControls
            servingOptions={servingOptions}
            servingSizeGrams={servingSizeGrams}
            setServingSizeGrams={setServingSizeGrams}
            servingQuantity={servingQuantity}
            setServingQuantity={setServingQuantity}
            showCustomInput={showCustomInput}
            setShowCustomInput={setShowCustomInput}
            customGramsInput={customGramsInput}
            setCustomGramsInput={setCustomGramsInput}
            recalculateNutrition={recalculateNutrition}
          />
        ) : null}

        {error ? (
          <View
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={[
              styles.warningContainer,
              { backgroundColor: withOpacity(theme.warning, 0.12) },
            ]}
          >
            <Feather name="alert-triangle" size={20} color={theme.warning} />
            <ThemedText type="small" style={{ color: theme.warning, flex: 1 }}>
              {error}
            </ThemedText>
          </View>
        ) : null}

        {showManualSearch ? (
          <Card elevation={1} style={styles.manualSearchCard}>
            <View style={styles.manualSearchHeader}>
              <Feather name="search" size={20} color={theme.link} />
              <View style={{ flex: 1, marginLeft: Spacing.sm }}>
                <ThemedText
                  type="body"
                  style={{ fontWeight: "600", marginBottom: 2 }}
                >
                  Barcode not recognized
                </ThemedText>
                <ThemedText type="small" style={{ color: theme.textSecondary }}>
                  Type the product name to look up nutrition info
                </ThemedText>
              </View>
            </View>
            <View style={styles.manualSearchRow}>
              <RNTextInput
                style={[
                  styles.manualSearchInput,
                  {
                    color: theme.text,
                    borderColor: withOpacity(theme.text, 0.2),
                    backgroundColor: withOpacity(theme.text, 0.04),
                  },
                ]}
                placeholder="e.g. coffee whitener, granola bar..."
                placeholderTextColor={withOpacity(theme.text, 0.4)}
                value={manualSearchQuery}
                onChangeText={setManualSearchQuery}
                onSubmitEditing={() => handleManualSearch(manualSearchQuery)}
                returnKeyType="search"
                autoFocus
                editable={!isSearching}
                accessibilityLabel="Search for a product"
              />
              <Pressable
                style={({ pressed }) => [
                  styles.manualSearchButton,
                  {
                    backgroundColor: theme.link,
                    opacity: isSearching || !manualSearchQuery.trim() ? 0.5 : 1,
                  },
                  pressed && { opacity: 0.7 },
                ]}
                onPress={() => handleManualSearch(manualSearchQuery)}
                disabled={isSearching || !manualSearchQuery.trim()}
                accessibilityLabel="Search for product"
                accessibilityRole="button"
              >
                {isSearching ? (
                  <ActivityIndicator size="small" color={theme.buttonText} />
                ) : (
                  <Feather
                    name="arrow-right"
                    size={20}
                    color={theme.buttonText}
                  />
                )}
              </Pressable>
            </View>
          </Card>
        ) : null}

        <Animated.View
          entering={
            reducedMotion ? undefined : FadeInUp.delay(200).duration(400)
          }
          style={styles.calorieCard}
        >
          <Card
            elevation={2}
            style={[
              styles.heroCalorieCard,
              { borderColor: theme.calorieAccent, borderWidth: 2 },
            ]}
          >
            <ThemedText
              type="h1"
              style={[styles.calorieValue, { color: theme.calorieAccent }]}
            >
              {nutrition?.calories !== undefined
                ? Math.round(nutrition.calories)
                : "—"}
            </ThemedText>
            <ThemedText type="body" style={{ color: theme.textSecondary }}>
              Calories{isPer100g ? " (per 100g)" : ""}
            </ThemedText>
          </Card>
        </Animated.View>

        {isPer100g && !itemId ? (
          <View
            style={[
              styles.infoContainer,
              { backgroundColor: withOpacity(theme.info, 0.08) },
            ]}
          >
            <Feather name="info" size={16} color={theme.info} />
            <ThemedText type="small" style={{ color: theme.info, flex: 1 }}>
              Values shown per 100g. Check package for actual serving size.
            </ThemedText>
          </View>
        ) : null}

        <View style={styles.macrosGrid}>
          <MacroCard
            label="Protein"
            value={nutrition?.protein}
            unit="g"
            color={theme.proteinAccent}
            index={0}
            reducedMotion={reducedMotion}
          />
          <MacroCard
            label="Carbs"
            value={nutrition?.carbs}
            unit="g"
            color={theme.carbsAccent}
            index={1}
            reducedMotion={reducedMotion}
          />
          <MacroCard
            label="Fat"
            value={nutrition?.fat}
            unit="g"
            color={theme.fatAccent}
            index={2}
            reducedMotion={reducedMotion}
          />
        </View>

        {nutrition?.fiber !== undefined ||
        nutrition?.sugar !== undefined ||
        nutrition?.sodium !== undefined ? (
          <Animated.View
            entering={
              reducedMotion ? undefined : FadeInUp.delay(500).duration(400)
            }
            style={styles.additionalNutrients}
          >
            <ThemedText type="h4" style={styles.sectionTitle}>
              Additional Nutrients
            </ThemedText>
            <Card elevation={1} style={styles.nutrientsList}>
              {nutrition?.fiber !== undefined ? (
                <View
                  style={[
                    styles.nutrientRow,
                    { borderBottomColor: theme.border },
                  ]}
                >
                  <ThemedText type="body">Fiber</ThemedText>
                  <ThemedText type="body" style={{ fontWeight: "600" }}>
                    {Math.round(nutrition.fiber)}g
                  </ThemedText>
                </View>
              ) : null}
              {nutrition?.sugar !== undefined ? (
                <View
                  style={[
                    styles.nutrientRow,
                    { borderBottomColor: theme.border },
                  ]}
                >
                  <ThemedText type="body">Sugar</ThemedText>
                  <ThemedText type="body" style={{ fontWeight: "600" }}>
                    {Math.round(nutrition.sugar)}g
                  </ThemedText>
                </View>
              ) : null}
              {nutrition?.sodium !== undefined ? (
                <View
                  style={[
                    styles.nutrientRow,
                    { borderBottomColor: theme.border },
                  ]}
                >
                  <ThemedText type="body">Sodium</ThemedText>
                  <ThemedText type="body" style={{ fontWeight: "600" }}>
                    {Math.round(nutrition.sodium)}mg
                  </ThemedText>
                </View>
              ) : null}
            </Card>
          </Animated.View>
        ) : null}

        {/* Micronutrients — collapsible section */}
        {nutrition?.productName &&
        nutrition.productName !== "Unknown Product" &&
        nutrition.productName !== "Product Not Found" ? (
          <Animated.View
            entering={
              reducedMotion ? undefined : FadeInUp.delay(600).duration(400)
            }
            style={styles.micronutrientSection}
          >
            <MicronutrientSection
              micronutrients={micronutrientData?.micronutrients ?? []}
              isLoading={micronutrientsLoading}
              reducedMotion={reducedMotion}
            />
          </Animated.View>
        ) : null}

        {/* Verification badge + CTA */}
        {!itemId && barcode && nutrition && (
          <View style={styles.verificationSection}>
            <VerificationBadge level={verificationLevel} />

            {verificationLevel !== "verified" && (
              <Pressable
                onPress={() =>
                  navigation.navigate("Scan", {
                    mode: "label",
                    verifyBarcode: barcode,
                  })
                }
                accessibilityLabel="Verify nutrition data with a label photo"
                accessibilityRole="button"
                style={[
                  styles.verifyPrompt,
                  { backgroundColor: withOpacity(theme.info, 0.08) },
                ]}
              >
                <Feather name="camera" size={18} color={theme.info} />
                <View style={{ flex: 1 }}>
                  <ThemedText
                    type="body"
                    style={{ color: theme.info, fontWeight: "600" }}
                  >
                    Help verify this product
                  </ThemedText>
                  <ThemedText type="small" style={{ color: theme.info }}>
                    Scan the nutrition label to confirm data
                  </ThemedText>
                </View>
                <Feather name="chevron-right" size={18} color={theme.info} />
              </Pressable>
            )}

            {/* Retroactive front-label CTA for verified products without front-label data */}
            {verificationLevel !== "unverified" && !hasFrontLabelData && (
              <Pressable
                onPress={() =>
                  navigation.navigate("Scan", {
                    mode: "front-label",
                    verifyBarcode: barcode,
                  })
                }
                accessibilityLabel="Scan front of package to add product details"
                accessibilityRole="button"
                style={[
                  styles.verifyPrompt,
                  { backgroundColor: withOpacity(theme.textSecondary, 0.06) },
                ]}
              >
                <Feather name="package" size={18} color={theme.textSecondary} />
                <View style={{ flex: 1 }}>
                  <ThemedText
                    type="body"
                    style={{ color: theme.textSecondary, fontWeight: "600" }}
                  >
                    Add product details
                  </ThemedText>
                  <ThemedText
                    type="small"
                    style={{ color: theme.textSecondary }}
                  >
                    Scan front of package
                  </ThemedText>
                </View>
                <Feather
                  name="chevron-right"
                  size={18}
                  color={theme.textSecondary}
                />
              </Pressable>
            )}
          </View>
        )}

        {!itemId ? (
          <View style={styles.buttonContainer}>
            <Button
              onPress={handleAddToLog}
              loading={addToLogMutation.isPending}
              accessibilityLabel={`Add ${nutrition?.productName || "item"} to today's food log`}
              accessibilityHint="Saves this item to your daily nutrition tracking"
              style={[styles.addButton, { backgroundColor: theme.success }]}
            >
              Add to Today
            </Button>
          </View>
        ) : null}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.lg,
  },
  imageContainer: {
    alignItems: "center",
    marginBottom: Spacing["2xl"],
  },
  productImage: {
    width: 160,
    height: 160,
    borderRadius: BorderRadius.lg,
  },
  productName: {
    textAlign: "center",
    marginBottom: Spacing.xs,
  },
  brandName: {
    textAlign: "center",
    marginBottom: Spacing.xs,
  },
  servingSize: {
    textAlign: "center",
    marginBottom: Spacing.lg,
  },
  warningContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.xs,
    marginBottom: Spacing.lg,
  },
  infoContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.xs,
    marginBottom: Spacing.lg,
  },
  calorieCard: {
    marginBottom: Spacing["2xl"],
  },
  heroCalorieCard: {
    alignItems: "center",
    padding: Spacing["2xl"],
    borderRadius: BorderRadius.lg,
  },
  calorieValue: {
    fontSize: 56,
    lineHeight: 64,
    fontWeight: "700",
  },
  macrosGrid: {
    flexDirection: "row",
    gap: Spacing.md,
    marginBottom: Spacing["2xl"],
  },
  macroCardWrapper: {
    flex: 1,
  },
  macroCard: {
    padding: Spacing.lg,
    alignItems: "center",
    position: "relative",
    overflow: "hidden",
  },
  macroAccent: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    borderTopLeftRadius: BorderRadius["2xl"],
    borderBottomLeftRadius: BorderRadius["2xl"],
  },
  macroContent: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 2,
    marginBottom: Spacing.xs,
  },
  macroLabel: {
    fontWeight: "500",
  },
  additionalNutrients: {
    marginBottom: Spacing["2xl"],
  },
  sectionTitle: {
    marginBottom: Spacing.md,
  },
  nutrientsList: {
    padding: 0,
  },
  nutrientRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderBottomWidth: 1,
  },
  buttonContainer: {
    marginTop: Spacing.lg,
  },
  addButton: {
    marginBottom: Spacing.md,
  },
  micronutrientSection: {
    marginBottom: Spacing["2xl"],
  },
  verificationSection: {
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  verifyPrompt: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
  },
  correctionContainer: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.xs,
    marginBottom: Spacing.lg,
  },
  manualSearchCard: {
    padding: Spacing.lg,
    marginBottom: Spacing["2xl"],
  },
  manualSearchHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: Spacing.md,
  },
  manualSearchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  manualSearchInput: {
    flex: 1,
    height: 44,
    borderRadius: BorderRadius.xs,
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
    fontSize: 16,
  },
  manualSearchButton: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.xs,
    alignItems: "center",
    justifyContent: "center",
  },
});
