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
import {
  createAllergenUnavailableFlag,
  type ScanFlag,
} from "@shared/types/scan-flags";
import {
  parseNutritionFromOCR,
  isLabelReady,
  toLabelNutritionPayload,
} from "@/lib/nutrition-ocr-parser";
import { deriveLogGate } from "@/screens/nutrition-detail-utils";

export interface NutritionData {
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
  saturatedFat?: number;
  transFat?: number;
  cholesterol?: number;
  caffeine?: number;
  imageUrl?: string;
  barcode?: string;
}

export function useNutritionLookup(params: {
  barcode?: string;
  imageUri?: string;
  itemId?: number;
  /**
   * Three-valued: `undefined` = no label step ran (barcode-only scan), `null` =
   * a label was photographed but the recognizer produced nothing usable, string
   * = recognised label text. The `null` case is why this is not just `string?`.
   */
  ocrText?: string | null;
}) {
  const { barcode, imageUri, itemId, ocrText } = params;

  const navigation = useNavigation<NutritionDetailScreenNavigationProp>();
  const queryClient = useQueryClient();
  const haptics = useHaptics();
  const toast = useToast();
  const { user } = useAuthContext();

  const [nutrition, setNutrition] = useState<NutritionData | null>(null);
  const [flags, setFlags] = useState<ScanFlag[]>([]);
  const [verificationLevel, setVerificationLevel] =
    useState<VerificationLevel>("unverified");
  /**
   * Null means "no signal" — an older server, a USDA-only match, or an OFF
   * product with no `categories_tags` all omit the key entirely rather than
   * sending `false`, since the server has no basis to claim certainty either
   * way. `resolveBasis` treats null as unknown rather than defaulting to the
   * food scale, which would halve the strictness applied to a real drink.
   * The itemId/saved-item path never runs the barcode handler below, so it
   * keeps this null initialiser — the correct "no signal" value there too.
   */
  const [isBeverage, setIsBeverage] = useState<boolean | null>(null);
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
  /**
   * Set when the user photographed a nutrition label that could not be used, so
   * the values on screen came from the product database instead.
   *
   * Deliberately silent when no label was captured at all — a barcode-only scan
   * never promised to use a label, so warning there would train the user to
   * dismiss the message on the happy path.
   */
  const [labelReadNotice, setLabelReadNotice] = useState<string | null>(null);
  /**
   * True when a photographed label was parsed, accepted by the readiness gate,
   * AND the server reports it actually compared the label against the record
   * (`labelCompared`) — i.e. the values on screen have been checked against the
   * package, either because the label overrode the record or because the two
   * agreed.
   *
   * A 200 is NOT sufficient on its own: the server declines to compare on an
   * unparseable or implausible serving, or when the record has no counterpart for
   * any field the label read, and those return the same body shape as agreement.
   * The client's own readiness gate cannot detect that — it only checks that a
   * serving string is non-empty, not that it parses to grams — so the server has
   * to say so, and this hook must not re-derive that policy.
   *
   * False on every path that falls back to database values the label never
   * touched (server unreachable, non-`notInDatabase` 404, direct-OFF fallback,
   * total outage). Assigned once, at the end of the successful server leg; the
   * per-lookup reset below keeps every other path honest. Drives `logGate`.
   */
  const [labelUsed, setLabelUsed] = useState(false);
  const [showManualSearch, setShowManualSearch] = useState(false);
  const [manualSearchQuery, setManualSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [conflict, setConflict] = useState<{
    fields: string[];
    labelNutrition: NutritionData;
    labelFlags: ScanFlag[];
    // The label result's serving-control state, so a toggle to the label also
    // rescales serving edits from the LABEL per-100g (not the DB's).
    labelValidated: ValidatedNutrition;
    labelGrams: number;
    labelIsPer100g: boolean;
  } | null>(null);
  const [dbSnapshot, setDbSnapshot] = useState<{
    nutrition: NutritionData;
    flags: ScanFlag[];
    validated: ValidatedNutrition;
    servingGrams: number;
    isPer100g: boolean;
  } | null>(null);
  const [activeSource, setActiveSource] = useState<"database" | "label">(
    "database",
  );

  // One lookup can set BOTH notices (a server serving-correction and an unusable
  // label), and two announceForAccessibility calls in the same commit collide on
  // iOS — the later one silences the earlier. Compose a single utterance rather
  // than adding a second effect. See
  // docs/solutions/logic-errors/two-announceforaccessibility-same-commit-collide-ios-2026-07-21.md
  // Label first: it changes which SOURCE the numbers came from, which outranks a
  // serving-size adjustment to those numbers.
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    const parts = [
      labelReadNotice,
      correctionNotice ? `Serving size adjusted: ${correctionNotice}` : null,
    ].filter((p): p is string => p != null);
    if (parts.length === 0) return;
    void AccessibilityInfo.announceForAccessibility(parts.join(". "));
  }, [correctionNotice, labelReadNotice]);

  useEffect(() => {
    if (Platform.OS === "ios" && error) {
      void AccessibilityInfo.announceForAccessibility(error);
    }
  }, [error]);

  // Derive per-100g values: prefer validatedData when available,
  // otherwise back-calculate from whatever nutrition state we have
  // (e.g. when the USDA/API Ninjas fallback was used).
  //
  // Deliberately omits saturatedFat/transFat/cholesterol/caffeine: the
  // itemId/history-load path (validatedData null) sources `nutrition` from
  // `/api/scanned-items/:id`, whose payload is the `scanned_items` Drizzle
  // row (shared/schema.ts) — that table has no columns for these 4
  // nutrients at all, so there is nothing to carry through here. Verified
  // won't-fix (Smart Scan v1 refinements follow-up); revisit only if
  // `scanned_items` ever gains those columns.
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
        const baseline = validatedData?.perServing;
        if (!baseline) return;
        const scaled = scaleNutrition(baseline, quantity);
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
                saturatedFat: scaled.saturatedFat,
                transFat: scaled.transFat,
                cholesterol: scaled.cholesterol,
                caffeine: scaled.caffeine,
                // Deliberately NOT overwritten with a gram string — the product's
                // own wording ("1 bottle") is the only honest label we have.
                servingSize: prev.servingSize,
              }
            : prev,
        );
        return;
      }
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
              saturatedFat: scaled.saturatedFat,
              transFat: scaled.transFat,
              cholesterol: scaled.cholesterol,
              caffeine: scaled.caffeine,
              servingSize: `${grams}g`,
            }
          : prev,
      );
    },
    [effectivePer100g, validatedData],
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

  const fetchBarcodeData = useCallback(
    async (code: string) => {
      // Defense-in-depth: clear any prior product's allergen flags AND
      // label/DB conflict state before this fetch resolves, so a future
      // in-screen re-fetch (new barcode on a reused screen instance) can
      // never render a stale danger flag or a stale conflict card left over
      // from the PRIOR product when this fetch's 404/OFF-fallback/outer-catch
      // path never repopulates conflict state itself (only the server-ok
      // branch below does).
      setFlags([]);
      setConflict(null);
      setLabelReadNotice(null);
      // `labelUsed` outlives a lookup, and it is assigned only at the end of the
      // successful server leg below — so this reset is what every failing path
      // relies on. Without it, a lookup that bails early inherits the PREVIOUS
      // product's `true` and `logGate` reports `open` for database numbers.
      // Fail-safe by construction: any future early exit is correct by default.
      setLabelUsed(false);
      setDbSnapshot(null);
      setActiveSource("database");
      // Same fail-safe-by-construction rationale as `labelUsed` above:
      // `isBeverage` is written only in the `serverRes.ok` branch below, so
      // every other exit (404 notInDatabase, OFF fallback, total outage)
      // must inherit "no signal" rather than the PRIOR product's
      // classification. A stale `false` surviving onto a real beverage would
      // apply lenient food-scale thresholds to a drink.
      setIsBeverage(null);
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

          const parsedLabel = ocrText ? parseNutritionFromOCR(ocrText) : null;
          // The label is the source of truth when present — see `isLabelReady`
          // for the rule and why it does NOT also require sugars or fat.
          const labelReady = isLabelReady(parsedLabel);

          // A label the user photographed but we could not use must not vanish
          // silently: the whole point of the label step is products whose
          // database record is wrong, which is exactly when a quiet fallback
          // does the most damage. `undefined` means no label step ran at all
          // (barcode-only) — that path stays silent.
          if (ocrText !== undefined && !labelReady) {
            setLabelReadNotice(
              ocrText === null
                ? "We couldn't read that nutrition label, so these values come from the product database. Retake the label photo to use the package instead."
                : "We couldn't find nutrition values on that photo, so these come from the product database. Retake the nutrition panel to use the package instead.",
            );
          }

          const serverRes = labelReady
            ? await fetch(url, {
                method: "POST",
                headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify({
                  // One definition of this mapping, in the parser module beside
                  // the data it maps — see `toLabelNutritionPayload`. It also
                  // carries `directReads`, the provenance the server needs to
                  // avoid comparing an INFERRED saturatedFat against the record
                  // at a tolerance sized for printed rounding.
                  labelNutrition: toLabelNutritionPayload(parsedLabel!),
                }),
              })
            : await fetch(url, { headers });

          if (serverRes.ok) {
            const data = await serverRes.json();

            // Map server response into ValidatedNutrition for serving controls
            const validated: ValidatedNutrition = {
              perServing: data.perServing,
              per100g: data.per100g,
              servingInfo: data.servingInfo,
              isServingDataTrusted: data.isServingDataTrusted,
            };

            const dbIsPer100g =
              !data.isServingDataTrusted && !data.servingInfo.wasCorrected;
            setValidatedData(validated);
            setServingSizeGrams(data.servingInfo.grams);
            setIsPer100g(dbIsPer100g);

            if (
              data.servingInfo.wasCorrected &&
              data.servingInfo.correctionReason
            ) {
              setCorrectionNotice(data.servingInfo.correctionReason);
            }

            const dbNutrition: NutritionData = {
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
              saturatedFat: data.perServing.saturatedFat,
              transFat: data.perServing.transFat,
              cholesterol: data.perServing.cholesterol,
              caffeine: data.perServing.caffeine,
              imageUrl: data.imageUrl,
              barcode: code,
            };
            const dbFlags: ScanFlag[] = Array.isArray(data.flags)
              ? (data.flags as ScanFlag[])
              : [];

            setNutrition(dbNutrition);
            setFlags(dbFlags);
            setActiveSource("database");
            setConflict(null);
            // Capture the DB result so a later toggle can restore it —
            // including the serving-control state so a serving edit under the
            // "Database" choice rescales from the DB per-100g.
            setDbSnapshot({
              nutrition: dbNutrition,
              flags: dbFlags,
              validated,
              servingGrams: data.servingInfo.grams,
              isPer100g: dbIsPer100g,
            });

            if (data.conflict?.label) {
              const lbl = data.conflict.label;
              const labelNutrition: NutritionData = {
                productName: lbl.productName,
                brandName: lbl.brandName,
                servingSize: lbl.servingInfo.displayLabel,
                calories: lbl.perServing.calories,
                protein: lbl.perServing.protein,
                carbs: lbl.perServing.carbs,
                fat: lbl.perServing.fat,
                fiber: lbl.perServing.fiber,
                sugar: lbl.perServing.sugar,
                sodium: lbl.perServing.sodium,
                saturatedFat: lbl.perServing.saturatedFat,
                transFat: lbl.perServing.transFat,
                cholesterol: lbl.perServing.cholesterol,
                caffeine: lbl.perServing.caffeine,
                imageUrl: lbl.imageUrl,
                barcode: code,
              };
              const labelFlags: ScanFlag[] = Array.isArray(lbl.flags)
                ? (lbl.flags as ScanFlag[])
                : [];
              const labelValidated: ValidatedNutrition = {
                perServing: lbl.perServing,
                per100g: lbl.per100g,
                servingInfo: lbl.servingInfo,
                isServingDataTrusted: lbl.isServingDataTrusted,
              };
              const labelIsPer100g =
                !lbl.isServingDataTrusted && !lbl.servingInfo.wasCorrected;
              setConflict({
                fields: data.conflict.fields ?? [],
                labelNutrition,
                labelFlags,
                labelValidated,
                labelGrams: lbl.servingInfo.grams,
                labelIsPer100g,
              });
              // Health-facing default: trust the label — swap the serving-control
              // state too, so a serving edit rescales from the LABEL per-100g,
              // not the DB's (which is the wrong data we're correcting).
              setActiveSource("label");
              setNutrition(labelNutrition);
              setFlags(labelFlags);
              setValidatedData(labelValidated);
              setServingSizeGrams(lbl.servingInfo.grams);
              setIsPer100g(labelIsPer100g);
            }

            // Deliberately here — at the END of the successful server leg, not
            // beside the `labelReady` computation above. `labelUsed` claims the
            // values ON SCREEN were checked against the package, and only this
            // branch makes that true: the server cross-validated the label we
            // POSTed, so it either surfaced a conflict (label values shown) or
            // agreed with the record (DB values corroborated by the package).
            //
            // Every other exit from this function lands on the direct-OFF
            // fallback (or an error), which never sees the label at all — so they
            // must keep the `false` from the per-lookup reset. Setting it earlier
            // would claim cross-validation that never happened, and a
            // server-unreachable scan would open the gate on the rawest,
            // least-validated record in the hook.
            // `=== true`, deliberately not truthiness. A missing field (older
            // server, or a shape change to something like "declined") must GATE,
            // and only an explicit boolean true opens. The safe direction is
            // asymmetric: a wrongly-closed gate costs the user one extra tap, a
            // wrongly-open one logs a ~3.8x-wrong calorie count.
            //
            // `labelReady &&` still matters — it is the client's own precondition
            // for having POSTed a label at all, so a stray field on a GET-shaped
            // response can never open the gate by itself.
            setLabelUsed(labelReady && data.labelCompared === true);

            // Set verification level from barcode lookup response
            if (data.verificationLevel) {
              setVerificationLevel(data.verificationLevel as VerificationLevel);
            }

            // Narrowed explicitly: the response is consumed as untyped
            // `json()`, so a wire field arrives as `any`. Anything that is
            // not a real boolean becomes null — "no signal" — which
            // resolveBasis treats as unknown rather than silently defaulting
            // to the food scale (which would halve the strictness applied to
            // every drink).
            setIsBeverage(
              typeof data.isBeverage === "boolean" ? data.isBeverage : null,
            );

            // Fetch front-label status from verification endpoint
            try {
              const verRes = await apiRequest(
                "GET",
                `/api/verification/${code}`,
              );
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
                setNutrition({
                  productName: "Product Not Found",
                  barcode: code,
                });
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
          // NOT `?? 100`. `isServingDataTrusted` means the per-serving VALUES
          // are trustworthy — it does not promise we know what the serving
          // weighs, and `validateAndNormalizeNutrition`'s trusted branch passes
          // `servingGrams` straight through, null and all (an OFF record whose
          // serving_size is "1 bottle"). Coercing that to 100 captioned the
          // bottle's calories "1 × 100g" and lit the 100 g chip as the active
          // selection, then silently reinterpreted the values against a per-100g
          // basis on the first serving edit. `getServingContextLabel` and
          // `ServingControls` both already model null as "unknown weight"; let
          // them. `isPer100g` stays false either way — these ARE per-serving
          // values, so the "Values shown per 100g" banner would be a second lie.
          //
          // `> 0`, because that same trusted branch also emits a ZERO gram
          // basis: `parseServingGrams("0 ml")` returns the number 0, `??` keeps
          // it, and the plausibility check only rejects servings that are too
          // LARGE. A zero is not a measurement, it is the same absence of data
          // as a null — and left as 0 it captions "1 × 0 g" and scales every
          // macro to zero.
          //
          // The server CLASSIFIES a zero the same way — `barcode-lookup.ts`
          // computes `hasServingData` as `servingGrams !== null && servingGrams
          // > 0`, and documents its own fallback as a guard for "a pathological
          // '0 ml' parse" — but it DIVERGES on the remedy, and deliberately so.
          // It falls back to 100 g with `isServingDataTrusted: false`, which
          // makes `scale` exactly 1, so the values it returns genuinely ARE
          // per-100g and `isPer100g` lights the "Values shown per 100g" banner
          // that says so. That remedy is coherent there and wrong here: this
          // branch's values are per-SERVING, so re-basing them on 100 g would
          // mislabel real data rather than disclose an absence of it.
          const trustedGrams = validated.servingInfo.grams;
          setServingSizeGrams(
            trustedGrams != null && trustedGrams > 0 ? trustedGrams : null,
          );
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

          // Runs whenever the primary server request didn't yield a usable
          // result — a network error, a 5xx, an unparseable/non-notInDatabase
          // 404, or any other case where the inner server `try` above didn't
          // already return — so the server-side allergen check
          // (buildScanResponseFlags) never ran for this product. `flags` would
          // otherwise stay `[]` and the screen would look allergen-clean when
          // we simply couldn't check. Surface a "couldn't verify" warn flag
          // instead (fail-safe, not fail-open).
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
            createAllergenUnavailableFlag({
              detail:
                "We couldn't reach our service to check this against your allergies — check the package label.",
            }),
          ]);
        } else {
          setError("Product not found in database");
          setNutrition({ productName: "Unknown Product", barcode: code });
        }
      } catch {
        setError("Failed to fetch product data");
        setNutrition({ productName: "Unknown Product", barcode: code });
        // Total outage: server AND the direct-OFF fallback both failed, so we
        // genuinely couldn't check this against the user's allergies. Same
        // fail-safe flag as the direct-OFF fallback branch above — see its
        // comment for the full rationale.
        setFlags([
          createAllergenUnavailableFlag({
            detail:
              "We couldn't reach our service to check this against your allergies — check the package label.",
          }),
        ]);
      } finally {
        setIsLoading(false);
      }
    },
    [ocrText],
  );

  const chooseSource = useCallback(
    (s: "database" | "label") => {
      setActiveSource(s);
      // Both snapshots (conflict.label* / dbSnapshot) are qty-1 baselines —
      // reset the stepper alongside them so it can never desync from the
      // hero values it's supposed to describe (e.g. bump to 2 servings,
      // toggle source, and the stepper would otherwise still read "2" while
      // the hero shows the freshly-restored qty-1 numbers).
      if (s === "label" && conflict) {
        setNutrition(conflict.labelNutrition);
        setFlags(conflict.labelFlags);
        setValidatedData(conflict.labelValidated);
        setServingSizeGrams(conflict.labelGrams);
        setIsPer100g(conflict.labelIsPer100g);
        setServingQuantity(1);
      } else if (s === "database" && dbSnapshot) {
        setNutrition(dbSnapshot.nutrition);
        setFlags(dbSnapshot.flags);
        setValidatedData(dbSnapshot.validated);
        setServingSizeGrams(dbSnapshot.servingGrams);
        setIsPer100g(dbSnapshot.isPer100g);
        setServingQuantity(1);
      }
    },
    [conflict, dbSnapshot],
  );

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
      // The success haptic + navigation reset still fire so the optimistic
      // offline UX is unchanged.
      if (data !== undefined) {
        void queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.scannedItems,
        });
        void queryClient.invalidateQueries({
          queryKey: QUERY_KEYS.dailySummary,
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

  const logGate = deriveLogGate({ ocrText, labelUsed });

  return {
    logGate,
    nutrition,
    setNutrition,
    flags,
    verificationLevel,
    isBeverage,
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
    dbNutrition: dbSnapshot?.nutrition ?? null,
  };
}
