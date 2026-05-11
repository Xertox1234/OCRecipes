# Client State Rules

- Always use `apiRequest()` from `@/lib/query-client` for all server communication — never raw `fetch()` in components or hooks
- Always use the `Authorization` header for auth tokens — never cookies
- After an irreversible server mutation (account delete, payment, hard-delete), wrap local cleanup (`tokenStorage.clear`, `AsyncStorage.removeItem`) in try/catch and never throw — propagating a post-success error makes the user "retry" a destructive action that already succeeded
