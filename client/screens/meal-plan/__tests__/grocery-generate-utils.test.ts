import { ApiError } from "@/lib/api-error";
import { groceryGenerateErrorMessage } from "../grocery-generate-utils";

const refusal = (code: string | undefined, status = 400) =>
  new ApiError(`${status}: refused`, code, status);

describe("groceryGenerateErrorMessage", () => {
  it("asks for fewer days when the range has too many items for one list", () => {
    expect(groceryGenerateErrorMessage(refusal("LIMIT_REACHED"))).toBe(
      "Too many items for one list. Choose fewer days.",
    );
  });

  it("asks for fewer days when the range is longer than the plan allows", () => {
    expect(groceryGenerateErrorMessage(refusal("DATE_RANGE_LIMIT"))).toBe(
      "That's more days than your plan allows. Choose fewer days.",
    );
  });

  it("gives a plain message for any other refusal (e.g. too many lists)", () => {
    expect(groceryGenerateErrorMessage(refusal("VALIDATION_ERROR"))).toBe(
      "Couldn't make that list. Please try again.",
    );
  });

  it("says nothing for a double tap: the first request owns the outcome", () => {
    expect(
      groceryGenerateErrorMessage(refusal("REQUEST_IN_FLIGHT", 409)),
    ).toBeNull();
  });

  it("says nothing for a server error: the global toast already shows it", () => {
    expect(
      groceryGenerateErrorMessage(refusal("INTERNAL_ERROR", 500)),
    ).toBeNull();
    expect(groceryGenerateErrorMessage(new Error("network down"))).toBeNull();
  });
});
