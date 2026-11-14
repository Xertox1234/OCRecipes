import { ErrorCode } from "@shared/constants/error-codes";

/**
 * "The server refused an AI request because AI sharing is off" (privacy audit
 * H3), as an app-wide signal. It is raised for requests the user started:
 * writes (`apiRequest` with a non-GET method), uploads, and the requests that
 * bypass `apiRequest` (multipart `fetch`, chat streams). The root navigator
 * answers by opening the question, so no AI screen needs its own check. This
 * is how an account that finished onboarding before the question existed gets
 * asked, so every AI request path must raise it. Background reads never do:
 * someone who keeps AI off must not be asked each time a screen loads.
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

/**
 * The same, for a request that did not go through `apiRequest`: pass the raw
 * error body (`{ error, code? }`). Anything else is ignored.
 */
export function raiseIfAiSharingRefusal(errorBody: string): void {
  if (!errorBody.includes(ErrorCode.AI_SHARING_REQUIRED)) return;
  try {
    const parsed: unknown = JSON.parse(errorBody);
    if (parsed !== null && typeof parsed === "object" && "code" in parsed) {
      const { code } = parsed;
      raiseIfAiSharingRequired(typeof code === "string" ? code : undefined);
    }
  } catch {
    // Not the standard JSON error body: not an AI-sharing refusal.
  }
}
