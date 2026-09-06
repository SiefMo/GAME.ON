# Security Policy

## Reporting a vulnerability

Please do not publish exploitable security details in a public issue. Report privately to the repository maintainer with:

- a short description,
- affected endpoint/component,
- reproducible steps,
- impact assessment if known.

Never include passwords, session cookies, reconnect tokens, database files, or other secrets.

## Security expectations

- Keep production `NODE_ENV=production`.
- Use HTTPS in front of the server.
- Set a strong, unique session/reconnect configuration and protect environment variables.
- Restrict `CLIENT_ORIGIN` to the real frontend origin.
- Back up the SQLite data volume before upgrades.
- Do not commit `.env` or database files.
