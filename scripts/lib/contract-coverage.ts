/**
 * Pure helpers for scripts/__tests__/contract-coverage-guard.test.ts. No I/O
 * here so the guard's positive control can run on synthetic strings.
 */
export const PARSE_SITE_RE = /\b([A-Za-z0-9_]*Schema)\.(?:safeParse|parse)\(/g;

export function extractParsedSchemaNames(source: string): string[] {
  const names = new Set<string>();
  for (const m of source.matchAll(PARSE_SITE_RE)) names.add(m[1]);
  return [...names].sort();
}

export interface CoverageReport {
  uncovered: { name: string; files: string[] }[];
  staleAllowlist: string[];
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Strip `//` and block comments while keeping string and template literals,
 * so a schema name mentioned only in prose ("pins the example to fooSchema")
 * does not count as coverage, and a `//` inside a string does not hide a
 * real reference later on the same line. A backslash-escaped character
 * outside a string (the `\/` of a regex literal such as /https?:\/\//) is
 * preserved so an escaped slash pair never reads as a comment start.
 * Deliberately simple, not a tokenizer: a mis-parse can only delete text,
 * so the affected name is reported uncovered (fail closed, loudly). Known
 * limits: a template literal containing a nested backtick pairs wrongly; a
 * regex literal whose body contains an unescaped `//` or `/*` truncates
 * the rest of its line.
 */
const COMMENT_OR_STRING_RE =
  /("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`|\\.)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;

export function stripComments(source: string): string {
  // "$1" substitutes the empty string when a comment alternative matched.
  return source.replace(COMMENT_OR_STRING_RE, "$1");
}

export function computeCoverage(input: {
  clientSites: Map<string, string[]>;
  serverTestSources: string[];
  allowlist: ReadonlySet<string>;
  nonResponse: ReadonlySet<string>;
}): CoverageReport {
  const sources = input.serverTestSources.map(stripComments);
  const uncovered: CoverageReport["uncovered"] = [];
  const staleAllowlist: string[] = [];
  const names = [...input.clientSites.keys()].sort();
  for (const name of names) {
    if (input.nonResponse.has(name)) continue;
    const re = new RegExp(`\\b${escapeRe(name)}\\b`);
    const covered = sources.some((src) => re.test(src));
    if (input.allowlist.has(name)) {
      if (covered) staleAllowlist.push(name);
      continue;
    }
    if (!covered) {
      uncovered.push({
        name,
        files: [...(input.clientSites.get(name) ?? [])].sort(),
      });
    }
  }
  return { uncovered, staleAllowlist };
}
