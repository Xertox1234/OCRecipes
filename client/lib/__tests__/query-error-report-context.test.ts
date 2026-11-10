import { describe, it, expect, vi, beforeEach } from "vitest";

import { ApiError } from "../api-error";
import { queryClient } from "../query-client";
import { reportError } from "../reporter";

// Keep the real scrubbers (queryKeyLabel); only capture what is reported.
vi.mock("../reporter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../reporter")>()),
  reportError: vi.fn(),
}));

// Privacy audit M9 follow-up: the crash-report context used to be
// `String(queryKey)`, which joined every key element — ingredient names,
// record ids and dates — into the breadcrumb sent with the report.
describe("global error net report context", () => {
  beforeEach(() => vi.mocked(reportError).mockClear());

  it("labels a failed query by its scrubbed route only", async () => {
    await queryClient
      .fetchQuery({
        queryKey: ["/api/allergen-check", ["eggs", "whole milk"]],
        queryFn: async () => {
          throw new ApiError("500: down");
        },
        retry: false,
      })
      .catch(() => undefined);
    expect(reportError).toHaveBeenCalledWith(
      expect.any(ApiError),
      "QueryCache.onError [/api/allergen-check]",
    );
  });

  it("labels a failed mutation by its scrubbed key only", async () => {
    const mutation = queryClient.getMutationCache().build(queryClient, {
      mutationKey: ["/api/cookbooks/42/recipes", { title: "Nana's soup" }],
      mutationFn: async () => {
        throw new ApiError("500: down");
      },
    });
    await mutation.execute(undefined).catch(() => undefined);
    expect(reportError).toHaveBeenCalledWith(
      expect.any(ApiError),
      "MutationCache.onError [/api/cookbooks/:id/recipes]",
    );
  });
});
