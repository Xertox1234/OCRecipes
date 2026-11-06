import { ApiError, isDuplicateInFlight } from "../api-error";
import { ErrorCode } from "@shared/constants/error-codes";

describe("ApiError", () => {
  it("creates error with message", () => {
    const error = new ApiError("Something went wrong");
    expect(error.message).toBe("Something went wrong");
    expect(error.name).toBe("ApiError");
    expect(error.code).toBeUndefined();
  });

  it("creates error with message and code", () => {
    const error = new ApiError("Premium required", "PREMIUM_REQUIRED");
    expect(error.message).toBe("Premium required");
    expect(error.code).toBe("PREMIUM_REQUIRED");
  });

  it("is an instance of Error", () => {
    const error = new ApiError("test");
    expect(error).toBeInstanceOf(Error);
  });

  it("is an instance of ApiError", () => {
    const error = new ApiError("test");
    expect(error).toBeInstanceOf(ApiError);
  });

  it("has correct name property", () => {
    const error = new ApiError("test");
    expect(error.name).toBe("ApiError");
  });

  it("can be caught as an Error", () => {
    try {
      throw new ApiError("test error", "TEST_CODE");
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      if (e instanceof ApiError) {
        expect(e.code).toBe("TEST_CODE");
        expect(e.message).toBe("test error");
      }
    }
  });

  it("works with type narrowing", () => {
    const error: Error = new ApiError("narrowed", "NARROW");
    if (error instanceof ApiError) {
      expect(error.code).toBe("NARROW");
    } else {
      // Should not reach here
      expect(true).toBe(false);
    }
  });
});

describe("isDuplicateInFlight", () => {
  // A double tap's second request is refused while the first is still saving;
  // the first owns the result, so the second must not show an error.
  it("is true only for the server's REQUEST_IN_FLIGHT refusal", () => {
    expect(
      isDuplicateInFlight(
        new ApiError("409: busy", ErrorCode.REQUEST_IN_FLIGHT, 409),
      ),
    ).toBe(true);
  });

  it("is false for a real conflict and for other errors", () => {
    // The cook log's incomplete-nutrition 409 must still be shown.
    expect(
      isDuplicateInFlight(new ApiError("409: x", ErrorCode.CONFLICT, 409)),
    ).toBe(false);
    expect(isDuplicateInFlight(new Error("network"))).toBe(false);
    expect(isDuplicateInFlight(undefined)).toBe(false);
  });
});
