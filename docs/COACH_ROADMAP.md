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
- [ ] **S2. Label and barcode in chat.** Scan without leaving the conversation.
      Value: high. Size: M. Needs S1.
- [ ] **S3. Receipt and menu photos.** A receipt becomes a pantry write card; a
      menu becomes a "what should I order" card. Value: medium. Size: M.
      Needs S1.

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
- [ ] **T2. Undo for small writes.** Apply a low-risk log at once and offer
      undo; keep confirm cards for large changes. Value: medium. Size: M.
- [ ] **T3. Living blocks.** A block stores a query instead of a snapshot and
      re-reads it, so an old card shows current numbers. Value: medium. Size: M.
- [ ] **T4. More chart kinds and a compare block.** Ring, sparkline, heatmap,
      and two scanned labels side by side. Value: medium. Size: S.

## Act: the Coach does more on its own (rung 9)

- [x] **A1. Multi-step jobs.** "Plan my week and build the grocery list" as one
      chained run with one combined approval. Value: high. Size: M.
      Done in PR #PRNUM: the meal plan card takes the shopping as well (a
      ticked section naming what the kept meals need, with a list picker), so
      one Save plans the meals and adds the shopping and one Undo reverts
      both. A grocery call in the same turn is turned away in favour of that
      card. Only this one job is chained; other pairs still take two turns.
- [ ] **A2. Proactive Coach.** The Coach starts a conversation by push
      notification. One trigger first (expiring pantry items), with a strict
      daily cap. Value: high. Size: L.
- [ ] **A3. Fill the coverage gaps.** Family profiles, reminders, and the
      weekly report as a block. Value: medium. Size: M each. Needs T1.

## Speak: the road to rung 10

- [ ] **V0. Realtime voice spike.** Research only, no feature. Answer: which
      provider carries realtime audio (models go through OpenRouter today, which
      may not), which React Native native module it needs, and what a minute
      costs. Value: de-risks the goal. Size: S.
- [ ] **V1. Cook mode.** Step cards with timers, read aloud with `expo-speech`.
      Value: high. Size: M.
- [ ] **V2. Hands-free turn-taking.** Listen, transcribe, reply, speak, with no
      tapping. Value: high. Size: M. Needs V1.
- [ ] **V3. Realtime voice.** Interruptible spoken conversation. Value: high.
      Size: L. Needs V0.
- [ ] **V4. Live camera while talking.** Point at a shelf and ask about it.
      Value: high. Size: L. Needs V3 and S1.
- [ ] **V5. On-device OCR pre-read.** Read label text on the phone before
      upload, for speed, cost and privacy. Value: medium. Size: M. Needs S2.

## Deliberately out of chat

Account, password, two-step sign-in and payments stay on their screens, out of
the model's reach.

## Standing cautions

- Every added tool lengthens the prompt and makes tool choice less reliable;
  keep routing tools by intent (`coach-intent-classifier.ts`).
- Images cost far more tokens than text; realtime voice costs the most.
- Proactive messages need rate limits or they become nagging.
