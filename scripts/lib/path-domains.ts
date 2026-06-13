#!/usr/bin/env tsx
// Single source of truth for the file-path -> domain mapping.
//
// Four artifacts derive from this module so they can never drift apart:
//   1. scripts/build-copilot-instructions.ts  -> .github/copilot-instructions.md
//   2. scripts/build-domain-map.ts            -> .claude/hooks/lib/domain-map.sh
//   3. .claude/skills/codify/SKILL.md  Step 1 (via the CLI below, --routing)
//   4. .claude/skills/spec-review/SKILL.md Step 3 (via the CLI below)
//
// Each rule's matcher is a structured descriptor that compiles three ways:
// an anchored RegExp (for TS matching), a bash [[ glob ]] condition pair (for
// the generated shell), and a human description (for the Copilot doc table).

/** A rules-domain has a docs/rules/<domain>.md file and is binding for matching files. */
export type RulesDomain =
  | "accessibility"
  | "ai-prompting"
  | "api"
  | "architecture"
  | "client-state"
  | "database"
  | "design-system"
  | "hooks"
  | "performance"
  | "react-native"
  | "security"
  | "testing"
  | "typescript";

/** Routing-only labels have NO rules file; they only steer codify agent selection. */
export type RoutingOnlyLabel = "camera";

/** Anything codify Step 1 can emit. */
export type RoutingLabel = RulesDomain | RoutingOnlyLabel;

/**
 * Matcher descriptor vocabulary. Each variant compiles to a RegExp
 * (compileToRegExp), a bash [[ glob ]] condition list (compileToBashConditions),
 * and is described by the rule's `description` field.
 */
export type Matcher =
  // Any descendant of a directory: matches `dir/a.ts` and `dir/sub/b.ts`.
  | { readonly kind: "recursive-dir"; readonly dir: string }
  // A specific file at a specific repo-relative path.
  | { readonly kind: "exact-file"; readonly path: string }
  // A basename-prefix within a single directory (e.g. client/screens/Scan*).
  | {
      readonly kind: "file-prefix";
      readonly dir: string;
      readonly prefix: string;
    }
  // Test files anywhere: __tests__/ dir OR *.test.ts(x) OR *.spec.ts(x).
  | { readonly kind: "test-file" }
  // Config files by basename glob at repo root (vitest.config.*, eslint.config.*).
  | { readonly kind: "config-file"; readonly basenames: readonly string[] };

export interface PathDomainRule {
  readonly match: Matcher;
  readonly domains: readonly RulesDomain[];
  /** routing-only labels added on top of `domains` for codify Step 1. */
  readonly routingLabels?: readonly RoutingOnlyLabel[];
  /** Human-readable description rendered into the Copilot doc table. */
  readonly description: string;
}

/** The 13 rules-domains, each with a docs/rules/<domain>.md file. */
export const RULES_DOMAINS = [
  "accessibility",
  "ai-prompting",
  "api",
  "architecture",
  "client-state",
  "database",
  "design-system",
  "hooks",
  "performance",
  "react-native",
  "security",
  "testing",
  "typescript",
] as const satisfies readonly RulesDomain[];

// 18 LLM-touching service basenames (under server/services/) that import an LLM
// client. Empirically derived via:
//   grep -l "openai\|OpenAI\|gpt-\|completions\|anthropic" server/services/*.ts | grep -v __tests__
// A drift-detection test (scripts/lib/__tests__/path-domains.test.ts) re-runs
// the grep and fails if a new LLM-touching service is added without being listed.
export const LLM_TOUCHING_SERVICES: ReadonlySet<string> = new Set([
  "canonical-enrichment.ts",
  "coach-pro-chat.ts",
  "coach-tools.ts",
  "cooking-session.ts",
  "food-nlp.ts",
  "front-label-analysis.ts",
  "ingredient-substitution.ts",
  "meal-suggestions.ts",
  "menu-analysis.ts",
  "notebook-extraction.ts",
  "nutrition-coach.ts",
  "pantry-meal-plan.ts",
  "photo-analysis.ts",
  "receipt-analysis.ts",
  "recipe-chat.ts",
  "recipe-generation.ts",
  "suggestion-generation.ts",
  "voice-transcription.ts",
]);

// The reconciled superset rule table. Order is preserved for deterministic doc
// rendering. `domains` are rules-domains (rendered into the doc + shell);
// `routingLabels` (e.g. camera) surface only via routingLabelsForPath.
export const PATH_TO_DOMAINS: readonly PathDomainRule[] = [
  {
    match: { kind: "recursive-dir", dir: "server/routes" },
    domains: ["api", "security", "architecture"],
    description: "`server/routes/**` (non-auth blocked separately)",
  },
  {
    match: { kind: "recursive-dir", dir: "server/storage" },
    domains: ["database", "security", "architecture"],
    description: "`server/storage/**` (non-auth blocked separately)",
  },
  {
    match: { kind: "exact-file", path: "shared/schema.ts" },
    domains: ["database", "security", "architecture"],
    description: "`shared/schema.ts`",
  },
  {
    match: { kind: "recursive-dir", dir: "migrations" },
    domains: ["database", "security", "architecture"],
    description: "`migrations/**`",
  },
  {
    match: { kind: "recursive-dir", dir: "server/middleware" },
    domains: ["security", "api"],
    description: "`server/middleware/**`",
  },
  {
    match: { kind: "recursive-dir", dir: "server/services" },
    domains: ["architecture"],
    description: "`server/services/**` (base — architecture only)",
  },
  {
    match: { kind: "recursive-dir", dir: "client/screens" },
    domains: ["react-native", "design-system", "accessibility"],
    description: "`client/screens/**`",
  },
  {
    match: { kind: "file-prefix", dir: "client/screens", prefix: "Scan" },
    // Routing-only: the parent `client/screens/**` rule already supplies the
    // rules-domains. Empty domains keeps this row out of the generated doc/shell;
    // it contributes only the `camera` routing label (via routingLabelsForPath).
    domains: [],
    routingLabels: ["camera"],
    description: "`client/screens/Scan*`",
  },
  {
    match: { kind: "recursive-dir", dir: "client/components" },
    domains: ["react-native", "design-system", "accessibility", "performance"],
    description: "`client/components/**`",
  },
  {
    match: { kind: "recursive-dir", dir: "client/components/camera" },
    // Routing-only: parent `client/components/**` supplies the rules-domains.
    domains: [],
    routingLabels: ["camera"],
    description: "`client/components/camera/**`",
  },
  {
    match: { kind: "recursive-dir", dir: "client/navigation" },
    domains: ["react-native", "accessibility"],
    description: "`client/navigation/**`",
  },
  {
    // D6: union of all sources — keeps the shell's react-native + accessibility.
    match: { kind: "recursive-dir", dir: "client/hooks" },
    domains: ["hooks", "client-state", "react-native", "accessibility"],
    description: "`client/hooks/**`",
  },
  {
    match: { kind: "recursive-dir", dir: "client/context" },
    domains: ["client-state"],
    description: "`client/context/**`",
  },
  {
    match: { kind: "recursive-dir", dir: "client/lib" },
    domains: ["typescript", "client-state"],
    description: "`client/lib/**`",
  },
  {
    match: { kind: "exact-file", path: "client/constants/theme.ts" },
    domains: ["design-system"],
    description: "`client/constants/theme.ts`",
  },
  {
    match: { kind: "exact-file", path: "design_guidelines.md" },
    domains: ["design-system"],
    description: "`design_guidelines.md`",
  },
  {
    match: { kind: "recursive-dir", dir: "evals" },
    domains: ["ai-prompting", "testing"],
    description: "`evals/**`",
  },
  {
    match: { kind: "test-file" },
    domains: ["testing"],
    description: "`__tests__/**`, `*.test.ts(x)`, `*.spec.ts(x)`",
  },
  {
    match: { kind: "recursive-dir", dir: ".github/workflows" },
    domains: ["architecture", "testing"],
    description: "`.github/workflows/**`",
  },
  {
    match: {
      kind: "config-file",
      basenames: ["vitest.config", "eslint.config"],
    },
    domains: ["testing", "typescript"],
    description: "`vitest.config.*`, `eslint.config.*`",
  },
];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// recursive-dir rules whose historical TS form was an anchored direct-child
// pattern (`^server/routes/[^/]+\.ts$`). They must keep EXCLUDING __tests__
// subdirectory files in TS so a test file under them maps to ["testing"] only.
// The generated shell does NOT exclude (it already matched descendants) — this
// asymmetry is intentional and pinned by the parity test.
const TS_TEST_EXCLUDING_DIRS: ReadonlySet<string> = new Set([
  "server/routes",
  "server/storage",
]);

/** Compile a matcher to the RegExp used for TS path matching. */
export function compileToRegExp(m: Matcher): RegExp {
  switch (m.kind) {
    case "recursive-dir": {
      const dir = escapeRe(m.dir);
      if (TS_TEST_EXCLUDING_DIRS.has(m.dir)) {
        // Match the dir prefix, but not when a __tests__/ segment follows.
        return new RegExp(`(^|/)${dir}/(?!.*__tests__/)`);
      }
      return new RegExp(`(^|/)${dir}/`);
    }
    case "exact-file":
      return new RegExp(`(^|/)${escapeRe(m.path)}$`);
    case "file-prefix":
      return new RegExp(`(^|/)${escapeRe(m.dir)}/${escapeRe(m.prefix)}[^/]*$`);
    case "test-file":
      return /\/__tests__\/|\.test\.tsx?$|\.spec\.tsx?$/;
    case "config-file":
      return new RegExp(
        `^(${m.basenames.map((b) => `${escapeRe(b)}\\.[^/]+`).join("|")})$`,
      );
  }
}

// Compile a matcher to the bash `[[ "$f" == GLOB ]]` condition strings used by
// the generated domain-map.sh. Two forms per matcher — an absolute glob (leading
// wildcard + slash) and a relative glob — so callers with either path form match
// without normalising first. (Line comments here on purpose: a literal `*` `/`
// pair inside a block comment would close it prematurely.)
export function compileToBashConditions(m: Matcher): string[] {
  switch (m.kind) {
    case "recursive-dir":
      return [`*/${m.dir}/*`, `${m.dir}/*`];
    case "exact-file":
      return [`*/${m.path}`, m.path];
    case "file-prefix":
      return [`*/${m.dir}/${m.prefix}*`, `${m.dir}/${m.prefix}*`];
    case "test-file":
      return [
        "*/__tests__/*",
        "__tests__/*",
        "*.test.ts",
        "*.test.tsx",
        "*.spec.ts",
        "*.spec.tsx",
      ];
    case "config-file":
      return m.basenames.flatMap((b) => [`*/${b}.*`, `${b}.*`]);
  }
}

/**
 * Rules-domains for a path: the union of `rule.domains` across matching rules,
 * plus the ai-prompting special case for LLM-touching services. NEVER includes
 * routing-only labels (camera). Consumed by the Copilot doc, the generated
 * shell, and spec-review.
 */
export function rulesDomainsForPath(filePath: string): RulesDomain[] {
  const matched = new Set<RulesDomain>();
  for (const rule of PATH_TO_DOMAINS) {
    if (compileToRegExp(rule.match).test(filePath)) {
      for (const d of rule.domains) matched.add(d);
    }
  }
  if (filePath.startsWith("server/services/")) {
    const basename = filePath.slice("server/services/".length);
    if (!basename.includes("/") && LLM_TOUCHING_SERVICES.has(basename)) {
      matched.add("ai-prompting");
    }
  }
  return [...matched];
}

/**
 * Routing labels for a path: rules-domains PLUS any routing-only labels (camera)
 * from matching rules. Consumed by codify Step 1 for specialist-agent routing.
 */
export function routingLabelsForPath(filePath: string): RoutingLabel[] {
  const matched = new Set<RoutingLabel>(rulesDomainsForPath(filePath));
  for (const rule of PATH_TO_DOMAINS) {
    if (!rule.routingLabels) continue;
    if (compileToRegExp(rule.match).test(filePath)) {
      for (const r of rule.routingLabels) matched.add(r);
    }
  }
  return [...matched];
}

/**
 * CLI: print the sorted, comma-joined union of domains across the given file
 * paths. `--routing` switches from rules-domains to routing labels (adds camera).
 * Consumed by .claude/skills/codify (--routing) and spec-review (no flag).
 * `write` is injectable for testing; defaults to stdout.
 */
export function runCli(
  argv: readonly string[],
  write: (s: string) => void = (s) => process.stdout.write(s),
): number {
  const routing = argv.includes("--routing");
  const files = argv.filter((a) => !a.startsWith("--"));
  const union = new Set<string>();
  for (const f of files) {
    const labels = routing ? routingLabelsForPath(f) : rulesDomainsForPath(f);
    for (const l of labels) union.add(l);
  }
  const sorted = [...union].sort();
  if (sorted.length > 0) write(sorted.join(", "));
  return 0;
}

// Direct-invocation guard (matches the repo idiom in build-copilot-instructions.ts).
if (process.argv[1]?.endsWith("path-domains.ts")) {
  process.exitCode = runCli(process.argv.slice(2));
}
