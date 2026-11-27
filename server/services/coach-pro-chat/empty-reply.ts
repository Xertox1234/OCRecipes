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

/**
 * Thrown when the model provider fails or its stream breaks mid-reply. The
 * route ends the turn as an error and hands the user's message back, as for
 * an empty reply: no apology is saved as Coach's answer, cached for the hour,
 * fed back into the next prompt or read for the notebook (coach chat audit
 * 2026-11-24, M13).
 */
export class CoachProviderFailureError extends Error {
  constructor() {
    super("Coach provider failed");
    this.name = "CoachProviderFailureError";
  }
}
