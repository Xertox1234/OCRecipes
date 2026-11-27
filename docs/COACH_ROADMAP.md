# Coach Roadmap

**Goal:** a Coach that can do what the whole app does from inside the chat, up to
realtime voice and camera ("rung 10"). The screens stay; the chat becomes a
universal remote that can reach every feature.

Agreed with the owner on 2026-11-23. Background study (capability ladder, other
chat apps, coverage table, mockups): https://claude.ai/artifact/FcCeoMj5m1W71JQ34sudZc

## How to use this doc

- Each item is sized to one session and one PR. Size: **S** under a session,
  **M** one session, **L** several.
- Items do not have to go in order. Work the highest-value item whose "needs"
  are ticked. Re-rank after every few items based on what actually gets used.
- An item gets its spec or todo only when it is started, not before.
- Tick the box, and add the PR number, in the same PR that ships the item.
- Every Coach feature is two things: a **tool** (`server/services/coach-tools/`)
  so the Coach can read or change the data, and a **block**
  (`shared/schemas/coach-blocks.ts` + `client/components/coach/blocks/`) so it
  can show it and let the user touch it.

## Where the Coach stood on 2026-11-23

Rungs 1-6 done: streaming, context and memory, read tools, 13 block types,
confirmed writes (write cards for food, plan, grocery, pantry). Rung 7 partly
done (mic button; photos and scans only by navigating to another screen).

## Start here

1. **S1** camera in the message box
2. **T1** form and picker block
3. **V0** realtime voice spike
4. **A1** multi-step jobs

Then re-rank.

## See: the Coach takes photos (rung 7)

- [x] **S1. Camera button in the message box.** Send a plate photo into the
      chat; the reply is an editable portion card. Reuses the photo analysis
      service. Value: high. Size: M. PR #1984. Shipped as the Coach's food log card
      (one row per food, sized to the portion seen; counts are whole portions).
      Left for later: half portions, and showing the photo in the chat.
- [x] **S2. Label and barcode in chat.** Scan without leaving the conversation.
      Value: high. Size: M. Needs S1. PR #2018. The photo button now takes a
      nutrition label or a barcode as well as a meal: the photo is classified
      first, a label is read into a one-serving food card, and a barcode
      number read from the photo is looked up into the same card (with the
      allergy check a scan gets). A follow-up (PR #2021) added a live barcode
      scanner opened from the chat's camera button: the phone decodes the
      number, so no model reads it and no photo credit is spent. Left for
      later: the label's micronutrients (the card carries calories and the
      three macros).
- [x] **S3. Receipt and menu photos.** A receipt becomes a pantry write card; a
      menu becomes a "what should I order" card. Value: medium. Size: M.
      Needs S1.
      Part 1, PR #2048: a grocery receipt photo sent to the chat becomes the
      pantry card, one row per food with its amount and shelf life (a food
      already in the pantry in the same unit is topped up). It follows the
      pantry receipt scan's plan rules and counts toward the same monthly
      scans, and spends a receipt credit as well as the photo credit.
      Part 2, PR #2049: a restaurant menu photo becomes a list of the three
      best-rated dishes, each with rough calories, protein and the reason.
      Dishes rated "avoid" and dishes whose menu text names one of the user's
      allergens are left out (the Coach says how many, naming none); if the
      allergy list cannot be read or checked, no dish is picked, and a user
      with allergies is always told to check with the restaurant. It follows
      the Menu Scanner's plan rules, spends a menu credit and saves the scan
      to the menu history; a photo with no dishes on it is read as a meal.
      The list is the existing suggestion block, so the app needed no new
      card. Left for later: tapping a dish to log it, and follow-up questions
      about the list (later turns see only message text, so the Coach does
      not see the dishes it listed).

## Touch: blocks the user can operate (rung 8)

- [x] **T1. Generic form and picker block.** One block that takes a field
      schema; covers goals, allergies and clarifying questions. Value: high.
      Size: M.
      Part 1, PR #1995: the form block for clarifying questions (pick one,
      pick any, a number); the answers come back as the user's next message.
      Part 2, PR #1998: the goals card (calories, protein, carbs, fat; saved on tap,
      with Undo). Part 3, PR #2002: the allergy card (the Coach's "add allergy" button
      becomes a card with a severity picker, for users who have agreed to
      store health data).
- [x] **T2. Undo for small writes.** Apply a low-risk log at once and offer
      undo; keep confirm cards for large changes. Value: medium. Size: M.
      Done (PR #2058): a food log the user types in the chat, up to three
      foods and 1000 kcal with macros that match the calories, is logged
      during the Coach's tool call and arrives saved, with Undo (open for 5
      minutes). Bigger logs, photo, label and barcode reads, and every other
      card kind still wait on Save. Left for later: the same for small
      grocery adds, and a setting to turn it off.
- [x] **T3. Living blocks.** A block stores a query instead of a snapshot and
      re-reads it, so an old card shows current numbers. Value: medium. Size: M.
      Two cards. PR #2078: the day card (`day_progress`, today or yesterday:
      calories, protein, carbs and fat against the goals). This PR: the week
      card (`week_progress`, the last seven days' calories against the
      calorie goal, with the average of the days logged before today). The
      model asks for one by name and never writes its numbers; the server
      stores the date with the numbers as they were, and the app re-reads
      them (the day card: the day summary and goals Home reads; the week
      card: `GET /api/daily-summary/week`, one request) under the day
      summary's cache key, so a log anywhere updates the card. Until
      the reads arrive (or when one fails) the card shows the reply's numbers
      and says so. Left for later: other living cards (a week of protein,
      the weight trend).
- [x] **T4. More chart kinds and a compare block.** Ring, sparkline, heatmap,
      and two scanned labels side by side. Value: medium. Size: S.
      Part 1 (the chart kinds) done: inline_chart takes "ring" (one to four
      values, each against its own target), "sparkline" (one number over
      time, with an optional goal line) and "heatmap" (one square per day,
      up to 35, a met day marked). They are offered, and kept, only for an
      app that sends the "more_charts" card kind, since an older build drops
      a chart it cannot read. Part 2 (the compare block): a read-only
      get_recent_scans tool lists the latest scans, and the Coach asks for
      `{ type: "label_compare", scanIds: [a, b] }`; the server reads both
      scans for the user and builds the card from the stored numbers, each
      per its own serving with both serving sizes shown (nothing is scaled).
      Offered only for an app that sends the "label_compare" card kind.
      Left for later: a tool that returns several days of intake at once
      (todo P2-2026-11-27), so trend charts have real data.

## Act: the Coach does more on its own (rung 9)

- [x] **A1. Multi-step jobs.** "Plan my week and build the grocery list" as one
      chained run with one combined approval. Value: high. Size: M.
      Done in PR #2005: the meal plan card takes the shopping as well (a
      ticked section naming what the kept meals need, with a list picker), so
      one Save plans the meals and adds the shopping and one Undo reverts
      both. A grocery call in the same turn is turned away in favour of that
      card. Only this one job is chained; other pairs still take two turns.
- [x] **A2. Proactive Coach.** The Coach starts a conversation by push
      notification. One trigger first (expiring pantry items), with a strict
      daily cap. Value: high. Size: L. PR #2045. At 16:00 the user's time,
      a user with pantry tracking whose food expires within a day gets one
      push ("Use it before it goes"); tapping it opens a new conversation
      that starts with the Coach's message. The push only counts the items;
      their names are in the conversation, not on the lock screen. The wording is fixed (no model
      call). At most one a day, none on a day the Coach already pushed a
      commitment follow-up, and each item is named once. A switch in Coach
      reminders turns it off. Left for later: more triggers, and the
      notification spec's quiet hours and one-nudge-a-day choice across all
      categories (this trigger enforces its own cap).
- [ ] **A3. Fill the coverage gaps.** Family profiles, reminders, and the
      weekly report as a block. Value: medium. Size: M each. Needs T1.

## Speak: the road to rung 10

- [ ] **V0. Realtime voice spike.** Research only, no feature. Answer: which
      provider carries realtime audio (models go through OpenRouter today, which
      may not), which React Native native module it needs, and what a minute
      costs. Value: de-risks the goal. Size: S.
- [x] **V1. Cook mode.** Step cards with timers, read aloud with `expo-speech`.
      Value: high. Size: M. PR #2030. A full-screen cook view opened from the
      Coach's recipe card ("Cook") and from the recipe page ("Start Cooking"):
      the ingredients, then one step per card, read aloud, with timers read
      from the step's own wording. Left for later: an alarm while the app is
      in the background, and the Coach offering cook mode itself (its prompt
      does not describe the link yet).
- [x] **V2. Hands-free turn-taking.** Listen, transcribe, reply, speak, with no
      tapping. Value: high. Size: M. Needs V1. PR #2037. A headset button in
      the chat starts a loop: the Coach listens, sends what it heard, reads
      the reply aloud, then listens again. It stops on a tap, on typing, when
      nothing is heard, on an error, or when the app leaves the screen. The
      microphone is closed while the Coach speaks (the phone has no echo
      cancelling here), so the user cannot talk over a reply; that is V3.
      Off when a screen reader is on. Left for later: a wake word, and
      answering a card (a form, a food log) by voice.
- [ ] **V3. Realtime voice.** Interruptible spoken conversation. Value: high.
      Size: L. Needs V0.
- [ ] **V4. Live camera while talking.** Point at a shelf and ask about it.
      Value: high. Size: L. Needs V3 and S1.
- [x] **V5. On-device OCR pre-read.** Read label text on the phone before
      upload, for speed, cost and privacy. Value: medium. Size: M. Needs S2.
      PR #2055. Before a chat photo uploads, the phone's own text reader
      (ML Kit, as on the Scan screen) reads it. When the text is plainly a
      nutrition panel (its "Nutrition Facts" heading, and calories, protein,
      carbs, fat and a serving in grams or millilitres all read off the
      print), only those numbers are sent: the photo stays on the phone, no
      model is called and no photo credit is spent. The reply is the same
      one-serving food card a label photo gets, named "Packaged food" (the
      panel shows no name), with the same allergy reminder. Anything less
      certain uploads the photo as before. Left for later: the label's
      micronutrients, and the other photo kinds (a receipt or a menu read on
      the phone).

## Deliberately out of chat

Account, password, two-step sign-in and payments stay on their screens, out of
the model's reach.

## Standing cautions

- Every added tool lengthens the prompt and makes tool choice less reliable;
  keep routing tools by intent (`coach-intent-classifier.ts`).
- Images cost far more tokens than text; realtime voice costs the most.
- Proactive messages need rate limits or they become nagging.
