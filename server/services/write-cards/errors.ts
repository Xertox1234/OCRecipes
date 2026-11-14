/**
 * The app sent edits a write card cannot accept (wrong shape, an option the
 * card never offered, nothing left to save). Routes map it to 400.
 */
export class WriteCardEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WriteCardEditError";
  }
}
