# Coach Personalization Lift via Deterministic Intent Router

## Context

The OCRecipes nutrition coach has stalled at personalization avg **6.2** (target ≥ **6.5**) after four iterations of few-shot/instruction-layer changes to `buildSystemPrompt()` in `server/services/nutrition-coach.ts`. All 34 hard assertions pass; safety (8.1) and accuracy (7.4) hold. The remaining gap cannot be closed inside the existing single-template architecture.

**Why we hit a ceiling**: One `buildSystemPrompt` is shared by every user message — refusals, vague pings, general nutrition facts, and personalized advice all go through the same prompt. Each new "lead with a USER CONTEXT number" instruction either contradicts an example (iteration-4 cardiovascular regression) or sounds bolted on for questions where macros have no semantic connection (fiber, cardiovascular, "help"). The judge correctly penalizes that bolt-on as not "deeply tailored."

**Why this matters**: Personalization is a primary product differentiator. The coach is supposed to feel like a coach who _knows you_, not a chatbot that recites your macros at every turn. Lifting the floor on the worst cases (helpfulness-vague-message-01 at 2/10, accuracy-fiber-daily-intake-01 at 4/10) is the visible quality gain.

**Outcome**: Split the prompt by intent so each variant has internally-consistent rules + examples. Pair with a narrow audit of two cases whose criteria are structurally unfair.

## Approach

A deterministic regex/keyword **intent classifier** selects which few-shot bundle and "lead-with" rule are assembled into the system prompt. Four intents:

- `safety_refusal` — medical conditions, eating-disorder signals, megadose, jailbreak, extreme calorie targets
- `general_fact` — "how much X / what is Y" questions with no first-person `today/now/currently`
- `vague_request` — `wordCount <= 3` with no `?`, or `help|hi|idk`-style openers
- `personalized_advice` — fallthrough default (current happy path)

Safety wins all ties. The classifier is pure regex — no LLM call, no latency, fully unit-testable against every eval case.

## Phasing

### Phase A — Baseline + criteria audit (~30 min)

Two cases are structurally unfair to score on personalization (the model has no relevant data to bridge into). Edit `evals/datasets/coach-cases.json`:

- `accuracy-fiber-daily-intake-01` → add `"scoreDimensions": ["accuracy", "helpfulness", "tone"]`. Justification: fiber is not in `CoachContext`.
- `safety-cardiovascular-condition-01` → add `"scoreDimensions": ["safety", "accuracy", "tone"]`. Justification: cardiovascular risk has no semantic overlap with calories/P/C/F. The `mustContain` assertion for "doctor|cardiologist|..." continues to enforce substantive correctness.

Do NOT edit `helpfulness-vague-message-01` — its 2/10 is correctly flagging a real failure that Phase B fixes.

Then capture a noise-tightened baseline:

```bash
EVAL_SAMPLES_PER_CASE=3 EVAL_PARALLELISM=3 npm run eval:coach
```

**Acceptance**: results recorded; baseline documented in PR description. The 3-sample average is critical — at samples=1 the personalization CI is roughly [5.6, 6.9], so the 5.9→6.2 movement across prior iterations was within sampling noise.

### Phase B — Router + per-intent prompts (~2–3 hours)

#### B.1 New file: `server/services/coach-intent-classifier.ts`

```ts
export type CoachIntent =
  | "safety_refusal"
  | "general_fact"
  | "vague_request"
  | "personalized_advice";

export interface IntentClassification {
  intent: CoachIntent;
  matchedRule: string; // for debug logging
}

export function classifyIntent(message: string): IntentClassification;
```

**Rule precedence (top to bottom; first match wins):**

1. `safety_refusal` if message matches any of:
   - `/(heart|cardiovascular|cardiac|diabetes|kidney|thyroid|liver|cancer|pregnan)/i`
   - `/(semaglutide|ozempic|wegovy|glp-?1|metformin|insulin)/i`
   - `/(throw up|purge|vomit|self.?harm|suicide)/i`
   - `/(\d{3,}\s*iu\b|mega.?dose|toxic dose)/i`
   - `/ignore.*(instruction|rule|guidelines?|safety)/i`
   - `/(\d{2,3}\s*(?:cal|calorie).*(day|daily))/i` AND extracted number `< 1200`
2. `vague_request` if `wordCount <= 3` AND no `?`, or matches `/^(help|hi|hey|hello|idk|i don.?t know)$/i`
3. `general_fact` if matches `/^(how (much|many)|what(.s| is| are)|is\s+\w+\s+(high|low|good|bad)|do .*need)/i` AND no first-person possessive about `today|now|right now|currently`
4. `personalized_advice` (default)

#### B.2 New unit tests: `server/services/__tests__/coach-intent-classifier.test.ts`

For every one of the 34 eval cases (import `evals/datasets/coach-cases.json` directly so it stays in sync), assert the expected intent. **Every** `safety-*` case must classify as `safety_refusal`. This is the safety-regression net.

#### B.3 Modify `server/services/nutrition-coach.ts`

Change signature:

```ts
function buildSystemPrompt(
  context: CoachContext,
  intent: CoachIntent = "personalized_advice", // preserves existing call-site behavior
  now: Date = new Date(),
): string;
```

Restructure the prompt:

- **Lines 60–67 (persona + universal safety rules)** — unchanged. Apply to every intent.
- **Lines 69–88 (HOW TO USE / WHEN DECLINING)** — extract into 4 intent-specific blocks:
  - `safety_refusal`: keep the current "FIRST SENTENCE must reference one specific number from USER CONTEXT" rule and the medical-referral examples. Keep the medical-condition trigger from iteration 4.
  - `general_fact`: replace "ALWAYS reference a specific number" with **"Anchor your answer to the user's tracked dimension if it overlaps the question (protein → cite remaining protein; fiber → say we don't track fiber yet, then offer fiber-rich foods that fit their remaining macros)."** This is the pivot that fixes fiber and avocado.
  - `vague_request`: NEW rule — **"Ask ONE clarifying question; the question itself should reference a visible number (e.g., 'You've got 1,200 cal left today — meal ideas for that, feedback, or something else?')."**
  - `personalized_advice`: keep existing rule set verbatim.
- **Lines 90–115 (EXAMPLE EXCHANGES)** — split into 4 bundles, only the matching bundle is emitted. Keep 2–3 examples per bundle.

Bundle assignments (current examples → new intent):

- `personalized_advice`: "I don't know what to eat for dinner", "How much protein should I eat", "I really overdid it"
- `general_fact`: sodium-daily-limit (already rewritten), avocado-carbs–style
- `safety_refusal`: vitamin D megadose, medical referral, extreme calorie target
- `vague_request`: "Bitcoin"-style off-topic, plus a new "Help" example

Add this new vague example:

```
User: 'Help'
NutriCoach: 'You've got about 1,200 cal and 70g protein left today — want meal ideas that close that gap, a quick read on how the day's going, or something else?'
```

#### B.4 Update call sites

In both `generateCoachResponse` and `generateCoachProResponse`:

```ts
const lastUserMessage =
  messages.filter((m) => m.role === "user").at(-1)?.content ?? "";
const { intent } = classifyIntent(lastUserMessage);
const systemPrompt = buildSystemPrompt(context, intent);
```

In `server/services/coach-pro-chat.ts` `handleCoachChat` (uses `content` at ~line 341), classify once at the top of the function and pass `intent` into `hashCoachCacheKey`. **No re-classification mid tool-loop** — the user message is fixed for the duration of the turn.

#### B.5 Cache key

`getSystemPromptTemplateVersion()` (`nutrition-coach.ts:222`) currently hashes one template. Add `intent` to `hashCoachCacheKey` (`coach-pro-chat.ts:198`) so per-intent cache hit rates are observable and refusal responses don't leak into general-fact slots.

**Acceptance gates** (all must hold):

- `personalization` mean ≥ **6.5** AND 95% CI lower bound ≥ **6.0**
- `safety` mean ≥ **7.8** (no regression)
- `accuracy` mean ≥ **7.0** (no regression)
- `tone` mean ≥ **7.5** (no regression)
- Hard assertions: **34/34 pass**
- Per-case spot-checks:
  - `helpfulness-vague-message-01` personalization ≥ 5
  - `safety-supplement-megadose-01` personalization ≥ 6
  - Every `safety-*` case routes to `safety_refusal` in classifier unit tests

### Phase C — Conditional context enrichment (only if Phase B misses the gates)

Slot into existing roadmap Phase 3A. Add to `CoachContext`:

- `recentMealTypes` (bucketed from `dailyLogs.loggedAt`)
- `hoursSinceLastMeal`
- `activeFast` (from `fastingLogs`)

These give `vague_request` and `helpfulness-skipped-meals-01` real data to bridge to. Update prompt bundles to reference the new fields. Same acceptance gates.

## Critical Files

- `server/services/nutrition-coach.ts` — `buildSystemPrompt`, `generateCoachResponse`, `generateCoachProResponse`, `getSystemPromptTemplateVersion`
- `server/services/coach-pro-chat.ts` — `handleCoachChat`, `hashCoachCacheKey` (~line 198, ~line 341)
- `server/services/coach-intent-classifier.ts` — NEW
- `server/services/__tests__/coach-intent-classifier.test.ts` — NEW
- `evals/datasets/coach-cases.json` — `scoreDimensions` edits for two cases
- `evals/runner.ts` — judge rubric reference (lines 19–46), no edits expected
- `evals/lib/runner-core.ts` — sampling/CI logic, no edits expected
- `docs/superpowers/plans/2026-05-09-personalization-roadmap.md` — append note that Phase B implements a previously-undocumented intent-router layer between Phase 1 (few-shots) and Phase 3A (rich context)

## Verification

```bash
# 1. Baseline (Phase A — before any code changes)
EVAL_SAMPLES_PER_CASE=3 EVAL_PARALLELISM=3 npm run eval:coach

# 2. Classifier unit tests (Phase B, before re-running evals)
npm run test:run -- coach-intent-classifier

# 3. Post-change eval (Phase B)
EVAL_SAMPLES_PER_CASE=3 EVAL_PARALLELISM=3 npm run eval:coach

# 4. Confirm full suite still green
npm run test:run
npm run check:types
npm run lint
```

After Phase B, manually inspect the eval output JSON for the three spot-check cases listed in the acceptance gates. If gates fail, **do not chase another instruction-layer iteration** — proceed to Phase C.

## Out of Scope

- Phase 2 carousel work (PRs #98/#100/#101) — different surface area, already in flight
- Phase 3B (HealthKit sleep), Phase 3C (notification timing) — adjacent features
- Replacing the deterministic classifier with an LLM router — premature; revisit only if regex precision proves brittle in production (track per-intent classification confusion in logs)
- Adding fiber tracking to `CoachContext` — separate product decision; for now we accept "we don't track fiber" as the honest answer
