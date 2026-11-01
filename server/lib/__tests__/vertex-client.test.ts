// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createVertexClient,
  vertexBaseUrl,
  VERTEX_SCOPE,
} from "../vertex-client";
import { VertexAuthError } from "../ai-failure";

const getAccessToken = vi.fn();
const GoogleAuthCtor = vi.fn();
vi.mock("google-auth-library", () => ({
  GoogleAuth: vi.fn().mockImplementation(function (opts: unknown) {
    GoogleAuthCtor(opts);
    return { getAccessToken };
  }),
}));

const OpenAICtor = vi.fn();
// Keeps the real OpenAIError: VertexAuthError extends it at import time.
vi.mock("openai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openai")>();
  const ctor = vi.fn().mockImplementation(function (opts: unknown) {
    OpenAICtor(opts);
    return { chat: { completions: { create: vi.fn() } } };
  });
  return {
    default: Object.assign(ctor, { OpenAIError: actual.default.OpenAIError }),
  };
});

const FULL = {
  GOOGLE_VERTEX_PROJECT: "oc-vision",
  GOOGLE_VERTEX_SERVICE_ACCOUNT_EMAIL: "ai@oc-vision.iam.gserviceaccount.com",
  GOOGLE_VERTEX_SERVICE_ACCOUNT_KEY:
    "-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----\\n",
};

function apiKeySetter(): () => Promise<string> {
  const opts = OpenAICtor.mock.calls[0][0] as { apiKey: () => Promise<string> };
  return opts.apiKey;
}

describe("createVertexClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    "GOOGLE_VERTEX_PROJECT",
    "GOOGLE_VERTEX_SERVICE_ACCOUNT_EMAIL",
    "GOOGLE_VERTEX_SERVICE_ACCOUNT_KEY",
  ])("returns null when %s is missing or blank", (name) => {
    expect(createVertexClient({ ...FULL, [name]: undefined })).toBeNull();
    expect(createVertexClient({ ...FULL, [name]: "  " })).toBeNull();
    expect(OpenAICtor).not.toHaveBeenCalled();
  });

  it("disables SDK retries (the fallback provider is the retry)", () => {
    createVertexClient(FULL);
    expect(OpenAICtor.mock.calls[0][0]).toMatchObject({ maxRetries: 0 });
  });

  it("never reads the Play IAP service account", () => {
    expect(
      createVertexClient({
        GOOGLE_SERVICE_ACCOUNT_EMAIL: "play@x",
        GOOGLE_SERVICE_ACCOUNT_KEY: "pem",
      }),
    ).toBeNull();
  });

  it("aims the SDK at the global openapi endpoint with PEM newlines restored", () => {
    expect(createVertexClient(FULL)).not.toBeNull();
    expect(OpenAICtor).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL:
          "https://aiplatform.googleapis.com/v1/projects/oc-vision/locations/global/endpoints/openapi",
        apiKey: expect.any(Function),
      }),
    );
    expect(GoogleAuthCtor).toHaveBeenCalledWith({
      credentials: {
        client_email: FULL.GOOGLE_VERTEX_SERVICE_ACCOUNT_EMAIL,
        private_key:
          "-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----\n",
      },
      scopes: [VERTEX_SCOPE],
    });
  });

  it("apiKey setter returns the access token", async () => {
    getAccessToken.mockResolvedValue("tok-123");
    createVertexClient(FULL);
    await expect(apiKeySetter()()).resolves.toBe("tok-123");
  });

  it("apiKey setter wraps a login failure in VertexAuthError without key material", async () => {
    getAccessToken.mockRejectedValue(
      new Error("error:1E08010C:DECODER routines::unsupported"),
    );
    createVertexClient(FULL);
    const err = await apiKeySetter()().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VertexAuthError);
    expect((err as Error).message).toContain("GOOGLE_VERTEX_SERVICE_ACCOUNT");
    expect((err as Error).message).not.toContain("ABC");
  });

  it("apiKey setter treats an empty token as a login failure", async () => {
    getAccessToken.mockResolvedValue(null);
    createVertexClient(FULL);
    await expect(apiKeySetter()()).rejects.toBeInstanceOf(VertexAuthError);
  });

  it("encodes the project id into the URL", () => {
    expect(vertexBaseUrl("a/b")).toContain("/projects/a%2Fb/");
  });
});
