/**
 * Prompt-cache report for an eval run (audit LV4). The usage each provider
 * sends is already kept in `aiCalls`; this reads the first successful call of
 * each feature in a sample, because later calls in a tool loop reuse that
 * call's prefix and would hide a miss. Rows are split by provider, since each
 * provider keeps its own cache.
 *
 * A miss is only meaningful when the samples share a prompt prefix and run
 * one after another (EVAL_PARALLELISM=1): parallel samples all write the cache
 * at once and none reads it.
 */
import type { AiCallRecord } from "../../server/lib/ai-call-context";

export interface PromptCacheRow {
  feature: AiCallRecord["feature"];
  provider: string;
  samples: number;
  /** Samples whose first call had any cached prompt tokens. */
  hits: number;
  promptTokens: number;
  cachedTokens: number;
}

export function summarizePromptCache(
  samples: readonly { aiCalls?: readonly AiCallRecord[] }[],
): PromptCacheRow[] {
  const rows = new Map<string, PromptCacheRow>();
  for (const sample of samples) {
    const seen = new Set<string>();
    for (const c of sample.aiCalls ?? []) {
      if (c.error || !c.usage || seen.has(c.feature)) continue;
      seen.add(c.feature);
      const provider = c.answeredProvider ?? "unknown";
      const key = `${c.feature}\u0000${provider}`;
      const row = rows.get(key) ?? {
        feature: c.feature,
        provider,
        samples: 0,
        hits: 0,
        promptTokens: 0,
        cachedTokens: 0,
      };
      const cached = c.usage.prompt_tokens_details?.cached_tokens ?? 0;
      row.samples += 1;
      row.hits += cached > 0 ? 1 : 0;
      row.promptTokens += c.usage.prompt_tokens ?? 0;
      row.cachedTokens += cached;
      rows.set(key, row);
    }
  }
  return [...rows.values()].sort(
    (a, b) =>
      a.feature.localeCompare(b.feature) ||
      a.provider.localeCompare(b.provider),
  );
}

export function formatPromptCacheSummary(rows: PromptCacheRow[]): string[] {
  if (rows.length === 0) return [];
  return [
    "Prompt cache, first call per sample:",
    ...rows.map((r) => {
      const pct = r.promptTokens
        ? Math.round((100 * r.cachedTokens) / r.promptTokens)
        : 0;
      return `  ${r.feature} via ${r.provider}: ${r.hits}/${r.samples} samples hit, ${r.cachedTokens}/${r.promptTokens} prompt tokens cached (${pct}%)`;
    }),
  ];
}
