---
title: "A backgrounded command's reported exit code is unreliable when the command includes a pipe"
track: knowledge
category: conventions
tags: [bash, background-tasks, exit-code, pipe, verification]
module: agents
applies_to: [".claude/agents/**/*.md", ".claude/skills/**/*.md"]
created: 2026-07-15
---

# A backgrounded command's reported exit code is unreliable when the command includes a pipe

## Rule

When a bash command is run with `run_in_background: true` (or any backgrounded/detached execution mode) and the command includes a pipe — `| tail`, `| head`, `| grep`, etc. — do not trust the harness's reported "(exit code N)" on the background-completion notification. That code reflects the LAST command in the pipeline (`tail`, `grep`, ...), not the command whose actual success/failure matters (`npm run test:run`, etc.), unless the shell has `pipefail` explicitly set for that invocation. Always read the actual captured output directly to determine real pass/fail — never gate a decision on the notification's exit-code summary alone when a pipe is involved.

## Why

A backgrounded `npm run test:run | tail -60` reported a completion notification with "(exit code 0)" — but reading the actual captured output showed the real test run had failed with a crash. The `0` was `tail`'s own exit code (`tail` almost always succeeds at printing whatever it was given, independent of whether the upstream command succeeded), not `npm run test:run`'s. This is standard POSIX pipeline semantics (`$?` reflects the last command in a pipe unless `pipefail` is active) but is easy to forget specifically in the backgrounded case, because the notification surfaces a single exit code as if it were authoritative for the whole command.

## Smell patterns

- A backgrounded command's own reported exit code is `0` (success), but the actual captured output contains error text, a stack trace, or an explicit failure count.
- The backgrounded command includes any of `| tail`, `| head`, `| grep`, `| sed`, or similar — any pipe stage after the command whose result actually matters.

## Examples

```bash
# The reported exit code here is tail's, not npm's — do not trust it in isolation:
npm run test:run | tail -60   # backgrounded

# Safer: set pipefail so $? reflects the real failure, or avoid piping in the
# backgrounded command at all and read the full captured output instead:
set -o pipefail && npm run test:run | tail -60
```

Even with `pipefail`, still read the actual output when the stakes are high (a verification gate, a decision to proceed) — a single exit code collapses a lot of information a human or agent should actually look at before trusting a pass/fail verdict.

## Exceptions

None specifically — this is a general pipeline-semantics fact, not situational. It matters most in backgrounded/detached contexts because the exit code is often the only signal surfaced by a completion notification, tempting a quick pass/fail decision without opening the output.

## Related Files

None specific — this is a general orchestration/scripting convention, not tied to one file.

## See Also

- [A dispatched subagent must run its own verification synchronously — backgrounding it strands the agent with no notification](subagent-verification-must-run-synchronously-2026-07-06.md) — a related but distinct backgrounding hazard (notification timing, not exit-code reliability)
