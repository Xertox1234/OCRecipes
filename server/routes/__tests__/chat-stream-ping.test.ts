// The SSE keep-alive ping in SseSink (client treats 20 s of silence after an
// app resume as a dead socket; see client/lib/sse-xhr.ts).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import type { Response } from "express";
import { SseSink, SSE_PING_INTERVAL_MS } from "../chat-stream";

vi.mock("../../storage", () => ({ storage: {} }));
vi.mock("../../lib/openai", () => ({
  isAiConfigured: true,
  openai: {},
  OPENAI_TIMEOUT_MS: 30000,
  OPENAI_VISION_TIMEOUT_MS: 60000,
}));

function makeRes() {
  const res = new EventEmitter() as EventEmitter & {
    writableEnded: boolean;
    write: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  };
  res.writableEnded = false;
  res.write = vi.fn();
  res.end = vi.fn(() => {
    res.writableEnded = true;
  });
  return res;
}

function makeSink(res: ReturnType<typeof makeRes>) {
  const state = {
    aborted: false,
    clientDisconnected: false,
    responseBytes: 0,
    streamedContent: "",
  };
  return new SseSink(
    res as unknown as Response,
    1,
    state,
    new AbortController(),
  );
}

const pings = (res: ReturnType<typeof makeRes>) =>
  res.write.mock.calls.filter((c) => c[0] === ": ping\n\n").length;

describe("SseSink keep-alive ping", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("writes an SSE comment every 15 s while the reply is in flight", () => {
    const res = makeRes();
    const sink = makeSink(res);
    expect(SSE_PING_INTERVAL_MS).toBe(15_000);
    vi.advanceTimersByTime(14_999);
    expect(pings(res)).toBe(0);
    vi.advanceTimersByTime(1);
    expect(pings(res)).toBe(1);
    vi.advanceTimersByTime(30_000);
    expect(pings(res)).toBe(3);
    sink.dispose();
  });

  it("stops pinging after dispose (done / error)", () => {
    const res = makeRes();
    const sink = makeSink(res);
    sink.dispose();
    vi.advanceTimersByTime(60_000);
    expect(pings(res)).toBe(0);
  });

  it("stops pinging when the client disconnects", () => {
    const res = makeRes();
    const sink = makeSink(res);
    vi.advanceTimersByTime(15_000);
    res.emit("close");
    vi.advanceTimersByTime(60_000);
    expect(pings(res)).toBe(1);
    sink.dispose();
  });

  it("stops pinging at the SSE timeout and never writes after the response ended", () => {
    const res = makeRes();
    makeSink(res);
    vi.advanceTimersByTime(120_000);
    expect(res.end).toHaveBeenCalled();
    const before = pings(res);
    vi.advanceTimersByTime(60_000);
    expect(pings(res)).toBe(before);
  });
});
