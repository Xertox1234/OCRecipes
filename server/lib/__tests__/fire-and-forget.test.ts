import { fireAndForget } from "../fire-and-forget";
import { reportError } from "../error-reporter";

vi.mock("../error-reporter", () => ({ reportError: vi.fn() }));

describe("fireAndForget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // A failed background job produces no uncaught error, so unless it is
  // reported here it never reaches Sentry (audit 2026-10-29 M-obs-1).
  it("reports a background failure to the error reporter with its label", async () => {
    const failure = new Error("purge failed");

    fireAndForget("retention-purge", Promise.reject(failure));
    await new Promise((resolve) => setImmediate(resolve));

    expect(reportError).toHaveBeenCalledWith(failure, "retention-purge");
  });

  it("reports nothing when the background work succeeds", async () => {
    fireAndForget("cache-hit-increment", Promise.resolve(1));
    await new Promise((resolve) => setImmediate(resolve));

    expect(reportError).not.toHaveBeenCalled();
  });
});
