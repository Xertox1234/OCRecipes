import { describe, it, expect } from "vitest";
import { getBatchSettledAnnouncement } from "../BatchSummaryScreen-utils";

// Accessibility audit 2026-11-06 L4: per-item lookups settling were silent —
// the only cue was the confirm button's label changing, which isn't spoken.
describe("getBatchSettledAnnouncement", () => {
  it("speaks once when the last pending item settles", () => {
    expect(getBatchSettledAnnouncement(2, 0, 0)).toBe("All items loaded.");
  });

  it("mentions items that could not be loaded", () => {
    expect(getBatchSettledAnnouncement(1, 0, 1)).toBe(
      "All items loaded. 1 item couldn't be found.",
    );
    expect(getBatchSettledAnnouncement(3, 0, 2)).toBe(
      "All items loaded. 2 items couldn't be found.",
    );
  });

  it("stays silent on mount and while items are still pending", () => {
    expect(getBatchSettledAnnouncement(0, 0, 0)).toBeNull();
    expect(getBatchSettledAnnouncement(3, 2, 0)).toBeNull();
    expect(getBatchSettledAnnouncement(0, 1, 0)).toBeNull();
  });
});
