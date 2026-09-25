import { QueryClient } from "@tanstack/react-query";

import { invalidateFoodLogQueries } from "../food-log-invalidation";

describe("invalidateFoodLogQueries", () => {
  it("refreshes scanned items, the daily summary and every daily-budget variant", () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    invalidateFoodLogQueries(queryClient);

    expect(spy).toHaveBeenCalledWith({ queryKey: ["/api/scanned-items"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["/api/daily-summary"] });
    // The bare prefix: reaches the undated (Home) and dated (Plan) keys.
    expect(spy).toHaveBeenCalledWith({ queryKey: ["/api/daily-budget"] });
    expect(spy).toHaveBeenCalledTimes(3);
  });
});
