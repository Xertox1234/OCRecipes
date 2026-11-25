/**
 * The Coach photo upload got no answer from the server: the connection
 * dropped or timed out, or a gateway answered in its place (502/503/504).
 * The route replies only after the analysis is done, so this says nothing
 * about whether the server received the photo; it may still be working.
 *
 * Its own file, free of native imports, so pure code (and its tests) can
 * tell this error apart without loading the upload module.
 */
export class UploadNoAnswerError extends Error {
  constructor() {
    super("Coach photo upload got no answer");
    this.name = "UploadNoAnswerError";
  }
}
