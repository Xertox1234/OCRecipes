import OpenAI from "openai";

export const EMBED_MODEL = "text-embedding-3-small";
export const EMBED_DIMS = 1536;
export const MAX_EMBED_CHARS = 32_000; // ~8K tokens, under the 8191 per-input cap
export const EMBED_INPUT_CHUNK = 100; // ~100K tokens/request, under the ~300K cap

let _client: OpenAI | null = null;
export function getClient(): OpenAI {
  if (!_client) {
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
