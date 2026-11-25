import { useCallback, useEffect, useRef, useState } from "react";
import { remainingSeconds, type StepTimer } from "@/lib/cook-mode-utils";

export interface FinishedCookTimer {
  id: string;
  label: string;
  /** The step the timer belongs to, for "timer done, step 3". */
  stepNumber: number;
}

export interface RunningCookTimer extends FinishedCookTimer {
  /** Whole seconds left. */
  remaining: number;
}

interface Entry extends FinishedCookTimer {
  endsAt: number;
}

const TICK_MS = 500;

/**
 * Cook mode's countdown timers. Several can run at once, across steps. Each
 * is counted from the clock, so it is still right after the app was in the
 * background, and `onDone` is called once when it ends.
 *
 * In-app only: nothing is scheduled with the system, so a timer that ends
 * while the app is in the background is reported when the app comes back.
 */
export function useCookTimers(onDone: (timer: FinishedCookTimer) => void) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [now, setNow] = useState(() => Date.now());

  // Latest callback, read when a timer ends.
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });

  // The running timers as the interval sees them, so it can report the ones
  // that ended without doing so inside a state updater.
  const entriesRef = useRef(entries);
  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  const running = entries.length > 0;
  useEffect(() => {
    if (!running) return;
    const interval = setInterval(() => {
      const at = Date.now();
      setNow(at);
      const finished = entriesRef.current.filter((e) => e.endsAt <= at);
      if (finished.length === 0) return;
      const ended = new Set(finished.map((e) => e.id));
      // Dropped from the ref at once, so a second tick before the re-render
      // cannot report the same timer twice.
      entriesRef.current = entriesRef.current.filter((e) => !ended.has(e.id));
      setEntries((current) =>
        current.filter((e) => !(ended.has(e.id) && e.endsAt <= at)),
      );
      for (const { id, label, stepNumber } of finished) {
        onDoneRef.current({ id, label, stepNumber });
      }
    }, TICK_MS);
    return () => clearInterval(interval);
  }, [running]);

  const start = useCallback(
    (id: string, timer: StepTimer, stepNumber: number) => {
      const at = Date.now();
      setNow(at);
      setEntries((current) => [
        ...current.filter((e) => e.id !== id),
        {
          id,
          label: timer.label,
          stepNumber,
          endsAt: at + timer.seconds * 1000,
        },
      ]);
    },
    [],
  );

  const cancel = useCallback((id: string) => {
    setEntries((current) => current.filter((e) => e.id !== id));
  }, []);

  const timers: RunningCookTimer[] = entries.map(
    ({ id, label, stepNumber, endsAt }) => ({
      id,
      label,
      stepNumber,
      remaining: remainingSeconds(endsAt, now),
    }),
  );

  return { timers, start, cancel };
}
