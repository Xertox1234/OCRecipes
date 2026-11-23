# Vision features on Vertex AI direct — Implementation Plan

> **STATUS: PARTLY SHIPPED — history, not instructions.** Checked 2026-11-23: the Vertex-first plumbing (`primary: "vertex"`) is on `main` in `server/lib/ai-models.ts` and `server/lib/ai-client.ts`, but no row uses it. Superseded: the vision rows use Vertex direct as the backup route instead (ruling 2026-11-02). The current code and `docs/OWNER_RULINGS.md` win over anything below.

> References below to memory files (names like `project_*.md`, `feedback_*`, `reference_*`, `user_*`) point at the owner's local agent memory, which cloud sessions can't read. Lasting decisions from it are in `docs/OWNER_RULINGS.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route the 9 vision rows of `AI_FEATURES` to Google Vertex AI directly,
with OpenRouter (pinned to `google-vertex`, ZDR) as the fallback. These rows
never reach OpenAI direct.

**Architecture:**

- A new optional `primary: "vertex"` flag on a model-table row selects a
  Vertex-first flow inside `createAiChat`. That flow tries a third
  `openai`-SDK client aimed at Vertex's OpenAI-compatible endpoint (login via
  `google-auth-library`), then the existing OpenRouter client, then throws.
- Each route has its own circuit breaker.
- Unflagged rows keep today's OpenRouter → OpenAI path byte-for-byte.

**Tech Stack:** TypeScript, Express server, `openai` 6.39 (async `apiKey`
setter), `google-auth-library` 10.6 (already a dependency), Vitest, the eval
harness in `evals/`.

**Spec:** `docs/superpowers/specs/2026-10-19-vision-rows-vertex-direct-design.md`
(owner-approved 2026-10-19). Read it before any task.

**Ships as 4 PRs:**

| PR   | Tasks | Content                                                       |
| ---- | ----- | ------------------------------------------------------------- |
| PR 1 | 1–4   | plumbing; no row flagged, so no behavior change               |
| PR 2 | 5–6   | `photo-analyze` flagged; one privacy sentence                 |
| PR 3 | 7     | the 5 lower-risk rows                                         |
| PR 4 | 8–12  | 3 eval suites, owner approval, the 3 risky rows, privacy rows |

## Global Constraints

**Facts confirmed from Google's docs (Context7, 2026-10-19):**

- Vertex endpoint:
  `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/endpoints/openapi`.
- Model ids are `google/<model>` (e.g. `google/gemini-3.8-flash`): the same
  strings as the OpenRouter rows.
- Vertex accepts `reasoning_effort` on Gemini 3 models.
- OAuth scope: `https://www.googleapis.com/auth/cloud-platform`.

**Environment and credentials:**

- Env vars, all optional strings in `server/lib/env.ts`:
  `GOOGLE_VERTEX_PROJECT`, `GOOGLE_VERTEX_SERVICE_ACCOUNT_EMAIL`,
  `GOOGLE_VERTEX_SERVICE_ACCOUNT_KEY`. The key is a PEM with `\n` for
  newlines, the same shape as `GOOGLE_SERVICE_ACCOUNT_KEY`.
- Never read `GOOGLE_SERVICE_ACCOUNT_*` (the Play IAP account) from AI code.
  Never touch `server/services/receipt-validation.ts`.
- Never print or log a key value. Railway variable reads mask values.

**Routing rules:**

- A flagged row never calls `deps.fallback` (OpenAI direct). That holds in
  every branch, including both routes failing and neither client existing.
- Unflagged rows: no behavior change. Every existing test in
  `server/lib/__tests__/ai-client.test.ts` keeps its body unchanged. Only the
  `makeDeps` helper gains the two new defaults.
- No new npm dependency.

**Process rules (CLAUDE.md):**

- TDD: a failing test first.
- One review pass per PR, using the reviewer roster (`code-reviewer` +
  `ai-reviewer` + `server-reviewer`; add `security-auditor` on PR 1 for the
  credential handling).
- Never run `test:run`, `check:types` or `lint` ad hoc. Run only the targeted
  `npx vitest run <file>` the steps name. The push runs `preflight:fast`, and
  CI is the gate.
- Work in a worktree made by `bash scripts/oc-worktree.sh <branch>`. In a
  worktree, use `/usr/bin/git`. Commit messages go through Write + `-F`.

**Owner-only actions** (the agent asks; it never does these itself):

- Google Cloud setup (spec §4).
- Railway variable writes.
- Approving each PR-4 row switch on its eval numbers.

## Review Focus

1. **The early return at `ai-client.ts:231`.** When OpenRouter is absent and
   Vertex is present, a flagged row must still answer from Vertex. It must not
   take today's `!deps.openrouter` branch to OpenAI. Pinned in Task 3,
   test "vertex only".
2. **A bad or expired service-account key.** The token fetch throws inside the
   SDK's `apiKey` setter, which produces a plain `Error`. `classifyAiFailure`
   would read that as `transport`: it would feed the breaker and never send a
   config report. The expected behavior is a config report naming the env vars,
   with no key material. Pinned in Task 2 (`VertexAuthError` → `config`) and
   Task 3 test "auth failure".
3. **The Vertex breaker open while OpenRouter is absent.** The caller should
   get a clear error naming both routes, never a hang and never OpenAI.
   Pinned in Task 3 test "no route available".
4. **OpenRouter's 402 on a flagged row.** The Sentry text must not claim
   "AI traffic is on the OpenAI fallback". Pinned in Task 3 test "402 text".
5. **The `detail` image field** (`recipe-chat-image`, `cooking-ingredient-photo`)
   on Vertex. The expected behavior is the same reply whether or not Vertex
   honours it. It is probed live in Task 5. If the probe shows a 400, Task 5's
   conditional step strips it in the Vertex body.

---

## PR 1 — plumbing (branch `ai/vertex-plumbing`)

Setup, once per PR:

```bash
cd /Users/williamtower/projects/OCRecipes && git fetch -q origin && bash scripts/oc-worktree.sh ai/vertex-plumbing
# prints W=/Volumes/U34Bolt/OCRecipes/worktrees/ai-vertex-plumbing — use it below
```

### Task 1: Table fields and env schema

**Files:**

- Modify: `server/lib/ai-models.ts:17-23` (`AiFeatureConfig`)
- Modify: `server/lib/env.ts` (next to `OPENROUTER_API_KEY`, line 27)
- Test: `server/lib/__tests__/ai-models.test.ts`

**Interfaces:**

- Produces:
  - `AiFeatureConfig.primary?: "vertex"`;
  - `AiFeatureConfig.fallback?: string`, which is required in practice on
    unflagged rows. The table test pins this.

- [ ] **Step 1: Write the failing tests.** In `ai-models.test.ts`:
  - replace the body of `"every model has a provider/ prefix and no fallback does"`;
  - add two tests after `"every row's model has a pinned OpenRouter host"`.

```ts
it("every model has a provider/ prefix and no fallback does", () => {
  for (const [name, row] of rows) {
    expect(row.model, name).toMatch(/^[a-z0-9-]+\/[^/]+$/);
    if (row.fallback !== undefined)
      expect(row.fallback, name).not.toContain("/");
  }
});
```

```ts
it("a Vertex-first row has no OpenAI fallback; every other row has one", () => {
  for (const [name, row] of rows) {
    if (row.primary === "vertex") {
      expect(row.fallback, name).toBeUndefined();
      expect(row.model, name).toMatch(/^google\//);
    } else {
      expect(typeof row.fallback, name).toBe("string");
    }
  }
});

// Rollout allowlist (spec §2.1): grows PR by PR until every vision row is
// here, then this test asserts all of them.
const VERTEX_FIRST: string[] = [];
it("Vertex-first rows are exactly the rolled-out ones", () => {
  const flagged = rows
    .filter(([, row]) => row.primary === "vertex")
    .map(([name]) => name)
    .sort();
  expect(flagged).toEqual([...VERTEX_FIRST].sort());
});
```

- [ ] **Step 2: Run them and confirm they fail.**

Run: `npx vitest run server/lib/__tests__/ai-models.test.ts`
Expected: a TypeScript/transform error or a FAIL on `row.primary`. The
property does not exist on `AiFeatureConfig` yet.

- [ ] **Step 3: Implement.** In `ai-models.ts`, replace the interface and
      extend the header comment's first sentence.

```ts
/**
 * One row per AI call site. `model` is the provider-prefixed id (OpenRouter's
 * form, which Vertex's OpenAI-compatible endpoint also uses). `fallback` is
 * the id for the existing OpenAI client (today's path). A row with
 * `primary: "vertex"` goes Vertex direct → OpenRouter and has NO `fallback`:
 * it never reaches OpenAI (spec 2026-10-19-vision-rows-vertex-direct §2).
 * Moving a feature to another model = edit its row (owner approval + paired
 * eval report required).
 *
 * `json` / `vision` describe the call (response_format json_object / an
 * image_url part) — scripts/ai-smoke.ts reproduces them per row.
 */
```

```ts
export interface AiFeatureConfig {
  model: string;
  /** OpenAI-direct model id. Absent exactly when `primary` is "vertex". */
  fallback?: string;
  json: boolean;
  vision: boolean;
  primary?: "vertex";
  adapt?: AiAdapt;
}
```

In `server/lib/env.ts`, directly under `OPENROUTER_API_KEY: z.string().optional(),`:

```ts
  // Vertex AI direct (vision rows). Its OWN service account — never the Play
  // IAP one below. Key is a PEM with \n for newlines.
  GOOGLE_VERTEX_PROJECT: z.string().optional(),
  GOOGLE_VERTEX_SERVICE_ACCOUNT_EMAIL: z.string().optional(),
  GOOGLE_VERTEX_SERVICE_ACCOUNT_KEY: z.string().optional(),
```

In `ai-client.ts`, the three `row.fallback` uses (lines 205, 220, 224, 239)
now see `string | undefined`. Add this helper above `createAiChat`:

```ts
/** Unflagged rows always carry `fallback` (pinned by ai-models.test.ts). */
function fallbackModel(row: AiFeatureConfig, feature: AiFeature): string {
  if (row.fallback === undefined)
    throw new Error(`aiChat(${feature}): row has no OpenAI fallback`);
  return row.fallback;
}
```

Then replace each `row.fallback` in `run()` with
`fallbackModel(row, feature)`. Hoist it once as
`const fb = () => fallbackModel(row, feature);` inside `callFallback`, and use
it in the no-key branch.

- [ ] **Step 4: Run and confirm they pass.**

Run: `npx vitest run server/lib/__tests__/ai-models.test.ts server/lib/__tests__/ai-client.test.ts`
Expected: PASS, with every pre-existing test green.

- [ ] **Step 5: Commit.**

```bash
/usr/bin/git -C $W add server/lib/ai-models.ts server/lib/env.ts server/lib/ai-client.ts server/lib/__tests__/ai-models.test.ts
# Write the message to the scratchpad, then:
/usr/bin/git -C $W commit -F <scratchpad>/msg-t1.txt   # "ai-models: optional primary/fallback for Vertex-first rows; Vertex env vars"
```

### Task 2: Vertex client and auth-failure classification

**Files:**

- Create: `server/lib/vertex-client.ts`
- Modify: `server/lib/ai-failure.ts` (add `VertexAuthError`, and classify it)
- Test: `server/lib/__tests__/vertex-client.test.ts` (create);
  `server/lib/__tests__/ai-failure.test.ts` (add one case; check the file name
  with `ls server/lib/__tests__ | grep failure` first)

**Interfaces:**

- Consumes: `AiChatClient` (type only) from `./ai-client`.
- Produces:
  - `createVertexClient(env?: NodeJS.ProcessEnv): AiChatClient | null`;
  - `vertexBaseUrl(project: string): string`;
  - `VERTEX_SCOPE`;
  - `class VertexAuthError extends Error` (in `ai-failure.ts`), which
    `classifyAiFailure` maps to `"config"`.

- [ ] **Step 1: Write the failing tests.**

`server/lib/__tests__/vertex-client.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const getAccessToken = vi.fn();
const GoogleAuthCtor = vi.fn();
vi.mock("google-auth-library", () => ({
  GoogleAuth: vi.fn().mockImplementation((opts: unknown) => {
    GoogleAuthCtor(opts);
    return { getAccessToken };
  }),
}));

const OpenAICtor = vi.fn();
vi.mock("openai", () => ({
  default: vi.fn().mockImplementation((opts: unknown) => {
    OpenAICtor(opts);
    return { chat: { completions: { create: vi.fn() } } };
  }),
}));

import {
  createVertexClient,
  vertexBaseUrl,
  VERTEX_SCOPE,
} from "../vertex-client";
import { VertexAuthError } from "../ai-failure";

const FULL = {
  GOOGLE_VERTEX_PROJECT: "oc-vision",
  GOOGLE_VERTEX_SERVICE_ACCOUNT_EMAIL: "ai@oc-vision.iam.gserviceaccount.com",
  GOOGLE_VERTEX_SERVICE_ACCOUNT_KEY:
    "-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----\\n",
};

describe("createVertexClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    "GOOGLE_VERTEX_PROJECT",
    "GOOGLE_VERTEX_SERVICE_ACCOUNT_EMAIL",
    "GOOGLE_VERTEX_SERVICE_ACCOUNT_KEY",
  ])("returns null when %s is missing or blank", (name) => {
    expect(createVertexClient({ ...FULL, [name]: undefined })).toBeNull();
    expect(createVertexClient({ ...FULL, [name]: "  " })).toBeNull();
    expect(OpenAICtor).not.toHaveBeenCalled();
  });

  it("never reads the Play IAP service account", () => {
    expect(
      createVertexClient({
        GOOGLE_SERVICE_ACCOUNT_EMAIL: "play@x",
        GOOGLE_SERVICE_ACCOUNT_KEY: "pem",
      }),
    ).toBeNull();
  });

  it("aims the SDK at the global openapi endpoint with PEM newlines restored", () => {
    expect(createVertexClient(FULL)).not.toBeNull();
    expect(OpenAICtor).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL:
          "https://aiplatform.googleapis.com/v1/projects/oc-vision/locations/global/endpoints/openapi",
        apiKey: expect.any(Function),
      }),
    );
    expect(GoogleAuthCtor).toHaveBeenCalledWith({
      credentials: {
        client_email: FULL.GOOGLE_VERTEX_SERVICE_ACCOUNT_EMAIL,
        private_key:
          "-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----\n",
      },
      scopes: [VERTEX_SCOPE],
    });
  });

  it("apiKey setter returns the access token", async () => {
    getAccessToken.mockResolvedValue("tok-123");
    createVertexClient(FULL);
    const { apiKey } = OpenAICtor.mock.calls[0][0] as {
      apiKey: () => Promise<string>;
    };
    await expect(apiKey()).resolves.toBe("tok-123");
  });

  it("apiKey setter wraps a login failure in VertexAuthError without key material", async () => {
    getAccessToken.mockRejectedValue(
      new Error("error:1E08010C:DECODER routines::unsupported"),
    );
    createVertexClient(FULL);
    const { apiKey } = OpenAICtor.mock.calls[0][0] as {
      apiKey: () => Promise<string>;
    };
    const err = await apiKey().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VertexAuthError);
    expect((err as Error).message).toContain("GOOGLE_VERTEX_SERVICE_ACCOUNT");
    expect((err as Error).message).not.toContain("ABC");
  });

  it("apiKey setter treats an empty token as a login failure", async () => {
    getAccessToken.mockResolvedValue(null);
    createVertexClient(FULL);
    const { apiKey } = OpenAICtor.mock.calls[0][0] as {
      apiKey: () => Promise<string>;
    };
    await expect(apiKey()).rejects.toBeInstanceOf(VertexAuthError);
  });

  it("encodes the project id into the URL", () => {
    expect(vertexBaseUrl("a/b")).toContain("/projects/a%2Fb/");
  });
});
```

Add to the ai-failure test file:

```ts
it("classifies a Vertex login failure as config (no breaker, reported)", () => {
  const kind = classifyAiFailure(new VertexAuthError("Vertex login failed"));
  expect(kind).toBe("config");
  expect(countsTowardBreaker(kind)).toBe(false);
});
```

- [ ] **Step 2: Run them and confirm they fail.**

Run: `npx vitest run server/lib/__tests__/vertex-client.test.ts server/lib/__tests__/ai-failure.test.ts`
Expected: FAIL. `../vertex-client` cannot be resolved, and `VertexAuthError` is
not exported.

- [ ] **Step 3: Implement.**

In `server/lib/ai-failure.ts`, below `InStreamError`:

```ts
/** The Vertex service-account login failed (bad/expired key, wrong email). */
export class VertexAuthError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "VertexAuthError";
  }
}
```

In `classifyAiFailure`, as its first line:

```ts
if (err instanceof VertexAuthError) return "config";
```

Create `server/lib/vertex-client.ts`:

```ts
/**
 * Vertex AI's OpenAI-compatible endpoint, driven by the same `openai` SDK as
 * OpenRouter (spec 2026-10-19-vision-rows-vertex-direct §2.2). Login: a
 * dedicated service account (NOT the Play IAP one); google-auth-library
 * caches the ~1h access token and renews it, and the SDK asks for it before
 * every request via the async apiKey setter.
 */
import OpenAI from "openai";
import { GoogleAuth } from "google-auth-library";
import type { AiChatClient } from "./ai-client";
import { VertexAuthError } from "./ai-failure";

export const VERTEX_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

export function vertexBaseUrl(project: string): string {
  return `https://aiplatform.googleapis.com/v1/projects/${encodeURIComponent(project)}/locations/global/endpoints/openapi`;
}

export function createVertexClient(
  env: NodeJS.ProcessEnv = process.env,
): AiChatClient | null {
  const project = env.GOOGLE_VERTEX_PROJECT?.trim();
  const email = env.GOOGLE_VERTEX_SERVICE_ACCOUNT_EMAIL?.trim();
  const key = env.GOOGLE_VERTEX_SERVICE_ACCOUNT_KEY?.trim();
  if (!project || !email || !key) return null;

  const auth = new GoogleAuth({
    credentials: {
      client_email: email,
      private_key: key.replace(/\\n/g, "\n"),
    },
    scopes: [VERTEX_SCOPE],
  });
  const loginFailed = (cause?: unknown) =>
    new VertexAuthError(
      "Vertex login failed — check GOOGLE_VERTEX_SERVICE_ACCOUNT_EMAIL / _KEY",
      { cause },
    );

  // `as unknown` (TS2352): the SDK's overloaded create() takes typed params,
  // AiChatClient takes the adapted Record body — same cast as ai-client.ts.
  return new OpenAI({
    baseURL: vertexBaseUrl(project),
    apiKey: async () => {
      let token: string | null | undefined;
      try {
        token = await auth.getAccessToken();
      } catch (err) {
        throw loginFailed(err);
      }
      if (!token) throw loginFailed();
      return token;
    },
  }) as unknown as AiChatClient;
}
```

Note on `key.trim()`: the env value holds the escaped two-character `\n`
sequences, not real newlines, and `trim()` removes only real whitespace. So
the trailing escaped `\n` survives, and the replace turns it into the PEM's
final newline. That is what the test's expected `private_key` asserts.

- [ ] **Step 4: Run and confirm they pass.**

Run: `npx vitest run server/lib/__tests__/vertex-client.test.ts server/lib/__tests__/ai-failure.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.** Message: "ai: Vertex OpenAI-compatible client with
      service-account login; login failures classify as config".

### Task 3: Vertex-first routing in `createAiChat`

**Files:**

- Modify: `server/lib/ai-client.ts`:
  - `AiChatDeps` (lines 58-68);
  - `createAiChat` (lines 169-366): add `runVertexFirst`, plus a
    `throttledReport` helper replacing the inline config-report block.
- Test: `server/lib/__tests__/ai-client.test.ts`:
  - `makeDeps` gains `vertex: null` and `vertexBreaker: new CircuitBreaker()`;
  - a new `describe` block.

**Interfaces:**

- Consumes: `AiFeatureConfig.primary` (Task 1); `VertexAuthError` →
  `"config"` (Task 2).
- Produces:
  - `AiChatDeps.vertex: AiChatClient | null`;
  - `AiChatDeps.vertexBreaker: CircuitBreaker`;
  - call records with `answeredProvider: "vertex"`;
  - log lines `{ provider: "vertex" }`.

The tests need a flagged row, and no real row is flagged until PR 2. So the
test file mocks `../ai-models` to add one synthetic flagged row, keeping
everything else real.

- [ ] **Step 1: Write the failing tests.** At the top of `ai-client.test.ts`,
      after the existing `vi.mock` calls:

```ts
vi.mock("../ai-models", async (importOriginal) => {
  const real = await importOriginal<typeof import("../ai-models")>();
  return {
    ...real,
    AI_FEATURES: {
      ...real.AI_FEATURES,
      // Synthetic Vertex-first row (no real row is flagged until PR 2).
      "test-vertex-row": {
        model: "google/gemini-3.8-flash",
        json: true,
        vision: true,
        primary: "vertex",
        adapt: { set: { reasoning_effort: "low" } },
      },
    },
  };
});
```

Change `makeDeps` (only the object literal gains two lines):

```ts
    openrouter: { chat: { completions: { create: vi.fn() } } },
    vertex: null,
    fallback: { chat: { completions: { create: vi.fn() } } },
    breaker: new CircuitBreaker(),
    vertexBreaker: new CircuitBreaker(),
```

Append this block:

```ts
describe("aiChat (Vertex-first rows)", () => {
  const V = "test-vertex-row" as never; // synthetic row from the ai-models mock
  const client = () => ({ chat: { completions: { create: vi.fn() } } });
  let deps: AiChatDeps;
  beforeEach(() => {
    deps = makeDeps({ vertex: client() });
  });
  const neverOpenAI = () =>
    expect(deps.fallback.chat.completions.create).not.toHaveBeenCalled();

  it("Vertex answers: adapted params, no provider key, recorded as vertex", async () => {
    vi.mocked(deps.vertex!.chat.completions.create).mockResolvedValue(
      completion("google/gemini-3.8-flash"),
    );
    const ctx: AiCallContext = { overrides: {}, calls: [] };
    await withAiCallContext(ctx, () =>
      createAiChat(deps)(V, params, { timeout: 9 }),
    );
    const [body, opts] = vi.mocked(deps.vertex!.chat.completions.create).mock
      .calls[0];
    expect(body).toEqual({
      ...params,
      model: "google/gemini-3.8-flash",
      reasoning_effort: "low",
    });
    expect(body).not.toHaveProperty("provider");
    expect(opts).toEqual({ timeout: 9 });
    expect(deps.openrouter!.chat.completions.create).not.toHaveBeenCalled();
    expect(ctx.calls[0]).toMatchObject({
      answeredProvider: "vertex",
      fellBack: false,
    });
    neverOpenAI();
  });

  it("Vertex fails (5xx) → OpenRouter with zdr + pinned host + adapt; fellBack", async () => {
    vi.mocked(deps.vertex!.chat.completions.create).mockRejectedValue(
      apiError(503),
    );
    vi.mocked(deps.openrouter!.chat.completions.create).mockResolvedValue(
      completion("google/gemini-3.8-flash", "Google"),
    );
    const ctx: AiCallContext = { overrides: {}, calls: [] };
    await withAiCallContext(ctx, () => createAiChat(deps)(V, params));
    expect(deps.openrouter!.chat.completions.create).toHaveBeenCalledWith(
      {
        ...params,
        model: "google/gemini-3.8-flash",
        reasoning_effort: "low",
        provider: { zdr: true, only: ["google-vertex"] },
      },
      undefined,
    );
    expect(ctx.calls[0]).toMatchObject({ fellBack: true });
    expect(deps.log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "openrouter",
        fallbackReason: "transport",
      }),
      "ai call using fallback",
    );
    neverOpenAI();
  });

  it("both routes fail → throws the last error, reports once, never OpenAI", async () => {
    vi.mocked(deps.vertex!.chat.completions.create).mockRejectedValue(
      apiError(503),
    );
    vi.mocked(deps.openrouter!.chat.completions.create).mockRejectedValue(
      apiError(502, "or down"),
    );
    await expect(createAiChat(deps)(V, params)).rejects.toThrow("or down");
    expect(deps.report).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("test-vertex-row"),
      }),
      "ai-client",
    );
    neverOpenAI();
  });

  it("vertex only: Vertex present, OpenRouter absent → Vertex answers, no warn", async () => {
    deps = makeDeps({ vertex: client(), openrouter: null });
    vi.mocked(deps.vertex!.chat.completions.create).mockResolvedValue(
      completion("google/gemini-3.8-flash"),
    );
    await createAiChat(deps)(V, params);
    expect(deps.vertex!.chat.completions.create).toHaveBeenCalledTimes(1);
    expect(deps.log.warn).not.toHaveBeenCalled();
    neverOpenAI();
  });

  it("vertex null → OpenRouter directly, not marked fellBack", async () => {
    deps = makeDeps({ vertex: null });
    vi.mocked(deps.openrouter!.chat.completions.create).mockResolvedValue(
      completion("google/gemini-3.8-flash", "Google"),
    );
    const ctx: AiCallContext = { overrides: {}, calls: [] };
    await withAiCallContext(ctx, () => createAiChat(deps)(V, params));
    expect(ctx.calls[0]).toMatchObject({ fellBack: false });
    neverOpenAI();
  });

  it("no route available: both clients null → config error naming both env vars", async () => {
    deps = makeDeps({ vertex: null, openrouter: null });
    await expect(createAiChat(deps)(V, params)).rejects.toThrow(
      /GOOGLE_VERTEX_.*OPENROUTER_API_KEY/,
    );
    neverOpenAI();
  });

  it("no route available: Vertex breaker open and OpenRouter absent → error, not OpenAI", async () => {
    deps = makeDeps({ vertex: client(), openrouter: null });
    for (let i = 0; i < 5; i++) deps.vertexBreaker.recordFailure();
    await expect(createAiChat(deps)(V, params)).rejects.toThrow(
      /vertex: circuit open/,
    );
    expect(deps.vertex!.chat.completions.create).not.toHaveBeenCalled();
    neverOpenAI();
  });

  it("Vertex breaker open → straight to OpenRouter", async () => {
    for (let i = 0; i < 5; i++) deps.vertexBreaker.recordFailure();
    vi.mocked(deps.openrouter!.chat.completions.create).mockResolvedValue(
      completion("google/gemini-3.8-flash", "Google"),
    );
    await createAiChat(deps)(V, params);
    expect(deps.vertex!.chat.completions.create).not.toHaveBeenCalled();
  });

  it("breakers are separate: Vertex failures never open the OpenRouter breaker", async () => {
    vi.mocked(deps.vertex!.chat.completions.create).mockRejectedValue(
      apiError(503),
    );
    vi.mocked(deps.openrouter!.chat.completions.create).mockResolvedValue(
      completion("google/gemini-3.8-flash", "Google"),
    );
    const aiChat = createAiChat(deps);
    for (let i = 0; i < 6; i++) await aiChat(V, params);
    expect(deps.vertexBreaker.isOpen()).toBe(true);
    expect(deps.breaker.isOpen()).toBe(false);
  });

  it("breakers are separate: OpenRouter failures never open the Vertex breaker", async () => {
    deps = makeDeps({ vertex: client() });
    vi.mocked(deps.openrouter!.chat.completions.create).mockRejectedValue(
      apiError(503),
    );
    vi.mocked(deps.fallback.chat.completions.create).mockResolvedValue(
      completion("gpt-4o-mini"),
    );
    const aiChat = createAiChat(deps);
    for (let i = 0; i < 6; i++) await aiChat("coach-notebook-extract", params);
    expect(deps.breaker.isOpen()).toBe(true);
    expect(deps.vertexBreaker.isOpen()).toBe(false);
  });

  it("abort on Vertex is rethrown without trying OpenRouter", async () => {
    const ac = new AbortController();
    ac.abort();
    vi.mocked(deps.vertex!.chat.completions.create).mockRejectedValue(
      new OpenAI.APIUserAbortError(),
    );
    await expect(
      createAiChat(deps)(V, params, { signal: ac.signal }),
    ).rejects.toThrow();
    expect(deps.openrouter!.chat.completions.create).not.toHaveBeenCalled();
    neverOpenAI();
  });

  it("auth failure: VertexAuthError → config report (throttled), then OpenRouter", async () => {
    vi.mocked(deps.vertex!.chat.completions.create).mockRejectedValue(
      new VertexAuthError(
        "Vertex login failed — check GOOGLE_VERTEX_SERVICE_ACCOUNT_EMAIL / _KEY",
      ),
    );
    vi.mocked(deps.openrouter!.chat.completions.create).mockResolvedValue(
      completion("google/gemini-3.8-flash", "Google"),
    );
    const aiChat = createAiChat(deps);
    await aiChat(V, params);
    await aiChat(V, params);
    expect(deps.report).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deps.report).mock.calls[0][0].message).toMatch(
      /AI config error: test-vertex-row \(vertex\)/,
    );
    expect(deps.vertexBreaker.isOpen()).toBe(false);
  });

  it("402 text: OpenRouter balance on a Vertex-first row does not mention OpenAI", async () => {
    vi.mocked(deps.vertex!.chat.completions.create).mockRejectedValue(
      apiError(503),
    );
    vi.mocked(deps.openrouter!.chat.completions.create).mockRejectedValue(
      apiError(402),
    );
    await expect(createAiChat(deps)(V, params)).rejects.toThrow();
    const messages = vi.mocked(deps.report).mock.calls.map(([e]) => e.message);
    expect(messages.some((m) => /402/.test(m))).toBe(true);
    expect(messages.join(" ")).not.toMatch(/OpenAI/);
  });

  it("eval context (fallback off): Vertex failure is recorded and thrown, OpenRouter untried", async () => {
    vi.mocked(deps.vertex!.chat.completions.create).mockRejectedValue(
      apiError(400, "bad field"),
    );
    const ctx: AiCallContext = { overrides: {}, fallback: "off", calls: [] };
    await expect(
      withAiCallContext(ctx, () => createAiChat(deps)(V, params)),
    ).rejects.toThrow("bad field");
    expect(deps.openrouter!.chat.completions.create).not.toHaveBeenCalled();
    expect(ctx.calls[0]).toMatchObject({ error: { kind: "config" } });
  });

  it("eval context (fallback off) with no Vertex client measures OpenRouter", async () => {
    deps = makeDeps({ vertex: null });
    vi.mocked(deps.openrouter!.chat.completions.create).mockResolvedValue(
      completion("google/gemini-3.8-flash", "Google"),
    );
    const ctx: AiCallContext = { overrides: {}, fallback: "off", calls: [] };
    await withAiCallContext(ctx, () => createAiChat(deps)(V, params));
    expect(deps.openrouter!.chat.completions.create).toHaveBeenCalledTimes(1);
  });

  it("eval override model/set reaches the Vertex body", async () => {
    vi.mocked(deps.vertex!.chat.completions.create).mockResolvedValue(
      completion("google/gemini-4-argon"),
    );
    const ctx: AiCallContext = {
      overrides: {
        ["test-vertex-row" as never]: {
          model: "google/gemini-4-argon",
          set: { reasoning_effort: "medium" },
        },
      },
      fallback: "off",
      calls: [],
    };
    await withAiCallContext(ctx, () => createAiChat(deps)(V, params));
    expect(
      vi.mocked(deps.vertex!.chat.completions.create).mock.calls[0][0],
    ).toMatchObject({
      model: "google/gemini-4-argon",
      reasoning_effort: "medium",
    });
  });

  it("stream: true on a Vertex-first row throws before any call", async () => {
    await expect(
      createAiChat(deps)(V, { ...params, stream: true } as never),
    ).rejects.toThrow(/stream/);
    expect(deps.vertex!.chat.completions.create).not.toHaveBeenCalled();
    neverOpenAI();
  });
});
```

Add `VertexAuthError` to the `../ai-failure` import at the top of the test
file.

Before writing the eval-override test, confirm the shape of
`AiCallContext.overrides`:

```bash
grep -n "overrides" server/lib/ai-call-context.ts
```

Adjust the literal to the real type if it differs.

- [ ] **Step 2: Run them and confirm they fail.**

Run: `npx vitest run server/lib/__tests__/ai-client.test.ts`
Expected: the new block FAILs. Today the synthetic row goes OpenRouter →
`callFallback`, so the "never OpenAI" assertions fail, as do TS errors on
`deps.vertex`. The pre-existing tests still pass.

- [ ] **Step 3: Implement.** In `ai-client.ts`:

(a) Add to `AiChatDeps`:

```ts
/** Vertex AI direct — primary for `primary: "vertex"` rows; null = not configured. */
vertex: AiChatClient | null;
/** Separate from `breaker` (= OpenRouter health): one route's outage never trips the other. */
vertexBreaker: CircuitBreaker;
```

(b) Import `VertexAuthError` only if it is needed for typing. `classifyAiFailure`
already handles it, so no import is needed.

(c) Replace `const configReportedAt = new Map<AiFeature, number>();` with a
generic throttle, and route the existing OpenRouter config report through it.
The existing message text must stay exactly
`AI config error: ${feature} (${String(status)}): ${message}`, because
existing tests assert it.

```ts
const reportedAt = new Map<string, number>();
/** At most one report per key per CONFIG_REPORT_INTERVAL_MS. */
function throttledReport(key: string, error: Error): void {
  const t = now();
  const last = reportedAt.get(key);
  if (last !== undefined && t - last < CONFIG_REPORT_INTERVAL_MS) return;
  reportedAt.set(key, t);
  deps.report(error, "ai-client");
}
```

The existing `kind === "config"` branch becomes:

```ts
      } else if (kind === "config") {
        // Throttled per feature; the fallback warn log below still records
        // every failure.
        const status = err instanceof OpenAI.APIError ? err.status : undefined;
        throttledReport(
          `openrouter:${feature}`,
          new Error(`AI config error: ${feature} (${String(status)}): ${message}`),
        );
      }
```

(d) As the first statement in `run()` after `const streaming = …` and the
`record` helper is defined, before `const callFallback`, so that the
`!deps.openrouter` early return can never run first:

```ts
if (row.primary === "vertex") {
  return runVertexFirst(
    feature,
    row,
    params,
    options,
    ctx,
    requestedModel,
    record,
  );
}
```

(e) Add `runVertexFirst` inside `createAiChat`, next to `openStream`:

```ts
/**
 * Vertex direct → OpenRouter → throw (spec 2026-10-19-vision-rows-vertex-
 * direct §2.3). NEVER calls deps.fallback (OpenAI direct). With the
 * fallback off (evals) only the first available route is tried.
 */
async function runVertexFirst(
  feature: AiFeature,
  row: AiFeatureConfig,
  params: AiChatParams | AiChatStreamParams,
  options: AiChatOptions | undefined,
  ctx: AiCallContext | undefined,
  requestedModel: string,
  record: (
    answeredModel: string | null,
    provider: string | null,
    fellBack: boolean,
  ) => void,
): Promise<ChatCompletion> {
  if (params.stream === true) {
    throw new Error(
      `aiChat(${feature}): streaming is not supported on a Vertex-first row`,
    );
  }
  const evalMode = ctx?.fallback === "off";
  const override = ctx?.overrides[feature];
  const adapted = {
    ...adaptParams(params, row.adapt, override?.set),
    model: requestedModel,
  };
  const errorSummary = (err: unknown) => ({
    status: err instanceof OpenAI.APIError ? err.status : undefined,
    message: (err instanceof Error ? err.message : String(err)).slice(0, 300),
  });
  const recordEvalError = (kind: AiFailureKind, err: unknown) => {
    ctx?.calls.push({
      feature,
      requestedModel,
      answeredModel: null,
      answeredProvider: null,
      fellBack: false,
      error: {
        kind,
        moderated: kind === "request" && isModerationBlock(err),
        message: (err instanceof Error ? err.message : String(err)).slice(
          0,
          300,
        ),
      },
    });
  };

  let lastErr: unknown;
  let vertexSkip: string | null = null;

  // 1. Vertex
  if (!deps.vertex) vertexSkip = "not configured (GOOGLE_VERTEX_*)";
  else if (!evalMode && deps.vertexBreaker.isOpen())
    vertexSkip = "circuit open";
  else {
    try {
      const res = await deps.vertex.chat.completions.create(adapted, options);
      deps.vertexBreaker.recordSuccess();
      const model = answeredModel(res);
      record(model, "vertex", false);
      deps.log.info(
        {
          feature,
          provider: "vertex",
          requestedModel,
          answeredModel: model,
          usage: (res as { usage?: unknown }).usage,
        },
        "ai call",
      );
      return res as ChatCompletion;
    } catch (err) {
      if (isAbort(err, options)) throw err;
      const kind = classifyAiFailure(err);
      if (countsTowardBreaker(kind)) deps.vertexBreaker.recordFailure();
      if (kind === "config") {
        const status = err instanceof OpenAI.APIError ? err.status : undefined;
        throttledReport(
          `vertex:${feature}`,
          new Error(
            `AI config error: ${feature} (vertex) (${String(status)}): ${errorSummary(err).message}`,
          ),
        );
      }
      if (evalMode) {
        recordEvalError(kind, err);
        throw err;
      }
      lastErr = err;
      deps.log.warn(
        {
          feature,
          provider: "openrouter",
          requestedModel,
          fallbackReason: kind,
          error: errorSummary(err),
        },
        "ai call using fallback",
      );
    }
  }

  // 2. OpenRouter (pinned Vertex host, ZDR)
  let openrouterSkip: string | null = null;
  if (!deps.openrouter) openrouterSkip = "not configured (OPENROUTER_API_KEY)";
  else if (!evalMode && deps.breaker.isOpen()) openrouterSkip = "circuit open";
  else {
    const host = hostForModel(requestedModel);
    if (!host) {
      throw new Error(
        `aiChat(${feature}): no pinned OpenRouter host for "${requestedModel}"`,
      );
    }
    try {
      const res = await deps.openrouter.chat.completions.create(
        { ...adapted, provider: { zdr: true, only: [host] } },
        options,
      );
      deps.breaker.recordSuccess();
      const model = answeredModel(res);
      const provider = answeredProvider(res);
      record(model, provider, lastErr !== undefined);
      deps.log.info(
        {
          feature,
          provider: "openrouter",
          requestedModel,
          answeredModel: model,
          answeredProvider: provider,
          cost: usageCost(res),
        },
        "ai call",
      );
      return res as ChatCompletion;
    } catch (err) {
      if (isAbort(err, options)) throw err;
      const kind = classifyAiFailure(err);
      if (countsTowardBreaker(kind)) deps.breaker.recordFailure();
      if (kind === "balance") {
        deps.report(
          new Error(
            `OpenRouter balance exhausted (402) — ${feature} has no fallback while Vertex is failing`,
          ),
          "ai-client",
        );
      } else if (kind === "config") {
        const status = err instanceof OpenAI.APIError ? err.status : undefined;
        throttledReport(
          `openrouter:${feature}`,
          new Error(
            `AI config error: ${feature} (${String(status)}): ${errorSummary(err).message}`,
          ),
        );
      }
      if (evalMode) {
        recordEvalError(kind, err);
        throw err;
      }
      lastErr = err;
    }
  }

  // 3. Neither route answered — never OpenAI.
  if (lastErr !== undefined) {
    throttledReport(
      `unavailable:${feature}`,
      new Error(
        `AI unavailable: ${feature} — Vertex and OpenRouter both failed or were skipped`,
      ),
    );
    throw lastErr;
  }
  throw new Error(
    `aiChat(${feature}): no AI route available (vertex: ${vertexSkip}; openrouter: ${openrouterSkip}) — set GOOGLE_VERTEX_* and/or OPENROUTER_API_KEY`,
  );
}
```

Check the "no route available: both clients null" test regex
`/GOOGLE_VERTEX_.*OPENROUTER_API_KEY/` against the final message. It
matches, because the message names `GOOGLE_VERTEX_*` before
`OPENROUTER_API_KEY`. The breaker-open test matches `vertex: circuit open`.

(f) In `defaultDeps()`, add `vertex: null,` and
`vertexBreaker: new CircuitBreaker(),` for now. Task 4 wires the real client.

- [ ] **Step 4: Run and confirm they pass.**

Run: `npx vitest run server/lib/__tests__/ai-client.test.ts server/lib/__tests__/ai-models.test.ts`
Expected: PASS, with every pre-existing test unchanged and green.

- [ ] **Step 5: Commit.** Message: "aiChat: Vertex-first flow for
      primary:vertex rows — OpenRouter fallback, separate breaker, never OpenAI".

### Task 4: Wire the client, smoke support, docs; open PR 1

**Files:**

- Modify: `server/lib/ai-client.ts` (`defaultDeps`, and the header doc comment)
- Modify: `scripts/ai-smoke.ts` (key gate, provider column, bare-id match)
- Test: `scripts/__tests__/ai-smoke.test.ts` (find it with
  `ls scripts/__tests__ | grep smoke`; if it is absent, create it)
- Modify: `CLAUDE.md` (Environment Variables → Core)

**Interfaces:**

- Consumes: `createVertexClient` (Task 2); `AiChatDeps.vertex` (Task 3).
- Produces: `npm run ai:smoke -- <row>` works with only the Vertex vars, only
  OpenRouter, or both. Its provider column shows `vertex` for a Vertex answer.

- [ ] **Step 1: Write the failing tests** for the smoke helpers. Add them to
      the smoke test file:

```ts
import { smokeRow, smokeKeysPresent } from "../ai-smoke";
import { withAiCallContext } from "../../server/lib/ai-client";

it("smokeKeysPresent accepts Vertex vars alone, OpenRouter alone, or both", () => {
  const v = {
    GOOGLE_VERTEX_PROJECT: "p",
    GOOGLE_VERTEX_SERVICE_ACCOUNT_EMAIL: "e",
    GOOGLE_VERTEX_SERVICE_ACCOUNT_KEY: "k",
  };
  expect(smokeKeysPresent(v)).toBe(true);
  expect(smokeKeysPresent({ OPENROUTER_API_KEY: "x" })).toBe(true);
  expect(smokeKeysPresent({})).toBe(false);
  expect(smokeKeysPresent({ GOOGLE_VERTEX_PROJECT: "p" })).toBe(false);
});

it("smokeRow reads the provider from the call record when the reply has none (Vertex)", async () => {
  const chat = (async () => {
    const res = {
      model: "google/gemini-3.8-flash",
      choices: [{ message: { content: '{"ok":true}' } }],
    };
    return res;
  }) as never;
  const ctx = {
    overrides: {},
    fallback: "off" as const,
    calls: [
      {
        feature: "photo-analyze",
        requestedModel: "google/gemini-3.8-flash",
        answeredModel: "google/gemini-3.8-flash",
        answeredProvider: "vertex",
        fellBack: false,
      },
    ],
  };
  const r = await withAiCallContext(ctx as never, () =>
    smokeRow("photo-analyze", chat),
  );
  expect(r).toMatchObject({ ok: true, answeredProvider: "vertex" });
});

it("smokeRow accepts a bare model id answer for a google/ row", async () => {
  const chat = (async () => ({
    model: "gemini-3.8-flash",
    choices: [{ message: { content: '{"ok":true}' } }],
  })) as never;
  const r = await smokeRow("photo-analyze", chat);
  expect(r.ok).toBe(true);
});
```

- [ ] **Step 2: Run them and confirm they fail.**

Run: `npx vitest run scripts/__tests__/ai-smoke.test.ts`
Expected: FAIL, because `smokeKeysPresent` is not exported, and the provider
and bare-id cases fail.

- [ ] **Step 3: Implement.**

In `scripts/ai-smoke.ts`:

```ts
import { getAiCallContext } from "../server/lib/ai-call-context";

/** Smoke needs at least one fallback-free route: Vertex (all 3 vars) or OpenRouter. */
export function smokeKeysPresent(env: NodeJS.ProcessEnv): boolean {
  const vertex = [
    "GOOGLE_VERTEX_PROJECT",
    "GOOGLE_VERTEX_SERVICE_ACCOUNT_EMAIL",
    "GOOGLE_VERTEX_SERVICE_ACCOUNT_KEY",
  ].every((k) => env[k]?.trim());
  return vertex || !!env.OPENROUTER_API_KEY?.trim();
}

/** Vertex may answer with the bare id; OpenRouter answers provider-prefixed. */
function answeredMatches(requested: string, answered: string | null): boolean {
  if (modelMatches(requested, answered)) return true;
  const slash = requested.indexOf("/");
  return slash > 0 && modelMatches(requested.slice(slash + 1), answered);
}
```

In `smokeRow`, replace the provider line and the model check:

```ts
    const provider =
      (res as unknown as { provider?: string }).provider ??
      getAiCallContext()?.calls.at(-1)?.answeredProvider ??
      null;
    if (!answeredMatches(row.model, res.model)) {
```

In `main()`, replace the key gate:

```ts
if (!smokeKeysPresent(process.env)) {
  console.error(
    "ai:smoke needs GOOGLE_VERTEX_* (all three) or OPENROUTER_API_KEY (it never uses the OpenAI fallback).",
  );
  process.exit(2);
}
```

Update the header comment so it says that Vertex-first rows are smoked on
Vertex when the Vertex vars are set.

Confirm that `getAiCallContext` is exported from `server/lib/ai-call-context.ts`
before relying on it: `grep -n "export function getAiCallContext" server/lib/ai-call-context.ts`.

In `server/lib/ai-client.ts`:

- `defaultDeps()`: `vertex: createVertexClient(),` (import from
  `./vertex-client`).
- Header comment: "Routes via Vertex AI direct for `primary: "vertex"` rows
  (OpenRouter as their fallback, never OpenAI), else OpenRouter
  (zero-data-retention) when OPENROUTER_API_KEY is set, else via today's
  OpenAI client".

In `CLAUDE.md` → Environment Variables → **Core**, append after the
`OPENROUTER` mention, or add it to Core if it is absent:

```
`GOOGLE_VERTEX_PROJECT`, `GOOGLE_VERTEX_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_VERTEX_SERVICE_ACCOUNT_KEY` (PEM, `\n` for newlines) — Vertex AI direct for the vision rows (`primary: "vertex"`); a dedicated service account, never the Play IAP one; unset = those rows start at OpenRouter
```

- [ ] **Step 4: Run and confirm they pass.**

Run: `npx vitest run scripts/__tests__/ai-smoke.test.ts server/lib/__tests__/ai-client.test.ts server/lib/__tests__/vertex-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit, push, review, open PR 1.**

```bash
/usr/bin/git -C $W add scripts/ai-smoke.ts scripts/__tests__/ai-smoke.test.ts server/lib/ai-client.ts CLAUDE.md
/usr/bin/git -C $W commit -F <scratchpad>/msg-t4.txt   # "ai: wire the Vertex client; ai:smoke runs on Vertex or OpenRouter"
/usr/bin/git -C $W push -u origin ai/vertex-plumbing   # runs preflight:fast
```

- Dispatch one review pass, roster: `code-reviewer`, `ai-reviewer`,
  `server-reviewer` and `security-auditor`. Hand each reviewer the exact
  changed-file list (`git diff --name-only origin/main...HEAD`) and the
  AI_WORKFLOW dispatch format, with REVIEWED-SHA on the same line.
- Fix blocking findings. File WARNINGs as todos per CLAUDE.md.
- Open the PR via `mcp__github__create_pull_request` with `head: ai/vertex-plumbing`.
- After CI is green (check-runs n≥16, all success or skipped), merge with
  `mcp__github__merge_pull_request` (squash, `expectedHeadSha`).
- Ledger note.

---

## PR 2 — `photo-analyze` on Vertex (branch `ai/photo-analyze-vertex`)

### Task 5: Owner setup check and live probe (no repo changes)

**Precondition:** the owner has finished spec §4, steps 1–4. Ask; don't
assume. To confirm without printing secrets:

```bash
cd /Users/williamtower/projects/OCRecipes && for k in GOOGLE_VERTEX_PROJECT GOOGLE_VERTEX_SERVICE_ACCOUNT_EMAIL GOOGLE_VERTEX_SERVICE_ACCOUNT_KEY; do grep -q "^$k=." .env && echo "$k set" || echo "$k MISSING"; done
```

The cache setting is owner-verified. Ask the owner to run it with `!`, since it
uses their gcloud login:

```bash
curl -s -H "Authorization: Bearer $(gcloud auth print-access-token)" https://us-central1-aiplatform.googleapis.com/v1/projects/$GOOGLE_VERTEX_PROJECT/cacheConfig
```

The expected output contains `"disableCache": true`. If it does not, the owner
runs the PATCH from the spec §4 / Google ZDR docs:

```bash
curl -X PATCH -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "Content-Type: application/json" https://us-central1-aiplatform.googleapis.com/v1/projects/$GOOGLE_VERTEX_PROJECT/cacheConfig -d '{"name":"projects/'$GOOGLE_VERTEX_PROJECT'/cacheConfig","disableCache":true}'
```

The abuse-monitoring exemption is a request the owner files with Google. Record
in the ledger whether it was filed. It does not block PR 2.

- [ ] **Step 1: Write the probe script** to the scratchpad (not the repo):
      `<scratchpad>/vertex-probe.ts`.

```ts
import "dotenv/config";
import { createVertexClient } from "/Users/williamtower/projects/OCRecipes/server/lib/vertex-client";

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const client = createVertexClient();
if (!client) throw new Error("Vertex vars missing");
const base = {
  model: "google/gemini-3.8-flash",
  reasoning_effort: "low",
  response_format: { type: "json_object" },
  max_completion_tokens: 50,
  temperature: 0,
};
for (const detail of [undefined, "low", "high"] as const) {
  const res = (await client.chat.completions.create({
    ...base,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: 'Reply with exactly this JSON: {"ok":true}' },
          {
            type: "image_url",
            image_url: detail ? { url: TINY_PNG, detail } : { url: TINY_PNG },
          },
        ],
      },
    ],
  })) as {
    model: string;
    choices: { message: { content: string }; finish_reason: string }[];
    usage: unknown;
  };
  console.log(
    JSON.stringify({
      detail: detail ?? "none",
      model: res.model,
      finish: res.choices[0].finish_reason,
      content: res.choices[0].message.content,
      usage: res.usage,
    }),
  );
}
```

- [ ] **Step 2: Run it.**

Run: `cd /Users/williamtower/projects/OCRecipes && npx tsx <scratchpad>/vertex-probe.ts`

Expected: three lines, each with `finish: "stop"` and `{"ok":true}` content.
Record four things in the ledger:

- the exact `model` string Vertex answers (prefixed or bare);
- whether `detail: "low"` and `detail: "high"` were accepted;
- whether `reasoning_effort` was accepted;
- the usage fields.

- [ ] **Step 3, conditional: only if a `detail` variant returned HTTP 400.**
      Add a test in `ai-client.test.ts` ("Vertex body strips image_url.detail"),
      and in `runVertexFirst` build the Vertex body with this helper. Leave the
      OpenRouter body untouched.

```ts
function stripImageDetail(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const messages = body.messages as { content?: unknown }[] | undefined;
  if (!Array.isArray(messages)) return body;
  return {
    ...body,
    messages: messages.map((m) =>
      Array.isArray(m.content)
        ? {
            ...m,
            content: m.content.map(
              (p: { type?: string; image_url?: Record<string, unknown> }) =>
                p.type === "image_url" && p.image_url
                  ? { ...p, image_url: { url: p.image_url.url } }
                  : p,
            ),
          }
        : m,
    ),
  };
}
```

This step ships in PR 2 if it is needed. Otherwise skip it and note "detail
accepted" in the PR body.

- [ ] **Step 4: Run the full smoke over Vertex.** Run it with the Vertex vars
      set; OpenRouter is irrelevant here, because no row is flagged yet.

Run: `npm run ai:smoke -- photo-analyze`
Expected: `✔ photo-analyze` with provider `google-vertex` (OpenRouter), as
today. This is the baseline before the flip.

### Task 6: Flag `photo-analyze`, privacy sentence, measure, open PR 2

**Files:**

- Modify: `server/lib/ai-models.ts` (the `photo-analyze` row)
- Modify: `server/lib/__tests__/ai-models.test.ts` (`SWITCHED["photo-analyze"]`, `VERTEX_FIRST`)
- Modify: `site/privacy/index.html:22`

- [ ] **Step 1: Write the failing test.** In `ai-models.test.ts`, set
      `const VERTEX_FIRST: string[] = ["photo-analyze"];`, and change
      `SWITCHED["photo-analyze"]` to:

```ts
    "photo-analyze": {
      model: "google/gemini-3.8-flash",
      json: true,
      vision: true,
      primary: "vertex",
      adapt: { set: { reasoning_effort: "low" } },
    },
```

- [ ] **Step 2: Run it and confirm it fails.**

Run: `npx vitest run server/lib/__tests__/ai-models.test.ts`
Expected: FAIL on "switched rows are exactly the approved ones" and on
"Vertex-first rows are exactly the rolled-out ones".

- [ ] **Step 3: Implement.** Replace the row and its comment in `ai-models.ts`:

```ts
  // Gemini 3.8 Flash (owner-approved 2026-10-19, paired eval 7.76 vs gpt-4o
  // 6.90). Vertex AI direct, OpenRouter fallback, never OpenAI (spec
  // 2026-10-19-vision-rows-vertex-direct). Low reasoning keeps the JSON reply
  // inside LOG_MAX_TOKENS (1500).
  "photo-analyze": {
    model: "google/gemini-3.8-flash",
    json: true,
    vision: true,
    primary: "vertex",
    adapt: { set: { reasoning_effort: "low" } },
  }, // analyzePhoto
```

In `site/privacy/index.html:22`, replace the sentence:

```html
<li>
  Some features send your information to service providers: Google (Vertex AI)
  directly for food photo scanning, and OpenRouter and the AI companies it
  connects us to (OpenAI, Google) for the AI coach, recipes and as a backup for
  photo scanning. They are listed below with what each receives.
</li>
```

- [ ] **Step 4: Run, smoke and eval.**

Run: `npx vitest run server/lib/__tests__/ai-models.test.ts` → PASS.

Run: `npm run ai:smoke -- photo-analyze` → `✔ photo-analyze  vertex  google/gemini-3.8-flash` (or the bare id).

Run the eval with Vertex vars and OpenRouter set (the judge uses OpenRouter):

```bash
npm run eval:photo
```

Expected:

- the run completes 12 cases;
- every `aiCalls` record shows `answeredProvider: "vertex"`;
- the overall score sits within the #1509 Flash-low CI (7.76);
- report p50 and p90 latency, and the count of `finish_reason: length`.

Compare with #1509's candidate file:

```bash
npm run eval:paired -- --baseline-file <#1509 flash file in evals/results> --candidate-file <new file>
```

The #1509 files are local-only: `ls evals/results | grep photo-analysis`.

- [ ] **Step 5: Commit, push, review, PR, merge, verify in prod.**
  - Commit message: "photo-analyze runs on Vertex AI direct (OpenRouter
    fallback, no OpenAI); privacy: Google reached directly for photo scanning".
  - Review roster: `code-reviewer` + `ai-reviewer`.
  - The PR body includes the eval numbers and the Task 5 probe facts.
  - Merge as in Task 4.
  - **Before the deploy reaches prod, the owner sets the three Railway vars.**
    Ask, then confirm names only:
    `railway variables --service OCRecipes --environment production --kv | cut -d= -f1 | grep GOOGLE_VERTEX`.
    The owner runs it with `!` if auto mode denies it.
  - After the deploy, prove arrival with an `ai call` log line with
    `provider: "vertex"` and `feature: "photo-analyze"` in Railway logs after
    one real scan. The owner scans a meal. Report the count of lines seen, and
    the time window, as the denominator.

---

## PR 3 — five lower-risk rows (branch `ai/vision-rows-vertex-batch1`)

### Task 7: Live checks, then flip `photo-classify`, `photo-recipe`, `receipt-scan`, `cooking-ingredient-photo`, `recipe-chat-image`

**Files:**

- Modify: `server/lib/ai-models.ts` (5 rows)
- Modify: `server/lib/__tests__/ai-models.test.ts` (`SWITCHED` + `VERTEX_FIRST`)
- Possibly modify: the token cap constant of a row whose reply was cut off.
  Locate it with `grep -n "max_completion_tokens" <service file>`.

- [ ] **Step 1: Write the live-check script** in the scratchpad:
      `<scratchpad>/vision-batch1-check.ts`. It calls each service function with
      real photos under an eval context that overrides the row to Gemini on
      Vertex, before the table changes:

```ts
import "dotenv/config";
import { withAiCallContext } from "/Users/williamtower/projects/OCRecipes/server/lib/ai-client";
import {
  classifyAndAnalyze,
  analyzeRecipePhoto,
} from "/Users/williamtower/projects/OCRecipes/server/services/photo-analysis";
import { analyzeReceiptPhotos } from "/Users/williamtower/projects/OCRecipes/server/services/receipt-analysis";
import { analyzeIngredientPhoto } from "/Users/williamtower/projects/OCRecipes/server/services/cooking-session";
import { analyzeImageForRecipe } from "/Users/williamtower/projects/OCRecipes/server/services/recipe-chat";

const PHOTOS: Record<string, string[]> = {
  // 3–5 public-licence URLs per row; pick them by LOOKING at each image first
  // (Wikimedia Commons: "File:…" → original file URL). Write what each shows
  // in the comment next to it — that note is the ground truth you read the
  // reply against.
  "photo-classify": [
    /* meal plate, packaged product, recipe card */
  ],
  "photo-recipe": [
    /* printed recipe page, handwritten card, cookbook spread */
  ],
  "receipt-scan": [
    /* grocery receipt (clear), crumpled receipt, long receipt */
  ],
  "cooking-ingredient-photo": [
    /* raw veg on board, mixed ingredients, single item */
  ],
  "recipe-chat-image": [
    /* fridge shelf, pantry shelf, single ingredient */
  ],
};
const b64 = async (u: string) =>
  Buffer.from(await (await fetch(u)).arrayBuffer()).toString("base64");
const RUN: Record<string, (img: string) => Promise<unknown>> = {
  "photo-classify": (i) => classifyAndAnalyze(i),
  "photo-recipe": (i) => analyzeRecipePhoto(i),
  "receipt-scan": (i) => analyzeReceiptPhotos([i]),
  "cooking-ingredient-photo": (i) => analyzeIngredientPhoto(i, "image/jpeg", 1),
  "recipe-chat-image": (i) => analyzeImageForRecipe(i),
};
for (const [feature, urls] of Object.entries(PHOTOS)) {
  for (const url of urls) {
    // NOTE: the row is still unflagged here, so the override sends it via
    // OpenRouter → google-vertex. Same model and host as the direct path;
    // the direct path is smoked after the flip in Step 5.
    const ctx = {
      overrides: {
        [feature]: {
          model: "google/gemini-3.8-flash",
          set: { reasoning_effort: "low" },
        },
      },
      fallback: "off" as const,
      calls: [] as unknown[],
    };
    const t = Date.now();
    const out = await withAiCallContext(ctx as never, async () =>
      RUN[feature](await b64(url)),
    );
    console.log(
      JSON.stringify(
        { feature, url, ms: Date.now() - t, calls: ctx.calls, out },
        null,
        0,
      ).slice(0, 3000),
    );
  }
}
```

Check each import name against its file before running:

```bash
grep -nE "^export (async )?function (classifyAndAnalyze|analyzeRecipePhoto|analyzeReceiptPhotos|analyzeIngredientPhoto|analyzeImageForRecipe)" server/services/*.ts
```

- [ ] **Step 2: Run it, then read every reply against its photo.**
  - Run: `npx tsx <scratchpad>/vision-batch1-check.ts > <scratchpad>/batch1.jsonl`
  - For each line, open the photo and judge the reply yourself. This is the
    #1509 lesson: a text-only judge cannot see the image.
  - Note any reply with `finish_reason: "length"`, or a JSON parse failure (the
    service would return its error shape).
  - Also run the same script once with the overrides removed. That gives the
    gpt-4o replies on the same photos, so the comparison is like-for-like.
  - **Stop condition:** a row whose Gemini replies are clearly worse than
    gpt-4o's on these photos is NOT flipped. Report it to the owner with the
    two replies side by side.

- [ ] **Step 3: Write the failing test.** Add the passing rows to
      `VERTEX_FIRST` and `SWITCHED`, each as:

```ts
    "<row>": {
      model: "google/gemini-3.8-flash",
      json: <unchanged>,      // photo-classify/photo-recipe/receipt-scan/cooking-ingredient-photo: true; recipe-chat-image: false
      vision: true,
      primary: "vertex",
      adapt: { set: { reasoning_effort: "low" } },
    },
```

Run: `npx vitest run server/lib/__tests__/ai-models.test.ts` → FAIL.

- [ ] **Step 4: Implement.**
  - Add a shared constant in `ai-models.ts` under `LUNA`:

```ts
// Gemini 3.8 Flash on Vertex AI direct, OpenRouter fallback, never OpenAI
// (spec 2026-10-19-vision-rows-vertex-direct). Low reasoning keeps JSON
// replies inside their token caps.
const VISION_FLASH = {
  model: "google/gemini-3.8-flash",
  primary: "vertex",
  adapt: { set: { reasoning_effort: "low" } },
} as const;
```

- Set each passing row to `{ ...VISION_FLASH, json: <same>, vision: true }`.
- Rewrite `photo-analyze` as `{ ...VISION_FLASH, json: true, vision: true }`,
  keeping its approval comment.
- Raise a token cap only for a row that showed `finish_reason: "length"` in
  Step 2. Put the measured completion-token numbers in a comment beside the
  new value.

Run: `npx vitest run server/lib/__tests__/ai-models.test.ts` → PASS.

- [ ] **Step 5: Smoke on the direct path, then commit, review, PR, merge.**
  - Run: `npm run ai:smoke -- photo-classify photo-recipe receipt-scan cooking-ingredient-photo recipe-chat-image`
    Expected: each `✔` with provider `vertex`.
  - Commit message: "vision rows on Gemini Flash via Vertex direct:
    photo-classify, photo-recipe, receipt-scan, cooking-ingredient-photo,
    recipe-chat-image".
  - The PR body has a table: row | photos checked | Gemini vs gpt-4o verdict |
    max completion tokens | cap change.
  - Review roster: `code-reviewer` + `ai-reviewer`.
  - Merge, and prove arrival in prod logs as in Task 6.

---

## PR 4 — three risky rows (branch `evals/vision-risky-rows`, then `ai/vision-rows-vertex-batch2`)

### Task 8: Make the menu analysis testable without the database

`analyzeMenuPhoto(imageBase64, userId)` loads the user and profile from
storage. An eval needs to pass user context directly.

**Files:**

- Modify: `server/services/menu-analysis.ts:71`
- Test: `server/services/__tests__/menu-analysis.test.ts`

**Interfaces:**

- Produces:
  - `export interface MenuUserContext { userContext: string; userAllergies: { name: string; severity: AllergySeverity }[] }`;
  - `export async function analyzeMenuPhotoWithContext(imageBase64: string, ctx: MenuUserContext): Promise<MenuAnalysisResult>`;
  - `analyzeMenuPhoto` keeps its signature and behavior.

- [ ] **Step 1: Write the failing test** in `menu-analysis.test.ts`. Follow the
      file's existing `aiChat` mock pattern: read lines 1–60 first.

```ts
it("analyzeMenuPhotoWithContext puts the given context in the system prompt and flags allergens", async () => {
  mockAiReply({
    menuItems: [
      {
        name: "Pad Thai",
        description: "rice noodles, peanuts, egg",
        estimatedCalories: 700,
        estimatedProtein: 25,
        estimatedCarbs: 90,
        estimatedFat: 25,
        tags: [],
        recommendation: "okay",
        recommendationReason: "x",
      },
    ],
  });
  const result = await analyzeMenuPhotoWithContext("img", {
    userContext:
      "\n\nUser context for personalized recommendations:\nAllergies: peanuts",
    userAllergies: [{ name: "peanuts", severity: "severe" }],
  });
  const body = vi.mocked(aiChat).mock.calls.at(-1)![1] as {
    messages: { role: string; content: unknown }[];
  };
  expect(String(body.messages[0].content)).toContain("Allergies: peanuts");
  expect(result.allergenFlags?.["Pad Thai"]).toBeDefined();
  expect(storage.getUser).not.toHaveBeenCalled();
});
```

Adapt `mockAiReply` and the `storage` mock names to whatever the file already
uses. Do not introduce a second mocking style.

- [ ] **Step 2: Run it and confirm it fails.**

Run: `npx vitest run server/services/__tests__/menu-analysis.test.ts`
Expected: FAIL, because `analyzeMenuPhotoWithContext` is not exported.

- [ ] **Step 3: Implement.** Split `analyzeMenuPhoto`:
  - Move the user/profile fetch and context building (lines 75–113) into
    `async function loadMenuUserContext(userId: string): Promise<MenuUserContext>`.
    Keep its try/catch that returns empty context on failure.
  - Move everything from `let response;` onward into
    `analyzeMenuPhotoWithContext(imageBase64, { userContext, userAllergies })`.

```ts
export async function analyzeMenuPhoto(
  imageBase64: string,
  userId: string,
): Promise<MenuAnalysisResult> {
  return analyzeMenuPhotoWithContext(
    imageBase64,
    await loadMenuUserContext(userId),
  );
}
```

- [ ] **Step 4: Run and confirm everything passes.** All existing
      menu-analysis tests must pass unchanged.

Run: `npx vitest run server/services/__tests__/menu-analysis.test.ts` → PASS.

- [ ] **Step 5: Commit.** Message: "menu-analysis: analyzeMenuPhotoWithContext
      so evals can pass user context without the DB".

### Task 9: Two eval assertions: label numbers within tolerance, menu dish flagged

**Files:**

- Modify: `evals/types.ts` (the `EvalTestCase.assertions` interface, and
  `evalTestCaseSchema` if it lists assertion keys)
- Modify: `evals/assertions.ts` (`runStructuralAssertions`)
- Test: `evals/__tests__/assertions.test.ts` (check the name with
  `ls evals/__tests__`)

**Interfaces:**

- Produces two assertion keys:
  - `labelFields?: Record<string, { expected: number | null; tolerancePct?: number }>`.
    It checks `structuredData[field]`. `null` expected means the field must be
    `null`. The default tolerance is 5%, with an absolute floor of 1 unit.
  - `menuItemsMustFlag?: string[]`. Each name must match a `menuItems[].name`
    (case-insensitive substring), and that item must have
    `recommendation === "avoid"` or an `allergenFlags` entry.

- [ ] **Step 1: Write the failing tests.**

```ts
describe("labelFields", () => {
  const a = (expected: number | null, got: unknown, tolerancePct?: number) =>
    runStructuralAssertions(
      { calories: got },
      { labelFields: { calories: { expected, tolerancePct } } },
    );
  it("passes within 5% or 1 unit", () => {
    expect(a(200, 209).passed).toBe(true);
    expect(a(10, 11).passed).toBe(true);
  });
  it("fails outside tolerance and names the field", () => {
    const r = a(200, 230);
    expect(r.passed).toBe(false);
    expect(r.failures[0]).toMatch(/calories.*200.*230/);
  });
  it("expected null requires null", () => {
    expect(a(null, null).passed).toBe(true);
    expect(a(null, 0).passed).toBe(false);
  });
  it("a missing field fails", () => {
    expect(a(5, undefined).passed).toBe(false);
  });
});

describe("menuItemsMustFlag", () => {
  const data = {
    menuItems: [
      { name: "Satay Chicken", recommendation: "great" },
      { name: "Pad Thai", recommendation: "avoid" },
    ],
    allergenFlags: { "Satay Chicken": { allergen: "peanuts" } },
  };
  it("passes when the item is avoid or allergen-flagged", () => {
    expect(
      runStructuralAssertions(data, {
        menuItemsMustFlag: ["pad thai", "satay"],
      }).passed,
    ).toBe(true);
  });
  it("fails when the item is missing or neither", () => {
    const r = runStructuralAssertions(
      { menuItems: [{ name: "Pad Thai", recommendation: "good" }] },
      { menuItemsMustFlag: ["pad thai", "massaman"] },
    );
    expect(r.failures).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail.**

Run: `npx vitest run evals/__tests__/assertions.test.ts` → FAIL, because the
keys are unknown.

- [ ] **Step 3: Implement.** In `evals/types.ts`, add both keys to the
      `assertions` object type with one-line comments, in the style of the
      neighbouring keys. If `evalTestCaseSchema` enumerates assertion keys, add
      zod entries with the same shapes.

In `runStructuralAssertions`, before its final return:

```ts
if (assertions.labelFields) {
  const d = (structuredData ?? {}) as Record<string, unknown>;
  for (const [field, { expected, tolerancePct = 5 }] of Object.entries(
    assertions.labelFields,
  )) {
    const got = d[field];
    if (expected === null) {
      if (got !== null)
        failures.push(
          `labelFields.${field}: expected null, got ${String(got)}`,
        );
      continue;
    }
    if (typeof got !== "number") {
      failures.push(
        `labelFields.${field}: expected ${expected}, got ${String(got)}`,
      );
      continue;
    }
    const allowed = Math.max(1, Math.abs(expected) * (tolerancePct / 100));
    if (Math.abs(got - expected) > allowed)
      failures.push(
        `labelFields.${field}: expected ${expected} ±${allowed}, got ${got}`,
      );
  }
}

if (assertions.menuItemsMustFlag) {
  const d = (structuredData ?? {}) as {
    menuItems?: { name?: string; recommendation?: string }[];
    allergenFlags?: Record<string, unknown>;
  };
  for (const wanted of assertions.menuItemsMustFlag) {
    const item = d.menuItems?.find((m) =>
      m.name?.toLowerCase().includes(wanted.toLowerCase()),
    );
    if (!item) {
      failures.push(`menuItemsMustFlag: no menu item matching "${wanted}"`);
    } else if (
      item.recommendation !== "avoid" &&
      !d.allergenFlags?.[item.name ?? ""]
    ) {
      failures.push(
        `menuItemsMustFlag: "${item.name}" is "${item.recommendation}" and not allergen-flagged`,
      );
    }
  }
}
```

- [ ] **Step 4: Run and confirm they pass.**

Run: `npx vitest run evals/__tests__/assertions.test.ts` → PASS.

- [ ] **Step 5: Commit.** Message: "evals: labelFields and menuItemsMustFlag
      structural assertions".

### Task 10: Three suites: datasets, schemas, runners, npm scripts

**Files:**

- Create:
  - `evals/datasets/label-scan-cases.json`
  - `evals/datasets/front-label-scan-cases.json`
  - `evals/datasets/menu-scan-cases.json`
- Create:
  - `evals/runner-label-scan.ts`
  - `evals/runner-front-label-scan.ts`
  - `evals/runner-menu-scan.ts`
- Modify: `evals/lib/dataset-schemas.ts` (3 case schemas)
- Modify: `package.json` scripts: `eval:label`, `eval:front-label`, `eval:menu`
- Test: `evals/__tests__/dataset-schemas.test.ts`. If it exists, add one
  "each committed dataset parses" case per new file. Otherwise create it with
  those three cases.

**Interfaces:**

- Consumes: `analyzeLabelPhoto` (`photo-analysis.ts:505`), `analyzeFrontLabel`
  (`front-label-analysis.ts:55`), `analyzeMenuPhotoWithContext` (Task 8), the
  Task 9 assertions, and `runEvalSuite` (`evals/lib/runner-core.ts:432`).
- Produces: `npm run eval:label|eval:front-label|eval:menu`, writing result
  files to `evals/results/` that `eval:paired` reads.

- [ ] **Step 1: Write the failing test** (dataset parse):

```ts
import * as fs from "fs";
import * as path from "path";
import {
  labelScanCasesSchema,
  frontLabelScanCasesSchema,
  menuScanCasesSchema,
} from "../lib/dataset-schemas";

const load = (f: string) =>
  JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "datasets", f), "utf8"),
  );

it.each([
  ["label-scan-cases.json", labelScanCasesSchema, 8],
  ["front-label-scan-cases.json", frontLabelScanCasesSchema, 8],
  ["menu-scan-cases.json", menuScanCasesSchema, 8],
] as const)("%s parses and has at least %i cases", (file, schema, min) => {
  const cases = schema.parse(load(file));
  expect(cases.length).toBeGreaterThanOrEqual(min);
});

it("menu set has ≥3 allergy cases with menuItemsMustFlag", () => {
  const cases = menuScanCasesSchema.parse(load("menu-scan-cases.json"));
  expect(
    cases.filter(
      (c) =>
        c.input.userAllergies.length > 0 &&
        c.assertions?.menuItemsMustFlag?.length,
    ).length,
  ).toBeGreaterThanOrEqual(3);
});
```

Run: `npx vitest run evals/__tests__/dataset-schemas.test.ts` → FAIL, because
the schemas and files are missing.

- [ ] **Step 2: Add the schemas** to `evals/lib/dataset-schemas.ts`, modelled
      on `photoAnalysisCaseSchema` (lines 225–257):

```ts
const visionCaseBase = {
  id: z.string().min(1),
  category: z.enum([
    "safety",
    "accuracy",
    "helpfulness",
    "personalization",
    "edge-case",
    "creativity",
  ]),
  description: z.string(),
};
const labelFieldSchema = z.object({
  expected: z.number().nullable(),
  tolerancePct: z.number().positive().optional(),
});

export const labelScanCaseSchema = z.object({
  ...visionCaseBase,
  input: z.object({ imageUrl: z.string().url() }),
  assertions: z
    .object({
      labelFields: z.record(labelFieldSchema).optional(),
      mustContain: z.array(z.string()).optional(),
    })
    .optional(),
});
export const labelScanCasesSchema = z.array(labelScanCaseSchema);
export type LabelScanInput = z.infer<typeof labelScanCaseSchema>["input"];

export const frontLabelScanCaseSchema = z.object({
  ...visionCaseBase,
  input: z.object({ imageUrl: z.string().url() }),
  assertions: z
    .object({
      mustContain: z.array(z.string()).optional(),
      mustNotContain: z.array(z.string()).optional(),
    })
    .optional(),
});
export const frontLabelScanCasesSchema = z.array(frontLabelScanCaseSchema);
export type FrontLabelScanInput = z.infer<
  typeof frontLabelScanCaseSchema
>["input"];

export const menuScanCaseSchema = z.object({
  ...visionCaseBase,
  input: z.object({
    imageUrl: z.string().url(),
    userContextLines: z.array(z.string()).default([]),
    userAllergies: z
      .array(
        z.object({
          name: z.string(),
          severity: z.enum(["mild", "moderate", "severe"]),
        }),
      )
      .default([]),
  }),
  assertions: z
    .object({
      menuItemsMustFlag: z.array(z.string()).optional(),
      mustContain: z.array(z.string()).optional(),
    })
    .optional(),
});
export const menuScanCasesSchema = z.array(menuScanCaseSchema);
export type MenuScanInput = z.infer<typeof menuScanCaseSchema>["input"];
```

Check that the `severity` enum matches `AllergySeverity` in `shared/`:
`grep -rn "AllergySeverity =" shared`. Use that type's values.

- [ ] **Step 3: Build the datasets.** This is the slow, human-judgment step,
      and it needs owner review before measuring.
  - 8–12 cases per file. Use public-licence images only (Wikimedia Commons
    original-file URLs, as in `photo-analysis-cases.json`).
  - **Open every image before writing its case.** `description` is a written
    inventory of what is visible, hedged where the photo is unclear. The judge
    never sees the image.
  - **Label:** a US Nutrition Facts panel per case, including at least 2 hard
    ones (angled, glare, or a dual-column panel). `labelFields` lists every
    number you can read with certainty, copied from the photo by eye. For any
    number you can't read with certainty, either leave it out or set
    `expected: null` only if the panel truly lacks it.
  - **Front label:** `mustContain` holds the brand and product name as printed.
    One case has no brand visible (`mustNotContain` of a made-up brand isn't
    useful; instead assert the description says the brand is absent).
  - **Menu:**
    - At least 3 allergy cases: `userAllergies` names an allergen that a
      listed dish visibly contains (peanut, shellfish, milk), and
      `menuItemsMustFlag` names that dish.
    - At least 2 cases with no user context.
    - `userContextLines` mirrors what `loadMenuUserContext` produces, e.g.
      `["Daily calorie goal: 2000", "Allergies: peanuts"]`.

Run: `npx vitest run evals/__tests__/dataset-schemas.test.ts` → PASS.

Then **stop and show the owner the three datasets.** List each case's id,
description and assertions, with its image link. Measure only after the owner
says yes.

- [ ] **Step 4: Write the three runners**, each modelled on
      `evals/runner-photo-analysis.ts`: same fetch helper, schema load, and
      `runEvalSuite` call. The differences:

`evals/runner-label-scan.ts`:

```ts
// suiteName "label-scan"; dimensions ["extraction_accuracy","null_honesty"], weights {2,1}
// RUBRIC: EXTRACTION_ACCURACY — every number on the panel read correctly (1 = most wrong, 10 = all exact);
//         NULL_HONESTY — unreadable/absent fields are null rather than guessed (1 = invents values, 10 = never guesses).
generateResponse: async (tc) => {
  const i = tc.input as LabelScanInput;
  const start = Date.now();
  const result = await analyzeLabelPhoto(await fetchImageAsBase64(i.imageUrl));
  const latencyMs = Date.now() - start;
  const text = JSON.stringify(result, null, 2);
  return { text, structuredData: result, latencyMs, wordCount: text.split(/\s+/).length };
},
formatInput: (tc) => `Description: ${tc.description}\nImage URL: ${(tc.input as LabelScanInput).imageUrl}`,
```

`evals/runner-front-label-scan.ts`:

```ts
// suiteName "front-label-scan"; dimensions ["identification_accuracy","claim_accuracy"], weights {2,1}
// RUBRIC: IDENTIFICATION_ACCURACY — brand, product name, net weight as printed;
//         CLAIM_ACCURACY — listed claims appear on the pack, none invented.
generateResponse: async (tc) => {
  const i = tc.input as FrontLabelScanInput;
  const start = Date.now();
  const result = await analyzeFrontLabel(await fetchImageAsBase64(i.imageUrl));
  const latencyMs = Date.now() - start;
  const text = JSON.stringify(result, null, 2);
  return { text, structuredData: result, latencyMs, wordCount: text.split(/\s+/).length };
},
```

`evals/runner-menu-scan.ts`:

```ts
// suiteName "menu-scan"; dimensions ["item_extraction","allergy_safety","recommendation_fit"], weights {1,3,1}
// RUBRIC: ITEM_EXTRACTION — dishes on the menu listed with plausible macros;
//         ALLERGY_SAFETY — any dish containing a listed allergy is "avoid" with the allergen named in the reason (1 = recommends it, 10 = always flags);
//         RECOMMENDATION_FIT — ratings follow the stated goals.
generateResponse: async (tc) => {
  const i = tc.input as MenuScanInput;
  const userContext = i.userContextLines.length
    ? `\n\nUser context for personalized recommendations:\n${i.userContextLines.join("\n")}`
    : "";
  const start = Date.now();
  const result = await analyzeMenuPhotoWithContext(await fetchImageAsBase64(i.imageUrl), {
    userContext,
    userAllergies: i.userAllergies,
  });
  const latencyMs = Date.now() - start;
  const text = JSON.stringify(result, null, 2);
  return { text, structuredData: result, latencyMs, wordCount: text.split(/\s+/).length };
},
formatInput: (tc) => {
  const i = tc.input as MenuScanInput;
  return [`Description: ${tc.description}`, `Image URL: ${i.imageUrl}`, `User context: ${i.userContextLines.join("; ") || "(none)"}`].join("\n");
},
```

Write each rubric in full, in the `RUBRIC_TEXT` format of the photo runner
(1/5/10 anchors per dimension). Dispatch `prompt-engineer` once to review the
three rubrics before the first measured run.

`package.json` scripts, beside `eval:photo`:

```json
    "eval:label": "npx tsx evals/runner-label-scan.ts",
    "eval:front-label": "npx tsx evals/runner-front-label-scan.ts",
    "eval:menu": "npx tsx evals/runner-menu-scan.ts",
```

- [ ] **Step 5: Smoke each runner** with `EVAL_SAMPLES_PER_CASE=1` on today's
      model (gpt-4o via OpenRouter). This proves the plumbing, not the model.

```bash
npm run eval:label && npm run eval:front-label && npm run eval:menu
```

Expected: each completes all cases. Assertion failures are allowed here, but
there must be no runner crash.

- [ ] **Step 6: Commit, review, PR, merge** (branch `evals/vision-risky-rows`).
  - Commit message: "evals: label, front-label and menu photo suites".
  - Review roster: `code-reviewer` + `ai-reviewer`.
  - The datasets carry no secrets or user data. Image links are public.

### Task 11: Paired measurements and owner decision (no code)

- [ ] **Step 1: Run the baseline (gpt-4o).** `EVAL_SAMPLES_PER_CASE=3`, for
      each suite. Note the result file names.

- [ ] **Step 2: Run the candidate (Gemini Flash-low).** At this point the rows
      are unflagged, so the candidate override runs via OpenRouter → google-vertex.
      That is the same model and host as the direct path, and the result is
      labelled so. Use `EVAL_SAMPLES_PER_CASE=3` and
      `--candidate "<row>=google/gemini-3.8-flash;reasoning_effort=low"`, where
      `<row>` is `photo-label`, `front-label-scan` and `menu-scan` respectively.

- [ ] **Step 3: Compare.**
      `npm run eval:paired -- --baseline-file <A> --candidate-file <B>` per suite.
      Before trusting any score, read every case's two replies against its photo.

- [ ] **Step 4: Report to the owner in plain words, per row:**
  - the score difference with its CI;
  - assertion failures for both models (label numbers off; menu dishes not
    flagged);
  - p50 and p90 latency;
  - the truncation count;
  - a one-line recommendation.

  **Stop and wait for the owner's yes or no per row.** A row the owner does not
  approve stays on gpt-4o. Record the ruling in the ledger and in the memory
  file `project_gpt4o_retirement_2027.md`.

### Task 12: Switch the approved rows, privacy rows (branch `ai/vision-rows-vertex-batch2`)

**Files:**

- Modify: `server/lib/ai-models.ts` (approved rows → `{ ...VISION_FLASH, json: true, vision: true }`)
- Modify: `server/lib/__tests__/ai-models.test.ts` (`SWITCHED`, `VERTEX_FIRST`)
- Modify: `site/privacy/index.html:70-71`, and only if `menu-scan` is approved

- [ ] **Step 1: Write the failing test.** Add the approved rows to `SWITCHED`
      and `VERTEX_FIRST`. If all three are approved, replace the allowlist test
      with the final rule:

```ts
it("every vision row is Vertex-first (spec 2026-10-19 rollout complete)", () => {
  for (const [name, row] of rows) {
    if (row.vision) expect(row.primary, name).toBe("vertex");
  }
});
```

Run: `npx vitest run server/lib/__tests__/ai-models.test.ts` → FAIL.

- [ ] **Step 2: Implement the row changes.** Run the same test → PASS.

- [ ] **Step 3: Privacy, only if `menu-scan` is approved.** Replace the Google
      row (line 71):

```html
<tr>
  <td>Google (Vertex AI)</td>
  <td>
    Photo scanning (identifying foods, labels, menus and recipes in a photo)
  </td>
  <td>
    The photo and the scan instructions; for menu scans, also your goal,
    allergies and food dislikes, to suggest dishes — not your chats
  </td>
</tr>
```

In the OpenAI row (line 70), remove "Photo analysis" from the purposes cell if
no vision row remains on OpenAI. Rewrite the cell from the live
`AI_FEATURES` text rows, and leave the rest of the row as it is.

- [ ] **Step 4: Smoke.** `npm run ai:smoke -- photo-label front-label-scan menu-scan`
      (approved ones only) → `✔`, provider `vertex`.

- [ ] **Step 5: Commit, review, PR, merge, prove in prod.**
  - Review roster: `code-reviewer` + `ai-reviewer`, plus `security-auditor` if
    the privacy text changed (user health data disclosure).
  - After merge, check prod logs for `provider: "vertex"` per switched feature.
  - Update memory: `project_gpt4o_retirement_2027.md` records which vision rows
    are done, and that the OpenAI-direct backup is gone for them.
  - Update the `MEMORY.md` line count ("N/34 AI_FEATURES still on gpt-4o/mini").
