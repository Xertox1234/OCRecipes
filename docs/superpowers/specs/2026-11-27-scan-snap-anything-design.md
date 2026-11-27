# Snap anything: the auto-sorting camera returns (short design)

Status: APPROVED by the owner 2026-11-27 ("write the plan")
Date: 2026-11-27
Builds on: `docs/superpowers/specs/2026-11-26-scan-guided-camera-design.md` (stage 1 merged #2088, motion beats #2092)
Closes: `todos/archive/P3-2026-11-26-smart-scan-auto-classify-unused.md` (owner chose "revive")
Mockup: `docs/superpowers/specs/2026-11-27-scan-snap-anything-mockups/snap-anything.html`

## Intent

The owner wants the "one photo, the app works out what it is" camera back as a real option. Their condition (2026-11-27): **every + menu item must still open its own screen.** The new camera is an addition, never a replacement for an existing button.

## Approaches

- **A. A new + menu item, "Snap anything" (picked by the owner).** It is the first item of the camera group and opens Scan in a new `mode: "smart"`. The other items are unchanged.
- B. A "Not sure? Snap it" link inside the guided camera. Rejected: you would have to open the barcode camera first, which defeats "I don't know which to pick".
- C. Photo Food Log sorts photos again. Rejected: it breaks the owner's condition.

## Design

- **Entry:** + menu, camera group, first item, "Snap anything", subtitle "We'll work out what it is". It calls `navigate("Scan", { mode: "smart" })`.
- **Camera (`mode: "smart"`):** the camera shell from stage 1, with the title pill "Snap anything", one big frame, the hint "A meal, a label, a menu or a receipt — fit it in the frame", the torch and the shutter. No step tabs. No live barcode lock (my call: the photo decides, so nothing snaps on its own).
- **After the shutter:** the feed holds (the `feedHeld` dim) and the frame turns green. A busy card says "Working out what this is…" (the existing `CLASSIFYING` phase, restyled).
- **Result card** (`SMART_CONFIRMED`, restyled like the barcode found card): "Looks like a {type} ✓", one line saying what happens next, and **Not this** / **Continue →**. The buttons arrive a beat after the card (`getFoundCardActionBeats`). Nothing moves on until a tap.
  - Continue keeps today's routing (`resolveSmartConfirmAction`):
    - meal → PhotoAnalysis (log)
    - label → LabelAnalysis
    - menu → MenuScanResult
    - ingredients → Cook & Track
    - grocery or restaurant receipt → ReceiptCapture (you snap there, because receipts can run to several photos)
    - barcode → hands over to the guided barcode flow (below), never straight to NutritionDetail
  - Premium-locked types (menu, Cook & Track, receipts) show the upgrade card, as today.
  - Not this goes back to the camera.
- **Barcode hand-off (owner, 2026-11-27: "do both").** A barcode photo always ends in the full three-step barcode flow (Barcode → Nutrition → Front), the same as Scan Barcode:
  - **Number read:** "Looks like a barcode ✓", with the number in the sub-line. Continue replaces the screen with the barcode flow carrying that number. It enters through the same path as the type-the-number keypad (`MANUAL_BARCODE_ENTERED` from HUNTING, plus the product lookup), so you land on "Barcode found ✓" with the product, then **Next: nutrition →** and the Front step.
  - **Barcode seen, number unreadable:** "Looks like a barcode", with the sub-line "Let's scan it live". Continue replaces the screen with the barcode camera (`Scan` with no params) to scan it live. It no longer falls to "Couldn't tell".
  - `navigation.replace`, not `navigate`, so Back doesn't return to the snap photo.
- **Couldn't tell** (`SMART_ERROR`, or `non_food`): "Couldn't tell what this is", with **Retake** and a "Pick it myself" link. The link opens the existing PhotoIntent chooser **with this photo** (`PhotoIntent { imageUri }`, which it already accepts), so nothing is re-snapped (my call).
- **Accessibility:**
  - Each card announces through `announceTogether`.
  - The result card waits for a tap anyway, so screen reader users need no special path.
  - Reduced motion uses fade only.
- **Scan Menu fix (my proposal, in the same PR):** the + menu's Scan Menu goes to `Scan { intent: "menu" }` (the menu camera) instead of the PhotoIntent picker. Today it breaks the owner's "opens its own screen" condition. The guided camera spec already planned this for stage 2.

## Non-goals

- No example card or tips for this camera (stage 2 adds per-flow example cards).
- No change to the classifier prompt, its cost cap or its server route.
- The photo library button stays a stage 2 item.

## Constraints

- Every phase switch stays exhaustive. The phases already exist; this only makes them reachable.
- The `pickedIntent` path (PhotoIntent → Scan) is unchanged.
- An unknown `mode` must still fall back the way `getScanFlow` does today, and must not open a dead camera.

## Left to the builder

- How `getScanFlow` grows a third flow (`"smart"`), and the `FlowView` for it.
- Copy for the "what happens next" line per type.
- Tests, including the route for each content type, both barcode hand-offs, and the Scan Menu target.
- How the barcode number reaches the new Scan screen (a route param read once on `CAMERA_READY` is the obvious shape; it must not re-fire on focus).
