import { createHash } from "node:crypto";
import { basename } from "node:path";
import matter from "gray-matter";
import { z } from "zod";

export type Track = "bug" | "knowledge";
export type Category =
  | "logic-errors"
  | "runtime-errors"
  | "code-quality"
  | "performance-issues"
  | "conventions"
  | "design-patterns"
  | "best-practices";

export interface ParsedSolution {
  sourcePath: string;
  slug: string;
  title: string;
  track: Track;
  category: Category;
  module: string | null;
  severity: string | null;
  tags: string[];
  symptoms: string[];
  appliesTo: string[];
  created: string;
  lastUpdated: string | null;
  body: string;
  sections: Record<string, string>;
  contentHash: string;
  warnings: string[];
}

const BUG_CATS = new Set<Category>([
  "logic-errors",
  "runtime-errors",
  "code-quality",
  "performance-issues",
]);
const KNOWLEDGE_CATS = new Set<Category>([
  "conventions",
  "design-patterns",
  "best-practices",
]);
const ALL_CATS = new Set<string>([...BUG_CATS, ...KNOWLEDGE_CATS]);

const FrontmatterSchema = z
  .object({
    title: z.string().optional().catch(undefined),
    track: z.enum(["bug", "knowledge"]).optional().catch(undefined),
    category: z.string().optional().catch(undefined),
    tags: z.array(z.string()).optional().catch(undefined),
    module: z.string().optional().catch(undefined),
    applies_to: z.array(z.string()).optional().catch(undefined),
    symptoms: z.array(z.string()).optional().catch(undefined),
    created: z.union([z.string(), z.date()]).optional().catch(undefined),
    last_updated: z.union([z.string(), z.date()]).optional().catch(undefined),
    severity: z.string().optional().catch(undefined),
  })
  .passthrough();

export function deriveSlug(fileName: string): string {
  return fileName.replace(/\.md$/, "").replace(/-\d{4}-\d{2}-\d{2}$/, "");
}

function dateFromFileName(fileName: string): string | null {
  const m = /(\d{4}-\d{2}-\d{2})\.md$/.exec(fileName);
  return m ? m[1] : null;
}

function toISODate(v: string | Date | undefined): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return v.slice(0, 10);
}

export function splitSections(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  let cur: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (cur !== null) out[cur] = buf.join("\n").trim();
  };
  for (const line of body.split("\n")) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) {
      flush();
      cur = m[1];
      buf = [];
    } else if (cur !== null) {
      buf.push(line);
    }
  }
  flush();
  return out;
}

export function computeContentHash(raw: string): string {
  return createHash("sha256").update(raw.trim()).digest("hex");
}

/**
 * Parse a solution markdown file. PURE — no IO.
 * @param raw full file contents (frontmatter + body).
 * @param sourcePath path RELATIVE TO docs/solutions/, e.g. "logic-errors/foo-2026-06-12.md".
 *   The FIRST path segment is the category directory and drives track/category derivation,
 *   so callers must pass a path relative to the solutions root (not an absolute or deeper path).
 * @param mtimeISO last-resort YYYY-MM-DD fallback for `created`.
 */
export function parseSolution(
  raw: string,
  sourcePath: string,
  mtimeISO: string,
): ParsedSolution {
  const warnings: string[] = [];
  const fileName = basename(sourcePath);
  const slug = deriveSlug(fileName);

  const parsed = matter(raw);
  const fm = FrontmatterSchema.safeParse(parsed.data);
  const data = fm.success ? fm.data : {};
  if (!fm.success) {
    warnings.push(
      "frontmatter failed schema validation; using best-effort values",
    );
  }

  const rawCategory = sourcePath.split("/")[0];
  const isKnownCategory = ALL_CATS.has(rawCategory);
  if (!isKnownCategory)
    warnings.push(`unknown category directory: ${rawCategory}`);
  // Directory-derived. Unknown values are warned above and rejected fail-closed by the DB
  // category_enum at insert time; the cast is safe for all real (known-directory) inputs.
  const category = rawCategory as Category;
  const track: Track = BUG_CATS.has(category) ? "bug" : "knowledge";
  if (data.track && data.track !== track) {
    warnings.push(
      `frontmatter track '${data.track}' disagrees with directory-derived '${track}'`,
    );
  }

  let title = data.title ?? "";
  if (!title) {
    title = slug;
    warnings.push("title missing — derived from filename slug");
  }

  const createdFromFm = toISODate(data.created);
  const created = createdFromFm ?? dateFromFileName(fileName) ?? mtimeISO;
  if (!createdFromFm)
    warnings.push("created missing — derived from filename/mtime");

  const moduleName = data.module ?? null;
  if (!moduleName) {
    warnings.push("module missing");
  }
  const severity = data.severity ?? null;
  if (track === "bug" && !severity) {
    warnings.push("severity missing (required for bug track)");
  }
  const tags = data.tags ?? [];
  if (tags.length === 0) {
    warnings.push("tags missing");
  }

  return {
    sourcePath,
    slug,
    title,
    track,
    category,
    module: moduleName,
    severity,
    tags,
    symptoms: data.symptoms ?? [],
    appliesTo: data.applies_to ?? [],
    created,
    lastUpdated: toISODate(data.last_updated),
    body: parsed.content.trim(),
    sections: splitSections(parsed.content),
    contentHash: computeContentHash(raw),
    warnings,
  };
}
