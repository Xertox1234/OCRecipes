import { getProfileLoadState, isRateLimitError } from "../profile-load-state";

describe("isRateLimitError", () => {
  it("recognises the `429: text` apiRequest error shape only", () => {
    expect(isRateLimitError(new Error("429: Too many profile requests"))).toBe(
      true,
    );
    expect(isRateLimitError(new Error("500: boom"))).toBe(false);
    expect(isRateLimitError("429: nope")).toBe(false);
  });
});

describe("getProfileLoadState", () => {
  const ok = { isError: false, error: null, data: { a: 1 } };

  it("is not an error when everything loaded", () => {
    expect(getProfileLoadState([ok, ok])).toEqual({
      isError: false,
      isRateLimited: false,
    });
  });

  it("keeps showing data when a background refetch fails", () => {
    const failedRefetch = {
      isError: true,
      error: new Error("429: Too many"),
      data: { a: 1 },
    };
    expect(getProfileLoadState([failedRefetch, ok]).isError).toBe(false);
  });

  it("errors when a failed query has no data, flagging a 429", () => {
    const limited = {
      isError: true,
      error: new Error("429: Too many"),
      data: undefined,
    };
    expect(getProfileLoadState([limited, ok])).toEqual({
      isError: true,
      isRateLimited: true,
    });
  });

  it("errors without the rate-limit flag for other failures", () => {
    const down = {
      isError: true,
      error: new Error("500: x"),
      data: undefined,
    };
    expect(getProfileLoadState([ok, down])).toEqual({
      isError: true,
      isRateLimited: false,
    });
  });
});
