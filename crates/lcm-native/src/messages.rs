use std::time::{Duration, Instant};

use rusqlite::types::Value;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension, Row};

use crate::schema::{new_id, now_iso, require_conv};
use crate::text::{capped_text, dedup_key, estimate_tokens, is_blank, like_pattern, sanitize_fts_query};
use crate::types::{Conversation, RegexSearch, SearchResult, StoredMessage};
use crate::Sql;

pub const MSG_SELECT: &str = "SELECT m.uuid, cv.uuid, m.entry_id, m.role, m.tool_name, m.ts, m.text, m.json, m.tokens, m.seq, m.compacted FROM messages m JOIN conversations cv ON cv.id = m.conversation_id";

const CONV_COLS: &str = "uuid, session_id, session_file, cwd, created_at, updated_at";
const SEARCH_COLS: &str = "m.uuid, m.role, m.text, m.ts, m.seq";

fn map_conversation(r: &Row) -> rusqlite::Result<Conversation> {
    Ok(Conversation {
        id: r.get(0)?,
        session_id: r.get(1)?,
        session_file: r.get(2)?,
        cwd: r.get(3)?,
        created_at: r.get(4)?,
        updated_at: r.get(5)?,
    })
}

fn map_message(r: &Row) -> rusqlite::Result<StoredMessage> {
    Ok(StoredMessage {
        id: r.get(0)?,
        conversation_id: r.get(1)?,
        entry_id: r.get(2)?,
        role: r.get(3)?,
        tool_name: r.get(4)?,
        timestamp: r.get(5)?,
        content_text: r.get(6)?,
        content_json: r.get(7)?,
        token_estimate: r.get(8)?,
        seq: r.get(9)?,
        is_compacted: r.get(10)?,
    })
}

fn map_search(r: &Row) -> rusqlite::Result<SearchResult> {
    Ok(SearchResult {
        id: r.get(0)?,
        role: r.get(1)?,
        content_text: r.get(2)?,
        timestamp: r.get(3)?,
        seq: r.get(4)?,
        snippet: None,
        summary_id: None,
        summary_depth: None,
    })
}

fn query_messages(c: &Connection, sql: &str, vals: Vec<Value>) -> napi::Result<Vec<StoredMessage>> {
    let mut stmt = c.prepare_cached(sql).sq()?;
    let rows = stmt.query_map(params_from_iter(vals), map_message).sq()?;
    let out = rows.collect::<rusqlite::Result<Vec<_>>>().sq()?;
    Ok(out)
}

fn query_search(c: &Connection, sql: &str, vals: Vec<Value>) -> napi::Result<Vec<SearchResult>> {
    let mut stmt = c.prepare_cached(sql).sq()?;
    let rows = stmt.query_map(params_from_iter(vals), map_search).sq()?;
    let out = rows.collect::<rusqlite::Result<Vec<_>>>().sq()?;
    Ok(out)
}

pub fn get_or_create_conversation(
    c: &Connection,
    session_id: &str,
    session_file: Option<String>,
    cwd: &str,
) -> napi::Result<Conversation> {
    let now = now_iso(c)?;
    let existing = c
        .query_row(
            &format!("SELECT {CONV_COLS} FROM conversations WHERE session_id = ?1"),
            [session_id],
            map_conversation,
        )
        .optional()
        .sq()?;
    if let Some(mut conv) = existing {
        c.execute(
            "UPDATE conversations SET updated_at = ?1, session_file = COALESCE(?2, session_file) WHERE uuid = ?3",
            params![now, session_file, conv.id],
        )
        .sq()?;
        if session_file.is_some() {
            conv.session_file = session_file;
        }
        conv.updated_at = now;
        return Ok(conv);
    }
    let id = new_id();
    c.execute(
        &format!("INSERT INTO conversations ({CONV_COLS}) VALUES (?1, ?2, ?3, ?4, ?5, ?5)"),
        params![id, session_id, session_file, cwd, now],
    )
    .sq()?;
    Ok(Conversation {
        id,
        session_id: session_id.to_string(),
        session_file,
        cwd: cwd.to_string(),
        created_at: now.clone(),
        updated_at: now,
    })
}

#[allow(clippy::too_many_arguments)]
pub fn append_message(
    c: &Connection,
    conversation_id: &str,
    entry_id: Option<String>,
    role: &str,
    tool_name: Option<String>,
    timestamp: i64,
    content_text: &str,
    content_json: &str,
) -> napi::Result<Option<StoredMessage>> {
    let cpk = require_conv(c, conversation_id)?;
    let id = new_id();
    let tokens = estimate_tokens(content_text).max(1);
    let dedup = dedup_key(role, timestamp, content_text);
    let seq: Option<i64> = c
        .query_row(
            "INSERT INTO messages (uuid, conversation_id, seq, entry_id, role, tool_name, ts, tokens, dedup, text, json)
             SELECT ?1, ?2, COALESCE((SELECT MAX(seq) + 1 FROM messages WHERE conversation_id = ?2), 0), ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10
             WHERE TRUE
             ON CONFLICT (conversation_id, dedup) DO NOTHING
             RETURNING seq",
            params![id, cpk, entry_id, role, tool_name, timestamp, tokens, dedup, content_text, content_json],
            |r| r.get(0),
        )
        .optional()
        .sq()?;
    let Some(seq) = seq else { return Ok(None) };
    Ok(Some(StoredMessage {
        id,
        conversation_id: conversation_id.to_string(),
        entry_id,
        role: role.to_string(),
        content_text: content_text.to_string(),
        content_json: content_json.to_string(),
        tool_name,
        token_estimate: tokens,
        timestamp,
        seq,
        is_compacted: 0,
    }))
}

pub fn messages_by_ids(c: &Connection, ids: &[String]) -> napi::Result<Vec<StoredMessage>> {
    let mut out = Vec::new();
    for chunk in ids.chunks(500) {
        let placeholders = vec!["?"; chunk.len()].join(",");
        let sql = format!("{MSG_SELECT} WHERE m.uuid IN ({placeholders})");
        let vals: Vec<Value> = chunk.iter().map(|s| Value::from(s.clone())).collect();
        out.extend(query_messages(c, &sql, vals)?);
    }
    out.sort_by_key(|m| m.seq);
    Ok(out)
}

pub fn uncompacted_messages(c: &Connection, conversation_id: &str) -> napi::Result<Vec<StoredMessage>> {
    let sql = format!("{MSG_SELECT} WHERE cv.uuid = ?1 AND m.compacted = 0 ORDER BY m.seq");
    query_messages(c, &sql, vec![Value::from(conversation_id.to_string())])
}

pub fn uncompacted_tokens(c: &Connection, conversation_id: &str) -> napi::Result<i64> {
    c.query_row(
        "SELECT COALESCE(SUM(m.tokens), 0) FROM messages m JOIN conversations cv ON cv.id = m.conversation_id WHERE cv.uuid = ?1 AND m.compacted = 0",
        [conversation_id],
        |r| r.get(0),
    )
    .sq()
}

pub fn message_count(c: &Connection, conversation_id: &str) -> napi::Result<i64> {
    c.query_row(
        "SELECT COUNT(*) FROM messages m JOIN conversations cv ON cv.id = m.conversation_id WHERE cv.uuid = ?1",
        [conversation_id],
        |r| r.get(0),
    )
    .sq()
}

fn push_time_filters(sql: &mut String, vals: &mut Vec<Value>, after: Option<i64>, before: Option<i64>) {
    if let Some(ts) = after {
        sql.push_str(" AND m.ts >= ?");
        vals.push(Value::Integer(ts));
    }
    if let Some(ts) = before {
        sql.push_str(" AND m.ts <= ?");
        vals.push(Value::Integer(ts));
    }
}

fn search_fts(
    c: &Connection,
    conversation_id: &str,
    fts: &str,
    limit: i64,
    after: Option<i64>,
    before: Option<i64>,
) -> napi::Result<Vec<SearchResult>> {
    let mut sql = format!(
        "SELECT {SEARCH_COLS} FROM messages m JOIN messages_fts ON messages_fts.rowid = m.id JOIN conversations cv ON cv.id = m.conversation_id WHERE messages_fts MATCH ? AND cv.uuid = ?"
    );
    let mut vals = vec![Value::from(fts.to_string()), Value::from(conversation_id.to_string())];
    push_time_filters(&mut sql, &mut vals, after, before);
    sql.push_str(" ORDER BY m.seq DESC LIMIT ?");
    vals.push(Value::Integer(limit));
    query_search(c, &sql, vals)
}

fn search_like(
    c: &Connection,
    conversation_id: &str,
    query: &str,
    limit: i64,
    after: Option<i64>,
    before: Option<i64>,
) -> napi::Result<Vec<SearchResult>> {
    let mut sql = format!(
        "SELECT {SEARCH_COLS} FROM messages m JOIN conversations cv ON cv.id = m.conversation_id WHERE cv.uuid = ? AND m.text LIKE ? ESCAPE '\\'"
    );
    let mut vals = vec![Value::from(conversation_id.to_string()), Value::from(like_pattern(query))];
    push_time_filters(&mut sql, &mut vals, after, before);
    sql.push_str(" ORDER BY m.seq DESC LIMIT ?");
    vals.push(Value::Integer(limit));
    query_search(c, &sql, vals)
}

/// Attaches the lowest-depth summary that lists each message as a source.
fn enrich(c: &Connection, results: &mut [SearchResult]) -> napi::Result<()> {
    let mut stmt = c
        .prepare_cached(
            "SELECT s.uuid, s.depth FROM summary_messages sm JOIN summaries s ON s.id = sm.summary_id JOIN messages m ON m.id = sm.message_id WHERE m.uuid = ?1 ORDER BY s.depth ASC, s.id ASC LIMIT 1",
        )
        .sq()?;
    for r in results.iter_mut() {
        let found = stmt
            .query_row([&r.id], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)))
            .optional()
            .sq()?;
        if let Some((summary_id, depth)) = found {
            r.summary_id = Some(summary_id);
            r.summary_depth = Some(depth);
        }
    }
    Ok(())
}

pub fn search_messages(
    c: &Connection,
    conversation_id: &str,
    query: &str,
    limit: Option<i64>,
    after: Option<i64>,
    before: Option<i64>,
) -> napi::Result<Vec<SearchResult>> {
    if is_blank(query) {
        return Ok(Vec::new());
    }
    let limit = limit.unwrap_or(20).clamp(0, 100);
    let fts = sanitize_fts_query(query);
    let mut results = match search_fts(c, conversation_id, &fts, limit, after, before) {
        Ok(found) => found,
        Err(_) => search_like(c, conversation_id, query, limit, after, before)?,
    };
    enrich(c, &mut results)?;
    Ok(results)
}

pub fn search_regex(
    c: &Connection,
    conversation_id: &str,
    pattern: &str,
    limit: Option<i64>,
    timeout_ms: Option<i64>,
) -> napi::Result<RegexSearch> {
    if is_blank(pattern) {
        return Ok(RegexSearch { results: Vec::new(), timed_out: false });
    }
    let limit = limit.unwrap_or(20).clamp(0, 100) as usize;
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(5000).max(0) as u64);
    let re = regex::RegexBuilder::new(pattern)
        .case_insensitive(true)
        .build()
        .map_err(|e| napi::Error::from_reason(format!("Invalid regex pattern \"{pattern}\": {e}")))?;
    let started = Instant::now();
    let sql = format!(
        "SELECT {SEARCH_COLS} FROM messages m JOIN conversations cv ON cv.id = m.conversation_id WHERE cv.uuid = ?1 ORDER BY m.seq DESC"
    );
    let mut results: Vec<SearchResult> = Vec::new();
    let mut timed_out = false;
    {
        let mut stmt = c.prepare_cached(&sql).sq()?;
        let mut rows = stmt.query([conversation_id]).sq()?;
        while let Some(row) = rows.next().sq()? {
            if started.elapsed() > timeout {
                timed_out = true;
                break;
            }
            let msg = map_search(row).sq()?;
            if re.is_match(&capped_text(&msg.content_text)) {
                results.push(msg);
                if results.len() >= limit {
                    break;
                }
            }
        }
    }
    enrich(c, &mut results)?;
    Ok(RegexSearch { results, timed_out })
}
