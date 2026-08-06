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
import { act, fireEvent } from "@testing-library/react";
import * as RN from "react-native";
import { renderComponent } from "../../../test/utils/render-component";
import NutritionDetailScreen from "../NutritionDetailScreen";
import { deriveLogGate, type LogGate } from "../nutrition-detail-utils";
import { buildNutritionDetailParams } from "../scan-screen-utils";
import { Spacing } from "@/constants/theme";
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

/**
 * A NON-ZERO bottom inset, overriding the shared mock
 * (`test/mocks/react-native-safe-area-context.ts`), which reports 0 on every
 * edge. With 0 the two candidate paddings — `insets.bottom + Spacing["3xl"]`
 * and `barHeight + Spacing["3xl"]` — are numerically identical before a layout
 * pass, so the "the inset is counted exactly once" assertions could not fail.
 * `top` stays 0: the header inset comes from `useHeaderHeight()`, not from
 * here, and moving it would only churn unrelated expectations.
 */
const { SAFE_AREA_BOTTOM } = vi.hoisted(() => ({ SAFE_AREA_BOTTOM: 34 }));

vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({
    top: 0,
    bottom: SAFE_AREA_BOTTOM,
    left: 0,
    right: 0,
  }),
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

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
    // Was MISSING despite the docblock above claiming "every field the screen
    // reads": the screen destructures `labelReadNotice`, so every notice test
    // would otherwise render an `undefined` notice and pass vacuously.
    labelReadNotice: null,
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
 * `validatedData` shaped so that `resolveBasis` either CAN or CANNOT place the
 * values on an FSA scale. The two differ only in the serving string, which is
 * the whole point: whether the panel actually bands a nutrient is a property of
 * the data, not of which nutrients the panel nominally covers.
 *
 * Built the way the real payload is built, never by forcing a band value —
 * `"1 serving"` is the literal fallback `validateNutritionData` writes when a
 * record has no usable serving string (client/lib/serving-size-utils.ts:368),
 * and OFF free-text servings ("1 bottle") pass through verbatim. Neither
 * parses, so with `isBeverage` also absent — which `server/routes/nutrition.ts`
 * omits deliberately when a product carries no category tags — `resolveBasis`
 * has no scale to choose and returns `{ kind: "unknown" }`.
 */
function validatedWithServing(
  displayLabel: string,
  per100g: Record<string, number>,
) {
  return {
    perServing: per100g,
    per100g,
    servingInfo: { displayLabel, grams: 100, wasCorrected: false },
    isServingDataTrusted: true,
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
   * product whose only universal flags are ones the panel is actually banding.
   * `partition.universal` is non-empty, so a section gated on IT would render
   * a "Heads up" heading over nothing.
   */
  it("renders no Heads-up section when every universal flag is banded by the panel", () => {
    const flags = [
      {
        id: "nutrient:sugar",
        kind: "nutrient",
        severity: "warn",
        tier: "nutrition",
        nutrient: "sugar",
        title: "High in sugar",
        detail: "Above the FSA guideline for sugar.",
      },
      {
        id: "nutrient:sodium",
        kind: "nutrient",
        severity: "warn",
        tier: "nutrition",
        nutrient: "sodium",
        title: "High in sodium",
        detail: "Above the FSA guideline for sodium.",
      },
    ];
    mockRoute.params = { barcode: "5449000000996", ocrText: null };
    mockUseNutritionLookup.mockReturnValue({
      ...baseHookReturn({ calories: 42, sugar: 12.5, sodium: 400 }, flags),
      // Both nutrients must band HIGH, not merely band: a `warn` badge is
      // dropped only when the panel's band AGREES with it, and a MEDIUM row is
      // a strictly weaker statement than "High in sugar" (see
      // FlagSections-utils.ts, GAP 2). 12.5 > FSA_DRINK.sugar.high 11.25 and
      // 400 > FSA_DRINK.sodium.high 300.
      isBeverage: true,
      validatedData: validatedWithServing("1 glass (100 ml)", {
        sugar: 12.5,
        sodium: 400,
      }),
    });

    const { queryByText, queryByLabelText, queryByTestId } = renderComponent(
      <NutritionDetailScreen />,
    );

    expect(queryByTestId("band-indicator-sugar")).toBeTruthy();
    expect(queryByTestId("band-indicator-sodium")).toBeTruthy();
    expect(queryByText("Heads up")).toBeNull();
    // Queried by the BADGE's accessible name (`${title}. ${detail}`), not by
    // its title text: at a HIGH band `standoutCopy` renders the literal string
    // "High in sugar" on the summary card, so a text query would match the
    // standout and could never observe the badge's absence. Only
    // `ScanFlagBadge` composes title+detail.
    expect(
      queryByLabelText("High in sugar. Above the FSA guideline for sugar."),
    ).toBeNull();
    expect(
      queryByLabelText("High in sodium. Above the FSA guideline for sodium."),
    ).toBeNull();
    // THIS is the state that lost the disclaimer. Every badge is dropped, so
    // `FlagSections` renders nothing — and while the disclaimer lived inside
    // it, the user got a Nutri-Score ring, "High in sugar" standout copy and
    // red traffic-light pills with no qualifier anywhere on the screen. The
    // section assertions above all passed throughout, which is why the loss
    // was invisible: they check that the badges are gone, and the disclaimer
    // was silently gone with them.
    expect(
      queryByText("Informational only — not medical advice."),
    ).toBeTruthy();
  });

  /**
   * The disclaimer's correctness is that it has NO gate — it qualifies claims
   * made from three different components, so it cannot belong to any one of
   * them.
   *
   * Breadth cover, NOT the discriminating case. Only the no-flags case would
   * have failed under the old per-section disclaimer; the personal-only case
   * still renders "For you", which used to carry its own copy, so it passes
   * either way. The state that actually shipped the bug — every universal flag
   * dropped as already-banded, both sections empty — is pinned by the sibling
   * test above. This one guards against a future gate appearing on the new,
   * ungated placement.
   */
  it("shows the medical-advice disclaimer whatever the flag state", () => {
    const cases: { name: string; flags: unknown[] }[] = [
      { name: "no flags at all", flags: [] },
      {
        name: "personal flags only",
        flags: [
          {
            id: "allergen:milk",
            kind: "allergen",
            severity: "danger",
            tier: "safety",
            title: "Contains milk",
            detail: "You listed milk as an allergen.",
          },
        ],
      },
    ];

    for (const { name, flags } of cases) {
      mockRoute.params = { barcode: "5449000000996", ocrText: null };
      mockUseNutritionLookup.mockReturnValue(
        baseHookReturn({ calories: 42 }, flags),
      );
      const { queryByText, unmount } = renderComponent(
        <NutritionDetailScreen />,
      );
      expect(
        queryByText("Informational only — not medical advice."),
        `disclaimer missing with ${name}`,
      ).toBeTruthy();
      unmount();
    }
  });

  it("renders the disclaimer exactly once, not once per section", () => {
    // It used to be duplicated into both section bodies, so a product with
    // personal AND universal flags said it twice. One claim surface losing
    // its copy was then invisible, because another still printed it.
    const flags = [
      {
        id: "allergen:milk",
        kind: "allergen",
        severity: "danger",
        tier: "safety",
        title: "Contains milk",
        detail: "You listed milk as an allergen.",
      },
      {
        id: "processing:ultra",
        kind: "processing",
        severity: "warn",
        tier: "nutrition",
        title: "Ultra-processed",
        detail: "NOVA group 4.",
      },
    ];
    mockRoute.params = { barcode: "5449000000996", ocrText: null };
    mockUseNutritionLookup.mockReturnValue(
      baseHookReturn({ calories: 42 }, flags),
    );

    const { queryAllByText } = renderComponent(<NutritionDetailScreen />);

    expect(queryAllByText("For you")).toHaveLength(1);
    expect(queryAllByText("Heads up")).toHaveLength(1);
    expect(
      queryAllByText("Informational only — not medical advice."),
    ).toHaveLength(1);
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
    mockUseNutritionLookup.mockReturnValue({
      ...baseHookReturn({ calories: 42, sugar: 12.5 }, [
        {
          id: "nutrient:sugar",
          kind: "nutrient",
          severity: "warn",
          tier: "nutrition",
          nutrient: "sugar",
          title: "High in sugar",
          detail: "Above the FSA guideline for sugar.",
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
      // A basis the panel can resolve AND a value that bands HIGH (12.5 >
      // FSA_DRINK.sugar.high 11.25) — the badge is dropped because the row
      // makes the SAME judgement, not merely because sugar is a nutrient the
      // panel covers, and not because the row bands it at all. See the
      // unresolvable-basis test below and the MEDIUM-disagreement test in
      // FlagSections-utils.test.ts.
      isBeverage: true,
      validatedData: validatedWithServing("1 glass (100 ml)", { sugar: 12.5 }),
    });

    const { queryByText, queryByLabelText, queryByTestId } = renderComponent(
      <NutritionDetailScreen />,
    );

    // The panel's sugar row owns this judgement now — and demonstrably IS
    // making it, at the same severity, which is what entitles the badge to go.
    expect(queryByTestId("band-indicator-sugar")).toBeTruthy();
    // By the badge's accessible name, not its title: at a HIGH band the
    // summary card's standout renders the literal string "High in sugar".
    expect(
      queryByLabelText("High in sugar. Above the FSA guideline for sugar."),
    ).toBeNull();
    // Caffeine ships as kind:"nutrient" too. A `kind !== "nutrient"` filter
    // would delete this, and the panel's caffeine row (unbanded, value only)
    // does not replace it.
    expect(queryByText("Contains caffeine")).toBeTruthy();
    expect(queryByText("Heads up")).toBeTruthy();
  });

  /**
   * The finding this round fixes: a badge may only be dropped when the panel is
   * ACTUALLY banding that nutrient, not merely when the panel covers it.
   *
   * The two data gaps below are reachable together and correlated — a sparse
   * OFF record typically has neither category tags nor a structured serving
   * size. `server/routes/nutrition.ts:140-142` omits `isBeverage` when
   * `categoriesTags` is empty (deliberately: "absent → fall back to the parsed
   * serving unit, never default to food"), while `universal-flags.ts:74` still
   * emits food-scale nutrient flags for the same product. So the server sends
   * "High in sugar" and the panel cannot band sugar at all — and the pre-fix
   * filter deleted the badge anyway, silently dropping a `severity: "warn"`
   * health flag the pre-2c screen displayed.
   */
  it("KEEPS a panel-owned badge when the basis is unresolvable and the row is unbanded", () => {
    mockRoute.params = { barcode: "5449000000996", ocrText: null };
    mockUseNutritionLookup.mockReturnValue({
      ...baseHookReturn({ calories: 140, sugar: 39 }, [
        {
          id: "nutrient:sugar",
          kind: "nutrient",
          severity: "warn",
          tier: "nutrition",
          nutrient: "sugar",
          title: "High in sugar",
        },
      ]),
      // `isBeverage` left at its `null` default — the shape the route emits for
      // a product with no category tags — and a serving string that does not
      // parse. Together: `scale === null`, so every band is `unknown`.
      validatedData: validatedWithServing("1 serving", { sugar: 39 }),
    });

    const { queryByText, queryByTestId } = renderComponent(
      <NutritionDetailScreen />,
    );

    // The premise, asserted rather than assumed: the panel really is NOT
    // banding sugar here. Without this the test could pass for the wrong
    // reason if the fixture ever started resolving.
    expect(queryByTestId("band-indicator-sugar")).toBeNull();
    // Therefore the server's warning is the only thing saying it, and it must
    // survive.
    expect(queryByText("High in sugar")).toBeTruthy();
    expect(queryByText("Heads up")).toBeTruthy();
  });

  /**
   * The per-nutrient half of the same rule, and the guard on the snake_case →
   * camelCase bridge. `saturated_fat` is the ONLY nutrient whose two spellings
   * differ (`sugar` and `sodium` are identical in both unions), so a dead
   * mapping shows up here and nowhere else: its badge would survive while
   * sugar's was correctly dropped.
   */
  it("drops each panel-owned badge independently — banded ones go, the unbanded one stays", () => {
    mockRoute.params = { barcode: "5449000000996", ocrText: null };
    mockUseNutritionLookup.mockReturnValue({
      // Titles verbatim from NUTRIENT_META (server/services/universal-flags.ts)
      // — a hand-invented title could not collide with the summary card's copy
      // the way the real ones can, which is a property this fixture needs to
      // keep honest.
      ...baseHookReturn({ calories: 42, sugar: 12.5, saturatedFat: 3.5 }, [
        {
          id: "nutrient:sugar",
          kind: "nutrient",
          severity: "warn",
          tier: "nutrition",
          nutrient: "sugar",
          title: "High in sugar",
          detail: "Above the FSA guideline for sugar.",
        },
        {
          id: "nutrient:saturated_fat",
          kind: "nutrient",
          severity: "warn",
          tier: "nutrition",
          nutrient: "saturated_fat",
          title: "High in saturated fat",
          detail: "Above the FSA guideline for saturated fat.",
        },
        {
          id: "nutrient:sodium",
          kind: "nutrient",
          severity: "warn",
          tier: "nutrition",
          nutrient: "sodium",
          title: "High in sodium",
          detail: "Above the FSA guideline for sodium.",
        },
      ]),
      isBeverage: true,
      // Sugar and saturated fat have values and band HIGH on the drink scale
      // (12.5 > 11.25, 3.5 > 2.5), which is what makes them AGREE with their
      // `warn` badges; sodium has no value, so its band is `unknown` and its
      // badge is the only thing warning about it.
      //
      // A HIGH band renders the promoted standout as the literal string "High
      // in sugar" / "High in saturated fat" — the same words as the badges —
      // so the assertions below query the badge's composed accessible name
      // (`${title}. ${detail}`), which only `ScanFlagBadge` produces.
      validatedData: validatedWithServing("1 glass (100 ml)", {
        sugar: 12.5,
        saturatedFat: 3.5,
      }),
    });

    const { queryByLabelText, queryByTestId } = renderComponent(
      <NutritionDetailScreen />,
    );

    expect(queryByTestId("band-indicator-sugar")).toBeTruthy();
    expect(queryByTestId("band-indicator-saturatedFat")).toBeTruthy();
    expect(queryByTestId("band-indicator-sodium")).toBeNull();

    expect(
      queryByLabelText("High in sugar. Above the FSA guideline for sugar."),
    ).toBeNull();
    // The snake_case → camelCase bridge, and the only nutrient that can prove
    // it: `sugar` and `sodium` are spelled identically in both unions, so a
    // dead mapping would show up here alone.
    expect(
      queryByLabelText(
        "High in saturated fat. Above the FSA guideline for saturated fat.",
      ),
    ).toBeNull();
    expect(
      queryByLabelText("High in sodium. Above the FSA guideline for sodium."),
    ).toBeTruthy();
  });
});

/**
 * Slice 2c, Task 8 — the notices collapse into one `NoticeStack`, `error`
 * routes through `InlineError`, and the log button becomes the sticky
 * `LogActionBar` that owns the bottom safe-area inset.
 *
 * Fixture bodies are deliberately nonsense literals (`LABEL_NOTICE_FIXTURE`
 * &c.) rather than realistic copy: three notices, an error and a summary card
 * render in one tree here, and a realistic string can collide with copy some
 * OTHER component emits, turning a red on a string clash into what looks like
 * a finding.
 */
describe("NutritionDetailScreen — notices, error and sticky bar (Task 8)", () => {
  const LABEL_BODY = "LABEL_NOTICE_FIXTURE";
  const CORRECTION_BODY = "CORRECTION_NOTICE_FIXTURE";
  const PER_100G_BODY =
    "Values shown per 100g. Check package for actual serving size.";
  const ERROR_BODY = "ERROR_BANNER_FIXTURE";

  // Derived, not hand-copied — same reasoning as the log-gate suite above.
  const GATED = deriveLogGate({ ocrText: null, labelUsed: false });
  if (GATED.kind !== "needsAcknowledgement") {
    throw new Error("deriveLogGate(null, false) must produce a gated gate");
  }
  const GATED_LABEL = GATED.buttonLabel;

  function renderScan(overrides: Record<string, unknown> = {}) {
    mockRoute.params = { barcode: "06772408", ocrText: null };
    mockUseNutritionLookup.mockReturnValue({
      ...baseHookReturn({ productName: "Cherry Coke", calories: 39 }),
      ...overrides,
    });
    return renderComponent(<NutritionDetailScreen />);
  }

  function renderSavedItem(overrides: Record<string, unknown> = {}) {
    mockRoute.params = { itemId: 42 };
    mockUseNutritionLookup.mockReturnValue({
      ...baseHookReturn({ productName: "Cherry Coke", calories: 39 }),
      ...overrides,
    });
    return renderComponent(<NutritionDetailScreen />);
  }

  /**
   * React keeps every prop it was handed on the host node's fiber, including
   * ones it declined to wire up (`onLayout`) or to recognise
   * (`contentContainerStyle`). Reading them back is the only way to inspect
   * RN layout props in this harness — for an unrecognised object prop React
   * writes a stringified attribute, and jsdom has no layout event to fire.
   * Mirrors `client/components/nutrition/__tests__/LogActionBar.test.tsx`.
   */
  function reactProps(node: Element): Record<string, unknown> {
    const key = Object.keys(node).find((k) => k.startsWith("__reactProps$"));
    if (!key) {
      throw new Error(
        "React's internal props key was not on the node — the __reactProps$ " +
          "prefix may have changed in a React upgrade.",
      );
    }
    return (node as unknown as Record<string, Record<string, unknown>>)[key];
  }

  /** RN styles are arrays of objects; resolve to the effective values. */
  function flattenStyle(style: unknown): Record<string, unknown> {
    const parts = (
      Array.isArray(style) ? style.flat(Infinity) : [style]
    ).filter(Boolean);
    return Object.assign({}, ...parts);
  }

  /**
   * The screen's main ScrollView: the first child of the modal root.
   *
   * Located structurally rather than by a `testID` added to production markup
   * just so a test could find it. A bare
   * `querySelectorAll("[contentcontainerstyle]")` is NOT specific enough —
   * `ServingControls` nests a horizontal ScrollView that carries the same
   * attribute. The attribute check below is the guard that this really is a
   * ScrollView and not some other first child.
   */
  function scrollViewOf(container: HTMLElement): Element {
    const scroll = container.firstElementChild?.firstElementChild;
    if (!scroll?.hasAttribute("contentcontainerstyle")) {
      throw new Error(
        "the modal root's first child was not the main ScrollView",
      );
    }
    return scroll;
  }

  function scrollPaddingBottom(container: HTMLElement): unknown {
    return flattenStyle(
      reactProps(scrollViewOf(container)).contentContainerStyle,
    ).paddingBottom;
  }

  /**
   * The `NoticeStack` row a body string sits in: the body `ThemedText` renders
   * inside the row's `textColumn` View, which is the row's only child element,
   * and every row is a direct child of the ONE stack container.
   */
  function noticeRow(body: HTMLElement): HTMLElement {
    const row = body.parentElement?.parentElement;
    if (!row) {
      throw new Error("notice body was not nested two levels inside a row");
    }
    return row;
  }

  /**
   * The notice announcer, on the screen it was WRITTEN for.
   *
   * `deriveLogGate` gates iff a session photographed a label the pipeline
   * could not use, and `useNutritionLookup.ts:382` sets `labelReadNotice` on
   * that same failure — so the gated screen is precisely the screen carrying
   * "Label not used". `NoticeStack` has no live region (Constraint 12) and the
   * inline blocks it replaced carried the Android-only
   * `accessibilityLiveRegion="polite"`, so this announcer is now Android's
   * ONLY signal for that notice. Suppressing it on the gated screen — as an
   * earlier revision of this task did — switched it off exactly where it
   * matters most.
   *
   * Then the acknowledge press, asserted by CALL COUNT after a `mockClear` so
   * the count is scoped to the click. iOS `UIAccessibility.post(.announcement)`
   * does not queue — post two in one commit and one is silently dropped — so
   * asserting only the acknowledge STRING would pass in exactly the broken
   * case where two fired and the user heard one.
   *
   * `error` stays null in this fixture on purpose — `InlineError` fires its
   * own iOS-gated announce (Constraint 23), which would add a call and make
   * the counts say nothing about the pair under test.
   */
  it("announces the notice at mount, then exactly one acknowledgement on press", () => {
    const announce = vi
      .spyOn(RN.AccessibilityInfo, "announceForAccessibility")
      .mockImplementation(() => {});
    try {
      const { getByText } = renderScan({
        labelReadNotice: LABEL_BODY,
        logGate: GATED,
      });

      expect(announce).toHaveBeenCalledTimes(1);
      expect(announce).toHaveBeenCalledWith(`Label not used. ${LABEL_BODY}`);

      announce.mockClear();
      fireEvent.click(getByText(GATED_LABEL));

      // Exactly one, and it is the gate's. The acknowledge press re-renders
      // only `LogActionBar` (it owns that state since Task 6), so the notice
      // announcer's effect does not re-run — and even if it did, the content
      // key is unchanged and `lastAnnouncedRef` short-circuits it.
      expect(announce).toHaveBeenCalledTimes(1);
      expect(announce).toHaveBeenCalledWith(
        "Values confirmed. Add to Today is now available.",
      );
    } finally {
      announce.mockRestore();
    }
  });

  /**
   * The positive case, on an OPEN gate: the announcer fires once, with the
   * composed content of every notice on screen.
   *
   * This diff deleted the two `accessibilityLiveRegion="polite"` regions that
   * used to be Android's safety net, so "the announcer runs at all" is now
   * load-bearing at the screen level and nothing else asserts it here. The
   * composed string is a literal rather than a call to `noticeAnnouncementKey`:
   * `NoticeStack-utils.test.ts` owns the composition RULE, and re-deriving it
   * here would make the test agree with the implementation by construction
   * instead of pinning the wiring end-to-end.
   */
  it("announces the composed notice content once on an open-gate screen", () => {
    const announce = vi
      .spyOn(RN.AccessibilityInfo, "announceForAccessibility")
      .mockImplementation(() => {});
    try {
      renderScan({
        labelReadNotice: LABEL_BODY,
        correctionNotice: CORRECTION_BODY,
      });

      expect(announce).toHaveBeenCalledTimes(1);
      expect(announce).toHaveBeenCalledWith(
        `Label not used. ${LABEL_BODY} Serving size adjusted. ${CORRECTION_BODY}`,
      );
    } finally {
      announce.mockRestore();
    }
  });

  /**
   * All three advisory surfaces in ONE stack, in ONE position.
   *
   * Asserting a shared parent rather than mere presence is the whole point:
   * three notices each rendered by its own inline block would satisfy every
   * text query while leaving the screen exactly as scattered as before. The
   * per-100g row is the one that proves the MOVE — it rendered BELOW the
   * summary card until this task.
   */
  it("collapses every notice into ONE stack rendered above the summary card", () => {
    const { getByText, getByTestId } = renderScan({
      labelReadNotice: LABEL_BODY,
      correctionNotice: CORRECTION_BODY,
      isPer100g: true,
      flags: [
        {
          id: "nutriscore:e",
          kind: "nutriscore",
          severity: "info",
          tier: "nutrition",
          title: "Nutri-Score E",
          grade: "e",
        },
      ],
    });

    // Each notice's own title still renders, so consolidating the containers
    // did not consolidate away what they said.
    expect(getByText("Label not used")).toBeTruthy();
    expect(getByText("Serving size adjusted")).toBeTruthy();
    expect(getByText("Per 100g")).toBeTruthy();

    const stack = noticeRow(getByText(LABEL_BODY)).parentElement;
    expect(stack).toBeTruthy();
    expect(noticeRow(getByText(CORRECTION_BODY)).parentElement).toBe(stack);
    expect(noticeRow(getByText(PER_100G_BODY)).parentElement).toBe(stack);

    // …and that one stack leads the summary card, so an advisory caveat about
    // the data is read before the verdict it qualifies.
    const ring = getByTestId("nutri-score-ring");
    expect(
      stack!.compareDocumentPosition(ring) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  // Constraint 25: the saved-item view keeps its existing omissions. All three
  // notice inputs are supplied, so a dropped `!itemId` gate goes red here
  // rather than passing because the fixture had nothing to show.
  it("renders no notices at all on the saved-item path", () => {
    const { queryByText } = renderSavedItem({
      labelReadNotice: LABEL_BODY,
      correctionNotice: CORRECTION_BODY,
      isPer100g: true,
    });

    expect(queryByText(LABEL_BODY)).toBeNull();
    expect(queryByText(CORRECTION_BODY)).toBeNull();
    expect(queryByText(PER_100G_BODY)).toBeNull();
    expect(queryByText("Label not used")).toBeNull();
  });

  /**
   * `error` renders through `InlineError`, not as a `NoticeStack` row
   * (Constraint 23): error messages require `assertive`, and the notices
   * deliberately carry no live region at all (Constraint 12) because a polite
   * region on a container wrapping three variants makes TalkBack recompose the
   * whole subtree on any single change.
   *
   * Counting `[aria-live]` across the WHOLE tree is what pins both halves at
   * once: exactly one, and it is the error's.
   */
  it("routes error through InlineError — one assertive live region, none on the notices", () => {
    const { container, getByText, queryByText } = renderScan({
      error: ERROR_BODY,
      labelReadNotice: LABEL_BODY,
      correctionNotice: CORRECTION_BODY,
      isPer100g: true,
    });

    const live = container.querySelectorAll("[aria-live]");
    expect(live).toHaveLength(1);
    expect(live[0].getAttribute("aria-live")).toBe("assertive");
    expect(live[0].getAttribute("role")).toBe("alert");
    expect(live[0].textContent).toContain(ERROR_BODY);

    // The positive form of "the notices carry none": walk up from a notice
    // body and require no live region anywhere above it. Uses the correction
    // and per-100g rows rather than the label notice, which is suppressed
    // whenever `error` is set — see the test below.
    expect(getByText(CORRECTION_BODY).closest("[aria-live]")).toBeNull();
    expect(getByText(PER_100G_BODY).closest("[aria-live]")).toBeNull();
    // This fixture still passes `labelReadNotice`, which the suppression now
    // drops — asserted here rather than removed, so the suppression picks up a
    // second guard from a test that already had the right fixture shape.
    expect(queryByText(LABEL_BODY)).toBeNull();
  });

  /**
   * The label-read notice is suppressed while `error` is set, for two reasons
   * that share one trigger.
   *
   * Content: no path that sets `error` leaves real database values in
   * `nutrition` — the placeholder differs by path (`Unknown Product`,
   * `Product Not Found`, or `null`) but none carries macros — so the notice's
   * own sentence, "so these values come from the product database", describes
   * values that do not exist.
   *
   * Announcement: `setError` and `setIsLoading(false)` land in one commit (no
   * await between the catch and the `finally`), so the screen's `isLoading`
   * early-return releases `NoticeStack` and `InlineError` together. Two
   * announces in one commit collide on iOS and the later one wins, so the
   * notice was spoken and immediately silenced by the error. The hook used to
   * announce it in an earlier commit of its own, which masked this until that
   * duplicate was removed.
   */
  it("suppresses the label notice while an error is showing", () => {
    const announce = vi
      .spyOn(RN.AccessibilityInfo, "announceForAccessibility")
      .mockImplementation(() => {});
    try {
      const { getByText, queryByText } = renderScan({
        error: ERROR_BODY,
        labelReadNotice: LABEL_BODY,
      });

      expect(getByText(ERROR_BODY)).toBeTruthy();
      expect(queryByText(LABEL_BODY)).toBeNull();

      // Not drawn is not the same as not spoken, and the defect here was
      // entirely about speech. A render-only assertion would stay green if the
      // hook's deleted announcer were ever restored — it announces without
      // rendering anything for `queryByText` to catch. Exactly one utterance,
      // and it is the error's.
      expect(announce).toHaveBeenCalledTimes(1);
      expect(announce).toHaveBeenCalledWith(ERROR_BODY);
    } finally {
      announce.mockRestore();
    }
  });

  it("still shows the label notice when the lookup succeeded", () => {
    // Negative control for the test above — the suppression must be scoped to
    // the error state, not a blanket mute. This is the common unreadable-label
    // path, where the database values really are what the user is looking at.
    const { getByText } = renderScan({ labelReadNotice: LABEL_BODY });

    expect(getByText(LABEL_BODY)).toBeTruthy();
  });

  /**
   * Constraint 9: `insets.bottom` is counted exactly ONCE.
   *
   * The bar owns the inset, so the ScrollView must pad by the bar's MEASURED
   * height — never a hardcoded constant, because the bar has three heights
   * (normal, gated, and with the offline caption). Asserting both sides is
   * load-bearing: a screen that dropped the inset from the ScrollView and
   * never added it to the bar would satisfy the first assertion alone while
   * clipping the log button behind the home indicator.
   */
  it("pads the ScrollView by the bar's measured height, with the inset only on the bar", async () => {
    const { container, getByTestId } = renderScan();

    // jsdom fires no layout pass, so this is the pre-measurement state: the
    // bar's height is still 0 and the inset is demonstrably NOT here.
    expect(scrollPaddingBottom(container)).toBe(Spacing["3xl"]);

    const bar = getByTestId("log-action-bar");
    const onLayout = reactProps(bar).onLayout as (e: unknown) => void;
    // ASYNC act, not the sync form: the screen's `useAccessibility` and
    // `useOfflineGuard` both settle a promise on mount, and a sync `act()`
    // drains the microtask queue only AFTER returning — so their state updates
    // land outside it and React logs an "update was not wrapped in act(...)"
    // warning that has nothing to do with the layout event under test.
    await act(async () => {
      onLayout({ nativeEvent: { layout: { height: 96 } } });
    });

    expect(scrollPaddingBottom(container)).toBe(96 + Spacing["3xl"]);
    expect(flattenStyle(reactProps(bar).style).paddingBottom).toBe(
      SAFE_AREA_BOTTOM + Spacing.md,
    );
  });

  /**
   * The other half of "counted once": with no bar to own it, the inset has to
   * stay on the ScrollView or the saved-item view loses its home-indicator
   * clearance. Same reason the loading branch keeps it.
   */
  it("keeps insets.bottom on the ScrollView where no bar renders", () => {
    const { container } = renderSavedItem();

    expect(scrollPaddingBottom(container)).toBe(
      SAFE_AREA_BOTTOM + Spacing["3xl"],
    );
  });

  /**
   * Constraint 8: the bar must render INSIDE the `accessibilityViewIsModal`
   * root, or it falls outside the modal's iOS accessibility scope.
   *
   * Asserted structurally, because `accessibilityViewIsModal` never reaches
   * the DOM in this harness (React declines the unrecognised prop) — see the
   * standing note above the product-hero suite. What IS assertable is the
   * shape the constraint requires: the modal root has exactly two children,
   * the ScrollView and then the bar, so the bar is an absolutely-positioned
   * sibling AFTER the scroller and inside the same root. The prop itself
   * stays a diff-review obligation.
   */
  it("mounts the sticky bar inside the modal root, after the ScrollView", () => {
    const { container, getByTestId } = renderScan();

    const root = container.firstElementChild;
    expect(root).toBeTruthy();
    expect(root!.children).toHaveLength(2);
    expect(root!.children[0]).toBe(scrollViewOf(container));
    expect(root!.children[1]).toBe(getByTestId("log-action-bar"));
  });

  // Constraint 25 again: no log button on the saved-item path. The root drops
  // back to a lone ScrollView.
  it("renders no sticky bar on the saved-item path", () => {
    const { container, queryByTestId, queryByText } = renderSavedItem();

    expect(queryByTestId("log-action-bar")).toBeNull();
    expect(queryByText("Add to Today")).toBeNull();
    expect(container.firstElementChild!.children).toHaveLength(1);
  });
});
