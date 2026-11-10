/**
 * The queue behind Coach's one-line step display (show-the-work spec
 * 2026-11-09). The owner's rule: never skip a step, never flash one. A step
 * stays current for at least `minStepMs`, even when its lookup took 50 ms,
 * and the steps after it wait their turn. Pure: the caller passes `now`.
 */
export interface StepQueue {
  pending: string[];
  current: { label: string; shownAt: number } | null;
}

export function initialStepQueue(): StepQueue {
  return { pending: [], current: null };
}

export function enqueueStep(q: StepQueue, label: string): StepQueue {
  return { ...q, pending: [...q.pending, label] };
}

/** Advance the queue: show the next step once the current one has had its time. */
export function tickSteps(
  q: StepQueue,
  now: number,
  minStepMs: number,
): StepQueue {
  if (q.current && now - q.current.shownAt < minStepMs) return q;
  const [next, ...rest] = q.pending;
  if (next === undefined) {
    return q.current ? { pending: [], current: null } : q;
  }
  return { pending: rest, current: { label: next, shownAt: now } };
}

/** True once every step has been shown for its full time. */
export function stepsSettled(
  q: StepQueue,
  now: number,
  minStepMs: number,
): boolean {
  if (q.pending.length > 0) return false;
  return q.current === null || now - q.current.shownAt >= minStepMs;
}
