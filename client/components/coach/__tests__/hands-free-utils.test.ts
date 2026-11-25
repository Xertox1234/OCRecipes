import { describe, it, expect } from "vitest";
import {
  handsFreeStatus,
  handsFreeStopMessage,
  HANDS_FREE_SPEECH_ID,
} from "../hands-free-utils";

describe("handsFreeStatus", () => {
  it.each([
    ["listening", "Listening…"],
    ["thinking", "Thinking…"],
    ["speaking", "Speaking…"],
  ] as const)("names the %s phase", (phase, text) => {
    expect(handsFreeStatus(phase)).toBe(text);
  });

  it("has nothing to show while off", () => {
    expect(handsFreeStatus("off")).toBeNull();
  });
});

describe("handsFreeStopMessage", () => {
  it("says why it stopped when nothing was heard", () => {
    expect(handsFreeStopMessage("silence")).toMatch(/didn't hear/i);
  });

  it("says it stopped when the app left the foreground", () => {
    expect(handsFreeStopMessage("background")).toMatch(/stopped/i);
  });

  it.each(["user", "interrupted", "error", "unavailable"] as const)(
    "stays quiet for %s (the user did it, or the failure has its own message)",
    (reason) => {
      expect(handsFreeStopMessage(reason)).toBeNull();
    },
  );
});

describe("HANDS_FREE_SPEECH_ID", () => {
  it("is not the live reply's id (-1) or a saved message's (positive)", () => {
    // Speaking under an id that is already playing toggles it off.
    expect(HANDS_FREE_SPEECH_ID).toBeLessThan(-1);
  });
});
