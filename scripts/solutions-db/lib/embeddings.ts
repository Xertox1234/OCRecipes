import OpenAI from "openai";

export const EMBED_MODEL = "text-embedding-3-small";
export const EMBED_DIMS = 1536;
export const MAX_EMBED_CHARS = 32_000; // ~8K tokens, under the 8191 per-input cap
export const EMBED_INPUT_CHUNK = 100; // ~100K tokens/request, under the ~300K cap

/** Cheap deterministic length-EMBED_DIMS vector from a string (DJB2-seeded LCG, range [-0.5, 0.5)). */
export function stubVector(text: string): number[] {
  let h = 5381;
  for (let i = 0; i < text.length; i++)
    h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  const vec = new Array<number>(EMBED_DIMS);
  for (let i = 0; i < EMBED_DIMS; i++) {
    h = (h * 1103515245 + 12345) >>> 0;
    // Divide by 2^32 (not 0xffffffff) so the range is truly half-open [-0.5, 0.5):
    // h maxes at 0xffffffff, and 0xffffffff / 0x100000000 < 1, so the value never reaches 0.5.
    vec[i] = h / 0x100000000 - 0.5;
  }
  return vec;
}

/**
 * Deterministic, key-free embedder for the CI gates (parity / round-trip / hook-equivalence).
 * Gated behind SOLUTIONS_EMBED_STUB=1 so it NEVER fires on the real ingest path. It must live in
 * getClient (not embedBatch): embedBatch's `client` default param evaluates getClient() at call
 * time, and upsertSolutions calls embedBatch with NO client — so a body-level stub branch would be
 * reached only AFTER getClient() already threw "AI_INTEGRATIONS_OPENAI_API_KEY not set". Each item
 * carries the per-request `index` so embedBatch's index-based mapping is exercised exactly as for a
 * real OpenAI response. Only `embeddings.create` is implemented — the sole method embedBatch calls.
 */
function makeStubClient(): Pick<OpenAI, "embeddings"> {
  return {
    embeddings: {
      create: ({ input }: { input: string | string[] }) => {
        const inputs = Array.isArray(input) ? input : [input];
        return Promise.resolve({
          data: inputs.map((text, i) => ({
            index: i,
            embedding: stubVector(String(text)),
          })),
        });
      },
    },
  } as unknown as Pick<OpenAI, "embeddings">;
}

let _client: Pick<OpenAI, "embeddings"> | null = null;
export function getClient(): Pick<OpenAI, "embeddings"> {
  if (!_client) {
    if (process.env.SOLUTIONS_EMBED_STUB === "1") {
      _client = makeStubClient();
      return _client;
    }
    const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    if (!apiKey) throw new Error("AI_INTEGRATIONS_OPENAI_API_KEY not set");
    _client = new OpenAI({
      apiKey,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });
  }
  return _client;
}

export function buildEmbeddingText(title: string, body: string): string {
  return `${title}\n\n${body}`;
}

export function truncateForEmbedding(text: string): string {
  return text.length > MAX_EMBED_CHARS ? text.slice(0, MAX_EMBED_CHARS) : text;
}

/** Embed `texts` in order. Pass a client for tests; defaults to the lazy singleton. */
export async function embedBatch(
  texts: string[],
  client: Pick<OpenAI, "embeddings"> = getClient(),
): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_INPUT_CHUNK) {
    const chunk = texts
      .slice(i, i + EMBED_INPUT_CHUNK)
      .map(truncateForEmbedding);
    const res = await client.embeddings.create({
      model: EMBED_MODEL,
      input: chunk,
    });
    // d.index is 0-based WITHIN this request — place each embedding at its input
    // position; never rely on res.data being returned in input order.
    const chunkOut: number[][] = new Array<number[]>(chunk.length);
    for (const d of res.data) chunkOut[d.index] = d.embedding as number[];
    out.push(...chunkOut);
  }
  return out;
}
