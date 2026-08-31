/**
 * Civil-date primitives: converting between an INSTANT and a CALENDAR DAY in a
 * given IANA timezone.
 *
 * These live in `server/lib/` rather than `server/storage/` on purpose. They
 * touch no data, both routes and storage need them, and — concretely — route
 * tests `vi.mock` the whole storage module, so a pure helper re-exported
 * through that facade becomes `undefined` at runtime in every route test.
 */
/**
 * Read the UTC offset (in minutes) at a specific UTC timestamp in a given
 * IANA timezone. Returns 0 for UTC or on parse failure.
 *
 * Intl produces strings like "GMT-07:00", "GMT+05:30", "GMT" (for UTC).
 */
function getOffsetMinutesAt(utcMs: number, tz: string): number {
  const offsetStr =
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "longOffset",
    })
      .formatToParts(new Date(utcMs))
      .find((p) => p.type === "timeZoneName")?.value ?? "GMT+0:00";

  const match = offsetStr.match(/GMT([+-])(\d{1,2}):(\d{2})/);
  if (!match) return 0;
  const sign = match[1] === "+" ? 1 : -1;
  return sign * (parseInt(match[2], 10) * 60 + parseInt(match[3], 10));
}

/**
 * Compute the UTC instant that corresponds to local midnight on a given civil
 * date in `tz`, correctly handling DST transitions.
 *
 * Algorithm (two-step offset correction):
 * 1. Guess: treat `Date.UTC(y, m-1, d)` as a first approximation.
 * 2. Read the tz offset at that guess → compute candidate midnight.
 * 3. Re-read the tz offset at the candidate → if it differs from step 2,
 *    one more correction produces the correct midnight.
 *
 * This handles the spring-forward edge case where the offset sampled at an
 * arbitrary input time differs from the offset at civil midnight (e.g. a 1pm
 * PDT reading gives -7h but midnight on the same spring-forward day is PST at
 * -8h). Without this correction getDayBounds is off by 1h on transition days.
 */
export function civilMidnightUtcMs(
  year: number,
  month: number, // 1-based
  day: number,
  tz: string,
): number {
  const guessMs = Date.UTC(year, month - 1, day);
  const off1 = getOffsetMinutesAt(guessMs, tz);
  const candidateMs = guessMs - off1 * 60_000;
  const off2 = getOffsetMinutesAt(candidateMs, tz);
  let ms = off2 !== off1 ? guessMs - off2 * 60_000 : candidateMs;

  // Zones that spring forward AT 00:00 local (America/Santiago, Asia/Beirut,
  // America/Havana) have no midnight on the transition day — the clock jumps
  // 23:59:59 -> 01:00:00 — and the offset correction above then lands on 23:00
  // of the PREVIOUS civil day. Step forward to the first instant that really is
  // on the requested day. Capped: a transition is at most a few hours, and an
  // unbounded loop here would be reachable from request input.
  const wanted = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  for (let i = 0; i < 4 && civilDateString(new Date(ms), tz) < wanted; i++) {
    ms += 60 * 60_000;
  }
  return ms;
}

/**
 * The civil (calendar) date of an INSTANT, as seen in `tz`: "what day is it
 * there, right now". Returns `yyyy-mm-dd`.
 *
 * Pairs with `civilDateToInstant`, its inverse. Keep the two straight — a
 * `Date` cannot tell you which of the two things it represents, and conflating
 * them is a real defect this codebase has shipped: `new Date("2026-09-02")` is
 * UTC midnight, so reading its civil date back in any UTC-NEGATIVE zone yields
 * `2026-09-01`.
 */
export function civilDateString(date: Date, tz: string = "UTC"): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * An instant that falls inside civil (calendar) date `dateStr` in `tz` —
 * specifically that day's local midnight. The inverse of `civilDateString`:
 * `civilDateString(civilDateToInstant(d, tz), tz) === d` for every zone.
 *
 * **Use this whenever a `yyyy-mm-dd` from a client or from a `date` column has
 * to be handed to something that takes an instant** (`getDayBounds`,
 * `getMonthBounds`). `new Date(dateStr)` is NOT a substitute: it produces UTC
 * midnight, which belongs to the previous civil day everywhere west of
 * Greenwich, so the caller silently gets the wrong day for the entire Americas.
 *
 * DST-safe via `civilMidnightUtcMs`, including zones such as
 * `America/Santiago` that transition at 00:00 local (where "local midnight"
 * does not exist and the returned instant lands on the first moment that does).
 */
export function civilDateToInstant(dateStr: string, tz: string = "UTC"): Date {
  const [year, month, day] = dateStr.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  return new Date(civilMidnightUtcMs(year, month, day, tz));
}
