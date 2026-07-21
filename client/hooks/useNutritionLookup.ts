import { useState, useEffect, useCallback, useMemo } from "react";
import { AccessibilityInfo, Platform } from "react-native";
import { useNavigation } from "@react-navigation/native";
import {
  useMutation,
  useQueryClient,
  useQuery,
  onlineManager,
} from "@tanstack/react-query";
import * as Haptics from "expo-haptics";

import { useHaptics } from "@/hooks/useHaptics";
import { useToast } from "@/context/ToastContext";
import { useAuthContext } from "@/context/AuthContext";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import { ApiError } from "@/lib/api-error";
import { ErrorCode } from "@shared/constants/error-codes";
import { logger } from "@/lib/logger";
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
import { enqueue } from "@/lib/offline-queue";
import type { ScannedItemResponse } from "@/types/api";
import type { ScanFlag } from "@shared/types/scan-flags";

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
  const toast = useToast();
  const { user } = useAuthContext();

  const [nutrition, setNutrition] = useState<NutritionData | null>(null);
  const [flags, setFlags] = useState<ScanFlag[]>([]);
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
      void AccessibilityInfo.announceForAccessibility(
        `Serving size adjusted: ${correctionNotice}`,
      );
    }
  }, [correctionNotice]);

  useEffect(() => {
    if (Platform.OS === "ios" && error) {
      void AccessibilityInfo.announceForAccessibility(error);
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

  const { data: existingItem, isError: existingItemFailed } =
    useQuery<NutritionData>({
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
    // Defense-in-depth: clear any prior product's allergen flags before this
    // fetch resolves, so a future in-screen re-fetch can never render a stale
    // danger flag against a different product while the new data loads.
    setFlags([]);
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

          setFlags(Array.isArray(data.flags) ? (data.flags as ScanFlag[]) : []);

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
        logger.warn(
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

        // This branch only runs when OUR server is unreachable, so the
        // server-side allergen check (buildScanResponseFlags) never ran for
        // this product — `flags` would otherwise stay `[]` and the screen
        // would look allergen-clean when we simply couldn't check. Surface a
        // "couldn't verify" warn flag instead (fail-safe, not fail-open).
        //
        // Gating: ideally this would show only for users with ≥1 declared
        // allergy, but the server is down in this branch, so we can't add a
        // network call to fetch the profile. `useAuthContext().user` (the
        // `User` type in shared/types/auth.ts) does NOT carry allergies —
        // that data lives only on the separate user-profile record, which is
        // fetched server-side via `storage.getUserProfile`. With no cheap
        // offline source for the user's allergies, show this flag
        // unconditionally on the fallback: it's honest ("we couldn't check")
        // and fail-safe rather than silently omitting the warning for the
        // allergy-having users who need it most. This does NOT compute
        // client-side allergen matching — that stays server-only (Phase 1).
        setFlags([
          {
            id: "allergen-unavailable",
            kind: "allergen-unavailable",
            severity: "warn",
            tier: "safety",
            title: "Couldn't verify allergens",
            detail:
              "We couldn't reach our service to check this against your allergies — check the package label.",
          },
        ]);
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

    // itemId was provided but its lookup failed — without this terminal branch
    // the chain below falls through (barcode/imageUri are empty and !itemId is
    // false), leaving isLoading stuck true forever (a permanent spinner with no
    // error). Gate on isError, not !existingItem, so we don't fire while the
    // query is still in-flight.
    if (existingItemFailed) {
      setError("Failed to load item");
      setIsLoading(false);
      return;
    }

    if (barcode) {
      void fetchBarcodeData(barcode);
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
  }, [
    barcode,
    imageUri,
    itemId,
    existingItem,
    existingItemFailed,
    fetchBarcodeData,
  ]);

  const addToLogMutation = useMutation<ScannedItemResponse | undefined, Error>({
    // "always" so mutationFn RUNS while offline and the branch below can enqueue
    // the log durably. With the default "online", an offline tap pauses the
    // mutation in-memory (mutationFn never runs) and the queued write is lost on
    // force-quit — defeating the durable offline queue this hook integrates.
    networkMode: "always",
    mutationFn: async () => {
      if (!nutrition) return undefined;

      if (!onlineManager.isOnline()) {
        await enqueue({
          endpoint: "/api/scanned-items",
          method: "POST",
          body: {
            ...nutrition,
            servings: servingQuantity,
            userId: user?.id,
          },
        });
        return undefined; // queued — server confirmation deferred
      }

      const response = await apiRequest("POST", "/api/scanned-items", {
        ...nutrition,
        servings: servingQuantity,
        userId: user?.id,
      });
      return response.json() as Promise<ScannedItemResponse>;
    },
    onSuccess: (data) => {
      // Online success returns the created item; the offline-queued path (and the
      // no-nutrition no-op) return undefined. Invalidate ONLY on real online
      // success — the drain invalidates after replaying the queued POST on
      // reconnect, so invalidating on the queued path would just resume a paused
      // refetch that races the drain (S1; mirrors useQuickLogSession's guard).
      // The success haptic + goBack still fire so the optimistic offline UX is
      // unchanged.
      if (data !== undefined) {
        void queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.scannedItems,
        });
        void queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.dailySummary,
        });
      }
      haptics.notification(Haptics.NotificationFeedbackType.Success);
      navigation.goBack();
    },
    onError: (err) => {
      haptics.notification(Haptics.NotificationFeedbackType.Error);
      toast.error(
        err instanceof ApiError && err.code === ErrorCode.RATE_LIMITED
          ? "Too many requests. Please wait a moment and try again."
          : "Couldn't add this to your log. Please try again.",
      );
    },
  });

  const handleAddToLog = () => {
    addToLogMutation.mutate();
  };

  return {
    nutrition,
    setNutrition,
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
