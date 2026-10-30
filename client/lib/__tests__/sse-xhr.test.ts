import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { streamSse, type SseOutcome } from "../sse-xhr";

/**
 * Models React Native's XHR event ordering: `abort()` zeroes the status and
 * dispatches readystatechange at DONE BEFORE `abort`; a native timeout/error
 * dispatches readystatechange at DONE (status stays 200) BEFORE
 * `timeout`/`error`; neither fires `load`.
 */
class MockXHR {
  static last: MockXHR;
  readyState = 0;
  responseText = "";
  status = 200;
  timeout = 0;
  headers: Record<string, string> = {};
  onprogress: (() => void) | null = null;
  onreadystatechange: (() => void) | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  open = vi.fn();
  setRequestHeader = vi.fn((k: string, v: string) => (this.headers[k] = v));
  send = vi.fn(() => {
    this.readyState = 1;
  });
  abort = vi.fn(() => {
    if (this.readyState === 0 || this.readyState === 4) return;
    this.status = 0;
    this.responseText = "";
    this.readyState = 4;
    this.onreadystatechange?.();
    this.onabort?.();
  });

  constructor() {
    MockXHR.last = this;
  }

  chunk(text: string) {
    this.responseText += text;
    this.readyState = 3;
    this.onreadystatechange?.();
  }
  progress(text: string) {
    this.responseText += text;
    this.onprogress?.();
  }
  complete(status = 200) {
    this.readyState = 4;
    this.status = status;
    this.onreadystatechange?.();
    this.onload?.();
  }
  failNatively(kind: "timeout" | "error") {
    this.responseText = kind;
    this.readyState = 4;
    this.onreadystatechange?.();
    if (kind === "timeout") this.ontimeout?.();
    else this.onerror?.();
  }
}

function start(extra: { inactivityMs?: number } = {}) {
  const events: Record<string, unknown>[] = [];
  const closes: SseOutcome[] = [];
  const controller = new AbortController();
  let stopOn: ((d: Record<string, unknown>) => boolean) | null = null;
  streamSse({
    url: "http://x/api",
    body: '{"a":1}',
    headers: { "Content-Type": "application/json", "X-Timezone": "UTC" },
    timeoutMs: 1234,
    signal: controller.signal,
    onEvent: (d) => {
      events.push(d);
      if (stopOn?.(d)) return "stop";
    },
    onClose: (o) => closes.push(o),
    ...extra,
  });
  return {
    xhr: MockXHR.last,
    events,
    closes,
    controller,
    stopWhen: (fn: (d: Record<string, unknown>) => boolean) => (stopOn = fn),
  };
}

beforeEach(() => {
  vi.stubGlobal("XMLHttpRequest", MockXHR);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("streamSse request", () => {
  it("opens, sets headers and timeout, and sends the body", () => {
    const { xhr } = start();
    expect(xhr.open).toHaveBeenCalledWith("POST", "http://x/api", true);
    expect(xhr.headers).toEqual({
      "Content-Type": "application/json",
      "X-Timezone": "UTC",
    });
    expect(xhr.timeout).toBe(1234);
    expect(xhr.send).toHaveBeenCalledWith('{"a":1}');
  });

  it("delivers aborted without creating a request when already aborted", () => {
    const closes: SseOutcome[] = [];
    const c = new AbortController();
    c.abort();
    const before = MockXHR.last;
    streamSse({
      url: "u",
      body: "",
      headers: {},
      timeoutMs: 1,
      signal: c.signal,
      onEvent: () => {},
      onClose: (o) => closes.push(o),
    });
    expect(closes).toEqual([{ kind: "aborted" }]);
    expect(MockXHR.last).toBe(before);
  });
});

describe("streamSse event parsing", () => {
  it("reassembles an event split across chunks", () => {
    const { xhr, events } = start();
    xhr.chunk('data: {"content":"he');
    expect(events).toEqual([]);
    xhr.chunk('llo"}\ndata: {"done":true}\n');
    expect(events).toEqual([{ content: "hello" }, { done: true }]);
  });

  it("does not deliver twice when progress and readystatechange both fire", () => {
    const { xhr, events } = start();
    xhr.progress('data: {"n":1}\n');
    xhr.chunk('data: {"n":2}\n');
    xhr.onprogress?.();
    expect(events).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it("skips non-data lines, invalid JSON and non-object payloads", () => {
    const { xhr, events } = start();
    xhr.chunk(
      ': ping\ndata: not json\ndata: 5\ndata: null\ndata: [1]\ndata: {"ok":1}\n',
    );
    expect(events).toEqual([{ ok: 1 }]);
  });

  it("swallows a throwing handler and keeps streaming", () => {
    const events: unknown[] = [];
    streamSse({
      url: "u",
      body: "",
      headers: {},
      timeoutMs: 1,
      signal: new AbortController().signal,
      onEvent: (d) => {
        events.push(d);
        throw new Error("boom");
      },
      onClose: () => {},
    });
    MockXHR.last.chunk('data: {"a":1}\ndata: {"b":2}\n');
    expect(events).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("flushes text that only arrived with load", () => {
    const { xhr, closes, events } = start();
    xhr.responseText = 'data: {"done":true}\n';
    xhr.onload?.();
    expect(events).toEqual([{ done: true }]);
    expect(closes).toEqual([
      { kind: "load", status: 200, responseText: 'data: {"done":true}\n' },
    ]);
  });

  it("onEvent 'stop' ends the stream with no outcome and drops the rest", () => {
    const { xhr, events, closes, stopWhen } = start();
    stopWhen((d) => d.done === true);
    xhr.chunk('data: {"done":true}\ndata: {"late":1}\n');
    xhr.chunk('data: {"later":1}\n');
    xhr.complete();
    xhr.failNatively("error");
    expect(events).toEqual([{ done: true }]);
    expect(closes).toEqual([]);
  });
});

describe("streamSse terminal outcomes", () => {
  it("reports a clean close once", () => {
    const { xhr, closes } = start();
    xhr.complete(200);
    expect(closes).toEqual([{ kind: "load", status: 200, responseText: "" }]);
  });

  it("reports http-error at readyState 4 and ignores the later load", () => {
    const { xhr, closes } = start();
    xhr.responseText = '{"error":"nope"}';
    xhr.complete(429);
    expect(closes).toEqual([
      { kind: "http-error", status: 429, responseText: '{"error":"nope"}' },
    ]);
  });

  it("reports a non-2xx load that had no readystatechange", () => {
    const { xhr, closes } = start();
    xhr.status = 500;
    xhr.onload?.();
    expect(closes).toEqual([{ kind: "load", status: 500, responseText: "" }]);
  });

  it("RN order: readystatechange at DONE then timeout reports exactly one timeout", () => {
    const { xhr, closes } = start();
    xhr.chunk('data: {"a":1}\n');
    xhr.failNatively("timeout");
    expect(closes).toEqual([{ kind: "timeout" }]);
  });

  it("RN order: readystatechange at DONE then error reports exactly one network", () => {
    const { xhr, closes } = start();
    xhr.failNatively("error");
    expect(closes).toEqual([{ kind: "network" }]);
  });
});

describe("streamSse abort", () => {
  it("abort() mid-stream aborts the XHR once and reports one aborted (RN abort -> readystatechange ordering)", () => {
    const { xhr, closes, controller } = start();
    xhr.chunk('data: {"a":1}\n');
    controller.abort();
    expect(xhr.abort).toHaveBeenCalledTimes(1);
    expect(closes).toEqual([{ kind: "aborted" }]);
  });

  it("an abort event from outside the signal is reported as aborted", () => {
    const { xhr, closes } = start();
    xhr.onabort?.();
    expect(closes).toEqual([{ kind: "aborted" }]);
  });

  it("still forwards abort to the XHR after the stream settled, without a second outcome", () => {
    const { xhr, closes, controller } = start();
    xhr.complete();
    controller.abort();
    expect(xhr.abort).toHaveBeenCalledTimes(1);
    expect(closes).toHaveLength(1);
  });
});

describe("streamSse inactivity", () => {
  it("fires inactivity then aborts, settling before the abort re-dispatch", () => {
    const { xhr, closes } = start({ inactivityMs: 1000 });
    vi.advanceTimersByTime(1000);
    expect(closes).toEqual([{ kind: "inactivity" }]);
    expect(xhr.abort).toHaveBeenCalledTimes(1);
  });

  it("is re-armed by new bytes", () => {
    const { xhr, closes } = start({ inactivityMs: 1000 });
    vi.advanceTimersByTime(900);
    xhr.chunk('data: {"status":"x"}\n');
    vi.advanceTimersByTime(900);
    expect(closes).toEqual([]);
    vi.advanceTimersByTime(100);
    expect(closes).toEqual([{ kind: "inactivity" }]);
  });

  it("is cleared by stop, by a terminal outcome and by abort", () => {
    const a = start({ inactivityMs: 1000 });
    a.stopWhen(() => true);
    a.xhr.chunk('data: {"done":true}\n');
    const b = start({ inactivityMs: 1000 });
    b.xhr.complete();
    const c = start({ inactivityMs: 1000 });
    c.controller.abort();
    vi.advanceTimersByTime(5000);
    expect(a.closes).toEqual([]);
    expect(b.closes).toHaveLength(1);
    expect(c.closes).toEqual([{ kind: "aborted" }]);
  });

  it("is off when inactivityMs is omitted", () => {
    const { closes } = start();
    vi.advanceTimersByTime(10 * 60_000);
    expect(closes).toEqual([]);
  });
});
