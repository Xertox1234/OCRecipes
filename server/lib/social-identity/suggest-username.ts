import crypto from "node:crypto";

const MAX = 30;
const digits = (n: number) =>
  String(crypto.randomInt(0, 10 ** n)).padStart(n, "0");

/** Name-derived, collision-checked suggestion for ChooseUsername. Editable by the user. */
export async function suggestUsername(
  seed: string | null,
  isTaken: (u: string) => Promise<boolean>,
): Promise<string> {
  let base = (seed ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, MAX - 4);
  if (base.length > 0 && base.length < 3) base = base.padEnd(3, "_");
  if (base && !(await isTaken(base))) return base;
  if (base) {
    for (let i = 0; i < 5; i++) {
      const candidate = `${base}${digits(4)}`;
      if (!(await isTaken(candidate))) return candidate;
    }
  }
  return `user${digits(6)}`;
}
