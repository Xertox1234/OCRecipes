import { ErrorCode } from "@shared/constants/error-codes";

/**
 * "The server refused an AI request because AI sharing is off" (privacy audit
 * H3), as an app-wide signal. The request layer raises it for requests the
 * user started — writes (`apiRequest` with a non-GET method) and uploads —
 * and the root navigator answers by asking the question again, so no AI
 * screen needs its own check. Background reads never raise it: someone who
 * keeps AI off must not be asked again each time a screen loads.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

export function onAiSharingRequired(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Raise the signal when a user-started request failed with `code`. */
export function raiseIfAiSharingRequired(code: string | undefined): void {
  if (code !== ErrorCode.AI_SHARING_REQUIRED) return;
  listeners.forEach((listener) => listener());
}
