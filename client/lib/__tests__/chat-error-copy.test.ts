import {
  CHAT_GENERIC_ERROR,
  CHAT_LIMIT_ERROR,
  chatRequestErrorCopy,
  parseErrorCode,
} from "../chat-error-copy";

describe("parseErrorCode", () => {
  it("extracts the code from a standard error body", () => {
    expect(
      parseErrorCode('{"error":"Daily limit","code":"DAILY_LIMIT_REACHED"}'),
    ).toBe("DAILY_LIMIT_REACHED");
  });

  it("returns undefined when the body has no code field", () => {
    expect(parseErrorCode('{"error":"oops"}')).toBeUndefined();
  });

  it("returns undefined for a non-JSON body", () => {
    expect(parseErrorCode("Internal Server Error")).toBeUndefined();
    expect(parseErrorCode("")).toBeUndefined();
  });

  it("returns undefined when code is not a string", () => {
    expect(parseErrorCode('{"code":123}')).toBeUndefined();
  });
});

describe("chatRequestErrorCopy", () => {
  // client-state.md: never render the server body; pick static copy by code.
  it("names the daily limit without repeating the server's wording", () => {
    expect(chatRequestErrorCopy("DAILY_LIMIT_REACHED")).toBe(CHAT_LIMIT_ERROR);
  });

  it("explains an unavailable recipe finder", () => {
    expect(chatRequestErrorCopy("CONFLICT")).toBe(
      "Recipe finder isn't available right now.",
    );
  });

  it("falls back to generic copy for any other or missing code", () => {
    expect(chatRequestErrorCopy("SERVER_ERROR")).toBe(CHAT_GENERIC_ERROR);
    expect(chatRequestErrorCopy(undefined)).toBe(CHAT_GENERIC_ERROR);
  });
});
