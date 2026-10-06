import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  type Dispatch,
  type SetStateAction,
} from "react";
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
import { apiRequest } from "@/lib/query-client";
import { ApiError } from "@/lib/api-error";
import { ErrorCode } from "@shared/constants/error-codes";
import { QUERY_KEYS } from "@/lib/query-keys";
import type { MicronutrientData } from "@/components/MicronutrientSection";
import type { NutritionDetailScreenNavigationProp } from "@/types/navigation";
import {
  scaleNutrition,
  getServingSizeOptions,
  type ValidatedNutrition,
  type NutritionPer100g,
  type ServingSizeInfo,
} from "@/lib/serving-size-utils";
import { enqueue } from "@/lib/offline-queue";
import type { ScannedItemResponse } from "@/types/api";
import { deriveLogGate } from "@/screens/nutrition-detail-utils";
import {
  lookupBarcode,
  lookupStateFromOutcome,
  beginLookup,
  INITIAL_LOOKUP_STATE,
  type LookupState,
  type NutritionData,
} from "./nutrition-lookup-outcome";

export type { NutritionData } from "./nutrition-lookup-outcome";

export function useNutritionLookup(params: {
  barcode?: string;
  imageUri?: string;
  /**
   * Three-valued: `undefined` = no label step ran (barcode-only scan), `null` =
   * a label was photographed but the recognizer produced nothing usable, string
   * = recognised label text. The `null` case is why this is not just `string?`.
   */
  ocrText?: string | null;
}) {
  const { barcode, imageUri, ocrText } = params;

  const navigation = useNavigation<NutritionDetailScreenNavigationProp>();
  const queryClient = useQueryClient();
  const haptics = useHaptics();
  const toast = useToast();
  const { user } = useAuthContext();

  // Every lookup-owned result field lives in ONE object, set atomically from
  // a `LookupOutcome` (see `nutrition-lookup-outcome.ts`). `beginLookup` and
  // `lookupStateFromOutcome` are pure and total, so no exit path can forget
  // to reset a field or leak a prior product's value into a failing lookup —
  // a lookup's result is always committed as one whole-object swap. (The
  // field-level `setLookup` updates below are user-driven edits — serving
  // changes, source toggles, manual search — not lookup exits.)
  const [lookup, setLookup] = useState<LookupState>(INITIAL_LOOKUP_STATE);
  const [isLoading, setIsLoading] = useState(true);
  const [servingQuantity, setServingQuantity] = useState(1);
  const [customGramsInput, setCustomGramsInput] = useState("");
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [manualSearchQuery, setManualSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  // `Dispatch<SetStateAction<T>>`-shaped wrappers so external callers (and
  // the exported `setNutrition`/`setServingSizeGrams`, kept for shape
  // stability) can pass either a value or an updater function, exactly like
  // the `useState` setters they replace.
  const setNutrition = useCallback<
    Dispatch<SetStateAction<NutritionData | null>>
  >((value) => {
    setLookup((prev) => ({
      ...prev,
      nutrition:
        typeof value === "function"
          ? (value as (prev: NutritionData | null) => NutritionData | null)(
              prev.nutrition,
            )
          : value,
    }));
  }, []);

  const setServingSizeGrams = useCallback<
    Dispatch<SetStateAction<number | null>>
  >((value) => {
    setLookup((prev) => ({
      ...prev,
      servingSizeGrams:
        typeof value === "function"
          ? (value as (prev: number | null) => number | null)(
              prev.servingSizeGrams,
            )
          : value,
    }));
  }, []);

  // Derive per-100g values: prefer validatedData when available,
  // otherwise back-calculate from whatever nutrition state we have
  // (e.g. when the USDA/API Ninjas fallback was used).
  //
  // Deliberately omits saturatedFat/transFat/cholesterol/caffeine: the
  // back-calculation path runs when `validatedData` is null, and the fallback
  // payloads that leave it null (USDA / API Ninjas, and formerly the
  // `scanned_items` Drizzle row in shared/schema.ts) carry no values for these
  // 4 nutrients at all, so there is nothing to carry through here. Verified
  // won't-fix (Smart Scan v1 refinements follow-up); revisit only if a
  // fallback payload ever gains those fields.
  const effectivePer100g = useMemo((): NutritionPer100g | null => {
    if (lookup.validatedData) return lookup.validatedData.per100g;
    if (!lookup.nutrition || lookup.nutrition.calories === undefined)
      return null;
    // NOT `|| 100`. Without a gram weight there is no per-100g basis to
    // back-calculate, and a fabricated one is worse than none: `|| 100` made
    // `factor` exactly 1, so the PER-SERVING values in `nutrition` were
    // returned labelled per-100 g. `isPer100g` stays false on that path too,
    // so not even the "Values shown per 100g" banner disclosed it.
    //
    // The state is reached whenever a lookup populates `nutrition` without
    // resolving a gram weight — the USDA / API Ninjas fallback, and the
    // direct-OFF fallback described below. Amy's chili — 680 mg of sodium in a
    // 236 g can — would then read as 680 mg/100 g instead of 288: an FSA HIGH
    // band where the truth is MEDIUM. Returning null is what prevents that.
    //
    // This guard is deliberately not narrowed to the paths that reach the
    // state today: it returns null from the value itself, not from a caller's
    // gating, so a future path cannot arm it silently.
    //
    // The state is still LIVE in transit, which is why this guard is not
    // merely defensive: `beginLookup` (nutrition-lookup-outcome.ts) carries
    // `nutrition` and `servingSizeGrams` across into the next lookup while
    // resetting `validatedData` to null, so a re-fetch on a mounted instance
    // (the effect re-fires on a new `barcode`) holds the PRIOR product's
    // values with no validated basis behind them for the whole duration of
    // the new lookup. If that prior lookup left `servingSizeGrams` null — an
    // OFF record whose serving_size is "1 bottle" — this guard is the thing
    // returning null. Do not thin it on the strength of the steady-state
    // enumeration above.
    //
    // `> 0`, not `!= null`, for the same reason as `recalculateNutrition`'s
    // guard below: `0 || 100` is 100, so a zero basis fabricated identically
    // rather than dividing by zero. A zero is not a measurement.
    //
    // Placement matters: this sits BELOW the `validatedData` branch. The
    // direct-OFF fallback legitimately pairs a null `servingSizeGrams` with a
    // real `validatedData.per100g` (an OFF record whose serving_size is "1
    // bottle"), and hoisting this guard above that branch would blank the
    // serving controls on a path that works. Pinned by a test.
    const grams = lookup.servingSizeGrams;
    if (!(grams != null && grams > 0)) return null;
    const factor = 100 / grams;
    const nutrition = lookup.nutrition;
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
  }, [lookup.validatedData, lookup.nutrition, lookup.servingSizeGrams]);

  // Build serving size options — works with or without validatedData
  const servingOptions = useMemo(() => {
    const info: ServingSizeInfo = lookup.validatedData?.servingInfo ?? {
      displayLabel: lookup.nutrition?.servingSize || "100g",
      grams: lookup.servingSizeGrams || 100,
      wasCorrected: false,
    };
    return getServingSizeOptions(info, lookup.nutrition?.productName || "");
  }, [
    lookup.validatedData,
    lookup.nutrition?.productName,
    lookup.nutrition?.servingSize,
    lookup.servingSizeGrams,
  ]);

  // Recalculate displayed nutrition from per-100g whenever serving
  // size or quantity changes.
  //
  // An absent gram basis is a real state, not a missing value: an Open Food
  // Facts record can publish trustworthy per-serving energy against a
  // serving_size that carries no metric quantity ("1 bottle"), so the serving
  // is known but its weight is not. There is no gram basis to scale from, so
  // multiply the per-serving baseline by the quantity instead. Falling through
  // to the per-100g path with a fabricated denominator is what this fix
  // removes.
  //
  // The guard is `!(grams > 0)`, not `grams === null`, and it is load-bearing
  // rather than defensive: both a null and a zero produce a factor of exactly
  // zero in the per-100g path below, blanking every macro on the card and
  // logging a 0-calorie entry. The callers are already normalized (see the
  // `> 0` filter where `servingSizeGrams` is assigned), so this is the second
  // of two layers — a future call site cannot reintroduce the zeroing.
  const recalculateNutrition = useCallback(
    (grams: number | null, quantity: number) => {
      if (!(grams != null && grams > 0)) {
        const baseline = lookup.validatedData?.perServing;
        if (!baseline) return;
        const scaled = scaleNutrition(baseline, quantity);
        setLookup((prev) =>
          prev.nutrition
            ? {
                ...prev,
                nutrition: {
                  ...prev.nutrition,
                  calories: scaled.calories,
                  protein: scaled.protein,
                  carbs: scaled.carbs,
                  fat: scaled.fat,
                  fiber: scaled.fiber,
                  sugar: scaled.sugar,
                  sodium: scaled.sodium,
                  saturatedFat: scaled.saturatedFat,
                  transFat: scaled.transFat,
                  cholesterol: scaled.cholesterol,
                  caffeine: scaled.caffeine,
                  // Deliberately NOT overwritten with a gram string — the
                  // product's own wording ("1 bottle") is the only honest
                  // label we have.
                  servingSize: prev.nutrition.servingSize,
                },
              }
            : prev,
        );
        return;
      }
      if (!effectivePer100g) return;
      const factor = (grams / 100) * quantity;
      const scaled = scaleNutrition(effectivePer100g, factor);
      setLookup((prev) =>
        prev.nutrition
          ? {
              ...prev,
              nutrition: {
                ...prev.nutrition,
                calories: scaled.calories,
                protein: scaled.protein,
                carbs: scaled.carbs,
                fat: scaled.fat,
                fiber: scaled.fiber,
                sugar: scaled.sugar,
                sodium: scaled.sodium,
                saturatedFat: scaled.saturatedFat,
                transFat: scaled.transFat,
                cholesterol: scaled.cholesterol,
                caffeine: scaled.caffeine,
                servingSize: `${grams}g`,
              },
            }
          : prev,
      );
    },
    [effectivePer100g, lookup.validatedData],
  );

  const { data: micronutrientData, isLoading: micronutrientsLoading } =
    useQuery<{ foodName: string; micronutrients: MicronutrientData[] }>({
      queryKey: ["/api/micronutrients/lookup", lookup.nutrition?.productName],
      queryFn: async () => {
        const res = await apiRequest(
          "GET",
          `/api/micronutrients/lookup?name=${encodeURIComponent(lookup.nutrition!.productName)}`,
        );
        return res.json();
      },
      enabled:
        !!lookup.nutrition?.productName &&
        lookup.nutrition.productName !== "Unknown Product" &&
        lookup.nutrition.productName !== "Product Not Found" &&
        lookup.nutrition.productName !== "Manual Entry" &&
        !isLoading,
    });

  // Dispatch priority: barcode > imageUri > "no scan data".
  // `RootStackParamList["NutritionDetail"]`'s discriminated union means a
  // caller reaching this hook THROUGH the route boundary can never supply both
  // `barcode` and `imageUri` — that combination is a compile error there, not
  // merely a convention this effect has to police at runtime. The fallthrough
  // order is still the correct defense for a non-route caller, which reaches
  // this hook's own parameter object (independent optionals) rather than the
  // union.
  //
  // The notices are announced by `NoticeStack`, NOT here. This hook used to
  // carry an iOS-gated announcer for them, on the reasoning that React flushes
  // child effects before parent ones, so the hook's utterance would land later
  // and silence the component's. That premise only holds within ONE commit.
  // `labelReadNotice` is decided early — inside `lookupBarcode`
  // (nutrition-lookup-outcome.ts), right after the token read, before any
  // network round trip — but it is no longer its own mid-flight `setState`:
  // it lands atomically with the rest of the outcome, in the one `setLookup`
  // commit below that also flips `isLoading` false. On a first load
  // `NoticeStack` is unmounted for every commit before that one (the screen's
  // `isLoading` branch renders the skeleton instead), so it mounts already
  // carrying the notice; on a retake re-fetch (`isLoading` is not re-armed)
  // the notice arrives in that one commit — either way, one utterance.
  //
  // Removing this one rather than gating the other is deliberate on two
  // counts. It announced content that was not on screen yet — the user heard
  // a notice and then landed on a skeleton — and it left iOS and Android on
  // different announcers for the same words. `NoticeStack` speaks when the
  // notice is actually mounted, is keyed on composed CONTENT with a ref guard,
  // and is ungated by platform, so deleting this leaves one announcer serving
  // both. That is exactly the removal its docblock was written to survive.
  //
  // The composition rule that lived here still applies and still lives in
  // `noticeAnnouncementKey`: one utterance for both notices, never two calls
  // in a commit. See
  // docs/solutions/logic-errors/two-announceforaccessibility-same-commit-collide-ios-2026-07-21.md
  //
  // Safe because the notices are reachable only on the barcode path, which is
  // also the only path that mounts `NoticeStack` — there is no state where a
  // notice is set and no announcer is listening.
  //
  // The `error` string had the identical duplicate — an iOS-gated `useEffect`
  // here re-announced it alongside `InlineError`'s own iOS-gated announce
  // (`client/components/InlineError.tsx:24-28`), which docs/rules/accessibility.md
  // prohibits. Deleted for the same reason; `InlineError` is now this screen's
  // sole announcer for the error state — a claim held in place by two tests:
  // the hook-silence test in `__tests__/useNutritionLookup.labelRead.test.tsx`
  // and the InlineError exactly-once assertion in
  // `client/screens/__tests__/NutritionDetailScreen.test.tsx`.
  useEffect(() => {
    if (barcode) {
      const controller = new AbortController();
      setLookup(beginLookup);
      void (async () => {
        const outcome = await lookupBarcode(
          barcode,
          ocrText,
          controller.signal,
        );
        // A later effect run (a new barcode, or the same barcode with fresh
        // OCR text) aborts this run's controller in its cleanup below. That
        // is the ONLY discard check this hook needs — `lookupBarcode` never
        // rejects, so there is no error path to also guard.
        if (controller.signal.aborted) return;
        setLookup(lookupStateFromOutcome(outcome));
        setIsLoading(false);
      })();
      return () => controller.abort();
    } else if (imageUri) {
      setLookup((prev) => ({
        ...prev,
        nutrition: { productName: "Manual Entry", servingSize: "1 serving" },
      }));
      setIsLoading(false);
    } else {
      setLookup((prev) => ({ ...prev, error: "No scan data provided" }));
      setIsLoading(false);
    }
  }, [barcode, imageUri, ocrText]);

  const chooseSource = useCallback(
    (s: "database" | "label") => {
      // Both snapshots (conflict.label* / dbSnapshot) are qty-1 baselines —
      // reset the stepper alongside them so it can never desync from the
      // hero values it's supposed to describe (e.g. bump to 2 servings,
      // toggle source, and the stepper would otherwise still read "2" while
      // the hero shows the freshly-restored qty-1 numbers).
      if (s === "label" && lookup.conflict) {
        const c = lookup.conflict;
        setLookup((prev) => ({
          ...prev,
          activeSource: "label",
          nutrition: c.labelNutrition,
          flags: c.labelFlags,
          validatedData: c.labelValidated,
          servingSizeGrams: c.labelGrams,
          isPer100g: c.labelIsPer100g,
        }));
        setServingQuantity(1);
      } else if (s === "database" && lookup.dbSnapshot) {
        const snap = lookup.dbSnapshot;
        setLookup((prev) => ({
          ...prev,
          activeSource: "database",
          nutrition: snap.nutrition,
          flags: snap.flags,
          validatedData: snap.validated,
          servingSizeGrams: snap.servingGrams,
          isPer100g: snap.isPer100g,
        }));
        setServingQuantity(1);
      } else {
        setLookup((prev) => ({ ...prev, activeSource: s }));
      }
    },
    [lookup.conflict, lookup.dbSnapshot],
  );

  // Manual product name search — when barcode isn't in any database,
  // let the user type what the product is (e.g. "coffee whitener")
  const handleManualSearch = useCallback(
    async (query: string) => {
      if (!query.trim()) return;

      setIsSearching(true);
      setLookup((prev) => ({ ...prev, error: null }));

      try {
        const res = await apiRequest(
          "GET",
          `/api/nutrition/lookup?name=${encodeURIComponent(query.trim())}`,
        );
        if (res.ok) {
          const data = await res.json();
          const manualNutrition: NutritionData = {
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
          };

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
          const manualValidated: ValidatedNutrition = {
            per100g,
            perServing: per100g,
            servingInfo: {
              displayLabel: "100g",
              grams: 100,
              wasCorrected: false,
            },
            isServingDataTrusted: false,
          };

          setLookup((prev) => ({
            ...prev,
            showManualSearch: false,
            servingSizeGrams: 100,
            isPer100g: true,
            nutrition: manualNutrition,
            validatedData: manualValidated,
          }));
        } else {
          setLookup((prev) => ({
            ...prev,
            error: `No results found for "${query.trim()}"`,
          }));
        }
      } catch {
        setLookup((prev) => ({
          ...prev,
          error: "Search failed. Please try again.",
        }));
      } finally {
        setIsSearching(false);
      }
    },
    [barcode],
  );

  const addToLogMutation = useMutation<ScannedItemResponse | undefined, Error>({
    // "always" so mutationFn RUNS while offline and the branch below can enqueue
    // the log durably. With the default "online", an offline tap pauses the
    // mutation in-memory (mutationFn never runs) and the queued write is lost on
    // force-quit — defeating the durable offline queue this hook integrates.
    networkMode: "always",
    mutationFn: async () => {
      if (!lookup.nutrition) return undefined;

      if (!onlineManager.isOnline()) {
        await enqueue({
          endpoint: "/api/scanned-items",
          method: "POST",
          body: {
            ...lookup.nutrition,
            servings: servingQuantity,
            userId: user?.id,
          },
        });
        return undefined; // queued — server confirmation deferred
      }

      const response = await apiRequest("POST", "/api/scanned-items", {
        ...lookup.nutrition,
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
      // The success haptic + navigation reset still fire so the optimistic
      // offline UX is unchanged.
      if (data !== undefined) {
        void queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.scannedItems,
        });
        void queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.dailySummary,
        });
        void queryClient.invalidateQueries({
          queryKey: ["/api/daily-budget"],
        });
      }
      haptics.notification(Haptics.NotificationFeedbackType.Success);
      // NOT goBack(), and NOT safeGoBack(). NutritionDetail is pushed from
      // inside the scan fullScreenModal, so canGoBack() is true and goBack()
      // lands the user back on the live camera. (ScanScreen's returnAfterLog
      // path CAN use safeGoBack because NutritionDetail never opened there, so
      // ScanScreen is the modal's top.) Dismiss the whole stack onto Today.
      //
      // And NOT reset(). The stack here is Main (card) -> Scan
      // (fullScreenModal) -> NutritionDetail (modal), so landing on Main means
      // dismissing TWO stacked native modal presentations. `reset` asks
      // react-native-screens to reconcile a wholesale state replacement; on iOS
      // the native side does not tear both down, and the library then reverts
      // JS state to match native — so the reset silently no-ops. Device-verified
      // 2026-07-30 (iOS 18.7.8): the log row was written, `onSuccess` ran, and
      // the stack was identical before and after. `popTo` dispatches a POP —
      // the same path as swiping a modal down — which native-stack implements
      // natively, and it carries the nested tab param in one action.
      navigation.popTo("Main", { screen: "HomeTab" });
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError && err.code === ErrorCode.RATE_LIMITED
          ? "Too many requests. Please wait a moment and try again."
          : "Couldn't add this to your log. Please try again.",
      );
    },
    // The onError above already toasts on any generic failure.
    meta: { silentError: true },
  });

  const handleAddToLog = () => {
    addToLogMutation.mutate();
  };

  const logGate = deriveLogGate({ ocrText, labelUsed: lookup.labelUsed });

  return {
    logGate,
    nutrition: lookup.nutrition,
    setNutrition,
    flags: lookup.flags,
    verificationLevel: lookup.verificationLevel,
    isBeverage: lookup.isBeverage,
    hasFrontLabelData: lookup.hasFrontLabelData,
    isLoading,
    error: lookup.error,
    isPer100g: lookup.isPer100g,
    servingQuantity,
    setServingQuantity,
    servingSizeGrams: lookup.servingSizeGrams,
    setServingSizeGrams,
    customGramsInput,
    setCustomGramsInput,
    showCustomInput,
    setShowCustomInput,
    validatedData: lookup.validatedData,
    correctionNotice: lookup.correctionNotice,
    labelReadNotice: lookup.labelReadNotice,
    showManualSearch: lookup.showManualSearch,
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
    conflict: lookup.conflict,
    activeSource: lookup.activeSource,
    chooseSource,
    dbNutrition: lookup.dbSnapshot?.nutrition ?? null,
  };
}
