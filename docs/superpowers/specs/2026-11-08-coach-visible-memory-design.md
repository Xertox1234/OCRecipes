# Coach visible memory — design

Date: 2026-11-08 · Status: draft for owner review (builder check done) · Source: Coach chat polish report, R1–R4 (+ the recall-phrasing research run 2026-11-08)

## Intent

The coach keeps a notebook of facts about the user, extracted by a model from past chats. Today the
user can't see when something is saved. They also can't tell when the coach is drawing on memory,
and the coach's wording when it recalls things can feel confrontational ("You agreed to…"). The
owner was concerned about that wording.

Visible memory makes memory something the user can see and steer. Every save is shown with an Undo.
Replies that used a memory say so. The Notebook becomes a plain "What Coach knows" page where items
can be confirmed, edited or removed. The coach only _says_ what it knows for sure.

Owner, 2026-11-08: "if it does not know something for sure then don't mention it", and "we might
want to do some research on confrontational phrasing". The research report is summarised under
"Phrasing" below.

## Owner decisions (2026-11-08)

1. **The certainty rule.** The coach may mention a memory only when it is known for sure:
   - the user saw it saved and didn't undo it, or
   - the user confirmed or edited it on the "What Coach knows" page.

   Anything else may shape advice silently but is never said out loud.

2. **Curiosity, not accountability.** Recall is phrased as curiosity, not accountability. This
   covers the opening brief's commitment line (shipped in #1807), the commitment chip, and the
   coach's own instructions.
3. **The save moment.** When a memory is saved, the Notebook icon animates and a small popup says
   what was saved. The owner approved mockup B: the icon pulses once, the popup sits under it, shows
   the saved sentence and **Undo**, and closes on its own.
4. **Mood.** Mood is no longer recorded as individual moments. A single mood score is nudged up or
   down by replies. "The user's mood can affect how the coach approaches things."
5. **The page.** The "What Coach knows" page replaces the Notebook screen, as in approved mockup A.
6. **Ageing.** Confirmed items stay until the user removes them.
7. **Scope.** Visible memory only: "There is of course far more that I want to add to the coach
   but I will keep things in scope."

## Goals

- Every new memory is visible at the moment it is saved, with a one-tap Undo.
- The coach brings up only confirmed memories, in the user's own words, as curiosity.
- A reply that used a memory names it (R1 tag), and the tag opens that item.
- One readable page shows what the coach knows, grouped by meaning, with confirm, edit and remove.
- No duplicate entries for a repeated fact. Confirmed goals and preferences never vanish on their
  own.
- Emotional moments are not stored; only a mood score is kept, and it is never spoken.

## Non-goals

- **Global memory controls beyond "Clear everything".** That means pausing memory and a
  "don't remember this chat" mode (R11). This is _my call_, to keep scope.
- Memory for free users. Notebook extraction is Coach-Pro-only today and stays so. The phrasing
  fixes to the opening brief apply to everyone.
- New memory types, new AI features, or changing which model extracts memories.

## Anti-goals (a failure even if it works)

- **Recall that reads as surveillance or blame:** "You agreed…", "You said you would…",
  "you seemed stressed", invented time claims ("last week") or raw third-person notes ("The user…").
- **A save popup that interrupts.** It must not steal focus, cover the composer or need dismissing.
- **Memory that vanishes or duplicates** in plain sight on the new page.
- **A mood score that becomes visible judgement,** for example quoted or shown as a number.

## Phrasing (from the research, binding for copy and prompts)

Principles (sources in the 2026-11-08 research hand-back):

- Autonomy-supportive, not controlling. Ask before checking in.
- A follow-up is for learning whatever the outcome. "Didn't happen" gets kindness.
- Answer the user's message first, then check in.
- Use the user's words in the second person. Never quote raw entries. No time claims unless the
  stored date supports them.
- Statements become offers ("Want to log lunch?").

Concrete copy:

| Where                     | New wording                                                        |
| ------------------------- | ------------------------------------------------------------------ |
| Brief commitment lead     | "You were going to try {label}. How's that going?"                 |
| Brief commitment buttons  | **Going well / Sort of / Not yet / Drop it**                       |
| Messages the buttons send | "It's going well" / "Sort of" / "Not yet" / "I want to drop it"    |
| Missed-meal brief lead    | "Want to log {meal}?", with buttons **Log {meal}** / **Not today** |
| Chip                      | "How's {label} going?"                                             |

- **Missed-meal "Not today":** acknowledges the reminder and sends nothing.
- **Replies to "Not yet":** the coach's own reply should go along the lines of "No problem. Want to
  adjust it, or leave it for now?". This is set by the prompt, not a template.
- **"Drop it":** besides sending its message, marks that commitment archived.

The coach's instructions (Pro system prompt) are rewritten to:

- Reference a notebook entry only if it is **confirmed**, and only when it changes the advice.
- Say it in the second person, in the user's words, with no date unless one is stored.
- Never mention mood, coaching strategy, conversation summaries or inferred insights; these may
  only shape tone silently.
- Never recite or list entries, and ask rather than assert when unsure.
- Follow-ups: answer first, then at most one brief check-in, framed as curiosity. Skip it when the
  message is urgent, emotional or a safety topic, or when mood is low.

## Data

`coach_notebook` gains:

- `confirmedAt` (nullable timestamp). Set when:
  - the save popup closes without Undo (the user saw it), or
  - the user taps **Yes** or edits the item on the page.

  _Builder note:_ the popup's auto-close confirms only if the popup was actually shown. A save the
  client never displayed stays unconfirmed.

- `label` (nullable short text). A short second-person label for commitments ("pumpkin seeds on
  your salad"), produced by the extractor. Used by the brief, the chip and the page.

Mood:

- A per-user `moodScore` (−2…+2, decimal) plus `moodUpdatedAt`, stored on the user profile (_my
  call_).
- The extractor returns a `moodDelta` (−1, −0.5, 0, +0.5, +1) instead of `emotional_context`
  entries.
- The score decays toward 0, with a half-life of about 3 days (_my call_), so one bad day fades.
- The prompt receives a coarse band only (low / neutral / good), never a number.
- Existing `emotional_context` rows are left in place but never shown or sent to the prompt
  (unused ≠ removable).

Ageing (R4):

- **Repeats refresh.** When the extractor produces an entry that matches an active entry of the
  same type for that user, the existing row's `updatedAt` is refreshed and it keeps its
  `confirmedAt`. No new row is created. Matching uses the same normalised-text and containment
  rule as `sameTip` in `shared/lib/coach-stats.ts` (_my call_; the builder may improve it).
- **Archival:** `archiveOldEntries` skips any row with `confirmedAt` set. Unconfirmed rows keep the
  30-day archive.
- **Commitments:** retire when "Drop it" is tapped, or under the existing follow-up rules.

## Behaviour

### The save moment (R2)

- **Delivery.** Extraction runs fire-and-forget _after_ the reply stream ends, so the client learns
  about saves out of band. The client asks for the conversation's new unseen saves when the reply
  finishes and shortly after: `GET /api/coach/notebook/unseen?conversationId=`. That route returns
  entries created for this user from that conversation, not yet shown.
  - **Retry timing** is the builder's call within this rule: a couple of short retries, no
    long-lived polling.
  - **Marking shown:** the client calls `POST …/seen` with ids when it displays them.
- **The pulse.** The Notebook icon in the Coach thread bar pulses once, with reduced-motion
  respected (a colour change only). A popup under it shows the saved sentence or sentences, one
  popup per batch, with **Undo**.
- **Closing.**
  - Auto-close after about 6 s marks the items confirmed.
  - **Undo** deletes the items.
  - The popup never takes focus, and VoiceOver announces "Saved to your notebook: …" politely.
- **What never gets a popup:** coaching strategy and conversation summary saves are silent and
  never confirmed. Mood changes are never shown.

### The reply tag (R1)

- When a Coach Pro reply drew on confirmed entries, a quiet line appears under it: "From your
  notebook: avoiding dairy · quick breakfasts". Tapping a name opens that item on the page.
- **Which entries were used:** the coach reports the ids it used through a structured field
  (a tool argument or block). Only ids from the confirmed set it was given are accepted. Unknown
  ids are dropped. Mechanism: the builder's call.
- The tag is stored with the message metadata, so it survives reload.

### The "What Coach knows" page (R3)

This replaces `NotebookScreen` at the same route and entry points.

- **Header line:** "Coach uses these to tailor advice. Remove anything that's wrong."
- **Groups:**
  - Goals
  - Preferences
  - **Trying** (commitments)
  - "How Coach talks to you" (one soft line rephrasing the coaching strategy, or hidden if none)
- **Hidden:** insights and motivation (interpretations), conversation summaries, `emotional_context`
  and mood. _Insight and motivation are hidden: my call, per the research._
- **Items:** each item is its plain second-person sentence, using the `toSecondPerson` /
  `notebook-text` helpers. A ⋯ menu offers Edit and Remove.
- **Unconfirmed items** show "Is this right?" with **Yes / Edit / Remove**.
- **"Clear everything Coach knows"** sits at the bottom, behind a confirmation.
- **Editing in place** saves the new text and confirms the item.

## Removed or changed

- The existing Notebook list UI (filter chips, folded Coach's notes) is replaced by the page above.
  The Notebook entry editor (`NotebookEntryScreen`) is kept for Edit.
- The brief's commitment copy and buttons change as above (`shared/lib/opening-brief.ts`, plus its
  tests).
- `buildCoachSuggestions`' chip changes to use `label` (falling back to no chip when there is no
  label).

## States

| State                             | What shows                                                                                           |
| --------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Save while the user left the chat | The popup shows next time the Coach chat is open for that conversation (unseen saves)                |
| Undo fails                        | Error toast; the item stays                                                                          |
| Page empty                        | "Coach hasn't saved anything yet. Things you tell it about your goals and preferences show up here." |
| Reduced motion                    | No pulse; the icon changes colour                                                                    |
| VoiceOver                         | The popup announces politely; the tag reads as a link list                                           |
| Dark mode                         | Theme tokens only (owner rule: restyle within theme.ts)                                              |

## Testing

Strict TDD:

- the template copy
- the confirm and archive rules (DB)
- repeat-refresh matching
- mood decay and banding
- the unseen-saves endpoints, including ownership
- tag id filtering
- page grouping and hiding
- popup confirm-on-close and Undo

Then a simulator check of the save → popup → page loop, light and dark.

## Rollout

- Server deploys on merge, and a schema change needs `db:push` and a prod migration check (owner
  rule: get the `to_regclass` output before merging).
- The client needs an OTA, and none is published unasked.
- **Existing entries:** active goals and preferences start confirmed, and the rest start
  unconfirmed (owner decision; see the rulings).
- **Old clients** never confirm new saves, so on them new memories stay unspoken until confirmed on
  an updated client.

## Builder-check rulings (2026-11-08, my calls unless marked)

1. **Every surface follows the certainty rule, not just the prompt.**
   - **Brief pointer:** drops the notebook insight tip. Insights are never spoken.
   - **Commitment check-ins** in the brief, the chip, the prompt's due-commitment block and the
     reminder push name a commitment only when it is confirmed and has a `label`.
   - **Otherwise:**
     - The push says "Coach has a quick check-in for you."
     - The brief has no commitment lead.
     - The prompt gets no due-commitment block for that entry.
   - **Existing entries at rollout (owner, 2026-11-08):** existing active goals and preferences
     start confirmed (set `confirmedAt` in the migration, since they are things the user stated).
     Existing commitments, insights and everything else start unconfirmed.
2. **Insight and motivation** are saved silently. They get no popup, are never confirmed, never
   tagged and never spoken, and may shape advice silently. Only goals, preferences and commitments
   get the popup and can be confirmed. Strategy and summaries stay silent, as before.
3. **Undo and Remove are a soft reject:** `status = 'rejected'`, a new status value. The
   repeat-matcher treats a rejected row as a match and skips it, so a removed fact never comes back
   from extraction. Rejected rows are never shown or used.
4. **"Clear everything Coach knows"** hard-deletes every notebook row for the user. That includes
   hidden types and the legacy `emotional_context` rows. It also resets the mood score. It's
   behind a confirmation. It's a privacy promise, so "everything" means everything.
5. **No `label`:** see 1. The extractor produces labels for new commitments. Old commitments get no
   label backfill (my call; they surface by name only after the user edits or confirms them on
   the page, and editing sets `label` from the edited text).
6. **Saves from the Ask Coach sheet** run extraction as today. The unseen-saves route is per user,
   not per conversation, so those saves pop up the next time the Coach tab is open. The R1 tag
   renders only in `CoachChat` (Coach tab), not the sheet.
7. **Manual Add stays** on the page. Manual entries start confirmed. Completed and archived
   commitments aren't shown under "Trying". There's no Archived view (_my call_).
8. **"Not today"** acknowledges only that reminder type. This needs a new
   `acknowledgeReminderType(userId, type)` and a route. The existing acknowledge-all is unchanged.

Code notes from the check:

- `sameTip` and `insightKey` must be exported (or moved) from `shared/lib/coach-stats.ts` to reuse.
- The prompt rewrite removes two contradicting lines:
  - "Last week you mentioned…" (nutrition-coach.ts:326)
  - "Open your reply by checking in… before answering" (nutrition-coach.ts:460)
- **Recency labels go.** Notebook lines lose their recency labels ("recent/this week…" from
  `updatedAt` in notebook-budget). Ordering stays recency-based, but no time words reach the
  prompt, because repeat-refresh makes `updatedAt` an unreliable date.
- **R1 needs ids in the prompt.** Notebook lines get ids (confirmed set only) so the R1 tag can
  cite them.
- **Not every turn saves.** Turns that end in `offer_recipe` return before extraction, so they
  save nothing (harmless).

## Left to the builder

- Matching rules for repeat-refresh beyond the `sameTip` baseline.
- The unseen-saves retry timing.
- How the coach reports used ids (R1).
- Popup layout details within mockup B.
- The extractor prompt changes for `label` and `moodDelta`.
