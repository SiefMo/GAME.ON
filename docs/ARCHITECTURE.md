# Architecture

Server-authoritative design is mandatory. The future `GameEngine` will live in shared/server-safe code and accept explicit actions, returning state transitions/events. Socket.IO will be a transport only; it will never be trusted with client-supplied state.

Database uses SQLite in development behind a small database factory so PostgreSQL can be introduced without coupling game rules to SQLite APIs.

Hidden information is modeled as server-only state. Public state serializers will be introduced before multiplayer implementation.

## Phase 8 — Reconnect, persistence and AFK recovery

- Active match state is persisted in `match_runtime` after accepted game actions and timeout transitions.
- Reconnect tokens are random 256-bit bearer secrets; only SHA-256 hashes are stored in SQLite.
- Socket authentication still requires the normal HttpOnly session cookie; reconnect tokens additionally bind a player to a specific match.
- On disconnect, the server keeps the exact authoritative hand/turn state and starts a configurable grace timer.
- Default disconnect policy is `mark-abandoned`; an abandoned player's turn is safely skipped through the engine recovery hook.
- A pending Penalty/Switch/Red decision owned by an abandoned player is cancelled operationally so the match cannot freeze.
- On process restart, active persisted matches are restored into the in-memory runtime and rooms are reconstructed without exposing raw state to clients.
- Client projections remain per-player: opponent hands and hidden number-0 team mappings are never sent.

### Admin security
Administrative endpoints use the authenticated session plus a server-side `user_admin.role='admin'` check. Suspension is checked during HTTP and Socket.IO authentication. Role/suspension changes are written to `admin_audit_log`. The frontend Admin page is only a navigation convenience; authorization is never delegated to the client.
