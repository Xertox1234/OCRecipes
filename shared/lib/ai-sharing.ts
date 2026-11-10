/**
 * AI-sharing permission (owner ruling 2026-11-10, privacy audit H3): the app
 * names the companies its AI features send data to and asks before the first
 * request. Without the permission the server makes no AI call for the user.
 *
 * Apple App Review 5.1.2(i) and the Google Play User Data policy both ask for
 * a disclosure that names the third-party AI and an explicit permission.
 */

/**
 * The version of the disclosure a permission is recorded against. Bump it
 * when the recipient list or what is sent changes.
 */
export const AI_SHARING_VERSION = "2026-11-10";

/**
 * Who receives an AI request. This mirrors the routing in
 * `server/lib/ai-client.ts` and `PINNED_HOSTS` in `server/lib/ai-models.ts`
 * (OpenAI models run on Microsoft Azure, Gemini models on Google Vertex AI,
 * both reached through OpenRouter; Google is also the direct backup route).
 * `server/lib/__tests__/ai-sharing-recipients.test.ts` fails when a host is
 * pinned that this list does not name.
 */
export const AI_RECIPIENTS = [
  {
    name: "OpenRouter",
    host: "openrouter",
    role: "Passes each request on to the company that runs the AI model.",
  },
  {
    name: "Microsoft Azure",
    host: "azure",
    role: "Runs the OpenAI models we use.",
  },
  {
    name: "Google",
    host: "google-vertex",
    role: "Runs the Gemini models we use.",
  },
] as const;

/** The recipients as one phrase, for prompts that have no room for a list. */
export const AI_RECIPIENT_NAMES =
  "OpenRouter, Microsoft Azure (which runs OpenAI's models) and Google";

/** What an AI feature sends, in the words shown to the user. */
export const AI_SHARED_DATA = [
  "Photos you scan (meals, labels, menus, receipts)",
  "Messages you send to Coach and the recipe chat, and foods you type or dictate",
  "The profile details a feature needs, such as your goals, allergies, diet, weight, activity level and what you ate today",
] as const;

export const AI_SHARING_OFF_PROMPT = {
  title: "Turn off AI features",
  message:
    "OCRecipes stops sending anything to AI companies. Photo scanning, Coach, recipe ideas and AI meal plans stop working until you turn this back on. Barcode scanning, manual logging and your saved recipes keep working.",
  confirmLabel: "Turn off",
  destructive: true,
} as const;

/** One entry in the append-only permission history on the user row. */
export interface AiSharingEvent {
  event: "granted" | "declined" | "withdrawn";
  /** ISO time, stamped by the server. */
  at: string;
  /** The disclosure version in force; set on "granted". */
  version?: string;
}

/** What `GET /api/user/ai-sharing` returns. */
export interface AiSharingStatus {
  /** True while the permission is on record. */
  allowed: boolean;
  /** True once the user has answered the question at least once. */
  answered: boolean;
}
