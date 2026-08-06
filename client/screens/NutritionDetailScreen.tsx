import React, { useState } from "react";
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
import { InlineError } from "@/components/InlineError";
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
import { NoticeStack } from "@/components/nutrition/NoticeStack";
import { LogActionBar } from "@/components/nutrition/LogActionBar";
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

  // The sticky log bar's MEASURED height, reported through its `onLayout` and
  // spent as the ScrollView's bottom padding. Measured rather than a constant
  // because the bar has three heights — normal, gated (a longer button label
  // can wrap), and with the offline caption underneath.
  //
  // The acknowledgement state that used to live here moved into `LogActionBar`
  // along with the button it gates; see that component for the reset rationale.
  const [barHeight, setBarHeight] = useState(0);

  // The saved-item view renders no log bar (`!itemId`, Constraint 25), so on
  // that path nothing else claims the bottom inset and the ScrollView must
  // keep it. Read below, and by the bar's own gate.
  const showLogBar = !itemId;

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
              // `insets.bottom` here, and the bar's measured height on the main
              // branch below — the two differ because this branch renders NO
              // `LogActionBar`, so nothing else is claiming the home-indicator
              // clearance. The inset is owned by exactly one node per branch.
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
            // `insets.bottom` is counted EXACTLY ONCE. When the sticky bar
            // renders it owns the inset (`LogActionBar` adds it to its own
            // `paddingBottom`), so the scroller pads by the bar's measured
            // height instead — adding both would double-count and leave a
            // dead band under the last row. When no bar renders (saved item),
            // the scroller keeps the inset itself.
            paddingBottom:
              (showLogBar ? barHeight : insets.bottom) + Spacing["3xl"],
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

        {/* `bands` is the SAME object the panel below renders from, so a badge
            is dropped only when the panel is genuinely showing that nutrient's
            judgement — see FlagSections-utils.ts. */}
        <FlagSections
          personal={partition.personal}
          universal={partition.universal}
          bands={bands}
          reducedMotion={reducedMotion}
        />

        {/* Every passive advisory surface, in ONE place and ONE position: the
            label-not-used warning, the serving correction, and the per-100g
            info notice that used to sit BELOW the summary card. Above the card
            deliberately — a caveat about the data should be read before the
            verdict it qualifies, and it keeps the entrance ladder in visual
            order (notices 150 → card 200 → panel 300 → micronutrients 500).

            `ScanConflictPrompt` and the manual-search card stay outside it:
            both are interactive, and a passive row list must not swallow a
            control. `error` is outside it too — it needs `assertive`, which is
            `InlineError`'s job (Constraint 23).

            Nothing mutes its announcer, deliberately — not even while the log
            gate is unmet. The gated screen IS the screen carrying "Label not
            used" (`deriveLogGate` gates on a label that could not be used;
            `useNutritionLookup.ts:382` sets the notice on the same failure), so
            muting there would switch the announcer off exactly where it earns
            its keep. There is nothing to collide with: the acknowledge
            announcement fires from a click handler that re-renders only
            `LogActionBar`, later in time and in a different commit. */}
        {!itemId ? (
          <NoticeStack
            // Suppressed when the lookup itself failed, for two reasons that
            // share one trigger. Content: the notice says "so these values come
            // from the product database", and NO path that sets `error` leaves
            // real database values in `nutrition` — the placeholder differs by
            // path (`Unknown Product`, `Product Not Found`, or `null` on the
            // saved-item and no-scan-data exits), but none of them carries
            // macros, so the sentence is false wherever `error` is set.
            //
            // Accepted tradeoff: on the one RECOVERABLE error state, the notice
            // can blink. A `notInDatabase` 404 opens the manual-search card
            // without setting `error`, so the notice shows; a failed search then
            // sets one and it vanishes, and a successful search clears it and
            // the notice returns — now truthfully qualifying values that exist.
            // The flicker is the honest reading of each state in turn.
            // Announcement: `isLoading` flips false in the SAME commit as
            // `setError` (no await between the catch and the `finally`), so the
            // early return above releases `NoticeStack` and `InlineError`
            // together; two announces in one commit collide on iOS and the
            // later one — `InlineError`, further down this JSX — silences this.
            // Until this delta the hook announced the notice in its own earlier
            // commit, which hid the collision; removing that duplicate is what
            // exposed it.
            labelReadNotice={error ? null : labelReadNotice}
            correctionNotice={correctionNotice}
            showPer100gInfo={isPer100g}
            reducedMotion={reducedMotion}
          />
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

        {/* The canonical error surface: `assertive`, not the `polite` this
            block used to carry — an error is not an advisory notice and must
            interrupt. `InlineError` renders nothing for a null message, so no
            ternary here, and it is deliberately NOT `!itemId`-gated: a saved
            item can fail to load too, and that was already true before this
            change. Style is spacing only, replacing the deleted
            `warningContainer`'s bottom margin. */}
        <InlineError message={error} style={styles.errorSpacing} />

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

        {/* No wrapper of any kind: the card owns its entrance (delay 200) and
            its own bottom margin, so an Animated.View here would run a second
            entrance over the same content and a plain View would only add a
            layer. No `accessible` group either — a labelled group would
            swallow the Nutri-Score ring's own announcement, which the ring
            carries on its own node precisely so nothing has to. */}
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

        <CapturedPhotos
          nutritionImageUri={nutritionImageUri}
          frontImageUri={frontImageUri}
          reducedMotion={reducedMotion}
        />

        {/* Every row, always — a row with no value reads "Not recorded"
            rather than vanishing, which is what stops missing data looking
            like nothing to worry about. Entrance (delay 300) and bottom
            margin are both the panel's own, so no wrapper here. */}
        <NutritionPanel rows={rows} reducedMotion={reducedMotion} />

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

        {/* Unconditional, and owned by the screen rather than by any one of
            the components above. This screen makes health claims from THREE
            places — `FlagSections` badges, `NutritionSummaryCard`'s
            Nutri-Score ring and standout copy, and `NutritionPanel`'s FSA
            traffic lights — and the first of those can render nothing at all
            (every universal flag dropped as already-banded). While the
            disclaimer lived inside `FlagSections` it was gated on a badge
            list, so exactly that state shipped a banded, graded, red-pilled
            screen with no qualifier on it.

            The rule this encodes: a qualifier belongs to the claim, not to
            whichever component happened to introduce it. Anything that can
            return null is the wrong owner. Keep this outside every
            conditional — its correctness is that it has no gate. */}
        <ThemedText
          type="caption"
          style={[styles.medicalDisclaimer, { color: theme.textSecondary }]}
        >
          Informational only — not medical advice.
        </ThemedText>
      </ScrollView>

      {/* The log action is sticky, not the last thing you scroll to — an
          absolutely-positioned sibling AFTER the ScrollView and INSIDE this
          `accessibilityViewIsModal` root. Inside matters: outside it, the bar
          falls out of the modal's iOS accessibility scope and VoiceOver cannot
          reach it (Constraint 8). It reports its measured height back so the
          scroller can clear it — the bar occludes real content otherwise, at
          whichever of its three heights it is currently rendering. */}
      {showLogBar ? (
        <LogActionBar
          logGate={logGate}
          productName={nutrition?.productName}
          isOffline={isOffline}
          offlineLabel={offlineLabel}
          isPending={addToLogMutation.isPending}
          onAddToLog={handleAddToLog}
          onLayout={setBarHeight}
        />
      ) : null}
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
  // All that survives of the deleted `warningContainer`: `InlineError` owns
  // the error's own layout and colours, but not its separation from whatever
  // renders next.
  errorSpacing: {
    marginBottom: Spacing.lg,
  },
  micronutrientSection: {
    marginBottom: Spacing["2xl"],
  },
  medicalDisclaimer: {
    marginTop: Spacing.md,
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
