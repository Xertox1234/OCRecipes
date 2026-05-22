# Architecture Rules

- Storage modules > 500 lines must be split by sub-domain — use a thin re-export facade to preserve existing import paths. When splitting, each sub-module must import shared symbols (e.g. `FEATURED_COLUMNS`) directly from the sibling sub-module that defines them, NOT from the `./<barrel>` re-export — sub-module → barrel imports create latent circular-import risk. Pattern precedent: `server/storage/meal-plans.ts`, `community.ts`, `meal-plan-recipes.ts`.
- A storage split is "pure mechanical extraction": the diff-scoped kimi pre-commit gate re-reviews moved-into-new-file code as if newly added and may emit CRITICALs on long-standing logic. Verify the flagged code is byte-identical to `main` (`git show main:<path>`); if so the finding is out of scope for the refactor — never "fix" it inline (that changes behavior + churns the public surface). Surface it for separate triage and bypass with `SKIP_KIMI_REVIEW=1`.
- Routes that make 3+ parallel storage calls AND compute derived values inline must extract a service function (pattern: `server/services/coach-context-builder.ts`)
- Never import from a service inside a storage module — dependency direction is always service → storage
- MiniSearch index mutations must be outside `db.transaction` — in-transaction index mutations desync state on rollback
- Route exports must be named `register` for consistent grep — not `registerXRoutes`
- `server/storage/chat.ts` (~576) is over the 500-line threshold — avoid adding new functions; prefer splitting (`community.ts` and `meal-plan-recipes.ts` were split behind barrels on 2026-05-21)
- PR review automation must diff `merge-base -> head`, not `base.sha -> head`, so moved base branches do not cause unrelated upstream changes to be reviewed or blocked.
