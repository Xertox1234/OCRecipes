import { setRemindersCardArgsSchema } from "../write-cards/tool-args";
import { remindersCardResult } from "../write-cards/results";
import { defineTool, type CoachToolEntry } from "./types";

// set_reminders (Coach roadmap A3) is offered, and run, only for an app that
// can draw the reminders card (it lists the kind).
const setRemindersTool = defineTool({
  name: "set_reminders",
  available: (opts) => !!opts.writeCards && !!opts.remindersCard,
  definition: () => ({
    type: "function",
    function: {
      name: "set_reminders",
      description:
        "Show the user a card to switch the app's Coach reminders on or off, as the Coach Reminders settings do. Nothing changes until the user taps the card. Call this when the user asks to turn a reminder on or off, or to stop or start a kind of notification the app sends. Give only the reminders to change: true turns one on, false turns it off. These are the only reminders the app has; it cannot set a reminder for a time or a task of the user's choosing.",
      parameters: {
        type: "object",
        properties: {
          mealLog: {
            type: "boolean",
            description:
              "Meal logging nudges: a reminder at noon when nothing is logged yet that day.",
          },
          commitment: {
            type: "boolean",
            description:
              "Commitment follow-ups: a check-in on the day a commitment the user made in the chat is due.",
          },
          dailyCheckin: {
            type: "boolean",
            description:
              "Daily check-in: a morning briefing with the user's calorie progress.",
          },
          expiringFood: {
            type: "boolean",
            description:
              "Expiring food: a nudge to use pantry food before it goes off.",
          },
        },
      },
    },
  }),
  argsSchema: setRemindersCardArgsSchema,
  run: async (args, { opts }) =>
    remindersCardResult(
      await opts.onWriteCardProposal?.({ kind: "reminders", args }),
    ),
});

export const REMINDER_TOOLS: CoachToolEntry[] = [setRemindersTool];
