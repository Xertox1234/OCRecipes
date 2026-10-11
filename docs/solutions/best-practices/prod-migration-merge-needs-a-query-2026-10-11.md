---
title: "A PR that needs a prod migration merges on the to_regclass output, not on an answer that says it was applied"
track: knowledge
category: best-practices
module: shared
tags: [database, migrations, railway, merge, prod, verification]
applies_to: ["migrations/**", "shared/schema.ts"]
created: 2026-10-11
---

# A prod migration precondition needs a query, not an answer

## When this applies

A PR ships `migrations/NNNN_*.sql` and new server code that reads or writes the
new table or column. Prod runs no `db:push`, and merging to `main` auto-deploys
on Railway. So the migration must be on prod **before** the merge (see
`stacked-prs-merge-commits-and-prod-migration-2026-10-05.md` §3).

## What went wrong

Password policy part 2 (#1370, 2026-10-11) shipped `migrations/0020_password_upgrade_passes.sql`.
The merge gate was a multiple-choice question, and the owner picked "0020 is
applied — merge it". The PR merged and deployed. Later the owner asked how to
apply the migration. A `to_regclass` check came back empty, so the table had
never been created. The live server would have answered every short-password
sign-in with a 500. No prod account matched that path, so nobody was hit. The
migration was applied after the deploy.

A chosen answer and a real result look the same in the transcript. Only the
query output tells "applied" apart from "I meant to" or "I misread the option".

## The rule

Before merging, the owner runs this check and pastes its output into the
session (prod reads are the owner's to run):

```bash
railway run --service Postgres --environment production -- \
  sh -c 'psql "$DATABASE_PUBLIC_URL" -c "SELECT to_regclass('\''public.<table>'\'');"'
```

- It prints the table name → applied. Merge.
- It prints a blank row (NULL) → not applied. Do not merge. Apply it first:

  ```bash
  railway run --service Postgres --environment production -- \
    sh -c 'psql "$DATABASE_PUBLIC_URL" -v ON_ERROR_STOP=1 -f migrations/NNNN_<name>.sql'
  ```

  Then re-run the check.

For a new **column**, check `information_schema.columns`
(`SELECT 1 FROM information_schema.columns WHERE table_name='<t>' AND column_name='<c>'`).
For an index, use `to_regclass('public.<index_name>')`.

Use `DATABASE_PUBLIC_URL` from the `Postgres` service. The app's `DATABASE_URL`
points at `postgres.railway.internal`, which does not resolve off Railway's
network.

## Why not ask a question instead

An `AskUserQuestion` option like "it's applied — merge" turns the precondition
into a click. The PR body's "apply before merging" checklist has the same flaw.
Put the check command itself in the PR body's merge section, and make the merge
gate ask for its output.

## Related Files

- `migrations/0020_password_upgrade_passes.sql` — the header says to apply
  before merging; the merge went ahead without that.
- `docs/rules/database.md` — the binding one-line rule.

## See Also

- `docs/solutions/conventions/stacked-prs-merge-commits-and-prod-migration-2026-10-05.md`
