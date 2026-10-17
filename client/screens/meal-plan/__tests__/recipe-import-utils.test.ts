import { ApiError } from "@/lib/api-error";
import { ErrorCode } from "@shared/constants/error-codes";
import { urlImportErrorCopy } from "../recipe-import-utils";

// The server sends every import failure as HTTP 422, so the message always
// contains "422". Copy must come from ApiError.code, never the message.
const fail = (code: string, message = "Import failed") =>
  new ApiError(`422: ${message}`, code, 422);

describe("urlImportErrorCopy", () => {
  it("tells the user to check the link when the URL can't be reached", () => {
    expect(urlImportErrorCopy(fail(ErrorCode.FETCH_FAILED))).toBe(
      "Could not fetch the URL. Check the link and try again.",
    );
  });

  it("says no recipe was found for NO_RECIPE_DATA and PARSE_ERROR", () => {
    const copy = "No recipe data found on this page.";
    expect(urlImportErrorCopy(fail(ErrorCode.NO_RECIPE_DATA))).toBe(copy);
    expect(urlImportErrorCopy(fail(ErrorCode.PARSE_ERROR))).toBe(copy);
  });

  it("says the page took too long on TIMEOUT", () => {
    expect(urlImportErrorCopy(fail(ErrorCode.TIMEOUT))).toBe(
      "That page took too long to load. Try again in a moment.",
    );
  });

  it("says the page is too large on RESPONSE_TOO_LARGE", () => {
    expect(urlImportErrorCopy(fail(ErrorCode.RESPONSE_TOO_LARGE))).toBe(
      "That page is too large to import.",
    );
  });

  it("handles rate limiting", () => {
    expect(urlImportErrorCopy(fail(ErrorCode.RATE_LIMITED))).toBe(
      "Too many requests. Please wait a moment and try again.",
    );
  });

  it("gives the four failures four distinct messages", () => {
    const msgs = [
      ErrorCode.FETCH_FAILED,
      ErrorCode.TIMEOUT,
      ErrorCode.RESPONSE_TOO_LARGE,
      ErrorCode.NO_RECIPE_DATA,
    ].map((c) => urlImportErrorCopy(fail(c)));
    expect(new Set(msgs).size).toBe(4);
  });

  it("falls back to generic copy for unknown codes and non-ApiErrors", () => {
    const generic = "Something went wrong. Please try again.";
    expect(urlImportErrorCopy(fail("SOMETHING_ELSE"))).toBe(generic);
    expect(urlImportErrorCopy(new Error("422: boom"))).toBe(generic);
    expect(urlImportErrorCopy(undefined)).toBe(generic);
  });
});
