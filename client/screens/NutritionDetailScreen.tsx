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
import { SkeletonBox, SkeletonProvider } from "@/components/SkeletonLoader";
import { FallbackImage } from "@/components/FallbackImage";
import { useTheme } from "@/hooks/useTheme";
import { useAccessibility } from "@/hooks/useAccessibility";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  Shadows,
  withOpacity,
} from "@/constants/theme";
import {
  getServingContextLabel,
  roundToOneDecimal,
} from "@/screens/nutrition-detail-utils";
import { MicronutrientSection } from "@/components/MicronutrientSection";
import { VerificationBadge } from "@/components/VerificationBadge";
import { ServingControls } from "@/components/ServingControls";
import { ScanFlagBadge } from "@/components/ScanFlagBadge";
import { useNutritionLookup } from "@/hooks/useNutritionLookup";
import { useOfflineGuard } from "@/hooks/useOfflineGuard";
import type { NutritionDetailScreenNavigationProp } from "@/types/navigation";

type RouteParams = {
  barcode?: string;
  imageUri?: string;
  itemId?: number;
};

function NutritionDetailSkeleton() {
  React.useEffect(() => {
    AccessibilityInfo.announceForAccessibility("Loading");
  }, []);

  return (
    <SkeletonProvider>
      <View
        accessibilityElementsHidden
        style={{ alignItems: "center", padding: Spacing.lg }}
      >
        {/* Product image */}
        <SkeletonBox
          width="100%"
          height={150}
          borderRadius={BorderRadius.card}
        />
        {/* Product name */}
        <SkeletonBox
          width="60%"
          height={24}
          style={{ marginTop: Spacing.xl }}
        />
        {/* Brand name */}
        <SkeletonBox
          width="40%"
          height={16}
          style={{ marginTop: Spacing.sm }}
        />
        {/* Serving size */}
        <SkeletonBox
          width="30%"
          height={14}
          style={{ marginTop: Spacing.sm }}
        />

        {/* Hero calorie card: caption, calorie figure, macro tile row */}
        <View
          style={{
            width: "100%",
            alignItems: "flex-start",
            gap: Spacing.sm,
            padding: Spacing.xl,
            marginTop: Spacing.xl,
            marginBottom: Spacing["2xl"],
          }}
        >
          <SkeletonBox width={120} height={12} />
          <SkeletonBox width={140} height={44} />
          <View
            style={{
              flexDirection: "row",
              gap: Spacing.sm,
              width: "100%",
              marginTop: Spacing.sm,
            }}
          >
            <SkeletonBox
              width="31%"
              height={56}
              borderRadius={BorderRadius.sm}
            />
            <SkeletonBox
              width="31%"
              height={56}
              borderRadius={BorderRadius.sm}
            />
            <SkeletonBox
              width="31%"
              height={56}
              borderRadius={BorderRadius.sm}
            />
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
    </SkeletonProvider>
  );
}

export default function NutritionDetailScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme, isDark } = useTheme();
  const { reducedMotion } = useAccessibility();
  const { isOffline, offlineLabel } = useOfflineGuard();
  const navigation = useNavigation<NutritionDetailScreenNavigationProp>();
  const route = useRoute<RouteProp<{ params: RouteParams }, "params">>();

  const { barcode, imageUri, itemId } = route.params || {};

  // Offline transitions are announced by the always-mounted global OfflineBanner
  // (client/components/OfflineBanner.tsx) — iOS via announceForAccessibility,
  // Android via its assertive live-region alert. A per-screen announce here would
  // double-announce, so none is added.

  const {
    nutrition,
    flags,
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

  const showServingControls =
    !itemId && !!barcode && nutrition?.calories !== undefined;
  // Derived from the SAME serving state that scales the displayed values, so
  // the hero caption can never desync from the numbers it describes.
  const servingContextLabel = getServingContextLabel({
    servingQuantity,
    servingSizeGrams,
    servingOptions,
    isPer100g,
  });

  if (isLoading) {
    return (
      <ThemedView style={styles.container} accessibilityViewIsModal>
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
    <ThemedView style={styles.container} accessibilityViewIsModal>
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
        <Animated.View
          entering={reducedMotion ? undefined : FadeIn.duration(400)}
          style={[
            styles.imageCard,
            { backgroundColor: theme.backgroundSecondary },
          ]}
        >
          <FallbackImage
            source={{ uri: nutrition?.imageUrl ?? undefined }}
            style={styles.productImage}
            fallbackIcon="image"
            fallbackIconSize={30}
            resizeMode="contain"
            accessibilityLabel={
              nutrition?.imageUrl
                ? `Image of ${nutrition.productName || "product"}`
                : "No product image available"
            }
          />
        </Animated.View>

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
              type="small"
              style={[styles.brandName, { color: theme.textSecondary }]}
            >
              {nutrition.brandName}
            </ThemedText>
          ) : null}
          {nutrition?.servingSize && !showServingControls ? (
            <ThemedText
              type="small"
              style={[styles.servingSize, { color: theme.textSecondary }]}
            >
              Serving size: {nutrition.servingSize}
            </ThemedText>
          ) : null}
        </Animated.View>

        {flags.length > 0 ? (
          <Animated.View
            entering={
              reducedMotion ? undefined : FadeInUp.delay(450).duration(400)
            }
            style={styles.additionalNutrients}
          >
            <ThemedText type="h4" style={styles.sectionTitle}>
              For you
            </ThemedText>
            <View style={{ gap: Spacing.sm }}>
              {flags.map((f) => (
                <ScanFlagBadge key={f.id} flag={f} />
              ))}
            </View>
            <ThemedText
              type="caption"
              style={{ color: theme.textSecondary, marginTop: Spacing.xs }}
            >
              Informational only — not medical advice.
            </ThemedText>
          </Animated.View>
        ) : null}

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
        {showServingControls ? (
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
                    backgroundColor: theme.accentSolid,
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
          <Card elevation={1} style={{ backgroundColor: theme.surface }}>
            {/* Only the scan flow populates the serving state this caption is
                derived from — saved items store already-scaled totals, so a
                "Per …" claim there would misdescribe the numbers. */}
            {showServingControls ? (
              <ThemedText
                type="caption"
                style={[styles.heroContext, { color: theme.textSecondary }]}
              >
                Per {servingContextLabel}
              </ThemedText>
            ) : null}
            <View style={styles.calorieRow}>
              <ThemedText
                accessibilityRole="header"
                style={[styles.calorieValue, { color: theme.calorieAccent }]}
              >
                {nutrition?.calories !== undefined
                  ? Math.round(nutrition.calories)
                  : "—"}
              </ThemedText>
              <ThemedText type="small" style={{ color: theme.textSecondary }}>
                kcal
              </ThemedText>
            </View>
            <View style={styles.macroTiles}>
              {(
                [
                  {
                    label: "Protein",
                    value: nutrition?.protein,
                    color: theme.proteinAccent,
                  },
                  {
                    label: "Carbs",
                    value: nutrition?.carbs,
                    color: theme.carbsAccent,
                  },
                  {
                    label: "Fat",
                    value: nutrition?.fat,
                    color: theme.fatAccent,
                  },
                ] as const
              ).map((macro) => (
                <View
                  key={macro.label}
                  style={[
                    styles.macroTile,
                    {
                      backgroundColor: isDark
                        ? theme.backgroundTertiary
                        : theme.backgroundSecondary,
                    },
                  ]}
                >
                  {/* textSecondary fails AA (4.31:1) on the light-mode tile
                      fill (backgroundSecondary) — use full text there; the
                      dark tile passes with textSecondary. */}
                  <ThemedText
                    style={[
                      styles.macroTileLabel,
                      { color: isDark ? theme.textSecondary : theme.text },
                    ]}
                  >
                    {macro.label}
                  </ThemedText>
                  <ThemedText
                    style={[styles.macroTileValue, { color: macro.color }]}
                  >
                    {macro.value !== undefined ? Math.round(macro.value) : "—"}
                    <ThemedText
                      style={[
                        styles.macroTileUnit,
                        { color: isDark ? theme.textSecondary : theme.text },
                      ]}
                    >
                      {" "}
                      g
                    </ThemedText>
                  </ThemedText>
                </View>
              ))}
            </View>
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

        {nutrition?.fiber !== undefined ||
        nutrition?.sugar !== undefined ||
        nutrition?.sodium !== undefined ||
        nutrition?.saturatedFat !== undefined ||
        nutrition?.transFat !== undefined ||
        nutrition?.cholesterol !== undefined ||
        nutrition?.caffeine !== undefined ? (
          <Animated.View
            entering={
              reducedMotion ? undefined : FadeInUp.delay(500).duration(400)
            }
            style={styles.additionalNutrients}
          >
            <ThemedText type="h4" style={styles.sectionTitle}>
              Additional Nutrients
            </ThemedText>
            <View
              style={[
                styles.nutrientsList,
                { backgroundColor: theme.surface },
                !isDark && Shadows.small,
              ]}
            >
              {nutrition?.fiber !== undefined ? (
                <View
                  style={[styles.nutrientRow, { borderTopColor: theme.border }]}
                >
                  <ThemedText type="body" style={styles.nutrientLabel}>
                    Fiber
                  </ThemedText>
                  <ThemedText type="body" style={{ fontWeight: "600" }}>
                    {Math.round(nutrition.fiber)} g
                  </ThemedText>
                </View>
              ) : null}
              {nutrition?.sugar !== undefined ? (
                <View
                  style={[styles.nutrientRow, { borderTopColor: theme.border }]}
                >
                  <ThemedText type="body" style={styles.nutrientLabel}>
                    Sugar
                  </ThemedText>
                  <ThemedText type="body" style={{ fontWeight: "600" }}>
                    {Math.round(nutrition.sugar)} g
                  </ThemedText>
                </View>
              ) : null}
              {nutrition?.sodium !== undefined ? (
                <View
                  style={[styles.nutrientRow, { borderTopColor: theme.border }]}
                >
                  <ThemedText type="body" style={styles.nutrientLabel}>
                    Sodium
                  </ThemedText>
                  <ThemedText type="body" style={{ fontWeight: "600" }}>
                    {Math.round(nutrition.sodium)} mg
                  </ThemedText>
                </View>
              ) : null}
              {nutrition?.saturatedFat !== undefined ? (
                <View
                  style={[styles.nutrientRow, { borderTopColor: theme.border }]}
                >
                  <ThemedText type="body" style={styles.nutrientLabel}>
                    Saturated Fat
                  </ThemedText>
                  <ThemedText type="body" style={{ fontWeight: "600" }}>
                    {roundToOneDecimal(nutrition.saturatedFat)} g
                  </ThemedText>
                </View>
              ) : null}
              {nutrition?.transFat !== undefined ? (
                <View
                  style={[styles.nutrientRow, { borderTopColor: theme.border }]}
                >
                  <ThemedText type="body" style={styles.nutrientLabel}>
                    Trans Fat
                  </ThemedText>
                  <ThemedText type="body" style={{ fontWeight: "600" }}>
                    {roundToOneDecimal(nutrition.transFat)} g
                  </ThemedText>
                </View>
              ) : null}
              {nutrition?.cholesterol !== undefined ? (
                <View
                  style={[styles.nutrientRow, { borderTopColor: theme.border }]}
                >
                  <ThemedText type="body" style={styles.nutrientLabel}>
                    Cholesterol
                  </ThemedText>
                  <ThemedText type="body" style={{ fontWeight: "600" }}>
                    {roundToOneDecimal(nutrition.cholesterol)} mg
                  </ThemedText>
                </View>
              ) : null}
              {nutrition?.caffeine !== undefined ? (
                <View
                  style={[styles.nutrientRow, { borderTopColor: theme.border }]}
                >
                  <ThemedText type="body" style={styles.nutrientLabel}>
                    Caffeine
                  </ThemedText>
                  <ThemedText type="body" style={{ fontWeight: "600" }}>
                    {roundToOneDecimal(nutrition.caffeine)} mg
                  </ThemedText>
                </View>
              ) : null}
            </View>
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
              accessibilityLabel={offlineLabel(
                `Add ${nutrition?.productName || "item"} to today's food log`,
              )}
              accessibilityHint="Saves this item to your daily nutrition tracking"
              style={styles.addButton}
            >
              {offlineLabel("Add to Today")}
            </Button>
            {isOffline && (
              <ThemedText
                type="small"
                style={{
                  color: theme.textSecondary,
                  textAlign: "center",
                  marginTop: Spacing.xs,
                }}
              >
                You&apos;re offline. This will sync when you reconnect.
              </ThemedText>
            )}
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
  imageCard: {
    height: 150,
    borderRadius: BorderRadius.card,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    marginBottom: Spacing.lg,
  },
  productImage: {
    width: "100%",
    height: 150,
  },
  productName: {
    fontSize: 22,
    lineHeight: 28,
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
  heroContext: {
    fontFamily: FontFamily.semiBold,
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  calorieRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  calorieValue: {
    fontSize: 40,
    lineHeight: 44,
    fontFamily: FontFamily.bold,
  },
  macroTiles: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginTop: Spacing.lg,
  },
  macroTile: {
    flex: 1,
    borderRadius: BorderRadius.sm,
    paddingVertical: 10,
    paddingHorizontal: Spacing.md,
  },
  macroTileLabel: {
    fontFamily: FontFamily.medium,
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  macroTileValue: {
    fontFamily: FontFamily.bold,
    fontSize: 18,
    lineHeight: 26,
    marginTop: 2,
  },
  macroTileUnit: {
    fontFamily: FontFamily.medium,
    fontSize: 12,
  },
  additionalNutrients: {
    marginBottom: Spacing["2xl"],
  },
  sectionTitle: {
    marginBottom: Spacing.md,
  },
  nutrientsList: {
    borderRadius: BorderRadius.card,
    overflow: "hidden",
  },
  nutrientRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderTopWidth: 1,
  },
  nutrientLabel: {
    fontWeight: "500",
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
