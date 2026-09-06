# GitHub Release Checklist

## Before first push

- Confirm `.env` and database files are ignored.
- Run `npm ci` from a clean environment.
- Run static QA, typecheck, tests, build, and E2E.
- Review `git diff` for secrets and generated files.

## Suggested repository settings

- Protect `main`.
- Require CI checks before merge.
- Enable dependency update tooling where available.
- Use private deployment secrets rather than repository files.
- Require review for changes to `server/src`, `shared/src`, migrations, and security configuration.

## Release artifact

The project should be deployed from a tagged commit after CI is green. Do not upload `node_modules`, local SQLite databases, `.env`, coverage output, or Playwright artifacts.
