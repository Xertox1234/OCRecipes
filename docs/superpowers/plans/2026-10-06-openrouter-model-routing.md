# OpenRouter Model Routing Implementation Plan

> **STATUS: SHIPPED — history, not instructions.** Checked 2026-11-22: the files this plan creates are on `main`. Partly superseded: there is no OpenAI-direct fallback any more; the backup route is Vertex direct (ruling 2026-11-02). The current code and `docs/OWNER_RULINGS.md` win over anything below.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route every AI chat/vision call through OpenRouter via a per-feature model table and one `aiChat` helper. If OpenRouter fails, the call silently falls back to today's OpenAI path. Model behavior does not change until the owner switches a feature.

**Architecture:**

- `server/lib/ai-models.ts` holds one row per call site, each with an OpenRouter model, a fallback model, and per-row parameter adaptation.
- `server/lib/ai-client.ts` exports `aiChat(feature, params, options)`:
  - with no `OPENROUTER_API_KEY`, it calls today's `openai` client exactly as now;
  - with a key, it calls OpenRouter (`provider.zdr`) and falls back by the spec's §3.4 failure table.
- Failure classification and the circuit breaker live in `ai-failure.ts`.
- An `AsyncLocalStorage` call context (`ai-call-context.ts`) carries eval-only overrides and records which model answered.
- The 30 call sites migrate in four PRs.
- The eval judge then moves to OpenRouter, the runner gains `--candidate` runs, `eval-compare` gains a paired mode, and an `ai:smoke` script checks every row.

**Tech Stack:** TypeScript (strict), `openai` SDK ^6.39 (also used as the OpenRouter client), Node `AsyncLocalStorage`, Vitest, ESLint flat config with the in-repo `eslint-plugin-ocrecipes`.

**Spec:** `docs/superpowers/specs/2026-10-06-openrouter-model-routing-design.md`. Read it before starting any task: section numbers (§3.4 etc.) below refer to it. Both files are local-only, because `docs/superpowers/` is gitignored.

## Global Constraints

- **TDD:** write the failing test, watch it fail, then implement (CLAUDE.md). Run targeted tests with `npx vitest run <path>`. The full suite, `check:types` and `lint` are CI's job; the pre-push `preflight:fast` gate runs related tests.
- **Behavior is unchanged until step 5 of the spec rollout.** Every table row's `model` is today's model with a provider prefix, and no row has `adapt`.
- **OpenRouter base URL:** `https://openrouter.ai/api/v1`. Request header `X-Title: OCRecipes`.
- **Every OpenRouter chat request carries `provider: { zdr: true }`.**
- **Env var name:** `OPENROUTER_API_KEY`, optional. An empty string is treated as unset.
- **Circuit breaker:** 5 counted failures within 60_000 ms opens it; it stays open for 60_000 ms; one success closes it; a failed trial call reopens it.
- **Paired switch rule (0–10 scale), on the CI lower bound of the per-case paired difference:**
  - every dimension **≥ −0.5**;
  - `safety` **≥ −0.25**;
  - **zero** cases that pass hard assertions on the baseline and fail on the candidate.
- **Default judge model:**
  - OpenRouter path: `anthropic/claude-sonnet-4.6`.
  - Anthropic-direct path: `claude-sonnet-4-6`.
- **Never** run `kimi-*` workers on any task here (user health and profile data flows through these prompts).
- **Every PR** from this plan is human-reviewed and **never auto-merged**.
  - Review roster: `code-reviewer` + `server-reviewer` + `ai-reviewer`.
  - Add `security-auditor` for PR 1 (Tasks 1–7) and PR 7 (Task 15).
- Work on a feature branch in a worktree (`superpowers:using-git-worktrees`). Never commit to `main`.
- Commit messages go through a file and `git commit -F` (repo memory). End every message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **The user leaves the coach screen while `aiChat` is waiting for the first stream chunk.**
   - Expected: no fallback request is sent and the abort propagates.
   - Pinned in: Task 5, test "abort while peeking re-throws without fallback".
2. **The coach's `for await` loop exits early** (abort, or the safety override) after a few chunks.
   - Expected: the underlying OpenRouter stream is closed (`iterator.return()`), and the call is logged as incomplete, not as an error.
   - Pinned in: Task 5, test "early consumer exit closes the source stream".
3. **An eval sample whose service made zero AI calls** (cache hit, early return, refusal path).
   - Expected: it is a violation. A clean zero says nothing about which model ran.
   - Pinned in: Task 12, test "zero recorded calls is a violation".
4. **`OPENROUTER_API_KEY` unset during an eval run** (call context with `fallback: "off"`).
   - Expected: `aiChat` throws a clear error instead of quietly answering via the fallback, which would make the "candidate" run measure today's model.
   - Pinned in: Task 4, test "fallback off with no key throws".
5. **OpenRouter reports a dated model id** (e.g. `openai/gpt-4o-mini-2024-07-18` for a request of `openai/gpt-4o-mini`).
   - Expected: it counts as a match, while a different model does not.
   - Pinned in: Task 12, test "dated answered model matches requested".

---

## File map

| File                                                                         | Responsibility                                                        | Task  |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------- | ----- |
| `server/lib/ai-models.ts` (new)                                              | Feature table, `AiFeature` type, `adaptParams`                        | 1     |
| `server/lib/ai-call-context.ts` (new)                                        | `AsyncLocalStorage` context: overrides, fallback switch, call records | 2     |
| `server/lib/ai-failure.ts` (new)                                             | `classifyAiFailure`, `InStreamError`, `CircuitBreaker`                | 3     |
| `server/lib/ai-client.ts` (new)                                              | `createAiChat`, `aiChat`, stream wrapper, logging and alerts          | 4, 5  |
| `server/lib/env.ts`, `server/__tests__/README.md`                            | `OPENROUTER_API_KEY`                                                  | 6     |
| `eslint-plugin-ocrecipes/index.js`, `eslint.config.js`                       | `no-direct-chat-completions` rule (registered in Task 10)             | 7, 10 |
| 20 service files + 2 scripts                                                 | Call-site migration                                                   | 8–10  |
| `server/lib/openai.ts`                                                       | Delete `MODEL_FAST` / `MODEL_HEAVY`                                   | 10    |
| `evals/lib/judge-generic.ts`, `evals/lib/runner-core.ts`                     | Judge on OpenRouter, key gate                                         | 11    |
| `evals/lib/candidate.ts` (new), `evals/lib/runner-core.ts`, `evals/types.ts` | `--candidate`, per-sample context, record checks                      | 12    |
| `scripts/ci/eval-compare.ts`                                                 | `--paired` mode                                                       | 13    |
| `scripts/ai-smoke.ts` (new), `package.json`                                  | `npm run ai:smoke`                                                    | 14    |
| `site/privacy/index.html`                                                    | Provider table update                                                 | 15    |

**PR grouping:**

| PR   | Tasks | Contents                                                  |
| ---- | ----- | --------------------------------------------------------- |
| PR 1 | 1–7   | Foundation                                                |
| PR 2 | 8     | Streaming + coach                                         |
| PR 3 | 9     | Photo services                                            |
| PR 4 | 10    | Remaining services, scripts, constant deletion, lint rule |
| PR 5 | 11–13 | Evals                                                     |
| PR 6 | 14    | Smoke                                                     |
| PR 7 | 15    | Privacy policy                                            |

---

### Task 1: Feature table and parameter adaptation

**Files:**

- Create: `server/lib/ai-models.ts`
- Test: `server/lib/__tests__/ai-models.test.ts`

**Interfaces:**

- Produces:
  - `AI_FEATURES` (const record);
  - `type AiFeature = keyof typeof AI_FEATURES`;
  - `interface AiFeatureConfig { model: string; fallback: string; json: boolean; vision: boolean; adapt?: AiAdapt }`;
  - `interface AiAdapt { drop?: string[]; rename?: Record<string, string>; set?: Record<string, unknown> }`;
  - `isAiFeature(name: string): name is AiFeature`;
  - `adaptParams(params: Record<string, unknown>, adapt: AiAdapt | undefined, extraSet?: Record<string, unknown>): Record<string, unknown>`.

- [ ] **Step 1: Write the failing test**

```ts
// server/lib/__tests__/ai-models.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { AI_FEATURES, adaptParams, isAiFeature } from "../ai-models";

describe("AI_FEATURES table", () => {
  const rows = Object.entries(AI_FEATURES);

  it("has one row per call site (30)", () => {
    expect(rows).toHaveLength(30);
  });

  it("every model has a provider/ prefix and no fallback does", () => {
    for (const [name, row] of rows) {
      expect(row.model, name).toMatch(/^[a-z0-9-]+\/[^/]+$/);
      expect(row.fallback, name).not.toContain("/");
    }
  });

  it("day one: every model is its fallback with the openai/ prefix and no adapt", () => {
    for (const [name, row] of rows) {
      expect(row.model, name).toBe(`openai/${row.fallback}`);
      expect(row.adapt, name).toBeUndefined();
    }
  });

  it("isAiFeature narrows known names only", () => {
    expect(isAiFeature("coach-chat")).toBe(true);
    expect(isAiFeature("nope")).toBe(false);
    expect(isAiFeature("toString")).toBe(false);
  });
});

describe("adaptParams", () => {
  it("returns a copy unchanged when there is no adapt", () => {
    const params = { temperature: 0.5, max_completion_tokens: 10 };
    const out = adaptParams(params, undefined);
    expect(out).toEqual(params);
    expect(out).not.toBe(params);
  });

  it("drops keys", () => {
    expect(
      adaptParams({ temperature: 0.5, n: 1 }, { drop: ["temperature"] }),
    ).toEqual({ n: 1 });
  });

  it("renames keys, never overwriting an existing target", () => {
    expect(
      adaptParams(
        { max_completion_tokens: 10 },
        { rename: { max_completion_tokens: "max_tokens" } },
      ),
    ).toEqual({ max_tokens: 10 });
    expect(
      adaptParams(
        { max_completion_tokens: 10, max_tokens: 99 },
        { rename: { max_completion_tokens: "max_tokens" } },
      ),
    ).toEqual({ max_tokens: 99 });
  });

  it("applies set last, and extraSet overrides the row's set", () => {
    expect(
      adaptParams(
        { temperature: 0.5 },
        { drop: ["temperature"], set: { reasoning_effort: "low" } },
        { reasoning_effort: "medium" },
      ),
    ).toEqual({ reasoning_effort: "medium" });
  });

  it("does not mutate the input", () => {
    const params = { temperature: 0.5 };
    adaptParams(params, { drop: ["temperature"] });
    expect(params).toEqual({ temperature: 0.5 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run server/lib/__tests__/ai-models.test.ts`
Expected: FAIL, "Cannot find module '../ai-models'".

- [ ] **Step 3: Write the implementation**

The `json` and `vision` values below were derived by scanning each call. **Before committing, verify every row against its call:**

- `json: true` if and only if the call passes `response_format: { type: "json_object" }`;
- `vision: true` if and only if its `messages` contain an `image_url` content part.

Fix any row that disagrees. Flags matter: the smoke script (Task 14) sends JSON mode and an image based on them.

```ts
// server/lib/ai-models.ts
/**
 * One row per AI call site. `model` is the OpenRouter id (provider-prefixed);
 * `fallback` is the id for the existing OpenAI client (today's path). Moving
 * a feature to another model = edit its row (spec §3.1, owner approval +
 * paired eval report required — spec §5/§6).
 *
 * `json` / `vision` describe the call (response_format json_object / an
 * image_url part) — scripts/ai-smoke.ts reproduces them per row.
 */
export interface AiAdapt {
  drop?: string[];
  rename?: Record<string, string>;
  set?: Record<string, unknown>;
}

export interface AiFeatureConfig {
  model: string;
  fallback: string;
  json: boolean;
  vision: boolean;
  adapt?: AiAdapt;
}

const FAST = { model: "openai/gpt-4o-mini", fallback: "gpt-4o-mini" } as const;
const HEAVY = { model: "openai/gpt-4o", fallback: "gpt-4o" } as const;

export const AI_FEATURES = {
  // Coach
  "coach-chat": { ...FAST, json: false, vision: false }, // nutrition-coach generateCoachResponse (stream)
  "coach-pro-chat": { ...FAST, json: false, vision: false }, // nutrition-coach generateCoachProResponse (stream, tools)
  "coach-notebook-extract": { ...FAST, json: true, vision: false }, // notebook-extraction extractNotebookEntries
  // Recipe chat
  "recipe-chat": { ...HEAVY, json: false, vision: false }, // recipe-chat generateRecipeChatResponse (stream)
  "recipe-chat-image": { ...HEAVY, json: false, vision: true }, // recipe-chat analyzeImageForRecipe
  // Photo analysis (photo-analysis.ts)
  "photo-recipe": { ...HEAVY, json: false, vision: true }, // analyzeRecipePhoto
  "photo-recipe-text": { ...FAST, json: true, vision: false }, // structureRecipeFromText
  "photo-label": { ...HEAVY, json: false, vision: true }, // analyzeLabelPhoto
  "photo-analyze": { ...HEAVY, json: false, vision: true }, // analyzePhoto
  "photo-refine": { ...HEAVY, json: false, vision: true }, // refineAnalysis
  "photo-classify": { ...FAST, json: true, vision: true }, // classifyAndAnalyze
  // Other vision services
  "receipt-scan": { ...HEAVY, json: true, vision: true }, // receipt-analysis analyzeReceiptPhotos
  "menu-scan": { ...HEAVY, json: true, vision: true }, // menu-analysis analyzeMenuPhoto
  "front-label-scan": { ...HEAVY, json: true, vision: true }, // front-label-analysis analyzeFrontLabel
  "cooking-ingredient-photo": { ...HEAVY, json: true, vision: true }, // cooking-session analyzeIngredientPhoto
  // Recipes & meals
  "recipe-generate": { ...HEAVY, json: false, vision: false }, // recipe-generation generateRecipeContent
  "meal-suggestions": { ...HEAVY, json: true, vision: false }, // meal-suggestions generateMealSuggestions
  "pantry-meal-plan": { ...HEAVY, json: true, vision: false }, // pantry-meal-plan generateMealPlanFromPantry
  "ingredient-substitution": { ...HEAVY, json: true, vision: false }, // ingredient-substitution getAiSubstitutions
  "canonical-editorial": { ...HEAVY, json: false, vision: false }, // canonical-enrichment generateEditorialContent
  "suggestion-generate": { ...FAST, json: true, vision: false }, // suggestion-generation generateSuggestions
  "suggestion-instructions": { ...FAST, json: false, vision: false }, // suggestion-generation generateInstructions
  "food-nlp-parse": { ...FAST, json: true, vision: false }, // food-nlp parseNaturalLanguageFood
  // Recipe finder
  "finder-classify-turn": { ...FAST, json: true, vision: false }, // recipe-finder/classify-turn
  "finder-ask-clarifying": { ...FAST, json: true, vision: false }, // recipe-finder/ask-clarifying
  "finder-extract-query": { ...FAST, json: true, vision: false }, // recipe-finder/extract-query
  // Images / covers
  "image-art-direction": { ...FAST, json: true, vision: false }, // image-art-direction resolveArtDirection
  "cookbook-cover-subject": { ...FAST, json: true, vision: false }, // cookbook-cover deriveCoverSubject
  // Scripts
  "script-seed-macros": { ...FAST, json: true, vision: false }, // server/scripts/seed-recipes estimateMacros
  "script-backfill-macros": { ...FAST, json: true, vision: false }, // server/scripts/backfill-community-nutrition estimateMacros
} as const satisfies Record<string, AiFeatureConfig>;

export type AiFeature = keyof typeof AI_FEATURES;

export function isAiFeature(name: string): name is AiFeature {
  return Object.prototype.hasOwnProperty.call(AI_FEATURES, name);
}

/** Rewrites applied ONLY to the OpenRouter attempt (spec §3.3). */
export function adaptParams(
  params: Record<string, unknown>,
  adapt: AiAdapt | undefined,
  extraSet: Record<string, unknown> = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...params };
  for (const key of adapt?.drop ?? []) delete out[key];
  for (const [from, to] of Object.entries(adapt?.rename ?? {})) {
    if (from in out) {
      if (!(to in out)) out[to] = out[from];
      delete out[from];
    }
  }
  return { ...out, ...adapt?.set, ...extraSet };
}
```

Because `AI_FEATURES` is `as const satisfies`, TypeScript sees `adapt` as absent on every row. When a later switch PR adds `adapt` to one row, it compiles. Read `adapt` through `const row: AiFeatureConfig = AI_FEATURES[feature]`, as Task 4 does.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run server/lib/__tests__/ai-models.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add server/lib/ai-models.ts server/lib/__tests__/ai-models.test.ts
git commit -F <msg-file>   # "feat(ai): per-feature model table + adaptParams"
```

---

### Task 2: Call-record context

**Files:**

- Create: `server/lib/ai-call-context.ts`
- Test: `server/lib/__tests__/ai-call-context.test.ts`

**Interfaces:**

- Consumes: `AiFeature` (Task 1).
- Produces:
  - `interface AiModelOverride { model: string; set?: Record<string, unknown> }`;
  - `interface AiCallRecord { feature: AiFeature; requestedModel: string; answeredModel: string | null; answeredProvider: string | null; fellBack: boolean }`;
  - `interface AiCallContext { overrides: Partial<Record<AiFeature, AiModelOverride>>; fallback: "on" | "off"; calls: AiCallRecord[] }`;
  - `withAiCallContext<T>(ctx: AiCallContext, fn: () => Promise<T>): Promise<T>`;
  - `getAiCallContext(): AiCallContext | undefined`.

- [ ] **Step 1: Write the failing test**

```ts
// server/lib/__tests__/ai-call-context.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { getAiCallContext, withAiCallContext } from "../ai-call-context";
import type { AiCallContext } from "../ai-call-context";

const ctx = (): AiCallContext => ({
  overrides: {},
  fallback: "off",
  calls: [],
});

describe("ai call context", () => {
  it("is undefined outside a context (all production traffic)", () => {
    expect(getAiCallContext()).toBeUndefined();
  });

  it("is visible across awaits and inside async generators consumed in the context", async () => {
    const c = ctx();
    async function* gen() {
      await Promise.resolve();
      yield getAiCallContext();
    }
    await withAiCallContext(c, async () => {
      await new Promise((r) => setTimeout(r, 1));
      expect(getAiCallContext()).toBe(c);
      for await (const seen of gen()) expect(seen).toBe(c);
    });
    expect(getAiCallContext()).toBeUndefined();
  });

  it("isolates concurrent contexts", async () => {
    const a = ctx();
    const b = ctx();
    const seen = await Promise.all([
      withAiCallContext(a, async () => {
        await new Promise((r) => setTimeout(r, 5));
        return getAiCallContext();
      }),
      withAiCallContext(b, async () => getAiCallContext()),
    ]);
    expect(seen[0]).toBe(a);
    expect(seen[1]).toBe(b);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run server/lib/__tests__/ai-call-context.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// server/lib/ai-call-context.ts
/**
 * Eval-only call context (spec §3.6/§3.7). Overrides and the fallback switch
 * exist ONLY inside withAiCallContext — never read from env — so production
 * (which never opens a context) can't apply them and NODE_ENV can't void them.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { AiFeature } from "./ai-models";

export interface AiModelOverride {
  model: string;
  set?: Record<string, unknown>;
}

export interface AiCallRecord {
  feature: AiFeature;
  requestedModel: string;
  answeredModel: string | null;
  answeredProvider: string | null;
  fellBack: boolean;
}

export interface AiCallContext {
  overrides: Partial<Record<AiFeature, AiModelOverride>>;
  fallback: "on" | "off";
  calls: AiCallRecord[];
}

const storage = new AsyncLocalStorage<AiCallContext>();

export function withAiCallContext<T>(
  ctx: AiCallContext,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(ctx, fn);
}

export function getAiCallContext(): AiCallContext | undefined {
  return storage.getStore();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run server/lib/__tests__/ai-call-context.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit** (`feat(ai): AsyncLocalStorage call-record context`)

---

### Task 3: Failure classification and the circuit breaker

**Files:**

- Create: `server/lib/ai-failure.ts`
- Test: `server/lib/__tests__/ai-failure.test.ts`

**Interfaces:**

- Produces:
  - `type AiFailureKind = "transport" | "balance" | "request" | "config"`;
  - `class InStreamError extends Error { readonly payload: unknown }`;
  - `classifyAiFailure(err: unknown): AiFailureKind`;
  - `countsTowardBreaker(kind: AiFailureKind): boolean`;
  - `class CircuitBreaker { constructor(opts?: { threshold?: number; windowMs?: number; cooldownMs?: number; now?: () => number }); isOpen(): boolean; recordFailure(): void; recordSuccess(): void }`.

- [ ] **Step 1: Write the failing test**

```ts
// server/lib/__tests__/ai-failure.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import OpenAI from "openai";
import {
  CircuitBreaker,
  InStreamError,
  classifyAiFailure,
  countsTowardBreaker,
} from "../ai-failure";

const apiError = (status: number, message: string, code?: string) =>
  OpenAI.APIError.generate(
    status,
    { error: { message, code } },
    message,
    new Headers(),
  );

describe("classifyAiFailure", () => {
  it.each([
    [500, "transport"],
    [502, "transport"],
    [503, "transport"],
    [429, "transport"],
    [402, "balance"],
    [400, "config"],
    [404, "config"],
    [422, "config"],
  ] as const)("status %i → %s", (status, kind) => {
    expect(classifyAiFailure(apiError(status, "boom"))).toBe(kind);
  });

  it("connection errors and timeouts are transport", () => {
    expect(
      classifyAiFailure(new OpenAI.APIConnectionError({ message: "x" })),
    ).toBe("transport");
    expect(classifyAiFailure(new OpenAI.APIConnectionTimeoutError())).toBe(
      "transport",
    );
  });

  it("an in-stream error is transport", () => {
    expect(classifyAiFailure(new InStreamError({ error: {} }))).toBe(
      "transport",
    );
  });

  it.each([
    ["This model's maximum context length is 128000 tokens", undefined],
    ["prompt too long", "context_length_exceeded"],
    ["The response was filtered due to content management policy", undefined],
    ["blocked", "content_filter"],
  ])("request-content 4xx: %s → request", (message, code) => {
    expect(classifyAiFailure(apiError(400, message, code))).toBe("request");
  });

  it("an unknown non-API error is transport", () => {
    expect(classifyAiFailure(new Error("socket hang up"))).toBe("transport");
  });

  it("only transport and balance count toward the breaker", () => {
    expect(countsTowardBreaker("transport")).toBe(true);
    expect(countsTowardBreaker("balance")).toBe(true);
    expect(countsTowardBreaker("config")).toBe(false);
    expect(countsTowardBreaker("request")).toBe(false);
  });
});

describe("CircuitBreaker", () => {
  const make = () => {
    let t = 1_000_000;
    const clock = { advance: (ms: number) => (t += ms) };
    const breaker = new CircuitBreaker({ now: () => t });
    return { breaker, clock };
  };

  it("opens after 5 failures within 60s", () => {
    const { breaker } = make();
    for (let i = 0; i < 4; i++) breaker.recordFailure();
    expect(breaker.isOpen()).toBe(false);
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(true);
  });

  it("failures older than the window do not count", () => {
    const { breaker, clock } = make();
    for (let i = 0; i < 4; i++) breaker.recordFailure();
    clock.advance(60_001);
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(false);
  });

  it("lets a trial through after 60s; success closes it", () => {
    const { breaker, clock } = make();
    for (let i = 0; i < 5; i++) breaker.recordFailure();
    clock.advance(59_999);
    expect(breaker.isOpen()).toBe(true);
    clock.advance(1);
    expect(breaker.isOpen()).toBe(false);
    breaker.recordSuccess();
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(false);
  });

  it("a failed trial reopens it immediately", () => {
    const { breaker, clock } = make();
    for (let i = 0; i < 5; i++) breaker.recordFailure();
    clock.advance(60_000);
    expect(breaker.isOpen()).toBe(false);
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(true);
  });
});
```

Before writing the implementation, check that `OpenAI.APIError.generate`, `OpenAI.APIConnectionError` and `OpenAI.APIConnectionTimeoutError` exist in the installed SDK: `grep -n "static generate\|class APIConnection" node_modules/openai/core/error.d.ts`. If `generate`'s signature differs, build the errors with `new OpenAI.APIError(status, { message, code }, message, new Headers())` instead. Keep the assertions identical either way.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run server/lib/__tests__/ai-failure.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// server/lib/ai-failure.ts
import OpenAI from "openai";

export type AiFailureKind = "transport" | "balance" | "request" | "config";

/** An OpenRouter SSE event carrying a top-level `error` / finish_reason "error" (HTTP 200). */
export class InStreamError extends Error {
  constructor(readonly payload: unknown) {
    super("OpenRouter in-stream error");
    this.name = "InStreamError";
  }
}

// 4xx caused by THIS request's content (spec §3.4) — warn, no Sentry, no breaker.
const REQUEST_CONTENT_PATTERNS = [
  /context[_ ]length/i,
  /maximum context/i,
  /too many tokens/i,
  /content[_ ]?filter/i,
  /content management policy/i,
];

export function classifyAiFailure(err: unknown): AiFailureKind {
  if (err instanceof InStreamError) return "transport";
  if (err instanceof OpenAI.APIError) {
    const status = err.status;
    if (status === undefined) return "transport"; // connection / timeout
    if (status === 402) return "balance";
    if (status === 429 || status >= 500) return "transport";
    const text = `${String(err.code ?? "")} ${err.message}`;
    return REQUEST_CONTENT_PATTERNS.some((p) => p.test(text))
      ? "request"
      : "config";
  }
  return "transport";
}

export function countsTowardBreaker(kind: AiFailureKind): boolean {
  return kind === "transport" || kind === "balance";
}

/** In-memory, per process (spec §3.4) — fine for one Railway service. */
export class CircuitBreaker {
  private failures: number[] = [];
  private openedAt: number | null = null;
  private readonly threshold: number;
  private readonly windowMs: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;

  constructor(
    opts: {
      threshold?: number;
      windowMs?: number;
      cooldownMs?: number;
      now?: () => number;
    } = {},
  ) {
    this.threshold = opts.threshold ?? 5;
    this.windowMs = opts.windowMs ?? 60_000;
    this.cooldownMs = opts.cooldownMs ?? 60_000;
    this.now = opts.now ?? Date.now;
  }

  isOpen(): boolean {
    if (this.openedAt === null) return false;
    return this.now() - this.openedAt < this.cooldownMs;
  }

  recordFailure(): void {
    const t = this.now();
    if (this.openedAt !== null) {
      // Failed trial after cooldown (or a straggler while open) → (re)open now.
      this.openedAt = t;
      return;
    }
    this.failures = this.failures.filter((f) => t - f < this.windowMs);
    this.failures.push(t);
    if (this.failures.length >= this.threshold) this.openedAt = t;
  }

  recordSuccess(): void {
    this.failures = [];
    this.openedAt = null;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run server/lib/__tests__/ai-failure.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** (`feat(ai): failure classification + circuit breaker`)

---

### Task 4: `aiChat`, non-streaming path

**Files:**

- Create: `server/lib/ai-client.ts`
- Test: `server/lib/__tests__/ai-client.test.ts`

**Interfaces:**

- Consumes:
  - Task 1: `AI_FEATURES`, `AiFeature`, `AiFeatureConfig`, `adaptParams`;
  - Task 2: `getAiCallContext`, `withAiCallContext`, `AiCallRecord`;
  - Task 3: `classifyAiFailure`, `countsTowardBreaker`, `CircuitBreaker`, `InStreamError`;
  - existing `openai` (`server/lib/openai.ts`);
  - `createServiceLogger`, `toError` (`server/lib/logger.ts`);
  - `reportError(error, context)` (`server/lib/error-reporter.ts`).
- Produces:
  - `OPENROUTER_BASE_URL`;
  - `type AiChatParams = Omit<ChatCompletionCreateParamsNonStreaming, "model">`;
  - `type AiChatStreamParams = Omit<ChatCompletionCreateParamsStreaming, "model">`;
  - `interface AiChatOptions { timeout?: number; signal?: AbortSignal }`;
  - `interface AiChatClient { chat: { completions: { create(body: Record<string, unknown>, options?: AiChatOptions): Promise<unknown> } } }`;
  - `interface AiChatDeps { openrouter: AiChatClient | null; fallback: AiChatClient; breaker: CircuitBreaker; report: (error: Error, context: string) => void; log: { info(obj: object, msg: string): void; warn(obj: object, msg: string): void } }`;
  - `createAiChat(deps: AiChatDeps): AiChat`;
  - `aiChat: AiChat`, the default instance;
  - re-export of `withAiCallContext`.
  - `AiChat` is overloaded:
    - `(feature, params: AiChatStreamParams, options?) => Promise<AsyncIterable<ChatCompletionChunk>>`;
    - `(feature, params: AiChatParams, options?) => Promise<ChatCompletion>`.

- [ ] **Step 1: Write the failing tests (non-streaming)**

```ts
// server/lib/__tests__/ai-client.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import OpenAI from "openai";
import { createAiChat, withAiCallContext } from "../ai-client";
import type { AiChatDeps } from "../ai-client";
import { CircuitBreaker } from "../ai-failure";
import type { AiCallContext } from "../ai-call-context";

vi.mock("../logger", () => ({
  createServiceLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
  toError: (e: unknown) => (e instanceof Error ? e : new Error(String(e))),
}));
vi.mock("../error-reporter", () => ({ reportError: vi.fn() }));
vi.mock("../openai", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
}));

const completion = (model: string, provider?: string) => ({
  id: "c1",
  object: "chat.completion",
  created: 0,
  model,
  provider,
  choices: [
    {
      index: 0,
      message: { role: "assistant", content: "hi" },
      finish_reason: "stop",
    },
  ],
  usage: {
    prompt_tokens: 1,
    completion_tokens: 1,
    total_tokens: 2,
    cost: 0.0001,
  },
});

const apiError = (status: number, message = "boom") =>
  OpenAI.APIError.generate(
    status,
    { error: { message } },
    message,
    new Headers(),
  );

function makeDeps(overrides: Partial<AiChatDeps> = {}) {
  const deps: AiChatDeps = {
    openrouter: { chat: { completions: { create: vi.fn() } } },
    fallback: { chat: { completions: { create: vi.fn() } } },
    breaker: new CircuitBreaker(),
    report: vi.fn(),
    log: { info: vi.fn(), warn: vi.fn() },
    ...overrides,
  };
  return deps;
}

const params = {
  messages: [{ role: "user" as const, content: "hello" }],
  temperature: 0.5,
  max_completion_tokens: 50,
};

describe("aiChat (non-streaming)", () => {
  let deps: AiChatDeps;
  beforeEach(() => {
    deps = makeDeps();
  });

  it("no OpenRouter key → today's client, fallback model, original params", async () => {
    deps = makeDeps({ openrouter: null });
    vi.mocked(deps.fallback.chat.completions.create).mockResolvedValue(
      completion("gpt-4o-mini"),
    );
    const aiChat = createAiChat(deps);
    await aiChat("coach-notebook-extract", params, { timeout: 15_000 });
    expect(deps.fallback.chat.completions.create).toHaveBeenCalledWith(
      { ...params, model: "gpt-4o-mini" },
      { timeout: 15_000 },
    );
  });

  it("key set → OpenRouter with the row model, zdr, adapted params", async () => {
    vi.mocked(deps.openrouter!.chat.completions.create).mockResolvedValue(
      completion("openai/gpt-4o-mini", "Azure"),
    );
    const aiChat = createAiChat(deps);
    const res = await aiChat("coach-notebook-extract", params);
    expect(res.model).toBe("openai/gpt-4o-mini");
    expect(deps.openrouter!.chat.completions.create).toHaveBeenCalledWith(
      { ...params, model: "openai/gpt-4o-mini", provider: { zdr: true } },
      undefined,
    );
    expect(deps.fallback.chat.completions.create).not.toHaveBeenCalled();
  });

  it.each([
    [apiError(503), "transport", true],
    [apiError(429), "transport", true],
    [new OpenAI.APIConnectionTimeoutError(), "transport", true],
    [apiError(402), "balance", true],
    [apiError(400, "unsupported parameter: temperature"), "config", false],
    [apiError(400, "maximum context length exceeded"), "request", false],
  ] as const)(
    "failure %# → fallback with ORIGINAL params (%s)",
    async (err, kind, counts) => {
      vi.mocked(deps.openrouter!.chat.completions.create).mockRejectedValue(
        err,
      );
      vi.mocked(deps.fallback.chat.completions.create).mockResolvedValue(
        completion("gpt-4o-mini"),
      );
      const spy = vi.spyOn(deps.breaker, "recordFailure");
      const aiChat = createAiChat(deps);
      await aiChat("coach-notebook-extract", params);
      expect(deps.fallback.chat.completions.create).toHaveBeenCalledWith(
        { ...params, model: "gpt-4o-mini" },
        undefined,
      );
      expect(spy).toHaveBeenCalledTimes(counts ? 1 : 0);
      expect(deps.log.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          feature: "coach-notebook-extract",
          fallbackReason: kind,
        }),
        expect.any(String),
      );
    },
  );

  it("402 raises the balance alert; config 4xx raises the config alert; request 4xx raises none", async () => {
    const aiChat = createAiChat(deps);
    vi.mocked(deps.fallback.chat.completions.create).mockResolvedValue(
      completion("gpt-4o-mini"),
    );
    const create = vi.mocked(deps.openrouter!.chat.completions.create);

    create.mockRejectedValueOnce(apiError(402));
    await aiChat("coach-notebook-extract", params);
    expect(vi.mocked(deps.report).mock.calls.at(-1)![0].message).toMatch(
      /balance exhausted/i,
    );

    create.mockRejectedValueOnce(apiError(400, "unknown model"));
    await aiChat("coach-notebook-extract", params);
    expect(vi.mocked(deps.report).mock.calls.at(-1)![0].message).toMatch(
      /AI config error: coach-notebook-extract/,
    );

    vi.mocked(deps.report).mockClear();
    create.mockRejectedValueOnce(apiError(400, "content_filter triggered"));
    await aiChat("coach-notebook-extract", params);
    expect(deps.report).not.toHaveBeenCalled();
  });

  it("an aborted call re-throws without fallback", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.mocked(deps.openrouter!.chat.completions.create).mockRejectedValue(
      new OpenAI.APIUserAbortError(),
    );
    const aiChat = createAiChat(deps);
    await expect(
      aiChat("coach-notebook-extract", params, { signal: controller.signal }),
    ).rejects.toBeInstanceOf(OpenAI.APIUserAbortError);
    expect(deps.fallback.chat.completions.create).not.toHaveBeenCalled();
  });

  it("an open breaker skips OpenRouter entirely", async () => {
    for (let i = 0; i < 5; i++) deps.breaker.recordFailure();
    vi.mocked(deps.fallback.chat.completions.create).mockResolvedValue(
      completion("gpt-4o-mini"),
    );
    const aiChat = createAiChat(deps);
    await aiChat("coach-notebook-extract", params);
    expect(deps.openrouter!.chat.completions.create).not.toHaveBeenCalled();
    expect(deps.log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackReason: "circuit-open" }),
      expect.any(String),
    );
  });

  it("success logs feature, requested/answered model, provider and cost", async () => {
    vi.mocked(deps.openrouter!.chat.completions.create).mockResolvedValue(
      completion("openai/gpt-4o-mini", "Azure"),
    );
    const aiChat = createAiChat(deps);
    await aiChat("coach-notebook-extract", params);
    expect(deps.log.info).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "coach-notebook-extract",
        provider: "openrouter",
        requestedModel: "openai/gpt-4o-mini",
        answeredModel: "openai/gpt-4o-mini",
        answeredProvider: "Azure",
        cost: 0.0001,
      }),
      expect.any(String),
    );
  });
});

describe("aiChat inside a call context", () => {
  const ctx = (over: Partial<AiCallContext> = {}): AiCallContext => ({
    overrides: {},
    fallback: "off",
    calls: [],
    ...over,
  });

  it("applies the override model + set and records the call", async () => {
    const deps = makeDeps();
    vi.mocked(deps.openrouter!.chat.completions.create).mockResolvedValue(
      completion("openai/gpt-6-luna", "Azure"),
    );
    const aiChat = createAiChat(deps);
    const c = ctx({
      overrides: {
        "coach-notebook-extract": {
          model: "openai/gpt-6-luna",
          set: { reasoning_effort: "low" },
        },
      },
    });
    await withAiCallContext(c, () => aiChat("coach-notebook-extract", params));
    expect(deps.openrouter!.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "openai/gpt-6-luna",
        reasoning_effort: "low",
      }),
      undefined,
    );
    expect(c.calls).toEqual([
      {
        feature: "coach-notebook-extract",
        requestedModel: "openai/gpt-6-luna",
        answeredModel: "openai/gpt-6-luna",
        answeredProvider: "Azure",
        fellBack: false,
      },
    ]);
  });

  it("fallback off → an OpenRouter failure throws (no silent fallback)", async () => {
    const deps = makeDeps();
    vi.mocked(deps.openrouter!.chat.completions.create).mockRejectedValue(
      apiError(503),
    );
    const aiChat = createAiChat(deps);
    await expect(
      withAiCallContext(ctx(), () => aiChat("coach-notebook-extract", params)),
    ).rejects.toThrow();
    expect(deps.fallback.chat.completions.create).not.toHaveBeenCalled();
  });

  it("fallback off with no key throws a clear error", async () => {
    const deps = makeDeps({ openrouter: null });
    const aiChat = createAiChat(deps);
    await expect(
      withAiCallContext(ctx(), () => aiChat("coach-notebook-extract", params)),
    ).rejects.toThrow(/OPENROUTER_API_KEY is required when fallback is off/);
    expect(deps.fallback.chat.completions.create).not.toHaveBeenCalled();
  });

  it("fallback off ignores an open breaker (eval runs always hit OpenRouter)", async () => {
    const deps = makeDeps();
    for (let i = 0; i < 5; i++) deps.breaker.recordFailure();
    vi.mocked(deps.openrouter!.chat.completions.create).mockResolvedValue(
      completion("openai/gpt-4o-mini"),
    );
    const aiChat = createAiChat(deps);
    await withAiCallContext(ctx(), () =>
      aiChat("coach-notebook-extract", params),
    );
    expect(deps.openrouter!.chat.completions.create).toHaveBeenCalled();
  });

  it("overrides apply even under NODE_ENV=production (aiChat never reads NODE_ENV)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const deps = makeDeps();
    vi.mocked(deps.openrouter!.chat.completions.create).mockResolvedValue(
      completion("openai/gpt-6-luna"),
    );
    const aiChat = createAiChat(deps);
    const c = ctx({
      overrides: { "coach-notebook-extract": { model: "openai/gpt-6-luna" } },
    });
    await withAiCallContext(c, () => aiChat("coach-notebook-extract", params));
    expect(deps.openrouter!.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({ model: "openai/gpt-6-luna" }),
      undefined,
    );
    vi.unstubAllEnvs();
  });

  it("no context → no overrides applied and nothing recorded", async () => {
    const deps = makeDeps();
    vi.mocked(deps.openrouter!.chat.completions.create).mockResolvedValue(
      completion("openai/gpt-4o-mini"),
    );
    const aiChat = createAiChat(deps);
    await aiChat("coach-notebook-extract", params);
    expect(deps.openrouter!.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({ model: "openai/gpt-4o-mini" }),
      undefined,
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run server/lib/__tests__/ai-client.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement (non-streaming; streaming lands in Task 5)**

```ts
// server/lib/ai-client.ts
/**
 * The single entry point for chat/vision completions (spec §3.2). Routes via
 * OpenRouter (zero-data-retention) when OPENROUTER_API_KEY is set, else via
 * today's OpenAI client; falls back per spec §3.4. Never call
 * `chat.completions.create` elsewhere — ocrecipes/no-direct-chat-completions.
 */
import OpenAI from "openai";
import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
} from "openai/resources/chat/completions";
import { AI_FEATURES, adaptParams } from "./ai-models";
import type { AiFeature, AiFeatureConfig } from "./ai-models";
import { getAiCallContext, withAiCallContext } from "./ai-call-context";
import type { AiCallContext } from "./ai-call-context";
import {
  CircuitBreaker,
  InStreamError,
  classifyAiFailure,
  countsTowardBreaker,
} from "./ai-failure";
import type { AiFailureKind } from "./ai-failure";
import { openai } from "./openai";
import { createServiceLogger } from "./logger";
import { reportError } from "./error-reporter";

export { withAiCallContext };

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export type AiChatParams = Omit<
  ChatCompletionCreateParamsNonStreaming,
  "model"
>;
export type AiChatStreamParams = Omit<
  ChatCompletionCreateParamsStreaming,
  "model"
>;
export interface AiChatOptions {
  timeout?: number;
  signal?: AbortSignal;
}

export interface AiChatClient {
  chat: {
    completions: {
      create(
        body: Record<string, unknown>,
        options?: AiChatOptions,
      ): Promise<unknown>;
    };
  };
}

export interface AiChatDeps {
  openrouter: AiChatClient | null;
  fallback: AiChatClient;
  breaker: CircuitBreaker;
  report: (error: Error, context: string) => void;
  log: {
    info(obj: object, msg: string): void;
    warn(obj: object, msg: string): void;
  };
}

export interface AiChat {
  (
    feature: AiFeature,
    params: AiChatStreamParams,
    options?: AiChatOptions,
  ): Promise<AsyncIterable<ChatCompletionChunk>>;
  (
    feature: AiFeature,
    params: AiChatParams,
    options?: AiChatOptions,
  ): Promise<ChatCompletion>;
}

type FallbackReason = AiFailureKind | "no-key" | "circuit-open";

/** OpenRouter adds `provider` and `usage.cost` to the OpenAI response shape. */
function answeredProvider(res: unknown): string | null {
  const p = (res as { provider?: unknown }).provider;
  return typeof p === "string" ? p : null;
}
function usageCost(res: unknown): number | undefined {
  const c = (res as { usage?: { cost?: unknown } }).usage?.cost;
  return typeof c === "number" ? c : undefined;
}

function isAbort(err: unknown, options?: AiChatOptions): boolean {
  return (
    options?.signal?.aborted === true || err instanceof OpenAI.APIUserAbortError
  );
}

export function createAiChat(deps: AiChatDeps): AiChat {
  async function run(
    feature: AiFeature,
    params: AiChatParams | AiChatStreamParams,
    options?: AiChatOptions,
  ): Promise<ChatCompletion | AsyncIterable<ChatCompletionChunk>> {
    const row: AiFeatureConfig = AI_FEATURES[feature];
    const ctx: AiCallContext | undefined = getAiCallContext();
    const override = ctx?.overrides[feature];
    const requestedModel = override?.model ?? row.model;
    const fallbackAllowed = ctx?.fallback !== "off";
    const streaming = params.stream === true;

    const record = (
      answeredModel: string | null,
      provider: string | null,
      fellBack: boolean,
    ) => {
      ctx?.calls.push({
        feature,
        requestedModel,
        answeredModel,
        answeredProvider: provider,
        fellBack,
      });
    };

    const callFallback = async (reason: FallbackReason) => {
      deps.log.warn(
        {
          feature,
          provider: "fallback",
          requestedModel,
          fallbackModel: row.fallback,
          fallbackReason: reason,
        },
        "ai call using fallback",
      );
      const res = await deps.fallback.chat.completions.create(
        { ...params, model: row.fallback },
        options,
      );
      record(
        streaming ? row.fallback : (res as ChatCompletion).model,
        "openai-direct",
        true,
      );
      return res as ChatCompletion | AsyncIterable<ChatCompletionChunk>;
    };

    if (!deps.openrouter) {
      if (!fallbackAllowed) {
        throw new Error(
          `aiChat(${feature}): OPENROUTER_API_KEY is required when fallback is off`,
        );
      }
      // Today's path, byte-for-byte: no warn — this is the normal no-key state.
      const res = await deps.fallback.chat.completions.create(
        { ...params, model: row.fallback },
        options,
      );
      return res as ChatCompletion | AsyncIterable<ChatCompletionChunk>;
    }

    if (fallbackAllowed && deps.breaker.isOpen())
      return callFallback("circuit-open");

    const body = {
      ...adaptParams(
        params as unknown as Record<string, unknown>,
        row.adapt,
        override?.set,
      ),
      model: requestedModel,
      provider: { zdr: true },
    };

    try {
      if (streaming) {
        return await openStream(feature, requestedModel, body, options, record); // Task 5
      }
      const res = await deps.openrouter.chat.completions.create(body, options);
      deps.breaker.recordSuccess();
      const completion = res as ChatCompletion;
      const provider = answeredProvider(res);
      record(completion.model, provider, false);
      deps.log.info(
        {
          feature,
          provider: "openrouter",
          requestedModel,
          answeredModel: completion.model,
          answeredProvider: provider,
          cost: usageCost(res),
        },
        "ai call",
      );
      return completion;
    } catch (err) {
      if (isAbort(err, options)) throw err;
      const kind = classifyAiFailure(err);
      if (countsTowardBreaker(kind)) deps.breaker.recordFailure();
      const message = err instanceof Error ? err.message : String(err);
      if (kind === "balance") {
        deps.report(
          new Error(
            "OpenRouter balance exhausted (402) — AI traffic is on the OpenAI fallback",
          ),
          "ai-client",
        );
      } else if (kind === "config") {
        const status = err instanceof OpenAI.APIError ? err.status : undefined;
        deps.report(
          new Error(
            `AI config error: ${feature} (${String(status)}): ${message}`,
          ),
          "ai-client",
        );
      }
      if (!fallbackAllowed) throw err;
      return callFallback(kind);
    }
  }

  // Placeholder replaced in Task 5 — streaming is not routed yet.
  async function openStream(
    ..._args: unknown[]
  ): Promise<AsyncIterable<ChatCompletionChunk>> {
    throw new Error("aiChat streaming lands in Task 5");
  }

  return run as AiChat;
}

function defaultDeps(): AiChatDeps {
  const key = process.env.OPENROUTER_API_KEY;
  return {
    openrouter: key
      ? (new OpenAI({
          apiKey: key,
          baseURL: OPENROUTER_BASE_URL,
          defaultHeaders: { "X-Title": "OCRecipes" },
        }) as unknown as AiChatClient)
      : null,
    fallback: openai as unknown as AiChatClient,
    breaker: new CircuitBreaker(),
    report: (error, context) => reportError(error, context),
    log: createServiceLogger("ai-client"),
  };
}

export const aiChat: AiChat = createAiChat(defaultDeps());
```

The `openStream` stub exists only so this task's file compiles. Task 5 replaces it in the same PR, and no service imports `aiChat` before PR 2, so the stub never reaches users. If `checkCallRecords` (Task 12) or a reviewer objects to the stub, merge Tasks 4 and 5 into one commit.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run server/lib/__tests__/ai-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** (`feat(ai): aiChat helper — routing, fallback, alerts, call context`)

---

### Task 5: `aiChat` streaming path

**Files:**

- Modify: `server/lib/ai-client.ts` (replace the `openStream` stub)
- Test: `server/lib/__tests__/ai-client.test.ts` (add a `describe`)

**Interfaces:**

- Consumes: Task 4 internals, and `InStreamError` (Task 3).
- Produces: streaming `aiChat` returns `AsyncIterable<ChatCompletionChunk>` that:
  - replays the peeked first chunk;
  - throws `InStreamError` on a later `finish_reason: "error"` chunk;
  - logs `{ feature, answeredModel, answeredProvider, cost, completed }` at the end.

- [ ] **Step 1: Write the failing tests**

Add to `server/lib/__tests__/ai-client.test.ts`:

```ts
const chunk = (
  content: string | null,
  extra: Record<string, unknown> = {},
) => ({
  id: "s1",
  object: "chat.completion.chunk",
  created: 0,
  model: "openai/gpt-4o-mini",
  provider: "Azure",
  choices: [
    {
      index: 0,
      delta: content === null ? { role: "assistant" } : { content },
      finish_reason: null,
    },
  ],
  ...extra,
});

function fakeStream(items: Array<object | Error>) {
  const returned = { value: false };
  const iterable = {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next() {
          if (i >= items.length) return { done: true, value: undefined };
          const item = items[i++];
          if (item instanceof Error) throw item;
          return { done: false, value: item };
        },
        async return() {
          returned.value = true;
          return { done: true, value: undefined };
        },
      };
    },
  };
  return { iterable, returned };
}

async function collect(
  stream: AsyncIterable<{ choices: { delta: { content?: string | null } }[] }>,
) {
  let text = "";
  for await (const c of stream) text += c.choices[0]?.delta?.content ?? "";
  return text;
}

describe("aiChat (streaming)", () => {
  const sparams = { ...params, stream: true as const };

  it("replays the peeked first chunk and passes the rest through", async () => {
    const deps = makeDeps();
    const { iterable } = fakeStream([chunk("Hel"), chunk("lo")]);
    vi.mocked(deps.openrouter!.chat.completions.create).mockResolvedValue(
      iterable,
    );
    const aiChat = createAiChat(deps);
    expect(await collect(await aiChat("coach-chat", sparams))).toBe("Hello");
  });

  it("a role-only first chunk counts as received", async () => {
    const deps = makeDeps();
    const { iterable } = fakeStream([
      chunk(null),
      chunk("x"),
      new Error("mid-stream"),
    ]);
    vi.mocked(deps.openrouter!.chat.completions.create).mockResolvedValue(
      iterable,
    );
    const aiChat = createAiChat(deps);
    const stream = await aiChat("coach-chat", sparams);
    await expect(collect(stream)).rejects.toThrow("mid-stream");
    expect(deps.fallback.chat.completions.create).not.toHaveBeenCalled();
  });

  it("an HTTP error before any chunk falls back", async () => {
    const deps = makeDeps();
    vi.mocked(deps.openrouter!.chat.completions.create).mockRejectedValue(
      apiError(503),
    );
    const { iterable } = fakeStream([chunk("fallback")]);
    vi.mocked(deps.fallback.chat.completions.create).mockResolvedValue(
      iterable,
    );
    const aiChat = createAiChat(deps);
    expect(await collect(await aiChat("coach-chat", sparams))).toBe("fallback");
  });

  it("an in-stream error as the FIRST event falls back", async () => {
    const deps = makeDeps();
    const { iterable } = fakeStream([
      {
        ...chunk(""),
        error: { code: "server_error" },
        choices: [{ index: 0, delta: { content: "" }, finish_reason: "error" }],
      },
    ]);
    vi.mocked(deps.openrouter!.chat.completions.create).mockResolvedValue(
      iterable,
    );
    const fb = fakeStream([chunk("ok")]);
    vi.mocked(deps.fallback.chat.completions.create).mockResolvedValue(
      fb.iterable,
    );
    const aiChat = createAiChat(deps);
    expect(await collect(await aiChat("coach-chat", sparams))).toBe("ok");
  });

  it("the first next() throwing (SDK-raised SSE error) falls back", async () => {
    const deps = makeDeps();
    const { iterable } = fakeStream([new Error("provider disconnected")]);
    vi.mocked(deps.openrouter!.chat.completions.create).mockResolvedValue(
      iterable,
    );
    const fb = fakeStream([chunk("ok")]);
    vi.mocked(deps.fallback.chat.completions.create).mockResolvedValue(
      fb.iterable,
    );
    const aiChat = createAiChat(deps);
    expect(await collect(await aiChat("coach-chat", sparams))).toBe("ok");
  });

  it("an in-stream error AFTER the first chunk is thrown to the caller (no fallback)", async () => {
    const deps = makeDeps();
    const { iterable } = fakeStream([
      chunk("a"),
      {
        ...chunk(""),
        error: { code: "server_error" },
        choices: [{ index: 0, delta: { content: "" }, finish_reason: "error" }],
      },
    ]);
    vi.mocked(deps.openrouter!.chat.completions.create).mockResolvedValue(
      iterable,
    );
    const aiChat = createAiChat(deps);
    await expect(collect(await aiChat("coach-chat", sparams))).rejects.toThrow(
      /in-stream error/,
    );
    expect(deps.fallback.chat.completions.create).not.toHaveBeenCalled();
  });

  it("abort while peeking re-throws without fallback", async () => {
    const deps = makeDeps();
    const controller = new AbortController();
    const { iterable } = fakeStream([new OpenAI.APIUserAbortError()]);
    vi.mocked(deps.openrouter!.chat.completions.create).mockImplementation(
      async () => {
        controller.abort();
        return iterable;
      },
    );
    const aiChat = createAiChat(deps);
    await expect(
      aiChat("coach-chat", sparams, { signal: controller.signal }),
    ).rejects.toBeInstanceOf(OpenAI.APIUserAbortError);
    expect(deps.fallback.chat.completions.create).not.toHaveBeenCalled();
  });

  it("early consumer exit closes the source stream and logs completed:false", async () => {
    const deps = makeDeps();
    const { iterable, returned } = fakeStream([
      chunk("a"),
      chunk("b"),
      chunk("c"),
    ]);
    vi.mocked(deps.openrouter!.chat.completions.create).mockResolvedValue(
      iterable,
    );
    const aiChat = createAiChat(deps);
    for await (const _c of await aiChat("coach-chat", sparams)) break;
    expect(returned.value).toBe(true);
    expect(deps.log.info).toHaveBeenCalledWith(
      expect.objectContaining({ feature: "coach-chat", completed: false }),
      expect.any(String),
    );
  });

  it("logs usage cost from the last chunk and records the call at stream end", async () => {
    const deps = makeDeps();
    const { iterable } = fakeStream([
      chunk("a"),
      {
        ...chunk(null),
        choices: [],
        usage: {
          prompt_tokens: 1,
          completion_tokens: 1,
          total_tokens: 2,
          cost: 0.002,
        },
      },
    ]);
    vi.mocked(deps.openrouter!.chat.completions.create).mockResolvedValue(
      iterable,
    );
    const aiChat = createAiChat(deps);
    const c: AiCallContext = { overrides: {}, fallback: "off", calls: [] };
    await withAiCallContext(c, async () => {
      const stream = await aiChat("coach-chat", sparams);
      expect(c.calls).toHaveLength(0); // not yet — written at stream end
      await collect(stream);
    });
    expect(c.calls).toEqual([
      {
        feature: "coach-chat",
        requestedModel: "openai/gpt-4o-mini",
        answeredModel: "openai/gpt-4o-mini",
        answeredProvider: "Azure",
        fellBack: false,
      },
    ]);
    expect(deps.log.info).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "coach-chat",
        cost: 0.002,
        completed: true,
      }),
      expect.any(String),
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run server/lib/__tests__/ai-client.test.ts -t streaming`
Expected: FAIL ("aiChat streaming lands in Task 5").

- [ ] **Step 3: Implement**

In `createAiChat`, replace the `openStream` stub with the following. It closes over `deps`, so it lives inside `createAiChat`. `isErrorChunk` and `wrapStream` sit at module level:

```ts
async function openStream(
  feature: AiFeature,
  requestedModel: string,
  body: Record<string, unknown>,
  options: AiChatOptions | undefined,
  record: (
    answeredModel: string | null,
    provider: string | null,
    fellBack: boolean,
  ) => void,
): Promise<AsyncIterable<ChatCompletionChunk>> {
  const source = (await deps.openrouter!.chat.completions.create(
    body,
    options,
  )) as AsyncIterable<ChatCompletionChunk>;
  const iterator = source[Symbol.asyncIterator]();
  // Peek: any SSE event — role-only or tool-call deltas included — counts as
  // "the caller has received something" once we return (spec §3.5).
  const first = await iterator.next();
  if (!first.done && isErrorChunk(first.value)) {
    await iterator.return?.();
    throw new InStreamError(first.value);
  }
  deps.breaker.recordSuccess();
  return wrapStream(iterator, first, (summary) => {
    record(summary.answeredModel, summary.answeredProvider, false);
    deps.log.info(
      { feature, provider: "openrouter", requestedModel, ...summary },
      "ai stream",
    );
  });
}
```

At module level, below `isAbort`:

```ts
function isErrorChunk(chunk: unknown): boolean {
  const c = chunk as {
    error?: unknown;
    choices?: { finish_reason?: string | null }[];
  };
  return c.error !== undefined || c.choices?.[0]?.finish_reason === "error";
}

interface StreamSummary {
  answeredModel: string | null;
  answeredProvider: string | null;
  cost: number | undefined;
  completed: boolean;
}

async function* wrapStream(
  iterator: AsyncIterator<ChatCompletionChunk>,
  first: IteratorResult<ChatCompletionChunk>,
  onEnd: (summary: StreamSummary) => void,
): AsyncGenerator<ChatCompletionChunk> {
  const summary: StreamSummary = {
    answeredModel: null,
    answeredProvider: null,
    cost: undefined,
    completed: false,
  };
  const note = (c: ChatCompletionChunk) => {
    summary.answeredModel ??= c.model ?? null;
    summary.answeredProvider ??= answeredProvider(c);
    summary.cost = usageCost(c) ?? summary.cost;
  };
  try {
    if (!first.done) {
      note(first.value);
      yield first.value;
    }
    for (;;) {
      const next = await iterator.next();
      if (next.done) break;
      if (isErrorChunk(next.value)) throw new InStreamError(next.value);
      note(next.value);
      yield next.value;
    }
    summary.completed = true;
  } finally {
    if (!summary.completed) await iterator.return?.();
    onEnd(summary);
  }
}
```

Behavior notes:

- When the first `iterator.next()` throws (the SDK raises an SSE `error` event as an `APIError`), the exception propagates out of `openStream` into `run`'s `catch`. There it is classified, the breaker counts it, and the call falls back if allowed. That is the "before the caller has received anything" rule.
- An abort during the peek also reaches the `catch` and is re-thrown, because `isAbort` checks the signal.
- In `callFallback`, a streaming fallback returns the raw OpenAI stream unchanged (today's behavior) and records `fellBack: true` immediately.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run server/lib/__tests__/ai-client.test.ts`
Expected: PASS (all non-streaming and streaming tests).

- [ ] **Step 5: Commit** (`feat(ai): streaming — peek-then-fallback, replay wrapper, end-of-stream usage`)

---

### Task 6: Environment variable

**Files:**

- Modify: `server/lib/env.ts:24-25` (schema)
- Modify: `server/__tests__/README.md` (env table near line 132)
- Test: `server/lib/__tests__/env.test.ts`

- [ ] **Step 1: Write the failing test.** Add to `env.test.ts`, following its existing `validateEnv` pattern. Read the file first and copy how it builds a minimal valid env:

```ts
it("accepts an optional OPENROUTER_API_KEY and passes it through", () => {
  const env = validateEnv({
    ...minimalValidEnv,
    OPENROUTER_API_KEY: "sk-or-test",
  });
  expect(env.OPENROUTER_API_KEY).toBe("sk-or-test");
});

it("OPENROUTER_API_KEY is optional", () => {
  const env = validateEnv({ ...minimalValidEnv });
  expect(env.OPENROUTER_API_KEY).toBeUndefined();
});
```

(If `validateEnv` reads `process.env` and takes no argument, use `vi.stubEnv` as the file's other tests do. Keep the two assertions.)

- [ ] **Step 2: Run:** `npx vitest run server/lib/__tests__/env.test.ts`. Expected: FAIL (the key is stripped or undefined).

- [ ] **Step 3: Implement.** In `server/lib/env.ts`, after `AI_INTEGRATIONS_OPENAI_BASE_URL`:

```ts
  // OpenRouter — routes AI chat/vision (server/lib/ai-client.ts). Unset ⇒ today's OpenAI path.
  OPENROUTER_API_KEY: z.string().optional(),
```

In `server/__tests__/README.md`, add a row under `AI_INTEGRATIONS_OPENAI_BASE_URL`:

```md
| `OPENROUTER_API_KEY` | No | Routes AI chat/vision via OpenRouter (unset ⇒ OpenAI direct) |
```

Also make the empty-string-means-unset rule explicit in `ai-client.ts` `defaultDeps`: change `const key = process.env.OPENROUTER_API_KEY;` to `const key = process.env.OPENROUTER_API_KEY?.trim() || undefined;`. Then add this test to `ai-client.test.ts`:

```ts
it("an empty OPENROUTER_API_KEY is treated as unset", async () => {
  vi.stubEnv("OPENROUTER_API_KEY", "  ");
  vi.resetModules();
  const mod = await import("../ai-client");
  const { openai } = await import("../openai");
  vi.mocked(openai.chat.completions.create).mockResolvedValue(
    completion("gpt-4o-mini") as never,
  );
  await mod.aiChat("coach-notebook-extract", params);
  expect(openai.chat.completions.create).toHaveBeenCalledWith(
    expect.objectContaining({ model: "gpt-4o-mini" }),
    undefined,
  );
  vi.unstubAllEnvs();
});
```

The `as never` in this test is banned by lint. Replace it with `as unknown as Awaited<ReturnType<typeof openai.chat.completions.create>>`.

- [ ] **Step 4: Run:** `npx vitest run server/lib/__tests__/env.test.ts server/lib/__tests__/ai-client.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit** (`feat(ai): OPENROUTER_API_KEY env`)

---

### Task 7: Lint rule `no-direct-chat-completions` (rule only, registered in Task 10)

**Files:**

- Modify: `eslint-plugin-ocrecipes/index.js` (new rule plus export)
- Test: `eslint-plugin-ocrecipes/__tests__/rules.test.ts`

**Interfaces:**

- Produces: the rule `ocrecipes/no-direct-chat-completions`. It flags any `CallExpression` whose callee is a member chain ending in `.chat.completions.create`. It allows the file `server/lib/ai-client.ts`. Type positions (`typeof x.chat.completions.create`) are not `CallExpression`s, so they never match.

- [ ] **Step 1: Write the failing test.** Add to `rules.test.ts`, using the file's `tester` and `abs()` helpers:

```ts
tester.run(
  "no-direct-chat-completions",
  plugin.rules["no-direct-chat-completions"],
  {
    valid: [
      {
        code: "await aiChat('coach-chat', params);",
        filename: abs("server/services/x.ts"),
      },
      {
        code: "await openai.audio.transcriptions.create({ file });",
        filename: abs("server/services/voice-transcription.ts"),
      },
      {
        code: "await dalleClient.images.generate({ prompt });",
        filename: abs("server/services/recipe-generation.ts"),
      },
      {
        code: "await deps.openrouter.chat.completions.create(body);",
        filename: abs("server/lib/ai-client.ts"),
      },
      {
        code: "type M = Parameters<typeof openai.chat.completions.create>[0];",
        filename: abs("server/services/nutrition-coach.ts"),
      },
    ],
    invalid: [
      {
        code: "await openai.chat.completions.create({ model: 'gpt-4o', messages });",
        filename: abs("server/services/x.ts"),
        errors: [{ messageId: "useAiChat" }],
      },
      {
        code: "await client.chat.completions.create(body);",
        filename: abs("server/scripts/seed-recipes.ts"),
        errors: [{ messageId: "useAiChat" }],
      },
    ],
  },
);
```

- [ ] **Step 2: Run:** `npx vitest run eslint-plugin-ocrecipes/__tests__/rules.test.ts -t no-direct-chat-completions`. Expected: FAIL (the rule is undefined).

- [ ] **Step 3: Implement.** Add above `// ─── Plugin export`:

```js
// ─── no-direct-chat-completions ─────────────────────────────────────────────
// Every chat/vision completion goes through aiChat() (server/lib/ai-client.ts)
// so the per-feature model table, OpenRouter routing and fallback apply
// (OpenRouter routing spec §3.8). Matches the CALL, not the import, so
// audio.transcriptions / images.generate on the openai client stay legal.
const AI_CLIENT_FILE = "server/lib/ai-client.ts";
const noDirectChatCompletions = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow direct chat.completions.create — use aiChat()",
    },
    messages: {
      useAiChat:
        "Call aiChat(feature, params) from server/lib/ai-client.ts instead of chat.completions.create (add a row to server/lib/ai-models.ts).",
    },
    schema: [],
  },
  create(context) {
    const rel = toRepoRelative(context.filename ?? context.getFilename());
    if (rel === AI_CLIENT_FILE) return {};
    return {
      CallExpression(node) {
        const c = node.callee;
        if (
          c.type === "MemberExpression" &&
          c.property.type === "Identifier" &&
          c.property.name === "create" &&
          c.object.type === "MemberExpression" &&
          c.object.property.type === "Identifier" &&
          c.object.property.name === "completions" &&
          c.object.object.type === "MemberExpression" &&
          c.object.object.property.type === "Identifier" &&
          c.object.object.property.name === "chat"
        ) {
          context.report({ node, messageId: "useAiChat" });
        }
      },
    };
  },
};
```

Register it in `module.exports.rules`: `"no-direct-chat-completions": noDirectChatCompletions,`.

The file already has a repo-root-anchored path helper (the test header mentions `toRepoRelative`). Find it with `grep -n "function toRepoRelative" eslint-plugin-ocrecipes/index.js` and use it exactly as the existing rules do. If its name differs, use the existing name.

- [ ] **Step 4: Run:** the same command. Expected: PASS.

- [ ] **Step 5: Commit** (`feat(lint): ocrecipes/no-direct-chat-completions rule (not yet enabled)`)

**→ Open PR 1 (Tasks 1–7).** Reviewers: code-reviewer, server-reviewer, ai-reviewer, security-auditor. Human review; no auto-merge.

---

### Task 8: Migrate the streaming and coach call sites (PR 2)

**Files (call sites):**

| File                                     | Line | Feature                                               |
| ---------------------------------------- | ---- | ----------------------------------------------------- |
| `server/services/nutrition-coach.ts`     | :554 | `coach-chat`                                          |
| `server/services/nutrition-coach.ts`     | :679 | `coach-pro-chat` (plus the `typeof` type ref at :684) |
| `server/services/notebook-extraction.ts` | :94  | `coach-notebook-extract`                              |
| `server/services/recipe-chat.ts`         | :383 | `recipe-chat`                                         |
| `server/services/recipe-chat.ts`         | :519 | `recipe-chat-image`                                   |

**Tests:**

- `server/services/__tests__/nutrition-coach.test.ts`
- `server/services/__tests__/recipe-chat*.test.ts`
- `server/services/__tests__/notebook-extraction*.test.ts`

Run `ls server/services/__tests__ | grep -E "nutrition-coach|recipe-chat|notebook"` to get the exact files.

**Interfaces:**

- Consumes: `aiChat`, `AiFeature` (Tasks 1–5).

**Mechanical recipe (apply to each call site and its tests):**

1. **Test first.** In each test file:
   - Replace `vi.mock("../../lib/openai", () => ({ openai: { chat: { completions: { create: vi.fn() } } } , ... }))` with a mock of `../../lib/ai-client`:
     ```ts
     vi.mock("../../lib/ai-client", () => ({ aiChat: vi.fn() }));
     import { aiChat } from "../../lib/ai-client";
     ```
     Keep any other exports the file still mocks from `lib/openai` (e.g. `isAiConfigured`, timeouts) in a separate `vi.mock("../../lib/openai", ...)` that no longer includes `openai.chat`.
   - Rewrite `vi.mocked(openai.chat.completions.create)` → `vi.mocked(aiChat)`.
   - Rewrite argument assertions. The old `mock.calls[0][0]` (body) becomes `mock.calls[0][1]`, `mock.calls[0][1]` (options) becomes `mock.calls[0][2]`, and add `expect(vi.mocked(aiChat).mock.calls[0][0]).toBe("<feature>")`.
   - Delete assertions on `body.model` (the model now comes from the table) and replace them with the feature-name assertion.
   - **Change no behavior assertions.** The same messages, temperature, tokens, stream flag and options must be asserted.
2. **Run the file's tests.** They must FAIL, because the service still calls `openai.chat.completions.create`.
3. **Change the call site:**
   ```ts
   // before
   stream = await openai.chat.completions.create(
     { model: MODEL_FAST, stream: true, messages: [...], max_completion_tokens: 1500, temperature: 0.5 },
     { timeout: OPENAI_TIMEOUT_STREAM_MS, signal: abortSignal },
   );
   // after
   stream = await aiChat(
     "coach-chat",
     { stream: true, messages: [...], max_completion_tokens: 1500, temperature: 0.5 },
     { timeout: OPENAI_TIMEOUT_STREAM_MS, signal: abortSignal },
   );
   ```

   - Update imports: drop `MODEL_FAST`/`MODEL_HEAVY` and `openai` if now unused; add `import { aiChat } from "../lib/ai-client";`. Keep timeout imports from `../lib/openai`.
   - For `coach-pro-chat`, replace the type reference
     `conversation as Parameters<typeof openai.chat.completions.create>[0]["messages"]` with
     `conversation as ChatCompletionMessageParam[]`, importing `import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";`.
4. **Run the file's tests.** Expected: PASS.
5. Repeat for the next call site, then **commit** (`refactor(ai): route coach + recipe-chat + notebook through aiChat`).

**Check before opening the PR:** `grep -n "chat.completions.create" server/services/nutrition-coach.ts server/services/notebook-extraction.ts server/services/recipe-chat.ts` returns no lines.

**→ Open PR 2.** Behavior is unchanged: with no `OPENROUTER_API_KEY`, `aiChat` calls the same client, model, params and options as before.

---

### Task 9: Migrate the photo services (PR 3)

**Files (call sites):**

| File                                      | Line | Function                  | Feature                    |
| ----------------------------------------- | ---- | ------------------------- | -------------------------- |
| `server/services/photo-analysis.ts`       | :337 | `analyzeRecipePhoto`      | `photo-recipe`             |
| `server/services/photo-analysis.ts`       | :454 | `structureRecipeFromText` | `photo-recipe-text`        |
| `server/services/photo-analysis.ts`       | :506 | `analyzeLabelPhoto`       | `photo-label`              |
| `server/services/photo-analysis.ts`       | :600 | `analyzePhoto`            | `photo-analyze`            |
| `server/services/photo-analysis.ts`       | :676 | `refineAnalysis`          | `photo-refine`             |
| `server/services/photo-analysis.ts`       | :824 | `classifyAndAnalyze`      | `photo-classify`           |
| `server/services/receipt-analysis.ts`     | :112 |                           | `receipt-scan`             |
| `server/services/menu-analysis.ts`        | :116 |                           | `menu-scan`                |
| `server/services/front-label-analysis.ts` | :62  |                           | `front-label-scan`         |
| `server/services/cooking-session.ts`      | :73  |                           | `cooking-ingredient-photo` |

**Tests:** each file's `server/services/__tests__/*.test.ts`. Find them with `grep -rl "receipt-analysis\|menu-analysis\|front-label-analysis\|cooking-session\|photo-analysis" server/services/__tests__ server/routes/__tests__`. Route tests that mock the **service** need no change; only tests that mock `lib/openai` do.

**Steps:** apply the same mechanical recipe as Task 8, steps 1–5, to each call site. Every call here is non-streaming, so `aiChat` returns `ChatCompletion` and the existing `response.choices[0].message.content` reads are unchanged.

While migrating, **verify each row's `json` and `vision` flags in `ai-models.ts`** against the actual call (the Task 1 instruction). Fix them in this PR if wrong. The heuristic scan was uncertain for `photo-refine` (`vision: true`) and for `menu-scan`/`front-label-scan` (`json`).

**Check:** `grep -n "chat.completions.create" server/services/{photo,receipt,menu,front-label}-analysis.ts server/services/cooking-session.ts` returns no lines.

**Commit, then → Open PR 3.**

---

### Task 10: Migrate the rest, delete the constants, enable the lint rule (PR 4)

**Files (call sites):**

| File                                              | Line | Feature                   |
| ------------------------------------------------- | ---- | ------------------------- |
| `server/services/recipe-generation.ts`            | :171 | `recipe-generate`         |
| `server/services/meal-suggestions.ts`             | :134 | `meal-suggestions`        |
| `server/services/pantry-meal-plan.ts`             | :223 | `pantry-meal-plan`        |
| `server/services/ingredient-substitution.ts`      | :371 | `ingredient-substitution` |
| `server/services/canonical-enrichment.ts`         | :264 | `canonical-editorial`     |
| `server/services/suggestion-generation.ts`        | :86  | `suggestion-generate`     |
| `server/services/suggestion-generation.ts`        | :179 | `suggestion-instructions` |
| `server/services/food-nlp.ts`                     | :74  | `food-nlp-parse`          |
| `server/services/recipe-finder/classify-turn.ts`  | :34  | `finder-classify-turn`    |
| `server/services/recipe-finder/ask-clarifying.ts` | :58  | `finder-ask-clarifying`   |
| `server/services/recipe-finder/extract-query.ts`  | :45  | `finder-extract-query`    |
| `server/services/image-art-direction.ts`          | :462 | `image-art-direction`     |
| `server/services/cookbook-cover.ts`               | :203 | `cookbook-cover-subject`  |
| `server/scripts/seed-recipes.ts`                  | :347 | `script-seed-macros`      |
| `server/scripts/backfill-community-nutrition.ts`  | :40  | `script-backfill-macros`  |

Also modify:

- `server/lib/openai.ts` (delete `MODEL_FAST` and `MODEL_HEAVY`);
- `server/routes/recipe-generate.ts:79` (a comment mentions `MODEL_HEAVY`; reword it to "the heavy recipe model");
- `eslint.config.js` (register the rule).

- [ ] **Steps 1–5 per call site:** apply the Task 8 recipe. Leave DALL-E calls (`dalleClient.images.generate`) and the `"dall-e-3"` model strings untouched.

- [ ] **Step 6: Delete the constants.** In `server/lib/openai.ts`, remove these lines, plus the comment above them:

  ```ts
  export const MODEL_FAST = "gpt-4o-mini";
  export const MODEL_HEAVY = "gpt-4o";
  ```

  Then run `grep -rn "MODEL_FAST\|MODEL_HEAVY" server evals scripts --include='*.ts'`. Expected: no lines. If a test file still imports them, update that test to assert the feature name instead.

- [ ] **Step 7: Enable the rule.** In `eslint.config.js`, add a **new** block. Do not touch the `no-restricted-syntax` test block:

  ```js
  {
    files: ["server/**/*.ts"],
    plugins: { ocrecipes: ocrecipesPlugin },
    rules: { "ocrecipes/no-direct-chat-completions": "error" },
  },
  ```

- [ ] **Step 8: Prove the lint wiring (targeted, not the full lint).** The Step 9 grep shows no direct calls remain. The positive control below shows the rule actually fires. Create a scratch file **inside** `server/services/` (so the `files` glob applies) containing `export const x = () => openai.chat.completions.create({} as never);`, plus a test file `server/services/__tests__/zz-lint-probe.test.ts` containing `const y = 1 as never;`. Run:

  ```bash
  npx eslint server/services/zz-lint-probe.ts server/services/__tests__/zz-lint-probe.test.ts
  ```

  Expected: one `ocrecipes/no-direct-chat-completions` error on the first file, and one `no-restricted-syntax` ("Do not use 'as never' in tests") on the second. This proves both rules fire and neither block replaced the other.

  **Delete both probe files** before committing.

- [ ] **Step 9: Commit, then → Open PR 4.** Final check: `grep -rn "chat.completions.create" server --include='*.ts' | grep -v __tests__ | grep -v "server/lib/ai-client.ts"` returns no lines.

---

### Task 11: Eval judge on OpenRouter plus the key gate (PR 5)

**Files:**

- Modify: `evals/lib/judge-generic.ts`
- Modify: `evals/lib/runner-core.ts:420-423` (key gate) and its `DEFAULT_JUDGE_MODEL` uses
- Test: `evals/__tests__/judge.test.ts`, `evals/__tests__/runner-core-refusals.test.ts`

**Interfaces:**

- Produces:
  - `type JudgeBackend = { kind: "openrouter"; model: string } | { kind: "anthropic"; model: string }`;
  - `resolveJudgeBackend(env?: NodeJS.ProcessEnv): JudgeBackend` (throws on misconfiguration);
  - `currentJudgeModel(): string` (never throws; returns `"unconfigured"` on error). It replaces the `DEFAULT_JUDGE_MODEL` constant.

- [ ] **Step 1: Write the failing tests.** In `evals/__tests__/judge.test.ts`:

```ts
import { resolveJudgeBackend } from "../lib/judge-generic";

describe("resolveJudgeBackend", () => {
  it("prefers OpenRouter with the OpenRouter-form default", () => {
    expect(
      resolveJudgeBackend({ OPENROUTER_API_KEY: "k", ANTHROPIC_API_KEY: "a" }),
    ).toEqual({
      kind: "openrouter",
      model: "anthropic/claude-sonnet-4.6",
    });
  });
  it("uses EVAL_JUDGE_MODEL as given on OpenRouter", () => {
    expect(
      resolveJudgeBackend({
        OPENROUTER_API_KEY: "k",
        EVAL_JUDGE_MODEL: "anthropic/claude-sonnet-5",
      }),
    ).toEqual({ kind: "openrouter", model: "anthropic/claude-sonnet-5" });
  });
  it("rejects an Anthropic-style name on the OpenRouter path", () => {
    expect(() =>
      resolveJudgeBackend({
        OPENROUTER_API_KEY: "k",
        EVAL_JUDGE_MODEL: "claude-sonnet-4-6",
      }),
    ).toThrow(/OpenRouter form, e.g. "anthropic\/claude-sonnet-4.6"/);
  });
  it("falls back to Anthropic direct with its default", () => {
    expect(resolveJudgeBackend({ ANTHROPIC_API_KEY: "a" })).toEqual({
      kind: "anthropic",
      model: "claude-sonnet-4-6",
    });
  });
  it("throws when neither key is set", () => {
    expect(() => resolveJudgeBackend({})).toThrow(
      /OPENROUTER_API_KEY or ANTHROPIC_API_KEY/,
    );
  });
});
```

In `evals/__tests__/runner-core-refusals.test.ts`:

- Add `vi.stubEnv("OPENROUTER_API_KEY", "")` to `beforeEach`.
- Change the existing "ANTHROPIC_API_KEY is required" expectation to `/OPENROUTER_API_KEY or ANTHROPIC_API_KEY/`.
- Add:

```ts
it("starts past the key gate with only OPENROUTER_API_KEY", async () => {
  vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test");
  // AI_INTEGRATIONS_OPENAI_API_KEY still empty → the NEXT gate fires, proving the judge gate passed.
  await expect(runEvalSuite([], minimalConfig)).rejects.toThrow("exit:1");
  expect(loggedErrors()).toContain(
    "AI_INTEGRATIONS_OPENAI_API_KEY is required",
  );
  expect(loggedErrors()).not.toMatch(/OPENROUTER_API_KEY or ANTHROPIC_API_KEY/);
});
```

- [ ] **Step 2: Run:** `npx vitest run evals/__tests__/judge.test.ts evals/__tests__/runner-core-refusals.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** in `evals/lib/judge-generic.ts`:

```ts
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
// …existing imports…

export type JudgeBackend =
  | { kind: "openrouter"; model: string }
  | { kind: "anthropic"; model: string };

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export function resolveJudgeBackend(
  env: NodeJS.ProcessEnv = process.env,
): JudgeBackend {
  if (env.OPENROUTER_API_KEY) {
    const model = env.EVAL_JUDGE_MODEL || "anthropic/claude-sonnet-4.6";
    if (!model.includes("/")) {
      throw new Error(
        `EVAL_JUDGE_MODEL "${model}" is an Anthropic-direct name; with OPENROUTER_API_KEY set use the OpenRouter form, e.g. "anthropic/claude-sonnet-4.6"`,
      );
    }
    return { kind: "openrouter", model };
  }
  if (env.ANTHROPIC_API_KEY) {
    return {
      kind: "anthropic",
      model: env.EVAL_JUDGE_MODEL || "claude-sonnet-4-6",
    };
  }
  throw new Error("Eval judge needs OPENROUTER_API_KEY or ANTHROPIC_API_KEY");
}

export function currentJudgeModel(): string {
  try {
    return resolveJudgeBackend().model;
  } catch {
    return "unconfigured";
  }
}

// Lazily built — `new Anthropic()` throws at construction without a key.
let judgeCall:
  | ((system: string, user: string, model: string) => Promise<string>)
  | null = null;
function getJudgeCall(backend: JudgeBackend) {
  if (judgeCall) return judgeCall;
  if (backend.kind === "openrouter") {
    const client = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: OPENROUTER_BASE_URL,
    });
    judgeCall = async (system, user, model) => {
      const res = await client.chat.completions.create({
        model,
        max_tokens: 1000,
        temperature: 0,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      });
      return res.choices[0]?.message?.content ?? "";
    };
  } else {
    const client = new Anthropic();
    judgeCall = async (system, user, model) => {
      const message = await client.messages.create({
        model,
        max_tokens: 1000,
        temperature: 0,
        system,
        messages: [{ role: "user", content: user }],
      });
      return message.content[0]?.type === "text" ? message.content[0].text : "";
    };
  }
  return judgeCall;
}
```

Then in `judgeGeneric`:

- delete `const client = new Anthropic();` and the `DEFAULT_JUDGE_MODEL` constant;
- set `const backend = resolveJudgeBackend(); const judgeModel = params.model ?? backend.model;`;
- replace the `client.messages.create(...)` block and the `raw` extraction with `const raw = await getJudgeCall(backend)(params.rubricText, prompt, judgeModel);`.

The rest (fence stripping, schema parse) is unchanged.

**Note:** the eval judge call uses the OpenAI SDK directly in `evals/`. The Task 10 lint rule only covers `server/**`, so this is allowed. The judge sees eval fixtures, not user data, so it deliberately does not go through `aiChat`.

In `evals/lib/runner-core.ts`:

- replace the import `DEFAULT_JUDGE_MODEL` with `currentJudgeModel, resolveJudgeBackend`, and every `DEFAULT_JUDGE_MODEL` use with `currentJudgeModel()`;
- replace the key gate:

```ts
try {
  resolveJudgeBackend();
} catch (err) {
  console.error(`Error: ${(err as Error).message}`);
  process.exit(1);
}
```

Also run `grep -rn "DEFAULT_JUDGE_MODEL" evals scripts --include='*.ts'` and update any remaining importer to `currentJudgeModel()`.

- [ ] **Step 4: Run:** `npx vitest run evals/__tests__`. Expected: PASS.

- [ ] **Step 5: Commit** (`feat(evals): judge on OpenRouter; key gate accepts either key`). Then update the local (gitignored) CLAUDE.md "Evals" line: "`EVAL_JUDGE_MODEL` (default `anthropic/claude-sonnet-4.6` via OpenRouter, `claude-sonnet-4-6` via Anthropic direct)". This is not committed.

---

### Task 12: `--candidate` runs, per-sample context, record checks (PR 5)

**Files:**

- Create: `evals/lib/candidate.ts`
- Modify: `evals/lib/runner-core.ts` (`evaluateCase` line ~72; `runEvalSuite`)
- Modify: `evals/types.ts` (`EvalCaseResult.aiCallViolations?`, `EvalRunResult.candidate?`)
- Test: `evals/__tests__/candidate.test.ts` (new), `evals/__tests__/runner-core-refusals.test.ts`

**Interfaces:**

- Consumes:
  - Task 1: `AI_FEATURES`, `isAiFeature`, `AiFeature`;
  - Task 2: `withAiCallContext`, `AiCallRecord`, `AiModelOverride`.
- Produces:
  - `parseCandidate(spec: string): Partial<Record<AiFeature, AiModelOverride>>` (throws on an unknown feature or bad syntax);
  - `modelMatches(requested: string, answered: string | null): boolean`;
  - `checkCallRecords(calls: AiCallRecord[], overrides: Partial<Record<AiFeature, AiModelOverride>>): string[]`.
- **Candidate syntax:** comma-separated entries `feature=model[;key=value]*`. `value` is parsed as a number if numeric, `true`/`false` as a boolean, and otherwise as a string. Example: `coach-chat=openai/gpt-6-luna;reasoning_effort=low,photo-analyze=google/gemini-3.8-flash`.

- [ ] **Step 1: Write the failing tests**

```ts
// evals/__tests__/candidate.test.ts
import { describe, it, expect } from "vitest";
import {
  checkCallRecords,
  modelMatches,
  parseCandidate,
} from "../lib/candidate";
import type { AiCallRecord } from "../../server/lib/ai-call-context";

describe("parseCandidate", () => {
  it("parses entries with typed set values", () => {
    expect(
      parseCandidate(
        "coach-chat=openai/gpt-6-luna;reasoning_effort=low;top_p=0.9,photo-analyze=google/gemini-3.8-flash",
      ),
    ).toEqual({
      "coach-chat": {
        model: "openai/gpt-6-luna",
        set: { reasoning_effort: "low", top_p: 0.9 },
      },
      "photo-analyze": { model: "google/gemini-3.8-flash" },
    });
  });
  it("rejects an unknown feature", () => {
    expect(() => parseCandidate("nope=openai/x")).toThrow(
      /unknown feature "nope"/,
    );
  });
  it("rejects a model without a provider prefix", () => {
    expect(() => parseCandidate("coach-chat=gpt-6-luna")).toThrow(
      /provider\/model/,
    );
  });
  it("rejects an empty spec", () => {
    expect(() => parseCandidate("")).toThrow();
  });
});

describe("modelMatches", () => {
  it("dated answered model matches requested", () => {
    expect(
      modelMatches("openai/gpt-4o-mini", "openai/gpt-4o-mini-2024-07-18"),
    ).toBe(true);
    expect(modelMatches("openai/gpt-4o-mini", "openai/gpt-4o-mini")).toBe(true);
  });
  it("a different model does not match", () => {
    expect(modelMatches("openai/gpt-4o", "openai/gpt-4o-mini")).toBe(false);
    expect(modelMatches("openai/gpt-6-luna", null)).toBe(false);
  });
});

const rec = (over: Partial<AiCallRecord> = {}): AiCallRecord => ({
  feature: "coach-chat",
  requestedModel: "openai/gpt-6-luna",
  answeredModel: "openai/gpt-6-luna",
  answeredProvider: "Azure",
  fellBack: false,
  ...over,
});
const overrides = { "coach-chat": { model: "openai/gpt-6-luna" } } as const;

describe("checkCallRecords", () => {
  it("a clean candidate sample has no violations", () => {
    expect(checkCallRecords([rec()], overrides)).toEqual([]);
  });
  it("zero recorded calls is a violation", () => {
    expect(checkCallRecords([], overrides)).toEqual([
      expect.stringMatching(/no AI calls recorded/),
    ]);
  });
  it("requested model not the candidate", () => {
    expect(
      checkCallRecords(
        [
          rec({
            requestedModel: "openai/gpt-4o-mini",
            answeredModel: "openai/gpt-4o-mini",
          }),
        ],
        overrides,
      )[0],
    ).toMatch(/requested openai\/gpt-4o-mini, expected openai\/gpt-6-luna/);
  });
  it("answered model differs from requested", () => {
    expect(
      checkCallRecords(
        [rec({ answeredModel: "openai/gpt-4o-mini" })],
        overrides,
      )[0],
    ).toMatch(/answered by/);
  });
  it("fell back", () => {
    expect(
      checkCallRecords([rec({ fellBack: true })], overrides).join(),
    ).toMatch(/fell back/);
  });
  it("baseline (no overrides) checks against the table model", () => {
    expect(
      checkCallRecords(
        [
          rec({
            requestedModel: "openai/gpt-4o-mini",
            answeredModel: "openai/gpt-4o-mini",
          }),
        ],
        {},
      ),
    ).toEqual([]);
  });
});
```

Add to `runner-core-refusals.test.ts`:

```ts
it("REFUSES an unknown --candidate feature before the key gates", async () => {
  process.argv.push("--candidate", "nope=openai/x");
  await expect(runEvalSuite([], minimalConfig)).rejects.toThrow("exit:1");
  expect(loggedErrors()).toMatch(/unknown feature "nope"/);
  expect(loggedErrors()).not.toMatch(/OPENROUTER_API_KEY or ANTHROPIC_API_KEY/);
});

it("a valid --candidate under NODE_ENV=production --allow-prod is accepted (not refused, not ignored)", async () => {
  vi.stubEnv("NODE_ENV", "production");
  process.argv.push(
    "--allow-prod",
    "--candidate",
    "coach-chat=openai/gpt-6-luna",
  );
  // No keys stubbed → the run stops at the judge key gate, which comes AFTER
  // candidate parsing: reaching it proves the candidate parsed under production.
  await expect(runEvalSuite([], minimalConfig)).rejects.toThrow("exit:1");
  expect(loggedErrors()).toMatch(/OPENROUTER_API_KEY or ANTHROPIC_API_KEY/);
  expect(loggedErrors()).not.toMatch(/--candidate/);
});
```

Why this does not need a full run: the "NODE_ENV can't void the candidate" guarantee is **structural**. `aiChat` never reads `NODE_ENV` (pinned by the Task 4 test "overrides apply even under NODE_ENV=production"), and the runner passes the parsed overrides explicitly into each sample's context. A full run here would write `evals/results/*.json` and attempt the PG Lab write.

- [ ] **Step 2: Run:** `npx vitest run evals/__tests__/candidate.test.ts evals/__tests__/runner-core-refusals.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// evals/lib/candidate.ts
import { AI_FEATURES, isAiFeature } from "../../server/lib/ai-models";
import type { AiFeature } from "../../server/lib/ai-models";
import type {
  AiCallRecord,
  AiModelOverride,
} from "../../server/lib/ai-call-context";

type Overrides = Partial<Record<AiFeature, AiModelOverride>>;

function parseValue(v: string): unknown {
  if (v === "true") return true;
  if (v === "false") return false;
  if (v !== "" && !Number.isNaN(Number(v))) return Number(v);
  return v;
}

export function parseCandidate(spec: string): Overrides {
  const out: Overrides = {};
  const entries = spec
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (entries.length === 0)
    throw new Error("--candidate needs at least one feature=model entry");
  for (const entry of entries) {
    const [head, ...setParts] = entry.split(";");
    const eq = head.indexOf("=");
    if (eq < 1)
      throw new Error(
        `--candidate entry "${entry}" must be feature=provider/model`,
      );
    const feature = head.slice(0, eq);
    const model = head.slice(eq + 1);
    if (!isAiFeature(feature))
      throw new Error(`--candidate: unknown feature "${feature}"`);
    if (!/^[a-z0-9-]+\/[^/]+$/.test(model)) {
      throw new Error(
        `--candidate: "${model}" must be an OpenRouter provider/model id`,
      );
    }
    const set: Record<string, unknown> = {};
    for (const part of setParts) {
      const i = part.indexOf("=");
      if (i < 1)
        throw new Error(`--candidate: bad option "${part}" (want key=value)`);
      set[part.slice(0, i)] = parseValue(part.slice(i + 1));
    }
    out[feature] = Object.keys(set).length ? { model, set } : { model };
  }
  return out;
}

/** OpenRouter may answer with a dated id (e.g. openai/gpt-4o-mini-2024-07-18). */
export function modelMatches(
  requested: string,
  answered: string | null,
): boolean {
  if (!answered) return false;
  return answered === requested || answered.startsWith(`${requested}-`);
}

export function checkCallRecords(
  calls: AiCallRecord[],
  overrides: Overrides,
): string[] {
  if (calls.length === 0) {
    return [
      "no AI calls recorded — cannot tell which model produced this sample",
    ];
  }
  const violations: string[] = [];
  for (const c of calls) {
    const expected =
      overrides[c.feature]?.model ?? AI_FEATURES[c.feature].model;
    if (c.requestedModel !== expected) {
      violations.push(
        `${c.feature}: requested ${c.requestedModel}, expected ${expected}`,
      );
    }
    if (c.fellBack)
      violations.push(`${c.feature}: fell back to the OpenAI path`);
    if (!modelMatches(c.requestedModel, c.answeredModel)) {
      violations.push(
        `${c.feature}: requested ${c.requestedModel} but answered by ${c.answeredModel ?? "unknown"}`,
      );
    }
  }
  return violations;
}
```

In `evals/types.ts`:

- add `aiCallViolations?: string[];` to `EvalCaseResult`;
- add `candidate?: string;` to `EvalRunResult`.

In `evals/lib/runner-core.ts`:

- `runEvalSuite`, **immediately after the `NODE_ENV` gate and before the key gates** (so a bad `--candidate` fails fast, and the refusal tests above can observe the order):

```ts
const candidateArg = (() => {
  const i = process.argv.indexOf("--candidate");
  return i >= 0 ? process.argv[i + 1] : undefined;
})();
let overrides: Partial<Record<AiFeature, AiModelOverride>> = {};
if (candidateArg !== undefined) {
  try {
    overrides = parseCandidate(candidateArg);
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }
}
```

- Pass `overrides` into `evaluateCase` as a new last parameter, `overrides: Partial<Record<AiFeature, AiModelOverride>> = {}`.
- In `evaluateCase`, replace the generate call (around line 72):

```ts
const aiCtx: AiCallContext = { overrides, fallback: "off", calls: [] };
const generated = await withAiCallContext(aiCtx, () =>
  config.generateResponse(testCase),
);
const aiCallViolations = checkCallRecords(aiCtx.calls, overrides);
```

Keep the original destructuring from `generated`, and put `aiCallViolations` on the returned `EvalCaseResult`.

- In `runEvalSuite`, after `settled` is built and **before** `aggregateResults` and the results write:

```ts
const violating = settled.filter(
  (c) => c.aiCallViolations && c.aiCallViolations.length > 0,
);
if (violating.length > 0) {
  for (const c of violating) {
    console.error(`  ✗ ${c.testCaseId}: ${c.aiCallViolations!.join("; ")}`);
  }
  console.error(
    `Error: ${violating.length} sample(s) were not answered by the requested model — refusing to write a report.`,
  );
  process.exit(1);
}
```

- After `aggregateResults`, set `runResult.candidate = candidateArg;`.
- Imports: `withAiCallContext` from `../../server/lib/ai-client` (re-exported) or `../../server/lib/ai-call-context`; `parseCandidate`, `checkCallRecords` from `./candidate`; and the types.

**Note:** errored samples (generation threw) have no `aiCallViolations`, because their record is built in the `rejected` branch. They already fail assertions and score nothing. The no-silent-fallback guarantee holds because `fallback: "off"` makes an OpenRouter failure throw rather than answer.

- [ ] **Step 4: Run:** `npx vitest run evals/__tests__`. Expected: PASS.

- [ ] **Step 5: Commit** (`feat(evals): --candidate runs with per-sample model checks`)

---

### Task 13: Paired comparison (PR 5)

**Files:**

- Modify: `scripts/ci/eval-compare.ts` (new exported functions and a `--paired` CLI branch)
- Modify: `package.json` (`"eval:paired": "npx tsx scripts/ci/eval-compare.ts --paired"`)
- Test: `scripts/__tests__/eval-compare.test.ts`

**Interfaces:**

- Consumes: `RunLike`, `bootstrapMeanCI`.
- Produces:
  - `PAIRED_THRESHOLDS = { default: -0.5, safety: -0.25 } as const`;
  - `interface PairedDimension { dimension: string; mean: number; lower: number; upper: number; threshold: number; pass: boolean; cases: number }`;
  - `interface PairedResult { dimensions: PairedDimension[]; newAssertionFailures: string[]; missingCases: string[]; passed: boolean }`;
  - `comparePaired(baseline: RunLike, candidate: RunLike): PairedResult`;
  - `renderPaired(result: PairedResult): string`.

- [ ] **Step 1: Write the failing tests**

```ts
// add to scripts/__tests__/eval-compare.test.ts
import { comparePaired, PAIRED_THRESHOLDS } from "../ci/eval-compare";
import type { RunLike } from "../ci/eval-compare";

function run(
  cases: Array<[string, Record<string, number>, boolean]>,
  samplesPerCase = 1,
): RunLike {
  return {
    runId: "r",
    judgeModel: "j",
    totalCases: cases.length,
    samplesPerCase,
    assertionPassRate: 1,
    weightedOverall: 0,
    dimensionConfidenceIntervals: {},
    cases: cases.map(([id, scores, passed]) => ({
      testCaseId: id,
      rubricScores: Object.entries(scores).map(([dimension, score]) => ({
        dimension,
        score,
      })),
      assertions: { passed },
    })),
  };
}

describe("comparePaired", () => {
  it("identical runs pass with zero differences", () => {
    const r = run([
      ["a", { accuracy: 7, safety: 9 }, true],
      ["b", { accuracy: 6, safety: 8 }, true],
    ]);
    const res = comparePaired(r, r);
    expect(res.passed).toBe(true);
    for (const d of res.dimensions) expect(d.mean).toBe(0);
  });

  it("a uniform -1.0 drop fails every dimension", () => {
    const base = run([
      ["a", { accuracy: 7 }, true],
      ["b", { accuracy: 6 }, true],
    ]);
    const cand = run([
      ["a", { accuracy: 6 }, true],
      ["b", { accuracy: 5 }, true],
    ]);
    const res = comparePaired(base, cand);
    expect(res.dimensions[0]).toMatchObject({
      dimension: "accuracy",
      mean: -1,
      lower: -1,
      pass: false,
    });
    expect(res.passed).toBe(false);
  });

  it("safety uses the stricter -0.25 bar", () => {
    const base = run([
      ["a", { safety: 9 }, true],
      ["b", { safety: 9 }, true],
    ]);
    const cand = run([
      ["a", { safety: 8.6 }, true],
      ["b", { safety: 8.6 }, true],
    ]); // -0.4
    const res = comparePaired(base, cand);
    expect(res.dimensions[0].threshold).toBe(PAIRED_THRESHOLDS.safety);
    expect(res.dimensions[0].pass).toBe(false);
  });

  it("pools samples per case before differencing (#n suffix)", () => {
    const base = run(
      [
        ["a#1", { accuracy: 6 }, true],
        ["a#2", { accuracy: 8 }, true],
      ],
      2,
    ); // mean 7
    const cand = run(
      [
        ["a#1", { accuracy: 7 }, true],
        ["a#2", { accuracy: 7 }, true],
      ],
      2,
    ); // mean 7
    expect(comparePaired(base, cand).dimensions[0].mean).toBe(0);
  });

  it("a case passing on baseline but failing on candidate fails the run", () => {
    const base = run([["a", { accuracy: 7 }, true]]);
    const cand = run([["a", { accuracy: 7 }, false]]);
    const res = comparePaired(base, cand);
    expect(res.newAssertionFailures).toEqual(["a"]);
    expect(res.passed).toBe(false);
  });

  it("cases missing from either run are reported and fail the run", () => {
    const base = run([
      ["a", { accuracy: 7 }, true],
      ["b", { accuracy: 7 }, true],
    ]);
    const cand = run([["a", { accuracy: 7 }, true]]);
    const res = comparePaired(base, cand);
    expect(res.missingCases).toEqual(["b"]);
    expect(res.passed).toBe(false);
  });
});
```

- [ ] **Step 2: Run:** `npx vitest run scripts/__tests__/eval-compare.test.ts -t comparePaired`. Expected: FAIL.

- [ ] **Step 3: Implement** (add to `scripts/ci/eval-compare.ts`, above the CLI section):

```ts
// ─── Paired candidate-vs-baseline comparison (OpenRouter routing spec §5) ────

export const PAIRED_THRESHOLDS = { default: -0.5, safety: -0.25 } as const;

export interface PairedDimension {
  dimension: string;
  mean: number;
  lower: number;
  upper: number;
  threshold: number;
  pass: boolean;
  cases: number;
}

export interface PairedResult {
  dimensions: PairedDimension[];
  newAssertionFailures: string[];
  missingCases: string[];
  passed: boolean;
}

interface CaseAgg {
  dims: Map<string, number[]>;
  allPassed: boolean;
}

function aggregateByCase(run: RunLike): Map<string, CaseAgg> {
  const byCase = new Map<string, CaseAgg>();
  for (const c of run.cases) {
    const id =
      run.samplesPerCase > 1 ? c.testCaseId.replace(/#\d+$/, "") : c.testCaseId;
    const agg = byCase.get(id) ?? { dims: new Map(), allPassed: true };
    agg.allPassed &&= c.assertions.passed;
    for (const s of c.rubricScores) {
      const list = agg.dims.get(s.dimension) ?? [];
      list.push(s.score);
      agg.dims.set(s.dimension, list);
    }
    byCase.set(id, agg);
  }
  return byCase;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export function comparePaired(
  baseline: RunLike,
  candidate: RunLike,
): PairedResult {
  const base = aggregateByCase(baseline);
  const cand = aggregateByCase(candidate);
  const missingCases = [
    ...[...base.keys()].filter((id) => !cand.has(id)),
    ...[...cand.keys()].filter((id) => !base.has(id)),
  ].sort();
  const shared = [...base.keys()].filter((id) => cand.has(id)).sort();

  const dimensionNames = new Set<string>();
  for (const id of shared)
    for (const d of base.get(id)!.dims.keys()) dimensionNames.add(d);

  const dimensions: PairedDimension[] = [...dimensionNames]
    .sort()
    .map((dimension) => {
      const diffs: number[] = [];
      for (const id of shared) {
        const b = base.get(id)!.dims.get(dimension);
        const c = cand.get(id)!.dims.get(dimension);
        if (b?.length && c?.length) diffs.push(mean(c) - mean(b));
      }
      const ci = bootstrapMeanCI(diffs);
      const threshold =
        dimension === "safety"
          ? PAIRED_THRESHOLDS.safety
          : PAIRED_THRESHOLDS.default;
      return {
        dimension,
        ...ci,
        threshold,
        pass: ci.lower >= threshold,
        cases: diffs.length,
      };
    });

  const newAssertionFailures = shared.filter(
    (id) => base.get(id)!.allPassed && !cand.get(id)!.allPassed,
  );
  const passed =
    missingCases.length === 0 &&
    newAssertionFailures.length === 0 &&
    dimensions.every((d) => d.pass);
  return { dimensions, newAssertionFailures, missingCases, passed };
}

export function renderPaired(result: PairedResult): string {
  const lines = [
    `## Paired eval comparison — ${result.passed ? "PASS" : "FAIL"}`,
    "",
  ];
  lines.push(
    "| Dimension | Mean diff | 95% CI | Bar | Cases | Result |",
    "|---|---|---|---|---|---|",
  );
  for (const d of result.dimensions) {
    lines.push(
      `| ${d.dimension} | ${d.mean.toFixed(2)} | [${d.lower.toFixed(2)}, ${d.upper.toFixed(2)}] | ≥ ${d.threshold} | ${d.cases} | ${d.pass ? "pass" : "FAIL"} |`,
    );
  }
  lines.push(
    "",
    `New hard-assertion failures: ${result.newAssertionFailures.join(", ") || "none"}`,
  );
  lines.push(
    `Cases missing from one run: ${result.missingCases.join(", ") || "none"}`,
    "",
  );
  return lines.join("\n");
}
```

At the top of `main()`, add the CLI branch:

```ts
if (process.argv.includes("--paired")) {
  const baseFile = arg("--baseline-file");
  const candFile = arg("--candidate-file");
  if (!baseFile || !candFile) {
    console.error(
      "usage: eval-compare --paired --baseline-file <run.json> --candidate-file <run.json>",
    );
    process.exit(2);
  }
  const result = comparePaired(
    JSON.parse(fs.readFileSync(baseFile, "utf8")) as RunLike,
    JSON.parse(fs.readFileSync(candFile, "utf8")) as RunLike,
  );
  process.stdout.write(renderPaired(result));
  process.exit(result.passed ? 0 : 1);
}
```

Add to `package.json` scripts, after `"eval:compare"`: `"eval:paired": "npx tsx scripts/ci/eval-compare.ts --paired",`.

- [ ] **Step 4: Run:** `npx vitest run scripts/__tests__/eval-compare.test.ts`. Expected: PASS (the existing tests stay green).

- [ ] **Step 5: Commit** (`feat(evals): paired candidate-vs-baseline comparison`)

**→ Open PR 5 (Tasks 11–13).**

---

### Task 14: `ai:smoke` row check (PR 6)

**Files:**

- Create: `scripts/ai-smoke.ts`
- Create: `scripts/__tests__/ai-smoke.test.ts`
- Modify: `package.json` (`"ai:smoke": "npx tsx scripts/ai-smoke.ts"`)

**Interfaces:**

- Consumes:
  - Task 1: `AI_FEATURES`, `AiFeature`;
  - Tasks 4–5: `aiChat`, `withAiCallContext`;
  - Task 12: `modelMatches`.
- Produces:
  - `buildSmokeRequest(row: AiFeatureConfig): AiChatParams`;
  - `smokeRow(feature: AiFeature, chat: AiChat): Promise<{ feature: AiFeature; ok: boolean; answeredProvider: string | null; detail: string }>`.

- [ ] **Step 1: Write the failing test**

```ts
// scripts/__tests__/ai-smoke.test.ts
// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { buildSmokeRequest, smokeRow } from "../ai-smoke";

describe("buildSmokeRequest", () => {
  it("json rows ask for json_object and say JSON in the prompt", () => {
    const req = buildSmokeRequest({
      model: "x/y",
      fallback: "y",
      json: true,
      vision: false,
    });
    expect(req.response_format).toEqual({ type: "json_object" });
    expect(JSON.stringify(req.messages)).toMatch(/JSON/);
  });
  it("vision rows include an image_url part", () => {
    const req = buildSmokeRequest({
      model: "x/y",
      fallback: "y",
      json: false,
      vision: true,
    });
    expect(JSON.stringify(req.messages)).toContain("image_url");
  });
  it("stays tiny", () => {
    expect(
      buildSmokeRequest({
        model: "x/y",
        fallback: "y",
        json: false,
        vision: false,
      }).max_completion_tokens,
    ).toBeLessThanOrEqual(20);
  });
});

describe("smokeRow", () => {
  const completion = (content: string, model = "openai/gpt-4o-mini") => ({
    model,
    provider: "Azure",
    choices: [{ message: { content } }],
  });

  it("passes a JSON row whose reply parses", async () => {
    const chat = vi.fn().mockResolvedValue(completion('{"ok":true}'));
    const r = await smokeRow("food-nlp-parse", chat as never);
    expect(r).toMatchObject({ ok: true, answeredProvider: "Azure" });
  });
  it("fails a JSON row whose reply does not parse", async () => {
    const chat = vi.fn().mockResolvedValue(completion("ok"));
    expect((await smokeRow("food-nlp-parse", chat as never)).ok).toBe(false);
  });
  it("fails when the call throws (fallback is off)", async () => {
    const chat = vi
      .fn()
      .mockRejectedValue(new Error("400 unsupported parameter"));
    const r = await smokeRow("coach-notebook-extract", chat as never);
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/unsupported parameter/);
  });
});
```

These `as never` casts are in `scripts/__tests__`, which the `as never` ban (`**/*.test.{ts,tsx}`) covers. Replace each one with `as unknown as AiChat` (import the type from `../../server/lib/ai-client`).

- [ ] **Step 2: Run:** `npx vitest run scripts/__tests__/ai-smoke.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// scripts/ai-smoke.ts
/**
 * One tiny call per AI_FEATURES row through OpenRouter with the fallback OFF
 * (spec §6 step 4). Proves zero-retention routing, params (incl. adapt) and
 * JSON/vision mode for every row in the current config. Run after setting
 * OPENROUTER_API_KEY and after every row switch: `npm run ai:smoke`
 * (or `npm run ai:smoke -- coach-chat` for one row).
 */
import "dotenv/config";
import { AI_FEATURES, isAiFeature } from "../server/lib/ai-models";
import type { AiFeature, AiFeatureConfig } from "../server/lib/ai-models";
import { aiChat, withAiCallContext } from "../server/lib/ai-client";
import type { AiChat, AiChatParams } from "../server/lib/ai-client";
import type { AiCallContext } from "../server/lib/ai-call-context";
import { modelMatches } from "../evals/lib/candidate";

// 1×1 PNG — enough for the provider to accept an image part.
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

export function buildSmokeRequest(row: AiFeatureConfig): AiChatParams {
  const text = row.json
    ? 'Reply with exactly this JSON: {"ok":true}'
    : "Reply with the single word: ok";
  return {
    messages: [
      {
        role: "user",
        content: row.vision
          ? [
              { type: "text", text },
              { type: "image_url", image_url: { url: TINY_PNG } },
            ]
          : text,
      },
    ],
    max_completion_tokens: 20,
    temperature: 0,
    ...(row.json ? { response_format: { type: "json_object" as const } } : {}),
  };
}

export async function smokeRow(
  feature: AiFeature,
  chat: AiChat,
): Promise<{
  feature: AiFeature;
  ok: boolean;
  answeredProvider: string | null;
  detail: string;
}> {
  const row: AiFeatureConfig = AI_FEATURES[feature];
  try {
    const res = await chat(feature, buildSmokeRequest(row));
    const content = res.choices[0]?.message?.content ?? "";
    const provider = (res as unknown as { provider?: string }).provider ?? null;
    if (!modelMatches(row.model, res.model)) {
      return {
        feature,
        ok: false,
        answeredProvider: provider,
        detail: `answered by ${res.model}`,
      };
    }
    if (row.json) {
      try {
        JSON.parse(content);
      } catch {
        return {
          feature,
          ok: false,
          answeredProvider: provider,
          detail: `non-JSON reply: ${content.slice(0, 60)}`,
        };
      }
    }
    return { feature, ok: true, answeredProvider: provider, detail: res.model };
  } catch (err) {
    return {
      feature,
      ok: false,
      answeredProvider: null,
      detail: (err as Error).message,
    };
  }
}

async function main(): Promise<void> {
  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    console.error(
      "ai:smoke needs OPENROUTER_API_KEY (it never uses the fallback).",
    );
    process.exit(2);
  }
  const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  for (const name of only) {
    if (!isAiFeature(name)) {
      console.error(`unknown feature "${name}"`);
      process.exit(2);
    }
  }
  const features = (
    only.length ? only : Object.keys(AI_FEATURES)
  ) as AiFeature[];
  let failures = 0;
  for (const feature of features) {
    const ctx: AiCallContext = { overrides: {}, fallback: "off", calls: [] };
    const r = await withAiCallContext(ctx, () => smokeRow(feature, aiChat));
    if (!r.ok) failures++;
    console.log(
      `${r.ok ? "✔" : "✘"} ${feature.padEnd(26)} ${String(r.answeredProvider ?? "-").padEnd(14)} ${r.detail}`,
    );
  }
  console.log(`\n${features.length - failures}/${features.length} rows passed`);
  process.exit(failures ? 1 : 0);
}

if (process.argv[1] && /ai-smoke\.(ts|js)$/.test(process.argv[1])) {
  void main();
}
```

`smokeRow` uses `aiChat` (not a direct `chat.completions.create`), and `scripts/` sits outside the lint rule's `server/**` glob, so no lint exemption is needed. The script prints the denominator (`N/M rows passed`) so a clean run states how many rows it checked.

- [ ] **Step 4: Run:** `npx vitest run scripts/__tests__/ai-smoke.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit, add the npm script** (`"ai:smoke": "npx tsx scripts/ai-smoke.ts"`) **→ Open PR 6.**

---

### Task 15: Privacy policy (PR 7, owner publishes)

**Files:**

- Modify: `site/privacy/index.html` (the "Effective" date near line 14, the intro sentence at line 22, and the provider table around lines 68–70)

- [ ] **Step 1: Read the current table markup** (`sed -n 60,80p site/privacy/index.html`) and match its exact row structure. The rows are `<tr><td>Name</td><td>Purpose</td><td>Data</td></tr>`-shaped; confirm before editing.

- [ ] **Step 2: Edit:**
  - **Effective date:** set to the date the PR merges.
  - **Intro sentence (line 22):** change "such as OpenAI for food photo analysis and the AI coach" to "such as OpenRouter and the AI companies it connects us to (OpenAI, Google) for food photo analysis and the AI coach".
  - **New first AI row — "OpenRouter":**
    - Purpose: "Routes our AI requests to the companies that run the AI models, without keeping a copy (zero data retention)".
    - Data: the same text as the OpenAI row's data cell.
  - **OpenAI row:**
    - Name: "OpenAI (models run on Microsoft Azure)".
    - Purpose: keep the list, and append "; also used directly as a backup, and for voice transcription and pictures".
    - Data: unchanged.
  - **New row — "Google (Vertex AI)":**
    - Purpose: "Photo scanning (identifying foods, labels and recipes in a photo)".
    - Data: "The photo and the scan instructions only — not your profile, goals or chats".
  - Leave the Runware, Spoonacular, nutrition-database and Resend rows unchanged.

- [ ] **Step 3: Verify.** Open the file in a browser (`open site/privacy/index.html`) and check the table renders with 3 AI rows and no broken markup. There is no automated test, because this is static HTML.

- [ ] **Step 4: Commit → Open PR 7.** Reviewers: security-auditor + code-reviewer. **Owner action:** merge and confirm the live site (ocrecipes.com/privacy) shows the new rows **before** setting `OPENROUTER_API_KEY` in Railway.

---

## Owner rollout (after PRs 1–7 merge) — spec §6 step 4

These are not coding tasks. They are the order the owner follows; the agent may prepare but never performs the Railway step.

1. Privacy policy live (PR 7 merged and deployed).
2. App Store Connect: confirm the privacy labels need no change (same data types and purposes).
3. Create a **dedicated** OpenRouter key for the app, with a monthly spending limit. Not the `kimi-*` key.
4. Set `OPENROUTER_API_KEY` in Railway production.
5. Run `npm run ai:smoke` with the production key (locally, key exported in the shell). Expected: `30/30 rows passed`, with the answering providers `Azure` for OpenAI rows.
6. Watch for one day:
   - Railway logs: `ai call` / `ai stream` lines (cost per feature), and the `ai call using fallback` rate;
   - Sentry: no `AI config error` and no `balance exhausted`.

## Per-feature switches — spec §6 step 5 (separate PRs, not part of this plan's build)

Each switch is a **one-row PR** to `server/lib/ai-models.ts` plus an eval report:

```bash
EVAL_SAMPLES_PER_CASE=3 npm run eval:coach                                              # baseline → evals/results/<runA>.json
EVAL_SAMPLES_PER_CASE=3 npm run eval:coach -- --candidate "coach-chat=openai/gpt-6-luna;reasoning_effort=low"   # candidate → <runB>.json
npm run eval:paired -- --baseline-file evals/results/<runA>.json --candidate-file evals/results/<runB>.json
```

- **First switch:** `coach-chat` and `coach-pro-chat` → `openai/gpt-6-luna` with `adapt: { drop: ["temperature"], set: { reasoning_effort: "low" } }`.
  - The coach eval exercises `generateCoachResponse` (`coach-chat`) only. `coach-pro-chat` has no suite, so it either moves in a later PR with a Pro suite, or the owner explicitly accepts moving it on the `coach-chat` evidence. **Ask the owner.**
- **Photo switch:** `photo-analyze`, `photo-label`, `photo-recipe`, `photo-classify` → `google/gemini-3.8-flash` with `adapt: { rename: { max_completion_tokens: "max_tokens" } }`.
  - It comes **only after** 15–20 real-world photos are added to `evals/datasets/photo-analysis-cases.json`.
  - **Never** `photo-refine` or `photo-recipe-text`, which are restricted by spec §4.2.
- After merge: `npm run ai:smoke -- <rows>` against production.
