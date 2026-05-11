# AI Prompting Rules

- Sanitize ALL prompt roles (`user`, `assistant`, `system`) — not just user messages; recipe/community content in assistant and system roles is equally adversarial
- OpenAI tool schema and handler parameter names must be identical — a mismatch causes phantom parameters that OpenAI ignores silently, breaking tool execution
- Never embed unsanitized user-provided content in `system` role messages — recipe ingredients, instructions, and user-authored text can contain injections
- `cacheAffectingFields` must stay in sync with `calculateProfileHash` — adding a profile field without updating the cache key serves stale responses to new configurations
