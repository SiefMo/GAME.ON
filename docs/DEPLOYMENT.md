# GAME ON — Deployment Guide

## Recommended production shape

- Frontend: any static host that supports Vite output.
- Backend: a Node 22 service/container running `server/dist/index.js`.
- Database: SQLite on a persistent volume. The schema is migration-based and can later move to PostgreSQL behind the server persistence layer.
- HTTPS: terminate TLS at the hosting provider/reverse proxy.

## Local production check

```bash
npm install
npm run qa:static
npm run typecheck
npm test
npm run build
```

Then create a production `.env` from `.env.example`, set `NODE_ENV=production`, and point `CLIENT_ORIGIN` at the deployed frontend origin.

## Docker

```bash
docker compose up --build -d
docker compose ps
docker compose logs -f game-on
```

The database is stored in the named `game_on_data` volume. Back it up before upgrades or destructive maintenance.

## Frontend deployment

Build the client with the production API URL:

```bash
VITE_API_URL=https://api.example.com npm run build -w client
```

Publish `client/dist` on the static host. The browser must be able to reach the API and Socket.IO endpoint over HTTPS/WSS.

## GitHub

1. Create an empty repository.
2. Copy this project into it.
3. Keep `.env`, database files, `node_modules`, and build output untracked.
4. Push the default branch.
5. Enable the included CI workflows.
6. Configure repository secrets/environment variables only in the deployment system; never commit them.

## Pre-launch checklist

- [ ] `npm install` succeeds from a clean checkout.
- [ ] `npm run qa:static` passes.
- [ ] `npm run typecheck` passes.
- [ ] `npm test` passes.
- [ ] `npm run build` passes.
- [ ] `npm run e2e` passes with Chromium installed.
- [ ] `NODE_ENV=production` is set.
- [ ] `CLIENT_ORIGIN` is exact and HTTPS.
- [ ] Database volume is persistent and backed up.
- [ ] Health endpoint `/health` is monitored.
- [ ] Admin bootstrap is used only for controlled initialization, then the environment variable is removed.
- [ ] Real player/team artwork is added only when licensing permits it.
- [ ] Privacy, Terms, and Account Deletion pages are reviewed before public launch.
