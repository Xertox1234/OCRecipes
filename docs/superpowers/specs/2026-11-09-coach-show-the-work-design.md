# Coach: show the work, then get out of the way

Date: 2026-11-09 · Status: design, awaiting owner approval
Source: Coach chat polish research (2026-11-08), ideas M1, M2, M4 and R8.

## Why

The owner's complaint is that Coach "kept ending each reply with the same thing about my targets". Every reply repeats the remaining calories and protein, whether or not the question had anything to do with them. Repetition is the quickest sign of a template, and it makes Coach read as canned.

The owner also wants to **see each step Coach takes** while it works. Their earlier complaint about the original chat was that it was **too fast**: things flashed past before they could be read. The pacing work in #1798–#1801 set the house rule for that: buffer, then release at a readable pace, and never burst. Those PRs are merged but have not reached the phones (no OTA since).

Success: replies feel written for the question that was asked, and a person can watch Coach work step by step at a pace they can read.

## What changes

### 1. Targets only when they change the answer (R8)

Owner decision: Coach mentions calorie or macro targets only when the answer depends on them:

- the user asks about their progress or today's intake ("how am I doing?");
- the answer turns on the numbers ("can I fit a burger tonight?", choosing between two meals, planning a meal);
- a write card the user just saved changed the totals. The card itself shows the new figure.

When numbers appear, Coach gives **the one figure that matters** ("about 40 g protein left"), not both full targets. Numbers never appear as a closing line, and never on general nutrition questions, cooking tips, substitutions or small talk.

**What causes the repetition today.** The default "personalized_advice" prompt in `server/services/nutrition-coach.ts` says, around lines 277–278:

- "ALWAYS reference at least one specific number from the user's context … A response with no specific numbers is too generic."
- "Calculate remaining macros … and cite them: 'You have about 200 calories and 10g protein left today.'"

Several worked examples also anchor on the remaining calories and protein: the off-topic redirect (~262, ~270), the general-question rule (~239, ~246) and the unsafe-request template (~203–213). These must change to the rule above. The context block itself can still send "Remaining today: …" (~384) to the model; the model just stops reciting it.

**Keep:**

- The no-invented-numbers rule (~279).
- The allergy and dislike rules.
- "Prioritize nutrients the user is SHORT on" when Coach suggests food.
- Personalization itself. Coach still anchors on something real about the user (a goal, a preference, a logged meal); it just doesn't default to the targets sentence.

**Safety template (~202–213).** The unsafe-request refusal keeps its three parts: opener, refusal plus referral, safe alternative. Its opener and alternative must stop requiring the remaining-calories figure. _Builder's call, within these limits:_ change the wording without weakening the refusal or the referral. The existing safety tests must still pass.

**Evals (my call, from the builder check).** `npm run eval:coach` (`evals/runner.ts`) only calls `generateCoachResponse`, the free-tier path. It runs single turns with no tools, so it never exercises the Coach Pro prompt.

Its judge's PERSONALIZATION 10 anchor rewards "remaining macros" (`runner.ts` ~38–41). That anchor changes to "anchors on something real about the user (goal, preference, logged meal); cites numbers only when the answer depends on them". This is part of the work, not a regression.

Plan:

- Add cases for the new rules: an off-topic question, a general nutrition question (no targets line expected) and a "can I fit X" question (one figure expected). Add a reply-length assertion to `evals/assertions.ts`.
- Run the old rubric on the current prompt once as the "before" record.
- Run the new rubric on the new prompt, and refresh `evals/baselines/coach.json` from that run.
- Quote each run's cost and get the owner's OK before it runs.
- The Coach Pro prompt is checked by hand in the simulator: a no-tool question, a "can I fit X" question and a write-card turn.

### 2. Answer first, two or three sentences (M4)

Owner decision: by default a reply leads with the direct answer in **two or three sentences**, then stops. It is longer only when the content needs it: a meal plan, a recipe or a weekly look-back. Those use two or three short **bold lead-in lines**, not markdown headers.

_My call:_ the persona's "no headers, tables or code blocks" rule stays, because the chat renderer isn't built for headers. Its 150-word cap (`nutrition-coach.ts` ~351–352) is lifted only for plans, recipes and look-backs.

Follow-ups:

- **Coach Pro:** offered as tap-to-ask chips, using the existing quick-reply block, not as a closing paragraph listing options. Write cards keep their one line of text around the card.
- **Free tier:** _my call._ It has no blocks (they are parsed only on the Pro path), so a free reply may end with at most one short follow-up question, and only when it is genuinely needed.

This is a prompt change only; the quick-reply block already exists. The safety examples that end in "want me to…?" follow the same rule.

### 3. One line that shows each step, then a "Checked:" trail (M1, M2)

Owner decision: **option C**, a single line that updates. Option A was a checklist that folds away; option B kept the steps above the reply.

**While Coach works:** one quiet line under the user's message names the step happening now, in specific words. Examples:

- "Reading today's log…"
- "Looking up a beef burger…"
- "Checking your pantry…"
- "Finding high-protein dinners…"

It changes as Coach moves on to the next step.

**After the reply:** that line becomes a single trail line under the reply text, e.g. "Checked: today's log · beef burger · your goal".

- A reply that used no tools shows no trail.
- The trail is saved with the message, so it is still there when the user scrolls back or reopens the chat.
- _My call:_ the trail is not tappable. It is one quiet line of secondary text.

**Pacing (owner decision: never skip a step, never flash).**

- Steps go into a queue on the client. Each step stays on the line for a minimum reading time, even if the tool finished in 50 ms.
- _My call:_ about 1 s per step, as a named constant beside `coachRevealPacing` in `client/constants/animations.ts`.
- The reply's first words are held until the last step has had its minimum time. Most of that hold overlaps the model's own 1.5–2 s before its first token, so it seldom adds much wait.
- **Steps after text has started.** In Coach Pro the model can write a line before a tool call ("Let me check your log…"), and one reply can run several tool rounds.
  - _Owner decision:_ the prompt tells Coach not to write before it looks things up, because the step line now says that.
  - If text still arrives first, the step line shows **under the partial reply** while that step plays its reading time. The reply text is not paused.
  - Every step, early or late, goes in the trail.
  - Today the status row renders only while there is no streamed text (`StreamingBubble.tsx:79`, `CoachOverlayContent.tsx:476`), and `useCoachStream` drops status once text shows (~321). Both change.
- The existing 700 ms "Thinking…" hold (`HOLD_GATE_MS`) and the word-paced reveal from #1798 stay as they are.
- Reduced motion keeps the pacing (as #1798 did) and drops only the transition animation between labels.

**Labels must be true and specific.**

- The server builds every label from the tool name and its arguments, for example `lookup_nutrition` with "beef burger" becomes "Looking up a beef burger…". The model never writes label text.
- Values taken from arguments are sanitized (`sanitizeUserInput`) and cut short (_my call:_ about 40 characters).
- A label must not claim something happened that didn't. `log_food_item`, `add_to_meal_plan` and `add_to_grocery_list` never save anything themselves. In write-card mode they draft a card; otherwise they return a proposal. Their labels say so ("Preparing a card…" or similar), never "Logging food…". That fix applies to every client, including the old `status` field.
- Write-card mode also brought tools that have no label yet: `find_plan_recipes`, `get_my_recipes` and the card tools. Each gets a specific label. "Working on it…" remains the fallback for an unknown tool.
- Trail entries are short nouns ("today's log", "beef burger", "your pantry"). They are built from the same source as the live labels, de-duplicated, and limited to _my call:_ five entries.

**Where it applies:** Coach Pro chat, which is where tools run, and the Ask Coach overlay (`CoachOverlayContent`), which shares the status row. The free tier has no tools, so it gets the reply-shape changes (sections 1 and 2) only.

**Accessibility.** The status row already announces label changes to VoiceOver (`CoachStatusRow`). Paced steps keep that, one announcement per step. The trail is plain text read with the reply, not a live region.

## Constraints

- Keep the current design: restyle within `theme.ts` only (owner ruling 2026-10-29). The trail uses existing secondary-text styles.
- The server-sent event stream gains step data with label and trail text. Older clients ignore unknown fields: an OTA reaches only runtime 5.2.0 builds, and the phones are on 5.1.0. The current `{status: label}` event must keep working.
  - _My call:_ it keeps the plain per-tool labels, so old phones don't get fast-changing specific labels without the pacing queue.
  - The specific labels travel only in the new step data.
  - A test pins `status` to the plain table, apart from the "Logging food…" fix above.
- Tests first (strict TDD). Pure pacing and label logic goes in `*-utils.ts` files so Vitest can cover it, like `stream-reveal-utils.ts`.
- No new AI calls. Labels and trail come from data the server already has.

## Non-goals

- Chips for every question (M6) and time-of-day chips (P2). Separate work.
- Skeletons of incoming cards (M3), a coach mark with states (M7), numbers typography (M5).
- Changing the model or its reasoning setting to cut time to first token.
- A tappable or expandable trail.

## Anti-goals: it fails if…

- A step flashes past too fast to read, or the line flickers between labels.
- A label says something was done that wasn't ("Logged…" before the user tapped Save).
- Replies lose their personal anchor and turn generic. The fix removes the repeated targets sentence, not personalization.
- The refusal for unsafe requests gets weaker.
- Pacing makes Coach feel slow on a reply that used no tools. With no steps there is nothing to hold.

## Left to the builder

- Exact label wording per tool, within the rules above.
- The event shape for steps on the wire, and how the trail is stored in the message metadata.
- Exact prompt wording for sections 1 and 2.
- The minimum step time and label length cap. Starting values are given above; tune them on the simulator with the #1798 pacing in place.
