import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  StyleSheet,
  View,
  ScrollView,
  ActivityIndicator,
  Image,
  TouchableOpacity,
  TextInput as RNTextInput,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useNavigation, useRoute, RouteProp } from "@react-navigation/native";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, { FadeInUp, FadeIn } from "react-native-reanimated";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { useAccessibility } from "@/hooks/useAccessibility";
import { useAuthContext } from "@/context/AuthContext";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import { tokenStorage } from "@/lib/token-storage";
import { Spacing, BorderRadius, withOpacity } from "@/constants/theme";
import type { NutritionDetailScreenNavigationProp } from "@/types/navigation";
import {
  validateAndNormalizeNutrition,
  scaleNutrition,
  getServingSizeOptions,
  type ValidatedNutrition,
  type NutritionPer100g,
  type ServingSizeInfo,
} from "@/lib/serving-size-utils";

type RouteParams = {
  barcode?: string;
  imageUri?: string;
  itemId?: number;
};

interface NutritionData {
  id?: number;
  productName: string;
  brandName?: string;
  servingSize?: string;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
  sugar?: number;
  sodium?: number;
  imageUrl?: string;
  barcode?: string;
}

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

export default function NutritionDetailScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const { reducedMotion } = useAccessibility();
  const navigation = useNavigation<NutritionDetailScreenNavigationProp>();
  const route = useRoute<RouteProp<{ params: RouteParams }, "params">>();
  const queryClient = useQueryClient();
  const { user } = useAuthContext();

  const { barcode, imageUri, itemId } = route.params || {};

  const [nutrition, setNutrition] = useState<NutritionData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPer100g, setIsPer100g] = useState(false);
  const [servingQuantity, setServingQuantity] = useState(1);
  const [servingSizeGrams, setServingSizeGrams] = useState<number | null>(null);
  const [customGramsInput, setCustomGramsInput] = useState("");
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [validatedData, setValidatedData] = useState<ValidatedNutrition | null>(
    null,
  );
  const [correctionNotice, setCorrectionNotice] = useState<string | null>(null);
  const [showManualSearch, setShowManualSearch] = useState(false);
  const [manualSearchQuery, setManualSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  // Derive per-100g values: prefer validatedData when available,
  // otherwise back-calculate from whatever nutrition state we have
  // (e.g. when the USDA/API Ninjas fallback was used).
  const effectivePer100g = useMemo((): NutritionPer100g | null => {
    if (validatedData) return validatedData.per100g;
    if (!nutrition || nutrition.calories === undefined) return null;
    const grams = servingSizeGrams || 100;
    const factor = 100 / grams;
    return {
      calories:
        nutrition.calories !== undefined
          ? nutrition.calories * factor
          : undefined,
      protein:
        nutrition.protein !== undefined
          ? nutrition.protein * factor
          : undefined,
      carbs:
        nutrition.carbs !== undefined ? nutrition.carbs * factor : undefined,
      fat: nutrition.fat !== undefined ? nutrition.fat * factor : undefined,
      fiber:
        nutrition.fiber !== undefined ? nutrition.fiber * factor : undefined,
      sugar:
        nutrition.sugar !== undefined ? nutrition.sugar * factor : undefined,
      sodium:
        nutrition.sodium !== undefined ? nutrition.sodium * factor : undefined,
    };
  }, [validatedData, nutrition, servingSizeGrams]);

  // Build serving size options — works with or without validatedData
  const servingOptions = useMemo(() => {
    const info: ServingSizeInfo = validatedData?.servingInfo ?? {
      displayLabel: nutrition?.servingSize || "100g",
      grams: servingSizeGrams || 100,
      wasCorrected: false,
    };
    return getServingSizeOptions(info, nutrition?.productName || "");
  }, [
    validatedData,
    nutrition?.productName,
    nutrition?.servingSize,
    servingSizeGrams,
  ]);

  // Recalculate displayed nutrition from per-100g whenever serving
  // size or quantity changes
  const recalculateNutrition = useCallback(
    (grams: number, quantity: number) => {
      if (!effectivePer100g) return;
      const factor = (grams / 100) * quantity;
      const scaled = scaleNutrition(effectivePer100g, factor);
      setNutrition((prev) =>
        prev
          ? {
              ...prev,
              calories: scaled.calories,
              protein: scaled.protein,
              carbs: scaled.carbs,
              fat: scaled.fat,
              fiber: scaled.fiber,
              sugar: scaled.sugar,
              sodium: scaled.sodium,
              servingSize: `${grams}g`,
            }
          : prev,
      );
    },
    [effectivePer100g],
  );

  const { data: existingItem } = useQuery<NutritionData>({
    queryKey: ["/api/scanned-items", itemId],
    enabled: !!itemId,
  });

  const fetchBarcodeData = useCallback(async (code: string) => {
    try {
      // ── Primary: server-side lookup (cross-validates OFF with USDA) ──
      // Use raw fetch (not apiRequest) so we can inspect 404 responses
      // without them being thrown as errors.
      try {
        const baseUrl = getApiUrl();
        const url = new URL(`/api/nutrition/barcode/${code}`, baseUrl);
        const token = await tokenStorage.get();
        const headers: Record<string, string> = {};
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const serverRes = await fetch(url, { headers });

        if (serverRes.ok) {
          const data = await serverRes.json();

          // Map server response into ValidatedNutrition for serving controls
          const validated: ValidatedNutrition = {
            perServing: data.perServing,
            per100g: data.per100g,
            servingInfo: data.servingInfo,
            isServingDataTrusted: data.isServingDataTrusted,
          };

          setValidatedData(validated);
          setServingSizeGrams(data.servingInfo.grams);
          setIsPer100g(
            !data.isServingDataTrusted && !data.servingInfo.wasCorrected,
          );

          if (
            data.servingInfo.wasCorrected &&
            data.servingInfo.correctionReason
          ) {
            setCorrectionNotice(data.servingInfo.correctionReason);
          }

          setNutrition({
            productName: data.productName,
            brandName: data.brandName,
            servingSize: data.servingInfo.displayLabel,
            calories: data.perServing.calories,
            protein: data.perServing.protein,
            carbs: data.perServing.carbs,
            fat: data.perServing.fat,
            fiber: data.perServing.fiber,
            sugar: data.perServing.sugar,
            sodium: data.perServing.sodium,
            imageUrl: data.imageUrl,
            barcode: code,
          });
          return;
        }

        // Server returned an error — check if it's a definitive "not in database"
        if (serverRes.status === 404) {
          try {
            const errData = await serverRes.json();
            if (errData.notInDatabase) {
              // Product barcode not found in any database — show manual search
              setShowManualSearch(true);
              setNutrition({ productName: "Product Not Found", barcode: code });
              return;
            }
          } catch {
            // Couldn't parse error body — fall through to OFF
          }
        }
      } catch (err) {
        console.warn(
          "Server barcode lookup unavailable, falling back to OFF:",
          err,
        );
      }

      // ── Fallback: direct Open Food Facts (when server is unreachable) ──
      const response = await fetch(
        `https://world.openfoodfacts.org/api/v0/product/${code}.json`,
      );
      const data = await response.json();

      if (data.status === 1 && data.product) {
        const product = data.product;
        const validated = validateAndNormalizeNutrition(product, code);

        setValidatedData(validated);
        setServingSizeGrams(validated.servingInfo.grams ?? 100);
        setIsPer100g(
          !validated.isServingDataTrusted &&
            !validated.servingInfo.wasCorrected,
        );

        if (
          validated.servingInfo.wasCorrected &&
          validated.servingInfo.correctionReason
        ) {
          setCorrectionNotice(validated.servingInfo.correctionReason);
        }

        const perServing = validated.perServing;
        setNutrition({
          productName: product.product_name || "Unknown Product",
          brandName: product.brands,
          servingSize: validated.servingInfo.displayLabel,
          calories: perServing.calories,
          protein: perServing.protein,
          carbs: perServing.carbs,
          fat: perServing.fat,
          fiber: perServing.fiber,
          sugar: perServing.sugar,
          sodium: perServing.sodium,
          imageUrl: product.image_url || product.image_front_url,
          barcode: code,
        });
      } else {
        setError("Product not found in database");
        setNutrition({ productName: "Unknown Product", barcode: code });
      }
    } catch {
      setError("Failed to fetch product data");
      setNutrition({ productName: "Unknown Product", barcode: code });
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Manual product name search — when barcode isn't in any database,
  // let the user type what the product is (e.g. "coffee whitener")
  const handleManualSearch = useCallback(
    async (query: string) => {
      if (!query.trim()) return;

      setIsSearching(true);
      setError(null);

      try {
        const res = await apiRequest(
          "GET",
          `/api/nutrition/lookup?name=${encodeURIComponent(query.trim())}`,
        );
        if (res.ok) {
          const data = await res.json();

          setShowManualSearch(false);
          setServingSizeGrams(100);
          setIsPer100g(true);

          setNutrition({
            productName: data.name || query.trim(),
            servingSize: data.servingSize || "100g",
            calories: data.calories,
            protein: data.protein,
            carbs: data.carbs,
            fat: data.fat,
            fiber: data.fiber,
            sugar: data.sugar,
            sodium: data.sodium,
            barcode: barcode || undefined,
          });

          // Set up per100g validated data for serving controls
          const per100g: NutritionPer100g = {
            calories: data.calories,
            protein: data.protein,
            carbs: data.carbs,
            fat: data.fat,
            fiber: data.fiber,
            sugar: data.sugar,
            sodium: data.sodium,
          };
          setValidatedData({
            per100g,
            perServing: per100g,
            servingInfo: {
              displayLabel: "100g",
              grams: 100,
              wasCorrected: false,
            },
            isServingDataTrusted: false,
          });
        } else {
          setError(`No results found for "${query.trim()}"`);
        }
      } catch {
        setError("Search failed. Please try again.");
      } finally {
        setIsSearching(false);
      }
    },
    [barcode],
  );

  useEffect(() => {
    if (existingItem) {
      setNutrition(existingItem);
      setIsLoading(false);
      return;
    }

    if (barcode) {
      fetchBarcodeData(barcode);
    } else if (imageUri) {
      setNutrition({
        productName: "Manual Entry",
        servingSize: "1 serving",
      });
      setIsLoading(false);
    } else if (!itemId) {
      setError("No scan data provided");
      setIsLoading(false);
    }
  }, [barcode, imageUri, itemId, existingItem, fetchBarcodeData]);

  const addToLogMutation = useMutation({
    mutationFn: async () => {
      if (!nutrition) return;

      const response = await apiRequest("POST", "/api/scanned-items", {
        ...nutrition,
        servings: servingQuantity,
        userId: user?.id,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scanned-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/daily-summary"] });
      haptics.notification(Haptics.NotificationFeedbackType.Success);
      navigation.goBack();
    },
    onError: () => {
      haptics.notification(Haptics.NotificationFeedbackType.Error);
    },
  });

  const handleAddToLog = () => {
    addToLogMutation.mutate();
  };

  if (isLoading) {
    return (
      <ThemedView style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={theme.success} />
        <ThemedText
          type="body"
          style={[styles.loadingText, { color: theme.textSecondary }]}
        >
          Looking up product...
        </ThemedText>
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
            <Image
              source={{ uri: nutrition.imageUrl }}
              style={styles.productImage}
              resizeMode="contain"
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
          <Card elevation={1} style={styles.servingCard}>
            {/* Serving Size */}
            <View style={styles.servingSection}>
              <ThemedText
                type="small"
                style={[
                  styles.servingSectionLabel,
                  { color: theme.textSecondary },
                ]}
              >
                Serving Size
              </ThemedText>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.servingChips}
              >
                {servingOptions.map((opt) => {
                  const isActive =
                    !showCustomInput &&
                    servingSizeGrams !== null &&
                    Math.abs(servingSizeGrams - opt.grams) < 0.1;
                  return (
                    <TouchableOpacity
                      key={opt.grams}
                      style={[
                        styles.servingChip,
                        {
                          backgroundColor: isActive
                            ? theme.link
                            : withOpacity(theme.text, 0.06),
                        },
                      ]}
                      onPress={() => {
                        setShowCustomInput(false);
                        setServingSizeGrams(opt.grams);
                        recalculateNutrition(opt.grams, servingQuantity);
                        haptics.selection();
                      }}
                      accessibilityLabel={`Set serving to ${opt.label}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isActive }}
                    >
                      <ThemedText
                        type="small"
                        style={{
                          color: isActive ? theme.buttonText : theme.text,
                          fontWeight: isActive ? "600" : "400",
                        }}
                      >
                        {opt.label}
                      </ThemedText>
                    </TouchableOpacity>
                  );
                })}
                {/* Custom option */}
                <TouchableOpacity
                  style={[
                    styles.servingChip,
                    {
                      backgroundColor: showCustomInput
                        ? theme.link
                        : withOpacity(theme.text, 0.06),
                    },
                  ]}
                  onPress={() => {
                    setShowCustomInput(true);
                    haptics.selection();
                  }}
                  accessibilityLabel="Enter custom serving size"
                  accessibilityRole="button"
                  accessibilityState={{ selected: showCustomInput }}
                >
                  <ThemedText
                    type="small"
                    style={{
                      color: showCustomInput ? theme.buttonText : theme.text,
                      fontWeight: showCustomInput ? "600" : "400",
                    }}
                  >
                    Custom
                  </ThemedText>
                </TouchableOpacity>
              </ScrollView>

              {showCustomInput ? (
                <View style={styles.customInputRow}>
                  <RNTextInput
                    style={[
                      styles.customInput,
                      {
                        color: theme.text,
                        backgroundColor: withOpacity(theme.text, 0.06),
                        borderColor: theme.border,
                      },
                    ]}
                    value={customGramsInput}
                    onChangeText={setCustomGramsInput}
                    onEndEditing={() => {
                      const parsed = parseFloat(customGramsInput);
                      if (parsed > 0 && isFinite(parsed)) {
                        setServingSizeGrams(parsed);
                        recalculateNutrition(parsed, servingQuantity);
                      }
                    }}
                    placeholder="grams"
                    placeholderTextColor={theme.textSecondary}
                    keyboardType="decimal-pad"
                    returnKeyType="done"
                    accessibilityLabel="Custom serving size in grams"
                  />
                  <ThemedText
                    type="small"
                    style={{ color: theme.textSecondary }}
                  >
                    g
                  </ThemedText>
                </View>
              ) : null}
            </View>

            {/* Divider */}
            <View
              style={[styles.servingDivider, { backgroundColor: theme.border }]}
            />

            {/* Servings quantity */}
            <View style={styles.quantityRow}>
              <ThemedText
                type="small"
                style={[
                  styles.servingSectionLabel,
                  { color: theme.textSecondary },
                ]}
              >
                Servings
              </ThemedText>
              <View style={styles.quantityStepper}>
                <TouchableOpacity
                  style={[
                    styles.stepperButton,
                    { backgroundColor: withOpacity(theme.text, 0.08) },
                  ]}
                  onPress={() => {
                    const next = Math.max(0.5, servingQuantity - 0.5);
                    setServingQuantity(next);
                    if (servingSizeGrams) {
                      recalculateNutrition(servingSizeGrams, next);
                    }
                    haptics.selection();
                  }}
                  accessibilityLabel="Decrease serving quantity"
                  accessibilityRole="button"
                >
                  <Feather name="minus" size={18} color={theme.text} />
                </TouchableOpacity>
                <ThemedText type="h4" style={styles.quantityValue}>
                  {servingQuantity % 1 === 0
                    ? servingQuantity
                    : servingQuantity.toFixed(1)}
                </ThemedText>
                <TouchableOpacity
                  style={[
                    styles.stepperButton,
                    { backgroundColor: withOpacity(theme.text, 0.08) },
                  ]}
                  onPress={() => {
                    const next = servingQuantity + 0.5;
                    setServingQuantity(next);
                    if (servingSizeGrams) {
                      recalculateNutrition(servingSizeGrams, next);
                    }
                    haptics.selection();
                  }}
                  accessibilityLabel="Increase serving quantity"
                  accessibilityRole="button"
                >
                  <Feather name="plus" size={18} color={theme.text} />
                </TouchableOpacity>
              </View>
            </View>
          </Card>
        ) : null}

        {error ? (
          <View
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
              />
              <TouchableOpacity
                style={[
                  styles.manualSearchButton,
                  {
                    backgroundColor: theme.link,
                    opacity: isSearching || !manualSearchQuery.trim() ? 0.5 : 1,
                  },
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
              </TouchableOpacity>
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
  centered: {
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: Spacing.lg,
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
  correctionContainer: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.xs,
    marginBottom: Spacing.lg,
  },
  servingCard: {
    padding: Spacing.md,
    marginBottom: Spacing["2xl"],
  },
  servingSection: {
    marginBottom: Spacing.sm,
  },
  servingSectionLabel: {
    fontWeight: "500",
    marginBottom: Spacing.sm,
  },
  servingChips: {
    flexDirection: "row",
    gap: Spacing.sm,
    paddingRight: Spacing.sm,
  },
  servingChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.xl,
  },
  customInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  customInput: {
    flex: 1,
    height: 40,
    borderRadius: BorderRadius.xs,
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
    fontSize: 16,
  },
  servingDivider: {
    height: 1,
    marginVertical: Spacing.sm,
  },
  quantityRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  quantityStepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  stepperButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  quantityValue: {
    minWidth: 32,
    textAlign: "center",
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
