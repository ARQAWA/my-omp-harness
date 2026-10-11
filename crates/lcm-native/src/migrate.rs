use std::fs;
use std::path::Path;

use napi_derive::napi;
use rusqlite::functions::FunctionFlags;
use rusqlite::{params, Connection, OpenFlags, OptionalExtension};

use crate::schema;
use crate::text::{dedup_key, hex_dedup};
use crate::types::MigrationReport;
use crate::{fail, io_err, Sql};

/// Copies a legacy LCM database into the new schema. The legacy file is opened read-only and never changed.
#[napi]
pub fn migrate_legacy(legacy_path: String, db_path: String) -> napi::Result<MigrationReport> {
    let tmp = format!("{db_path}.tmp");
    remove_db_files(&tmp);
    let outcome = run(&legacy_path, &db_path, &tmp);
    if outcome.is_err() {
        remove_db_files(&tmp);
    }
    outcome
}

fn remove_db_files(base: &str) {
    for suffix in ["", "-wal", "-shm"] {
        let _ = fs::remove_file(format!("{base}{suffix}"));
    }
}

fn run(legacy_path: &str, db_path: &str, tmp: &str) -> napi::Result<MigrationReport> {
    if !Path::new(legacy_path).exists() {
        return fail(format!("Legacy database not found: {legacy_path}"));
    }
    schema::make_private_file(Path::new(tmp)).map_err(io_err)?;
    let report = {
        let mut c = Connection::open_with_flags(
            tmp,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE | OpenFlags::SQLITE_OPEN_URI,
        )
        .sq()?;
        schema::configure(&c)?;
        schema::create_tables(&c)?;
        c.create_scalar_function(
            "lcm_hex_dedup",
            1,
            FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC,
            |ctx| {
                let hex: Option<String> = ctx.get(0)?;
                Ok(hex.and_then(|h| hex_dedup(&h)))
            },
        )
        .sq()?;
        c.execute("ATTACH DATABASE ?1 AS legacy", [file_uri(legacy_path)]).sq()?;
        let report = copy_all(&mut c, legacy_path)?;
        c.execute_batch("DETACH DATABASE legacy").sq()?;
        c.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(())).sq()?;
        report
    };
    fs::rename(tmp, db_path).map_err(io_err)?;
    Ok(report)
}

/// `file:` URI with mode=ro, so ATTACH can never write to the legacy file.
fn file_uri(path: &str) -> String {
    let mut out = String::from("file:");
    for ch in path.chars() {
        match ch {
            '%' => out.push_str("%25"),
            '?' => out.push_str("%3F"),
            '#' => out.push_str("%23"),
            ' ' => out.push_str("%20"),
            other => out.push(other),
        }
    }
    out.push_str("?mode=ro");
    out
}

fn count(c: &Connection, sql: &str) -> napi::Result<i64> {
    c.query_row(sql, [], |r| r.get(0)).sq()
}

/// Migrated row count for `table`; fails when it differs from the legacy table.
fn check(c: &Connection, table: &str) -> napi::Result<i64> {
    let legacy = count(c, &format!("SELECT COUNT(*) FROM legacy.{table}"))?;
    let migrated = count(c, &format!("SELECT COUNT(*) FROM {table}"))?;
    if legacy != migrated {
        return fail(format!("Migration count mismatch for {table}: legacy {legacy}, migrated {migrated}"));
    }
    Ok(migrated)
}

fn copy_all(c: &mut Connection, legacy_path: &str) -> napi::Result<MigrationReport> {
    let tx = c.transaction().sq()?;

    tx.execute(
        "INSERT INTO conversations (uuid, session_id, session_file, cwd, created_at, updated_at)
         SELECT id, session_id, session_file, cwd, created_at, updated_at FROM legacy.conversations ORDER BY rowid",
        [],
    )
    .sq()?;

    tx.execute(
        "INSERT INTO messages (uuid, conversation_id, seq, entry_id, role, tool_name, ts, tokens, compacted, dedup, text, json)
         SELECT m.id, cv.id, m.seq, m.entry_id, m.role, m.tool_name, m.timestamp, m.token_estimate,
                COALESCE(m.is_compacted, 0), lcm_hex_dedup(m.dedup_hash), m.content_text, m.content_json
         FROM legacy.messages m JOIN conversations cv ON cv.uuid = m.conversation_id
         WHERE m.dedup_hash IS NOT NULL ORDER BY m.rowid",
        [],
    )
    .sq()?;
    copy_messages_without_dedup(&tx)?;

    tx.execute(
        "INSERT INTO summaries (uuid, conversation_id, depth, consumed, text, tokens, meta, created_at)
         SELECT s.id, cv.id, s.depth,
                EXISTS (SELECT 1 FROM legacy.summary_sources x WHERE x.source_type = 'summary' AND x.source_id = s.id),
                s.text, s.token_estimate, s.metadata_json, s.created_at
         FROM legacy.summaries s JOIN conversations cv ON cv.uuid = s.conversation_id ORDER BY s.rowid",
        [],
    )
    .sq()?;

    // Sources whose target row is missing from the legacy file are not copied (the joins drop them).
    let mut sources = tx
        .execute(
            "INSERT INTO summary_messages (summary_id, message_id, ord)
             SELECT s.id, m.id, x.seq FROM legacy.summary_sources x
             JOIN summaries s ON s.uuid = x.summary_id
             JOIN messages m ON m.uuid = x.source_id
             WHERE x.source_type = 'message'",
            [],
        )
        .sq()?;
    sources += tx
        .execute(
            "INSERT INTO summary_children (summary_id, child_id, ord)
             SELECT s.id, ch.id, x.seq FROM legacy.summary_sources x
             JOIN summaries s ON s.uuid = x.summary_id
             JOIN summaries ch ON ch.uuid = x.source_id
             WHERE x.source_type = 'summary'",
            [],
        )
        .sq()?;

    tx.execute_batch(
        "INSERT INTO messages_fts(messages_fts) VALUES ('rebuild');
         INSERT INTO summaries_fts(summaries_fts) VALUES ('rebuild');",
    )
    .sq()?;
    schema::create_triggers(&tx)?;

    if let Some(cwd) = legacy_cwd(&tx)? {
        tx.execute("INSERT OR REPLACE INTO meta (key, value) VALUES ('cwd', ?1)", [cwd]).sq()?;
    }
    tx.execute(
        "INSERT OR REPLACE INTO meta (key, value) VALUES ('migrated_from', ?1)",
        [legacy_path],
    )
    .sq()?;

    let report = MigrationReport {
        conversations: check(&tx, "conversations")?,
        messages: check(&tx, "messages")?,
        summaries: check(&tx, "summaries")?,
        sources: sources as i64,
    };
    tx.commit().sq()?;
    Ok(report)
}

/// Legacy messages whose dedup_hash is NULL get the key computed here, the same way appendMessage does.
fn copy_messages_without_dedup(tx: &Connection) -> napi::Result<()> {
    let mut stmt = tx
        .prepare(
            "SELECT id, conversation_id, seq, entry_id, role, tool_name, timestamp, token_estimate,
                    COALESCE(is_compacted, 0), content_text, content_json
             FROM legacy.messages WHERE dedup_hash IS NULL ORDER BY rowid",
        )
        .sq()?;
    let mut rows = stmt.query([]).sq()?;
    let mut insert = tx
        .prepare(
            "INSERT INTO messages (uuid, conversation_id, seq, entry_id, role, tool_name, ts, tokens, compacted, dedup, text, json)
             VALUES (?1, (SELECT id FROM conversations WHERE uuid = ?2), ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        )
        .sq()?;
    while let Some(row) = rows.next().sq()? {
        let id: String = row.get(0).sq()?;
        let conversation: String = row.get(1).sq()?;
        let seq: i64 = row.get(2).sq()?;
        let entry_id: Option<String> = row.get(3).sq()?;
        let role: String = row.get(4).sq()?;
        let tool_name: Option<String> = row.get(5).sq()?;
        let timestamp: i64 = row.get(6).sq()?;
        let tokens: i64 = row.get(7).sq()?;
        let compacted: i64 = row.get(8).sq()?;
        let text: String = row.get(9).sq()?;
        let json: String = row.get(10).sq()?;
        let dedup = dedup_key(&role, timestamp, &text);
        insert
            .execute(params![
                id, conversation, seq, entry_id, role, tool_name, timestamp, tokens, compacted, dedup, text, json
            ])
            .sq()?;
    }
    Ok(())
}

fn legacy_cwd(tx: &Connection) -> napi::Result<Option<String>> {
    let has_table = count(
        tx,
        "SELECT COUNT(*) FROM legacy.sqlite_master WHERE type = 'table' AND name = '_metadata'",
    )?;
    if has_table == 0 {
        return Ok(None);
    }
    tx.query_row("SELECT value FROM legacy._metadata WHERE key = 'cwd'", [], |r| r.get::<_, String>(0))
        .optional()
        .sq()
}
