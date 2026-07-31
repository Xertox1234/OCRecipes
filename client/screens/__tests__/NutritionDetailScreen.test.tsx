// @vitest-environment jsdom
//
// Render coverage for the "Additional Nutrients" card's new Saturated Fat /
// Trans Fat / Cholesterol / Caffeine rows (Task 11, Smart Scan Universal
// Nutrition Flags v1). The screen has no prior render test — this file
// mocks useNutritionLookup (the screen's sole data source) plus
// @react-navigation/native, and pins the route to an `itemId` lookup so the
// serving-controls / verification-badge / manual-search / flags branches
// (each gated on `!itemId` or a non-empty array) stay out of the render
// tree — only the Additional Nutrients card is exercised.
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { fireEvent } from "@testing-library/react";
import * as RN from "react-native";
import { renderComponent } from "../../../test/utils/render-component";
import NutritionDetailScreen from "../NutritionDetailScreen";
import { deriveLogGate, type LogGate } from "../nutrition-detail-utils";
import { buildNutritionDetailParams } from "../scan-screen-utils";
import type { ScanPhase } from "@/camera/types/scan-phase";

/** Mutable so the log-gate suite can swap in a scan-flow route (`barcode`, no
 * `itemId`); every other suite relies on the `itemId` default below. */
const { mockUseNutritionLookup, mockRoute } = vi.hoisted(() => ({
  mockUseNutritionLookup: vi.fn(),
  mockRoute: { params: { itemId: 42 } as Record<string, unknown> },
}));

const ITEM_ID_ROUTE_PARAMS: Record<string, unknown> = { itemId: 42 };

afterEach(() => {
  mockRoute.params = ITEM_ID_ROUTE_PARAMS;
});

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: vi.fn() }),
  useRoute: () => mockRoute,
}));

vi.mock("@/hooks/useNutritionLookup", () => ({
  useNutritionLookup: () => mockUseNutritionLookup(),
}));

/** Full useNutritionLookup return shape with every field the screen reads,
 * so a mock omission can't silently pass by leaving a destructured value
 * `undefined` where the real hook would supply one. `nutrition` defaults to
 * "Unknown Product" — the only field NutritionData requires — which also
 * keeps the productName !== "Unknown Product" MicronutrientSection guard
 * closed, so that unrelated subtree stays out of the tree. */
function baseHookReturn(
  nutrition: Record<string, unknown>,
  flags: unknown[] = [],
) {
  return {
    nutrition: { productName: "Unknown Product", ...nutrition },
    flags,
    verificationLevel: "unverified",
    hasFrontLabelData: false,
    isLoading: false,
    error: null,
    isPer100g: false,
    servingQuantity: 1,
    setServingQuantity: vi.fn(),
    servingSizeGrams: null,
    setServingSizeGrams: vi.fn(),
    customGramsInput: "",
    setCustomGramsInput: vi.fn(),
    showCustomInput: false,
    setShowCustomInput: vi.fn(),
    correctionNotice: null,
    showManualSearch: false,
    manualSearchQuery: "",
    setManualSearchQuery: vi.fn(),
    isSearching: false,
    servingOptions: [],
    recalculateNutrition: vi.fn(),
    micronutrientData: undefined,
    micronutrientsLoading: false,
    handleManualSearch: vi.fn(),
    addToLogMutation: { isPending: false },
    handleAddToLog: vi.fn(),
    // Required even though this file pins the route to `itemId` (which closes
    // the log-button block): the screen reads `logGate.kind` in a top-level
    // useEffect dep array, so omitting it is a TypeError, not a falsy no-op
    // like the notice fields above.
    logGate: { kind: "open" },
  };
}

describe("NutritionDetailScreen — Additional Nutrients card", () => {
  it("renders a saturated fat row and a caffeine row when present", () => {
    mockUseNutritionLookup.mockReturnValue(
      baseHookReturn({ saturatedFat: 2.5, caffeine: 95 }),
    );

    const { queryByText } = renderComponent(<NutritionDetailScreen />);

    // Sanity check: the screen actually rendered (not a thrown/empty tree).
    expect(queryByText("Unknown Product")).toBeTruthy();

    expect(queryByText("Additional Nutrients")).toBeTruthy();
    expect(queryByText("Saturated Fat")).toBeTruthy();
    expect(queryByText("Caffeine")).toBeTruthy();
    // Locks the roundToOneDecimal wiring end-to-end — not just that the row
    // renders, but that the displayed value+unit is correct.
    expect(queryByText("2.5 g")).toBeTruthy();
    expect(queryByText("95 mg")).toBeTruthy();
    // Only the two set fields should render — no "0 g"/"0 mg" row for the
    // undefined ones.
    expect(queryByText("Trans Fat")).toBeNull();
    expect(queryByText("Cholesterol")).toBeNull();
  });

  it("renders trans fat and cholesterol rows when present", () => {
    mockUseNutritionLookup.mockReturnValue(
      baseHookReturn({ transFat: 0.4, cholesterol: 15 }),
    );

    const { queryByText } = renderComponent(<NutritionDetailScreen />);

    expect(queryByText("Trans Fat")).toBeTruthy();
    expect(queryByText("Cholesterol")).toBeTruthy();
    // Locks the roundToOneDecimal wiring end-to-end — not just that the row
    // renders, but that the displayed value+unit is correct.
    expect(queryByText("0.4 g")).toBeTruthy();
    expect(queryByText("15 mg")).toBeTruthy();
    expect(queryByText("Saturated Fat")).toBeNull();
    expect(queryByText("Caffeine")).toBeNull();
  });

  it("does not render the Additional Nutrients card when no nutrient field is present", () => {
    mockUseNutritionLookup.mockReturnValue(baseHookReturn({}));

    const { queryByText } = renderComponent(<NutritionDetailScreen />);

    expect(queryByText("Unknown Product")).toBeTruthy();
    expect(queryByText("Additional Nutrients")).toBeNull();
  });
});

describe("NutritionDetailScreen — For you / Heads up flags (Task 13)", () => {
  it("renders neither section when there are no flags", () => {
    mockUseNutritionLookup.mockReturnValue(baseHookReturn({}, []));

    const { queryByText } = renderComponent(<NutritionDetailScreen />);

    expect(queryByText("For you")).toBeNull();
    expect(queryByText("Heads up")).toBeNull();
  });

  it("splits allergen flags into For-you and universal flags + Nutri-Score into a grouped Heads-up section", () => {
    const flags = [
      {
        id: "nutriscore:e",
        kind: "nutriscore",
        severity: "info",
        tier: "nutrition",
        title: "Nutri-Score E",
        grade: "e",
      },
      {
        id: "nutrient:caffeine",
        kind: "nutrient",
        severity: "info",
        tier: "nutrition",
        title: "Contains caffeine",
      },
      {
        id: "processing:ultra",
        kind: "processing",
        severity: "warn",
        tier: "nutrition",
        title: "Ultra-processed",
      },
      {
        id: "allergen:peanuts",
        kind: "allergen",
        severity: "danger",
        tier: "safety",
        title: "Contains Peanuts",
      },
    ];
    mockUseNutritionLookup.mockReturnValue(baseHookReturn({}, flags));

    const { queryByText, getByLabelText } = renderComponent(
      <NutritionDetailScreen />,
    );

    // "For you" keeps only the Phase-1 personal (allergen) flag — its
    // existing rendering/behavior is otherwise unchanged.
    expect(queryByText("For you")).toBeTruthy();
    expect(queryByText("Contains Peanuts")).toBeTruthy();

    // "Heads up" gets the universal flags via the existing ScanFlagBadge,
    // and the Nutri-Score grade split out into its own chip.
    expect(queryByText("Heads up")).toBeTruthy();
    expect(queryByText("Ultra-processed")).toBeTruthy();
    expect(queryByText("Contains caffeine")).toBeTruthy();
    expect(getByLabelText("Nutri-Score E")).toBeTruthy();

    // The Heads-up badges are wrapped in ONE accessible={true} view whose
    // accessibilityLabel is the composed summary sentence, so
    // VoiceOver/TalkBack read the badge group as a single grouped
    // announcement instead of stepping through each badge. This jsdom
    // harness can't model the real subtree-collapse (see
    // docs/solutions/conventions/jsdom-rn-render-tests-cannot-assert-a11y-tree-hiding-2026-07-03.md);
    // what IS verifiable is that the exact composed label resolves to
    // exactly one element — getByLabelText throws on a missing or
    // duplicate match — and its content reflects the severity-sorted
    // (warn before info) universal flags.
    const badgeGroup = getByLabelText(
      "2 nutrition flags: Ultra-processed, Contains caffeine",
    );
    expect(badgeGroup).toBeTruthy();

    // The Nutri-Score chip must be a SIBLING of the badge group, not
    // nested inside it: an accessible={true} group's composed label
    // doesn't mention the grade, so a real VoiceOver/TalkBack collapse
    // would silently drop "Nutri-Score E" if the chip were nested here.
    // Its own label being reachable OUTSIDE this subtree (asserted above
    // via getByLabelText) plus its absence FROM this subtree is the
    // closest jsdom proxy for "the chip keeps its own accessible node."
    expect(badgeGroup.querySelector('[aria-label="Nutri-Score E"]')).toBeNull();
  });

  it("shows the Heads-up section for the Nutri-Score chip alone, omitting the badge-group wrapper when there are no universal flags to summarize", () => {
    const flags = [
      {
        id: "nutriscore:c",
        kind: "nutriscore",
        severity: "info",
        tier: "nutrition",
        title: "Nutri-Score C",
        grade: "c",
      },
    ];
    mockUseNutritionLookup.mockReturnValue(baseHookReturn({}, flags));

    const { queryByText, getByLabelText, queryByLabelText } = renderComponent(
      <NutritionDetailScreen />,
    );

    expect(queryByText("For you")).toBeNull();
    expect(queryByText("Heads up")).toBeTruthy();
    expect(getByLabelText("Nutri-Score C")).toBeTruthy();
    // No universal flags means there is nothing for the grouped summary
    // to describe — the badge-group wrapper (and its "No additional
    // nutrition flags." fallback label) isn't rendered at all, so the
    // chip keeps its own independent accessible identity instead of
    // being nested inside an empty, misleadingly-labeled group.
    expect(queryByLabelText("No additional nutrition flags.")).toBeNull();
  });

  it("caps the grouped summary label at the same 6 flags that render as badges (finding #4, PR #694 medium review)", () => {
    // Server-side today bounds universal flags at 6 kinds (3 nutrient + 1
    // caffeine + 1 processing + 1 sweetener — see universal-flags.ts), so
    // this synthetic 7-flag fixture models a hypothetical future kind to
    // prove the label/render count stay in sync even past that bound.
    const flags = Array.from({ length: 7 }, (_, i) => ({
      id: `nutrient:extra-${i}`,
      kind: "nutrient",
      severity: "warn",
      tier: "nutrition",
      title: `Flag ${i}`,
    }));
    mockUseNutritionLookup.mockReturnValue(baseHookReturn({}, flags));

    const { getAllByText, getByLabelText } = renderComponent(
      <NutritionDetailScreen />,
    );

    // Only 6 badges render.
    expect(getAllByText(/^Flag \d$/)).toHaveLength(6);
    // The grouped label's count and title list match the rendered 6, not
    // the full 7 — no "7 nutrition flags" summary describing an unseen badge.
    const badgeGroup = getByLabelText(
      "6 nutrition flags: Flag 0, Flag 1, Flag 2, Flag 3, Flag 4, Flag 5",
    );
    expect(badgeGroup).toBeTruthy();
  });
});

/**
 * The log gate at the layer that actually gates (Task 6, D3 fix).
 *
 * `deriveLogGate`'s own tests prove the decision, and the hook tests prove
 * `logGate` is exposed — but neither can fail if the screen wires the two
 * branches of the button ternary the wrong way round. The property the fix
 * exists to deliver is that "Add to Today" is NOT reachable in one tap while
 * gated, and that only holds at this layer.
 *
 * These use a scan-flow route (`barcode`, no `itemId`), which is the only route
 * shape where the log button renders at all.
 */
describe("NutritionDetailScreen — log gate (Task 6)", () => {
  // Derived, not hand-copied: a change to the button copy must not leave this
  // suite passing against a stale duplicate while the util test fails.
  const GATED = deriveLogGate({ ocrText: null, labelUsed: false });
  if (GATED.kind !== "needsAcknowledgement") {
    throw new Error("deriveLogGate(null, false) must produce a gated gate");
  }
  const GATED_LABEL = GATED.buttonLabel;

  function renderScanRoute(
    logGate: LogGate,
    nutrition: Record<string, unknown> = { calories: 39 },
  ) {
    mockRoute.params = { barcode: "06772408", ocrText: null };
    mockUseNutritionLookup.mockReturnValue({
      ...baseHookReturn(nutrition),
      logGate,
    });
    return renderComponent(<NutritionDetailScreen />);
  }

  it("replaces the one-tap log button with the acknowledgement button while gated", () => {
    const { queryByText } = renderScanRoute(GATED);

    expect(queryByText(GATED_LABEL)).toBeTruthy();
    // The load-bearing half: the wrong calorie count must not be one tap away.
    expect(queryByText("Add to Today")).toBeNull();
  });

  it("reveals the log button only after the acknowledgement is given", () => {
    const { queryByText, getByText } = renderScanRoute(GATED);

    fireEvent.click(getByText(GATED_LABEL));

    expect(queryByText("Add to Today")).toBeTruthy();
    expect(queryByText(GATED_LABEL)).toBeNull();
  });

  // Negative control for the two tests above: an open gate must NOT show the
  // acknowledgement step, or the gate would fire on the barcode-only happy path
  // and train users to tap through it.
  it("shows the log button directly when the gate is open", () => {
    const { queryByText } = renderScanRoute({ kind: "open" });

    expect(queryByText("Add to Today")).toBeTruthy();
    expect(queryByText(GATED_LABEL)).toBeNull();
  });

  /**
   * An acknowledgement must not survive the numbers it acknowledged.
   *
   * `logGate.kind` is two-valued, so a transition that swaps `nutrition` while
   * leaving the gate gated does not change it. The manual-search flow is such a
   * transition: the `notInDatabase` branch renders the search box AND the log
   * button in the same tree, so the user acknowledges a numberless "Product Not
   * Found" screen, then searches up a different food; `handleManualSearch`
   * replaces `nutrition` and never touches `labelUsed`, leaving "Add to Today" one
   * tap away on values nobody reviewed.
   *
   * NOT reachable in this tree today: nothing emits `notInDatabase`. `grep -rn
   * notInDatabase server/` is empty and `sendError` sends only `{ error, code }`,
   * so `useNutritionLookup.ts`'s check is dead against this server and
   * `showManualSearch` can never become true. This is a live defect in the state
   * machine guarded ahead of the emitter existing — not a user-facing bug today.
   *
   * `nutrition?.barcode` does NOT discriminate here (both sides carry the same
   * route barcode); `productName` does. See the dep-array comment in the screen.
   */
  it("re-gates after a manual search replaces the acknowledged numbers", () => {
    const { queryByText, getByText, rerender } = renderScanRoute(GATED, {
      productName: "Product Not Found",
      barcode: "06772408",
    });

    fireEvent.click(getByText(GATED_LABEL));
    expect(queryByText("Add to Today")).toBeTruthy();

    // The manual-search result, shaped as the hook really emits it:
    // `handleManualSearch` sets `barcode: barcode || undefined`, carrying the
    // ROUTE barcode forward — the same value the not-found branch already set. So
    // the barcode is invariant across this transition and only the product name
    // changes. A fixture that omitted the barcode would let an ineffective
    // dependency look correct.
    mockUseNutritionLookup.mockReturnValue({
      ...baseHookReturn({
        productName: "Coffee Whitener",
        calories: 55,
        barcode: "06772408",
      }),
      logGate: GATED,
    });
    rerender(<NutritionDetailScreen />);

    expect(queryByText("Add to Today")).toBeNull();
    expect(queryByText(GATED_LABEL)).toBeTruthy();
  });

  /**
   * Both branches render the same Button at the same JSX position with no `key`,
   * so React swaps props on ONE node and screen-reader focus stays parked there.
   * A changed accessibilityLabel on an already-focused element is not re-spoken,
   * so without an explicit announce a screen-reader user gets no confirmation,
   * re-activates the same node out of habit, and logs the un-reviewed database
   * numbers having never perceived the gate.
   *
   * Ungated by platform on purpose: this button has no accessibilityLiveRegion
   * backing it on Android, unlike the notice banners whose announce IS iOS-gated.
   */
  it("announces that the log button has become available", () => {
    const announceSpy = vi.spyOn(
      RN.AccessibilityInfo,
      "announceForAccessibility",
    );
    try {
      const { getByText } = renderScanRoute(GATED);

      // Negative control: the assertion below would also pass if the string
      // were announced at render time, which would speak the availability
      // BEFORE the user acknowledges — the opposite of the intent.
      expect(announceSpy).not.toHaveBeenCalled();

      fireEvent.click(getByText(GATED_LABEL));

      expect(announceSpy).toHaveBeenCalledWith(
        "Values confirmed. Add to Today is now available.",
      );
    } finally {
      announceSpy.mockRestore();
    }
  });

  // D4 fix (Task 8): the CTA navigated to Scan with mode: "label" — asking
  // for the nutrition-label photo that step 2 of the main flow already
  // collects. Uses renderScanRoute (barcode route, no itemId) because the
  // verification section only renders under `!itemId && barcode &&
  // nutrition`; the default itemId route would keep this text out of the
  // tree regardless of whether the CTA still existed, making the assertion
  // vacuous.
  it("does not render the obsolete Help verify this product CTA", () => {
    const { queryByText } = renderScanRoute({ kind: "open" });

    expect(queryByText("Help verify this product")).toBeNull();
  });
});

describe("NutritionDetailScreen — captured photos", () => {
  const LABEL_A11Y = "Nutrition label you photographed";
  const FRONT_A11Y = "Product front you photographed";

  /**
   * Route params come from the REAL `buildNutritionDetailParams`, never a
   * hand-written literal. A hand-written params object is precisely what hid
   * this bug: the payload boundary was already correct and already tested
   * (`scan-screen-utils.test.ts` → "carries both captured photos through"),
   * but the screen declared its own `RouteParams` that omitted both keys, so
   * nothing in the type system connected the two ends. Building the fixture
   * from the producer means a rename in `RootStackParamList` breaks this
   * suite instead of silently dropping a photo again.
   */
  function renderCompletedSession(
    session: Omit<
      Extract<ScanPhase, { type: "SESSION_COMPLETE" }>,
      "type" | "barcode"
    >,
  ) {
    mockRoute.params = buildNutritionDetailParams({
      type: "SESSION_COMPLETE",
      barcode: "06772408",
      ...session,
    }) as Record<string, unknown>;
    mockUseNutritionLookup.mockReturnValue(baseHookReturn({ calories: 140 }));
    return renderComponent(<NutritionDetailScreen />);
  }

  /**
   * Asserts the SOURCE, not just the presence of a labelled node.
   *
   * The label lives on the group wrapper, which renders identically whether
   * `FallbackImage` resolved the photo or fell back to its grey placeholder
   * — so `getByLabelText(...)` alone passes either way. The exact regression
   * that hides behind the weaker assertion: point `source` at the wrong
   * field, `hasValidUri` returns false, the user gets a grey box where their
   * label photo should be, and every test stays green.
   *
   * Only the loaded branch emits an `<img>` at all (the fallback renders a
   * div plus an icon span), and the mock sets `src` from `source.uri`, so
   * both "did a real photo render" and "was it the RIGHT photo" are
   * checkable here.
   */
  function expectPhotoWithSource(tile: HTMLElement, expectedUri: string) {
    const img = tile.querySelector("img");
    expect(img).toBeTruthy();
    expect(img?.getAttribute("src")).toBe(expectedUri);
  }

  /**
   * Verifies the group label SUBSUMES the caption rendered inside it.
   *
   * Both sides are read off the DOM rather than compared against literals.
   * That distinction is the whole value: two hardcoded strings that happen
   * to overlap prove nothing about the component, whereas this fails the
   * moment the caption text and the group label drift apart — which is the
   * real defect, because an `accessible` group announces ONLY its own label
   * and silently drops any nested text not reflected in it.
   */
  function expectCaptionSubsumedByGroupLabel(tile: HTMLElement) {
    const caption = tile.textContent ?? "";
    // Guard against the vacuous pass: `toContain("")` is always true, so an
    // empty caption would make the real assertion below meaningless.
    expect(caption.length).toBeGreaterThan(0);
    expect(tile.getAttribute("aria-label")).toContain(caption);
  }

  it("renders both captures from a completed three-step session", () => {
    const { getByLabelText, queryByText } = renderCompletedSession({
      nutritionImageUri: "file://panel.jpg",
      frontImageUri: "file://front.jpg",
      ocrText: "Calories 140",
    });

    expectPhotoWithSource(getByLabelText(LABEL_A11Y), "file://panel.jpg");
    expectPhotoWithSource(getByLabelText(FRONT_A11Y), "file://front.jpg");
    expect(queryByText("Your photos")).toBeTruthy();
  });

  /**
   * The a11y contract is ONE node per photo, not two. Image and caption are
   * collapsed into a single `accessible` group, so the caption's text must
   * not also surface as its own labelled node — that is the double-announce
   * `docs/rules/accessibility.md` prohibits, and it is invisible on device
   * until someone turns VoiceOver on.
   */
  it("exposes each photo as a single labelled node, not image plus caption", () => {
    const { getAllByLabelText, getByLabelText } = renderCompletedSession({
      nutritionImageUri: "file://panel.jpg",
      frontImageUri: "file://front.jpg",
    });

    expect(getAllByLabelText(LABEL_A11Y)).toHaveLength(1);
    expect(getAllByLabelText(FRONT_A11Y)).toHaveLength(1);
    // Both tiles, not just the first: they have identical structure, so
    // guarding one and not the other leaves half the contract unpinned.
    expectCaptionSubsumedByGroupLabel(getByLabelText(LABEL_A11Y));
    expectCaptionSubsumedByGroupLabel(getByLabelText(FRONT_A11Y));
  });

  // A session that captured a label but skipped step 3. One photo, no empty
  // frame standing in for the other.
  it("renders only the label capture when the front photo is absent", () => {
    const { getByLabelText, queryByLabelText } = renderCompletedSession({
      nutritionImageUri: "file://blurry.jpg",
      ocrText: null,
    });

    expectPhotoWithSource(getByLabelText(LABEL_A11Y), "file://blurry.jpg");
    expect(queryByLabelText(FRONT_A11Y)).toBeNull();
  });

  /**
   * The negative control, and the one that protects everyone who never uses
   * the label steps: a barcode-only scan must render exactly as it did before
   * this change — no section heading, no placeholder frames.
   */
  it("renders no photo section at all for a barcode-only scan", () => {
    const { queryByLabelText, queryByText } = renderCompletedSession({});

    expect(queryByText("Your photos")).toBeNull();
    expect(queryByLabelText(LABEL_A11Y)).toBeNull();
    expect(queryByLabelText(FRONT_A11Y)).toBeNull();
    // The database product image is untouched by this feature — the captures
    // are additive evidence, not a replacement hero.
    expect(queryByLabelText("No product image available")).toBeTruthy();
  });
});
