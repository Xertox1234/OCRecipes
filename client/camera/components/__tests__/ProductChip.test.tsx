// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import * as ProductChipUtils from "../ProductChip-utils";
import { ProductChip } from "../ProductChip";
import type { ScanPhase } from "../../types/scan-phase";
import type { ScanFlag } from "@shared/types/scan-flags";
import type { StyleProp, ViewStyle } from "react-native";

// The shared Pressable mock drops `style`, which would hide the buttons'
// 44pt minHeight from the touch-target assertions. Render PressableScale as
// the TouchableOpacity mock (which keeps style) with its style flattened.
vi.mock("@/components/PressableScale", async () => {
  const RN = await import("react-native");
  const flat = (s: unknown): unknown =>
    Array.isArray(s) ? Object.assign({}, ...s.map(flat).filter(Boolean)) : s;
  return {
    PressableScale: ({
      style,
      scaleTo: _scaleTo,
      ...props
    }: Record<string, unknown>) => (
      <RN.TouchableOpacity
        {...props}
        style={flat(style) as StyleProp<ViewStyle>}
      />
    ),
  };
});

// The shared mock's withSpring drops the completion callback. Capture it here
// so a test can fire it the way Reanimated does: `finished: false` when a newer
// animation on the same shared value cancels the spring, `true` when it settles.
type SpringCallback = (finished?: boolean) => void;
const springCallbacks: SpringCallback[] = [];
// Same for withTiming (the shared mock fires its callback at once): the
// reduced-motion exit fades and unmounts from this callback.
const timingCallbacks: SpringCallback[] = [];

vi.mock("react-native-reanimated", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    withSpring: (val: number, _config?: unknown, cb?: SpringCallback) => {
      if (cb) springCallbacks.push(cb);
      return val;
    },
    withTiming: (val: number, _config?: unknown, cb?: SpringCallback) => {
      if (cb) timingCallbacks.push(cb);
      return val;
    },
  };
});

const accessibility = { reducedMotion: false, screenReaderEnabled: false };
vi.mock("@/hooks/useAccessibility", () => ({
  useAccessibility: () => accessibility,
}));

const noop = () => {};

const handlers = {
  onConfirm: noop,
  onProceedToLabel: noop,
  onStepConfirmed: noop,
  onRetakeStep2: noop,
  onRetakeStep3: noop,
  onSmartPhotoConfirm: noop,
  onRetry: noop,
  onRescan: noop,
};

const barcodeLock: ScanPhase = {
  type: "BARCODE_LOCKED",
  barcode: "123",
  bounds: { x: 0.4, y: 0.45, width: 0.2, height: 0.1 },
};
const step2Confirmed: ScanPhase = {
  type: "STEP2_CONFIRMED",
  barcode: "123",
  nutritionImageUri: "x",
  ocrText: "",
};
const step2Review: ScanPhase = {
  type: "STEP2_REVIEWING",
  barcode: "123",
  imageUri: "x",
  ocrText: "Calories 200",
};
const step3Review: ScanPhase = {
  type: "STEP3_REVIEWING",
  barcode: "123",
  nutritionImageUri: "x",
  ocrText: "",
  frontImageUri: "y",
};

describe("ProductChip — step2_confirmed has no secondary capture button", () => {
  it("step2_confirmed renders exactly one button", () => {
    render(<ProductChip phase={step2Confirmed} {...handlers} />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByText(/point at the front/i)).toBeTruthy();
  });
});

describe("ProductChip — returnAfterLog found card", () => {
  it("offers Log it as the primary and no photo step", () => {
    const onConfirm = vi.fn();
    render(
      <ProductChip
        phase={barcodeLock}
        {...handlers}
        onConfirm={onConfirm}
        returnAfterLog
      />,
    );
    expect(screen.queryByText("Next: nutrition →")).toBeNull();
    expect(screen.queryByText("Use database data anyway")).toBeNull();
    screen.getByLabelText("Log it →").click();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe("ProductChip — found card lookup error", () => {
  it("says the lookup failed offline and offers Try again / Type it in", () => {
    const onRetryLookup = vi.fn();
    const onTypeBarcode = vi.fn();
    render(
      <ProductChip
        phase={barcodeLock}
        {...handlers}
        lookupError="offline"
        onRetryLookup={onRetryLookup}
        onTypeBarcode={onTypeBarcode}
      />,
    );
    expect(
      screen.getByText("Couldn't look this up. Check your connection."),
    ).toBeTruthy();
    expect(screen.queryByTestId("found-card-name-skeleton")).toBeNull();
    screen.getByLabelText("Try again").click();
    expect(onRetryLookup).toHaveBeenCalledTimes(1);
    screen.getByLabelText("Type it in").click();
    expect(onTypeBarcode).toHaveBeenCalledTimes(1);
    // The flow can still go on without the name.
    expect(screen.getByLabelText("Next: nutrition →")).toBeTruthy();
  });

  it("says something went wrong for a server failure", () => {
    render(
      <ProductChip
        phase={barcodeLock}
        {...handlers}
        lookupError="failed"
        onRetryLookup={noop}
        onTypeBarcode={noop}
      />,
    );
    expect(
      screen.getByText("Something went wrong looking this up."),
    ).toBeTruthy();
  });
});

// The captured cards keep the top flag row every variant showed before.
describe("ProductChip — captured cards keep the top flag", () => {
  const topFlag: ScanFlag = {
    id: "allergen:peanuts",
    kind: "allergen",
    severity: "danger",
    tier: "safety",
    title: "Contains Peanuts",
  };
  const product = { name: "Trail Mix", topFlag };

  it("shows the flag on step2_review", () => {
    const phase: ScanPhase = {
      type: "STEP2_REVIEWING",
      barcode: "123",
      imageUri: "x",
      ocrText: "Calories 200",
      product,
    };
    render(<ProductChip phase={phase} {...handlers} />);
    expect(screen.getByText("Contains Peanuts")).toBeTruthy();
  });

  it("shows the flag on step3_review", () => {
    const phase: ScanPhase = {
      type: "STEP3_REVIEWING",
      barcode: "123",
      frontImageUri: "y",
      product,
    };
    render(<ProductChip phase={phase} {...handlers} />);
    expect(screen.getByText("Contains Peanuts")).toBeTruthy();
  });
});

// The camera shell's Front step offers the shutter and Skip itself.
describe("ProductChip — hideFrontPrompt", () => {
  it("renders nothing for step2_confirmed when hidden", () => {
    render(
      <ProductChip phase={step2Confirmed} {...handlers} hideFrontPrompt />,
    );
    expect(screen.queryByLabelText("Finish scan")).toBeNull();
  });

  it("leaves the other variants alone", () => {
    render(<ProductChip phase={barcodeLock} {...handlers} hideFrontPrompt />);
    expect(screen.getByText("Not this")).toBeTruthy();
  });
});

// barcode_lock's primary control must ADVANCE the flow — it used to be
// "Looks right →" wired to CONFIRM_PRODUCT (a skip), with the only route to
// step 2 an unlabeled implicit gesture in caption text. Both actions are now
// real, labelled buttons: see getBarcodeLockActions in ProductChip-utils.ts.
describe("ProductChip — barcode_lock offers two real actions, not a skip-only primary", () => {
  it("renders Not this, the primary that advances to the label step, and the barcode-only escape hatch", () => {
    render(<ProductChip phase={barcodeLock} {...handlers} />);
    expect(screen.getAllByRole("button")).toHaveLength(3);
    expect(screen.getByText("Not this")).toBeTruthy();
    expect(screen.getByText("Next: nutrition →")).toBeTruthy();
    expect(screen.getByText("Use database data anyway")).toBeTruthy();
  });

  it("tapping the primary action calls onProceedToLabel when the product is unverified", () => {
    let called = false;
    render(
      <ProductChip
        phase={barcodeLock}
        {...handlers}
        onProceedToLabel={() => {
          called = true;
        }}
      />,
    );
    screen.getByText("Next: nutrition →").click();
    expect(called).toBe(true);
  });

  it("tapping the secondary action calls onConfirm when the product is unverified", () => {
    let called = false;
    render(
      <ProductChip
        phase={barcodeLock}
        {...handlers}
        onConfirm={() => {
          called = true;
        }}
      />,
    );
    screen.getByText("Use database data anyway").click();
    expect(called).toBe(true);
  });

  // Regression guard for a review finding on this task: `styles.btnSecondary`
  // had no `minHeight`, unlike `styles.btnPrimary` (which sets `minHeight: 44`
  // right alongside the same `paddingVertical: 12`) — so its rendered/tappable
  // height sat a few points under the 44pt floor docs/rules/react-native.md
  // requires unconditionally. That was a latent defect on the low-traffic
  // step2/step3 screen-reader-only Retake buttons; this task makes
  // `btnSecondary` the SOLE route to the barcode-only escape hatch on
  // `barcode_lock` — the highest-traffic phase in the app — which is what
  // makes the gap load-bearing rather than cosmetic. Asserts the real
  // rendered style, not the source object, so it can't pass on a `styles`
  // literal that never reaches the DOM.
  it("gives the secondary (barcode-only escape hatch) button a 44pt minimum touch target", () => {
    render(<ProductChip phase={barcodeLock} {...handlers} />);
    const secondaryButton = screen
      .getByText("Use database data anyway")
      .closest("button")!;
    expect(getComputedStyle(secondaryButton).minHeight).toBe("44px");
  });
});

describe("ProductChip — step2_review / step3_review auto-advance treatment", () => {
  it("renders only a Retake button (no Confirm) when no screen reader is active", () => {
    render(
      <ProductChip
        phase={step2Review}
        {...handlers}
        screenReaderEnabled={false}
      />,
    );
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByText("Label captured ✓")).toBeTruthy();
  });

  it("tapping Retake calls onRetakeStep2", () => {
    let called = false;
    render(
      <ProductChip
        phase={step2Review}
        {...handlers}
        onRetakeStep2={() => {
          called = true;
        }}
        screenReaderEnabled={false}
      />,
    );
    screen.getByRole("button").click();
    expect(called).toBe(true);
  });

  it("falls back to the explicit Confirm/Retake buttons when a screen reader is active", () => {
    render(
      <ProductChip
        phase={step2Review}
        {...handlers}
        screenReaderEnabled={true}
      />,
    );
    expect(screen.getByText("Looks right →")).toBeTruthy();
    expect(screen.getByText("Retake")).toBeTruthy();
  });

  it("step3_review also gets only the Retake button by default", () => {
    render(
      <ProductChip
        phase={step3Review}
        {...handlers}
        screenReaderEnabled={false}
      />,
    );
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByText("Front captured ✓")).toBeTruthy();
  });
});

// The found card (owner complaint: the barcode auto-snapped and nothing said
// what happened). It names what it caught and offers "Not this" to rescan.
describe("ProductChip — barcode_lock found card", () => {
  const withProduct = (
    product: NonNullable<
      Extract<ScanPhase, { type: "BARCODE_LOCKED" }>["product"]
    >,
  ): ScanPhase => ({ ...barcodeLock, product }) as ScanPhase;

  it('barcode_lock shows "Barcode found ✓" and the product name', () => {
    render(
      <ProductChip
        phase={withProduct({ name: "Oat Crunch Granola", brand: "Acme" })}
        {...handlers}
      />,
    );
    expect(screen.getByText("Barcode found ✓")).toBeTruthy();
    expect(screen.getByText(/Oat Crunch Granola/)).toBeTruthy();
    expect(screen.getByText(/Acme/)).toBeTruthy();
  });

  it("barcode_lock with product undefined shows a skeleton and no name text", () => {
    render(<ProductChip phase={barcodeLock} {...handlers} />);
    expect(screen.getByText("Barcode found ✓")).toBeTruthy();
    expect(screen.getByTestId("found-card-name-skeleton")).toBeTruthy();
    // The old placeholder text must be gone — a skeleton never says words.
    expect(screen.queryByText("Product")).toBeNull();
    expect(screen.queryByText(/loading/i)).toBeNull();
  });

  it('"Not this" calls onRescan', () => {
    const onRescan = vi.fn();
    render(
      <ProductChip phase={barcodeLock} {...handlers} onRescan={onRescan} />,
    );
    screen.getByRole("button", { name: "Not this" }).click();
    expect(onRescan).toHaveBeenCalledTimes(1);
  });

  it('unverified primary reads "Next: nutrition →"', () => {
    const onProceedToLabel = vi.fn();
    render(
      <ProductChip
        phase={withProduct({ name: "Cola", verificationLevel: "unverified" })}
        {...handlers}
        onProceedToLabel={onProceedToLabel}
      />,
    );
    screen.getByRole("button", { name: "Next: nutrition →" }).click();
    expect(onProceedToLabel).toHaveBeenCalledTimes(1);
  });

  it('verified primary still reads "Use verified data →"', () => {
    const onConfirm = vi.fn();
    render(
      <ProductChip
        phase={withProduct({ name: "Cola", verificationLevel: "verified" })}
        {...handlers}
        onConfirm={onConfirm}
      />,
    );
    screen.getByRole("button", { name: "Use verified data →" }).click();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Photograph label instead")).toBeTruthy();
  });

  it("topFlag renders ScanFlagBadge", () => {
    const { container } = render(
      <ProductChip
        phase={withProduct({
          name: "Trail Mix",
          topFlag: {
            id: "allergen:tree_nuts",
            kind: "allergen",
            severity: "danger",
            tier: "safety",
            title: "Contains Tree Nuts",
          },
        })}
        {...handlers}
      />,
    );
    // ScanFlagBadge renders the bare title (with a Feather icon), not the old
    // inline "⚠ title" row.
    expect(screen.getByText("Contains Tree Nuts")).toBeTruthy();
    expect(screen.queryByText("⚠ Contains Tree Nuts")).toBeNull();
    // Android's only cue for a flag that loads late is the assertive live
    // region the old inline row carried; the badge wrapper keeps it.
    const live = container.querySelector('[aria-live="assertive"]');
    expect(live?.textContent).toContain("Contains Tree Nuts");
  });

  it("not in database: says so, offers Next: nutrition →, and no database escape hatch", () => {
    render(<ProductChip phase={barcodeLock} {...handlers} productNotFound />);
    expect(
      screen.getByText(
        "We don't know this one yet. The label and front photos will fill it in",
      ),
    ).toBeTruthy();
    expect(screen.queryByTestId("found-card-name-skeleton")).toBeNull();
    expect(screen.getByText("Next: nutrition →")).toBeTruthy();
    expect(screen.queryByText("Use database data anyway")).toBeNull();
  });

  it("every found-card button has a 44pt minimum touch target", () => {
    render(<ProductChip phase={barcodeLock} {...handlers} />);
    for (const button of screen.getAllByRole("button")) {
      expect(getComputedStyle(button).minHeight).toBe("44px");
    }
  });
});

describe("ProductChip — captured cards", () => {
  it('step2_review shows "Label captured ✓" and Retake', () => {
    const onRetakeStep2 = vi.fn();
    render(
      <ProductChip
        phase={step2Review}
        {...handlers}
        onRetakeStep2={onRetakeStep2}
      />,
    );
    expect(screen.getByText("Label captured ✓")).toBeTruthy();
    screen.getByText("Retake").click();
    expect(onRetakeStep2).toHaveBeenCalledTimes(1);
  });

  it('step3_review shows "Front captured ✓"', () => {
    const onRetakeStep3 = vi.fn();
    render(
      <ProductChip
        phase={step3Review}
        {...handlers}
        onRetakeStep3={onRetakeStep3}
      />,
    );
    expect(screen.getByText("Front captured ✓")).toBeTruthy();
    screen.getByText("Retake").click();
    expect(onRetakeStep3).toHaveBeenCalledTimes(1);
  });

  it("the explicit Confirm appears only with a screen reader on", () => {
    const { rerender } = render(
      <ProductChip phase={step3Review} {...handlers} />,
    );
    expect(screen.queryByText("Looks right →")).toBeNull();
    rerender(
      <ProductChip phase={step3Review} {...handlers} screenReaderEnabled />,
    );
    expect(screen.getByText("Looks right →")).toBeTruthy();
    expect(screen.getByText("Front captured ✓")).toBeTruthy();
  });
});

// Wiring-seam check: getShutterClearanceStyle's own derivation is unit-tested
// in ProductChip-utils.test.ts, but that proves nothing about whether this
// component still calls it, or calls it with the right arguments — the gap
// docs/solutions/conventions/pure-utils-extraction-tests-dont-prove-wiring-2026-07-14.md
// warns about. Assert the component threads insets.bottom through on every
// render, and that session_complete is no longer a special case (P2-2026-07-15:
// it used to be excluded, which left the overlap unresolved for that phase
// and caused a jump-cut on the transition into it).
describe("ProductChip — shutter-clearance wiring", () => {
  const sessionComplete: ScanPhase = {
    type: "SESSION_COMPLETE",
    barcode: "123",
  };

  it("calls getShutterClearanceStyle with insets.bottom", () => {
    const spy = vi.spyOn(ProductChipUtils, "getShutterClearanceStyle");
    render(<ProductChip phase={barcodeLock} {...handlers} />);
    expect(spy).toHaveBeenCalledWith(0);
    spy.mockRestore();
  });

  it("calls getShutterClearanceStyle identically for session_complete — no more flush-bottom exception", () => {
    const spy = vi.spyOn(ProductChipUtils, "getShutterClearanceStyle");
    render(<ProductChip phase={sessionComplete} {...handlers} />);
    expect(spy).toHaveBeenCalledWith(0);
    spy.mockRestore();
  });
});

const idle: ScanPhase = { type: "IDLE" };

const chipIsRendered = () => screen.queryAllByRole("button").length > 0;

describe("ProductChip — exit spring completion", () => {
  beforeEach(() => {
    springCallbacks.length = 0;
  });

  it("stays rendered when the variant returns mid-exit and the cancelled spring reports finished: false", () => {
    const { rerender } = render(
      <ProductChip phase={barcodeLock} {...handlers} />,
    );
    expect(chipIsRendered()).toBe(true);

    // Variant goes away: the exit spring starts (its callback is captured).
    rerender(<ProductChip phase={idle} {...handlers} />);
    expect(springCallbacks).toHaveLength(1);
    const exitCallback = springCallbacks[0];

    // Variant comes back before the exit spring settles: the enter spring
    // replaces it, so Reanimated fires the exit callback with finished=false.
    rerender(<ProductChip phase={barcodeLock} {...handlers} />);
    act(() => exitCallback(false));

    expect(chipIsRendered()).toBe(true);
  });

  it("unmounts once the exit spring finishes with no variant set", () => {
    const { rerender } = render(
      <ProductChip phase={barcodeLock} {...handlers} />,
    );
    rerender(<ProductChip phase={idle} {...handlers} />);
    expect(springCallbacks).toHaveLength(1);

    act(() => springCallbacks[0](true));

    expect(chipIsRendered()).toBe(false);
  });
});

describe("ProductChip — reduced motion fades without travel", () => {
  beforeEach(() => {
    springCallbacks.length = 0;
    timingCallbacks.length = 0;
    accessibility.reducedMotion = true;
  });
  afterEach(() => {
    accessibility.reducedMotion = false;
  });

  it("exits with a fade (no spring) and unmounts when the fade finishes", () => {
    const { rerender } = render(
      <ProductChip phase={barcodeLock} {...handlers} />,
    );
    rerender(<ProductChip phase={idle} {...handlers} />);
    expect(springCallbacks).toHaveLength(0);
    expect(timingCallbacks).toHaveLength(1);

    act(() => timingCallbacks[0](true));

    expect(chipIsRendered()).toBe(false);
  });

  it("stays rendered when the fade is cancelled by the variant returning", () => {
    const { rerender } = render(
      <ProductChip phase={barcodeLock} {...handlers} />,
    );
    rerender(<ProductChip phase={idle} {...handlers} />);
    const exitCallback = timingCallbacks[0];
    rerender(<ProductChip phase={barcodeLock} {...handlers} />);
    act(() => exitCallback(false));

    expect(chipIsRendered()).toBe(true);
  });
});

describe("ProductChip — snap-anything cards", () => {
  const classifying: ScanPhase = { type: "CLASSIFYING", imageUri: "x" };
  const smart = (contentType: string): ScanPhase => ({
    type: "SMART_CONFIRMED",
    imageUri: "x",
    classification: {
      foods: [],
      contentType,
      overallConfidence: 0.9,
    } as unknown as Extract<
      ScanPhase,
      { type: "SMART_CONFIRMED" }
    >["classification"],
  });
  const smartError: ScanPhase = {
    type: "SMART_ERROR",
    imageUri: "x",
    error: "boom",
  };

  it("CLASSIFYING shows the busy title and no buttons", () => {
    render(<ProductChip phase={classifying} {...handlers} />);
    expect(screen.getByText("Working out what this is…")).toBeTruthy();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("a menu result shows its title, Not this and Continue (no ✓ or arrow spoken)", () => {
    const onRetry = vi.fn();
    const onSmartPhotoConfirm = vi.fn();
    render(
      <ProductChip
        phase={smart("restaurant_menu")}
        {...handlers}
        onRetry={onRetry}
        onSmartPhotoConfirm={onSmartPhotoConfirm}
      />,
    );
    const title = screen.getByText("Looks like a menu ✓");
    expect(title.getAttribute("aria-label")).toBe("Looks like a menu");
    expect(screen.getByText("We'll pull out the dishes for you")).toBeTruthy();
    screen.getByLabelText("Not this").click();
    expect(onRetry).toHaveBeenCalledTimes(1);
    screen.getByLabelText("Continue").click();
    expect(onSmartPhotoConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Continue →")).toBeTruthy();
  });

  it("a non_food result shows the unclear layout", () => {
    const onRetry = vi.fn();
    const onPickItMyself = vi.fn();
    render(
      <ProductChip
        phase={smart("non_food")}
        {...handlers}
        onRetry={onRetry}
        onPickItMyself={onPickItMyself}
      />,
    );
    expect(screen.getByText("Couldn't tell what this is")).toBeTruthy();
    expect(screen.queryByLabelText("Continue")).toBeNull();
    screen.getByLabelText("Retake").click();
    expect(onRetry).toHaveBeenCalledTimes(1);
    screen.getByLabelText("Pick it myself").click();
    expect(onPickItMyself).toHaveBeenCalledTimes(1);
  });

  it("SMART_ERROR shows the same unclear layout", () => {
    const onRetry = vi.fn();
    const onPickItMyself = vi.fn();
    render(
      <ProductChip
        phase={smartError}
        {...handlers}
        onRetry={onRetry}
        onPickItMyself={onPickItMyself}
      />,
    );
    expect(screen.getByText("Couldn't tell what this is")).toBeTruthy();
    screen.getByLabelText("Retake").click();
    expect(onRetry).toHaveBeenCalledTimes(1);
    screen.getByLabelText("Pick it myself").click();
    expect(onPickItMyself).toHaveBeenCalledTimes(1);
  });

  it("Continue is busy and disabled while isSmartConfirming", () => {
    const onSmartPhotoConfirm = vi.fn();
    render(
      <ProductChip
        phase={smart("restaurant_menu")}
        {...handlers}
        onSmartPhotoConfirm={onSmartPhotoConfirm}
        isSmartConfirming
      />,
    );
    const continueBtn = screen.getByLabelText("Continue");
    expect(continueBtn.getAttribute("aria-busy")).toBe("true");
    expect(continueBtn.getAttribute("aria-disabled")).toBe("true");
  });

  it("every snap-anything button has a 44pt minimum touch target", () => {
    for (const phase of [
      smart("restaurant_menu"),
      smart("non_food"),
      smartError,
    ]) {
      const { unmount } = render(<ProductChip phase={phase} {...handlers} />);
      const buttons = screen.getAllByRole("button");
      expect(buttons.length).toBeGreaterThan(0);
      for (const button of buttons) {
        expect(getComputedStyle(button).minHeight).toBe("44px");
      }
      unmount();
    }
  });
});
