---
title: "The skill loader substitutes $0 with the skill's arguments — an awk `tolower($0) !~ /secret/` filter in a SKILL.md becomes an unset variable and passes everything; write `$ 0`"
track: bug
category: logic-errors
tags: [harness, skills, awk, audit, cheap-worker, fail-open]
module: shared
applies_to: [".claude/skills/**/SKILL.md"]
symptoms: ["A SKILL.md command reads `tolower(<scope>)` or `tolower()` where the file says `tolower($0)`", "A paragraph filter meant to drop auth/IAP text before ask-kimi drops nothing", "awk prints every record although the regex should exclude some"]
created: 2026-10-26
severity: high
---

# Skill argument substitution turns awk `$0` into an empty filter

## Problem

`/audit` Phase 1 step 5 builds a filtered dedup corpus before sending it to the external `ask-kimi` worker, dropping any paragraph that mentions auth, JWT, IAP, receipts, sessions, passwords, credentials or health data:

```bash
awk -v RS= -v ORS='\n\n' 'tolower($0) !~ /auth|jwt|iap|…/' "$f"
```

Loaded as `/audit maintainability`, the skill body arrived as `tolower(maintainability) !~ /auth|…/`.

## Symptoms

- The command in the loaded skill text no longer contains `$0`.
- Running it as shown keeps the sensitive paragraphs.

## Root Cause

The skill loader replaces positional placeholders such as `$0` in the SKILL.md body with the invocation's arguments. awk reads the replacement word as a variable name; unset variables are `""`; `"" !~ /auth|…/` is always true. A negative-match deny-filter therefore becomes allow-all — it fails **open**, and the paragraphs it exists to withhold go to an external model.

Measured 2026-10-25 (`/usr/bin/awk`, a three-paragraph file with one `AUTH` paragraph): `tolower($ 0) !~ /auth|jwt/` printed the two clean paragraphs; the substituted `tolower(maintainability) !~ /auth|jwt/` printed all three (`grep -c AUTH` → 1).

## Solution

Write the field reference as `$ 0`. In awk `$` is an operator on an expression, so `$ 0` means exactly `$0`, and the loader's substitution does not match it. The audit SKILL.md now uses it, with a comment saying why.

## Prevention

- In any SKILL.md, never write a bare `$0`–`$9` that a shell or awk must see literally — use `$ 0` in awk, or put the code in a script file the skill calls.
- A filter that guards what leaves the machine must be checked against the text as the skill loader *delivers* it, not as the file stores it.

## Related Files

- `.claude/skills/audit/SKILL.md` (Phase 1 step 5)

## See Also

- [guard script fail-closed on unrecognized values](guard-script-field-quote-strip-fail-closed-2026-07-16.md)
