---
name: audit-security
description: Run a security-scoped structured code audit (IDOR, JWT, rate limiting, SSRF, file uploads, prompt injection, AI safety) — single-command alias for /audit security
---

This command is a pure routing alias for the `audit` skill with the `security` scope. It contains no audit instructions of its own — the entire workflow lives in `.claude/skills/audit/SKILL.md` and must be loaded, not reconstructed.

The user's arguments: "$ARGUMENTS" (may be empty).

Your first tool call: invoke the Skill tool with

- `skill`: `audit`
- `args`: `security` if the arguments above are empty; otherwise `security` followed by the arguments verbatim (extra arguments narrow the discovery focus, e.g. a module path like `server/routes`)

Then follow the loaded audit skill exactly, end to end, with scope `security`. Do not review, scan, or analyze any code before the audit skill is loaded, and do not reproduce its phases from memory — the skill body is the source of truth.
