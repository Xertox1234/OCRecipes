import { describe, it, expect } from "vitest";
import { ErrorCode } from "@shared/constants/error-codes";
import { ApiError } from "@/lib/api-error";
import { coachPhotoFailure } from "../coach-photo-utils";

describe("coachPhotoFailure", () => {
  it("treats the daily limit as the limit banner, not an error line", () => {
    expect(
      coachPhotoFailure(new ApiError("x", ErrorCode.DAILY_LIMIT_REACHED)),
    ).toEqual({ atDailyLimit: true, message: null, maybeSaved: false });
  });

  it.each([
    [ErrorCode.RATE_LIMITED, /wait/i],
    [ErrorCode.IMAGE_TOO_LARGE, /too large/i],
    [ErrorCode.PREMIUM_REQUIRED, /Coach Pro/],
    [ErrorCode.REQUEST_IN_FLIGHT, /still answering/i],
  ])("has its own line for %s", (code, pattern) => {
    const failure = coachPhotoFailure(new ApiError("x", code));
    expect(failure.atDailyLimit).toBe(false);
    expect(failure.message).toMatch(pattern);
  });

  it("stays silent when AI sharing is off (that prompt is raised elsewhere)", () => {
    expect(
      coachPhotoFailure(new ApiError("x", ErrorCode.AI_SHARING_REQUIRED)),
    ).toEqual({ atDailyLimit: false, message: null, maybeSaved: false });
  });

  it("never shows the raw error text", () => {
    const failure = coachPhotoFailure(new Error("Upload failed: 500 <html>"));
    expect(failure.message).not.toContain("500");
    expect(failure.message).not.toContain("html");
  });

  // Coach chat audit 2026-11-24 (L29): the upload has no reply until the
  // analysis is done, so a dropped connection says nothing about whether
  // the server got the photo. "Please try again" then invited a second turn.
  it("does not tell the user to resend when the outcome is unknown", () => {
    const failure = coachPhotoFailure(new Error("Network request failed"));
    expect(failure.maybeSaved).toBe(true);
    expect(failure.message).toMatch(/may not have gone through/i);
    expect(failure.message).not.toMatch(/try again/i);
  });

  it("knows the outcome when the server answered", () => {
    expect(
      coachPhotoFailure(new ApiError("Upload failed: 500", undefined))
        .maybeSaved,
    ).toBe(false);
    expect(
      coachPhotoFailure(new ApiError("x", ErrorCode.RATE_LIMITED)).maybeSaved,
    ).toBe(false);
  });

  describe("for a scanned barcode", () => {
    it.each([
      [ErrorCode.RATE_LIMITED, /wait/i],
      [ErrorCode.PREMIUM_REQUIRED, /Coach Pro/],
      [ErrorCode.REQUEST_IN_FLIGHT, /still answering/i],
    ])("has its own line for %s that never says photo", (code, pattern) => {
      const failure = coachPhotoFailure(new ApiError("x", code), "barcode");
      expect(failure.message).toMatch(pattern);
      expect(failure.message).not.toMatch(/photo/i);
    });

    it("has a fallback line about the barcode", () => {
      const failure = coachPhotoFailure(new Error("boom"), "barcode");
      expect(failure.message).toMatch(/barcode/i);
      expect(failure.message).not.toContain("boom");
    });

    it("still treats the daily limit as the limit banner", () => {
      expect(
        coachPhotoFailure(
          new ApiError("x", ErrorCode.DAILY_LIMIT_REACHED),
          "barcode",
        ),
      ).toEqual({ atDailyLimit: true, message: null, maybeSaved: false });
    });
  });
});
