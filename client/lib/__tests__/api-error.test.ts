import { ApiError } from "../api-error";

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
