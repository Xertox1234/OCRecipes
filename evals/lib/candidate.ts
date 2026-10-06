import {
  AI_FEATURES,
  hostForModel,
  isAiFeature,
} from "../../server/lib/ai-models";
import type { AiFeature } from "../../server/lib/ai-models";
import type {
  AiCallRecord,
  AiModelOverride,
} from "../../server/lib/ai-call-context";

type Overrides = Partial<Record<AiFeature, AiModelOverride>>;

function parseValue(v: string): unknown {
  if (v === "true") return true;
  if (v === "false") return false;
  if (v !== "" && !Number.isNaN(Number(v))) return Number(v);
  return v;
}

export function parseCandidate(spec: string): Overrides {
  const out: Overrides = {};
  const entries = spec
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (entries.length === 0) {
    throw new Error("--candidate needs at least one feature=model entry");
  }
  for (const entry of entries) {
    const [head, ...setParts] = entry.split(";");
    const eq = head.indexOf("=");
    if (eq < 1) {
      throw new Error(
        `--candidate entry "${entry}" must be feature=provider/model`,
      );
    }
    const feature = head.slice(0, eq);
    const model = head.slice(eq + 1);
    if (!isAiFeature(feature)) {
      throw new Error(`--candidate: unknown feature "${feature}"`);
    }
    if (!/^[a-z0-9-]+\/[^/]+$/.test(model)) {
      throw new Error(
        `--candidate: "${model}" must be an OpenRouter provider/model id`,
      );
    }
    if (!hostForModel(model)) {
      throw new Error(
        `--candidate: "${model}" has no pinned OpenRouter host (see PINNED_HOSTS in server/lib/ai-models.ts)`,
      );
    }
    const set: Record<string, unknown> = {};
    for (const part of setParts) {
      const i = part.indexOf("=");
      if (i < 1) {
        throw new Error(`--candidate: bad option "${part}" (want key=value)`);
      }
      set[part.slice(0, i)] = parseValue(part.slice(i + 1));
    }
    out[feature] = Object.keys(set).length ? { model, set } : { model };
  }
  return out;
}

/** OpenRouter may answer with a dated id (e.g. openai/gpt-4o-mini-2024-07-18). */
export function modelMatches(
  requested: string,
  answered: string | null,
): boolean {
  if (!answered) return false;
  if (answered === requested) return true;
  // Only a date suffix counts: "gpt-4o" must not match "gpt-4o-mini".
  return (
    answered.startsWith(`${requested}-`) &&
    /^\d{4}-?\d{2}-?\d{2}$/.test(answered.slice(requested.length + 1))
  );
}

/**
 * Violations for one record, split into the "call failed" line (errored
 * records only) and every other check. A failed call has no answer, so the
 * answered-by / fell-back checks only apply to records without an error.
 */
function recordViolations(
  c: AiCallRecord,
  overrides: Overrides,
): { failed: string | null; others: string[] } {
  const others: string[] = [];
  const expected = overrides[c.feature]?.model ?? AI_FEATURES[c.feature].model;
  if (c.requestedModel !== expected) {
    others.push(
      `${c.feature}: requested ${c.requestedModel}, expected ${expected}`,
    );
  }
  if (c.error) {
    const tag = c.error.moderated ? `${c.error.kind}, moderated` : c.error.kind;
    return {
      failed: `${c.feature}: call failed (${tag}): ${c.error.message}`,
      others,
    };
  }
  if (c.fellBack) others.push(`${c.feature}: fell back to the OpenAI path`);
  if (!modelMatches(c.requestedModel, c.answeredModel)) {
    others.push(
      `${c.feature}: requested ${c.requestedModel} but answered by ${c.answeredModel ?? "unknown"}`,
    );
  }
  return { failed: null, others };
}

export function checkCallRecords(
  calls: AiCallRecord[],
  overrides: Overrides,
): string[] {
  if (calls.length === 0) {
    return [
      "no AI calls recorded — cannot tell which model produced this sample",
    ];
  }
  const violations: string[] = [];
  for (const c of calls) {
    const { failed, others } = recordViolations(c, overrides);
    if (failed) violations.push(failed);
    violations.push(...others);
  }
  return violations;
}

/**
 * True when the provider's moderation blocked at least one call and nothing
 * else is wrong with the sample: every errored record is a moderation block
 * and `checkCallRecords` minus those lines is empty. `overrides` must be the
 * run's, so a clean record is judged against the model it was meant to use.
 */
export function isModerationOnlySample(
  calls: AiCallRecord[],
  overrides: Overrides = {},
): boolean {
  let moderated = 0;
  for (const c of calls) {
    const { failed, others } = recordViolations(c, overrides);
    if (others.length > 0) return false;
    if (failed) {
      if (!c.error?.moderated) return false;
      moderated++;
    }
  }
  return moderated > 0;
}

/**
 * Override features that no sample's recorded calls used. A candidate report
 * for a model that never ran is the named risk (spec §3.7).
 */
export function unusedOverrides(
  overrides: Overrides,
  callsPerSample: AiCallRecord[][],
): string[] {
  const called = new Set<string>();
  for (const calls of callsPerSample) {
    for (const c of calls) called.add(c.feature);
  }
  return Object.keys(overrides).filter((f) => !called.has(f));
}
