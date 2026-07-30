import { describe, it, expect, vi } from "vitest";
import {
  getRouteForContentType,
  getConfirmationMessage,
  getContentTypeLabel,
  getPremiumGate,
  resolveMenuLocalOCRText,
  resolveSmartConfirmAction,
  evaluateBarcodeDetection,
  buildProductSummary,
  buildNutritionDetailParams,
  getCapturePlan,
} from "../scan-screen-utils";
import { logger } from "@/lib/logger";
import { TIER_FEATURES } from "@shared/types/premium";
import type { ScanFlag } from "@shared/types/scan-flags";
import type { ScanPhase } from "@/camera/types/scan-phase";
import type { PhotoAnalysisResponse } from "@/lib/photo-upload";

describe("scan-screen-utils", () => {
  describe("getRouteForContentType", () => {
    it("routes prepared_meal to PhotoAnalysis with log intent", () => {
      const route = getRouteForContentType(
        "prepared_meal",
        "/tmp/photo.jpg",
        "log",
        null,
      );
      expect(route).toEqual({
        screen: "PhotoAnalysis",
        params: { imageUri: "/tmp/photo.jpg", intent: "log" },
      });
    });

    it("routes nutrition_label to LabelAnalysis", () => {
      const route = getRouteForContentType(
        "nutrition_label",
        "/tmp/label.jpg",
        "label",
        null,
      );
      expect(route).toEqual({
        screen: "LabelAnalysis",
        params: { imageUri: "/tmp/label.jpg" },
      });
    });

    it("routes restaurant_menu to the dedicated MenuScanResult screen", () => {
      const route = getRouteForContentType(
        "restaurant_menu",
        "/tmp/menu.jpg",
        null,
        null,
      );
      expect(route).toEqual({
        screen: "MenuScanResult",
        params: { imageUri: "/tmp/menu.jpg", localOCRText: undefined },
      });
    });

    it("forwards localOCRText to MenuScanResult when provided", () => {
      const route = getRouteForContentType(
        "restaurant_menu",
        "/tmp/menu.jpg",
        null,
        null,
        "Burger $10\nFries $4",
      );
      expect(route).toEqual({
        screen: "MenuScanResult",
        params: {
          imageUri: "/tmp/menu.jpg",
          localOCRText: "Burger $10\nFries $4",
        },
      });
    });

    it("routes raw_ingredients to CookSessionCapture", () => {
      const route = getRouteForContentType(
        "raw_ingredients",
        "/tmp/ingredients.jpg",
        "recipe",
        null,
      );
      expect(route).toEqual({
        screen: "CookSessionCapture",
        params: { initialPhotoUri: "/tmp/ingredients.jpg" },
      });
    });

    it("routes has_barcode to NutritionDetail when barcode present", () => {
      const route = getRouteForContentType(
        "has_barcode",
        "/tmp/barcode.jpg",
        null,
        "0123456789012",
      );
      expect(route).toEqual({
        screen: "NutritionDetail",
        params: { barcode: "0123456789012" },
      });
    });

    it("returns null for has_barcode without barcode value", () => {
      const route = getRouteForContentType(
        "has_barcode",
        "/tmp/barcode.jpg",
        null,
        null,
      );
      expect(route).toBeNull();
    });

    it("returns null for non_food", () => {
      const route = getRouteForContentType(
        "non_food",
        "/tmp/cat.jpg",
        null,
        null,
      );
      expect(route).toBeNull();
    });

    it("routes grocery_receipt to ReceiptCapture", () => {
      const route = getRouteForContentType(
        "grocery_receipt",
        "/tmp/receipt.jpg",
        null,
        null,
      );
      expect(route).toEqual({
        screen: "ReceiptCapture",
        params: undefined,
      });
    });

    it("routes restaurant_receipt to ReceiptCapture", () => {
      const route = getRouteForContentType(
        "restaurant_receipt",
        "/tmp/receipt.jpg",
        null,
        null,
      );
      expect(route).toEqual({
        screen: "ReceiptCapture",
        params: undefined,
      });
    });

    it("defaults to log intent when resolvedIntent is null for prepared_meal", () => {
      const route = getRouteForContentType(
        "prepared_meal",
        "/tmp/photo.jpg",
        null,
        null,
      );
      expect(route?.params).toEqual({
        imageUri: "/tmp/photo.jpg",
        intent: "log",
      });
    });
  });

  describe("getConfirmationMessage", () => {
    it("returns a user-friendly confirmation for each content type", () => {
      expect(getConfirmationMessage("prepared_meal")).toContain("meal");
      expect(getConfirmationMessage("nutrition_label")).toContain("label");
      expect(getConfirmationMessage("restaurant_menu")).toContain("menu");
      expect(getConfirmationMessage("non_food")).toContain("not food");
    });

    it("asks if the classification is correct", () => {
      const msg = getConfirmationMessage("prepared_meal");
      expect(msg).toContain("Is that right?");
    });
  });

  describe("getContentTypeLabel", () => {
    it("returns readable labels for all content types", () => {
      expect(getContentTypeLabel("prepared_meal")).toBe("Meal");
      expect(getContentTypeLabel("nutrition_label")).toBe("Nutrition label");
      expect(getContentTypeLabel("restaurant_menu")).toBe("Restaurant menu");
      expect(getContentTypeLabel("raw_ingredients")).toBe("Ingredients");
      expect(getContentTypeLabel("grocery_receipt")).toBe("Grocery receipt");
      expect(getContentTypeLabel("restaurant_receipt")).toBe(
        "Restaurant receipt",
      );
      expect(getContentTypeLabel("non_food")).toBe("Not food");
      expect(getContentTypeLabel("has_barcode")).toBe("Barcode");
    });
  });

  describe("getPremiumGate", () => {
    it("returns gate info for premium content types", () => {
      expect(getPremiumGate("restaurant_menu")).toEqual({
        feature: "menuScanner",
        label: "Menu scanning",
      });
      expect(getPremiumGate("raw_ingredients")).toEqual({
        feature: "cookAndTrack",
        label: "Cook & Track",
      });
      expect(getPremiumGate("grocery_receipt")).toEqual({
        feature: "receiptScanner",
        label: "Receipt scanning",
      });
    });

    it("returns null for non-premium content types", () => {
      expect(getPremiumGate("prepared_meal")).toBeNull();
      expect(getPremiumGate("nutrition_label")).toBeNull();
      expect(getPremiumGate("non_food")).toBeNull();
      expect(getPremiumGate("has_barcode")).toBeNull();
    });
  });

  describe("resolveMenuLocalOCRText", () => {
    it("returns recognized text for restaurant_menu", async () => {
      const recognize = vi
        .fn()
        .mockResolvedValue({ text: "Burger $10\nFries $4" });
      const result = await resolveMenuLocalOCRText(
        "restaurant_menu",
        "/tmp/menu.jpg",
        recognize,
      );
      expect(recognize).toHaveBeenCalledWith("/tmp/menu.jpg");
      expect(result).toBe("Burger $10\nFries $4");
    });

    it("skips OCR and returns undefined for non-menu content", async () => {
      const recognize = vi.fn();
      const result = await resolveMenuLocalOCRText(
        "prepared_meal",
        "/tmp/meal.jpg",
        recognize,
      );
      expect(recognize).not.toHaveBeenCalled();
      expect(result).toBeUndefined();
    });

    it("returns undefined when OCR yields empty text", async () => {
      const recognize = vi.fn().mockResolvedValue({ text: "" });
      const result = await resolveMenuLocalOCRText(
        "restaurant_menu",
        "/tmp/menu.jpg",
        recognize,
      );
      expect(result).toBeUndefined();
    });

    it("returns undefined and logs when OCR throws (non-fatal)", async () => {
      const errorSpy = vi
        .spyOn(logger, "error")
        .mockImplementation(() => undefined);
      const recognize = vi.fn().mockRejectedValue(new Error("mlkit boom"));
      const result = await resolveMenuLocalOCRText(
        "restaurant_menu",
        "/tmp/menu.jpg",
        recognize,
      );
      expect(result).toBeUndefined();
      expect(errorSpy).toHaveBeenCalledOnce();
      errorSpy.mockRestore();
    });
  });

  describe("resolveSmartConfirmAction", () => {
    const menuAllowed = { ...TIER_FEATURES.free, menuScanner: true };
    const menuBlocked = { ...TIER_FEATURES.free, menuScanner: false };
    const live = () => true;

    it("navigates to PhotoAnalysis (no OCR) when contentType is absent", async () => {
      const recognize = vi.fn();
      const action = await resolveSmartConfirmAction({
        classification: {
          contentType: undefined,
          resolvedIntent: "log",
          barcode: null,
        },
        imageUri: "/tmp/x.jpg",
        features: menuAllowed,
        recognizeText: recognize,
        isStillLive: live,
      });
      expect(recognize).not.toHaveBeenCalled();
      expect(action).toEqual({
        kind: "navigate",
        route: {
          screen: "PhotoAnalysis",
          params: { imageUri: "/tmp/x.jpg", intent: "log" },
        },
      });
    });

    it("returns blocked (no OCR) when the content type's premium feature is off", async () => {
      const recognize = vi.fn();
      const action = await resolveSmartConfirmAction({
        classification: {
          contentType: "restaurant_menu",
          resolvedIntent: null,
          barcode: null,
        },
        imageUri: "/tmp/menu.jpg",
        features: menuBlocked,
        recognizeText: recognize,
        isStillLive: live,
      });
      expect(recognize).not.toHaveBeenCalled();
      expect(action).toEqual({
        kind: "blocked",
        gate: { feature: "menuScanner", label: "Menu scanning" },
      });
    });

    it("computes OCR and navigates to MenuScanResult with localOCRText for an allowed menu", async () => {
      const recognize = vi.fn().mockResolvedValue({ text: "Burger $10" });
      const action = await resolveSmartConfirmAction({
        classification: {
          contentType: "restaurant_menu",
          resolvedIntent: null,
          barcode: null,
        },
        imageUri: "/tmp/menu.jpg",
        features: menuAllowed,
        recognizeText: recognize,
        isStillLive: live,
      });
      expect(recognize).toHaveBeenCalledWith("/tmp/menu.jpg");
      expect(action).toEqual({
        kind: "navigate",
        route: {
          screen: "MenuScanResult",
          params: { imageUri: "/tmp/menu.jpg", localOCRText: "Burger $10" },
        },
      });
    });

    it("aborts (no navigation) when the user left the screen during OCR", async () => {
      const recognize = vi.fn().mockResolvedValue({ text: "Burger $10" });
      const action = await resolveSmartConfirmAction({
        classification: {
          contentType: "restaurant_menu",
          resolvedIntent: null,
          barcode: null,
        },
        imageUri: "/tmp/menu.jpg",
        features: menuAllowed,
        recognizeText: recognize,
        isStillLive: () => false,
      });
      expect(recognize).toHaveBeenCalled();
      expect(action).toEqual({ kind: "abort" });
    });

    it("navigates a non-menu type without invoking OCR", async () => {
      const recognize = vi.fn();
      const action = await resolveSmartConfirmAction({
        classification: {
          contentType: "prepared_meal",
          resolvedIntent: "log",
          barcode: null,
        },
        imageUri: "/tmp/meal.jpg",
        features: menuAllowed,
        recognizeText: recognize,
        isStillLive: live,
      });
      expect(recognize).not.toHaveBeenCalled();
      expect(action).toEqual({
        kind: "navigate",
        route: {
          screen: "PhotoAnalysis",
          params: { imageUri: "/tmp/meal.jpg", intent: "log" },
        },
      });
    });

    it("returns unrecognized when the route resolves to null (has_barcode without a barcode)", async () => {
      const action = await resolveSmartConfirmAction({
        classification: {
          contentType: "has_barcode",
          resolvedIntent: null,
          barcode: null,
        },
        imageUri: "/tmp/x.jpg",
        features: menuAllowed,
        recognizeText: vi.fn(),
        isStillLive: live,
      });
      expect(action).toEqual({ kind: "unrecognized" });
    });

    it("returns unrecognized (no OCR) for non_food content", async () => {
      const recognize = vi.fn();
      const action = await resolveSmartConfirmAction({
        classification: {
          contentType: "non_food",
          resolvedIntent: null,
          barcode: null,
        },
        imageUri: "/tmp/x.jpg",
        features: menuAllowed,
        recognizeText: recognize,
        isStillLive: live,
      });
      expect(recognize).not.toHaveBeenCalled();
      expect(action).toEqual({ kind: "unrecognized" });
    });

    it("navigates without localOCRText when menu OCR throws (non-fatal)", async () => {
      const errorSpy = vi
        .spyOn(logger, "error")
        .mockImplementation(() => undefined);
      const recognize = vi.fn().mockRejectedValue(new Error("boom"));
      const action = await resolveSmartConfirmAction({
        classification: {
          contentType: "restaurant_menu",
          resolvedIntent: null,
          barcode: null,
        },
        imageUri: "/tmp/menu.jpg",
        features: menuAllowed,
        recognizeText: recognize,
        isStillLive: live,
      });
      expect(action).toEqual({
        kind: "navigate",
        route: {
          screen: "MenuScanResult",
          params: { imageUri: "/tmp/menu.jpg", localOCRText: undefined },
        },
      });
      errorSpy.mockRestore();
    });
  });

  describe("evaluateBarcodeDetection", () => {
    it("starts tracking a barcode from idle", () => {
      const decision = evaluateBarcodeDetection({ status: "idle" }, "012345");
      expect(decision).toEqual({
        action: "start",
        barcode: "012345",
        frameCount: 1,
      });
    });

    it("increments frame count while confidence stays below the lock threshold", () => {
      const decision = evaluateBarcodeDetection(
        { status: "tracking", barcode: "012345", frameCount: 1 },
        "012345",
      );
      expect(decision.action).toBe("update");
      expect(decision).toMatchObject({ frameCount: 2 });
      if (decision.action === "update") {
        expect(decision.confidence).toBeCloseTo(2 / 7);
      }
    });

    it("locks once frame count crosses the confidence threshold (0.85)", () => {
      const decision = evaluateBarcodeDetection(
        { status: "tracking", barcode: "012345", frameCount: 5 },
        "012345",
      );
      expect(decision).toEqual({ action: "lock", frameCount: 6 });
    });

    it("stays in update one frame below the lock threshold (5/7 ≈ 0.714 < 0.85)", () => {
      // Pins the cutoff itself: lowering LOCK_CONFIDENCE_THRESHOLD to e.g. 0.7
      // (locking one frame early on a less-stable read) must fail this test.
      const decision = evaluateBarcodeDetection(
        { status: "tracking", barcode: "012345", frameCount: 4 },
        "012345",
      );
      expect(decision.action).toBe("update");
      expect(decision).toMatchObject({ frameCount: 5 });
    });

    it("restarts tracking (does not accumulate) when the scanned barcode changes mid-track", () => {
      const decision = evaluateBarcodeDetection(
        { status: "tracking", barcode: "012345", frameCount: 5 },
        "999999",
      );
      expect(decision).toEqual({
        action: "start",
        barcode: "999999",
        frameCount: 1,
      });
    });
  });

  describe("buildProductSummary", () => {
    const flags: ScanFlag[] = [];

    it("carries verificationLevel through from the barcode response", () => {
      const result = buildProductSummary(
        {
          productName: "Cherry Coke",
          brandName: "Coca-Cola",
          imageUrl: "https://cdn/x.jpg",
          verificationLevel: "verified",
        },
        flags,
      );

      expect(result).toMatchObject({
        name: "Cherry Coke",
        brand: "Coca-Cola",
        imageUri: "https://cdn/x.jpg",
        verificationLevel: "verified",
      });
    });

    // A response with no verificationLevel must NOT be treated as verified.
    // Leaving it undefined lets the chip default to the label-required branch.
    it("leaves verificationLevel undefined when the response omits it", () => {
      const result = buildProductSummary({ productName: "Mystery Bar" }, flags);
      expect(result.verificationLevel).toBeUndefined();
    });

    it("falls back to a placeholder name and drops absent optional fields", () => {
      const result = buildProductSummary({}, flags);
      expect(result.name).toBe("Unknown product");
      expect(result.brand).toBeUndefined();
      expect(result.imageUri).toBeUndefined();
    });

    // No safety-tier flag is present, so pickTopSafetyFlag(flags) must yield
    // undefined — but pickTopDisplayFlag(flags) still surfaces the
    // danger-severity nutrition flag via its non-safety fallback branch (see
    // its doc comment in shared/types/scan-flags.ts). safetyFlag and topFlag
    // land on different values here on purpose: if the two composition lines
    // in buildProductSummary were ever swapped, both assertions below would
    // fail (safetyFlag would come back defined, topFlag undefined).
    it("composes topFlag and safetyFlag from the shared selectors, not interchangeably", () => {
      const sugarFlag: ScanFlag = {
        id: "nutrient:sugar",
        kind: "nutrient",
        severity: "danger",
        tier: "nutrition",
        title: "High sugar",
        nutrient: "sugar",
      };

      const result = buildProductSummary({ productName: "Soda" }, [sugarFlag]);

      expect(result.safetyFlag).toBeUndefined();
      expect(result.topFlag).toEqual(sugarFlag);
    });
  });

  describe("buildNutritionDetailParams", () => {
    // THE REGRESSION GUARD for the discarded-photos bug. The user photographed a
    // nutrition panel and a package front; both were dropped at the navigate.
    it("carries both captured photos through to NutritionDetail", () => {
      const params = buildNutritionDetailParams({
        type: "SESSION_COMPLETE",
        barcode: "06772408",
        nutritionImageUri: "file://panel.jpg",
        frontImageUri: "file://front.jpg",
        ocrText: "Calories 140",
      });

      expect(params).toEqual({
        barcode: "06772408",
        ocrText: "Calories 140",
        nutritionImageUri: "file://panel.jpg",
        frontImageUri: "file://front.jpg",
      });
    });

    it("preserves ocrText null — a captured but unreadable label", () => {
      const params = buildNutritionDetailParams({
        type: "SESSION_COMPLETE",
        barcode: "06772408",
        nutritionImageUri: "file://blurry.jpg",
        ocrText: null,
      });

      expect(params.ocrText).toBeNull();
      expect(params.nutritionImageUri).toBe("file://blurry.jpg");
      expect(params.frontImageUri).toBeUndefined();
    });

    // A barcode-only session never promised a label. ocrText must stay undefined
    // — distinct from null — or the detail screen will warn on the happy path.
    it("leaves ocrText undefined for a barcode-only session", () => {
      const params = buildNutritionDetailParams({
        type: "SESSION_COMPLETE",
        barcode: "06772408",
      });

      expect(params).toEqual({ barcode: "06772408" });
      expect("ocrText" in params).toBe(false);
    });
  });

  describe("getCapturePlan", () => {
    // One tested decision replaces the three hand-maintained phase lists that
    // `onShutterPress`'s guard, its OCR branch, and `shutterArmed` each kept —
    // the divergence that made LABEL_PROMPTED a dead-end (the reducer accepted
    // STEP_PHOTO_CAPTURED from it; the capture gate silently dropped the tap).
    const bounds = { x: 0.3, y: 0.4, width: 0.4, height: 0.2 };

    const CASES: [ScanPhase, { capture: boolean; runStepOcr: boolean }][] = [
      [{ type: "IDLE" }, { capture: false, runStepOcr: false }],
      // Smart scan / label mode — captures, but runs its own OCR into
      // localOCRText rather than the STEP_PHOTO_CAPTURED payload.
      [{ type: "HUNTING" }, { capture: true, runStepOcr: false }],
      [
        {
          type: "BARCODE_TRACKING",
          barcode: "06772408",
          bounds,
          frameCount: 3,
        },
        { capture: false, runStepOcr: false },
      ],
      // Retained so a capture taken before the chip's primary button is
      // pressed still completes step 2 (mirrors the reducer).
      [
        { type: "BARCODE_LOCKED", barcode: "06772408", bounds },
        { capture: true, runStepOcr: true },
      ],
      [
        { type: "LABEL_PROMPTED", barcode: "06772408" },
        { capture: true, runStepOcr: true },
      ],
      [
        {
          type: "STEP2_REVIEWING",
          barcode: "06772408",
          imageUri: "file://panel.jpg",
          ocrText: "Calories 140",
        },
        { capture: false, runStepOcr: false },
      ],
      // Step 3 (package front) — captured, but the front has no nutrition
      // panel to recognise and its ocrText is carried over from step 2.
      [
        {
          type: "STEP2_CONFIRMED",
          barcode: "06772408",
          nutritionImageUri: "file://panel.jpg",
          ocrText: "Calories 140",
        },
        { capture: true, runStepOcr: false },
      ],
      [
        {
          type: "STEP3_REVIEWING",
          barcode: "06772408",
          nutritionImageUri: "file://panel.jpg",
          ocrText: "Calories 140",
          frontImageUri: "file://front.jpg",
        },
        { capture: false, runStepOcr: false },
      ],
      [
        { type: "SESSION_COMPLETE", barcode: "06772408" },
        { capture: false, runStepOcr: false },
      ],
      [
        { type: "CLASSIFYING", imageUri: "file://photo.jpg" },
        { capture: false, runStepOcr: false },
      ],
      [
        {
          type: "SMART_CONFIRMED",
          imageUri: "file://photo.jpg",
          classification: {} as PhotoAnalysisResponse,
        },
        { capture: false, runStepOcr: false },
      ],
      [
        {
          type: "SMART_ERROR",
          imageUri: "file://photo.jpg",
          error: "unrecognized",
        },
        { capture: false, runStepOcr: false },
      ],
    ];

    it.each(CASES)("plans %o", (phase, expected) => {
      expect(getCapturePlan(phase)).toEqual(expected);
    });

    // The whole-branch-review Critical, pinned at the helper: a shutter press in
    // LABEL_PROMPTED must capture (it was a silent no-op) AND run step OCR (the
    // trap in the guard-only fix — no OCR text makes normalizeOcrText return
    // `null`, i.e. "photographed but unreadable", for every label scan).
    it("captures AND runs step OCR for LABEL_PROMPTED", () => {
      expect(
        getCapturePlan({ type: "LABEL_PROMPTED", barcode: "06772408" }),
      ).toEqual({ capture: true, runStepOcr: true });
    });

    // runStepOcr must never be true where capture is false — there would be no
    // photo to recognise, so that pair can only ever be a slip.
    it.each(CASES.map(([phase]) => [phase] as const))(
      "never plans step OCR without a capture (%o)",
      (phase) => {
        const plan = getCapturePlan(phase);
        expect(plan.runStepOcr && !plan.capture).toBe(false);
      },
    );
  });
});
