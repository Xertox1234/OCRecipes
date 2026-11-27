import type { CoachWriteCard, CoachWriteCardSavedRefs } from "@shared/schema";
import {
  REMINDER_KEYS,
  REMINDER_LABELS,
  remindersEditsSchema,
  type RemindersCardEdits,
  type RemindersCardPayload,
} from "@shared/schemas/coach-write-cards";
import { remindersValues } from "@shared/lib/coach-write-card-math";
import {
  getUserReminderMutes,
  saveReminderMutes,
} from "../../storage/user-profiles";
import type { WriteCardTx } from "../../storage/coach-write-cards";
import { WriteCardEditError } from "./errors";
import { savableCardPayload } from "./payload";
import { REMINDER_ARG_KEYS, type SetRemindersCardArgs } from "./tool-args";

export {
  setRemindersCardArgsSchema,
  type SetRemindersCardArgs,
} from "./tool-args";

/**
 * The reminders card (Coach roadmap A3): switches the Coach Reminders types
 * on and off, as the settings screen does. They are stored as mutes, so a
 * type is on while it is not muted; a user with no profile row has every
 * type on.
 */

/**
 * One row per reminder the Coach asked to switch that would change, in the
 * settings screen's order. Throws when none would, so the turn shows no card.
 */
export async function buildRemindersPayload(
  args: SetRemindersCardArgs,
  userId: string,
): Promise<RemindersCardPayload> {
  const mutes = await getUserReminderMutes(userId);
  const asked = new Map(
    (Object.keys(REMINDER_ARG_KEYS) as (keyof typeof REMINDER_ARG_KEYS)[])
      .filter((k) => args[k] !== undefined)
      .map((k) => [REMINDER_ARG_KEYS[k], args[k] as boolean]),
  );
  const changes = REMINDER_KEYS.flatMap((key) => {
    const on = asked.get(key);
    return on === undefined || on === !mutes[key] ? [] : [{ key, on }];
  });
  if (changes.length === 0) {
    throw new WriteCardEditError("These reminders are already set that way.");
  }
  return { changes };
}

/** Strict parse, with one switch per row when the app sends any. */
function parseRemindersEdits(
  p: RemindersCardPayload,
  raw: unknown,
): RemindersCardEdits {
  const parsed = remindersEditsSchema.safeParse(raw ?? {});
  if (
    !parsed.success ||
    (parsed.data.on && parsed.data.on.length !== p.changes.length)
  ) {
    throw new WriteCardEditError("These changes can't be saved.");
  }
  return parsed.data;
}

export async function performRemindersSave(
  tx: WriteCardTx,
  card: CoachWriteCard,
  rawEdits: unknown,
  ctx: { userId: string },
): Promise<CoachWriteCardSavedRefs> {
  const payload = savableCardPayload(card, "reminders");
  const values = remindersValues(
    payload,
    parseRemindersEdits(payload, rawEdits),
  );
  // The mutes as they are now, not as they were when the card was built.
  const before = await getUserReminderMutes(ctx.userId, tx, {
    forUpdate: true,
  });
  const remindersRestore: NonNullable<
    CoachWriteCardSavedRefs["remindersRestore"]
  > = [];
  payload.changes.forEach((row, i) => {
    const wasMuted = !!before[row.key];
    const muted = !values[i];
    if (muted !== wasMuted) {
      remindersRestore.push({ key: row.key, before: wasMuted, after: muted });
    }
  });
  if (remindersRestore.length === 0) {
    throw new WriteCardEditError("These are already your reminders.");
  }
  await saveReminderMutes(
    ctx.userId,
    Object.fromEntries(remindersRestore.map((r) => [r.key, r.after])),
    tx,
  );
  return { remindersRestore };
}

/** Puts back each reminder that still holds what this card saved. */
export async function revertRemindersSave(
  tx: WriteCardTx,
  card: CoachWriteCard,
): Promise<void> {
  const restore = card.savedRefs?.remindersRestore ?? [];
  if (restore.length === 0) return;
  const now = await getUserReminderMutes(card.userId, tx, { forUpdate: true });
  const back = restore.filter((r) => !!now[r.key] === r.after);
  if (back.length === 0) return;
  await saveReminderMutes(
    card.userId,
    Object.fromEntries(back.map((r) => [r.key, r.before])),
    tx,
  );
}

const onOff = (on: boolean) => (on ? "on" : "off");

/** The live card for the prompt: each switch on the card, and as it is now. */
export function describeReminders(
  p: RemindersCardPayload,
  e: RemindersCardEdits,
): string {
  const values = remindersValues(p, e);
  return p.changes
    .map(
      (row, i) =>
        `${REMINDER_LABELS[row.key]} ${onOff(values[i])} on the card (now ${onOff(!row.on)})`,
    )
    .join("; ");
}
