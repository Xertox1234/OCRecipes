import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { toLocalDateString } from "@shared/lib/date";

/** Milliseconds from `now` to the start of the next device-local day. */
export function msUntilNextLocalMidnight(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next.getTime() - now.getTime();
}

/**
 * Today's device-local date ("2026-11-27"), kept current while the screen
 * stays mounted: it moves at local midnight, and catches up when the app
 * comes back to the front (a backgrounded app's timers do not run, so a
 * phone that slept through midnight relies on the second path).
 *
 * Use it instead of `toLocalDateString(new Date())` in render wherever a
 * label says "Today": a value read in render is cached by the React
 * Compiler with the rest of the render and goes stale after midnight.
 */
export function useLocalToday(): string {
  const [today, setToday] = useState(() => toLocalDateString(new Date()));

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      setToday(toLocalDateString(new Date()));
      clearTimeout(timer);
      // A little past midnight, so a timer that fires a few ms early still
      // lands on the new day.
      timer = setTimeout(refresh, msUntilNextLocalMidnight(new Date()) + 1000);
    };
    // Arms the first timer, and catches a midnight crossed between the
    // first render and this effect; the same date is a no-op render.
    refresh();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => {
      clearTimeout(timer);
      sub.remove();
    };
  }, []);

  return today;
}
