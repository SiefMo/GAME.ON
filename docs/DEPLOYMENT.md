# GAME ON — Production Deployment

GAME ON is a full-stack multiplayer application. GitHub stores the source code; the live game needs a Node/Socket.IO server and persistent SQLite storage.

## Recommended one-service production shape

The included Docker image builds the React client and serves it from the Express server. This keeps the browser, HTTP API and Socket.IO endpoint on one origin, so no separate frontend URL is required.

### Local

```bash
npm install
npm run verify
npm run dev
```

Open `http://localhost:5173`. The Vite dev server proxies `/api` and `/socket.io` to the server.

### Render

The repository includes `render.yaml`. Render can create the Docker web service from the repository. The service uses `/app/data` for SQLite persistence and `/health` for health checks. Render web services support WebSockets and persistent disks; persistent disks are available on paid web services. If using the free plan, use this only as a temporary/demo deployment and expect database persistence limitations.

Set these environment variables in the Render service:

- `NODE_ENV=production`
- `DATABASE_URL=/app/data/game-on.db`
- `CLIENT_ORIGIN=https://YOUR-SERVICE.onrender.com`
- `ADMIN_BOOTSTRAP_USERNAME=` (optional, then remove it after promoting the intended account)

### Important

Do not deploy the backend to GitHub Pages. GitHub Pages is static hosting and cannot run Express/Socket.IO or SQLite.

## Production checks

The GitHub CI workflow runs:

- static QA
- TypeScript typecheck
- unit tests
- production builds

The E2E workflow runs Playwright against the server and Vite client.
