use std::fs;
use std::io;
use std::path::Path;

use rusqlite::{Connection, OptionalExtension};

use crate::{fail, Sql};

const PRAGMAS: &str = "
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA temp_store = MEMORY;
PRAGMA cache_size = -65536;
PRAGMA mmap_size = 268435456;
";

const TABLES: &str = "
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL UNIQUE,
  session_file TEXT,
  cwd TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  seq INTEGER NOT NULL,
  entry_id TEXT,
  role TEXT NOT NULL,
  tool_name TEXT,
  ts INTEGER NOT NULL,
  tokens INTEGER NOT NULL,
  compacted INTEGER NOT NULL DEFAULT 0,
  dedup INTEGER NOT NULL,
  text TEXT NOT NULL,
  json TEXT NOT NULL,
  UNIQUE(conversation_id, seq),
  UNIQUE(conversation_id, dedup)
);
CREATE INDEX IF NOT EXISTS messages_uncompacted ON messages(conversation_id, seq) WHERE compacted = 0;
CREATE INDEX IF NOT EXISTS messages_ts ON messages(conversation_id, ts);
CREATE TABLE IF NOT EXISTS summaries (
  id INTEGER PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  depth INTEGER NOT NULL,
  consumed INTEGER NOT NULL DEFAULT 0,
  text TEXT NOT NULL,
  tokens INTEGER NOT NULL,
  meta TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS summaries_open ON summaries(conversation_id, depth, consumed, id);
CREATE TABLE IF NOT EXISTS summary_messages (
  summary_id INTEGER NOT NULL REFERENCES summaries(id),
  message_id INTEGER NOT NULL REFERENCES messages(id),
  ord INTEGER NOT NULL,
  PRIMARY KEY (summary_id, message_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS summary_messages_by_message ON summary_messages(message_id);
CREATE TABLE IF NOT EXISTS summary_children (
  summary_id INTEGER NOT NULL REFERENCES summaries(id),
  child_id INTEGER NOT NULL REFERENCES summaries(id),
  ord INTEGER NOT NULL,
  PRIMARY KEY (summary_id, child_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS summary_children_by_child ON summary_children(child_id);
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(text, content='messages', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
CREATE VIRTUAL TABLE IF NOT EXISTS summaries_fts USING fts5(text, content='summaries', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
";

const TRIGGERS: &str = "
CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;
CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE OF text ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', old.id, old.text);
  INSERT INTO messages_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER IF NOT EXISTS summaries_ai AFTER INSERT ON summaries BEGIN
  INSERT INTO summaries_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER IF NOT EXISTS summaries_ad AFTER DELETE ON summaries BEGIN
  INSERT INTO summaries_fts(summaries_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;
CREATE TRIGGER IF NOT EXISTS summaries_au AFTER UPDATE OF text ON summaries BEGIN
  INSERT INTO summaries_fts(summaries_fts, rowid, text) VALUES ('delete', old.id, old.text);
  INSERT INTO summaries_fts(rowid, text) VALUES (new.id, new.text);
END;
";

pub fn configure(c: &Connection) -> napi::Result<()> {
    c.execute_batch(PRAGMAS).sq()
}

/// Tables, indexes and FTS tables, plus the schema version row.
pub fn create_tables(c: &Connection) -> napi::Result<()> {
    c.execute_batch(TABLES).sq()?;
    c.execute("INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', '1')", []).sq()?;
    Ok(())
}

/// FTS sync triggers; created after the bulk copy so the copy does not fire them row by row.
pub fn create_triggers(c: &Connection) -> napi::Result<()> {
    c.execute_batch(TRIGGERS).sq()
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Current time as ISO-8601 with milliseconds, the same shape as JS `toISOString()`.
pub fn now_iso(c: &Connection) -> napi::Result<String> {
    c.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |r| r.get(0)).sq()
}

pub fn conv_pk(c: &Connection, uuid: &str) -> napi::Result<Option<i64>> {
    c.query_row("SELECT id FROM conversations WHERE uuid = ?1", [uuid], |r| r.get(0))
        .optional()
        .sq()
}

pub fn require_conv(c: &Connection, uuid: &str) -> napi::Result<i64> {
    match conv_pk(c, uuid)? {
        Some(id) => Ok(id),
        None => fail(format!("Unknown conversation {uuid}")),
    }
}

#[cfg(unix)]
pub fn make_private_dir(dir: &Path) -> io::Result<()> {
    use std::os::unix::fs::DirBuilderExt;
    fs::DirBuilder::new().recursive(true).mode(0o700).create(dir)
}

#[cfg(not(unix))]
pub fn make_private_dir(dir: &Path) -> io::Result<()> {
    fs::create_dir_all(dir)
}

#[cfg(unix)]
pub fn make_private_file(path: &Path) -> io::Result<()> {
    use std::os::unix::fs::OpenOptionsExt;
    fs::OpenOptions::new().create(true).append(true).mode(0o600).open(path).map(|_| ())
}

#[cfg(not(unix))]
pub fn make_private_file(path: &Path) -> io::Result<()> {
    fs::OpenOptions::new().create(true).append(true).open(path).map(|_| ())
}
