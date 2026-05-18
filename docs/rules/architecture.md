# Architecture Rules

- Storage modules > 500 lines must be split by sub-domain — use a thin re-export facade to preserve existing import paths
- Routes that make 3+ parallel storage calls AND compute derived values inline must extract a service function (pattern: `server/services/coach-context-builder.ts`)
- Never import from a service inside a storage module — dependency direction is always service → storage
- MiniSearch index mutations must be outside `db.transaction` — in-transaction index mutations desync state on rollback
- Route exports must be named `register` for consistent grep — not `registerXRoutes`
- `server/storage/chat.ts` and `server/storage/community.ts` are approaching the 500-line threshold — avoid adding new functions; prefer splitting
- PR review automation must diff `merge-base -> head`, not `base.sha -> head`, so moved base branches do not cause unrelated upstream changes to be reviewed or blocked.
