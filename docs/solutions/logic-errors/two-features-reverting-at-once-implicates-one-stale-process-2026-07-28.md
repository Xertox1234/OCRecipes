---
title: Two unrelated features "reverting" at once implicates ONE stale process — not two lost commits
track: bug
category: logic-errors
tags: [dev-server, tsx, watch, hot-reload, phantom-regression, branch-switching, express, debugging, scan, barcode]
module: server
applies_to: ["package.json", "server/**/*.ts"]
symptoms: ["A fix you know you made is gone, but git shows it on main", "Two or more unrelated features regress at the same moment", "The source file on disk is correct but the running app behaves like an older version", "Behavior reverts after switching git branches, with no code change", "A server-side fix appears to work for a while and then stops"]
created: '2026-07-28'
severity: medium
---

# Two unrelated features "reverting" at once implicates ONE stale process — not two lost commits

## Problem

Reported as: *"I literally just fixed the barcode scan flow to show side-by-side
results when the nutrition label disagrees with the database, but now it's
gone"* — followed a minute later by *"the kcal reading has also reverted."*

Both were on `main`. Nothing was lost.

```jsonc
// package.json — the actual defect
"server:dev": "NODE_ENV=development tsx server/index.ts"   // ✗ no --watch
```

Plain `tsx` loads its module graph once and holds it. The process had been up
**2h19m**, and during that window the working tree moved across three branches
(`feat/…` → `main` → `fix/…`). Every checkout swapped files on disk **underneath
a frozen process**, while `EXPO_PUBLIC_DOMAIN` pointed the app straight at it.

The editor showed correct code. The app talked to a server running the code from
two hours earlier.

## The diagnostic that cracked it

**The second symptom was the evidence, not extra noise.** One feature vanishing
has many explanations — a bad merge, a lost stash, a revert. *Two unrelated*
features vanishing at the same instant has very few: two independent losses
landing simultaneously is wildly improbable, but one shared stale process
explains both at zero cost.

So the question flips from *"where did my commit go?"* to **"what single thing do
both features pass through?"** Here both were server-side:

| Symptom | Owner |
|---|---|
| Side-by-side conflict UI missing | `server/services/label-override.ts` → `buildLabelConflict` — the client only renders when the **server** reports a conflict |
| kcal wrong | `server/services/barcode-lookup.ts` — Atwater fallback + self-consistent-macro fixes |

The side-by-side prompt (`client/components/ScanConflictPrompt.tsx`) is client
code, which makes it *look* like a bundle problem. It is not: it renders only
when the server's payload carries `conflict`. **Trace which side actually decides
the behavior before blaming the bundle** — a client component gated on a server
field is a server bug.

## Solution

```jsonc
"server:dev": "NODE_ENV=development tsx watch server/index.ts"
```

Verify a watch flag actually watches — a broken one is worse than none, because
it converts "I should restart" into false confidence:

```bash
touch server/services/label-override.ts
# the log must show a SECOND "express server started", and lsof must report a NEW pid
```

Only `server:dev` takes `watch`. Every other `tsx` script in this repo
(`seed:recipes`, `backfill:*`, `eval:*`, `build:*`) is a one-shot CLI that must
exit.

## Prevention

- **A long-running dev process with no file watcher is a silent staleness trap.**
  It has no failure signal: it keeps serving, just from old code. Any script that
  stays resident should watch, or the staleness will eventually be mistaken for
  lost work.
- **Branch switching is the amplifier.** Editing a file at least leaves you
  expecting a restart. A `git checkout` rewrites many files with no edit action
  at all, so nothing prompts you to restart — and the divergence can be hours
  wide.
- **Count the symptoms before starting archaeology.** N unrelated regressions at
  one moment implicates a shared runtime — process, bundle, server, or account
  tier — with confidence roughly proportional to N. `git log`/`blame`/`bisect`
  cannot explain a symptom whose cause is a process that never reloaded.
- **Check the delivery path before the git history.** Ordered cheapest-first:
  is the code on `main`? → which process is serving it, and when did it start? →
  which bundle/build is the client on? See
  `.claude/skills/regression-triage/SKILL.md`.
- Re-implementing a fix that is already on `main` produces a no-op diff and
  reinforces a false "we keep losing work" narrative. Prove absence before
  rewriting.

## Related Files

- `package.json` — `server:dev`, the script that needed `watch`
- `server/services/label-override.ts` — `buildLabelConflict`; server decides the conflict
- `server/services/barcode-lookup.ts` — the kcal path that reverted alongside it
- `client/components/ScanConflictPrompt.tsx` — client renderer, gated on the server's `conflict` field
- `.claude/skills/regression-triage/SKILL.md` — the triage order this extends

## See Also

- [JS-rendered feedback is not evidence a native call succeeded](../conventions/js-rendered-feedback-not-evidence-native-call-succeeded-2026-07-25.md) — the sibling trap: UI that renders regardless of whether the thing behind it worked
