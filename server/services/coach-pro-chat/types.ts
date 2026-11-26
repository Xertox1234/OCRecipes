import type { CoachBlock } from "@shared/schemas/coach-blocks";
import type { FinderAction } from "@shared/schemas/recipe-finder";
import type { CoachChatUser } from "../coach-context-builder";
import type { FinderFeatures } from "../recipe-finder";

/** SSE event yielded by the coach chat service. */
export type CoachChatEvent =
  | { type: "content"; content: string }
  | { type: "blocks"; blocks: CoachBlock[] }
  | { type: "status"; label: string }
  // A specific step label (show-the-work spec 2026-11-09). `status` stays the
  // plain label for runtime 5.1.0 clients, which have no pacing queue.
  | { type: "step"; label: string }
  | { type: "safety_override"; message: string };

export interface CoachChatParams {
  conversationId: number;
  userId: string;
  content: string;
  /**
   * The message as the user sent it, for the safety checks only. `content`
   * has been through the injection filter, which replaces the very words
   * the classifier looks for (audit 2026-11-24, L102). Never sent to a model.
   */
  safetyText?: string;
  screenContext?: string;
  warmUpId?: string;
  isCoachPro: boolean;
  turnKey?: string;
  user: CoachChatUser;
  /** Called each iteration to check if the client disconnected. */
  isAborted: () => boolean;
  /**
   * AbortSignal wired to the HTTP close event. Passed to the OpenAI SDK so
   * in-flight generation is cancelled when the client disconnects, stopping
   * token consumption immediately. (M8 — 2026-04-18)
   */
  abortSignal?: AbortSignal;
  /** IANA timezone of the requesting user, e.g. "America/Los_Angeles". Defaults to UTC. */
  tz?: string;
  /**
   * Recipe finder (spec 2026-09-28). The route passes this ONLY when
   * RECIPE_FINDER_ENABLED is on and the user is Coach Pro; absent → today's
   * behavior exactly.
   */
  /**
   * Coach write cards (spec 2026-11-09): the app sent `writeCards: true`, so it
   * can show a write card. Absent → today's behavior exactly.
   */
  writeCards?: boolean;
  /**
   * Pantry card (spec 2026-11-16): the app declared it can draw the card AND
   * the user's plan includes the pantry. The caller decides both.
   */
  pantryCard?: boolean;
  /** Goals card (Coach roadmap T1): the app declared it can draw the card. */
  goalsCard?: boolean;
  /** Plan card's shopping section (Coach roadmap A1): the app can draw it. */
  planShopCard?: boolean;
  /** Allergy card (Coach roadmap T1): the app declared it can draw the card. */
  allergyCard?: boolean;
  /**
   * Coach roadmap T2: the app can show a food card that arrives already
   * logged, with Undo. A small typed food log is then applied at once.
   */
  quickLog?: boolean;
  /** The card on screen and the user's edits to it, sent with this message. */
  liveCard?: { cardId: string; edits: Record<string, unknown> };
  finder?: {
    action?: FinderAction;
    /** This turn's user row — Generate/Spoonacular claims mark it. */
    userMessageId: number;
    features: FinderFeatures;
  };
}
