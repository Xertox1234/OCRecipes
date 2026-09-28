/**
 * Pure (no-React) core of a barcode lookup: `lookupBarcode` runs the whole
 * server → direct-Open-Food-Facts fallback control flow and resolves to a
 * `LookupOutcome` discriminated union — it never rejects, and it touches no
 * component state. `useNutritionLookup.ts` is the only caller; it commits the
 * outcome atomically via `lookupStateFromOutcome`.
 *
 * Moving this out of the hook is what makes "every lookup-owned field is
 * written together, from one outcome" true BY CONSTRUCTION rather than by 15
 * independent `useState` setters each remembering to reset themselves. See
 * `beginLookup` / `lookupStateFromOutcome` below.
 */
import { apiRequest, getApiUrl } from "@/lib/query-client";
import { logger } from "@/lib/logger";
import { tokenStorage } from "@/lib/token-storage";
import type { VerificationLevel } from "@shared/types/verification";
import { barcodeLookupResponseSchema } from "@shared/types/barcode-lookup";
import {
  validateAndNormalizeNutrition,
  type ValidatedNutrition,
  type NutritionPer100g,
  type ServingSizeInfo,
} from "@/lib/serving-size-utils";
import {
  createAllergenUnavailableFlag,
  type ScanFlag,
} from "@shared/types/scan-flags";
import {
  parseNutritionFromOCR,
  isLabelReady,
  toLabelNutritionPayload,
} from "@/lib/nutrition-ocr-parser";

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

export interface DbSnapshot {
  nutrition: NutritionData;
  flags: ScanFlag[];
  validated: ValidatedNutrition;
  servingGrams: number;
  isPer100g: boolean;
}

export interface ConflictState {
  fields: string[];
  labelNutrition: NutritionData;
  labelFlags: ScanFlag[];
  // The label result's serving-control state, so a toggle to the label also
  // rescales serving edits from the LABEL per-100g (not the DB's).
  labelValidated: ValidatedNutrition;
  labelGrams: number;
  labelIsPer100g: boolean;
}

// ---------------------------------------------------------------------------
// Shared mappers — the ONE definition each, replacing three duplicated call
// sites in the pre-refactor `fetchBarcodeData` (DB leg, label/conflict leg,
// direct-OFF fallback).
// ---------------------------------------------------------------------------

/**
 * Maps any "perServing-shaped" source (the DB response, its nested
 * `conflict.label`, or an OFF product pre-normalized by the caller) into
 * `NutritionData`. Always reads all 11 nutrient fields off `perServing` —
 * OFF's payload only ever populates the first 7, so the remaining 4 come
 * through as `undefined`. That is behaviour-neutral (matches what the
 * pre-refactor OFF-branch literal already produced by omission), but it does
 * mean these objects must never be compared with `toStrictEqual` against a
 * literal that lists only 7 fields.
 */
function toNutritionData(
  src: {
    productName: string;
    brandName?: string;
    imageUrl?: string;
    perServing: NutritionPer100g;
    servingInfo: { displayLabel: string };
  },
  code: string,
): NutritionData {
  const { perServing } = src;
  return {
    productName: src.productName,
    brandName: src.brandName,
    servingSize: src.servingInfo.displayLabel,
    calories: perServing.calories,
    protein: perServing.protein,
    carbs: perServing.carbs,
    fat: perServing.fat,
    fiber: perServing.fiber,
    sugar: perServing.sugar,
    sodium: perServing.sodium,
    saturatedFat: perServing.saturatedFat,
    transFat: perServing.transFat,
    cholesterol: perServing.cholesterol,
    caffeine: perServing.caffeine,
    imageUrl: src.imageUrl,
    barcode: code,
  };
}

/** Regression guard under test: `!isServingDataTrusted && !wasCorrected`. */
function computeIsPer100g(
  isServingDataTrusted: boolean,
  wasCorrected: boolean,
): boolean {
  return !isServingDataTrusted && !wasCorrected;
}

/** The 4-field `ValidatedNutrition` pick, shared by the DB and label legs. */
function toValidatedNutrition(src: {
  perServing: NutritionPer100g;
  per100g: NutritionPer100g;
  servingInfo: ServingSizeInfo;
  isServingDataTrusted: boolean;
}): ValidatedNutrition {
  return {
    perServing: src.perServing,
    per100g: src.per100g,
    servingInfo: src.servingInfo,
    isServingDataTrusted: src.isServingDataTrusted,
  };
}

function correctionNoticeFrom(servingInfo: ServingSizeInfo): string | null {
  return servingInfo.wasCorrected && servingInfo.correctionReason
    ? servingInfo.correctionReason
    : null;
}

// ---------------------------------------------------------------------------
// LookupOutcome
// ---------------------------------------------------------------------------

/**
 * Every variant carries `labelReadNotice` — it is computed before any branch
 * point (right after the token read) and applies regardless of how the
 * lookup ends. `off-fallback` and `total-outage` carry a REQUIRED
 * `allergenFlag`: the server-side allergen check never ran on either path, so
 * both must fail safe with the "couldn't verify" warn flag. `not-in-database`
 * and `off-not-found` carry NO allergenFlag field at all — current behaviour
 * is "no product ⇒ no flag" (pinned by characterization tests, not endorsed
 * as correct; there is simply no product to warn about yet).
 */
export type LookupOutcome =
  | {
      kind: "server-ok";
      labelReadNotice: string | null;
      nutrition: NutritionData;
      flags: ScanFlag[];
      validatedData: ValidatedNutrition;
      servingSizeGrams: number;
      isPer100g: boolean;
      correctionNotice: string | null;
      dbSnapshot: DbSnapshot;
      labelUsed: boolean;
      verificationLevel: VerificationLevel | undefined;
      isBeverage: boolean | null;
      hasFrontLabelData: boolean;
    }
  | {
      kind: "server-ok-conflict";
      labelReadNotice: string | null;
      // The ACTIVE (label) values — health-facing default is "trust the label".
      nutrition: NutritionData;
      flags: ScanFlag[];
      validatedData: ValidatedNutrition;
      servingSizeGrams: number;
      isPer100g: boolean;
      // Deliberately from the DB's servingInfo, not the label's — the current
      // asymmetry: `wasCorrected` on the label side is never consulted.
      correctionNotice: string | null;
      dbSnapshot: DbSnapshot;
      labelUsed: boolean;
      verificationLevel: VerificationLevel | undefined;
      isBeverage: boolean | null;
      hasFrontLabelData: boolean;
      conflict: ConflictState;
    }
  | {
      kind: "not-in-database";
      labelReadNotice: string | null;
      nutrition: NutritionData;
    }
  | {
      kind: "off-fallback";
      labelReadNotice: string | null;
      nutrition: NutritionData;
      validatedData: ValidatedNutrition;
      servingSizeGrams: number | null;
      isPer100g: boolean;
      correctionNotice: string | null;
      allergenFlag: ScanFlag;
    }
  | {
      kind: "off-not-found";
      labelReadNotice: string | null;
      nutrition: NutritionData;
      error: string;
    }
  | {
      kind: "total-outage";
      labelReadNotice: string | null;
      nutrition: NutritionData;
      error: string;
      allergenFlag: ScanFlag;
    };

// ---------------------------------------------------------------------------
// lookupBarcode — TOTAL: never rejects, every throw is classified inside.
// ---------------------------------------------------------------------------

/**
 * `signal` is accepted for API shape only and deliberately unused: the
 * simplest correct discard point is the hook's commit — it checks
 * `controller.signal.aborted` once, after this promise settles, before
 * applying the outcome. Threading the signal into the network calls too
 * would need an abort check in both catch layers below to keep a genuine
 * user-initiated abort from being misclassified as an OFF-fallback or
 * total-outage.
 */
export async function lookupBarcode(
  code: string,
  ocrText: string | null | undefined,
  signal?: AbortSignal,
): Promise<LookupOutcome> {
  void signal;
  let labelReadNotice: string | null = null;
  // Distinguishes "the server responded but its 200 body failed schema
  // validation" from a genuine network/connectivity failure, so the
  // OFF-fallback and total-outage branches below can pick copy that doesn't
  // falsely claim we couldn't reach the service.
  let serverResponseInvalid = false;

  try {
    // ── Primary: server-side lookup (cross-validates OFF with USDA) ──
    try {
      const baseUrl = getApiUrl();
      const url = new URL(`/api/nutrition/barcode/${code}`, baseUrl);
      // `labelReadNotice` is computed AFTER this await — a token-read throw
      // (e.g. a keychain failure) lands in this try's catch (warn, then the
      // OFF fallback) with the notice still null: no label copy was decided.
      const token = await tokenStorage.get();
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const parsedLabel = ocrText ? parseNutritionFromOCR(ocrText) : null;
      // The label is the source of truth when present — see `isLabelReady`
      // for the rule and why it does NOT also require sugars or fat.
      const labelReady = isLabelReady(parsedLabel);

      // A label the user photographed but we could not use must not vanish
      // silently — `undefined` means no label step ran at all (barcode-only),
      // which stays silent.
      if (ocrText !== undefined && !labelReady) {
        labelReadNotice =
          ocrText === null
            ? "We couldn't read that nutrition label, so these values come from the product database. Retake the label photo to use the package instead."
            : "We couldn't find nutrition values on that photo, so these come from the product database. Retake the nutrition panel to use the package instead.";
      }

      // Raw fetch (not apiRequest), deliberately: 404 responses need their
      // body inspected without being thrown as errors.
      const serverRes = labelReady
        ? await fetch(url, {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({
              labelNutrition: toLabelNutritionPayload(parsedLabel!),
            }),
          })
        : await fetch(url, { headers });

      if (serverRes.ok) {
        // `.catch(() => undefined)`: an unparseable body on a 200 (bad JSON)
        // is also a malformed response, and must fail `safeParse(undefined)`
        // below rather than throwing here and landing in the network-failure
        // catch with no distinguishing signal.
        const rawData: unknown = await serverRes.json().catch(() => undefined);
        const parsedResponse = barcodeLookupResponseSchema.safeParse(rawData);
        if (!parsedResponse.success) {
          logger.error(
            "Malformed barcode lookup response from server (schema validation failed)",
            parsedResponse.error,
          );
          serverResponseInvalid = true;
          throw new Error("barcode-lookup-response-validation-failed");
        }
        const data = parsedResponse.data;

        const validated = toValidatedNutrition(data);
        const dbIsPer100g = computeIsPer100g(
          data.isServingDataTrusted,
          data.servingInfo.wasCorrected,
        );
        const correctionNotice = correctionNoticeFrom(data.servingInfo);
        const dbNutrition = toNutritionData(data, code);
        const dbFlags: ScanFlag[] = Array.isArray(data.flags)
          ? (data.flags as ScanFlag[])
          : [];
        const dbSnapshot: DbSnapshot = {
          nutrition: dbNutrition,
          flags: dbFlags,
          validated,
          servingGrams: data.servingInfo.grams,
          isPer100g: dbIsPer100g,
        };

        // `=== true`, deliberately not truthiness — a missing field (older
        // server, or a shape change) must GATE, and only an explicit boolean
        // true opens. `labelReady &&` is the client's own precondition for
        // having POSTed a label at all.
        const labelUsed = labelReady && data.labelCompared === true;
        const verificationLevel = data.verificationLevel;
        // Anything that is not a real boolean becomes null ("no signal"),
        // which `resolveBasis` treats as unknown rather than silently
        // defaulting to the food scale.
        const isBeverage =
          typeof data.isBeverage === "boolean" ? data.isBeverage : null;

        // Fetch front-label status from the verification endpoint.
        // `apiRequest` throws on a non-ok response, so there is no `.ok`
        // branch to check here — the surrounding try/catch is the guard.
        let hasFrontLabelData = false;
        try {
          const verRes = await apiRequest("GET", `/api/verification/${code}`);
          const verData = await verRes.json();
          hasFrontLabelData = verData.hasFrontLabelData ?? false;
        } catch {
          // Non-critical — front-label CTA just won't show.
        }

        if (data.conflict?.label) {
          const lbl = data.conflict.label;
          const labelNutrition = toNutritionData(lbl, code);
          const labelFlags: ScanFlag[] = Array.isArray(lbl.flags)
            ? (lbl.flags as ScanFlag[])
            : [];
          const labelValidated = toValidatedNutrition(lbl);
          const labelIsPer100g = computeIsPer100g(
            lbl.isServingDataTrusted,
            lbl.servingInfo.wasCorrected,
          );

          return {
            kind: "server-ok-conflict",
            labelReadNotice,
            nutrition: labelNutrition,
            flags: labelFlags,
            validatedData: labelValidated,
            servingSizeGrams: lbl.servingInfo.grams,
            isPer100g: labelIsPer100g,
            correctionNotice,
            dbSnapshot,
            labelUsed,
            verificationLevel,
            isBeverage,
            hasFrontLabelData,
            conflict: {
              fields: data.conflict.fields ?? [],
              labelNutrition,
              labelFlags,
              labelValidated,
              labelGrams: lbl.servingInfo.grams,
              labelIsPer100g,
            },
          };
        }

        return {
          kind: "server-ok",
          labelReadNotice,
          nutrition: dbNutrition,
          flags: dbFlags,
          validatedData: validated,
          servingSizeGrams: data.servingInfo.grams,
          isPer100g: dbIsPer100g,
          correctionNotice,
          dbSnapshot,
          labelUsed,
          verificationLevel,
          isBeverage,
          hasFrontLabelData,
        };
      }

      // Server returned an error — check if it's a definitive "not in database".
      if (serverRes.status === 404) {
        try {
          const errData = await serverRes.json();
          if (errData.notInDatabase) {
            return {
              kind: "not-in-database",
              labelReadNotice,
              nutrition: { productName: "Product Not Found", barcode: code },
            };
          }
        } catch {
          // Couldn't parse error body — fall through to OFF.
        }
      }
    } catch (err) {
      // A malformed-response failure already logged via `logger.error`
      // above (and set `serverResponseInvalid`) — it is not a connectivity
      // failure, so it must not also emit the network-outage warn.
      if (!serverResponseInvalid) {
        logger.warn(
          "Server barcode lookup unavailable, falling back to OFF:",
          err,
        );
      }
    }

    // ── Fallback: direct Open Food Facts (when server is unreachable) ──
    const response = await fetch(
      `https://world.openfoodfacts.org/api/v0/product/${code}.json`,
    );
    const data = await response.json();

    if (data.status === 1 && data.product) {
      const product = data.product;
      const validated = validateAndNormalizeNutrition(product, code);

      // NOT `?? 100` / `?? 0` — see `useNutritionLookup.ts` history for the
      // full rationale (an unparseable or zero serving is an absence of data,
      // not a real basis).
      const trustedGrams = validated.servingInfo.grams;
      const servingSizeGrams =
        trustedGrams != null && trustedGrams > 0 ? trustedGrams : null;
      const isPer100g = computeIsPer100g(
        validated.isServingDataTrusted,
        validated.servingInfo.wasCorrected,
      );
      const correctionNotice = correctionNoticeFrom(validated.servingInfo);

      const nutrition = toNutritionData(
        {
          productName: product.product_name || "Unknown Product",
          brandName: product.brands,
          imageUrl: product.image_url || product.image_front_url,
          perServing: validated.perServing,
          servingInfo: validated.servingInfo,
        },
        code,
      );

      // The server-side allergen check never ran for this product (network
      // error, 5xx, malformed 200, or a non-notInDatabase 404) — fail-safe,
      // not fail-open: a "couldn't verify" warn flag instead of a silently
      // clean-looking `flags: []`.
      return {
        kind: "off-fallback",
        labelReadNotice,
        nutrition,
        validatedData: validated,
        servingSizeGrams,
        isPer100g,
        correctionNotice,
        allergenFlag: createAllergenUnavailableFlag({
          detail: serverResponseInvalid
            ? "Our service sent back information we couldn't understand, so these values come from a backup source — check the package label."
            : "We couldn't reach our service to check this against your allergies — check the package label.",
        }),
      };
    }

    return {
      kind: "off-not-found",
      labelReadNotice,
      nutrition: { productName: "Unknown Product", barcode: code },
      error: "Product not found in database",
    };
  } catch {
    // Total outage: server AND the direct-OFF fallback both failed, so we
    // genuinely couldn't check this against the user's allergies.
    return {
      kind: "total-outage",
      labelReadNotice,
      nutrition: { productName: "Unknown Product", barcode: code },
      error: "Failed to fetch product data",
      allergenFlag: createAllergenUnavailableFlag({
        detail: serverResponseInvalid
          ? "Our service sent back information we couldn't understand, and we couldn't reach a backup source either — check the package label."
          : "We couldn't reach our service to check this against your allergies — check the package label.",
      }),
    };
  }
}

// ---------------------------------------------------------------------------
// LookupState — the single per-lookup-result object the hook now owns.
// ---------------------------------------------------------------------------

export interface LookupState {
  nutrition: NutritionData | null;
  flags: ScanFlag[];
  verificationLevel: VerificationLevel;
  /**
   * Null means "no signal" — an older server, a USDA-only match, or an OFF
   * product with no `categories_tags` all omit the key entirely rather than
   * sending `false`, since the server has no basis to claim certainty either
   * way. `resolveBasis` treats null as unknown rather than defaulting to the
   * food scale, which would halve the strictness applied to a real drink.
   */
  isBeverage: boolean | null;
  hasFrontLabelData: boolean;
  error: string | null;
  isPer100g: boolean;
  /**
   * Null until a barcode lookup resolves a real gram weight — the honest "no
   * basis known" value; `effectivePer100g` in the hook returns null rather
   * than fabricating one from it.
   *
   * Do not "fix" a null here by parsing a serving string into it. The FSA
   * basis and the portion weight are resolved from the ONE string through the
   * ONE parser, in `client/components/nutrition/nutrition-band-source.ts`,
   * precisely so those two can never describe different portions. Populating
   * this as a second, independent answer to the same question reintroduces
   * exactly that drift. Decision recorded 2026-08-15 (human-led) in
   * `todos/archive/P3-2026-08-15-should-saved-item-path-populate-servingsizegrams.md`.
   */
  servingSizeGrams: number | null;
  validatedData: ValidatedNutrition | null;
  correctionNotice: string | null;
  /**
   * Set when the user photographed a nutrition label that could not be used,
   * so the values on screen came from the product database instead.
   *
   * Deliberately silent when no label was captured at all — a barcode-only
   * scan never promised to use a label, so warning there would train the
   * user to dismiss the message on the happy path.
   */
  labelReadNotice: string | null;
  /**
   * True when a photographed label was parsed, accepted by the readiness
   * gate, AND the server reports it actually compared the label against the
   * record (`labelCompared`) — i.e. the values on screen have been checked
   * against the package, either because the label overrode the record or
   * because the two agreed.
   *
   * A 200 is NOT sufficient on its own: the server declines to compare on an
   * unparseable or implausible serving, or when the record has no
   * counterpart for any field the label read, and those return the same body
   * shape as agreement. The client's own readiness gate cannot detect that —
   * it only checks that a serving string is non-empty, not that it parses to
   * grams — so the server has to say so.
   *
   * False on every path that falls back to database values the label never
   * touched (server unreachable, non-`notInDatabase` 404, direct-OFF
   * fallback, total outage) — every `LookupOutcome` variant except
   * `server-ok`/`server-ok-conflict` leaves it at its `INITIAL_LOOKUP_STATE`
   * default via `lookupStateFromOutcome`, so a lookup that never reaches the
   * server-ok branch can never inherit a PRIOR lookup's `true`. Drives
   * `logGate`.
   */
  labelUsed: boolean;
  showManualSearch: boolean;
  conflict: ConflictState | null;
  dbSnapshot: DbSnapshot | null;
  activeSource: "database" | "label";
}

export const INITIAL_LOOKUP_STATE: LookupState = {
  nutrition: null,
  flags: [],
  verificationLevel: "unverified",
  isBeverage: null,
  hasFrontLabelData: false,
  error: null,
  isPer100g: false,
  servingSizeGrams: null,
  validatedData: null,
  correctionNotice: null,
  labelReadNotice: null,
  labelUsed: false,
  showManualSearch: false,
  conflict: null,
  dbSnapshot: null,
  activeSource: "database",
};

/**
 * The state a new lookup starts from: every lookup-owned field resets to its
 * declared initial value EXCEPT `nutrition` and `servingSizeGrams`, which
 * carry the prior product's values until the new outcome lands (so the
 * screen doesn't flash blank on a barcode-to-barcode re-fetch). This is the
 * ONE reset point — no exit path can forget to clear a field, because no
 * exit path clears anything itself; `lookupStateFromOutcome` always replaces
 * the whole object.
 */
export function beginLookup(prev: LookupState): LookupState {
  return {
    ...INITIAL_LOOKUP_STATE,
    nutrition: prev.nutrition,
    servingSizeGrams: prev.servingSizeGrams,
  };
}

/** Builds the full `LookupState` for a settled outcome. */
export function lookupStateFromOutcome(outcome: LookupOutcome): LookupState {
  switch (outcome.kind) {
    case "server-ok":
      return {
        nutrition: outcome.nutrition,
        flags: outcome.flags,
        verificationLevel:
          outcome.verificationLevel ?? INITIAL_LOOKUP_STATE.verificationLevel,
        isBeverage: outcome.isBeverage,
        hasFrontLabelData: outcome.hasFrontLabelData,
        error: null,
        isPer100g: outcome.isPer100g,
        servingSizeGrams: outcome.servingSizeGrams,
        validatedData: outcome.validatedData,
        correctionNotice: outcome.correctionNotice,
        labelReadNotice: outcome.labelReadNotice,
        labelUsed: outcome.labelUsed,
        showManualSearch: false,
        conflict: null,
        dbSnapshot: outcome.dbSnapshot,
        activeSource: "database",
      };
    case "server-ok-conflict":
      return {
        nutrition: outcome.nutrition,
        flags: outcome.flags,
        verificationLevel:
          outcome.verificationLevel ?? INITIAL_LOOKUP_STATE.verificationLevel,
        isBeverage: outcome.isBeverage,
        hasFrontLabelData: outcome.hasFrontLabelData,
        error: null,
        isPer100g: outcome.isPer100g,
        servingSizeGrams: outcome.servingSizeGrams,
        validatedData: outcome.validatedData,
        correctionNotice: outcome.correctionNotice,
        labelReadNotice: outcome.labelReadNotice,
        labelUsed: outcome.labelUsed,
        showManualSearch: false,
        conflict: outcome.conflict,
        dbSnapshot: outcome.dbSnapshot,
        activeSource: "label",
      };
    case "not-in-database":
      return {
        ...INITIAL_LOOKUP_STATE,
        labelReadNotice: outcome.labelReadNotice,
        nutrition: outcome.nutrition,
        showManualSearch: true,
      };
    case "off-fallback":
      return {
        ...INITIAL_LOOKUP_STATE,
        labelReadNotice: outcome.labelReadNotice,
        nutrition: outcome.nutrition,
        flags: [outcome.allergenFlag],
        validatedData: outcome.validatedData,
        servingSizeGrams: outcome.servingSizeGrams,
        isPer100g: outcome.isPer100g,
        correctionNotice: outcome.correctionNotice,
      };
    case "off-not-found":
      return {
        ...INITIAL_LOOKUP_STATE,
        labelReadNotice: outcome.labelReadNotice,
        nutrition: outcome.nutrition,
        error: outcome.error,
      };
    case "total-outage":
      return {
        ...INITIAL_LOOKUP_STATE,
        labelReadNotice: outcome.labelReadNotice,
        nutrition: outcome.nutrition,
        error: outcome.error,
        flags: [outcome.allergenFlag],
      };
  }
}
