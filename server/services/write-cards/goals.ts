import type { CoachWriteCard, CoachWriteCardSavedRefs } from "@shared/schema";
import {
  GOAL_KEYS,
  GOAL_LIMITS,
  goalsEditsSchema,
  isGoalValue,
  type GoalKey,
  type GoalsCardEdits,
  type GoalsCardPayload,
} from "@shared/schemas/coach-write-cards";
import { goalsValues } from "@shared/lib/coach-write-card-math";
import { getUserGoals, setUserGoals } from "../../storage/users";
import type { WriteCardTx } from "../../storage/coach-write-cards";
import { WriteCardEditError } from "./errors";
import type { SetGoalsCardArgs } from "./tool-args";

export { setGoalsCardArgsSchema, type SetGoalsCardArgs } from "./tool-args";

/** The nearest value on the goal's stepper grid, inside its bounds. */
function onGrid(key: GoalKey, value: number): number {
  const { min, max, step } = GOAL_LIMITS[key];
  const snapped = min + Math.round((value - min) / step) * step;
  return Math.min(max, Math.max(min, snapped));
}

/**
 * One row per goal the Coach proposed that would change. Throws when none
 * would, so the turn shows no card.
 */
export async function buildGoalsPayload(
  args: SetGoalsCardArgs,
  userId: string,
): Promise<GoalsCardPayload> {
  const current = await getUserGoals(userId);
  if (!current) throw new WriteCardEditError("No goals to change.");
  const rows: GoalsCardPayload["rows"] = [];
  for (const key of GOAL_KEYS) {
    const asked = args[key];
    if (asked === undefined) continue;
    const proposed = onGrid(key, asked);
    if (proposed === current[key]) continue;
    rows.push({ key, current: current[key], proposed });
  }
  if (rows.length === 0) {
    throw new WriteCardEditError("These are already the user's goals.");
  }
  return { rows };
}

/** Strict parse, then each value checked against its own row's goal. */
function parseGoalsEdits(p: GoalsCardPayload, raw: unknown): GoalsCardEdits {
  const parsed = goalsEditsSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    throw new WriteCardEditError("These changes can't be saved.");
  }
  const { values } = parsed.data;
  if (
    values &&
    (values.length !== p.rows.length ||
      values.some((v, i) => !isGoalValue(p.rows[i].key, v)))
  ) {
    throw new WriteCardEditError("These changes can't be saved.");
  }
  return parsed.data;
}

export async function performGoalsSave(
  tx: WriteCardTx,
  card: CoachWriteCard,
  rawEdits: unknown,
  ctx: { userId: string },
): Promise<CoachWriteCardSavedRefs> {
  const payload = card.payload as GoalsCardPayload;
  const values = goalsValues(payload, parseGoalsEdits(payload, rawEdits));
  // The goals as they are now, not as they were when the card was built.
  const before = await getUserGoals(ctx.userId, tx, { forUpdate: true });
  if (!before) throw new WriteCardEditError("These changes can't be saved.");
  const goalsRestore: NonNullable<CoachWriteCardSavedRefs["goalsRestore"]> = [];
  payload.rows.forEach((row, i) => {
    if (values[i] !== before[row.key]) {
      goalsRestore.push({
        key: row.key,
        before: before[row.key],
        after: values[i],
      });
    }
  });
  if (goalsRestore.length === 0) {
    throw new WriteCardEditError("These are already your goals.");
  }
  await setUserGoals(
    ctx.userId,
    Object.fromEntries(goalsRestore.map((r) => [r.key, r.after])),
    tx,
  );
  return { goalsRestore };
}

/** Puts back each goal that still holds what this card saved. */
export async function revertGoalsSave(
  tx: WriteCardTx,
  card: CoachWriteCard,
): Promise<void> {
  const restore = card.savedRefs?.goalsRestore ?? [];
  if (restore.length === 0) return;
  const now = await getUserGoals(card.userId, tx, { forUpdate: true });
  if (!now) return;
  await setUserGoals(
    card.userId,
    Object.fromEntries(
      restore
        .filter((r) => now[r.key] === r.after)
        .map((r) => [r.key, r.before]),
    ),
    tx,
  );
}

const unit = (key: GoalKey) => (key === "calories" ? "" : " g");

/** The live card for the prompt: what it holds now, and the current goal. */
export function describeGoals(p: GoalsCardPayload, e: GoalsCardEdits): string {
  const values = goalsValues(p, e);
  return p.rows
    .map(
      (row, i) =>
        `${row.key} ${values[i]}${unit(row.key)} (now ${row.current ?? "not set"})`,
    )
    .join("; ");
}
