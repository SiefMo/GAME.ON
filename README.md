# GAME ON ⚽ — FOOTBALL CARD BATTLE

مش مجرد كروت... دي ماتش كامل.

## Status
Phase 14 integrated build: authentication, rooms, server-authoritative multiplayer engine, social/profile features, admin tooling, persistence, responsive game table, security controls, automated tests, and deployment configuration are included.

## Architecture
- `client/`: React + TypeScript + Vite UI
- `server/`: Express + TypeScript API
- `shared/`: shared game contracts and pure tests
- `config/`: game/team/player configuration
- `migrations/`: SQLite migrations
- `assets/`: replaceable placeholders
- `docs/`: architecture notes

## Phase 2 Authentication
- Registration with validation
- Password hashing using bcrypt
- Database-backed random session tokens stored only as SHA-256 hashes
- HttpOnly/SameSite session cookie
- Login rate limiting
- Login/logout/current-user/profile endpoints
- No plaintext passwords

## Local development
1. Install Node.js 20+.
2. Run `npm install` from the repository root.
3. Copy `.env.example` to `.env`.
4. Run `npm run dev`.
5. Client: `http://localhost:5173`.
6. API: `http://localhost:3001/health`.

## Tests
- `npm test`
- `npm run typecheck`
- `npm run build`

## Production
GitHub Pages can host the frontend only. The Socket.IO/Express backend and production database require Node-capable hosting. Set `CLIENT_ORIGIN`, `DATABASE_URL`, and other production environment values in the hosting provider; never commit secrets.

## Assets
- Player images: `assets/players/`
- Team logos/flags: `assets/teams/`
- Card art: `assets/cards/`
- Audio: `assets/audio/`

Only use assets you own or have licensed for the commercial release.

## Phase 3 — Lobby & Rooms
- Server-authoritative room membership and host state.
- 2–4 players per room.
- Create, join by 6-character code, ready/unready, leave, host transfer, host kick, start validation.
- Runtime room state is intentionally separate from the future Socket.IO transport and Game Engine.
- Room state is not game state; when a match starts in a later phase, the authoritative Game Engine will own the match state.

## Phase 4 — Complete Game Engine
The shared engine is UI/Socket independent and server-oriented. It implements:
- Exact 108-card deck generation from configured teams/assets.
- 7-card opening hands and Number-only opening discard.
- Normal Team/Number matching and server-only Hidden Team mapping for 0 cards.
- Warning counters and Warning→Red conversion.
- Red +4, accumulated third-Red reset, and `skipNext` behavior.
- Foul, Reverse (with configurable two-player behavior), and Switch with an explicit optional pass.
- Penalty with optional Goalkeeper defense, hidden attacker Team choice, five-second authoritative deadline model, correct/wrong guess, decline, and timeout failure.
- Goalkeeper slot placement/removal without making Goalkeeper a separate card type.
- Discard-pile reshuffling while preserving the top discard.
- Last-card effect-before-win semantics.
- Deterministic ranking criteria and configurable score-by-rank.
- Match event logging suitable for later persistence/debugging.

The automated test suite for Phase 4 is in `shared/src/game.engine.test.ts`. In this execution environment, npm dependency installation timed out, so Vitest itself could not be launched; the engine source was typechecked without tests and a runtime smoke suite was executed against the compiled engine.

## Phase 5 — Authoritative Socket.IO Multiplayer

The server now exposes a Socket.IO transport on the same HTTP server. Clients authenticate using the existing HttpOnly session cookie. Game actions are requests only; the server injects the authenticated `playerId`, validates membership/turn/ownership through `GameEngine`, and broadcasts per-player state projections.

Socket protocol:
- `room:subscribe`
- `game:start`
- `game:action` with `{requestId, action}`
- `game:state`
- `game:event`
- `game:error`

Hidden information is filtered server-side: opponent hands are omitted and `hiddenTeamId` is never sent to clients. Request IDs are deduplicated per player to reject replayed actions. Match runtime is currently in process memory; durable reconnect/match persistence is intentionally part of Phase 8.

### Authoritative action contract

For game mutations the preferred wire format is `game:action` with a unique `requestId`; the server ignores any client-supplied player identity and injects the authenticated session user. Named aliases (`game:playCard`, `game:drawCard`, `game:chooseTeam`, `game:save`, `game:guess`, `game:switch`, `game:placeGoalkeeper`, `game:removeGoalkeeper`) are also supported. All mutation responses are acknowledgements and the authoritative state arrives via `game:state`.


## Phase 6 — Game Table UI

The client now includes the production-oriented football pitch table foundation: responsive pitch layout, animated cards, player HUDs, goalkeeper controls, penalty decision/guess UI with server deadline display, Switch selection UI, and finished-match overlay. Game actions still go through the authoritative Socket.IO server. Opponent hands remain hidden except for the explicit Switch-selection exception: the Switch owner is temporarily allowed to see the next player's hand because the game rule requires the owner to choose exactly one target card.

### Assets
- `assets/players/placeholder.svg` is the only bundled player placeholder.
- Team/logo/flag paths are configurable through `config/teams.json`.
- Replace placeholders only with assets you have rights to use.


### Phase 9 notes
- Social API: username search, friend requests, accept/decline, remove friend.
- Notification inbox with unread count and mark-read/mark-all-read.
- Persistent player settings: sound effects, SFX volume, animations, notifications.
- Audio uses short browser-generated SFX only; no copyrighted music/assets are bundled.
- Client exposes Friends, Notifications, and Settings from the main navigation.
- Settings are persisted server-side and mirrored locally only for immediate SFX playback.


## Phase 11 — Security Audit — Secure Admin Panel
- Server-protected admin middleware; clients cannot self-elevate.
- Separate `user_admin` table for role/suspension state without mutating the core user schema.
- Optional `ADMIN_BOOTSTRAP_USERNAME` environment setting promotes one existing account at server startup.
- Admin dashboard: users, admins, suspended accounts, matches, active matches, finished matches, and event counts.
- Paginated user management with username search.
- Suspend/unsuspend users and promote/demote admin role, with self-lockout safeguards.
- Paginated match list, match details, and recent event inspection.
- Admin audit records for role and suspension changes.
- Suspended accounts are blocked by both HTTP auth and Socket.IO authentication.
- No raw passwords, session tokens, hidden game state, or opponent hands are exposed through admin APIs.


## Phase 11
Security audit controls are documented in `docs/SECURITY-AUDIT.md`, including origin protection, security headers, socket flood protection, request validation, session hygiene, replay protection, and hidden-information checks.

## Phase 12 — Automated Testing + E2E
- Vitest edge-case coverage for GameEngine and persisted match runtime/reconnect tokens.
- Playwright Chromium E2E coverage for registration/login failure and lobby access.
- `playwright.config.ts` starts server + client for E2E runs.
- `npm run qa:static` validates required project files/config JSON and typechecks the shared GameEngine without requiring workspace installation.
- Full dependency-backed test/build execution still depends on successful `npm install` in the environment.

## Phase 13 — Performance + Mobile Optimization
- Game Table Socket state updates are frame-batched with `requestAnimationFrame` so bursts of authoritative updates produce at most one React state commit per frame.
- Game socket is kept in a ref to avoid unnecessary callback re-creation and reconnect churn; WebSocket is preferred with polling fallback.
- Hand cards and opponent HUD rows are memoized to reduce avoidable React renders.
- Penalty countdown interval only runs while an authoritative penalty deadline exists instead of ticking on every game screen.
- Vite build uses explicit vendor chunks for React, Framer Motion, and Socket.IO plus CSS code splitting.
- Mobile hardening includes safe-area insets, `100svh`, 44px touch targets, momentum horizontal hand scrolling, reduced-motion support, touch-only hover suppression, compact pitch/card layouts, and bottom-sheet modals on narrow screens.
- Game pitch is isolated with CSS containment to reduce layout/paint impact from animated elements.
- No game rule or server-authoritative behavior was changed in this phase.

## Phase 14 — Production Readiness + GitHub + Deployment
- Added production containerization with a multi-stage Node 22 `Dockerfile` and persistent SQLite volume support.
- Added `docker-compose.yml` with restart policy and `/health` container healthcheck.
- Added `/ready` database readiness endpoint for deployment/load-balancer checks.
- Added graceful HTTP/database shutdown with a bounded 10-second force-exit fallback.
- Added GitHub Actions CI for static QA, typecheck, tests, and production build, plus an E2E workflow with Chromium installation.
- Added GitHub bug-report template and `SECURITY.md` with safe vulnerability-reporting guidance.
- Added `docs/DEPLOYMENT.md` and `docs/GITHUB.md` covering environment variables, Docker, frontend deployment, backups, and repository hygiene.
- Added root `verify` and `check:json` scripts for release verification.
- Production defaults continue to use secure cookies, exact `CLIENT_ORIGIN`, persistent database storage, and server-authoritative game state.
- No game rules were changed in this phase.

### Phase 14 verification note
This execution environment does not currently complete npm registry requests, so a fresh dependency install and dependency-backed build/test suite cannot be honestly marked as executed here. Static QA, JSON validation, shared typecheck, SQLite migration validation, and archive integrity were executed successfully. GitHub CI is configured to run the complete dependency-backed checks on a normal runner.

## GitHub Pages
The included `pages.yml` deploys the React frontend only. The multiplayer API/Socket.IO server must be deployed separately on a Node-capable host and supplied to the frontend through `VITE_API_URL`.


### CI/Pages note
The GitHub Pages workflow uses `npm install` because this repository intentionally does not commit a package-lock file; the CI workflow performs the same clean dependency installation on GitHub runners.


## Production architecture

GAME ON is a full-stack multiplayer game. GitHub is the source repository; the live game runs the React client, Express API, Socket.IO server and persistent SQLite database together in the included Docker image. GitHub Pages is intentionally not used for the production game server.
