import { describe, it, expect } from "vitest";
import { buildCoachStreamBody } from "../coach-stream-body";

describe("buildCoachStreamBody", () => {
  it("startStream body carries writeCards and liveCard", () => {
    expect(
      buildCoachStreamBody("make it three eggs", "tk", {
        writeCards: true,
        liveCard: {
          cardId: "11111111-1a2b-4c3d-8e9f-0a1b2c3d4e5f",
          edits: { counts: [3] },
        },
      }),
    ).toEqual({
      content: "make it three eggs",
      turnKey: "tk",
      writeCards: true,
      liveCard: {
        cardId: "11111111-1a2b-4c3d-8e9f-0a1b2c3d4e5f",
        edits: { counts: [3] },
      },
    });
  });

  it("keeps today's fields and omits what is unset", () => {
    expect(
      buildCoachStreamBody("hi", "tk", {
        warmUpId: "w",
        screenContext: "s",
        openingBrief: "full",
      }),
    ).toEqual({
      content: "hi",
      turnKey: "tk",
      warmUpId: "w",
      screenContext: "s",
      openingBrief: "full",
    });
    expect(buildCoachStreamBody("hi", "tk", { warmUpId: null })).toEqual({
      content: "hi",
      turnKey: "tk",
    });
  });
});
