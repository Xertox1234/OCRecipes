import { describe, it, expect, vi } from "vitest";
import {
  buildEmbeddingText,
  truncateForEmbedding,
  embedBatch,
  MAX_EMBED_CHARS,
  EMBED_INPUT_CHUNK,
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
});
