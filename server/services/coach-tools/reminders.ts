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
        'Show the user a card to switch the app\'s four Coach reminders on or off, as the Coach Reminders settings do. Nothing changes until the user taps Save on the card. Call this when the user asks to turn one of these reminders on or off. Give at least one, and only the ones to change: true turns one on, false turns it off. If the user does not say which ("stop the reminders", "too many notifications"), ask which of the four rather than switching several off on a guess; match their words, such as the noon nudge (mealLog) or the morning briefing (dailyCheckin). This tool does not control other notifications, such as the weekly report, or the phone\'s own notification settings, and the app has no reminder for a time or task of the user\'s choosing: say so instead of calling it. If the user seems upset, answer that first.',
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
              "Commitment follow-ups: a check-in on the day a commitment the user made in the chat is due. This only switches those follow-ups on or off; it does not make or remove a commitment.",
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
