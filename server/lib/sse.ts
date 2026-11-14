/**
 * SSE framing owner for the chat stream: the one place that writes
 * `data: …\n\n` frames, the keep-alive ping, the response byte cap and the
 * abort/timeout wiring. Extracted from the chat turn engine so a wire-format
 * change (event shape, ping, timeout) is made once.
 */
import type { Response } from "express";
import { SSE_TIMEOUT_MS } from "@shared/constants/sse";
import { logger } from "./logger";

const SSE_MAX_RESPONSE_BYTES = 50 * 1024; // 50KB max response size
// SSE comment keep-alive cadence. The client treats 20 s of silence after an
// app resume as a dead socket (client/lib/sse-xhr.ts), so this must stay well
// under that.
export const SSE_PING_INTERVAL_MS = 15_000;

/** The slice of per-turn state the sink reads and writes. */
export interface SseSinkState {
  aborted: boolean;
  responseBytes: number;
}

/** The wire format of one SSE event from an already-serialised JSON payload. */
export function sseFrame(json: string): string {
  return `data: ${json}\n\n`;
}

/** Write the SSE response headers and flush them so the stream opens now. */
export function openSse(res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
}

/** A no-op turn (stale or repeated finder action): open and close the SSE. */
export function endSseQuietly(res: Response): void {
  openSse(res);
  res.write(sseFrame(JSON.stringify({ done: true })));
  res.end();
}

/** Owns SSE writes, the response byte cap, and the abort/timeout wiring. */
export class SseSink {
  private readonly timeout: ReturnType<typeof setTimeout>;
  private readonly pingTimer: ReturnType<typeof setInterval>;

  constructor(
    private readonly res: Response,
    private readonly conversationId: number,
    private readonly state: SseSinkState,
    private readonly abortController: AbortController,
  ) {
    // Keep-alive comment: lets the client tell a quiet-but-live reply from a
    // dead socket. Cleared in dispose() (done/error), on the SSE timeout and
    // on client disconnect.
    this.pingTimer = setInterval(() => {
      if (!res.writableEnded) res.write(": ping\n\n");
    }, SSE_PING_INTERVAL_MS);
    res.once("close", () => clearInterval(this.pingTimer));
    // SSE timeout — prevent hung connections
    this.timeout = setTimeout(() => {
      clearInterval(this.pingTimer);
      state.aborted = true;
      abortController.abort();
      // The coach generators' "streaming error" log is downgraded to debug
      // on any abort (disconnect and timeout share the signal — see
      // nutrition-coach.ts), so a genuine hang would vanish above debug.
      // Log it here, where the SSE-timeout cause is unambiguous.
      logger.warn({ conversationId }, "chat SSE stream timed out");
      if (!res.writableEnded) {
        res.write(sseFrame(JSON.stringify({ error: "Response timeout" })));
        res.end();
      }
    }, SSE_TIMEOUT_MS);
  }

  /** Write one SSE event from an already-serialised JSON payload. */
  sendRaw(json: string): void {
    this.res.write(sseFrame(json));
  }

  send(payload: unknown): void {
    this.sendRaw(JSON.stringify(payload));
  }

  /** Write only while the response is still open. */
  sendIfOpen(payload: unknown): void {
    if (!this.res.writableEnded) this.send(payload);
  }

  /**
   * Count an event against the response size cap. Returns true when the cap
   * tripped (the caller must stop streaming) — the abort, log and error event
   * are already done.
   */
  exceedsCap(eventJson: string): boolean {
    this.state.responseBytes += eventJson.length;
    if (this.state.responseBytes <= SSE_MAX_RESPONSE_BYTES) return false;
    this.state.aborted = true;
    this.abortController.abort();
    // Closes the generator via return(), not a catch: log it here.
    logger.warn(
      {
        conversationId: this.conversationId,
        responseBytes: this.state.responseBytes,
      },
      "chat SSE response exceeded the size limit",
    );
    this.sendIfOpen({ error: "Response too large" });
    return true;
  }

  dispose(): void {
    clearTimeout(this.timeout);
    clearInterval(this.pingTimer);
  }
}
