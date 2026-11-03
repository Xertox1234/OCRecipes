# Vertex AI direct as the backup route for five AI features (no OpenAI)

Date: 2026-11-02 · Status: design written from owner rulings; builder check pending

Builds on `2026-10-19-vision-rows-vertex-direct-design.md` (the Vertex client,
`vertexBreaker` and the Vertex-first flow shipped as plumbing in #1518/#1519).

## 1. Intent and owner rulings

gpt-4o and gpt-4o-mini shut down on OpenAI direct on **2027-01-14**. Every
`AI_FEATURES` row that is not Vertex-first falls back to one of them when
OpenRouter fails (down, circuit breaker open, or balance exhausted — 402). From
that date the backup errors instead of answering. The owner's goal (2026-10-19)
is to stop depending on OpenAI, including as the backup.

Rulings, all from the owner on 2026-11-02 (final, do not re-ask):

- **OpenRouter stays the primary route.** Nothing changes about the normal path.
- **The backup is Google Vertex AI, called directly** — never OpenAI.
- **The backup model is `google/gemini-3.8-flash` with `reasoning_effort: "low"`
  for every row in scope**, including `recipe-generate` (primary Gemini 4
  Argon). Argon on Vertex direct is a Google "frontier"/"advanced" model whose
  prompts and replies Google keeps for up to 30 days on every request; Flash is
  not. Owner: "flash is fine for now" — revisit when December's models ship.
- **Scope: five rows.**

  | Row               | Primary (OpenRouter, unchanged) | Streams | Tools             | JSON | Image                 |
  | ----------------- | ------------------------------- | ------- | ----------------- | ---- | --------------------- |
  | `coach-chat`      | `openai/gpt-6-luna`             | yes     | no                | no   | no                    |
  | `coach-pro-chat`  | `openai/gpt-6-luna`             | yes     | yes (multi-round) | no   | no                    |
  | `recipe-chat`     | `google/gemini-3.8-flash`       | yes     | no                | no   | no                    |
  | `recipe-generate` | `google/gemini-4-argon`         | no      | no                | yes  | no                    |
  | `photo-analyze`   | `google/gemini-3.8-flash`       | no      | no                | yes  | yes (`detail: "low"`) |

- **Privacy:** these rows carry diet, allergy and other profile context. The
  2026-10-20 ruling ("Vertex direct without zero retention; the privacy page
  must say so") extends to them. The privacy page changes in the PR that turns
  the backup on (§5).

### Non-goals

- The other 29 rows. They keep their OpenAI-direct fallback for now; moving
  them is later work under the same todo.
- `voice-transcription.ts` (whisper-1) and image generation.
- Changing any primary model, prompt, token cap or timeout.
- Threading Gemini's real thought signatures through the coach tool loop (§3.4
  uses Google's placeholder instead).

### Anti-goals (a failure even if it "works")

- Any of the five rows reaching OpenAI direct, in any path, including the
  no-OpenRouter-key path.
- A streamed reply stitched from two models (switching after the first chunk).
- A privacy page that is untrue on the day the backup can first carry
  profile data to Google directly.

## 2. Facts already checked live (2026-11-02)

Google Cloud is set up: project `ocrecipes-ai`, service account
`ocrecipes-vertex@ocrecipes-ai.iam.gserviceaccount.com` (role Agent Platform
User — Google has renamed Vertex AI to "Agent Platform" in the console), caching
disabled (`cacheConfig.disableCache: true`), the three `GOOGLE_VERTEX_*`
variables set in Railway production and the local `.env`. Railway redeployed
healthy; no row uses Vertex yet.

Calls through the real `createVertexClient()` (`server/lib/vertex-client.ts`),
model `google/gemini-3.8-flash`, `reasoning_effort: "low"`:

| Check                                                                                                                        | Result                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Plain text, non-streamed                                                                                                     | 200, ~2.0 s, `model` echoes `google/gemini-3.8-flash`                                    |
| Streamed, `temperature: 0.5`, `stream_options.include_usage`                                                                 | first chunk 1.7 s, total 2.0 s, standard `ChatCompletionChunk`s, usage on the last chunk |
| `response_format: { type: "json_object" }`                                                                                   | 200, valid JSON, `finish_reason: stop`, 2.3 s                                            |
| `image_url` data URL (512 px JPEG) + `detail: "low"` + JSON mode                                                             | 200, valid JSON (apple, 0.99), 2.3 s                                                     |
| Same with `detail: "high"`                                                                                                   | 200, valid JSON                                                                          |
| Tools, round 1 streamed                                                                                                      | tool call arrives with `extra_content.google.thought_signature`                          |
| Tools, round 2 **with** that signature echoed back                                                                           | 200                                                                                      |
| Tools, round 2 **without** it (what `nutrition-coach.ts` sends today)                                                        | **400**                                                                                  |
| Tool history made by another model (no signature)                                                                            | **400**                                                                                  |
| Same, with placeholder signature `skip_thought_signature_validator`                                                          | 200                                                                                      |
| Reverse: `openai/gpt-6-luna` on OpenRouter (Azure, ZDR) given Gemini-made tool history (id `call_93516`, no `extra_content`) | 200                                                                                      |

So the backup needs **no** `drop`/`rename` for JSON mode, images, `detail` or
`temperature`. Vertex replies carry no `usage.cost`; billing is read in Google
Cloud. Not tested: what a Vertex stream does when it fails mid-way (§3.3).

## 3. Design

### 3.1 Table (`server/lib/ai-models.ts`)

`AiFeatureConfig` gains:

```ts
/** Vertex AI direct as the backup when OpenRouter fails. Replaces `fallback`. */
vertexBackup?: { model: string; adapt?: AiAdapt };
```

- Each of the five rows drops `fallback` and gains
  `vertexBackup: { model: "google/gemini-3.8-flash", adapt: { set: { reasoning_effort: "low" } } }`
  (one shared constant). For `recipe-generate` the low effort is required, not
  cosmetic: Flash at default reasoning truncated the recipe JSON in 10/36
  samples (2026-10-17 measurement).
- `LUNA` loses its `fallback: "gpt-4o-mini"`.
- **Exactly one backup kind per row:** `fallback` (OpenAI direct),
  `vertexBackup`, or `primary: "vertex"` (Vertex-first, no `fallback`). The
  `fallback` field's doc comment ("Absent exactly when `primary` is vertex")
  becomes this three-way rule. The table test pins it, pins the five
  `vertexBackup` rows by name, and pins the backup model and adapt (so a change
  needs a test edit — owner approval).
- The `SWITCHED` map in `ai-models.test.ts` updates for the five rows; the
  "every other row is `openai/${fallback}` with no adapt" test still covers the
  other 29. `fallbackModel()` stays for those.

### 3.2 Request flow for a `vertexBackup` row (`server/lib/ai-client.ts`)

The OpenRouter attempt is unchanged (body, `adaptParams(params, row.adapt,
override?.set)`, `provider: { zdr: true, only: [host] }`, breaker accounting,
402 and `config` reports). Only what happens on failure changes:

1. **Where today's code calls `callFallback(reason, err)`** — OpenRouter
   breaker open, or an OpenRouter failure that is not an abort — a
   `vertexBackup` row calls the Vertex backup instead. Every non-abort failure
   kind goes to the backup, exactly as `callFallback` does today.
2. **The backup attempt.**
   - Skip it when `deps.vertex` is null or `deps.vertexBreaker` is open; then
     rethrow the OpenRouter error (or, for "OpenRouter breaker open", throw an
     error saying both routes are unavailable) and send a throttled report
     keyed `unavailable:<feature>`.
   - Body: `{ ...adaptParams(params, row.vertexBackup.adapt), model: row.vertexBackup.model }`,
     then §3.4's tool-history fix. No `provider` key. The row's own `adapt`
     (written for the primary model, e.g. Luna's `drop: ["temperature"]`) is
     **not** applied; the caller's params plus the backup's adapt are.
   - Same `options` (timeout, abort signal) as the caller passed.
   - Success: `deps.vertexBreaker.recordSuccess()`, `record(model, "vertex", true)`,
     info log `ai call` with `provider: "vertex"`, `fellBack: true`, usage.
   - Failure: abort → rethrow. Otherwise classify, feed `vertexBreaker` for the
     kinds `countsTowardBreaker` names, throttled `config` report keyed
     `vertex:<feature>`, report `unavailable:<feature>`, and throw the Vertex
     error.
3. **No OpenRouter key** (`deps.openrouter` null — local dev without the key):
   today this goes straight to OpenAI direct. A `vertexBackup` row goes to the
   Vertex backup instead; with Vertex also absent, throw a config error naming
   `OPENROUTER_API_KEY` and `GOOGLE_VERTEX_*`. It never calls `deps.fallback`.
4. **Eval context** (`ctx.fallback === "off"`): unchanged — OpenRouter only,
   failure recorded and thrown. Evals keep measuring the primary model.
5. **Messages.** The 402 report must not say "AI traffic is on the OpenAI
   fallback" for these rows; it says the feature is on the Vertex backup. The
   warn log `ai call using fallback` carries `provider: "vertex"`,
   `backupModel`, `fallbackReason`.

### 3.3 Streaming

Rule: **the switch can happen only before the first chunk reaches the caller.**

- `openStream` already peeks the first SSE event and throws if the request or
  that first event fails. That failure is caught by the same `catch` as a
  non-streamed failure, so step 1 above routes it to the backup.
- The backup stream does the same peek on the Vertex stream: open it, read the
  first event, treat a throw (or an error chunk) as a Vertex failure (step 2),
  otherwise record success on `vertexBreaker` and return
  `wrapStream(iterator, first, onEnd)` with `provider: "vertex"` in the
  `ai stream` log and `record(..., "vertex", true)`.
- `isErrorChunk` matches **OpenRouter's** in-stream error shape. Whether Vertex
  ever sends an error as a chunk, or only throws an `APIError`, is unverified
  (§2). The builder checks Google's docs for the OpenAI-compatible endpoint
  and makes sure a Vertex error in either form ends the stream with an error
  rather than a silent truncation; a unit test pins whichever shape is handled.
- After the first chunk, a failure on either route surfaces to the caller as
  today (`InStreamError` from `wrapStream`). No retry, no switch.
- Builder's choice: generalise `openStream` to take the client, breaker and
  provider label, or write a sibling. Either way one `wrapStream`.
- `runVertexFirst`'s "streaming is not supported" guard stays: it is about
  Vertex-_first_ rows, none of which stream.

### 3.4 Tool history on the Vertex route

Gemini 3.x on Vertex rejects (400) an assistant `tool_calls` entry without a
thought signature (§2). The coach-pro loop (`nutrition-coach.ts`, the
`while (toolCallCount <= MAX_TOOL_CALLS_PER_RESPONSE)` loop) rebuilds tool calls
from stream deltas and drops `extra_content`; and a reply can switch routes
between rounds (round 1 Luna, round 2 Flash after the breaker opens — or the
reverse).

Fix, in the Vertex body builder only: for every assistant message's
`tool_calls[i]` that has no `extra_content.google.thought_signature`, add
`extra_content: { google: { thought_signature: "skip_thought_signature_validator" } }`.
Never overwrite a signature that is present. Apply it on every Vertex body (the
backup and `runVertexFirst`); never on the OpenRouter body. `nutrition-coach.ts`
is not edited.

The reverse direction needs nothing: Luna on OpenRouter accepts Gemini-made
tool history (§2), and the OpenRouter body never carries `extra_content`
because `nutrition-coach.ts` drops it. A unit test pins that the OpenRouter
body has no `extra_content`.

### 3.5 Failure-time cost

A failed OpenRouter attempt followed by a Vertex attempt can take up to two
timeouts (e.g. `OPENAI_TIMEOUT_STREAM_MS` 30 s each for the coach). Today's
OpenAI fallback has the same property; the open breaker makes later calls skip
straight to Vertex. Accepted. The builder checks that the coach SSE route's own
timeout does not cut the backup off first and reports what it found.

## 4. Privacy page (`site/privacy/index.html`)

Ships in the PR that turns the backup on (§5, PR 2) — the policy and the data
flow change together. Requirements, wording left to the builder in the page's
existing plain style:

- **Google (Vertex AI) row** (line ~71), "What it does": recipe chat and recipe
  generation, some photo scanning, and a backup for the AI coach when our main
  AI route is down — reached through OpenRouter, or directly when OpenRouter is
  unavailable.
- **Google row, "What it receives":** messages, photos and the profile details
  a feature needs (goals, allergies, diet type, …), as the OpenRouter row lists.
  Say that when reached directly Google does not keep a copy, except that a
  request its automated safety systems flag may be kept for up to 90 days for
  review. **Re-check that number against Google's current data-governance page
  on the PR day** (the 2026-10-20 check found 90 days; the page's own text now
  says "limited periods of time").
- **OpenAI row** (line ~70): drop recipe chat and recipe generation (on Gemini
  since #1496/#1700 — the page is already stale here); "also used directly as
  a backup" becomes "for some features".
- **Today's Google row says "not your profile, goals or chats"** — already
  untrue for recipe chat via OpenRouter → Google. This PR fixes it.
- Update the "Effective" date (line 14).

## 5. Rollout (two PRs)

1. **PR 1 — plumbing, no behaviour change.** The `vertexBackup` field, the
   routing and streaming of §3.2–3.3, the tool-history fix of §3.4, `ai:smoke`
   support for the backup route (§6), unit tests. No row gains `vertexBackup`.
   This PR also rewrites the acceptance criteria of
   `todos/P2-2026-11-02-replace-retiring-openai-direct-fallback-on-every-ai-row.md`
   to these rulings (design decided; five rows done in PR 2) and keeps the todo
   open for the other 29 rows.
2. **PR 2 — turn it on.** The five rows switch from `fallback` to
   `vertexBackup`; `LUNA` loses its fallback; the table test updates; the
   privacy page (§4).
   - Gate before opening: `ai:smoke` on the backup route for all five rows,
     each reporting `finish_reason` and token use. The coach-pro run does a
     two-round tool exchange with the real coach tool set, twice: once with
     both rounds on the backup, once with round 1 forced to the backup and
     round 2 on OpenRouter. A `length` finish or a 400 on any row is reported
     and stops the PR until the owner decides.
   - After deploy: nothing to see in normal logs (backup only runs on failure).
     The smoke results are the evidence.

## 6. Testing

- **Unit (`server/lib/__tests__/ai-client.test.ts`, fake clients)** for a
  `vertexBackup` row:
  - OpenRouter success → Vertex never called.
  - OpenRouter fails (transport, 402, config, request) → Vertex answers;
    `deps.fallback` never called; record says `vertex`, `fellBack: true`.
  - OpenRouter breaker open → straight to Vertex.
  - Vertex null or `vertexBreaker` open → throws, `deps.fallback` never called,
    `unavailable` report.
  - Both fail → throws the Vertex error.
  - Abort on either route → rethrown, no further attempt.
  - No OpenRouter key → Vertex; neither → config error naming both.
  - Bodies: backup body has the backup model, `reasoning_effort: "low"`, the
    caller's `temperature`, `response_format` and image parts untouched, no
    `provider`; the row's `adapt` is not applied.
  - Streaming: OpenRouter throws on create → Vertex stream returned; OpenRouter
    first event is an error chunk → Vertex stream; OpenRouter fails after its
    first chunk → caller sees `InStreamError`, Vertex never called; a Vertex
    stream error (in whichever shape §3.3 settles) ends the stream with an error.
  - Tool history: a missing signature is filled with the placeholder; a present
    one is kept; the OpenRouter body carries no `extra_content`.
  - Eval context → OpenRouter only.
  - 402 report text names the Vertex backup, not OpenAI.
  - Unflagged rows: existing tests pass unmodified (regression guard for the 29).
- **Table tests:** §3.1's rules.
- **`ai:smoke`:** a way to force the backup route for a named row (flag or env —
  builder's call) that drives the real `aiChat`, not the Vertex client alone.

## 7. Risks

- **Real coach tool schemas on Flash.** §2 used a toy tool. The PR 2 smoke runs
  the real coach-pro tool set; a schema Vertex rejects shows up there.
- **Thought-signature placeholder.** Documented by Google for history from
  other models; it may lower reasoning continuity across tool rounds. Accepted
  for a backup path.
- **Vertex outage at the same time as OpenRouter.** Then these rows error, as
  any row does today when both of its routes fail.
- **Retention wording.** §4 must be re-verified on the PR day.

## 8. Calls made by the spec author (not owner rulings)

- Field name `vertexBackup` and its shape; one shared backup constant.
- The backup ignores the row's primary `adapt` and uses its own.
- Every non-abort failure kind goes to the backup (mirrors today's
  `callFallback`).
- `photo-analyze` stays OpenRouter-first with the Vertex backup, per today's
  ruling. This **supersedes** PR 2 of the 2026-10-19 spec for that row only
  (it planned `photo-analyze` as Vertex-first); the other 8 camera rows stay
  parked as before.
- Placeholder signature instead of threading real signatures through
  `nutrition-coach.ts`.
- Two PRs, privacy text in the second, todo rewrite in the first.
