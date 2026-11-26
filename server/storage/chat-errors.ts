// Errors the chat storage throws for routes to map. In a module of their own,
// with no database imports, so routes and their tests can import them as is.

/**
 * The most conversations one user may hold (audit 2026-11-24, L85). Creating
 * one was limited only per minute, so an account could make tens of
 * thousands a day, each remix with a copy of its recipe.
 */
export const MAX_CONVERSATIONS_PER_USER = 1000;

export class ConversationLimitError extends Error {
  constructor() {
    super("conversation limit reached");
    this.name = "ConversationLimitError";
  }
}
