import {
  onAiSharingRequired,
  raiseIfAiSharingRequired,
  raiseIfAiSharingRefusal,
} from "../ai-sharing-events";
import { CHAT_AI_OFF_ERROR, chatRequestErrorCopy } from "../chat-error-copy";
import { HEALTH_CONSENT_PROMPT } from "../health-consent";
import { AI_RECIPIENTS } from "@shared/lib/ai-sharing";

// Privacy audit H3.
describe("AI-sharing refusal signal", () => {
  it("fires for an AI_SHARING_REQUIRED refusal until unsubscribed", () => {
    const listener = vi.fn();
    const off = onAiSharingRequired(listener);

    raiseIfAiSharingRequired("AI_SHARING_REQUIRED");
    expect(listener).toHaveBeenCalledTimes(1);

    off();
    raiseIfAiSharingRequired("AI_SHARING_REQUIRED");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("stays quiet for every other failure", () => {
    const listener = vi.fn();
    const off = onAiSharingRequired(listener);

    raiseIfAiSharingRequired("PREMIUM_REQUIRED");
    raiseIfAiSharingRequired(undefined);

    expect(listener).not.toHaveBeenCalled();
    off();
  });

  // Requests that do not go through apiRequest (multipart fetch, chat
  // streams) hand over the raw error body.
  it("reads the code out of a raw error body", () => {
    const listener = vi.fn();
    const off = onAiSharingRequired(listener);

    raiseIfAiSharingRefusal(
      JSON.stringify({ error: "AI is off", code: "AI_SHARING_REQUIRED" }),
    );
    expect(listener).toHaveBeenCalledTimes(1);

    raiseIfAiSharingRefusal(
      JSON.stringify({ error: "x", code: "RATE_LIMITED" }),
    );
    raiseIfAiSharingRefusal("<html>502</html>");
    raiseIfAiSharingRefusal("");
    expect(listener).toHaveBeenCalledTimes(1);
    off();
  });

  it("tells a chat user where to turn AI back on", () => {
    expect(chatRequestErrorCopy("AI_SHARING_REQUIRED")).toBe(CHAT_AI_OFF_ERROR);
  });
});

describe("health-consent prompt", () => {
  it("names every AI company the health details can reach", () => {
    for (const { name } of AI_RECIPIENTS) {
      expect(HEALTH_CONSENT_PROMPT.message).toContain(name);
    }
  });
});
