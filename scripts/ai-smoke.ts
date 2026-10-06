/**
 * One tiny call per AI_FEATURES row through OpenRouter with the fallback OFF
 * (spec §6 step 4). Proves zero-retention routing, params (incl. adapt) and
 * JSON/vision mode for every row in the current config. Run after setting
 * OPENROUTER_API_KEY and after every row switch: `npm run ai:smoke`
 * (or `npm run ai:smoke -- coach-chat` for one row).
 */
import "dotenv/config";
import { AI_FEATURES, isAiFeature } from "../server/lib/ai-models";
import type { AiFeature, AiFeatureConfig } from "../server/lib/ai-models";
import { aiChat, withAiCallContext } from "../server/lib/ai-client";
import type { AiChat, AiChatParams } from "../server/lib/ai-client";
import type { AiCallContext } from "../server/lib/ai-call-context";
import { modelMatches } from "../evals/lib/candidate";

// 1×1 PNG — enough for the provider to accept an image part.
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

export function buildSmokeRequest(row: AiFeatureConfig): AiChatParams {
  const text = row.json
    ? 'Reply with exactly this JSON: {"ok":true}'
    : "Reply with the single word: ok";
  return {
    messages: [
      {
        role: "user",
        content: row.vision
          ? [
              { type: "text", text },
              { type: "image_url", image_url: { url: TINY_PNG } },
            ]
          : text,
      },
    ],
    max_completion_tokens: 20,
    temperature: 0,
    ...(row.json ? { response_format: { type: "json_object" as const } } : {}),
  };
}

export async function smokeRow(
  feature: AiFeature,
  chat: AiChat,
): Promise<{
  feature: AiFeature;
  ok: boolean;
  answeredProvider: string | null;
  detail: string;
}> {
  const row: AiFeatureConfig = AI_FEATURES[feature];
  try {
    const res = await chat(feature, buildSmokeRequest(row));
    const content = res.choices[0]?.message?.content ?? "";
    const provider = (res as unknown as { provider?: string }).provider ?? null;
    if (!modelMatches(row.model, res.model)) {
      return {
        feature,
        ok: false,
        answeredProvider: provider,
        detail: `answered by ${res.model}`,
      };
    }
    if (row.json) {
      try {
        JSON.parse(content);
      } catch {
        return {
          feature,
          ok: false,
          answeredProvider: provider,
          detail: `non-JSON reply: ${content.slice(0, 60)}`,
        };
      }
    }
    return { feature, ok: true, answeredProvider: provider, detail: res.model };
  } catch (err) {
    return {
      feature,
      ok: false,
      answeredProvider: null,
      detail: (err as Error).message,
    };
  }
}

async function main(): Promise<void> {
  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    console.error(
      "ai:smoke needs OPENROUTER_API_KEY (it never uses the fallback).",
    );
    process.exit(2);
  }
  const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  for (const name of only) {
    if (!isAiFeature(name)) {
      console.error(`unknown feature "${name}"`);
      process.exit(2);
    }
  }
  const features = (
    only.length ? only : Object.keys(AI_FEATURES)
  ) as AiFeature[];
  let failures = 0;
  for (const feature of features) {
    const ctx: AiCallContext = { overrides: {}, fallback: "off", calls: [] };
    const r = await withAiCallContext(ctx, () => smokeRow(feature, aiChat));
    if (!r.ok) failures++;
    console.log(
      `${r.ok ? "✔" : "✘"} ${feature.padEnd(26)} ${String(r.answeredProvider ?? "-").padEnd(14)} ${r.detail}`,
    );
  }
  console.log(`\n${features.length - failures}/${features.length} rows passed`);
  process.exit(failures ? 1 : 0);
}

if (process.argv[1] && /ai-smoke\.(ts|js)$/.test(process.argv[1])) {
  void main();
}
