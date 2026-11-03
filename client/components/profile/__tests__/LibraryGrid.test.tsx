// @vitest-environment jsdom
//
// The Pantry tile locks only for a user KNOWN to be free. While the plan is
// unknown (still loading, or the status fetch failed with nothing cached) the
// features fall back to the free tier, so a paying user read as locked
// (owner ruling 2026-11-02: unknown status is neutral). Same rule as
// HomeScreen's pantryLocked, so both pantry entry points agree.
import { fireEvent, screen } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import { LibraryGrid } from "../LibraryGrid";
import type { LibraryCountsResponse } from "@shared/schemas/profile-hub";

const nav = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: nav.navigate }),
}));

const plan = vi.hoisted(() => ({ resolved: true, pantryTracking: false }));
vi.mock("@/context/PremiumContext", () => ({
  usePremiumContext: () => ({ isPremiumResolved: plan.resolved }),
}));
vi.mock("@/hooks/usePremiumFeatures", () => ({
  usePremiumFeature: () => plan.pantryTracking,
}));

const counts = new Proxy({} as LibraryCountsResponse, { get: () => 0 });

function renderGrid() {
  const onLockedPress = vi.fn();
  renderComponent(
    <LibraryGrid counts={counts} onLockedPress={onLockedPress} />,
  );
  return { onLockedPress };
}

function pantryTile() {
  return screen.getByLabelText(/^Pantry/);
}

describe("LibraryGrid Pantry tile", () => {
  beforeEach(() => {
    nav.navigate.mockClear();
    plan.resolved = true;
    plan.pantryTracking = false;
  });

  it("is locked for a user known to be free", () => {
    const { onLockedPress } = renderGrid();
    expect(pantryTile().getAttribute("aria-label")).toMatch(/locked/i);
    fireEvent.click(pantryTile());
    expect(onLockedPress).toHaveBeenCalledTimes(1);
  });

  it("is not locked while the plan is unknown, and opens the pantry", () => {
    plan.resolved = false;
    const { onLockedPress } = renderGrid();
    expect(pantryTile().getAttribute("aria-label")).not.toMatch(/locked/i);
    fireEvent.click(pantryTile());
    expect(onLockedPress).not.toHaveBeenCalled();
    expect(nav.navigate).toHaveBeenCalled();
  });

  it("is not locked for a premium user", () => {
    plan.pantryTracking = true;
    renderGrid();
    expect(pantryTile().getAttribute("aria-label")).not.toMatch(/locked/i);
  });
});
