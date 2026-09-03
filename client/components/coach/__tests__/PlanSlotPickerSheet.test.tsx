// @vitest-environment jsdom
import React from "react";
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  beforeAll,
  afterAll,
} from "vitest";
import { screen, fireEvent, cleanup } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import { PlanSlotPickerSheet } from "../PlanSlotPickerSheet";
import { buildPlanSlotDays } from "../plan-slot-picker-utils";

const onConfirm = vi.fn();
const onDismiss = vi.fn();

// vi.hoisted so the same fn instance backs both the mock factory (which
// vi.mock hoists above these imports) and the assertions below — mirrors
// client/components/recipe-chat/__tests__/RecipeCard.test.tsx.
const { mockImpact } = vi.hoisted(() => ({
  mockImpact: vi.fn(),
}));

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    impact: mockImpact,
    notification: vi.fn(),
    selection: vi.fn(),
  }),
}));

const baseProps = {
  visible: true,
  recipeTitle: "Lemon Chicken",
  datesWithItems: new Set<string>(),
  isSubmitting: false,
  onConfirm,
  onDismiss,
};

describe("PlanSlotPickerSheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  it("offers seven days and all four meal types", () => {
    renderComponent(<PlanSlotPickerSheet {...baseProps} />);
    expect(screen.getAllByRole("button", { name: /day-slot/i })).toHaveLength(
      7,
    );
    for (const label of ["Breakfast", "Lunch", "Dinner", "Snack"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it("confirms with the selected date, meal type, and the tapped chip's own weekday", () => {
    renderComponent(<PlanSlotPickerSheet {...baseProps} />);
    const dayChip = screen.getAllByRole("button", { name: /day-slot/i })[2];
    // Read the chip's own accessible label BEFORE tapping — it's
    // `day-slot <Weekday>, <Month> <Day>...` — so this doesn't recompute a
    // weekday via any date math of its own; it just captures what the chip
    // itself displayed.
    const chipLabel = dayChip.getAttribute("aria-label") ?? "";
    fireEvent.click(dayChip);
    fireEvent.click(screen.getByText("Dinner"));
    fireEvent.click(screen.getByRole("button", { name: /add to plan/i }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const [plannedDate, mealType, dayLabel] = onConfirm.mock.calls[0];
    expect(plannedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(mealType).toBe("dinner");
    // The third onConfirm arg must be the TAPPED chip's own weekday, not a
    // weekday re-derived from `plannedDate` (which is a UTC-shifted key and
    // would disagree with the chip's label for a UTC-positive offset — see
    // PlanSlotDay.iso's doc-comment). Cross-checking against the chip's own
    // accessible label — captured pre-tap above — is the discriminator: a
    // regression that derives dayLabel from plannedDate instead would still
    // produce a plausible-looking weekday string, just the wrong one.
    expect(dayLabel).toBeTruthy();
    expect(chipLabel).toContain(dayLabel);
  });

  it("does not confirm until a meal type is chosen", () => {
    renderComponent(<PlanSlotPickerSheet {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /add to plan/i }));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("renders nothing when not visible", () => {
    renderComponent(<PlanSlotPickerSheet {...baseProps} visible={false} />);
    expect(screen.queryByText("Lemon Chicken")).toBeNull();
  });

  it("resets the selection when the sheet closes and reopens", () => {
    // The Modal mock only nulls its CHILDREN when visible=false — the
    // PlanSlotPickerSheet wrapper itself never unmounts, so its useState
    // survives the round trip unless the component explicitly clears it on
    // the false->true transition. A silent stale selection would let a
    // reopened sheet fire onConfirm with the PREVIOUS recipe's meal choice
    // before the user has chosen anything for the new one.
    const { rerender } = renderComponent(
      <PlanSlotPickerSheet {...baseProps} />,
    );
    fireEvent.click(screen.getAllByRole("button", { name: /day-slot/i })[2]);
    fireEvent.click(screen.getByText("Dinner"));
    const dinnerChip = screen.getByRole("button", { name: /^Dinner$/i });
    expect(dinnerChip.getAttribute("aria-selected")).toBe("true");

    rerender(<PlanSlotPickerSheet {...baseProps} visible={false} />);
    rerender(<PlanSlotPickerSheet {...baseProps} visible={true} />);

    const dinnerChipAfterReopen = screen.getByRole("button", {
      name: /^Dinner$/i,
    });
    expect(dinnerChipAfterReopen.getAttribute("aria-selected")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: /add to plan/i }));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("hides the has-items dot on the selected day but shows it on an unselected day with items — regression for the accentSolid/link color collision", () => {
    // Review finding: theme.link and theme.accentSolid are the identical hex
    // in light mode, so a dot rendered unconditionally on `hasItems` (with no
    // `!selected` guard) visually vanishes into the selected chip's own fill
    // — exactly on today (days[0], the default selection), the day most
    // likely to already have plan items.
    const days = buildPlanSlotDays(new Date());
    const datesWithItems = new Set([days[0].iso, days[2].iso]);
    renderComponent(
      <PlanSlotPickerSheet {...baseProps} datesWithItems={datesWithItems} />,
    );

    // days[0] is selected by default AND has items — dot must be hidden.
    expect(screen.queryByTestId(`plan-slot-dot-${days[0].iso}`)).toBeNull();
    // days[2] is unselected and has items — dot must be visible.
    expect(screen.queryByTestId(`plan-slot-dot-${days[2].iso}`)).not.toBeNull();

    // Selecting days[2] flips which of the two dots is suppressed.
    fireEvent.click(screen.getAllByRole("button", { name: /day-slot/i })[2]);
    expect(screen.queryByTestId(`plan-slot-dot-${days[2].iso}`)).toBeNull();
    expect(screen.queryByTestId(`plan-slot-dot-${days[0].iso}`)).not.toBeNull();
  });

  it("fires haptic feedback via useHaptics on day-chip select, meal-chip select, and confirm", () => {
    renderComponent(<PlanSlotPickerSheet {...baseProps} />);

    fireEvent.click(screen.getAllByRole("button", { name: /day-slot/i })[2]);
    expect(mockImpact).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("Dinner"));
    expect(mockImpact).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: /add to plan/i }));
    expect(mockImpact).toHaveBeenCalledTimes(3);
  });

  it("does not fire confirm's haptic when the button is disabled (no meal chosen)", () => {
    renderComponent(<PlanSlotPickerSheet {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /add to plan/i }));
    expect(mockImpact).not.toHaveBeenCalled();
  });

  it("gives the disabled confirm button an accessibilityHint naming the missing meal type", () => {
    renderComponent(<PlanSlotPickerSheet {...baseProps} />);
    const confirmButton = screen.getByRole("button", {
      name: /add to plan/i,
    });
    expect(confirmButton.getAttribute("aria-hint")).toMatch(/meal type/i);
  });

  it("does not claim a meal type is missing once one is chosen, even while submitting", () => {
    const { rerender } = renderComponent(
      <PlanSlotPickerSheet {...baseProps} />,
    );
    fireEvent.click(screen.getByText("Dinner"));
    const confirmButton = screen.getByRole("button", {
      name: /add to plan/i,
    });
    // Enabled and idle — no hint needed, and definitely not "missing" language.
    expect(confirmButton.getAttribute("aria-hint") ?? "").not.toMatch(
      /meal type/i,
    );

    // `selectedMeal` is component-internal state and survives this rerender
    // (visible stays true throughout — no false->true reset edge fires), so
    // Dinner is still selected here without re-clicking it.
    rerender(<PlanSlotPickerSheet {...baseProps} isSubmitting={true} />);
    const confirmButtonSubmitting = screen.getByRole("button", {
      name: /add to plan/i,
    });
    expect(confirmButtonSubmitting.getAttribute("aria-hint") ?? "").not.toMatch(
      /meal type/i,
    );
  });
});

// plannedDate basis regression guard — see
// todos/P2-2026-08-31-plan-slot-timezone-guards-never-run-in-ci.md (archived
// as todos/archive/... once that todo lands).
// CI runs UTC, the unique zone where the UTC and device-local calendar-day
// bases agree, so a guard that only ran there would be silent. The pin here
// has to do MORE than plan-slot-picker-utils.test.ts's own zone sweep,
// though: this component calls `new Date()` itself (PlanSlotPickerSheet.tsx
// lines ~76 and ~93 — no injectable "from" prop), so there is no seam to
// pass a fixed instant in; `vi.useFakeTimers({ toFake: ["Date"] })` +
// `vi.setSystemTime` is the only way to control it, mirroring
// MealPlanHomeScreen.test.tsx:347-361, the one other rendered-component
// instance of this pairing in the repo. `{ toFake: ["Date"] }` (not a bare
// `vi.useFakeTimers()`) deliberately leaves `setTimeout` real — RTL's
// `fireEvent`/effect flushing needs it, and faking it too would hang this
// render test.
//
// UNLIKE the zone-sweep guard above, this is a SINGLE fixed instant at a
// SINGLE positive-offset zone — it does NOT claim "any non-UTC zone works"
// here, and that claim would be false for it: only an offset matching this
// instant's sign discriminates a fixed-clock render test. The instant
// (22:30 UTC) is chosen so the device-local calendar day in Berlin (00:30
// the next day) has already rolled over while the UTC day has not yet —
// the same discriminating shape plan-slot-picker-utils.test.ts's "00:30
// local" fixture uses, and the same instant MealPlanHomeScreen.test.tsx
// pins. It would NOT catch a regression that only breaks at a negative
// offset (LA, NY); that class is covered by
// plan-slot-picker-utils.test.ts's own America/Los_Angeles row instead —
// this guard's job is only to prove AT LEAST ONE test here fails in CI,
// not to re-run the full zone sweep through a render.
describe("PlanSlotPickerSheet — plannedDate basis regression guard", () => {
  const originalTz = process.env.TZ;
  // Local calendar day is Sep 2 in Berlin; the UTC day of the same instant
  // is Sep 1 — a UTC-basis regression reads this back as "2026-09-01".
  const INSTANT = new Date("2026-09-01T22:30:00Z");

  beforeAll(() => {
    process.env.TZ = "Europe/Berlin";
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(INSTANT);
  });

  afterAll(() => {
    vi.useRealTimers();
    // `delete`, never `= undefined` — that stringifies to the literal
    // "undefined", which resolves to offset 0: silently back to the zone
    // that hides the bug.
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  it("pins the timezone and clock it claims (guards the mechanism)", () => {
    expect(-new Date(2026, 8, 2).getTimezoneOffset()).toBe(120);
    expect(new Date().toISOString()).toBe("2026-09-01T22:30:00.000Z");
  });

  it("confirms plannedDate on the device-LOCAL calendar day, not the UTC day of that instant", () => {
    renderComponent(<PlanSlotPickerSheet {...baseProps} />);
    // Default selection (days[0]) already covers the discriminating day —
    // no chip click needed to exercise the basis.
    fireEvent.click(screen.getByText("Dinner"));
    fireEvent.click(screen.getByRole("button", { name: /add to plan/i }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const [plannedDate] = onConfirm.mock.calls[0];
    expect(plannedDate).toBe("2026-09-02");
  });
});
