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
 * `itemId`); every other suite relies on the `itemId` default below.
 * `mockNavigate` is hoisted (not a fresh `vi.fn()` per `useNavigation()` call)
 * so a test can assert against a stable reference — see the verification-panel
 * CTA test below. */
const { mockUseNutritionLookup, mockRoute, mockNavigate } = vi.hoisted(() => ({
  mockUseNutritionLookup: vi.fn(),
  mockRoute: { params: { itemId: 42 } as Record<string, unknown> },
  mockNavigate: vi.fn(),
}));

const ITEM_ID_ROUTE_PARAMS: Record<string, unknown> = { itemId: 42 };

afterEach(() => {
  mockRoute.params = ITEM_ID_ROUTE_PARAMS;
  mockNavigate.mockClear();
});

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
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
    // The band source (slice 2c). `null` / `null` is the SAVED-ITEM shape and
    // the scan path's pre-lookup shape: no per-100g payload, no derived
    // beverage flag, so every band resolves `unknown` and no row is painted.
    // Suites that need a real band supply both explicitly.
    validatedData: null,
    isBeverage: null,
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

/**
 * Slice 2c rewrote this suite's subject: the Additional Nutrients card became
 * `NutritionPanel`. The assertions are the SAME properties against the new
 * structure — row present, value+unit correct, absent fields not fabricated as
 * zeros — with two changes forced by the panel's contract:
 *
 * - Rows are read through their `accessibilityLabel`, not their visible label.
 *   The summary card's promoted standout uses `standoutCopy`, whose
 *   `unknown` + `hasValue` branch is the bare capitalised nutrient word — the
 *   dominant saved-item state — so "Saturated fat" matches the standout AND
 *   the row label, and a text query would throw on two matches.
 * - An absent nutrient no longer omits its row; it renders "Not recorded".
 *   That is `NutritionPanel`'s deliberate contract (see its docblock): a
 *   vanishing row reads as "nothing to worry about". The property the old
 *   assertions protected — that an absent value is never shown as a zero —
 *   survives as an explicit "no 0 g / 0 mg anywhere" check.
 */
describe("NutritionDetailScreen — nutrient panel rows", () => {
  it("renders a saturated fat row and a caffeine row when present", () => {
    mockUseNutritionLookup.mockReturnValue(
      baseHookReturn({ saturatedFat: 2.5, caffeine: 95 }),
    );

    const { queryByText, queryByLabelText } = renderComponent(
      <NutritionDetailScreen />,
    );

    // Sanity check: the screen actually rendered (not a thrown/empty tree).
    expect(queryByText("Unknown Product")).toBeTruthy();

    expect(queryByText("Additional Nutrients")).toBeNull();
    // No band word after the value: `validatedData` is null and the stored
    // serving carries no metric quantity, so the basis is unknown.
    expect(queryByLabelText("Saturated fat, 2.5 grams")).toBeTruthy();
    expect(queryByLabelText("Caffeine, 95 milligrams")).toBeTruthy();
    // Locks the roundToOneDecimal wiring end-to-end — not just that the row
    // renders, but that the displayed value+unit is correct.
    expect(queryByText("2.5 g")).toBeTruthy();
    expect(queryByText("95 mg")).toBeTruthy();
    // The undefined fields keep their rows but state their absence, and no
    // "0 g"/"0 mg" is invented for them.
    expect(queryByLabelText("Trans fat, not recorded")).toBeTruthy();
    expect(queryByLabelText("Cholesterol, not recorded")).toBeTruthy();
    expect(queryByText("0 g")).toBeNull();
    expect(queryByText("0 mg")).toBeNull();
  });

  it("renders trans fat and cholesterol rows when present", () => {
    mockUseNutritionLookup.mockReturnValue(
      baseHookReturn({ transFat: 0.4, cholesterol: 15 }),
    );

    const { queryByText, queryByLabelText } = renderComponent(
      <NutritionDetailScreen />,
    );

    expect(queryByLabelText("Trans fat, 0.4 grams")).toBeTruthy();
    expect(queryByLabelText("Cholesterol, 15 milligrams")).toBeTruthy();
    // Locks the roundToOneDecimal wiring end-to-end — not just that the row
    // renders, but that the displayed value+unit is correct.
    expect(queryByText("0.4 g")).toBeTruthy();
    expect(queryByText("15 mg")).toBeTruthy();
    expect(queryByLabelText("Saturated fat, not recorded")).toBeTruthy();
    expect(queryByLabelText("Caffeine, not recorded")).toBeTruthy();
  });

  it("renders every row as Not recorded when no nutrient field is present", () => {
    mockUseNutritionLookup.mockReturnValue(baseHookReturn({}));

    const { queryByText, getAllByText } = renderComponent(
      <NutritionDetailScreen />,
    );

    expect(queryByText("Unknown Product")).toBeTruthy();
    expect(queryByText("Additional Nutrients")).toBeNull();
    // One per row in NUTRIENT_ROWS (sugar, saturated fat, total fat, sodium,
    // fibre, protein, trans fat, cholesterol, caffeine), every one of them
    // stating its absence. The panel deliberately does NOT vanish here — the
    // predecessor card did, and a silent nutrient table reads as a clean bill
    // of health. The count is exact on purpose: adding a tenth row should turn
    // this red so the new row's not-recorded rendering gets looked at, and
    // dropping a row can never pass as "rendered but empty".
    expect(getAllByText("Not recorded")).toHaveLength(9);
    // The half of the old assertion that still applies: nothing absent is
    // rendered as a zero.
    expect(queryByText("0 g")).toBeNull();
    expect(queryByText("0 mg")).toBeNull();
  });
});

describe("NutritionDetailScreen — For you / Heads up flags (Task 13)", () => {
  it("renders neither section when there are no flags", () => {
    mockUseNutritionLookup.mockReturnValue(baseHookReturn({}, []));

    const { queryByText } = renderComponent(<NutritionDetailScreen />);

    expect(queryByText("For you")).toBeNull();
    expect(queryByText("Heads up")).toBeNull();
  });

  it("splits allergen flags into For-you and universal flags into Heads-up, with the Nutri-Score on the summary card", () => {
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

    const { queryByText, getByLabelText, queryByLabelText, queryByTestId } =
      renderComponent(<NutritionDetailScreen />);

    // "For you" keeps only the Phase-1 personal (allergen) flag — its
    // existing rendering/behavior is otherwise unchanged.
    expect(queryByText("For you")).toBeTruthy();
    expect(queryByText("Contains Peanuts")).toBeTruthy();

    // "Heads up" gets the universal flags via the existing ScanFlagBadge.
    expect(queryByText("Heads up")).toBeTruthy();
    expect(queryByText("Ultra-processed")).toBeTruthy();
    expect(queryByText("Contains caffeine")).toBeTruthy();

    // Slice 2c (D3): the Nutri-Score is no longer a Heads-up citizen — it is
    // the summary card's ring. Asserting the RING, not just the label, is what
    // proves the chip MOVED rather than that some other surface happens to
    // carry the same accessible name.
    const ring = queryByTestId("nutri-score-ring");
    expect(ring).toBeTruthy();
    expect(ring?.querySelector('[aria-label="Nutri-Score E"]')).toBeTruthy();
    expect(getByLabelText("Nutri-Score E")).toBeTruthy();

    // NO composed group label wraps these badges. It was removed
    // deliberately: an accessible={true} wrapper collapses the subtree on
    // iOS to speak only the summary, which made each flag's explanation
    // ("High in sugar. Above the FSA guideline for sugar.") unreachable,
    // while on Android it never collapsed at all and TalkBack read the
    // summary and then every badge again. See the rationale comment in
    // client/components/nutrition/FlagSections.tsx.
    //
    // Asserting the summary's ABSENCE is what stops the wrapper being
    // reintroduced by a future refactor; jsdom cannot observe the collapse
    // itself in either direction (see
    // docs/solutions/conventions/jsdom-rn-render-tests-cannot-assert-a11y-tree-hiding-2026-07-03.md).
    expect(
      queryByLabelText("2 nutrition flags: Ultra-processed, Contains caffeine"),
    ).toBeNull();

    // Structural, not string-matching. The line above pins one literal
    // sentence, which a reintroduced wrapper would evade just by rewording or
    // by running under a different flag fixture. The shape that must not come
    // back is "a badge has a labelled ANCESTOR" — in this harness an
    // accessible={true} group renders as a div carrying aria-label — so walk
    // up from a badge's own labelled node and require nothing above it.
    const badge = queryByText("Ultra-processed")?.closest("[aria-label]");
    expect(badge).toBeTruthy();
    expect(badge?.parentElement?.closest("[aria-label]")).toBeNull();
  });

  /**
   * Was: "shows the Heads-up section for the Nutri-Score chip alone when there
   * are no universal flags". Slice 2c (D3) reverses that — the chip left the
   * section, so the section now has nothing to show and must not render. Same
   * fixture, same subject, opposite expectation for "Heads up".
   */
  it("renders the Nutri-Score on the summary card and NO Heads-up section when it is the only flag", () => {
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

    const { queryByText, getByLabelText, queryByTestId } = renderComponent(
      <NutritionDetailScreen />,
    );

    expect(queryByText("For you")).toBeNull();
    // An empty "Heads up" heading is worse than no section at all.
    expect(queryByText("Heads up")).toBeNull();
    // The chip still carries its own accessibility node in its new home —
    // nothing wraps it or speaks on its behalf.
    expect(queryByTestId("nutri-score-ring")).toBeTruthy();
    expect(getByLabelText("Nutri-Score C")).toBeTruthy();
  });

  /**
   * The empty-section guard, in the shape slice 2c newly made reachable: a
   * product whose only universal flags are the three the panel now bands.
   * `partition.universal` is non-empty, so a section gated on IT would render
   * a "Heads up" heading over nothing.
   */
  it("renders no Heads-up section when every universal flag is panel-owned", () => {
    const flags = [
      {
        id: "nutrient:sugar",
        kind: "nutrient",
        severity: "warn",
        tier: "nutrition",
        nutrient: "sugar",
        title: "High in sugar",
      },
      {
        id: "nutrient:sodium",
        kind: "nutrient",
        severity: "warn",
        tier: "nutrition",
        nutrient: "sodium",
        title: "High in salt",
      },
    ];
    mockUseNutritionLookup.mockReturnValue(baseHookReturn({}, flags));

    const { queryByText } = renderComponent(<NutritionDetailScreen />);

    expect(queryByText("Heads up")).toBeNull();
    expect(queryByText("High in sugar")).toBeNull();
    expect(queryByText("High in salt")).toBeNull();
  });

  it("caps the rendered badges at the first 6 (finding #4, PR #694 medium review)", () => {
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

    const { getAllByText, queryByText } = renderComponent(
      <NutritionDetailScreen />,
    );

    // Exactly the first six render, and the seventh does not. Naming both
    // sides of the boundary fails loudly if the slice ever changes size or
    // start index — a bare count assertion would still pass if the cap
    // kept six flags but the wrong six.
    expect(getAllByText(/^Flag \d$/)).toHaveLength(6);
    expect(queryByText("Flag 5")).toBeTruthy();
    expect(queryByText("Flag 6")).toBeNull();
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

  // The mirror of the "label only" case above, and the fourth quadrant of
  // the (label, front) presence matrix. This is precisely the boundary
  // Task 4's `{a || b ? … : null}` → `if (!a && !b) return null` conversion
  // touched — front-only is the one shape that ternary form and the
  // early-return form must agree on identically.
  it("renders only the front capture when the label photo is absent", () => {
    const { getByLabelText, queryByLabelText } = renderCompletedSession({
      frontImageUri: "file://front-only.jpg",
      ocrText: undefined,
    });

    expectPhotoWithSource(getByLabelText(FRONT_A11Y), "file://front-only.jpg");
    expect(queryByLabelText(LABEL_A11Y)).toBeNull();
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
    // The hero is untouched by this feature — the captures are additive
    // evidence, not a replacement hero. The hero image itself is decorative
    // and carries no accessible name (see FallbackImage's docblock), so the
    // hero's product name is what proves ProductHero still rendered.
    expect(queryByText("Unknown Product")).toBeTruthy();
  });
});

/**
 * Characterisation suites (Slice 2b). These pin behaviour that already exists
 * but had NO coverage, so the extraction in Tasks 2-6 has something to fail
 * against. They must PASS on unmodified code — a red test here means the test
 * is wrong, not the screen.
 */
describe("NutritionDetailScreen — loading branch (2b characterisation)", () => {
  function renderLoading() {
    mockRoute.params = { barcode: "06772408", ocrText: null };
    mockUseNutritionLookup.mockReturnValue({
      ...baseHookReturn({ productName: "Cherry Coke" }),
      isLoading: true,
    });
    return renderComponent(<NutritionDetailScreen />);
  }

  it("renders the skeleton and announces Loading", () => {
    const announceSpy = vi.spyOn(
      RN.AccessibilityInfo,
      "announceForAccessibility",
    );
    try {
      const { queryByText } = renderLoading();

      expect(announceSpy).toHaveBeenCalledWith("Loading");
      // Negative control: the loading branch returns EARLY, so no main-branch
      // content may be in the tree. Without this, a component that rendered
      // both branches would still pass the announcement assertion.
      expect(queryByText("Cherry Coke")).toBeNull();
    } finally {
      announceSpy.mockRestore();
    }
  });
});

// NutritionDetailScreen — modal focus containment (2b characterisation):
// deliberately NOT a test. `accessibilityViewIsModal` reaches the DOM only
// through mockComponent's `...rest` spread and is not one of the props the
// mock special-cases, so — like the `accessible` boolean prop documented in
// docs/solutions/conventions/jsdom-rn-render-tests-cannot-assert-a11y-tree-hiding-2026-07-03.md —
// it never appears as an attribute on the rendered DOM node for either
// branch. Empirically confirmed: `container.querySelectorAll("[accessibilityviewismodal]")`
// returned 0 on BOTH the main branch and the loading branch, so an assertion
// of `.length === 1` could never fail and would pass vacuously regardless of
// whether the screen (or an extracted component in Tasks 2-6) keeps the
// prop. `accessibilityViewIsModal` on both
// `<ThemedView style={styles.container} accessibilityViewIsModal>` tags in
// NutritionDetailScreen.tsx — one per branch (loading and main) — is
// therefore a diff-review obligation, not a test — verify on device with
// VoiceOver per docs/rules/accessibility.md instead.

describe("NutritionDetailScreen — product hero (2b characterisation)", () => {
  function renderHero(nutrition: Record<string, unknown>) {
    mockRoute.params = { barcode: "06772408", ocrText: null };
    mockUseNutritionLookup.mockReturnValue(baseHookReturn(nutrition));
    return renderComponent(<NutritionDetailScreen />);
  }

  it("renders product name, brand and serving size", () => {
    const { queryByText } = renderHero({
      productName: "Cherry Coke",
      brandName: "Coca-Cola",
      servingSize: "1 can (355 ml)",
    });

    const productNameNode = queryByText("Cherry Coke");
    expect(productNameNode).toBeTruthy();
    expect(queryByText("Coca-Cola")).toBeTruthy();
    expect(queryByText("Serving size: 1 can (355 ml)")).toBeTruthy();
    // Mirrors the structural check below (brand-omission test): the hero's
    // product name, brand and serving-size fields are direct siblings inside
    // one `Animated.View`, not separately wrapped. That flat shape is what
    // makes `nextElementSibling` a valid probe for "was this sibling
    // omitted?" over there. Empirically confirmed: wrapping the product-name
    // `ThemedText` alone in a `View` (isolating it from its siblings) turns
    // THIS assertion red — the sibling relation the brand-omission test
    // relies on is gone. Wrapping all three fields together in one shared
    // `View` does NOT turn it red, because the three stay adjacent inside
    // that wrapper; a per-field wrapper is the failure mode this guards
    // against. Asserting non-null here, with all three fields present, fails
    // loudly the moment a field gets isolated into its own wrapper.
    expect(productNameNode?.nextElementSibling).not.toBeNull();
  });

  it("falls back to Unknown Product and omits an absent brand", () => {
    // brandName is explicitly "" (falsy but PRESENT), not merely absent from
    // the fixture. The screen renders `{nutrition.brandName}` — the brand's
    // own literal value, never a hardcoded string — so with the key left out
    // entirely, `queryByText("Coca-Cola")` could never find a match for ANY
    // implementation of the omission guard, correct or broken: "Coca-Cola"
    // was never in the tree to begin with. An explicit falsy value is the
    // input that actually exercises `nutrition?.brandName ? (...) : null`
    // (fix for review finding: PR review, 2b Task 1 re-review).
    const { queryByText } = renderHero({ productName: "", brandName: "" });

    const productNameNode = queryByText("Unknown Product");
    expect(productNameNode).toBeTruthy();
    // A falsy brandName renders no visible TEXT either way — an empty-string
    // child is textually indistinguishable from "not rendered" — so a
    // text-based assertion can't tell a correct guard from a broken one that
    // renders an empty node. Detect the omission structurally instead: the
    // product name has no DOM sibling at all. NOTE this covers ALL of the
    // hero's conditional siblings (brand AND the serving-size line right
    // after it — the `nutrition?.brandName ? (...) : null` and
    // `nutrition?.servingSize && !showServingControls ? (...) : null` blocks
    // in client/components/nutrition/ProductHero.tsx), not brandName alone —
    // this fixture leaves servingSize unset too, so a red here means
    // "something rendered in the hero that shouldn't have," not specifically
    // the brand guard. Empirically confirmed non-vacuous for the brand guard
    // specifically: forcing it to render unconditionally produces an extra
    // (empty) sibling `<span>` here even though its text content is "".
    expect(productNameNode?.nextElementSibling).toBeNull();
  });

  // The hero image is DECORATIVE and carries no accessible name: the product
  // name it would announce is already spoken by the <h2> directly below, so a
  // label here would only double-announce. `FallbackImage` no longer accepts
  // `accessibilityLabel` at all — its docblock carries the RN gating that made
  // the old label inert on both platforms, device-confirmed — so this is now
  // enforced by the type system rather than by convention.
  //
  // The handle is `testID`, which reaches the real <Image> ONLY (the
  // placeholder branch takes no image props). That preserves the property the
  // old label-based assertion existed for: if the `source` wiring breaks, the
  // placeholder takes over, the testID disappears, and this goes red. See
  // docs/solutions/conventions/assert-source-not-label-when-fallback-shares-it-2026-07-30.md
  it("renders the product image from the source URL, with no accessible name", () => {
    const { queryByTestId, queryByLabelText } = renderHero({
      productName: "Cherry Coke",
      imageUrl: "https://example.test/coke.png",
    });

    const hero = queryByTestId("product-hero-image");
    expect(hero).toBeTruthy();
    expect(hero?.getAttribute("src")).toBe("https://example.test/coke.png");
    expect(queryByLabelText("Image of Cherry Coke")).toBeNull();
  });

  it("falls back to a silent placeholder when there is no image", () => {
    const { queryByTestId, queryByLabelText, queryByText } = renderHero({
      productName: "Cherry Coke",
    });

    // No real <Image> rendered — the placeholder branch took over.
    expect(queryByTestId("product-hero-image")).toBeNull();
    // And it announces nothing. A screen-reader user gains nothing from being
    // told a decorative placeholder graphic is on screen, and the product
    // name is announced immediately below it either way.
    expect(queryByLabelText("No product image available")).toBeNull();
    expect(queryByText("Cherry Coke")).toBeTruthy();
  });
});

describe("NutritionDetailScreen — verification panel (2b characterisation)", () => {
  function renderVerification(overrides: Record<string, unknown>) {
    mockRoute.params = { barcode: "06772408", ocrText: null };
    mockUseNutritionLookup.mockReturnValue({
      ...baseHookReturn({ productName: "Cherry Coke" }),
      ...overrides,
    });
    return renderComponent(<NutritionDetailScreen />);
  }

  it("offers the front-label CTA for a verified product with no front-label data", () => {
    const { queryByText } = renderVerification({
      verificationLevel: "verified",
      hasFrontLabelData: false,
    });

    expect(queryByText("Add product details")).toBeTruthy();
    expect(queryByText("Scan front of package")).toBeTruthy();
  });

  it("withholds the CTA once front-label data exists", () => {
    const { queryByText } = renderVerification({
      verificationLevel: "verified",
      hasFrontLabelData: true,
    });

    expect(queryByText("Add product details")).toBeNull();
  });

  it("withholds the CTA for an unverified product", () => {
    const { queryByText } = renderVerification({
      verificationLevel: "unverified",
      hasFrontLabelData: false,
    });

    expect(queryByText("Add product details")).toBeNull();
  });

  // The ONLY seam this slice newly created: before the refactor the handler
  // was inline on the screen; now it arrives at VerificationPanel as a prop.
  // A prop that's declared, destructured, and never forwarded to `onPress`
  // would be type-clean, lint-clean, and pixel-identical — a button that
  // renders perfectly and does nothing. `mockNavigate` is the hoisted,
  // module-scoped mock (not a fresh `vi.fn()` per `useNavigation()` call) so
  // it has something stable to assert against.
  it("navigates to the front-label scan when the CTA is pressed", () => {
    const { getByText } = renderVerification({
      verificationLevel: "verified",
      hasFrontLabelData: false,
    });

    fireEvent.click(getByText("Add product details"));

    expect(mockNavigate).toHaveBeenCalledWith("Scan", {
      mode: "front-label",
      verifyBarcode: "06772408",
    });
  });
});

/**
 * Slice 2c — NutritionSummaryCard + NutritionPanel replace the calorie card and
 * the Additional Nutrients list.
 *
 * These are the assertions the pure tests structurally cannot make. The
 * serving-invariance guarantee lives in the CALL SITE's choice of band source:
 * `nutrition-band-source.ts`'s own tests prove `buildPanelRows` reads
 * `validatedData` when handed it, but nothing there executes the screen, so a
 * screen that passed the serving-scaled `nutrition` in as `validatedData`
 * would leave every pure test green while over-warning on every product the
 * user re-portions.
 */
describe("NutritionDetailScreen — nutrition panel wiring (slice 2c)", () => {
  /**
   * A 100 ml drink serving, so per-100 and per-serving coincide at quantity 1
   * and the arithmetic below is readable. Sugar 10.6 g sits inside the FSA
   * DRINK medium band (low 2.5, high 11.25 per 100 ml) — deliberately close
   * enough to the high line that DOUBLING it crosses into HIGH, which is what
   * makes the invariance test below discriminate rather than pass vacuously.
   *
   * Byte-identical across both renders of that test: `recalculateNutrition`
   * never calls `setValidatedData`, so the real hook holds this object still
   * while `nutrition` moves underneath it. That is the property under test.
   */
  const INVARIANT_PER_100_ML = {
    calories: 42,
    protein: 0,
    carbs: 10.6,
    fat: 0,
    sugar: 10.6,
    saturatedFat: 0,
    sodium: 5,
    fiber: 0,
  };
  const INVARIANT_VALIDATED = {
    perServing: INVARIANT_PER_100_ML,
    per100g: INVARIANT_PER_100_ML,
    servingInfo: {
      displayLabel: "1 glass (100 ml)",
      grams: 100,
      wasCorrected: false,
    },
    isServingDataTrusted: true,
  };

  it("renders the saved-item sugar row UNBANDED — no indicator, no tag", () => {
    // Saved-item path: `validatedData` is null and `nutrition` IS the
    // per-serving source, but "1 bottle" carries no metric quantity, so
    // `resolveBasis` returns `unknown` and 39 g of sugar gets no colour. A
    // fabricated denominator here would be a confident false claim.
    //
    // Asserting on the indicator and the value rather than the row label: a
    // label-only assertion passes in every row state.
    mockRoute.params = { itemId: 42 };
    mockUseNutritionLookup.mockReturnValue(
      baseHookReturn({
        productName: "Mystery Drink",
        servingSize: "1 bottle",
        sugar: 39,
      }),
    );

    const { queryByTestId, queryByText, queryByLabelText } = renderComponent(
      <NutritionDetailScreen />,
    );

    expect(queryByText("39 g")).toBeTruthy();
    // The POSITIVE form of "no tag", and the assertion that makes this test
    // discriminate at all: the old Additional Nutrients markup also rendered a
    // "39 g" sugar row and also had no indicator, so the three assertions
    // around this one pass on the pre-2c screen too. A row label with no band
    // word after the value exists only in the panel.
    expect(queryByLabelText(/^Sugar, /)?.getAttribute("aria-label")).toBe(
      "Sugar, 39 grams",
    );
    expect(queryByTestId("band-indicator-sugar")).toBeNull();
    expect(queryByText("HIGH")).toBeNull();
    expect(queryByText("LOW")).toBeNull();
  });

  /**
   * The whole slice turns on this one: a band describes the PRODUCT, not the
   * plateful, so re-portioning must move the numbers and leave the judgement
   * alone.
   *
   * The quantity change is modelled as the hook really emits it — same
   * `validatedData`, `nutrition` re-scaled, `servingQuantity` bumped — because
   * `useNutritionLookup` is mocked and `setServingQuantity` is a `vi.fn()`
   * that cannot drive a re-render on its own.
   *
   * The sugar row is read through its own `accessibilityLabel` rather than a
   * bare value/tag text query: "MED" renders TWICE (the promoted standout in
   * the summary card and the sugar row's pill), so a global text query would
   * match two nodes and throw. The label is scoped to the row and carries the
   * value and the tag in one string, which is exactly the pair under test.
   * The visible cell is asserted separately — the label goes through
   * `formatValue`, the cell through `roundToOneDecimal`.
   */
  it("does NOT change a band tag when the serving quantity changes", () => {
    mockRoute.params = { barcode: "5449000000996", ocrText: null };
    mockUseNutritionLookup.mockReturnValue({
      ...baseHookReturn({
        // `recalculateNutrition` overwrites this to `${grams}g` on the gram
        // branch — kept faithful here precisely because the band must NOT be
        // resolved from it (a rewritten "100g" would flip a drink's scale to
        // food if `isBeverage` were ever absent).
        servingSize: "100g",
        ...INVARIANT_PER_100_ML,
      }),
      isBeverage: true,
      validatedData: INVARIANT_VALIDATED,
      servingSizeGrams: 100,
      servingQuantity: 1,
    });

    const { queryByLabelText, queryByText, rerender } = renderComponent(
      <NutritionDetailScreen />,
    );
    const sugarRowLabel = () =>
      queryByLabelText(/^Sugar, /)?.getAttribute("aria-label");

    expect(sugarRowLabel()).toBe("Sugar, 10.6 grams, medium");
    expect(queryByText("10.6 g")).toBeTruthy();

    // Quantity 2. Literals, not `10.6 * 2` — a computed fixture can drift
    // with the code it is meant to pin.
    mockUseNutritionLookup.mockReturnValue({
      ...baseHookReturn({
        servingSize: "100g",
        calories: 84,
        protein: 0,
        carbs: 21.2,
        fat: 0,
        sugar: 21.2,
        saturatedFat: 0,
        sodium: 10,
        fiber: 0,
      }),
      isBeverage: true,
      validatedData: INVARIANT_VALIDATED,
      servingSizeGrams: 100,
      servingQuantity: 2,
    });
    rerender(<NutritionDetailScreen />);

    // 21.2 g/100 ml would band HIGH. It does not, because the band never saw
    // the serving-scaled number.
    expect(sugarRowLabel()).toBe("Sugar, 21.2 grams, medium");
    expect(queryByText("21.2 g")).toBeTruthy();
    expect(queryByText("10.6 g")).toBeNull();
  });

  it("no longer renders the Additional Nutrients section", () => {
    mockRoute.params = { barcode: "5449000000996", ocrText: null };
    mockUseNutritionLookup.mockReturnValue(
      baseHookReturn({ calories: 42, sugar: 10.6 }),
    );

    const { queryByText } = renderComponent(<NutritionDetailScreen />);

    expect(queryByText("Additional Nutrients")).toBeNull();
    // Negative control: the panel that replaced it IS in the tree, so this is
    // not passing merely because the screen failed to render. `validatedData`
    // is null here, so every band is `unknown` and no standout is promoted —
    // which is also why "Sugar" matches exactly one node (the row label).
    expect(queryByText("Sugar")).toBeTruthy();
  });

  it("does not render sugar / saturated-fat / sodium as Heads up badges", () => {
    mockRoute.params = { barcode: "5449000000996", ocrText: null };
    mockUseNutritionLookup.mockReturnValue(
      baseHookReturn({ calories: 42, sugar: 39 }, [
        {
          id: "nutrient:sugar",
          kind: "nutrient",
          severity: "warn",
          tier: "nutrition",
          nutrient: "sugar",
          title: "High in sugar",
        },
        {
          id: "nutrient:caffeine",
          kind: "nutrient",
          severity: "info",
          tier: "nutrition",
          nutrient: "caffeine",
          title: "Contains caffeine",
        },
      ]),
    );

    const { queryByText } = renderComponent(<NutritionDetailScreen />);

    // The panel's sugar row owns this judgement now. (`validatedData` is null,
    // so no standout is promoted and this string cannot be matched by the
    // summary card's "High in sugar" copy instead.)
    expect(queryByText("High in sugar")).toBeNull();
    // Caffeine ships as kind:"nutrient" too. A `kind !== "nutrient"` filter
    // would delete this, and the panel's caffeine row (unbanded, value only)
    // does not replace it.
    expect(queryByText("Contains caffeine")).toBeTruthy();
    expect(queryByText("Heads up")).toBeTruthy();
  });
});
