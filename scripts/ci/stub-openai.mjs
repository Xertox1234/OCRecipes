#!/usr/bin/env node
// Stand-in for the OpenAI API in the E2E regression run (harness diagnosis N6, part B).
//
// The nightly suite uploads a receipt photo on both platforms (e2e/flows/plan/receipt-upload.yaml)
// so a broken upload shows within a day: the SDK 57 upgrade (#1549) broke the FormData uploads on
// both platforms for 4 days, and no flow uploaded anything. The receipt scan's AI step runs after
// the photo reaches the server; with the run's sk-stub key it would 500, and the flow could not
// tell "the upload arrived, the AI failed" from "nothing left the phone". So the server's
// AI_INTEGRATIONS_OPENAI_BASE_URL points here and the receipt request gets a fixed answer.
//
// Only a vision request whose prompt is the receipt prompt is answered. Every other request gets
// the 401 the real API gives sk-stub, so every other flow sees exactly what it saw before.
// Each request is logged (one line, no bodies) to STUB_OPENAI_LOG: a control run reads it to show
// whether the upload reached the AI step at all.
//
// usage: node scripts/ci/stub-openai.mjs   (STUB_OPENAI_PORT default 4010, STUB_OPENAI_LOG default
// stub-openai.log). GET /health answers 200 for the readiness wait.
import { appendFileSync } from "node:fs";
import { createServer } from "node:http";

const PORT = Number(process.env.STUB_OPENAI_PORT || 4010);
const LOG = process.env.STUB_OPENAI_LOG || "stub-openai.log";

// The flow asserts this name on the review screen; nothing else in the app contains it.
export const RECEIPT_ITEM = "E2E Avocado Nine";

const RECEIPT_ANSWER = {
  items: [
    {
      name: RECEIPT_ITEM,
      originalName: "E2E AVO 9",
      quantity: 1,
      category: "produce",
      isFood: true,
      estimatedShelfLifeDays: 5,
      confidence: 0.95,
    },
  ],
  storeName: "E2E Market",
  isPartialExtraction: false,
  overallConfidence: 0.95,
};

function log(line) {
  try {
    appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`);
  } catch {
    // a log failure must not fail the request
  }
}

function isReceiptVision(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const text = (m) =>
    typeof m?.content === "string"
      ? m.content
      : Array.isArray(m?.content)
        ? m.content.map((p) => p?.text ?? "").join(" ")
        : "";
  const hasImage = messages.some(
    (m) =>
      Array.isArray(m?.content) &&
      m.content.some((p) => p?.type === "image_url"),
  );
  const isReceipt = messages.some(
    (m) => m?.role === "system" && /grocery receipt analysis/i.test(text(m)),
  );
  return hasImage && isReceipt;
}

function send(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health")
    return send(res, 200, { ok: true });
  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk;
  });
  req.on("end", () => {
    let body = null;
    try {
      body = JSON.parse(raw);
    } catch {
      // not JSON: falls through to the 401 below
    }
    if (
      req.method === "POST" &&
      req.url?.endsWith("/chat/completions") &&
      isReceiptVision(body)
    ) {
      log(`receipt ${req.url} model=${body?.model ?? "?"}`);
      return send(res, 200, {
        id: "chatcmpl-e2e-stub",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: body?.model ?? "stub",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: JSON.stringify(RECEIPT_ANSWER),
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    }
    log(`401 ${req.method} ${req.url}`);
    send(res, 401, {
      error: {
        message: "Incorrect API key provided: sk-stub.",
        type: "invalid_request_error",
        code: "invalid_api_key",
      },
    });
  });
});

server.listen(PORT, "127.0.0.1", () => log(`listening on ${PORT}`));
