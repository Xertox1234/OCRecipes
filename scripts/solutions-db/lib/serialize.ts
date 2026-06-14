import matter from "gray-matter";
import type { ProjectionInput } from "./parse";

/**
 * Serialize a solution projection back to canonical markdown.
 * Round-trips by design: parseSolution(serializeSolution(p)) reproduces p's content_hash,
 * because content_hash is over the normalized projection (not the raw bytes). Null/empty
 * fields are omitted; parse treats them as null/[], yielding the same projection.
 */
export function serializeSolution(p: ProjectionInput): string {
  const fm: Record<string, unknown> = {
    title: p.title,
    track: p.track,
    category: p.category,
  };
  if (p.module) fm.module = p.module;
  if (p.severity) fm.severity = p.severity;
  if (p.tags.length) fm.tags = p.tags;
  if (p.symptoms.length) fm.symptoms = p.symptoms;
  if (p.appliesTo.length) fm.applies_to = p.appliesTo;
  fm.created = p.created;
  if (p.lastUpdated) fm.last_updated = p.lastUpdated;
  for (const k of Object.keys(p.extraFields).sort()) fm[k] = p.extraFields[k];
  // flowLevel:1 → block mapping + INLINE flow arrays (tags: [a, b]) so the
  // markdown-fallback grep (`^tags:.*pat`) stays readable. gray-matter forwards
  // this to js-yaml.dump; the option isn't in its public type, hence the cast.
  const opts = { flowLevel: 1 } as unknown as Parameters<
    typeof matter.stringify
  >[2];
  return matter.stringify("\n" + p.body.trim() + "\n", fm, opts);
}
