---
title: "Front-end scanner residuals: unused ServingStepperChip export, duplicated prod blocks, and 26 client files over 600 lines"
status: in-progress
priority: low
created: 2026-09-23
updated: 2026-09-23
assignee:
labels: [deferred, audit, maintainability]
github_issue:
---

# Front-end scanner residuals: unused ServingStepperChip export, duplicated prod blocks, and 26 client files over 600 lines

## Summary

Deterministic-scanner findings for `client/` that aren't covered by a more specific todo. It's a backlog of structural cleanups, to be picked off opportunistically.

## Background

Found by the 2026-09-23 front-end audit (read-only, 6 lenses + Context7 research). Finding ID(s): **L17, SCAN-KNIP-13, SCAN-JSCPD, SCAN-FLEN** in `docs/audits/2026-09-23-frontend.md` (local-only, gitignored). Each claim below was re-read against the code at HEAD `3df8b4b3`; line numbers may drift.

- knip: unused export `ServingStepperChip` from `client/components/recipe-detail/index.ts`.
- jscpd production duplicates: CameraView.tsx ↔ CameraView.ios.tsx (36 + 77 lines), ChangeEmailModal ↔ DeleteAccountModal (54), AddItemMenuSheet ↔ ImportRecipeSheet (43), NutritionPanel ↔ NutritionSummaryCard (36), plus smaller ones (Button ↔ CoverActionButton, CookbookPickerModal ↔ GroceryListPickerModal, InlineMicButton ↔ VoiceLogButton, MicronutrientSection ↔ CollapsibleSection, QuickAddSheet ↔ SimpleEntrySheet). Test-file duplicates are lower value.
- File length: at least 26 client files exceed 600 lines. The scanner printed 20 of 44 repo-wide; its cap hid MealPlanHomeScreen 1700, RecipeBrowserScreen 1267, GroceryListScreen 727, PantryScreen 650 and CookbookCreateScreen 637. The biggest ones have their own structural todos (useNutritionLookup, MealPlanHome sheets, RecipeBrowser filters).
- madge nav cycles: FALSE POSITIVE (all `import type`), so no action.
- Re-run: `npx tsx scripts/audit-scanners.ts code-quality`.

## Acceptance Criteria

- [x] The unused export is removed (after LSP findReferences confirms no consumer)
- [x] At least the CameraView and ChangeEmail/DeleteAccount duplicates are resolved or explicitly accepted with a rationale
- [x] Consider raising the scanner's per-tool cap or printing a 'hidden by cap' list (scripts/audit-scanners.ts) so large files aren't hidden
- [x] Scanner re-run shows the resolved rows gone

## Implementation Notes

Opportunistic. Do not bundle with feature work. Each duplicate pair can be its own small PR.

## Scope Contract

- **Mechanisms to use:** existing project patterns cited above — nothing new beyond what the acceptance criteria name.
- **Files in scope:**
  - `client/components/recipe-detail/index.ts`
  - the listed duplicate pairs
  - `scripts/audit-scanners.ts (cap reporting only)`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- CameraView platform split may be intentional — confirm before merging the two files.

## Updates

### 2026-09-23

- Initial creation from the 2026-09-23 front-end audit (L17, SCAN-KNIP-13, SCAN-JSCPD, SCAN-FLEN).

### 2026-09-23 (execution)

- **AC1 — `ServingStepperChip` barrel export removed.** `client/components/recipe-detail/index.ts` line 10 (`export { ServingStepperChip } from "./ServingStepperChip";`) deleted. LSP (`findReferences`/`hover`/`workspaceSymbol`) was non-functional this session (empty results even on the agent doc's own canonical warm-up symbol, `withOpacity` at `client/constants/theme.ts:254`), so per the documented fallback I confirmed with an exhaustive `grep -rn "ServingStepperChip"` across the whole repo (excluding `node_modules`): the only other reference is `client/components/recipe-detail/RecipeMetaChips.tsx`, which imports directly from `./ServingStepperChip` (bypassing the barrel) — zero consumers of the barrel's re-export. Verified post-removal: the `SCAN-KNIP-13` (now-renumbered) finding for this export no longer appears in a scanner re-run.

- **AC2 — CameraView.tsx ↔ CameraView.ios.tsx: ACCEPTED, not merged.** The platform split is intentional, not incidental duplication: `docs/LEARNINGS.md:660-661` documents Android using `useBarcodeScannerOutput` (the `react-native-vision-camera-barcode-scanner` pod) and iOS using `useObjectOutput` (VisionCamera core / AVFoundation metadata) as two genuinely different native APIs. `CameraView.ios.tsx:110-112`'s own doc comment states iOS deliberately avoids the barcode-scanner pod because it "crashes swift-frontend 6.2 (Xcode 26 beta) with an ICE." The two files' barcode-type mapping tables (`BARCODE_TYPE_MAP`/`BARCODE_TYPE_REVERSE_MAP` vs. `EXPO_TO_OBJECT_TYPE`/`OBJECT_TYPE_TO_EXPO`) and scan-result handlers are correspondingly non-identical. What jscpd flags (36 + 77 lines: `mapQualityPrioritization`, the imperative `takePicture` handle, the render tree, `CameraUnavailable` + its styles) is shared shell code that exists only because Metro's `.ios.tsx` platform resolution requires each platform file to be a complete, self-contained module — sharing it would require a new wrapper/abstraction parameterized on the platform-specific output hook, which the todo's Scope Contract excludes ("No new mechanisms, files, or abstractions beyond those listed"). This is also a device-only camera-capture surface the simulator/test harness cannot exercise, so a merge could not be verified by tests. Confirms the todo's own Risk note. No files changed for this pair; the two `SCAN-JSCPD` rows for it remain open by design.

- **AC2 — ChangeEmailModal ↔ DeleteAccountModal: ACCEPTED, not merged.** The ~54-line overlap (`ChangeEmailModal.tsx:311-364` ↔ `DeleteAccountModal.tsx:272-325`) is the shared modal-card shell (`Modal` + `KeyboardAvoidingView` + backdrop `Pressable` + centered card + `ScrollView` + icon circle + title/message + base `StyleSheet`). The two components diverge on their confirm control (shared `Button` vs. a custom destructive `Pressable`), field count (3 fields + email-match validation vs. 1 password field), server-error-message mapping, and the subscription-warning block. Extracting the shell would require a new shared component — a new file and a new abstraction, both excluded by the Scope Contract ("No new mechanisms, files, or abstractions beyond those listed") — on two password-reauthentication surfaces (`AUTH IS HIGH-RISK` per project memory) that currently have **zero** component test coverage (`client/components/__tests__/` has no `ChangeEmailModal.test.*` or `DeleteAccountModal.test.*`), so a structural refactor here could not be verified by tests either. Accepted as duplication; revisit if a third password-confirm modal appears and the shared shape can be extracted with test coverage in the same change. No files changed for this pair; its `SCAN-JSCPD-6` row remains open by design.

- **AC3 — scanner cap now reports what it hides.** `scripts/audit-scanners.ts`: (1) `sweepFileLengths` now sorts file-length findings by line count descending before the per-tool cap is applied — previously all file-length findings share "Low" severity so the cap's severity-sort was a no-op and the kept 20 were whatever order `git ls-files` produced (roughly alphabetical), which is exactly how the background's cited large files (MealPlanHomeScreen, RecipeBrowserScreen, etc.) were getting hidden; now the cap always keeps the biggest offenders. (2) `capFindings` now also returns `hidden` (the dropped `ScannerFinding[]`, not just a count). (3) The CLI summary loop in `runCli` prints an additional `hidden by cap: <path1>, <path2>, ... +N more` line under any tool whose findings were capped (preview of 5, matching the existing severity-cap threshold's spirit). Two new unit tests added to `scripts/__tests__/audit-scanners.test.ts` (both run RED before the implementation, GREEN after): `sweepFileLengths` orders by line count descending; `capFindings` returns `hidden` findings disjoint from `kept` with `hidden.length === dropped`. `MAX_FINDINGS_PER_TOOL` (20) was deliberately left unchanged per the todo's own AC wording ("raise ... OR print a list") — the existing cap test (`dropped` toBe `25 - MAX_FINDINGS_PER_TOOL`) still holds.

- **AC4 — scanner re-run, `npx tsx scripts/audit-scanners.ts code-quality`:**
  - `knip`: 20 finding(s) (showing 20 of 68). `ServingStepperChip` no longer appears anywhere in the output (`grep -c ServingStepperChip` on the run's output = 0).
  - `jscpd`: 20 finding(s) (showing 20 of 124). `SCAN-JSCPD-1`/`-2` (CameraView) and `SCAN-JSCPD-6` (ChangeEmail/DeleteAccount) still present — expected, accepted not resolved.
  - `file-length`: 20 finding(s) (showing 20 of 45), now biggest-first: `shared/schema.ts` (1938), `MealPlanHomeScreen.tsx` (1725), `RecipeBrowserScreen.tsx` (1292), `ScanScreen.tsx` (1256), `useNutritionLookup.ts` (1028), ... — the previously-hidden large files the Background section named are now visible in the top 20, and the tail (`GroceryListScreen`, `PantryScreen`, `CookbookCreateScreen`, etc.) shows explicitly in the new `hidden by cap: ...` line rather than silently disappearing.
  - `madge`: unchanged (20 of 81) — out of scope, false-positive per the todo's own Background note.
