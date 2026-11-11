/**
 * Static, user-safe copy for chat request failures.
 * docs/rules/client-state.md: a failed request's body is server text — never
 * render it; pick the copy by the machine-readable `code` instead.
 */

export const CHAT_GENERIC_ERROR = "Something went wrong. Please try again.";
export const CHAT_AI_OFF_ERROR =
  "AI features are off. Turn them on in Settings to chat.";
export const CHAT_LIMIT_ERROR = "You've reached today's limit for this chat.";

/**
 * Extract the machine-readable `code` from a non-200 stream response body.
 * The server's `sendError` returns `{ error, code }`; a pre-stream 429
 * (daily limit) is delivered this way before the SSE stream starts. Returns
 * undefined when the body is non-JSON or carries no string `code`.
 */
export function parseErrorCode(responseText: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(responseText);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as { code?: unknown }).code === "string"
    ) {
      return (parsed as { code: string }).code;
    }
  } catch {
    // Non-JSON body — no machine-readable code to extract.
  }
  return undefined;
}

/** Copy for a chat stream request the server refused (`{ error, code }`). */
export function chatRequestErrorCopy(code: string | undefined): string {
  switch (code) {
    case "DAILY_LIMIT_REACHED":
      return CHAT_LIMIT_ERROR;
    case "AI_SHARING_REQUIRED":
      return CHAT_AI_OFF_ERROR;
    case "CONFLICT":
      return "Recipe finder isn't available right now.";
    default:
      return CHAT_GENERIC_ERROR;
  }
}
