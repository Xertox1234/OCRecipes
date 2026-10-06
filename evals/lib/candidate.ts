import { AI_FEATURES, isAiFeature } from "../../server/lib/ai-models";
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
    const expected =
      overrides[c.feature]?.model ?? AI_FEATURES[c.feature].model;
    if (c.requestedModel !== expected) {
      violations.push(
        `${c.feature}: requested ${c.requestedModel}, expected ${expected}`,
      );
    }
    if (c.fellBack)
      violations.push(`${c.feature}: fell back to the OpenAI path`);
    if (!modelMatches(c.requestedModel, c.answeredModel)) {
      violations.push(
        `${c.feature}: requested ${c.requestedModel} but answered by ${c.answeredModel ?? "unknown"}`,
      );
    }
  }
  return violations;
}
