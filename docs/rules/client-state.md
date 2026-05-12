# Client State Rules

- Always use `apiRequest()` from `@/lib/query-client` for all server communication — never raw `fetch()` in components or hooks
- Always use the `Authorization` header for auth tokens — never cookies
- After an irreversible server mutation (account delete, payment, hard-delete), wrap local cleanup (`tokenStorage.clear`, `AsyncStorage.removeItem`) in try/catch and never throw — propagating a post-success error makes the user "retry" a destructive action that already succeeded
- Multi-step flows that mutate server state AND sync local state (e.g. POST profile → updateUser({onboardingCompleted: true})) must either (a) atomically mark completion on the server step and rely on server idempotency, or (b) call `checkAuth()` / equivalent server re-fetch in the catch when the server step succeeded but the local sync failed — never leave the user stuck behind a navigation gate after a server-side success
