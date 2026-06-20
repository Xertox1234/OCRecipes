import { describe, it, expect, vi } from "vitest";
import {
  buildEmbeddingText,
  truncateForEmbedding,
  embedBatch,
  stubVector,
  MAX_EMBED_CHARS,
  EMBED_INPUT_CHUNK,
  EMBED_DIMS,
} from "../lib/embeddings";

describe("buildEmbeddingText", () => {
  it("joins title and body", () => {
    expect(buildEmbeddingText("Title", "Body")).toBe("Title\n\nBody");
  });
});

describe("truncateForEmbedding", () => {
  it("caps length at MAX_EMBED_CHARS", () => {
    expect(truncateForEmbedding("a".repeat(MAX_EMBED_CHARS + 500)).length).toBe(
      MAX_EMBED_CHARS,
    );
  });
});

describe("embedBatch", () => {
  it("chunks inputs and flattens vectors in order", async () => {
    const total = EMBED_INPUT_CHUNK + 5;
    const calls: number[] = [];
    const fakeClient = {
      embeddings: {
        create: vi.fn(async ({ input }: { input: string[] }) => {
          calls.push(input.length);
          return {
            data: input.map((_, i) => ({ embedding: [input.length, i] })),
          };
        }),
      },
    } as any;
    const texts = Array.from({ length: total }, (_, i) => `t${i}`);
    const vecs = await embedBatch(texts, fakeClient);
    expect(vecs).toHaveLength(total);
    expect(calls).toEqual([EMBED_INPUT_CHUNK, 5]); // two requests
  });

  it("reorders by response index when data comes back shuffled", async () => {
    // The OpenAI response is NOT contractually ordered; embedBatch must key off each item's
    // `index`. Return data REVERSED (but index-tagged) and assert output is still in input order.
    const fakeClient = {
      embeddings: {
        create: vi.fn(async ({ input }: { input: string[] }) => ({
          data: input.map((_, i) => ({ index: i, embedding: [i] })).reverse(),
        })),
      },
    } as unknown as Parameters<typeof embedBatch>[1];
    const vecs = await embedBatch(["a", "b", "c"], fakeClient);
    expect(vecs).toEqual([[0], [1], [2]]); // input order, despite reversed response
  });
});

describe("stubVector", () => {
  it("returns a deterministic vector of length EMBED_DIMS", () => {
    const a = stubVector("hello");
    const b = stubVector("hello");
    expect(a).toHaveLength(EMBED_DIMS);
    expect(a).toEqual(b); // deterministic — same input, same vector
  });

  it("maps distinct inputs to distinct vectors", () => {
    expect(stubVector("alpha")).not.toEqual(stubVector("beta"));
  });

  it("produces finite values in [-0.5, 0.5)", () => {
    for (const v of stubVector("range-check")) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(-0.5);
      expect(v).toBeLessThan(0.5);
    }
  });
});

describe("getClient stub gate (SOLUTIONS_EMBED_STUB=1)", () => {
  it("returns a key-free stub embedder that embedBatch can use", async () => {
    // Reset the module so the cached _client singleton from earlier imports does not leak,
    // and so the env-gated branch is re-evaluated at getClient() call time.
    vi.resetModules();
    const prevStub = process.env.SOLUTIONS_EMBED_STUB;
    const prevKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    process.env.SOLUTIONS_EMBED_STUB = "1";
    delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY; // prove no key is required
    try {
      const mod = await import("../lib/embeddings");
      const client = mod.getClient(); // must NOT throw despite the missing key
      const vecs = await mod.embedBatch(["one", "two", "three"], client);
      expect(vecs).toHaveLength(3);
      expect(vecs[0]).toHaveLength(mod.EMBED_DIMS);
      expect(vecs[0]).toEqual(mod.stubVector("one")); // index-correct mapping
      expect(vecs[2]).toEqual(mod.stubVector("three"));
    } finally {
      if (prevStub === undefined) delete process.env.SOLUTIONS_EMBED_STUB;
      else process.env.SOLUTIONS_EMBED_STUB = prevStub;
      if (prevKey === undefined)
        delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
      else process.env.AI_INTEGRATIONS_OPENAI_API_KEY = prevKey;
      vi.resetModules();
    }
  });

  it("does NOT fire without the env var — getClient still throws on a missing key", async () => {
    // The safety contract: the stub must never silently replace the real client. With
    // SOLUTIONS_EMBED_STUB unset and no API key, getClient() must throw rather than stub.
    vi.resetModules();
    const prevStub = process.env.SOLUTIONS_EMBED_STUB;
    const prevKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    delete process.env.SOLUTIONS_EMBED_STUB;
    delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    try {
      const mod = await import("../lib/embeddings");
      expect(() => mod.getClient()).toThrow(
        "AI_INTEGRATIONS_OPENAI_API_KEY not set",
      );
    } finally {
      if (prevStub === undefined) delete process.env.SOLUTIONS_EMBED_STUB;
      else process.env.SOLUTIONS_EMBED_STUB = prevStub;
      if (prevKey === undefined)
        delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
      else process.env.AI_INTEGRATIONS_OPENAI_API_KEY = prevKey;
      vi.resetModules();
    }
  });
});
