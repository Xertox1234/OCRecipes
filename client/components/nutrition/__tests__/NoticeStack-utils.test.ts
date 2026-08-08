import { describe, it, expect } from "vitest";

import { buildNotices, noticeAnnouncementKey } from "../NoticeStack-utils";

describe("buildNotices", () => {
  it("returns nothing when no advisory input is present", () => {
    expect(
      buildNotices({
        labelReadNotice: null,
        correctionNotice: null,
        showPer100gInfo: false,
      }),
    ).toEqual([]);
  });

  it("orders by severity — warnings before info", () => {
    const notices = buildNotices({
      labelReadNotice: "Label calories disagreed with our record.",
      correctionNotice: "Serving size looked implausible; corrected to 30 g.",
      showPer100gInfo: true,
    });
    expect(notices.map((n) => n.id)).toEqual([
      "label-read",
      "correction",
      "per-100g",
    ]);
    expect(notices.map((n) => n.severity)).toEqual([
      "warning",
      "warning",
      "info",
    ]);
  });

  it("carries the exact per-100g copy that shipped", () => {
    const [notice] = buildNotices({
      labelReadNotice: null,
      correctionNotice: null,
      showPer100gInfo: true,
    });
    expect(notice.body).toBe(
      "Values shown per 100g. Check package for actual serving size.",
    );
  });

  it("keeps each notice's title distinct from its body", () => {
    const notices = buildNotices({
      labelReadNotice: "reason A",
      correctionNotice: "reason B",
      showPer100gInfo: false,
    });
    expect(notices[0].title).toBe("Label not used");
    expect(notices[0].body).toBe("reason A");
    expect(notices[1].title).toBe("Serving size adjusted");
    expect(notices[1].body).toBe("reason B");
  });
});

describe("noticeAnnouncementKey", () => {
  it("keys on CONTENT, not on the notice kind", () => {
    // A discriminator-keyed announcer silently stops announcing when the
    // content mutates while the kind stays constant — which correctionNotice
    // does on every serving adjustment.
    const a = buildNotices({
      labelReadNotice: null,
      correctionNotice: "corrected to 30 g",
      showPer100gInfo: false,
    });
    const b = buildNotices({
      labelReadNotice: null,
      correctionNotice: "corrected to 45 g",
      showPer100gInfo: false,
    });
    expect(noticeAnnouncementKey(a)).not.toBe(noticeAnnouncementKey(b));
  });

  it("is stable for identical content", () => {
    const input = {
      labelReadNotice: "same",
      correctionNotice: null,
      showPer100gInfo: false,
    };
    expect(noticeAnnouncementKey(buildNotices(input))).toBe(
      noticeAnnouncementKey(buildNotices(input)),
    );
  });

  it("is null when there is nothing to announce", () => {
    expect(noticeAnnouncementKey([])).toBeNull();
  });
});
