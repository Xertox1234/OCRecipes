import { describe, it, expect, afterEach, beforeEach } from "vitest";
import diagnosticsChannel from "node:diagnostics_channel";
import { fireAndForget } from "../fire-and-forget";
import { logger } from "../logger";

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
});
