// @vitest-environment jsdom
//
// Regression guard for todos/archive/P2-2026-08-31-remaining-client-date-derivations-still-use-a-utc-basis.md.
//
// `formatDate`/`getPlannedDate`/`getTomorrowDate` used to derive "today" (or a
// day offset from a picked start date) from a raw UTC-converted instant, so
// they answered "what calendar day is it" wrong at BOTH offset signs — unlike
// the planner defect (todos/archive/P1-2026-08-30-...), which was
// UTC-positive-only and constant. These are time-of-day dependent: positive
// offsets break in the early morning, negative offsets break in the late
// evening (see the todo's measured failure table).
//
// `getPlannedDate`/`formatDate` had a SEPARATE bug: parsing
// `startDate + "T12:00:00"` (local noon) survives any offset up to 12 hours
// but breaks at +13/+14 (Pacific/Apia, Pacific/Kiritimati) — offset-dependent,
// not hour-dependent, so it is NOT caught by Berlin/Auckland/LA pins (all
// pass under the OLD noon trick too; only +13/+14 discriminates that mutation).
//
// CI runs UTC, the unique zone where every basis here agrees, so every block
// below pins a non-UTC `TZ` explicitly. Anchors are built as `...Z` UTC
// instant strings and read back via `new Date()` inside `beforeAll`/test
// bodies — never as a `Date` literal at describe/it.each-table scope, which
// would be evaluated before the TZ pin takes effect (see
// docs/solutions/logic-errors/each-tables-evaluate-before-hooks-so-pinned-env-misses-fixtures-2026-08-31.md).
import {
  formatDate,
  getPlannedDate,
  getTomorrowDate,
} from "../ReceiptMealPlanScreen";

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ popToTop: () => {} }),
  useRoute: () => ({ params: undefined }),
}));

describe("getTomorrowDate — raw-instant local basis", () => {
  const originalTz = process.env.TZ;

  afterEach(() => {
    vi.useRealTimers();
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it("uses the local calendar day in a UTC-positive zone, at an hour inside the failing window", () => {
    process.env.TZ = "Pacific/Auckland"; // +12, no DST in September
    // "Now" = UTC 2026-09-01T18:00:00Z = local 2026-09-02 06:00. +1 day is
    // local 2026-09-03 06:00, whose UTC instant is 2026-09-02T18:00:00Z. Old
    // (toDateString, UTC day of that instant) => "2026-09-02" — a day early.
    // New (toLocalDateString, local day) => "2026-09-03" — correct.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-01T18:00:00Z"));

    expect(-new Date(2026, 8, 2).getTimezoneOffset()).toBe(720); // pins the mechanism
    expect(getTomorrowDate()).toBe("2026-09-03");
  });

  it("uses the local calendar day in a UTC-negative zone, at an hour inside the failing window", () => {
    process.env.TZ = "America/Los_Angeles"; // -7 in September
    // "Now" = UTC 2026-09-03T03:00:00Z = local 2026-09-02 20:00. +1 day is
    // local 2026-09-03 20:00, whose UTC instant is 2026-09-04T03:00:00Z. Old
    // (toDateString, UTC day of that instant) => "2026-09-04" — a day late.
    // New (toLocalDateString, local day) => "2026-09-03" — correct.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-03T03:00:00Z"));

    expect(-new Date(2026, 8, 2).getTimezoneOffset()).toBe(-420); // pins the mechanism
    expect(getTomorrowDate()).toBe("2026-09-03");
  });
});

describe("getPlannedDate — noon-trick margin, +13/+14 only", () => {
  // Berlin (+2), Auckland (+12) and Los_Angeles (-7) all pass under the OLD
  // `T12:00:00` noon parse too (its margin is ±12h) — a pin at those zones
  // would be vacuous for THIS mutation. Only an offset beyond 12h
  // discriminates it, so this block pins Pacific/Apia (+13, no DST) alone.
  const originalTz = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = "Pacific/Apia";
  });

  afterAll(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it("pins the timezone it claims to (guards the mechanism, not the code)", () => {
    expect(-new Date(2026, 8, 1).getTimezoneOffset()).toBe(780); // +13:00
  });

  it("derives the correct day at +13 for a zero offset", () => {
    // Old noon-trick: new Date("2026-09-01T12:00:00") is LOCAL noon in Apia,
    // which is 2026-08-31T23:00:00Z — toDateString reads back "2026-08-31".
    expect(getPlannedDate("2026-09-01", 0)).toBe("2026-09-01");
  });

  it("derives the correct day at +13 for a positive offset", () => {
    expect(getPlannedDate("2026-09-01", 2)).toBe("2026-09-03");
  });

  it("agrees with formatDate's weekday for the same (startDate, offset) pair", () => {
    // Label (formatDate) and value (getPlannedDate) must derive the same day —
    // see docs/solutions/logic-errors/two-writers-of-one-date-column-must-share-a-normalisation-basis-2026-08-31.md.
    // 2026-09-01 is a Tuesday.
    expect(formatDate("2026-09-01", 0)).toBe("Tue, Sep 1");
    expect(getPlannedDate("2026-09-01", 0)).toBe("2026-09-01");
  });

  it("crosses a month boundary correctly", () => {
    expect(getPlannedDate("2026-09-29", 3)).toBe("2026-10-02");
  });
});

describe("localDateFromParts — malformed input fails loudly", () => {
  // The old `new Date(startDate + "T12:00:00")` threw on a malformed
  // `startDate`. Parsing components directly must not silently downgrade
  // that to a "NaN-NaN-NaN" plannedDate — throw instead.
  it("throws on a non-date string rather than returning NaN-NaN-NaN", () => {
    expect(() => getPlannedDate("garbage", 0)).toThrow(RangeError);
  });
});

describe("formatDate/getPlannedDate — basis-invariant at ordinary offsets", () => {
  // Not time-of-day dependent (both derive from the DATE portion of
  // `startDate`, not the current instant), so a single ordinary zone is
  // sufficient to prove they no longer depend on the noon-trick machinery —
  // the +13 block above is what specifically exercises the margin.
  const originalTz = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = "Europe/Berlin";
  });

  afterAll(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it("formats the weekday/month/day label", () => {
    expect(formatDate("2026-09-01", 0)).toBe("Tue, Sep 1");
    expect(formatDate("2026-09-01", 6)).toBe("Mon, Sep 7");
  });

  it("derives plannedDate for each day offset", () => {
    expect(getPlannedDate("2026-09-01", 0)).toBe("2026-09-01");
    expect(getPlannedDate("2026-09-01", 6)).toBe("2026-09-07");
  });
});
