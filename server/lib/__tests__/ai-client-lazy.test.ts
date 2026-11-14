// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response } from "express";
import type { AiFeature } from "../ai-models";

const OpenAICtor = vi.fn();
const create = vi.fn();
vi.mock("openai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openai")>();
  const ctor = vi.fn().mockImplementation(function (opts: unknown) {
    OpenAICtor(opts);
    return { chat: { completions: { create } } };
  });
  return {
    default: Object.assign(ctor, { OpenAIError: actual.default.OpenAIError }),
  };
});
vi.mock("../logger", () => {
  const log = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return {
    logger: log,
    createServiceLogger: () => log,
    toError: (e: unknown) => (e instanceof Error ? e : new Error(String(e))),
  };
});
vi.mock("../error-reporter", () => ({ reportError: vi.fn() }));

const FEATURE: AiFeature = "receipt-scan";
const PARAMS = {
  messages: [{ role: "user" as const, content: "hello" }],
  max_completion_tokens: 50,
};

describe("aiChat lazy construction", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env = { ...saved, NODE_ENV: "test" };
    delete process.env.GOOGLE_VERTEX_PROJECT;
    delete process.env.GOOGLE_VERTEX_SERVICE_ACCOUNT_EMAIL;
    delete process.env.GOOGLE_VERTEX_SERVICE_ACCOUNT_KEY;
    process.env.OPENROUTER_API_KEY = "sk-stub";
    process.env.OPENROUTER_BASE_URL = "http://127.0.0.1:4010/v1";
    OpenAICtor.mockClear();
    create.mockReset();
    create.mockResolvedValue({
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "hi" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
    vi.resetModules();
  });
  afterEach(() => {
    process.env = saved;
  });

  it("importing ai-client constructs no client", async () => {
    await import("../ai-client");
    expect(OpenAICtor).not.toHaveBeenCalled();
  });

  it("builds its clients on the first call, reading env then, and only once", async () => {
    const { aiChat } = await import("../ai-client");
    await aiChat(FEATURE, PARAMS);
    expect(OpenAICtor).toHaveBeenCalledTimes(1);
    expect(OpenAICtor).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "sk-stub",
        baseURL: "http://127.0.0.1:4010/v1",
      }),
    );
    await aiChat(FEATURE, PARAMS);
    expect(OpenAICtor).toHaveBeenCalledTimes(1);
  });
});

// Privacy audit H3: aiChat is the one path every AI request takes, so the
// AI-sharing permission is checked here.
describe("aiChat AI-sharing permission", () => {
  beforeEach(() => {
    create.mockReset();
    vi.resetModules();
  });

  it("sends nothing for a signed-in user who has not allowed AI sharing", async () => {
    const { requestContextMiddleware, setRequestUserId } = await import(
      "../request-context"
    );
    const { installAiSharingLookup, AiSharingRequiredError } = await import(
      "../ai-sharing-gate"
    );
    const { aiChat } = await import("../ai-client");
    installAiSharingLookup(async () => false);

    const result = await new Promise<unknown>((resolve) => {
      requestContextMiddleware(
        { id: "req-1" } as unknown as Request,
        { setHeader: () => undefined } as unknown as Response,
        () => {
          setRequestUserId("user-1");
          aiChat(FEATURE, PARAMS).then(resolve, resolve);
        },
      );
    });

    expect(result).toBeInstanceOf(AiSharingRequiredError);
    expect(create).not.toHaveBeenCalled();
  });
});
