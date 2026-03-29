import { useState, useEffect, useCallback, useMemo } from "react";
import { AccessibilityInfo, Platform } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";

import { useHaptics } from "@/hooks/useHaptics";
import { useAuthContext } from "@/context/AuthContext";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import { QUERY_KEYS } from "@/lib/query-keys";
import { tokenStorage } from "@/lib/token-storage";
import type { MicronutrientData } from "@/components/MicronutrientSection";
import type { VerificationLevel } from "@shared/types/verification";
import type { NutritionDetailScreenNavigationProp } from "@/types/navigation";
import {
  validateAndNormalizeNutrition,
  scaleNutrition,
  getServingSizeOptions,
  type ValidatedNutrition,
  type NutritionPer100g,
  type ServingSizeInfo,
} from "@/lib/serving-size-utils";

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

export function useNutritionLookup(params: {
  barcode?: string;
  imageUri?: string;
  itemId?: number;
}) {
  const { barcode, imageUri, itemId } = params;

  const navigation = useNavigation<NutritionDetailScreenNavigationProp>();
  const queryClient = useQueryClient();
  const haptics = useHaptics();
  const { user } = useAuthContext();

  const [nutrition, setNutrition] = useState<NutritionData | null>(null);
  const [verificationLevel, setVerificationLevel] =
    useState<VerificationLevel>("unverified");
  const [hasFrontLabelData, setHasFrontLabelData] = useState(false);
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

  useEffect(() => {
    if (Platform.OS === "ios" && correctionNotice) {
      AccessibilityInfo.announceForAccessibility(
        `Serving size adjusted: ${correctionNotice}`,
      );
    }
  }, [correctionNotice]);

  useEffect(() => {
    if (Platform.OS === "ios" && error) {
      AccessibilityInfo.announceForAccessibility(error);
    }
  }, [error]);

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

  const { data: micronutrientData, isLoading: micronutrientsLoading } =
    useQuery<{ foodName: string; micronutrients: MicronutrientData[] }>({
      queryKey: ["/api/micronutrients/lookup", nutrition?.productName],
      queryFn: async () => {
        const res = await apiRequest(
          "GET",
          `/api/micronutrients/lookup?name=${encodeURIComponent(nutrition!.productName)}`,
        );
        return res.json();
      },
      enabled:
        !!nutrition?.productName &&
        nutrition.productName !== "Unknown Product" &&
        nutrition.productName !== "Product Not Found" &&
        nutrition.productName !== "Manual Entry" &&
        !isLoading,
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

          // Set verification level from barcode lookup response
          if (data.verificationLevel) {
            setVerificationLevel(data.verificationLevel as VerificationLevel);
          }

          // Fetch front-label status from verification endpoint
          try {
            const verRes = await apiRequest("GET", `/api/verification/${code}`);
            if (verRes.ok) {
              const verData = await verRes.json();
              setHasFrontLabelData(verData.hasFrontLabelData ?? false);
            }
          } catch {
            // Non-critical — front-label CTA just won't show
          }
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
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.scannedItems });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.dailySummary });
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

  return {
    nutrition,
    setNutrition,
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
    validatedData,
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
  };
}
