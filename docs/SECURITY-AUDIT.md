# GAME ON — Phase 11 Security Audit

## Threat model
The client is untrusted. The server is authoritative for authentication, room membership, game state, hidden cards, penalties, scoring, and match persistence.

## Controls added
- HttpOnly session cookies; secure cookies in production; hashed session tokens at rest.
- Session expiry cleanup and a five-session-per-user retention policy.
- Authentication rate limiting for register/login/logout.
- Strict CORS origin plus Origin validation for state-changing HTTP requests.
- JSON body size limit (32 KB).
- Baseline browser security headers: `nosniff`, `DENY` framing, strict referrer policy, restrictive permissions policy.
- Socket authentication from the server-side session cookie.
- Per-socket event rate limiting to reduce event-flood abuse.
- Socket room payload validation and game request envelope validation with Zod.
- Server-injected `playerId`; clients cannot impersonate another player through game actions.
- Per-player action request IDs prevent replay of recent accepted actions.
- Reconnect tokens are random, short-lived, user/match-bound, and stored only as SHA-256 hashes.
- Hidden game data is projected per viewer; opponent hands and zero-card hidden team mappings are not sent.
- Admin APIs require server-side admin role checks and audit logs.

## Known operational limitation
Full dependency installation/build/test execution remains blocked in the execution environment by the package registry timeout. Static TypeScript validation and dependency-free smoke/schema checks are used where possible; no unrun test suite is represented as passing.
