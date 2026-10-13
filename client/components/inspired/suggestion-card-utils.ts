export const PHOTO_POLL_MS = 2000;
export const PHOTO_POLL_MAX_MS = 60_000;

export function photoPollInterval(
  photos: (string | null)[],
  startedAt: number,
  now: number,
): number | false {
  if (photos.length === 0) return false;
  if (now - startedAt > PHOTO_POLL_MAX_MS) return false;
  return photos.some((p) => !p) ? PHOTO_POLL_MS : false;
}

export function formatMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
