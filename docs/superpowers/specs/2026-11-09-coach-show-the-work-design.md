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

**Evals.** `npm run eval:coach` measures reply quality. Prompt changes need a before-and-after run, and eval runs cost money, so quote the cost and get the owner's OK before running one. If a rubric line rewards "cites a specific number", it must change to match the new rule. That rubric change is part of this work, not a regression.

### 2. Answer first, two or three sentences (M4)

Owner decision: by default a reply leads with the direct answer in **two or three sentences**, then stops. It is longer only when the content needs it: a meal plan, a recipe or a weekly look-back. Those use two or three short headings.

Follow-ups are offered as tap-to-ask chips, using the existing quick-reply block, not as a closing paragraph listing options. Write cards keep their one line of text around the card. This is a prompt change only; the quick-reply block already exists.

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
- The existing 700 ms "Thinking…" hold (`HOLD_GATE_MS`) and the word-paced reveal from #1798 stay as they are.
- Reduced motion keeps the pacing (as #1798 did) and drops only the transition animation between labels.

**Labels must be true and specific.**

- The server builds every label from the tool name and its arguments, for example `lookup_nutrition` with "beef burger" becomes "Looking up a beef burger…". The model never writes label text.
- Values taken from arguments are sanitized (`sanitizeUserInput`) and cut short (_my call:_ about 40 characters).
- A label must not claim something happened that didn't. Since #1812, in write-card mode `log_food_item`, `add_to_meal_plan` and `add_to_grocery_list` only draft a card. Their labels say so ("Preparing a card…" or similar), never "Logging food…".
- Write-card mode also brought tools that have no label yet: `find_plan_recipes`, `get_my_recipes` and the card tools. Each gets a specific label. "Working on it…" remains the fallback for an unknown tool.
- Trail entries are short nouns ("today's log", "beef burger", "your pantry"). They are built from the same source as the live labels, de-duplicated, and limited to _my call:_ five entries.

**Where it applies:** Coach Pro chat, which is where tools run, and the Ask Coach overlay (`CoachOverlayContent`), which shares the status row. The free tier has no tools, so it gets the reply-shape changes (sections 1 and 2) only.

**Accessibility.** The status row already announces label changes to VoiceOver (`CoachStatusRow`). Paced steps keep that, one announcement per step. The trail is plain text read with the reply, not a live region.

## Constraints

- Keep the current design: restyle within `theme.ts` only (owner ruling 2026-10-29). The trail uses existing secondary-text styles.
- The server-sent event stream gains step data with label and trail text. Older clients ignore unknown fields: an OTA reaches only runtime 5.2.0 builds, and the phones are on 5.1.0. The current `{status: label}` event must keep working.
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
