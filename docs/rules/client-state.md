# Client State Rules

- Always use `apiRequest()` from `@/lib/query-client` for all server communication — never raw `fetch()` in components or hooks
- Always use the `Authorization` header for auth tokens — never cookies
