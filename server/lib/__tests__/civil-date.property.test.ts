// server/lib/__tests__/civil-date.property.test.ts
/**
 * Property-based tests for server/lib/civil-date.ts (fast-check).
 *
 * RELATIONS
 *   R1 round-trip  civilDateString(civilDateToInstant(s, tz), tz) === s
 *                  for every civil date s and every zone in TZ_SAMPLE — the
 *                  inverse the module's own docs promise, over generated input.
 *   R2 hour-range  civilHourInTz(d, tz) is an integer in [0, 23].
 *   R3 monotone    civilMidnightUtcMs is strictly increasing when the civil
 *                  date advances by one day, for a fixed zone (DST days included).
 *
 * Why properties here: this module exists because `new Date("yyyy-mm-dd")` is
 * UTC midnight and reads back as the PREVIOUS day west of Greenwich — a bug
 * this codebase shipped. Example tests pin the dates the author thought of;
 * these cover the class.
 *
 * DST regime: a uniform draw over 129 years × 8 zones lands on a transition
 * day about 0.4 times per 100 runs — under the pinned seed, never. R1 and R3
 * therefore run DST_TRANSITION_DAYS first, as fast-check `examples`, and R3
 * asserts afterwards that the run really saw 23-, 24- and 25-hour days, so
 * "DST days included" above is checked on every run rather than hoped for.
 *
 * Seed pinning: vitest.config.ts sets retry: 2; an unseeded counterexample
 * could pass on a fresh seed and mask a real defect. Pinned per the repo
 * convention:
 * docs/solutions/conventions/fast-check-property-tests-pin-seed-not-in-mutation-testinclude-2026-07-12.md
 * Not in any Stryker testInclude.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  civilDateString,
  civilDateToInstant,
  civilHourInTz,
  civilMidnightUtcMs,
} from "../civil-date";

const FC_PARAMS = { seed: 20260914, numRuns: 100 } as const;

// Both sides of Greenwich, half-hour and DST zones, and a zone whose DST
// transition happens AT midnight (America/Santiago — the module's own edge case).
const TZ_SAMPLE = [
  "UTC",
  "America/Toronto",
  "America/Los_Angeles",
  "America/Santiago",
  "Europe/London",
  "Asia/Kolkata",
  "Australia/Sydney",
  "Pacific/Auckland",
] as const;
type Tz = (typeof TZ_SAMPLE)[number];

const arbTz = fc.constantFrom(...TZ_SAMPLE);

interface Civil {
  year: number;
  month: number;
  day: number;
}
const pad2 = (n: number) => String(n).padStart(2, "0");
const toDateStr = ({ year, month, day }: Civil) =>
  `${year}-${pad2(month)}-${pad2(day)}`;

// One spring-forward (23 h) and one fall-back (25 h) day per DST zone in
// TZ_SAMPLE, measured against the module; day-of-month ≤ 27 so R3's "next
// day" stays inside the month. America/Santiago switches at 00:00, so its
// short day is the Sunday with no midnight (the case civilMidnightUtcMs's
// step-forward loop exists for) and its long day is the Saturday before the
// autumn change, not the Sunday.
const DST_TRANSITION_DAYS: [Civil, Tz][] = [
  [{ year: 2026, month: 3, day: 8 }, "America/Toronto"], // 23 h
  [{ year: 2026, month: 11, day: 1 }, "America/Toronto"], // 25 h
  [{ year: 2026, month: 3, day: 8 }, "America/Los_Angeles"], // 23 h
  [{ year: 2026, month: 11, day: 1 }, "America/Los_Angeles"], // 25 h
  [{ year: 2026, month: 9, day: 6 }, "America/Santiago"], // 23 h
  [{ year: 2026, month: 4, day: 4 }, "America/Santiago"], // 25 h
  [{ year: 2022, month: 3, day: 27 }, "Europe/London"], // 23 h
  [{ year: 2026, month: 10, day: 25 }, "Europe/London"], // 25 h
  [{ year: 2026, month: 10, day: 4 }, "Australia/Sydney"], // 23 h
  [{ year: 2026, month: 4, day: 5 }, "Australia/Sydney"], // 25 h
  [{ year: 2026, month: 9, day: 27 }, "Pacific/Auckland"], // 23 h
  [{ year: 2026, month: 4, day: 5 }, "Pacific/Auckland"], // 25 h
];

// day ≤ 28 so every generated triple is a real calendar date in every month.
const arbCivil: fc.Arbitrary<Civil> = fc.record({
  year: fc.integer({ min: 1971, max: 2099 }),
  month: fc.integer({ min: 1, max: 12 }),
  day: fc.integer({ min: 1, max: 28 }),
});
// day ≤ 27 so "the next day" (day + 1) is also always a real date.
const arbCivilWithNext: fc.Arbitrary<Civil> = fc.record({
  year: fc.integer({ min: 1971, max: 2099 }),
  month: fc.integer({ min: 1, max: 12 }),
  day: fc.integer({ min: 1, max: 27 }),
});

const arbInstant = fc.date({
  min: new Date("1971-01-01T00:00:00Z"),
  max: new Date("2099-12-31T23:59:59Z"),
  noInvalidDate: true,
});

describe("civil-date properties", () => {
  it("R1: civilDateString ∘ civilDateToInstant is the identity on civil dates", () => {
    fc.assert(
      fc.property(arbCivil, arbTz, (civil, tz) => {
        const s = toDateStr(civil);
        expect(civilDateString(civilDateToInstant(s, tz), tz)).toBe(s);
      }),
      { ...FC_PARAMS, examples: DST_TRANSITION_DAYS },
    );
  });

  it("R2: civilHourInTz is an integer hour in [0, 23]", () => {
    fc.assert(
      fc.property(arbInstant, arbTz, (d, tz) => {
        const h = civilHourInTz(d, tz);
        expect(Number.isInteger(h)).toBe(true);
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThanOrEqual(23);
      }),
      FC_PARAMS,
    );
  });

  it("R3: civil midnight strictly increases with the civil date", () => {
    const dayLengthsSeen = new Set<number>();
    fc.assert(
      fc.property(arbCivilWithNext, arbTz, (civil, tz) => {
        const today = civilMidnightUtcMs(
          civil.year,
          civil.month,
          civil.day,
          tz,
        );
        const tomorrow = civilMidnightUtcMs(
          civil.year,
          civil.month,
          civil.day + 1,
          tz,
        );
        expect(tomorrow).toBeGreaterThan(today);
        // A civil day is 23, 24, or 25 hours long — never anything else.
        const hours = (tomorrow - today) / 3_600_000;
        dayLengthsSeen.add(hours);
        expect([23, 24, 25]).toContain(hours);
      }),
      { ...FC_PARAMS, examples: DST_TRANSITION_DAYS },
    );
    // Regime precondition: unless all three lengths were observed, the 23 h
    // and 25 h arms above never ran and the DST claim in the header is vacuous.
    expect([...dayLengthsSeen].sort((a, b) => a - b)).toEqual([23, 24, 25]);
  });
});
