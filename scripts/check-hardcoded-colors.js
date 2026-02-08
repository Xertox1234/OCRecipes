#!/usr/bin/env node
/**
 * Hardcoded Color Checker
 *
 * Checks React Native .tsx files for hardcoded black/white hex colors
 * that should use theme values instead.
 *
 * Flagged patterns:
 *   #FFFFFF / #ffffff / #FFF / #fff
 *   #000000 / #000
 *
 * Exceptions (won't flag):
 *   - Files in __tests__/
 *   - Lines with "// hardcoded" comment (opt-out for intentional cases)
 *
 * Usage:
 *   node scripts/check-hardcoded-colors.js [files...]
 *   node scripts/check-hardcoded-colors.js client/screens/ScanScreen.tsx
 */

import fs from "fs";
import path from "path";

const colors = {
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  reset: "\x1b[0m",
  bold: "\x1b[1m",
};

const skipPatterns = [
  "node_modules",
  "__tests__",
  ".test.",
  ".spec.",
  "dist",
  "build",
];

function shouldSkipFile(filePath) {
  return skipPatterns.some((pattern) => filePath.includes(pattern));
}

// Matches #FFFFFF, #ffffff, #FFF, #fff, #000000, #000
// Word boundary before # prevents matching inside longer hex codes
const COLOR_PATTERN = /(?:#(?:FFFFFF|ffffff|FFF|fff|000000|000))(?!\w)/g;

function checkFile(filePath) {
  if (shouldSkipFile(filePath)) {
    return [];
  }

  const ext = path.extname(filePath);
  if (ext !== ".tsx") {
    return [];
  }

  let content;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    console.error(
      `${colors.red}Error reading ${filePath}:${colors.reset}`,
      err.message,
    );
    return [];
  }

  const lines = content.split("\n");
  const issues = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip lines with opt-out comment
    if (line.includes("// hardcoded")) {
      continue;
    }

    // Skip comment-only lines
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) {
      continue;
    }

    const matches = line.match(COLOR_PATTERN);
    if (matches) {
      for (const match of matches) {
        issues.push({
          file: filePath,
          line: i + 1,
          color: match,
          context:
            trimmed.substring(0, 80) + (trimmed.length > 80 ? "..." : ""),
        });
      }
    }
  }

  return issues;
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(
      `${colors.yellow}Usage: node scripts/check-hardcoded-colors.js <files...>${colors.reset}`,
    );
    process.exit(0);
  }

  let allIssues = [];
  let filesChecked = 0;

  for (const file of args) {
    const filePath = path.resolve(file);
    if (fs.existsSync(filePath)) {
      const issues = checkFile(filePath);
      allIssues.push(...issues);
      filesChecked++;
    }
  }

  if (allIssues.length === 0) {
    console.log(
      `${colors.green}✓ No hardcoded colors found in ${filesChecked} files${colors.reset}`,
    );
    process.exit(0);
  }

  console.log(`${colors.bold}Hardcoded Colors Found:${colors.reset}\n`);

  for (const issue of allIssues) {
    console.log(`${colors.cyan}${issue.file}:${issue.line}${colors.reset}`);
    console.log(
      `  ${colors.red}ERROR${colors.reset}: Found hardcoded color ${colors.yellow}${issue.color}${colors.reset}`,
    );
    console.log(
      `  ${colors.bold}Suggestion:${colors.reset} Use theme value instead (e.g., theme.background, theme.text, theme.buttonText)`,
    );
    console.log(`  ${colors.yellow}Context:${colors.reset} ${issue.context}`);
    console.log(
      `  ${colors.bold}Opt-out:${colors.reset} Add ${colors.cyan}// hardcoded${colors.reset} comment to the line if intentional\n`,
    );
  }

  console.log(`${colors.bold}Summary:${colors.reset}`);
  console.log(`  Files checked: ${filesChecked}`);
  console.log(`  ${colors.red}Errors: ${allIssues.length}${colors.reset}`);
  console.log(
    `\n${colors.cyan}Use theme values from client/constants/theme.ts instead of hardcoded colors.${colors.reset}`,
  );
  console.log(
    `${colors.cyan}If intentional, add "// hardcoded" comment to the line.${colors.reset}`,
  );

  process.exit(1);
}

main();
