import { formatPlanAddSuccess } from "../coach-chat-utils";

// `plannedDate` is the device's LOCAL calendar day. Re-parsing it with
// `new Date(iso)` reads UTC midnight, which renders the PREVIOUS weekday at
// any UTC-negative offset — and CI runs UTC, the one zone where that bug is
// invisible. So the zone loop is the regression guard; UTC is the control.
const ZONES = ["UTC", "Pacific/Auckland", "America/Los_Angeles"] as const;

const ZONE_OFFSET_MINUTES: Record<(typeof ZONES)[number], number> = {
  UTC: 0,
  "Pacific/Auckland": 720,
  "America/Los_Angeles": -420,
};

const originalTz = process.env.TZ;
afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe.each(ZONES)("formatPlanAddSuccess (TZ=%s)", (tz) => {
  beforeAll(() => {
    process.env.TZ = tz;
  });

  // Guards the pin: a no-op TZ reads back as offset 0 on a UTC host and would
  // leave the assertion below passing for the wrong reason.
  it("pins the process timezone this block claims", () => {
    expect(-new Date(2026, 8, 1).getTimezoneOffset() + 0).toBe(
      ZONE_OFFSET_MINUTES[tz],
    );
  });

  it("names the local weekday of the ISO date, not the UTC one", () => {
    // 2026-09-02 is a Wednesday.
    expect(formatPlanAddSuccess("2026-09-02", "lunch")).toBe(
      "Added to Wednesday Lunch",
    );
  });
});

describe("formatPlanAddSuccess — meal label", () => {
  it("falls back to the day alone for a meal type it does not know", () => {
    expect(formatPlanAddSuccess("2026-09-02", "brunch")).toBe(
      "Added to Wednesday",
    );
    // An inherited Object key is not a meal type either.
    expect(formatPlanAddSuccess("2026-09-02", "constructor")).toBe(
      "Added to Wednesday",
    );
  });
});
