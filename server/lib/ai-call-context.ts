/**
 * Eval-only call context (spec §3.6/§3.7). Overrides and the fallback switch
 * exist ONLY inside withAiCallContext — never read from env — so production
 * (which never opens a context) can't apply them and NODE_ENV can't void them.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { AiFeature } from "./ai-models";

export interface AiModelOverride {
  model: string;
  set?: Record<string, unknown>;
}

export interface AiCallRecord {
  feature: AiFeature;
  requestedModel: string;
  answeredModel: string | null;
  answeredProvider: string | null;
  fellBack: boolean;
}

export interface AiCallContext {
  overrides: Partial<Record<AiFeature, AiModelOverride>>;
  fallback: "on" | "off";
  calls: AiCallRecord[];
}

const storage = new AsyncLocalStorage<AiCallContext>();

export function withAiCallContext<T>(
  ctx: AiCallContext,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(ctx, fn);
}

export function getAiCallContext(): AiCallContext | undefined {
  return storage.getStore();
}
