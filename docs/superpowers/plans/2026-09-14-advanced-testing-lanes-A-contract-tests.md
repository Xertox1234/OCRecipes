# Lane A — Provider-side Contract Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every response schema the client parses with is asserted against the real route output in a server test, and a meta-test forces that to stay true for any schema added later.

**Architecture:** One helper (`expectResponseToMatch`) called inside the existing supertest route tests on their success paths; one pure coverage function (`scripts/lib/contract-coverage.ts`) exercised by a guard test that (a) proves it can fail on synthetic input and (b) walks the repo with an allowlist ratchet that must end empty.

**Tech Stack:** Vitest 4, Zod 3, supertest, existing typed mock factories in `server/__tests__/factories/`.

**Spec:** `docs/superpowers/specs/2026-09-14-advanced-testing-lanes-design.md` §Lane A. Shared constraints: `docs/superpowers/plans/2026-09-14-advanced-testing-lanes-00-index.md` §Global Constraints.

## Global Constraints

- Deterministic lane: all files are `*.test.ts` discovered by the base Vitest config; no workflow changes.
- Plain `schema.safeParse` strictness — extra server fields are not a contract break; missing or mistyped ones are.
- `CONTRACT_ALLOWLIST` is a ratchet: it lands with the nine current names (eight from planning plus `mealPlanCardSchema`, found by the A0 final review on 2026-09-15 once the extractor learned sub-schema parses) and must be empty at the end of Task 7. A stale entry (name that has become covered) fails the guard.
- Serialize Task 7's `package.json` edit with Lane D Task 1 (both touch `package.json`).
- Commit messages: no backticks in `-m`; end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. In a `/todo` worktree use `/usr/bin/git`.
- **STOP after each completed task** (green + committed + reviewed): report and end the turn so the user can compact. See index §Execution protocol.

## File structure

| File                                                  | Responsibility                                                                                                            |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `test/utils/expect-response-schema.ts`                | `expectResponseToMatch(body, schema)` — safeParse + readable path-level failure                                           |
| `test/utils/__tests__/expect-response-schema.test.ts` | its floor-rule test (invalid body → path in message)                                                                      |
| `scripts/lib/contract-coverage.ts`                    | pure functions: extract parse-site names from client source; compute uncovered + stale-allowlist                          |
| `scripts/__tests__/contract-coverage-guard.test.ts`   | (1) synthetic positive control for the pure functions; (2) repo walk with `CONTRACT_ALLOWLIST` and `NON_RESPONSE_SCHEMAS` |
| `shared/schemas/receipt.ts`                           | receipt wire schemas relocated from `client/hooks/useReceiptScan.ts`                                                      |
| existing route/service tests (7 files)                | one `expectResponseToMatch` per anchor success path                                                                       |

---

### Task 1: `expectResponseToMatch` helper

**Files:**

- Create: `test/utils/expect-response-schema.ts`
- Test: `test/utils/__tests__/expect-response-schema.test.ts`

**Interfaces:**

- Produces: `expectResponseToMatch<T extends z.ZodTypeAny>(body: unknown, schema: T): z.infer<T>` — returns the parsed data on success; throws `Error` whose message begins `Response body does not match schema` and lists one `  <path>: <message>` line per Zod issue, where a path renders as `items[0].calories` (root-level issues render as `(root)`).

- [x] **Step 1: Write the failing test**

```ts
// test/utils/__tests__/expect-response-schema.test.ts
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { expectResponseToMatch } from "../expect-response-schema";

const schema = z.object({
  items: z.array(z.object({ calories: z.number() })),
  total: z.number(),
});

describe("expectResponseToMatch", () => {
  it("returns the parsed data when the body matches", () => {
    const body = { items: [{ calories: 10 }], total: 1 };
    expect(expectResponseToMatch(body, schema)).toEqual(body);
  });

  // Floor rule: the helper must be observed red on a bad body, and the
  // failure must name the exact path so a contract break reads like one.
  it("throws naming the path of a mistyped nested field", () => {
    const body = { items: [{ calories: "10" }], total: 1 };
    expect(() => expectResponseToMatch(body, schema)).toThrowError(
      /Response body does not match schema[\s\S]*items\[0\]\.calories: /,
    );
  });

  it("throws naming a missing required top-level field", () => {
    const body = { items: [] };
    expect(() => expectResponseToMatch(body, schema)).toThrowError(/total: /);
  });

  it("renders root-level issues as (root)", () => {
    expect(() => expectResponseToMatch("not an object", schema)).toThrowError(
      /\(root\): /,
    );
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/utils/__tests__/expect-response-schema.test.ts`
Expected: FAIL — `Cannot find module '../expect-response-schema'`

- [x] **Step 3: Write the helper**

```ts
// test/utils/expect-response-schema.ts
/**
 * Provider-side contract assertion: the body a route actually produced must
 * satisfy the Zod schema the client parses it with. Plain `safeParse` is the
 * right strictness — extra server fields are not a drift risk for the client;
 * missing or mistyped ones are.
 *
 * Coverage of this helper is enforced by
 * scripts/__tests__/contract-coverage-guard.test.ts: every
 * `<name>Schema.safeParse(` / `.parse(` site under client/ needs a server test
 * that references the same schema name.
 */
import type { z } from "zod";

function formatPath(path: ReadonlyArray<string | number>): string {
  if (path.length === 0) return "(root)";
  return path.reduce<string>((acc, seg) => {
    if (typeof seg === "number") return `${acc}[${seg}]`;
    return acc === "" ? seg : `${acc}.${seg}`;
  }, "");
}

export function expectResponseToMatch<T extends z.ZodTypeAny>(
  body: unknown,
  schema: T,
): z.infer<T> {
  const result = schema.safeParse(body);
  if (result.success) return result.data as z.infer<T>;
  const lines = result.error.issues.map(
    (issue) => `  ${formatPath(issue.path)}: ${issue.message}`,
  );
  throw new Error(`Response body does not match schema:\n${lines.join("\n")}`);
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/utils/__tests__/expect-response-schema.test.ts`
Expected: PASS (4 tests)

- [x] **Step 5: Commit**

```bash
git add test/utils/expect-response-schema.ts test/utils/__tests__/expect-response-schema.test.ts
git commit -m "test(contract): add expectResponseToMatch helper with path-level failures

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Contract coverage guard (pure function + repo walk, allowlisted)

**Files:**

- Create: `scripts/lib/contract-coverage.ts`
- Test: `scripts/__tests__/contract-coverage-guard.test.ts`

**Interfaces:**

- Produces (from `scripts/lib/contract-coverage.ts`):
  - `extractParsedSchemaNames(source: string): string[]` — unique, sorted names matching `/\b([A-Za-z0-9_]*Schema)\.(?:safeParse|parse)\(/g`.
  - `computeCoverage(input: { clientSites: Map<string, string[]>; serverTestSources: string[]; allowlist: ReadonlySet<string>; nonResponse: ReadonlySet<string> }): CoverageReport` where `CoverageReport = { uncovered: Array<{ name: string; files: string[] }>; staleAllowlist: string[] }`. A name is covered when any server test source contains it as a whole word. Names in `nonResponse` are ignored. Names in `allowlist` are exempt from `uncovered` but are reported in `staleAllowlist` when they are covered.
- Consumes: nothing from other tasks.

- [x] **Step 1: Write the failing test (both halves)**

```ts
// scripts/__tests__/contract-coverage-guard.test.ts
/**
 * Guard: every response schema the client parses with
 * (`<name>Schema.safeParse(` / `.parse(` under client/) has a provider-side
 * assertion — a server test that references the same schema name (see
 * test/utils/expect-response-schema.ts).
 *
 * Two halves. (1) A synthetic positive control proving the pure function
 * fails on an uncovered name — a guard never seen red is not evidence.
 * (2) The repo walk. CONTRACT_ALLOWLIST is a RATCHET: it ships with the
 * names that were uncovered when the guard landed and must reach empty; an
 * entry that has since become covered fails the guard so it gets removed.
 *
 * Walk exclusions are a denylist (like fast-check-property-seed-guard) so a
 * client file dropped somewhere new is still scanned — an allowlist of roots
 * would fail OPEN.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  computeCoverage,
  extractParsedSchemaNames,
} from "../lib/contract-coverage";

/** Ratchet — remove an entry as soon as its provider-side assertion lands. */
const CONTRACT_ALLOWLIST: ReadonlySet<string> = new Set([
  "recipeSearchResponseSchema",
  "catalogSearchResponseSchema",
  "catalogConfigResponseSchema",
  "receiptAnalysisResultSchema",
  "receiptConfirmResultSchema",
  "tastePickCandidatesResponseSchema",
  "tastePicksResponseSchema",
  "coachBlockSchema",
]);

/**
 * Permanent: schemas the client parses that are NOT server responses (form
 * or local-state validation). Add with a one-line reason; never add a
 * response schema here to silence the guard.
 */
const NON_RESPONSE_SCHEMAS: ReadonlySet<string> = new Set<string>([]);

const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  ".claude",
  ".worktrees",
  ".expo",
  ".husky",
  ".eas",
  ".github",
  "ios",
  "android",
  "dist",
  "build",
  "coverage",
  ".stryker-tmp",
  "server_dist",
  "uploads",
  "assets",
]);

function walk(dir: string, keep: (path: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (EXCLUDED_DIRS.has(name)) return [];
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p, keep);
    return keep(p) ? [p] : [];
  });
}

const isClientSource = (p: string) =>
  /\.(ts|tsx)$/.test(p) &&
  !/\.test\.(ts|tsx)$/.test(p) &&
  !p.includes("__tests__");
const isServerTest = (p: string) =>
  (p.includes("__tests__") && /\.test\.ts$/.test(p)) || /\.itest\.ts$/.test(p);

describe("contract-coverage: pure functions (positive control)", () => {
  it("extracts schema names from safeParse and parse call sites", () => {
    const src = `
      const a = fooResponseSchema.safeParse(json);
      const b = barSchema.parse(data);
      const c = notASchema.safeParse(x); // no Schema suffix → ignored
      const d = fooResponseSchema.safeParse(other);
    `;
    expect(extractParsedSchemaNames(src)).toEqual([
      "barSchema",
      "fooResponseSchema",
    ]);
  });

  it("reports an uncovered client-parsed schema with its file", () => {
    const report = computeCoverage({
      clientSites: new Map([["fooResponseSchema", ["client/hooks/useFoo.ts"]]]),
      serverTestSources: ["expect(res.status).toBe(200);"],
      allowlist: new Set(),
      nonResponse: new Set(),
    });
    expect(report.uncovered).toEqual([
      { name: "fooResponseSchema", files: ["client/hooks/useFoo.ts"] },
    ]);
  });

  it("treats a whole-word reference in any server test as coverage", () => {
    const report = computeCoverage({
      clientSites: new Map([["fooResponseSchema", ["client/hooks/useFoo.ts"]]]),
      serverTestSources: [
        "expectResponseToMatch(res.body, fooResponseSchema);",
      ],
      allowlist: new Set(),
      nonResponse: new Set(),
    });
    expect(report.uncovered).toEqual([]);
  });

  it("does not let a longer identifier count as coverage", () => {
    const report = computeCoverage({
      clientSites: new Map([["fooSchema", ["client/x.ts"]]]),
      serverTestSources: ["expectResponseToMatch(res.body, fooSchemaV2);"],
      allowlist: new Set(),
      nonResponse: new Set(),
    });
    expect(report.uncovered.map((u) => u.name)).toEqual(["fooSchema"]);
  });

  it("exempts allowlisted names but flags them as stale once covered", () => {
    const report = computeCoverage({
      clientSites: new Map([
        ["fooResponseSchema", ["client/a.ts"]],
        ["barResponseSchema", ["client/b.ts"]],
      ]),
      serverTestSources: [
        "expectResponseToMatch(res.body, barResponseSchema);",
      ],
      allowlist: new Set(["fooResponseSchema", "barResponseSchema"]),
      nonResponse: new Set(),
    });
    expect(report.uncovered).toEqual([]);
    expect(report.staleAllowlist).toEqual(["barResponseSchema"]);
  });

  it("ignores non-response schemas entirely", () => {
    const report = computeCoverage({
      clientSites: new Map([["loginFormSchema", ["client/screens/Login.tsx"]]]),
      serverTestSources: [],
      allowlist: new Set(),
      nonResponse: new Set(["loginFormSchema"]),
    });
    expect(report.uncovered).toEqual([]);
  });
});

describe("contract-coverage: repo walk", () => {
  const clientFiles = walk("client", isClientSource);
  const serverTestFiles = [
    ...walk("server", isServerTest),
    ...walk("test", isServerTest),
  ];
  const clientSites = new Map<string, string[]>();
  for (const f of clientFiles) {
    for (const name of extractParsedSchemaNames(readFileSync(f, "utf8"))) {
      clientSites.set(name, [...(clientSites.get(name) ?? []), f]);
    }
  }
  const report = computeCoverage({
    clientSites,
    serverTestSources: serverTestFiles.map((f) => readFileSync(f, "utf8")),
    allowlist: CONTRACT_ALLOWLIST,
    nonResponse: NON_RESPONSE_SCHEMAS,
  });

  it("scans a non-empty client tree (denominator)", () => {
    expect(clientFiles.length).toBeGreaterThan(50);
    expect(clientSites.size).toBeGreaterThan(0);
  });

  it("every client-parsed response schema has a provider-side assertion", () => {
    const msg = report.uncovered
      .map(
        (u) =>
          `${u.name} is parsed in ${u.files.join(", ")} but no server test references it. ` +
          `Add expectResponseToMatch(res.body, ${u.name}) to the route test's success path ` +
          `(or add it to NON_RESPONSE_SCHEMAS with a reason if it is not a server response).`,
      )
      .join("\n");
    expect(report.uncovered, msg).toEqual([]);
  });

  it("the allowlist ratchet has no stale entries", () => {
    expect(
      report.staleAllowlist,
      `Remove from CONTRACT_ALLOWLIST (now covered): ${report.staleAllowlist.join(", ")}`,
    ).toEqual([]);
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `npx vitest run scripts/__tests__/contract-coverage-guard.test.ts`
Expected: FAIL — `Cannot find module '../lib/contract-coverage'`

- [x] **Step 3: Write the pure module**

```ts
// scripts/lib/contract-coverage.ts
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
  uncovered: Array<{ name: string; files: string[] }>;
  staleAllowlist: string[];
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function computeCoverage(input: {
  clientSites: Map<string, string[]>;
  serverTestSources: string[];
  allowlist: ReadonlySet<string>;
  nonResponse: ReadonlySet<string>;
}): CoverageReport {
  const uncovered: CoverageReport["uncovered"] = [];
  const staleAllowlist: string[] = [];
  const names = [...input.clientSites.keys()].sort();
  for (const name of names) {
    if (input.nonResponse.has(name)) continue;
    const re = new RegExp(`\\b${escapeRe(name)}\\b`);
    const covered = input.serverTestSources.some((src) => re.test(src));
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
```

- [x] **Step 4: Run the test to verify it passes**

Run: `npx vitest run scripts/__tests__/contract-coverage-guard.test.ts`
Expected: PASS. If "every client-parsed response schema has a provider-side assertion" fails, the message names a schema not in the nine — that is a new parse site since 2026-09-14: add a provider assertion for it (Tasks 3–7 pattern) or, only if it is genuinely not a response, add it to `NON_RESPONSE_SCHEMAS` with a reason. Do not extend `CONTRACT_ALLOWLIST`.

- [x] **Step 5: Commit**

```bash
git add scripts/lib/contract-coverage.ts scripts/__tests__/contract-coverage-guard.test.ts
git commit -m "test(contract): coverage guard for client-parsed response schemas (allowlist ratchet)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

_(A0 ends here. Open the PR for Tasks 1–2; Tasks 3–7 are A1 and depend on A0 merging.)_

---

### Task 3: Anchor — `/api/recipes/search` (`recipeSearchResponseSchema`)

**Files:**

- Modify: `server/routes/__tests__/recipe-search.test.ts` (happy path at lines 100–110; add a second test after it)
- Modify: `scripts/__tests__/contract-coverage-guard.test.ts` (remove `"recipeSearchResponseSchema"` from `CONTRACT_ALLOWLIST`)

**Interfaces:**

- Consumes: `expectResponseToMatch` (Task 1); `recipeSearchResponseSchema` from `@shared/types/recipe-search` (`shared/types/recipe-search.ts:106`); the route passes the service result straight through (`server/routes/recipe-search.ts:32-33`).

- [x] **Step 1: Add the assertions (the guard test currently passes only because of the allowlist — removing the entry first is the "failing test")**

Remove `"recipeSearchResponseSchema",` from `CONTRACT_ALLOWLIST`, then run:

Run: `npx vitest run scripts/__tests__/contract-coverage-guard.test.ts`
Expected: FAIL — `recipeSearchResponseSchema is parsed in client/hooks/useRecipeSearch.ts but no server test references it.`

- [x] **Step 2: Add the imports and assertions to the route test**

Add to the imports of `server/routes/__tests__/recipe-search.test.ts`:

```ts
import { recipeSearchResponseSchema } from "@shared/types/recipe-search";
import { expectResponseToMatch } from "../../../test/utils/expect-response-schema";
```

Change the existing happy-path test body (after `expect(res.status).toBe(200);`) to also assert the contract, and add a full-result test right after it:

```ts
it("returns 200 with empty search results on happy path", async () => {
  const res = await request(app)
    .get("/api/recipes/search?q=chicken")
    .set("Authorization", "Bearer token");

  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({
    results: expect.any(Array),
    total: 0,
  });
  expectResponseToMatch(res.body, recipeSearchResponseSchema);
});

// Contract anchor: a populated result must satisfy the schema the client
// parses with (shared/types/recipe-search.ts). The route passes the service
// result through unchanged, so this pins the wire shape end to end.
it("returns a populated result that matches recipeSearchResponseSchema", async () => {
  vi.mocked(searchRecipes).mockResolvedValueOnce({
    results: [
      {
        id: "r-1",
        source: "community",
        userId: "u-1",
        title: "Chicken Salad",
        description: null,
        ingredients: ["chicken", "lettuce"],
        cuisine: null,
        dietTags: [],
        mealTypes: ["lunch"],
        difficulty: "easy",
        prepTimeMinutes: 10,
        cookTimeMinutes: 0,
        totalTimeMinutes: 10,
        caloriesPerServing: 320,
        proteinPerServing: 30,
        carbsPerServing: 8,
        fatPerServing: 12,
        servings: 2,
        imageUrl: null,
        sourceUrl: null,
        createdAt: "2026-09-14T00:00:00.000Z",
        isCanonical: false,
        allergens: null,
      },
    ],
    total: 1,
    offset: 0,
    limit: 20,
    query: { q: "chicken", filters: {}, sort: "relevance" },
  });

  const res = await request(app)
    .get("/api/recipes/search?q=chicken")
    .set("Authorization", "Bearer token");

  expect(res.status).toBe(200);
  const parsed = expectResponseToMatch(res.body, recipeSearchResponseSchema);
  expect(parsed.results[0].title).toBe("Chicken Salad");
});
```

If TypeScript rejects the `mockResolvedValueOnce` literal (the service's return type is stricter than the schema), cast the literal with `as Awaited<ReturnType<typeof searchRecipes>>` — the runtime assertion is what matters here.

- [x] **Step 3: Run both files**

Run: `npx vitest run server/routes/__tests__/recipe-search.test.ts scripts/__tests__/contract-coverage-guard.test.ts`
Expected: PASS. If `expectResponseToMatch` fails, read its path list — each line names a field the route's output lacks or mistypes relative to `shared/types/recipe-search.ts:82-104`; fix the fixture (or, if the route genuinely drops a field the client requires, that is a real contract bug: fix the route in a separate commit and say so in the PR).

- [x] **Step 4: Commit**

```bash
git add server/routes/__tests__/recipe-search.test.ts scripts/__tests__/contract-coverage-guard.test.ts
git commit -m "test(contract): assert /api/recipes/search output against recipeSearchResponseSchema

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Anchor — catalog search + config (`catalogSearchResponseSchema`, `catalogConfigResponseSchema`)

**Files:**

- Modify: `server/routes/__tests__/recipe-catalog.test.ts` (search happy path at lines 115–130; config tests at lines 254–283)
- Modify: `scripts/__tests__/contract-coverage-guard.test.ts` (remove the two catalog names from `CONTRACT_ALLOWLIST`)

**Interfaces:**

- Consumes: `expectResponseToMatch`; `catalogSearchResponseSchema`, `catalogConfigResponseSchema` from `@shared/types/recipe-catalog` (`shared/types/recipe-catalog.ts:17` and `:41`). Note: `server/services/recipe-catalog.ts:243` already uses `catalogSearchResponseSchema` to parse the _upstream_ Spoonacular payload; this task pins the _route's_ output, which the service result feeds through.

- [x] **Step 1: Remove the two names from the allowlist; confirm the guard goes red**

Run: `npx vitest run scripts/__tests__/contract-coverage-guard.test.ts`
Expected: FAIL naming `catalogConfigResponseSchema` and `catalogSearchResponseSchema`.

- [x] **Step 2: Add imports and assertions**

Imports:

```ts
import {
  catalogConfigResponseSchema,
  catalogSearchResponseSchema,
} from "@shared/types/recipe-catalog";
import { expectResponseToMatch } from "../../../test/utils/expect-response-schema";
```

In `it("returns 200 with search results on happy path", …)` after the existing `expect(res.body).toMatchObject({...})`:

```ts
expectResponseToMatch(res.body, catalogSearchResponseSchema);
```

In `it("returns 200 { enabled: true } when SPOONACULAR_API_KEY is set", …)` after `expect(res.body).toEqual({ enabled: true });`:

```ts
expectResponseToMatch(res.body, catalogConfigResponseSchema);
```

- [x] **Step 3: Run both files**

Run: `npx vitest run server/routes/__tests__/recipe-catalog.test.ts scripts/__tests__/contract-coverage-guard.test.ts`
Expected: PASS. If the search assertion fails, the mock `{ results: [], offset: 0, number: 10, totalResults: 0 }` lacks a field the schema at `shared/types/recipe-catalog.ts:17` requires — add exactly the fields named in the failure lines to the `mockResolvedValue` literal.

- [x] **Step 4: Commit**

```bash
git add server/routes/__tests__/recipe-catalog.test.ts scripts/__tests__/contract-coverage-guard.test.ts
git commit -m "test(contract): assert catalog search and config outputs against shared schemas

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Anchor — receipt scan + confirm (relocate the client-local schemas to `shared/`)

**Files:**

- Create: `shared/schemas/receipt.ts`
- Modify: `client/hooks/useReceiptScan.ts` (lines 10–60: delete the local `receiptItemSchema`, `receiptAnalysisResultSchema`, `pantryItemSchema`, `receiptConfirmResultSchema` definitions and their `z.infer` type exports; import them instead)
- Modify: `server/routes/__tests__/receipt.test.ts` (scan happy path at lines 120–154; confirm happy path at lines 308–352)
- Modify: `scripts/__tests__/contract-coverage-guard.test.ts` (remove both receipt names)

**Interfaces:**

- Produces: `shared/schemas/receipt.ts` exporting `receiptItemSchema`, `receiptAnalysisResultSchema`, `receiptPantryItemSchema`, `receiptConfirmResultSchema` and types `ReceiptItem`, `ReceiptAnalysisResult`, `ReceiptConfirmResult` — byte-for-byte the same Zod definitions as the client-local ones (the only rename is `pantryItemSchema` → `receiptPantryItemSchema`, to avoid a collision with the Drizzle-derived pantry schema in `shared/schema.ts`).
- Consumes: `expectResponseToMatch`.

- [x] **Step 1: Remove the two receipt names from the allowlist; confirm red**

Run: `npx vitest run scripts/__tests__/contract-coverage-guard.test.ts`
Expected: FAIL naming both receipt schemas.

- [x] **Step 2: Create the shared module (verbatim move)**

```ts
// shared/schemas/receipt.ts
/**
 * Wire schemas for the receipt endpoints (POST /api/receipt/scan,
 * POST /api/receipt/confirm). Moved from client/hooks/useReceiptScan.ts on
 * 2026-09-14 so the server test suite can assert the route output against the
 * exact schema the client parses with (Lane A contract tests). Shapes mirror
 * the JSON wire format, not the Drizzle/server types — timestamps and decimal
 * quantities arrive as strings.
 */
import { z } from "zod";

export const receiptItemSchema = z.object({
  name: z.string(),
  originalName: z.string(),
  quantity: z.number(),
  unit: z.string().optional(),
  category: z.string(),
  isFood: z.boolean(),
  estimatedShelfLifeDays: z.number(),
  confidence: z.number(),
});

export const receiptAnalysisResultSchema = z.object({
  items: z.array(receiptItemSchema),
  storeName: z.string().optional(),
  purchaseDate: z.string().optional(),
  totalAmount: z.string().optional(),
  isPartialExtraction: z.boolean(),
  overallConfidence: z.number(),
});

/** Wire shape of a `PantryItem` row after JSON serialization. */
export const receiptPantryItemSchema = z.object({
  id: z.number(),
  userId: z.string(),
  name: z.string(),
  quantity: z.string().nullable(),
  unit: z.string().nullable(),
  category: z.string().nullable(),
  expiresAt: z.string().nullable(),
  addedAt: z.string(),
  updatedAt: z.string(),
});

export const receiptConfirmResultSchema = z.object({
  added: z.number(),
  items: z.array(receiptPantryItemSchema),
});

export type ReceiptItem = z.infer<typeof receiptItemSchema>;
export type ReceiptAnalysisResult = z.infer<typeof receiptAnalysisResultSchema>;
export type ReceiptConfirmResult = z.infer<typeof receiptConfirmResultSchema>;
```

Before editing the client hook, confirm nothing else imports the local names: run the LSP `findReferences` on `receiptAnalysisResultSchema` in `client/hooks/useReceiptScan.ts` (re-run once if the first result looks empty — cold server). Expected: references only inside that file.

- [x] **Step 3: Swap the client hook to the shared import**

In `client/hooks/useReceiptScan.ts`: delete the block from the `/** Runtime schemas for the receipt endpoints …` comment through `export type ReceiptConfirmResult = …;` (lines 10–60 as of 2026-09-14) and add at the top:

```ts
import {
  receiptAnalysisResultSchema,
  receiptConfirmResultSchema,
  type ReceiptAnalysisResult,
  type ReceiptConfirmResult,
  type ReceiptItem,
} from "@shared/schemas/receipt";

export type { ReceiptAnalysisResult, ReceiptConfirmResult, ReceiptItem };
```

(The re-export keeps any consumer of the hook's exported types working.) Remove the now-unused `z` import only if nothing else in the file uses it.

- [x] **Step 4: Add the route-test assertions**

Imports in `server/routes/__tests__/receipt.test.ts`:

```ts
import {
  receiptAnalysisResultSchema,
  receiptConfirmResultSchema,
} from "@shared/schemas/receipt";
import { expectResponseToMatch } from "../../../test/utils/expect-response-schema";
```

In `it("analyzes receipt photos and returns results", …)` after `expect(res.status).toBe(200);`:

```ts
expectResponseToMatch(res.body, receiptAnalysisResultSchema);
```

In `it("creates pantry items from confirmed receipt items", …)` after `expect(res.status).toBe(200);`:

```ts
expectResponseToMatch(res.body, receiptConfirmResultSchema);
```

- [x] **Step 5: Run the affected files**

Run: `npx vitest run server/routes/__tests__/receipt.test.ts scripts/__tests__/contract-coverage-guard.test.ts client/hooks/__tests__/useReceiptScan.test.ts`
Expected: PASS. The confirm assertion runs against `res.body` (post-JSON), so `Date` fields from `createMockPantryItem` arrive as ISO strings and satisfy `z.string()`. If the scan assertion fails on `items[0].unit`, the server type allows a value the client schema does not — that is a real contract finding: report it in the PR and fix the schema side that is wrong.

- [x] **Step 6: Commit**

```bash
git add shared/schemas/receipt.ts client/hooks/useReceiptScan.ts server/routes/__tests__/receipt.test.ts scripts/__tests__/contract-coverage-guard.test.ts
git commit -m "test(contract): move receipt wire schemas to shared and assert scan/confirm outputs

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Anchor — taste picks (`tastePickCandidatesResponseSchema`, `tastePicksResponseSchema`)

**Files:**

- Modify: `server/routes/__tests__/taste-picks.test.ts` (candidates happy path at line 55; picks happy path at line 131)
- Modify: `scripts/__tests__/contract-coverage-guard.test.ts` (remove both taste-pick names)

**Interfaces:**

- Consumes: `expectResponseToMatch`; schemas from `@shared/schemas/taste-picks` (`shared/schemas/taste-picks.ts:38` and `:44`).

- [x] **Step 1: Remove the names from the allowlist; confirm red**

Run: `npx vitest run scripts/__tests__/contract-coverage-guard.test.ts`
Expected: FAIL naming both taste-pick schemas.

- [x] **Step 2: Add imports and assertions**

```ts
import {
  tastePickCandidatesResponseSchema,
  tastePicksResponseSchema,
} from "@shared/schemas/taste-picks";
import { expectResponseToMatch } from "../../../test/utils/expect-response-schema";
```

In `it("returns paginated candidates", …)` after `expect(res.status).toBe(200);`:

```ts
expectResponseToMatch(res.body, tastePickCandidatesResponseSchema);
```

In `it("returns current picks", …)` after `expect(res.status).toBe(200);`:

```ts
expectResponseToMatch(res.body, tastePicksResponseSchema);
```

- [x] **Step 3: Run both files**

Run: `npx vitest run server/routes/__tests__/taste-picks.test.ts scripts/__tests__/contract-coverage-guard.test.ts`
Expected: PASS (`mockCandidate`/`mockPick` already carry `id`/`recipeId`, `title`, `imageUrl`, `cuisineOrigin`).

- [x] **Step 4: Commit**

```bash
git add server/routes/__tests__/taste-picks.test.ts scripts/__tests__/contract-coverage-guard.test.ts
git commit -m "test(contract): assert taste-pick candidates and picks outputs against shared schemas

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Anchor — coach blocks (`coachBlockSchema`), empty the allowlist, remove `msw`

**Files:**

- Modify: `server/services/__tests__/coach-blocks.test.ts` (tests at lines 10 and 40)
- Modify: `scripts/__tests__/contract-coverage-guard.test.ts` (`CONTRACT_ALLOWLIST` becomes `new Set<string>([])`)
- Modify: `package.json`, `package-lock.json` (remove `msw`)

**Interfaces:**

- Consumes: `expectResponseToMatch`; `coachBlockSchema` from `@shared/schemas/coach-blocks` (`shared/schemas/coach-blocks.ts:275`, a discriminated union on `type`); `validateBlocks` and `parseBlocksFromContent` from `server/services/coach-blocks.ts`.
- Why the service boundary: coach blocks stream over SSE — there is no single response body. `validateBlocks` is the last server-side step before a block is emitted, so its output is the provider-side contract surface.
- **Controller note (2026-09-15, A0 final review):** the extractor now attributes a parse through a sub-schema to its parent, so `mealPlanCardSchema.shape.days.safeParse(raw)` at `client/components/coach/coach-chat-utils.ts:18` is a ninth parse site and landed as the ninth `CONTRACT_ALLOWLIST` entry. This task clears it too: import `mealPlanCardSchema` beside `coachBlockSchema`, make sure the fixture in `it("validates valid blocks array", …)` contains a block of `type: "meal_plan_card"` (add one if it does not — a bare name reference satisfies the guard's predicate but asserts nothing), and after the `coachBlockSchema` loop add `for (const block of result) if (block.type === "meal_plan_card") expectResponseToMatch(block, mealPlanCardSchema);`. Step 1's red run then names both schemas.

- [x] **Step 1: Empty the allowlist; confirm red**

Set `const CONTRACT_ALLOWLIST: ReadonlySet<string> = new Set<string>([]);`

Run: `npx vitest run scripts/__tests__/contract-coverage-guard.test.ts`
Expected: FAIL naming `coachBlockSchema` and `mealPlanCardSchema` (see the controller note above).

- [x] **Step 2: Add the assertions in the service test**

Imports:

```ts
import { coachBlockSchema } from "@shared/schemas/coach-blocks";
import { expectResponseToMatch } from "../../../test/utils/expect-response-schema";
```

In `it("validates valid blocks array", …)` after `expect(result[0].type).toBe("quick_replies");`:

```ts
// Contract anchor: every block the server emits must satisfy the schema the
// client parses each SSE block with (client/components/coach/coach-chat-utils.ts).
for (const block of result) expectResponseToMatch(block, coachBlockSchema);
```

In `it("parses blocks from JSON-annotated content", …)` after its existing expectations:

```ts
for (const block of parsed.blocks)
  expectResponseToMatch(block, coachBlockSchema);
```

(`parsed` is whatever that test already names the `parseBlocksFromContent(...)` result; match the existing variable name.)

- [x] **Step 3: Remove `msw`**

```bash
npm uninstall msw
git diff --stat package.json package-lock.json
```

Expected: only the `msw` entry removed from `devDependencies` and its lock entries; no other dependency changes. (Zero imports of `msw` exist repo-wide — verified 2026-09-14 — so nothing else moves.)

- [x] **Step 4: Run the affected files**

Run: `npx vitest run server/services/__tests__/coach-blocks.test.ts scripts/__tests__/contract-coverage-guard.test.ts`
Expected: PASS, including "the allowlist ratchet has no stale entries" with an empty allowlist.

- [x] **Step 5: Commit**

```bash
git add server/services/__tests__/coach-blocks.test.ts scripts/__tests__/contract-coverage-guard.test.ts package.json package-lock.json
git commit -m "test(contract): assert coach blocks against coachBlockSchema; empty the allowlist; drop unused msw

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Verification (before opening the A1 PR)

```bash
npx vitest run test/utils/__tests__ scripts/__tests__/contract-coverage-guard.test.ts \
  server/routes/__tests__/recipe-search.test.ts server/routes/__tests__/recipe-catalog.test.ts \
  server/routes/__tests__/receipt.test.ts server/routes/__tests__/taste-picks.test.ts \
  server/services/__tests__/coach-blocks.test.ts client/hooks/__tests__/useReceiptScan.test.ts
grep -rn "from \"msw\"\|from 'msw'" client server shared test scripts evals || echo "no msw imports"
grep -c "" scripts/__tests__/contract-coverage-guard.test.ts >/dev/null && grep -n "CONTRACT_ALLOWLIST: ReadonlySet<string> = new Set<string>(\[\])" scripts/__tests__/contract-coverage-guard.test.ts
```

Expected: all green; `no msw imports`; the allowlist line matches (empty set).

## Considered and rejected

- Consumer-side tests with `msw` serving schema-generated fixtures to hooks — cut in the spec: hook tests already mock transport; the gap is provider-side.
- A name-suffix heuristic (`*ResponseSchema`) to scope the guard — would miss `coachBlockSchema`; `NON_RESPONSE_SCHEMAS` with a reason per entry is the explicit alternative.
