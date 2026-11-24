import { describe, it, expect } from "vitest";
import { ErrorCode } from "@shared/constants/error-codes";
import { ApiError } from "@/lib/api-error";
import { coachPhotoFailure } from "../coach-photo-utils";

describe("coachPhotoFailure", () => {
  it("treats the daily limit as the limit banner, not an error line", () => {
    expect(
      coachPhotoFailure(new ApiError("x", ErrorCode.DAILY_LIMIT_REACHED)),
    ).toEqual({ atDailyLimit: true, message: null });
  });

  it.each([
    [ErrorCode.RATE_LIMITED, /wait/i],
    [ErrorCode.IMAGE_TOO_LARGE, /too large/i],
    [ErrorCode.PREMIUM_REQUIRED, /Coach Pro/],
  ])("has its own line for %s", (code, pattern) => {
    const failure = coachPhotoFailure(new ApiError("x", code));
    expect(failure.atDailyLimit).toBe(false);
    expect(failure.message).toMatch(pattern);
  });

  it("stays silent when AI sharing is off (that prompt is raised elsewhere)", () => {
    expect(
      coachPhotoFailure(new ApiError("x", ErrorCode.AI_SHARING_REQUIRED)),
    ).toEqual({ atDailyLimit: false, message: null });
  });

  it("never shows the raw error text", () => {
    const failure = coachPhotoFailure(new Error("Upload failed: 500 <html>"));
    expect(failure.message).toBe("Couldn't send that photo. Please try again.");
  });
});
