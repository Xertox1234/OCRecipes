#!/usr/bin/env tsx
import * as fs from "fs";
import * as path from "path";
import {
  PATH_TO_DOMAINS,
  LLM_TOUCHING_SERVICES,
  compileToBashConditions,
} from "./lib/path-domains";

// Generates .claude/hooks/lib/domain-map.sh from the shared rule table so the
// hot-path shell (sourced by inject-patterns.sh on every Edit/Write) can never
// drift from the TS source. The generated file is still a static .sh — there is
// NO tsx at hook runtime. Run via:
//   npm run build:domain-map        (write)
//   npm run build:domain-map:check  (CI staleness check)
//
// Only rules-domains (rule.domains) are emitted. Routing-only labels such as
// `camera` are intentionally omitted — they steer codify agent selection, not
// rule injection, and have no docs/rules/<domain>.md file.

function bashLine(
  conds: readonly string[],
  domains: readonly string[],
): string {
  const test = conds.map((c) => `"$f" == ${c}`).join(" || ");
  const adds = domains.map((d) => `_add ${d};`).join(" ");
  return `  [[ ${test} ]] && { ${adds} }`;
}

export function generateDomainMap(): string {
  const header = `#!/usr/bin/env bash
# GENERATED FILE — do not edit by hand.
# Regenerate with: npm run build:domain-map
# Source of truth: scripts/lib/path-domains.ts (rules-domains only; routing-only
# labels such as 'camera' are intentionally NOT emitted here).
#
# Shared path-to-domain mapping, currently consumed by inject-patterns.sh.
# Source this file — do NOT execute directly. (Consumer-agnostic: define your
# own _add() adapter before sourcing, so additional consumers can reuse it.)
#
# USAGE:
#   Define _add() as an adapter for your accumulator before sourcing, then call
#   apply_domain_map for each file path.
#
# DESIGN NOTES:
#   - Uses independent [[...]] blocks so multiple domains can match one file.
#   - Matches both absolute (leading wildcard) and relative paths so callers
#     that have either form don't need to normalise first.
#   - Typescript handling is intentionally EXCLUDED as a blanket .ts policy; each
#     consumer applies its own (inject-patterns adds typescript only when no
#     other domain matched). Per-rule typescript (config files, client/lib) is
#     part of the canonical mapping and IS emitted below.
`;

  const body: string[] = ["apply_domain_map() {", '  local f="$1"', ""];
  for (const rule of PATH_TO_DOMAINS) {
    // Skip routing-only rules (empty domains, e.g. the camera label) — they
    // would emit a duplicate `_add` block identical to their parent rule.
    if (rule.domains.length === 0) continue;
    body.push(bashLine(compileToBashConditions(rule.match), rule.domains));
  }
  // LLM-touching services -> ai-prompting (explicit Set, both path forms).
  const llmConds = [...LLM_TOUCHING_SERVICES].flatMap((s) => [
    `*/server/services/${s}`,
    `server/services/${s}`,
  ]);
  body.push(bashLine(llmConds, ["ai-prompting"]));
  body.push("}", "");

  return `${header}\n${body.join("\n")}`;
}

export function runDomainMapCli(argv: readonly string[]): number {
  const args = [...argv];
  const checkMode = args.includes("--check");
  if (checkMode) args.splice(args.indexOf("--check"), 1);

  const target = args[0];
  if (!target) {
    console.error("Usage: build-domain-map [--check] <target-path>");
    return 2;
  }

  const generated = generateDomainMap();

  if (checkMode) {
    if (!fs.existsSync(target)) {
      console.error(
        `[--check] ${target} does not exist. Run 'npm run build:domain-map' to generate it.`,
      );
      return 1;
    }
    const current = fs.readFileSync(target, "utf8");
    if (current !== generated) {
      console.error(
        `[--check] ${target} is stale. Run 'npm run build:domain-map' to update.`,
      );
      return 1;
    }
    console.log(`[--check] ${target} matches generated content.`);
    return 0;
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, generated);
  console.log(`Wrote ${target} (${generated.length} bytes)`);
  return 0;
}

if (process.argv[1]?.endsWith("build-domain-map.ts")) {
  process.exit(runDomainMapCli(process.argv.slice(2)));
}
