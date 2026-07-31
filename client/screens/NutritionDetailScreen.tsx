import React, { useEffect, useState } from "react";
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
import Animated, { FadeInUp } from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { SkeletonBox, SkeletonProvider } from "@/components/SkeletonLoader";
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
import { ProductHero } from "@/components/nutrition/ProductHero";
import { FlagSections } from "@/components/nutrition/FlagSections";
import { CapturedPhotos } from "@/components/nutrition/CapturedPhotos";
import { VerificationPanel } from "@/components/nutrition/VerificationPanel";
import { MicronutrientSection } from "@/components/MicronutrientSection";
import { ServingControls } from "@/components/ServingControls";
import { ScanConflictPrompt } from "@/components/ScanConflictPrompt";
import { useNutritionLookup } from "@/hooks/useNutritionLookup";
import { useOfflineGuard } from "@/hooks/useOfflineGuard";
import type { NutritionDetailScreenNavigationProp } from "@/types/navigation";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

/**
 * The route's params come from `RootStackParamList` rather than a local
 * restatement of them. A hand-maintained copy lived here and omitted
 * `nutritionImageUri` / `frontImageUri`, so it SHADOWED the canonical type:
 * the navigator guaranteed two photos, this screen's type said they did not
 * exist, and strict mode had nothing to complain about. The user's captures
 * were silently discarded at the last step of an otherwise-correct pipeline.
 * Deriving the type means a param added to the navigator shows up here as an
 * unread field, not as a param that vanishes.
 *
 * `ocrText` stays three-valued through this indirection — `undefined` = no
 * label step ran, `null` = a label was photographed but unreadable, string =
 * label text. Narrowing `null` away would make the unreadable case
 * indistinguishable from the barcode-only one, which is the whole basis of
 * the log gate.
 */
type NutritionDetailRoute = RouteProp<RootStackParamList, "NutritionDetail">;

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
  const route = useRoute<NutritionDetailRoute>();

  const {
    barcode,
    imageUri,
    itemId,
    ocrText,
    nutritionImageUri,
    frontImageUri,
  } = route.params || {};

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
    labelReadNotice,
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
    conflict,
    activeSource,
    chooseSource,
    dbNutrition,
    logGate,
  } = useNutritionLookup({ barcode, imageUri, itemId, ocrText });

  // Reset whenever the gate changes OR the product does, so an acknowledgement
  // can never carry over onto different numbers.
  //
  // `logGate.kind` alone is insufficient: it is two-valued, so any transition that
  // swaps `nutrition` while leaving the gate gated keeps the acknowledgement alive.
  // The manual-search flow is that transition — the user acknowledges a numberless
  // "Product Not Found" screen, then searches up a different food and
  // `handleManualSearch` replaces `nutrition` without touching `labelUsed`.
  //
  // Not user-reachable in this tree today: nothing emits the `notInDatabase` flag
  // that opens `showManualSearch` (no server hit for it, and `sendError` sends only
  // `{ error, code }`), so this guards a real state-machine defect ahead of the
  // emitter rather than a live bug. It is cheap and must not regress if that
  // branch is ever wired up.
  //
  // `productName` is the dep that actually discriminates. `barcode` does NOT: the
  // not-found branch sets `barcode: code` and `handleManualSearch` sets
  // `barcode: barcode || undefined` — the same route barcode both times — so it is
  // invariant across exactly the transition this guards. `productName` goes
  // "Product Not Found" → the searched food's name, and it also survives
  // `recalculateNutrition` untouched, so a user-initiated serving edit does not
  // needlessly discard an acknowledgement about the same product.
  //
  // Keyed on those two PRIMITIVE fields, not on `logGate`/`nutrition` themselves —
  // the hook returns fresh objects each render, so depending on them would re-fire
  // every render and wipe the acknowledgement the instant it was given, leaving
  // the log button permanently unreachable.
  const [acknowledgedUnverified, setAcknowledgedUnverified] = useState(false);
  useEffect(() => {
    setAcknowledgedUnverified(false);
  }, [logGate.kind, nutrition?.productName]);

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
        <ProductHero
          nutrition={nutrition}
          showServingControls={showServingControls}
          reducedMotion={reducedMotion}
        />

        {conflict && dbNutrition && (
          <ScanConflictPrompt
            conflictFields={conflict.fields}
            labelNutrition={conflict.labelNutrition}
            dbNutrition={dbNutrition}
            activeSource={activeSource}
            onChoose={chooseSource}
          />
        )}

        <FlagSections flags={flags} reducedMotion={reducedMotion} />

        {labelReadNotice && !itemId ? (
          <View
            accessibilityLiveRegion="polite"
            style={[
              styles.correctionContainer,
              { backgroundColor: withOpacity(theme.warning, 0.1) },
            ]}
          >
            <Feather name="alert-triangle" size={16} color={theme.warning} />
            <View style={{ flex: 1 }}>
              <ThemedText
                type="small"
                style={{ color: theme.warning, fontWeight: "600" }}
              >
                Label not used
              </ThemedText>
              <ThemedText type="small" style={{ color: theme.warning }}>
                {labelReadNotice}
              </ThemedText>
            </View>
          </View>
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

        <CapturedPhotos
          nutritionImageUri={nutritionImageUri}
          frontImageUri={frontImageUri}
          reducedMotion={reducedMotion}
        />

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
                    {roundToOneDecimal(nutrition.fiber)} g
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
                    {roundToOneDecimal(nutrition.sugar)} g
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
                    {roundToOneDecimal(nutrition.sodium)} mg
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
          <VerificationPanel
            verificationLevel={verificationLevel}
            hasFrontLabelData={hasFrontLabelData}
            onAddProductDetails={() =>
              navigation.navigate("Scan", {
                mode: "front-label",
                verifyBarcode: barcode,
              })
            }
          />
        )}

        {!itemId ? (
          <View style={styles.buttonContainer}>
            {logGate.kind === "needsAcknowledgement" &&
            !acknowledgedUnverified ? (
              <Button
                onPress={() => {
                  setAcknowledgedUnverified(true);
                  // Both branches render the same Button at the same JSX position
                  // with no key, so React swaps props on ONE node and the screen
                  // reader keeps focus there. A changed accessibilityLabel on an
                  // already-focused element is not re-spoken, so without this a
                  // screen-reader user hears nothing, re-activates the same node
                  // out of habit, and logs the un-reviewed database numbers having
                  // never perceived the gate. Announcing beats a `key` remount,
                  // which would drop focus and still guarantee nothing.
                  AccessibilityInfo.announceForAccessibility(
                    "Values confirmed. Add to Today is now available.",
                  );
                }}
                accessibilityLabel={`${logGate.buttonLabel}. These values come from the product database, not the label you photographed.`}
                accessibilityHint="Reveals the Add to Today button"
                style={styles.addButton}
              >
                {logGate.buttonLabel}
              </Button>
            ) : (
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
            )}
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
