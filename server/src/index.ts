import 'dotenv/config';
import { createServer } from 'node:http';
import { createApp } from './app.js';
import { createDatabase } from './db/database.js';
import { createSocketServer } from './socket.js';
import { bootstrapAdmin } from './admin.js';

const db = createDatabase();
bootstrapAdmin(db);
const app = createApp(db);
const httpServer = createServer(app);
createSocketServer(httpServer, db);
const port = Number(process.env.PORT || 3001);
httpServer.listen(port, () => console.log(`GAME ON server listening on http://localhost:${port}`));
let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  const forceTimer = setTimeout(() => process.exit(1), 10_000);
  forceTimer.unref();
  httpServer.close(() => { db.close(); clearTimeout(forceTimer); process.exit(0); });
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
