import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export function createDatabase(filename = process.env.DATABASE_URL || './data/game-on.db') {
  const absolute = path.isAbsolute(filename) ? filename : path.join(process.cwd(), filename);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  const db = new Database(absolute);
  db.pragma('foreign_keys = ON');
  for (const file of ['001_initial.sql', '002_auth.sql', '003_match_indexes.sql', '004_match_runtime.sql', '005_social_settings.sql', '006_admin.sql', '007_admin_audit.sql']) {
    db.exec(fs.readFileSync(path.join(process.cwd(), 'migrations', file), 'utf8'));
  }
  return db;
}
