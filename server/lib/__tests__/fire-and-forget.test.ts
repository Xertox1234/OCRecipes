import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import diagnosticsChannel from "node:diagnostics_channel";
import { fireAndForget } from "../fire-and-forget";
import { logger } from "../logger";
import { reportError } from "../error-reporter";

vi.mock("../error-reporter", () => ({ reportError: vi.fn() }));

// Sentry's pinoIntegration (wired in error-reporter.ts) subscribes to pino's
// own `pino_asJson` tracing channel and captures records at level "error",
// taking the Error from the `err` key. This pins the contract fireAndForget
// must keep for background failures to reach Sentry: an error-level record
// whose `err` is the real Error (not a string, not a warn).
type AsJsonEnd = {
  instance: { levels: { labels: Record<number, string> } };
  arguments: [Record<string, unknown>, string | undefined, number];
};

const channel = diagnosticsChannel.tracingChannel("pino_asJson");
let handler: ((data: unknown) => void) | undefined;
let savedLevel: string;

beforeEach(() => {
  vi.clearAllMocks();
  // test/setup.ts silences the logger, and a silenced level never serializes
  // a record (so nothing is published on the channel).
  savedLevel = logger.level;
  logger.level = "error";
});

afterEach(() => {
  logger.level = savedLevel;
  if (handler) channel.end.unsubscribe(handler);
  handler = undefined;
});

describe("fireAndForget", () => {
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

  it("logs a rejected background promise at error level with the Error under `err` (the pinoIntegration capture contract)", async () => {
    const records: { level: string; obj: Record<string, unknown> }[] = [];
    handler = (data) => {
      const { instance, arguments: args } = data as AsJsonEnd;
      records.push({ level: instance.levels.labels[args[2]], obj: args[0] });
    };
    channel.end.subscribe(handler);

    const boom = new Error("image generation failed");
    fireAndForget("recipe-image", Promise.reject(boom));
    await new Promise((r) => setImmediate(r));

    const record = records.find((r) => r.obj.operation === "recipe-image");
    expect(record?.level).toBe("error");
    expect(record?.obj.err).toBe(boom);
  });

  it("wraps a non-Error rejection into an Error so Sentry gets a stack", async () => {
    const records: Record<string, unknown>[] = [];
    handler = (data) => records.push((data as AsJsonEnd).arguments[0]);
    channel.end.subscribe(handler);

    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the non-Error case is what is under test
    fireAndForget("string-reject", Promise.reject("plain string"));
    await new Promise((r) => setImmediate(r));

    const record = records.find((r) => r.operation === "string-reject");
    expect(record?.err).toBeInstanceOf(Error);
    expect((record?.err as Error).message).toBe("plain string");
  });

  // pinoIntegration captures the logged `err` and reportError captures its
  // argument; the SDK skips an Error object it has already captured, so both
  // must be the SAME object or a non-Error rejection becomes two events.
  it("hands reportError the same Error object it logged, so Sentry dedupes the capture", async () => {
    const records: Record<string, unknown>[] = [];
    handler = (data) => records.push((data as AsJsonEnd).arguments[0]);
    channel.end.subscribe(handler);

    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the non-Error case is what is under test
    fireAndForget("string-dedupe", Promise.reject("plain string"));
    await new Promise((r) => setImmediate(r));

    const record = records.find((r) => r.operation === "string-dedupe");
    expect(record?.err).toBeInstanceOf(Error);
    expect(vi.mocked(reportError).mock.calls[0]?.[0]).toBe(record?.err);
    expect(vi.mocked(reportError).mock.calls[0]?.[1]).toBe("string-dedupe");
  });
});
