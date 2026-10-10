/**
 * SQLite connection management with WAL mode and busy timeout.
 * PASSIVE checkpoint on close, TRUNCATE after compaction.
 */

import { Database as BunDatabase } from "bun:sqlite";
import { mkdirSync, chmodSync } from "fs";
import { join } from "path";
import { hashCwd } from "../utils.js";

/** bun:sqlite with the better-sqlite3 surface LCM uses: create/strict open and pragma(). */
export class Database extends BunDatabase {
  constructor(path: string) {
    super(path, { create: true, strict: true });
  }
  pragma(statement: string): unknown[] {
    return this.query(`PRAGMA ${statement}`).all();
  }
}

export function getDbPath(dbDir: string, cwd: string): string {
  return join(dbDir, `${hashCwd(cwd)}.db`);
}

export function openDb(dbDir: string, cwd: string): Database {
  // Secure directory permissions
  mkdirSync(dbDir, { recursive: true, mode: 0o700 });
  const dbPath = getDbPath(dbDir, cwd);

  const db = new Database(dbPath);

  // Secure file permissions
  try { chmodSync(dbPath, 0o600); } catch { /* may fail on some FS */ }

  // Connection pragmas
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");

  ensureMetadata(db, cwd);

  return db;
}

export function closeDb(db: Database): void {
  try {
    // PASSIVE on close (non-blocking, won't fail if readers exist)
    db.pragma("wal_checkpoint(PASSIVE)");
  } catch { /* non-fatal */ }
  try {
    db.close();
  } catch { /* ignore close errors */ }
}

/** TRUNCATE checkpoint after compaction (safe — called under mutex). */
export function checkpointDb(db: Database): void {
  try {
    db.pragma("wal_checkpoint(TRUNCATE)");
  } catch { /* non-fatal */ }
}

function ensureMetadata(database: Database, cwd: string): void {
  database.prepare(
    `CREATE TABLE IF NOT EXISTS _metadata (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`
  ).run();

  const row = database.prepare("SELECT value FROM _metadata WHERE key = 'cwd'").get() as
    | { value: string }
    | undefined;

  if (!row) {
    database.prepare("INSERT INTO _metadata (key, value) VALUES ('cwd', ?)").run(cwd);
  } else if (row.value !== cwd) {
    console.warn(
      `[LCM] DB cwd mismatch: stored="${row.value}" current="${cwd}". ` +
        `This may indicate a hash collision or moved project.`,
    );
  }
}
