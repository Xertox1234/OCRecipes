import { ApiError } from "../api-error";
import { onAiSharingRequired } from "../ai-sharing-events";
import { CHAT_AI_OFF_ERROR, chatRequestErrorCopy } from "../chat-error-copy";
import { HEALTH_CONSENT_PROMPT } from "../health-consent";
import { AI_RECIPIENTS } from "@shared/lib/ai-sharing";

// Privacy audit H3.
describe("AI-sharing refusal signal", () => {
  it("fires when any request is refused with AI_SHARING_REQUIRED", () => {
    const listener = vi.fn();
    const off = onAiSharingRequired(listener);

    new ApiError("403: off", "AI_SHARING_REQUIRED", 403);
    expect(listener).toHaveBeenCalledTimes(1);

    off();
    new ApiError("403: off", "AI_SHARING_REQUIRED", 403);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("stays quiet for every other failure", () => {
    const listener = vi.fn();
    const off = onAiSharingRequired(listener);

    new ApiError("403: premium", "PREMIUM_REQUIRED", 403);
    new ApiError("500: boom");

    expect(listener).not.toHaveBeenCalled();
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
