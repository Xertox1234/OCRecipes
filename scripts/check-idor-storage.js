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
  // Email change - id is the user's own PK (req.userId); the route password-
  // re-authenticates before calling, and the lower(email) unique index is the
  // cross-user guard. updateUserEmail mutates the caller's own email;
  // stagePendingEmail only writes the caller's own pending_email (no constraint,
  // committed later under the same id).
  "updateUserEmail",
  "stagePendingEmail",
  "incrementTokenVersion",
  "deleteUser",
  // Email verification - id is the user's own PK taken from a verified,
  // audience-partitioned token's `sub` (not req.userId); flips email_verified
  // (and, on a staged change, swaps in the caller's own pending_email),
  // idempotent, exposes/escalates nothing.
  "applyEmailVerification",
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

// Matches the START of an exported function declaration:
//   export [async] function name[<T>](
// or an exported arrow-function const, including an explicit type annotation
// and/or type parameters:
//   export const name[: Type] = [async] [<T,>](
// The arrow branch is deliberately loose here — `= (` alone also matches
// non-function consts like `export const LIMIT = (MAX + 1);`. checkFile
// disambiguates by requiring a `=>` after the closing paren (see ARROW_TAIL).
// Residual: an arrow whose `=>` sits on a LATER line than its closing paren is
// not matched. Nested generics (`<T extends Record<string, number>>`) are also
// not matched — `[^>]*` stops at the first `>`.
const EXPORT_FN_START =
  /^export\s+(?:async\s+)?function\s+(\w+)\s*(?:<[^>]*>\s*)?\(|^export\s+const\s+(\w+)\s*(?::[^=]*)?=\s*(?:async\s*)?(?:<[^>]*>\s*)?\(/;

// Applied to whatever follows an arrow-branch match's closing ")" on the same
// line: an optional return-type annotation, then the fat arrow. Without this a
// plain parenthesised const is reported as an IDOR-risk "function", which
// trains developers to silence the guard with `// idor-safe` on a non-function.
const ARROW_TAIL = /^\s*(?::[^=]*)?=>/;

// Exports that EXPORT_FN_START matched but could not name. Unreachable while
// both branches carry a capture group; recorded so main() can fail the run
// rather than silently skipping a declaration it was unable to inspect.
// NOTE: main() ends its clean path with an explicit process.exit(0), which
// would clobber a `process.exitCode = 1` set from here — the signal has to be
// read by main() before that call.
const unnamedMatches = [];

// Matches id-like parameter names: id, itemId, logId, recipeId, flagId, etc.
// Must be a standalone param name (word boundary), not part of userId/ownerId/authorId
const ID_PARAM_PATTERN =
  /\b(?!user[Ii]d\b)(?!owner[Ii]d\b)(?!author[Ii]d\b)(\w*[Ii]d)\b/;

// Matches userId, ownerId, or authorId parameter names (all serve as ownership checks)
const USER_ID_PARAM_PATTERN = /\b(?:userId|ownerId|authorId)\b/;

/**
 * Extract the full parameter list for a function starting at lineIndex.
 * Handles multi-line signatures by collecting lines until the closing ")".
 *
 * Returns `{ params, rest }` where `rest` is the remainder of the line that
 * held the closing ")" — the caller needs it to tell an arrow function
 * (`) => {`) from a parenthesised expression (`);`).
 */
function extractParams(lines, lineIndex) {
  let depth = 0;
  let params = "";
  for (let j = lineIndex; j < lines.length && j < lineIndex + 20; j++) {
    const line = lines[j];
    for (let k = 0; k < line.length; k++) {
      const ch = line[k];
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) return { params, rest: line.slice(k + 1) };
      } else if (depth > 0) {
        params += ch;
      }
    }
    if (depth > 0) params += " ";
  }
  return { params, rest: "" };
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

    // match[1] = `export function name(` capture; match[2] = the arrow-const
    // capture (`export const name = ...(`). Given the current two-branch
    // EXPORT_FN_START exactly one is always set, so this branch is unreachable
    // today. It is NOT a safe default: skipping a matched-but-unnamed export
    // would fail OPEN for a detector — a silently missed IDOR. So a future
    // third branch that forgets to add its capture here fails the run loudly
    // instead of going quiet.
    const fnName = match[1] || match[2];
    if (!fnName) {
      console.error(
        `${colors.red}${filePath}:${i + 1}: matched an exported declaration but captured no name — EXPORT_FN_START has a branch with no capture group.${colors.reset}`,
      );
      unnamedMatches.push({ file: filePath, line: i + 1 });
      continue;
    }

    // Skip allowlisted functions
    if (ALLOWLIST.has(fnName)) continue;

    // Collect full parameter list (may span multiple lines)
    const { params, rest } = extractParams(lines, i);

    // The arrow branch of EXPORT_FN_START matches on `= (`, which also fires on
    // a parenthesised non-function const (`export const LIMIT = (MAX_id + 1);`).
    // Require a real `=>` after the closing paren before treating it as a
    // function. Only the arrow branch needs this — `export function name(` is
    // unambiguous, and demanding `=>` there would silence the whole guard.
    if (match[2] && !ARROW_TAIL.test(rest)) continue;

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

  // An export the matcher could not name was never inspected — that is a hole
  // in the scan, not a clean result. Fail before any success path.
  if (unnamedMatches.length > 0) {
    console.error(
      colors.red +
        "Aborting: " +
        unnamedMatches.length +
        " exported declaration(s) matched but could not be named — the scan is incomplete." +
        colors.reset,
    );
    process.exit(1);
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
