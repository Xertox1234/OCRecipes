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
