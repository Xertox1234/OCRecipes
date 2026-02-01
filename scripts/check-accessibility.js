#!/usr/bin/env node
/**
 * Accessibility Pattern Checker
 *
 * Checks React Native files for common accessibility anti-patterns.
 * Run as part of pre-commit to catch accessibility issues early.
 *
 * Patterns checked:
 * 1. Pressable/TouchableOpacity with onPress but missing accessibilityLabel
 * 2. TextInput without accessibilityLabel
 *
 * Usage:
 *   node scripts/check-accessibility.js [files...]
 *   node scripts/check-accessibility.js client/screens/ScanScreen.tsx
 */

const fs = require("fs");
const path = require("path");

// ANSI color codes
const colors = {
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  reset: "\x1b[0m",
  bold: "\x1b[1m",
};

// Files/directories to skip
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

/**
 * Extract complete JSX elements from content, handling multi-line elements
 */
function extractJsxElements(content, tagName) {
  const elements = [];
  const regex = new RegExp(`<${tagName}\\s`, "g");
  let match;

  while ((match = regex.exec(content)) !== null) {
    const startIndex = match.index;
    let depth = 1;
    let i = startIndex + match[0].length;
    let inString = false;
    let stringChar = null;

    // Find the end of the opening tag or self-closing tag
    while (i < content.length && depth > 0) {
      const char = content[i];

      if (inString) {
        if (char === stringChar && content[i - 1] !== "\\") {
          inString = false;
        }
      } else {
        if (char === '"' || char === "'" || char === "`") {
          inString = true;
          stringChar = char;
        } else if (char === ">" && content[i - 1] !== "=") {
          depth--;
        } else if (char === "{") {
          // Skip JSX expressions
          let braceDepth = 1;
          i++;
          while (i < content.length && braceDepth > 0) {
            if (content[i] === "{") braceDepth++;
            else if (content[i] === "}") braceDepth--;
            i++;
          }
          continue;
        }
      }
      i++;
    }

    const elementText = content.substring(startIndex, i);
    const lineNumber = content.substring(0, startIndex).split("\n").length;

    elements.push({
      text: elementText,
      startIndex,
      endIndex: i,
      lineNumber,
    });
  }

  return elements;
}

/**
 * Check if an element has a specific prop
 */
function hasProps(elementText, props) {
  return props.every((prop) => {
    // Handle various prop formats: prop="value", prop={value}, prop
    const regex = new RegExp(`\\b${prop}(?:=|\\s|>|$|\\/)`, "i");
    return regex.test(elementText);
  });
}

function checkFile(filePath) {
  if (shouldSkipFile(filePath)) {
    return [];
  }

  const ext = path.extname(filePath);
  if (![".tsx", ".jsx"].includes(ext)) {
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

  const issues = [];

  // Check Pressable elements
  const pressables = extractJsxElements(content, "Pressable");
  for (const element of pressables) {
    // Only check if it has onPress (interactive)
    if (element.text.includes("onPress")) {
      // Check for accessibilityLabel
      if (!hasProps(element.text, ["accessibilityLabel"])) {
        issues.push({
          file: filePath,
          line: element.lineNumber,
          severity: "error",
          message:
            "Pressable with onPress should have accessibilityLabel for screen readers",
          suggestion:
            'Add accessibilityLabel="description" and accessibilityRole="button"',
          context:
            element.text.split("\n")[0].trim().substring(0, 60) +
            (element.text.length > 60 ? "..." : ""),
        });
      }
    }
  }

  // Check TouchableOpacity elements
  const touchables = extractJsxElements(content, "TouchableOpacity");
  for (const element of touchables) {
    if (element.text.includes("onPress")) {
      if (!hasProps(element.text, ["accessibilityLabel"])) {
        issues.push({
          file: filePath,
          line: element.lineNumber,
          severity: "error",
          message:
            "TouchableOpacity with onPress should have accessibilityLabel",
          suggestion:
            'Add accessibilityLabel="description" and accessibilityRole="button"',
          context:
            element.text.split("\n")[0].trim().substring(0, 60) +
            (element.text.length > 60 ? "..." : ""),
        });
      }
    }
  }

  // Check TextInput elements
  const inputs = extractJsxElements(content, "TextInput");
  for (const element of inputs) {
    if (!hasProps(element.text, ["accessibilityLabel"])) {
      issues.push({
        file: filePath,
        line: element.lineNumber,
        severity: "warning",
        message: "TextInput should have accessibilityLabel for screen readers",
        suggestion: 'Add accessibilityLabel="field description"',
        context:
          element.text.split("\n")[0].trim().substring(0, 60) +
          (element.text.length > 60 ? "..." : ""),
      });
    }
  }

  return issues;
}

function formatIssue(issue) {
  const severityColor = issue.severity === "error" ? colors.red : colors.yellow;
  const severityLabel = issue.severity.toUpperCase();

  return `
${colors.cyan}${issue.file}:${issue.line}${colors.reset}
  ${severityColor}${severityLabel}${colors.reset}: ${issue.message}
  ${colors.bold}Suggestion:${colors.reset} ${issue.suggestion}
  ${colors.yellow}Context:${colors.reset} ${issue.context}
`;
}

function findTsxFiles(dir) {
  const files = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && !shouldSkipFile(fullPath)) {
        files.push(...findTsxFiles(fullPath));
      } else if (entry.isFile() && entry.name.endsWith(".tsx")) {
        files.push(fullPath);
      }
    }
  } catch (err) {
    // Directory doesn't exist or can't be read
  }
  return files;
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(
      `${colors.yellow}Usage: node scripts/check-accessibility.js <files...>${colors.reset}`,
    );
    console.log("No files provided, checking all client/**/*.tsx files...\n");

    const clientDir = path.join(__dirname, "..", "client");
    args.push(...findTsxFiles(clientDir));
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

  // Summary
  const errors = allIssues.filter((i) => i.severity === "error");
  const warnings = allIssues.filter((i) => i.severity === "warning");

  if (allIssues.length === 0) {
    console.log(
      `${colors.green}✓ No accessibility issues found in ${filesChecked} files${colors.reset}`,
    );
    process.exit(0);
  }

  console.log(`${colors.bold}Accessibility Issues Found:${colors.reset}\n`);

  for (const issue of allIssues) {
    console.log(formatIssue(issue));
  }

  console.log(`\n${colors.bold}Summary:${colors.reset}`);
  console.log(`  Files checked: ${filesChecked}`);
  if (errors.length > 0) {
    console.log(`  ${colors.red}Errors: ${errors.length}${colors.reset}`);
  }
  if (warnings.length > 0) {
    console.log(
      `  ${colors.yellow}Warnings: ${warnings.length}${colors.reset}`,
    );
  }

  console.log(
    `\n${colors.cyan}See docs/PATTERNS.md for accessibility pattern guidelines${colors.reset}`,
  );

  // Exit with error if there are errors (not warnings)
  if (errors.length > 0) {
    process.exit(1);
  }

  process.exit(0);
}

main();
