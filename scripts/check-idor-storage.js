#!/usr/bin/env node
/**
 * IDOR Storage Function Checker
 *
 * Scans server/storage/*.ts exported functions for potential IDOR vulnerabilities:
 * functions that accept an `id`-like parameter without a corresponding `userId` parameter.
 *
 * Known-safe functions can be allowlisted below (cache operations, public data, admin-only).
 *
 * Usage:
 *   node scripts/check-idor-storage.js [files...]
 *   node scripts/check-idor-storage.js server/storage/users.ts
 *
 * When run with no arguments, scans all server/storage/*.ts files.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ESC = "\x1b[";
const colors = {
  red: ESC + "31m",
  yellow: ESC + "33m",
  green: ESC + "32m",
  cyan: ESC + "36m",
  reset: ESC + "0m",
  bold: ESC + "1m",
};

/**
 * Allowlisted function names that intentionally accept an id without userId.
 * Each entry must include a brief justification.
 */
const ALLOWLIST = new Set([
  // User self-lookup - id IS the authenticated userId (passed as req.userId)
  "getUser",
  "getUserForAuth",
  "getUserByUsernameForAuth",
  "updateUser",
  "incrementTokenVersion",
  "deleteUser",
  // Cache operations - system-level, not user-scoped data
  "incrementSuggestionCacheHit",
  "incrementInstructionCacheHit",
  "incrementMealSuggestionCacheHit",
  "getMicronutrientCache",
  "setMicronutrientCache",
  "getInstructionCache",
  "createInstructionCache",
  // Public community recipes - intentionally readable by any user
  "getCommunityRecipe",
  // API key management - admin-only, guarded by admin middleware at route level
  "revokeApiKey",
  "updateApiKeyTier",
  "getApiKey",
  "incrementUsage",
  "getUsage",
  "getUsageStats",
  // Reformulation flags - admin-only moderation workflow
  "resolveReformulationFlag",
  // Session management - uses opaque sessionId, not DB primary key
  "getAnalysisSession",
  "updateAnalysisSession",
  "clearAnalysisSession",
  "getLabelSession",
  "clearLabelSession",
  // Transaction lookup by external transactionId (string), not user-scoped PK
  "getTransaction",
  // Chat child-table ops - route verifies conversation ownership via getChatConversation(id, userId)
  "getChatMessages",
  "createChatMessage",
  // Cookbook junction ops - route verifies cookbook ownership via getCookbook(id, userId)
  "addRecipeToCookbook",
  "removeRecipeFromCookbook",
  // Grocery list item ops - scoped by groceryListId; route verifies list ownership
  "updateGroceryListItemChecked",
  "deleteGroceryListItem",
  "updateGroceryListItemPantryFlag",
  "addGroceryItemToPantryAtomically",
  // Meal plan recipe reads - route verifies ownership; TODO: add userId param for defense-in-depth
  "getMealPlanRecipe",
  "getMealPlanRecipeWithIngredients",
  // Canonical recipe operations - admin-only or public read; no user-private data exposed
  "incrementRecipePopularity", // server-side only; recipeId is not user-scoped
  "markCanonical", // admin-only; used by promotion pipeline server-side
  "markEnriched", // admin-only; used by enrichment pipeline server-side
  "getEligibleForPromotion", // admin-only promotion pipeline; no user-private data
  "getCuratedRecipes", // public read; filtered to isCanonical+isPublic
  "getCuratedRecipeById", // public read; scoped to isCanonical=true
  "getRecipeById", // server-side seed/admin utility; not user-facing
]);

// Matches the START of an exported function: export [async] function name(
const EXPORT_FN_START = /^export\s+(?:async\s+)?function\s+(\w+)\s*\(/;

// Matches id-like parameter names: id, itemId, logId, recipeId, flagId, etc.
// Must be a standalone param name (word boundary), not part of userId/ownerId/authorId
const ID_PARAM_PATTERN =
  /\b(?!user[Ii]d\b)(?!owner[Ii]d\b)(?!author[Ii]d\b)(\w*[Ii]d)\b/;

// Matches userId, ownerId, or authorId parameter names (all serve as ownership checks)
const USER_ID_PARAM_PATTERN = /\b(?:userId|ownerId|authorId)\b/;

/**
 * Extract the full parameter list for a function starting at lineIndex.
 * Handles multi-line signatures by collecting lines until the closing ")".
 */
function extractParams(lines, lineIndex) {
  let depth = 0;
  let params = "";
  for (let j = lineIndex; j < lines.length && j < lineIndex + 20; j++) {
    const line = lines[j];
    for (const ch of line) {
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) return params;
      } else if (depth > 0) {
        params += ch;
      }
    }
    if (depth > 0) params += " ";
  }
  return params;
}

/**
 * Extract only parameter NAMES from a param string, ignoring type annotations.
 * "id: number, userId: string, data: Omit<Foo, 'id'>" → ["id", "userId", "data"]
 */
function extractParamNames(params) {
  const names = [];
  let depth = 0;
  let current = "";
  for (const ch of params) {
    if (ch === "<" || ch === "{" || ch === "[") depth++;
    else if (ch === ">" || ch === "}" || ch === "]") depth--;
    else if (ch === "," && depth === 0) {
      const name = current.split(":")[0].split("?")[0].trim();
      if (name) names.push(name);
      current = "";
      continue;
    }
    if (depth === 0) current += ch;
  }
  // Last param
  const name = current.split(":")[0].split("?")[0].trim();
  if (name) names.push(name);
  return names;
}

function checkFile(filePath) {
  const ext = path.extname(filePath);
  if (ext !== ".ts") return [];

  // Skip test files, helpers, and index (re-export barrel)
  const basename = path.basename(filePath);
  if (
    basename === "index.ts" ||
    basename === "helpers.ts" ||
    filePath.includes("__tests__")
  ) {
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
    if (line.includes("// idor-safe") || line.includes("/* idor-safe")) {
      continue;
    }

    const match = line.match(EXPORT_FN_START);
    if (!match) continue;

    const fnName = match[1];

    // Skip allowlisted functions
    if (ALLOWLIST.has(fnName)) continue;

    // Collect full parameter list (may span multiple lines)
    const params = extractParams(lines, i);

    // Extract only parameter names, ignoring type annotations
    const paramNames = extractParamNames(params);
    const paramNamesStr = paramNames.join(", ");

    // Check if any param name is id-like
    const idParam = paramNames.find((p) => ID_PARAM_PATTERN.test(p));
    if (!idParam) continue;

    // Check if any param name is userId/ownerId/authorId
    const hasUserIdParam = paramNames.some((p) =>
      USER_ID_PARAM_PATTERN.test(p),
    );
    if (hasUserIdParam) continue;

    issues.push({
      file: filePath,
      line: i + 1,
      fnName,
      idParam,
      params: paramNamesStr,
    });
  }

  return issues;
}

function main() {
  const args = process.argv.slice(2);

  let files;
  if (args.length === 0) {
    // Scan all storage files when run without arguments
    const storageDir = path.resolve(__dirname, "..", "server", "storage");
    if (!fs.existsSync(storageDir)) {
      console.error(
        `${colors.red}Storage directory not found: ${storageDir}${colors.reset}`,
      );
      process.exit(1);
    }
    files = fs
      .readdirSync(storageDir)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => path.join(storageDir, f));
  } else {
    files = args.map((f) => path.resolve(f));
  }

  let allIssues = [];
  let filesChecked = 0;

  for (const filePath of files) {
    if (fs.existsSync(filePath)) {
      const issues = checkFile(filePath);
      allIssues.push(...issues);
      filesChecked++;
    }
  }

  if (allIssues.length === 0) {
    console.log(
      colors.green +
        "No IDOR-risk storage functions found in " +
        filesChecked +
        " files" +
        colors.reset,
    );
    process.exit(0);
  }

  console.log(
    colors.bold +
      "Potential IDOR-Risk Storage Functions:" +
      colors.reset +
      "\n",
  );

  for (const issue of allIssues) {
    console.log(colors.cyan + issue.file + ":" + issue.line + colors.reset);
    console.log(
      "  " +
        colors.red +
        "ERROR" +
        colors.reset +
        ": " +
        colors.yellow +
        issue.fnName +
        colors.reset +
        " accepts " +
        colors.yellow +
        issue.idParam +
        colors.reset +
        " without a userId parameter",
    );
    console.log(
      "  " +
        colors.bold +
        "Signature:" +
        colors.reset +
        " (" +
        issue.params +
        ")",
    );
    console.log(
      "  " +
        colors.bold +
        "Fix:" +
        colors.reset +
        " Add a userId parameter and include it in the WHERE clause (see docs/patterns/security.md)",
    );
    console.log(
      "  " +
        colors.bold +
        "Opt-out:" +
        colors.reset +
        " Add " +
        colors.cyan +
        "// idor-safe" +
        colors.reset +
        " comment on the function line, or add to ALLOWLIST in this script\n",
    );
  }

  console.log(colors.bold + "Summary:" + colors.reset);
  console.log("  Files checked: " + filesChecked);
  console.log("  " + colors.red + "Errors: " + allIssues.length + colors.reset);
  console.log(
    "\n" +
      colors.cyan +
      'See docs/patterns/security.md "Storage-Layer Defense-in-Depth" for the fix pattern.' +
      colors.reset,
  );

  process.exit(1);
}

main();
