// @vitest-environment node
import { generateKeyPairSync } from "node:crypto";
import { describe, it, expect, vi, afterEach } from "vitest";

import { createVertexClient } from "../vertex-client";
import { classifyAiFailure, VertexAuthError } from "../ai-failure";

// Reliability audit 2026-11-19 M-rel-2: the Vertex access-token POST had no
// timeout (gaxios has none by default) and runs before the OpenAI SDK's own
// deadline, so a stalled oauth2.googleapis.com hung the AI call unbounded.
// Real google-auth-library + gaxios here (only the OpenAI SDK is stubbed, to
// capture the apiKey setter); the mocked vertex-client.test.ts cannot show
// that the options reach the token request.
const OpenAICtor = vi.fn();
vi.mock("openai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openai")>();
  const ctor = vi.fn().mockImplementation(function (opts: unknown) {
    OpenAICtor(opts);
    return { chat: { completions: { create: vi.fn() } } };
  });
  return {
    default: Object.assign(ctor, {
      OpenAIError: actual.default.OpenAIError,
      APIError: actual.default.APIError,
    }),
  };
});

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const TOKEN_TIMEOUT_MS = 50;

// Injected, never the network: a fetch the test did not stub fails loudly.
let currentFetch: typeof fetch = () => {
  throw new Error("token endpoint not stubbed");
};

function tokenGetter(key: string = privateKey): () => Promise<string> {
  OpenAICtor.mockClear();
  createVertexClient(
    {
      GOOGLE_VERTEX_PROJECT: "oc-vision",
      GOOGLE_VERTEX_SERVICE_ACCOUNT_EMAIL:
        "ai@oc-vision.iam.gserviceaccount.com",
      GOOGLE_VERTEX_SERVICE_ACCOUNT_KEY: key,
    },
    {
      tokenTimeoutMs: TOKEN_TIMEOUT_MS,
      tokenFetch: (...args) => currentFetch(...args),
    },
  );
  return (OpenAICtor.mock.calls[0][0] as { apiKey: () => Promise<string> })
    .apiKey;
}

/** Counts token POSTs; `respond` decides each one's outcome. */
function stubTokenEndpoint(
  respond: (signal: AbortSignal | undefined) => Promise<Response>,
) {
  const fetchMock = vi.fn((_url: unknown, init?: RequestInit) =>
    respond(init?.signal ?? undefined),
  );
  currentFetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

const hangUntilAborted = (signal: AbortSignal | undefined) =>
  new Promise<Response>((_resolve, reject) => {
    // gaxios aborts with a TimeoutError DOMException (an Error in Node).
    signal?.addEventListener("abort", () => reject(signal.reason as Error));
  });

async function rejection(get: () => Promise<string>): Promise<unknown> {
  return get().then(
    () => {
      throw new Error("expected the token fetch to fail");
    },
    (e: unknown) => e,
  );
}

describe("Vertex token fetch (M-rel-2)", () => {
  afterEach(() => {
    currentFetch = () => {
      throw new Error("token endpoint not stubbed");
    };
  });

  it("gives up on a hung token endpoint after two attempts, as a transport failure", async () => {
    const fetchMock = stubTokenEndpoint(hangUntilAborted);
    const started = Date.now();
    const err = await rejection(tokenGetter());
    const elapsed = Date.now() - started;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Two 50 ms attempts plus gaxios's backoff; far below "never".
    expect(elapsed).toBeLessThan(2_000);
    expect(err).not.toBeInstanceOf(VertexAuthError);
    expect(classifyAiFailure(err)).toBe("transport");
  });

  it("treats a 5xx from the token endpoint as a transport failure", async () => {
    stubTokenEndpoint(async () =>
      Response.json({ error: "backend_error" }, { status: 503 }),
    );
    const err = await rejection(tokenGetter());
    expect(classifyAiFailure(err)).toBe("transport");
  });

  it("keeps a rejected login (400 invalid_grant) as a config failure", async () => {
    const fetchMock = stubTokenEndpoint(async () =>
      Response.json(
        { error: "invalid_grant", error_description: "Invalid JWT Signature." },
        { status: 400 },
      ),
    );
    const err = await rejection(tokenGetter());
    expect(err).toBeInstanceOf(VertexAuthError);
    expect(classifyAiFailure(err)).toBe("config");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps an unusable key (fails at signing, before any request) as a config failure", async () => {
    const fetchMock = stubTokenEndpoint(hangUntilAborted);
    const err = await rejection(
      tokenGetter(
        "-----BEGIN PRIVATE KEY-----\nnot a key\n-----END PRIVATE KEY-----\n",
      ),
    );
    expect(err).toBeInstanceOf(VertexAuthError);
    expect(classifyAiFailure(err)).toBe("config");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the token when the endpoint answers", async () => {
    stubTokenEndpoint(async () =>
      Response.json({
        access_token: "ya29.test",
        expires_in: 3600,
        token_type: "Bearer",
      }),
    );
    await expect(tokenGetter()()).resolves.toBe("ya29.test");
  });
});
