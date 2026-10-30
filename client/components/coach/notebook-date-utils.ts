/**
 * Follow-up date helpers for the notebook entry editor. Dates are stored as
 * "YYYY-MM-DD" strings; arithmetic is done in local time so a tap on
 * "Tomorrow" never lands on the wrong calendar day near midnight.
 */
function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseISO(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Add days to a stored date (or today when none), clamped to no earlier than today. */
export function addDaysToISO(
  iso: string | null,
  days: number,
  now: Date = new Date(),
): string {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const base = (iso && parseISO(iso)) || today;
  const next = new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate() + days,
  );
  return toISO(next < today ? today : next);
}

export function formatFollowUpDate(iso: string | null): string {
  const d = iso ? parseISO(iso) : null;
  if (!d) return "No date";
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * Convert a stored follow-up instant (the server anchors the picked day at
 * local midnight in the user's zone) back to the "YYYY-MM-DD" civil day in the
 * device zone. Never `toISOString().slice(0, 10)`: that is the UTC day, which
 * for a UTC+ user is the day BEFORE — shown in the editor, re-saved on every
 * edit (drifting a day earlier each time), and used to schedule the reminder.
 */
export function storedFollowUpToCivilDate(
  stored: string | null | undefined,
): string | null {
  return stored ? toISO(new Date(stored)) : null;
}
