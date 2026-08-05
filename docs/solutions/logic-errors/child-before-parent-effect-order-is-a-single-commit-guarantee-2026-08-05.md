---
title: "Child-before-parent effect ordering is a SINGLE-COMMIT guarantee — an await between the two voids it"
track: bug
category: logic-errors
tags: [accessibility, react, useEffect, voiceover, announceForAccessibility, ios, async]
module: client
applies_to: ["client/hooks/**/*.ts", "client/components/**/*.tsx", "client/screens/**/*.tsx"]
symptoms: ["VoiceOver reads the same message twice, seconds apart, on iOS only", "A comment justifies a duplicate announcer by claiming the later call silences the earlier one", "The two announcers are in a parent and a child, but one fires while the other is not mounted", "Android behaves correctly because only one of the two announcers is platform-enabled there", "A notice is spoken before it is on screen — the user hears it and lands on a skeleton"]
severity: medium
created: 2026-08-05
---

# Child-before-parent effect ordering is a SINGLE-COMMIT guarantee — an await between the two voids it

## Problem

Two components announced the same notice. The duplicate was left in place on
purpose, with this reasoning in its docblock:

> React flushes child effects before parent ones — this component is the child,
> the hook belongs to the screen — so on iOS the hook's utterance is the later
> `post(.announcement)` and silences this one.

On iOS a later `announceForAccessibility` does cancel an in-flight one, so the
argument is sound *if both fire in the same commit*. They did not:

```ts
setLabelReadNotice(...)        // commit A — isLoading still true, NoticeStack NOT mounted
const res = await fetch(url)   // ... barcode POST, then a verification round trip
setIsLoading(false)            // commit B — NoticeStack mounts and announces
```

Commit A and commit B are separated by two network round trips. Nothing was
silenced: VoiceOver users heard the warning, then heard it again.

## Symptoms

- Duplicate speech on iOS only, with a noticeable gap rather than a stutter
- A docblock asserting an ordering guarantee between a hook and a component
- The "later" announcer fires while the "earlier" one's component is unmounted
- Extra utterances for content that is not on screen yet — the user hears a
  notice and then lands on a loading skeleton

## Root Cause

"Child effects flush before parent effects" orders effects **within one commit**.
It says nothing about two effects in different commits, and an `await` between
the state updates guarantees they are in different commits.

The premise also silently required that both components be **mounted**. The
child's effect cannot be the "earlier" call in any ordering if the child is not
rendered yet — which is exactly the case while `isLoading` is true.

## Solution

Delete the duplicate rather than platform-gating one of them, and pick the
survivor by *when it can speak*, not by which is easier to gate:

- The hook announced before the notice was on screen — wrong on its own terms.
- The component announces when the notice is mounted and visible, is keyed on
  composed CONTENT with a ref guard, and is ungated by platform, so removing the
  hook's leaves one announcer serving iOS and Android identically.

Verify the removal with a test that spies on `announceForAccessibility` and
asserts it was NOT called, with a negative control proving the notice really was
set. Note `Platform.OS` is `"ios"` in `test/mocks/react-native.ts`, so an
iOS-gated announcer does fire under test — without that, the test would pass
against the unfixed code and guard nothing.

## Prevention

- Two announcers cannot be kept in sync by an argument about effect ordering.
  If you are writing that argument down, delete one of them instead.
- Any reasoning of the form "the later call wins" must name the commit both
  calls are in. If an `await` sits between them, they are not in one commit.
- Announce where the content is, not where it is produced. An announcer in a
  data hook speaks about a screen it cannot see.
- Prefer the ungated announcer as the survivor: one code path for both
  platforms cannot drift the way a matched iOS/Android pair can.

## Related Files

- `client/components/nutrition/NoticeStack.tsx` — the sole announcer; docblock records the corrected premise
- `client/hooks/useNutritionLookup.ts` — where the duplicate was, and why it went
- `client/hooks/__tests__/useNutritionLookup.labelRead.test.tsx` — asserts the hook stays silent
- `test/mocks/react-native.ts` — `Platform.OS === "ios"`, which is what makes that test meaningful

## See Also

- [two announceForAccessibility calls in one commit collide on iOS](two-announceforaccessibility-same-commit-collide-ios-2026-07-21.md) — the complement: same commit, so they DO collide and must be merged into one utterance
- [InlineError + onError double announce](inlineerror-double-announce-onerror-handler-2026-06-03.md) — two owners announcing one event
- [accessibilityLiveRegion + announceForAccessibility double TalkBack](double-talkback-announcements-live-region-2026-05-13.md) — the Android-side pair
