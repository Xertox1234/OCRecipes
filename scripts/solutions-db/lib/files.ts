import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parseSolution, type ParsedSolution } from "./parse";

export const SOLUTIONS_ROOT = join(
  __dirname,
  "..",
  "..",
  "..",
  "docs",
  "solutions",
);

export function listSolutionFiles(root: string = SOLUTIONS_ROOT): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === "_manifests") continue;
      out.push(...listSolutionFiles(join(root, entry.name)));
    } else if (entry.name.endsWith(".md") && entry.name !== "README.md") {
      out.push(join(root, entry.name));
    }
  }
  return out;
}

export function parseFile(
  absPath: string,
  root: string = SOLUTIONS_ROOT,
): ParsedSolution {
  const raw = readFileSync(absPath, "utf8");
  const mtimeISO = statSync(absPath).mtime.toISOString().slice(0, 10);
  return parseSolution(raw, relative(root, absPath), mtimeISO);
}
