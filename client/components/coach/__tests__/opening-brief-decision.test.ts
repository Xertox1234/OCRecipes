import { describe, it, expect } from "vitest";
import {
  briefFormFor,
  localDateString,
  shouldOpenBriefDraft,
} from "../opening-brief-decision";

const TODAY = "2026-11-08";

describe("shouldOpenBriefDraft", () => {
  const base = {
    hasPendingReminder: false,
    lastSeen: TODAY as string | null | undefined,
    today: TODAY,
    hasExplicitConversation: false,
  };

  it("opens the draft on the first visit of the day", () => {
    expect(shouldOpenBriefDraft({ ...base, lastSeen: "2026-11-07" })).toBe(
      true,
    );
    expect(shouldOpenBriefDraft({ ...base, lastSeen: null })).toBe(true);
  });

  it("opens the draft when a reminder is pending, even if seen today", () => {
    expect(shouldOpenBriefDraft({ ...base, hasPendingReminder: true })).toBe(
      true,
    );
  });

  it("keeps today's behaviour after the brief was seen and nothing is pending", () => {
    expect(shouldOpenBriefDraft(base)).toBe(false);
  });

  it("never overrides a named conversation (deep link, selection)", () => {
    expect(
      shouldOpenBriefDraft({
        ...base,
        hasPendingReminder: true,
        lastSeen: null,
        hasExplicitConversation: true,
      }),
    ).toBe(false);
  });

  it("doesn't guess before the seen date is read", () => {
    expect(shouldOpenBriefDraft({ ...base, lastSeen: undefined })).toBe(false);
    expect(
      shouldOpenBriefDraft({
        ...base,
        lastSeen: undefined,
        hasPendingReminder: true,
      }),
    ).toBe(true);
  });
});

describe("briefFormFor", () => {
  it("is short only after today's full brief with nothing pending", () => {
    expect(briefFormFor(TODAY, TODAY, false)).toBe("short");
    expect(briefFormFor(TODAY, TODAY, true)).toBe("full");
    expect(briefFormFor("2026-11-07", TODAY, false)).toBe("full");
    expect(briefFormFor(null, TODAY, false)).toBe("full");
    expect(briefFormFor(undefined, TODAY, false)).toBe("full");
  });
});

describe("localDateString", () => {
  it("is the device-local calendar date", () => {
    expect(localDateString(new Date(2026, 10, 8, 23, 30))).toBe("2026-11-08");
    expect(localDateString(new Date(2026, 0, 3, 0, 5))).toBe("2026-01-03");
  });
});
