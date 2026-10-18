---
title: "Toasts render behind React Native `Modal` sheets — the recipe-ready toast is hidden while the generation sheet is reopened"
status: backlog
priority: low
created: 2026-10-18
updated: 2026-10-18
assignee:
labels: [deferred, mobile, ui]
github_issue:
---

# Toasts render behind RN `Modal` sheets

## Summary

The toast host lives in react-native-screens `FullWindowOverlay` (#1257), which sits above native-stack modals (the photo-analysis screen) but **below** a React Native `Modal` (`presentationStyle="pageSheet"`), which presents its own view controller. Measured 2026-10-18 on the iPhone 17 Pro simulator during the recipe-generate background-completion sim check: with `RecipeGenerationModal` reopened while a generation was in flight, the "Recipe ready — tap to open" toast landed behind the sheet — only a blue sliver showed in the status-bar band (scratchpad frame `run3/t02.png`). With the sheet closed the same toast rendered correctly over the photo modal (`run2/t12.png`).

## Background

Found while verifying PR 1 of the recipe-generate → Argon project. Deferred because the durable signal (Profile-tab dot, and the sheet's Generate button flipping back from "A recipe is on its way") still reaches the user, and because the fix is a toast-host layering question that applies to every RN `Modal` in the app, not to this feature.

## Acceptance Criteria

- [ ] Decide the layering fix: (a) render the toast host inside each RN `Modal` as well (a second `Toast` mount reading the same context), (b) convert `RecipeGenerationModal` (and any other RN `Modal` that can be open when a background toast fires) to a native-stack modal screen, or (c) accept and document.
- [ ] Inventory: `grep -rn "from \"react-native\"" client | xargs grep -ln "<Modal"` — list every RN `Modal` that can be on screen while a background event can toast (coach reply, recipe ready, draft ready).
- [ ] Sim check: reopen the generation sheet, freeze the server (`kill -STOP <pid>`), tap Generate, resume, and confirm the toast is visible over the sheet via `xcrun simctl io <UDID> screenshot` (Maestro / `snapshot_ui` cannot see `FullWindowOverlay`).

## Implementation Notes

- Toast host: `client/context/ToastContext.tsx` (`FullWindowOverlay` import), `client/components/Toast.tsx`.
- The reproduction recipe is in `docs/superpowers/specs/2026-10-17-recipe-generate-argon-background-completion-design.md` §5 and memory `reference_sim_overlay_toast_verification`.

## Scope Contract

- **Mechanisms to use:** the existing toast context and host; react-native-screens.
- **Files in scope:** `client/context/ToastContext.tsx`, `client/components/Toast.tsx`, `client/components/RecipeGenerationModal.tsx` only if option (b) is chosen.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None.

## Risks

- A second toast mount inside a `Modal` must not double-announce for screen readers (one live region per visible toast).

## Updates

### 2026-10-18

- Initial creation (found during the PR 1 simulator check).
