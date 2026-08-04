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
import { useHeaderContentInset } from "@/hooks/useHeaderContentInset";
import { Spacing, BorderRadius, withOpacity } from "@/constants/theme";
import { getServingContextLabel } from "@/screens/nutrition-detail-utils";
import { partitionScanFlags } from "@/screens/nutrition-detail-flags-utils";
import { ProductHero } from "@/components/nutrition/ProductHero";
import { FlagSections } from "@/components/nutrition/FlagSections";
import { NutritionSummaryCard } from "@/components/nutrition/NutritionSummaryCard";
import { NutritionPanel } from "@/components/nutrition/NutritionPanel";
import { buildPanelRows } from "@/components/nutrition/nutrition-band-source";
import { pickStandouts } from "@shared/lib/nutrition-bands";
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

/**
 * Label widths for the panel's six banded rows. A const array rather than a
 * count, so each placeholder row is keyed by a stable unique value instead of
 * its array index.
 */
const SKELETON_PANEL_ROW_WIDTHS = [70, 92, 64, 76, 58, 84];

function NutritionDetailSkeleton() {
  React.useEffect(() => {
    AccessibilityInfo.announceForAccessibility("Loading");
  }, []);

  return (
    <SkeletonProvider>
      <View
        accessibilityElementsHidden
        // The iOS half alone leaves the whole placeholder tree readable to
        // TalkBack: `accessibilityElementsHidden` is iOS-only, and
        // `importantForAccessibility="no"` would exclude only THIS view, not
        // its subtree. A container with children needs "no-hide-descendants".
        importantForAccessibility="no-hide-descendants"
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

        {/* Summary card: Nutri-Score ring, caption, calorie figure, two
            promoted standout rows, macro tile row */}
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
          <SkeletonBox
            width={44}
            height={44}
            borderRadius={22}
            style={{ alignSelf: "flex-end" }}
          />
          <SkeletonBox width={120} height={12} />
          <SkeletonBox width={140} height={44} />
          <SkeletonBox
            width="70%"
            height={16}
            style={{ marginTop: Spacing.xs }}
          />
          <SkeletonBox width="55%" height={16} />
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

        {/* Nutrient panel: six banded rows — indicator dot, label, value */}
        <View style={{ width: "100%", gap: Spacing.md }}>
          {SKELETON_PANEL_ROW_WIDTHS.map((labelWidth) => (
            <View
              key={labelWidth}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: Spacing.sm,
              }}
            >
              <SkeletonBox width={12} height={12} borderRadius={6} />
              <SkeletonBox width={labelWidth} height={16} />
              <View style={{ flex: 1 }} />
              <SkeletonBox width={48} height={16} />
            </View>
          ))}
        </View>
      </View>
    </SkeletonProvider>
  );
}

export default function NutritionDetailScreen() {
  const insets = useSafeAreaInsets();
  const headerContentInset = useHeaderContentInset(Spacing.xl);
  const { theme } = useTheme();
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
    validatedData,
    isBeverage,
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

  // Partitioned ONCE here, not inside FlagSections: the Nutri-Score grade
  // lands on the summary card while the other two groups go to the flag
  // sections, so a second partition would be a second source of truth for the
  // same split.
  const partition = partitionScanFlags(flags);

  // One derivation, two consumers — `rows` for the panel, `bands` for the
  // card's standouts — so a row's band can never disagree with the standout
  // promoting it. NEVER pass `nutrition` in as the band source: it is
  // serving-scaled display state, and banding from it over-warns the moment a
  // user picks a bigger portion. `buildPanelRows` owns that choice; see its
  // module docblock.
  const { rows, bands } = buildPanelRows({
    itemId,
    validatedData,
    nutrition,
    isBeverage,
  });
  const standouts = pickStandouts(bands);

  if (isLoading) {
    return (
      <ThemedView style={styles.container} accessibilityViewIsModal>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[
            styles.content,
            {
              paddingTop: headerContentInset,
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
            paddingTop: headerContentInset,
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

        <FlagSections
          personal={partition.personal}
          universal={partition.universal}
          reducedMotion={reducedMotion}
        />

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

        {/* A PLAIN View, never an Animated.View, and never an `accessible`
            group: the card owns its own entrance (delay 200) — a second
            animated wrapper would run a second entrance over the same content
            — and a labelled group would swallow the Nutri-Score ring's own
            announcement, which the ring carries on its own node precisely so
            nothing has to. The wrapper exists only for the section margin the
            deleted `calorieCard` style used to supply. */}
        <View style={styles.sectionSpacing}>
          <NutritionSummaryCard
            standouts={standouts}
            calories={nutrition?.calories}
            protein={nutrition?.protein}
            carbs={nutrition?.carbs}
            fat={nutrition?.fat}
            // Only the scan flow populates the serving state this caption is
            // derived from — saved items store already-scaled totals, so a
            // "Per …" claim there would misdescribe the numbers.
            servingContextLabel={
              showServingControls ? servingContextLabel : undefined
            }
            nutriScoreGrade={partition.nutriScore?.grade}
            reducedMotion={reducedMotion}
          />
        </View>

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

        {/* Every row, always — a row with no value reads "Not recorded"
            rather than vanishing, which is what stops missing data looking
            like nothing to worry about. The entrance (delay 300) is the
            panel's own; this wrapper is plain, and carries only the section
            margin the deleted `additionalNutrients` style used to supply. */}
        <View style={styles.sectionSpacing}>
          <NutritionPanel rows={rows} reducedMotion={reducedMotion} />
        </View>

        {/* Micronutrients — collapsible section */}
        {nutrition?.productName &&
        nutrition.productName !== "Unknown Product" &&
        nutrition.productName !== "Product Not Found" ? (
          <Animated.View
            entering={
              reducedMotion ? undefined : FadeInUp.delay(500).duration(400)
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
  /**
   * The section margin the deleted `calorieCard` / `additionalNutrients`
   * styles supplied, kept at its original value. `NutritionSummaryCard` and
   * `NutritionPanel` render an entrance-animated root with no margin of its
   * own — unlike ProductHero / CapturedPhotos / VerificationPanel, which each
   * carry theirs — so without this the card butts straight into the captured
   * photos and the panel into the micronutrient section.
   */
  sectionSpacing: {
    marginBottom: Spacing["2xl"],
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
