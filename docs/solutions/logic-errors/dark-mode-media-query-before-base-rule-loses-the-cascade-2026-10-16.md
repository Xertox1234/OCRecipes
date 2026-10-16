---
title: "A dark-mode @media block placed BEFORE the base rule it overrides loses the cascade — @media adds no specificity, so the later light rule wins"
track: bug
category: logic-errors
tags: [css, dark-mode, server-rendered-html, accessibility]
module: server
applies_to: ["server/lib/*-page.ts", "server/lib/verify-email-page.ts"]
symptoms: ["Server-rendered page is unreadable in dark mode: light text on a white card", "The dark body background applies but the card stays white", "Dark-mode CSS looks correct when read in isolation"]
created: 2026-10-16
severity: medium
---

# A dark-mode @media block placed BEFORE the base rule it overrides loses the cascade

## Problem

The browser page an email verify link opens (`server/lib/verify-email-page.ts`) was unreadable on a phone in dark mode. The body went black and the text went light, but the card stayed white, so the text sat light-on-white. Fixed in #1460.

## Root Cause

The inline `<style>` had the dark block first and the base rule second:

```css
@media (prefers-color-scheme: dark){ body{…} .card{ background:#1c1c1e; } }
.card{ background:#fff; … }
```

A `@media` wrapper adds **no specificity**. Both `.card` selectors are (0,1,0), so source order decides and the later `background:#fff` wins. `body` looked fine only because no later `body` rule set `background`. The text colour is inherited from `body`, so it turned light while the card behind it stayed white.

## Fix

Put the dark `@media` block **last** in the stylesheet, after every rule it overrides. Leave a comment saying why, so nobody moves it back up next to the `body` rule:

```css
/* Last: same specificity as the rules above, so only a later rule overrides them. */
@media (prefers-color-scheme: dark){ body{ background:#000; color:#f5f5f7; } .card{ background:#1c1c1e; } }
```

Pin the order in a test. The rendered HTML is a string, so assert that the `prefers-color-scheme: dark` index is greater than the index of each base rule it overrides (`.card {`, `body {`), for every render function that shares the stylesheet (`server/lib/__tests__/verify-email-page.test.ts`).

## Prevention

- Any page with inline CSS and a dark `@media` block keeps that block at the end of the stylesheet.
- "Every property the dark block sets has a matching base rule earlier in the file" is the invariant to check in review. A dark override for a property no base rule sets will work wherever you put it, which is how this one hid: `body` worked, so the block looked correct.
- Check on a real dark-mode device or the simulator (`xcrun simctl ui <udid> appearance dark`). Reading the CSS alone won't catch it.
