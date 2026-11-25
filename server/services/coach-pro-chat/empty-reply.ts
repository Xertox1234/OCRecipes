/**
 * Thrown when a Coach turn ends with nothing a user can see: no text, no
 * card, no recipe offer (a content filter, an empty completion, or a reply
 * that was only a cut-off block fence). The route ends such a turn as an
 * error and hands the user's message back; it used to end as a silent
 * "done" (coach chat audit 2026-11-24, L47).
 */
export class EmptyCoachReplyError extends Error {
  constructor() {
    super("Coach reply was empty");
    this.name = "EmptyCoachReplyError";
  }
}
