# What belongs in CLAUDE.md, and where else instructions can live (2026-11-01)

Research for harness item 7 (slim CLAUDE.md / MEMORY.md, remove stale lines — `2026-10-30-diagnosis.md` §6). This doc is evidence only; the item 7 spec decides what changes.

## What belongs in CLAUDE.md

Anthropic's docs and the strongest study agree on the same four kinds of content:

1. **How to confirm work:** the exact test, typecheck and lint commands, and how to run one test file.
2. **Places where the code misleads:** an old pattern that is everywhere but must not be copied, a directory that looks dead but is live.
3. **Decisions not written in the repo:** which helper the team settled on, how deploys work, what needs special review.
4. **Anything corrected twice.**

Leave out (docs):

- Architecture and file layout — listed in the docs' "what you can stop doing" table: "Claude reads the repo itself."
- Multi-step procedures → skills. Rules for one part of the codebase → path-scoped rules. Personal preferences → `CLAUDE.local.md`.
- IMPORTANT / YOU MUST — the docs say current models follow a plain line and emphasis "mostly makes Claude over-apply the rule."

## How strong the evidence is

- **Content — strong.** ETH Zurich (arXiv 2602.11988; Claude Code, Codex, Qwen Code on real GitHub issues): developer-written context files raised success ~4 points; LLM-generated files lowered it 0.5–2 points because they repeated the README; every context file raised cost by more than 20%. Agents did follow the files (a tool named in the file: ~1.6 uses per task vs ~0 without).
- **Length — disputed.** Anthropic's docs say longer files "reduce adherence" and target under 200 lines. A 1,650-session factorial study (arXiv 2605.10039; TypeScript, Sonnet 4.6 / Opus 4.6) varied file size 25–500 lines, rule position, file splitting and contradictions and found no detectable effect; the size and contradiction nulls have Bayes-factor support (BF10 0.05–0.10). Shortness is therefore supported on **cost** and maintainability, not on measured adherence.
- **Session length — the largest measured effect.** Same study: each additional generated function ≈ 5.6% lower odds of compliance (OR 0.944), reproduced on a second codebase and model. This points at `/clear` / compaction cadence, not file layout.
- **Unverified figure.** A widely cited blog reports "0 of 524 without a file vs 67.7% with" and attributes it to 2605.10039; the abstract says that study did not compare with/without. Treat it as the blog's reading.
- **Rules that look enforced but are not.** 481 public CLAUDE.md files (arXiv 2608.23550): only 4–16% of their security rules had any matching built-in control (4.4%, 95% CI 2.6–6.7%, under the strictest match).
- **Why files grow.** 247,694 instruction lifetimes across 1,867 repos (arXiv 2608.11095): prompts more than triple over their life (+4.9 net instructions per commit; older lines are less likely to be deleted). Comments recording the reason behind an instruction removed 99.3% of excess instructions in controlled tasks.

## Other ways to give instructions, ranked

Ranked by what each guarantees and what it costs in context. Only row 1 has strong outside evidence; the rest rank on documented behaviour.

| #   | Mechanism                                               | Guarantee                                   | Loads                                                                          | Evidence                |
| --- | ------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------- |
| 1   | Hooks, permission deny rules, sandbox, CI               | Enforced every time                         | Runs; no context                                                               | Docs; 2608.23550        |
| 2   | A check Claude can run (test command, preflight)        | Claude closes its own loop                  | The command line only                                                          | Docs                    |
| 3   | Path-scoped `.claude/rules/*.md` (`paths:` frontmatter) | Guidance                                    | Only when Claude reads or edits matching files                                 | Docs                    |
| 4   | Skills                                                  | Guidance                                    | Name + description every session; body on use                                  | Docs                    |
| 5   | Subdirectory `CLAUDE.md`                                | Guidance                                    | When Claude first touches that directory                                       | Docs                    |
| 6   | Root `CLAUDE.md`                                        | Guidance — often followed, never guaranteed | Every session, in full, re-injected after compaction                           | 2602.11988, 2605.10039  |
| 7   | Auto memory `MEMORY.md`                                 | Guidance                                    | First 200 lines **or** 25 KB, whichever comes first; not loaded into subagents | Docs                    |
| 8   | `@imports`                                              | Organisation only                           | At launch with the importing file — no saving                                  | Docs                    |
| 9   | IMPORTANT / capitals                                    | Likely counter-productive                   | —                                                                              | Docs say stop; untested |

Two maintenance tools:

- **Block HTML comments** (`<!-- why this line exists -->`) are stripped before CLAUDE.md is injected, so recording each line's reason costs no context and makes later pruning safe (2608.11095).
- **`/doctor prompt-audit`** (Claude Code ≥ 2.1.283; installed 2.1.316) reports lines written for older models, references to files or commands that no longer exist, and contradictions across instruction files. It proposes edits and changes nothing until asked.

## This repo, measured 2026-11-01

| File                             | Lines | Bytes  | Notes                                                                |
| -------------------------------- | ----- | ------ | -------------------------------------------------------------------- |
| `CLAUDE.md`                      | 141   | 19,891 | Under the line target; long paragraph lines                          |
| `MEMORY.md` (auto memory)        | 109   | 22,806 | **The 25 KB limit binds first** — text past it is dropped at startup |
| `~/.claude/CLAUDE.md` + `RTK.md` | —     | 4,461  | User-level                                                           |

`CLAUDE.md` by section: Workflow Standards 6,606 B and Key Patterns 5,615 B (61% together); Environment Variables 2,306 B; Development Commands 1,695 B; Architecture 1,429 B; the rest under 600 B each.

Observations for the item 7 spec (not decisions):

- Much of Workflow Standards describes what the preflight, PR, merge and worktree hooks already enforce. Per the docs, once a hook enforces a rule the prose can shrink to a pointer plus the bypass.
- Architecture is the content the docs now say to omit.
- The Deferred Item Todos policy is a procedure — a skill or path-scoped rule candidate.
- There is no `.env.example`, so the environment-variable list is not derivable elsewhere. Options: create one, or move the list to a `server/CLAUDE.md` that loads on demand.
- `docs/rules/` + `.claude/hooks/inject-patterns.sh` is a hand-built equivalent of native path-scoped rules. Difference: native rules also load on Read; ours inject on Edit/Write/MultiEdit only.
- The SessionStart payload (ledger, recent solutions) is also always-loaded context and belongs in the same budget.

## Sources

- [Anthropic — How Claude remembers your project](https://code.claude.com/docs/en/memory)
- [Anthropic — Best practices for Claude Code](https://code.claude.com/docs/en/best-practices)
- [DAIR summary of ETH Zurich, "Evaluating AGENTS.md" (arXiv 2602.11988)](https://academy.dair.ai/blog/agents-md-evaluation)
- [arXiv 2605.10039 — factorial study of CLAUDE.md structure](https://arxiv.org/abs/2605.10039)
- [arXiv 2608.11095 — Why Does CLAUDE.md Keep Growing?](https://arxiv.org/abs/2608.11095)
- [arXiv 2608.23550 — When "Do Not" Is Not Deny](https://arxiv.org/abs/2608.23550)
- [Alex Dunlop — CLAUDE.md Best Practices: What the Evidence Supports](https://www.alexdunlop.com/writing/claude-md-best-practices)
