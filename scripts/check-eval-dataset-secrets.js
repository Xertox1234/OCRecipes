#!/usr/bin/env node
/**
 * Eval Dataset Secret Leak Check
 *
 * Scans eval dataset JSON files for patterns that look like secrets or PII.
 * Dataset cases flow into LLM prompts, external API calls, and persisted
 * result JSON — a leaked API key or real email address there could end up
 * in logs, git history, or shared artifacts.
 *
 * Flagged patterns:
 *   - OpenAI-style API keys: `sk-...`
 *   - Bearer tokens in strings: `Bearer ...`
 *   - Email addresses (basic RFC-ish pattern)
 *   - North American phone numbers (simple pattern)
 *
 * Exceptions:
 *   - Lines with `// allow-secret` or `"allowSecret": true` next to them
 *     (future-proofing — current datasets don't need opt-outs)
 *   - The helper itself (`scripts/check-eval-dataset-secrets.js`)
 *
 * Usage:
 *   node scripts/check-eval-dataset-secrets.js [files...]
 *   (when run via lint-staged, staged dataset files are passed in)
 *   With no args, scans `evals/datasets/*.json`.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const colors = {
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  reset: "\x1b[0m",
  bold: "\x1b[1m",
};

/**
 * Each pattern is a [label, regex] pair. Patterns are intentionally
 * conservative — false positives here block a commit, so we prefer a
 * low-recall / high-precision matcher.
 */
const PATTERNS = [
  ["OpenAI-style API key (sk-...)", /\bsk-[A-Za-z0-9_\-]{10,}\b/g],
  ["Anthropic-style API key (sk-ant-...)", /\bsk-ant-[A-Za-z0-9_\-]{10,}\b/g],
  ["Bearer token", /\bBearer\s+[A-Za-z0-9_\-.=]{10,}\b/g],
  ["Email address", /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g],
  [
    "Phone number (NANP)",
    /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
  ],
];

function scanText(text) {
  const hits = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/allow-secret|"allowSecret"\s*:\s*true/.test(line)) continue;
    for (const [label, pattern] of PATTERNS) {
      const regex = new RegExp(pattern.source, pattern.flags);
      const matches = line.match(regex);
      if (matches) {
        for (const match of matches) {
          hits.push({ lineNumber: i + 1, label, match });
        }
      }
    }
  }
  return hits;
}

function resolveTargetFiles(args) {
  if (args.length > 0) return args;
  const datasetsDir = path.join(__dirname, "..", "evals", "datasets");
  if (!fs.existsSync(datasetsDir)) return [];
  return fs
    .readdirSync(datasetsDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(datasetsDir, f));
}

function main() {
  const args = process.argv.slice(2);
  const files = resolveTargetFiles(args).filter((f) => {
    const norm = f.replace(/\\/g, "/");
    return (
      norm.includes("evals/datasets/") && norm.toLowerCase().endsWith(".json")
    );
  });

  if (files.length === 0) {
    // Nothing to scan (e.g., lint-staged passed files but none were eval
    // datasets). Exit 0 so the commit proceeds.
    process.exit(0);
  }

  let totalHits = 0;
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    const hits = scanText(text);
    if (hits.length === 0) continue;

    totalHits += hits.length;
    console.error(
      `${colors.red}${colors.bold}✗ ${file}${colors.reset} — ${hits.length} potential secret(s) / PII match(es):`,
    );
    for (const hit of hits) {
      console.error(
        `  ${colors.yellow}line ${hit.lineNumber}${colors.reset}: ${hit.label} — ${hit.match}`,
      );
    }
  }

  if (totalHits > 0) {
    console.error("");
    console.error(
      `${colors.red}${colors.bold}Eval dataset secret check failed${colors.reset} (${totalHits} match(es)).`,
    );
    console.error(
      `Remove the secret/PII, replace with a fake placeholder, or add an \`allow-secret\` comment on the line if the match is a false positive.`,
    );
    process.exit(1);
  }

  console.log(
    `${colors.green}✓ Eval dataset secret check passed${colors.reset} (${files.length} file(s) scanned)`,
  );
}

main();
