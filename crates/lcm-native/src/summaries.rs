use std::collections::HashSet;

use rusqlite::types::Value;
use rusqlite::{params, params_from_iter, Connection, Row};

use crate::messages;
use crate::schema::{new_id, now_iso, require_conv};
use crate::text::{estimate_tokens, is_blank, like_pattern, sanitize_fts_query};
use crate::types::{LcmStats, SourceRef, Summary};
use crate::{fail, Sql};

const SUM_SELECT: &str = "SELECT s.uuid, cv.uuid, s.depth, s.text, s.tokens, s.meta, s.created_at FROM summaries s JOIN conversations cv ON cv.id = s.conversation_id";

fn map_summary(r: &Row) -> rusqlite::Result<Summary> {
    Ok(Summary {
        id: r.get(0)?,
        conversation_id: r.get(1)?,
        depth: r.get(2)?,
        text: r.get(3)?,
        token_estimate: r.get(4)?,
        metadata_json: r.get(5)?,
        created_at: r.get(6)?,
    })
}

fn query_summaries(c: &Connection, sql: &str, vals: Vec<Value>) -> napi::Result<Vec<Summary>> {
    let mut stmt = c.prepare_cached(sql).sq()?;
    let rows = stmt.query_map(params_from_iter(vals), map_summary).sq()?;
    let out = rows.collect::<rusqlite::Result<Vec<_>>>().sq()?;
    Ok(out)
}

pub fn get_summary(c: &Connection, id: &str) -> napi::Result<Option<Summary>> {
    let found = query_summaries(c, &format!("{SUM_SELECT} WHERE s.uuid = ?1"), vec![Value::from(id.to_string())])?;
    Ok(found.into_iter().next())
}

/// Messages first, then child summaries, both in link order.
pub fn sources(c: &Connection, summary_id: &str) -> napi::Result<Vec<SourceRef>> {
    let mut stmt = c
        .prepare_cached(
            "SELECT 'message', m.uuid, sm.ord FROM summary_messages sm JOIN summaries s ON s.id = sm.summary_id JOIN messages m ON m.id = sm.message_id WHERE s.uuid = ?1
             UNION ALL
             SELECT 'summary', ch.uuid, sc.ord FROM summary_children sc JOIN summaries s ON s.id = sc.summary_id JOIN summaries ch ON ch.id = sc.child_id WHERE s.uuid = ?1
             ORDER BY 3",
        )
        .sq()?;
    let rows = stmt
        .query_map([summary_id], |r| {
            Ok(SourceRef {
                source_type: r.get(0)?,
                source_id: r.get(1)?,
            })
        })
        .sq()?;
    let out = rows.collect::<rusqlite::Result<Vec<_>>>().sq()?;
    Ok(out)
}

/// Summaries that list `child_id` as a child, ordered by depth.
fn parents(c: &Connection, child_id: &str) -> napi::Result<Vec<Summary>> {
    query_summaries(
        c,
        &format!(
            "{SUM_SELECT} JOIN summary_children sc ON sc.summary_id = s.id WHERE sc.child_id = (SELECT id FROM summaries WHERE uuid = ?1) ORDER BY s.depth ASC, s.id ASC"
        ),
        vec![Value::from(child_id.to_string())],
    )
}

/// Lineage walk: at each step take the deepest parent.
pub fn lineage(c: &Connection, summary_id: &str) -> napi::Result<Vec<Summary>> {
    let mut out = Vec::new();
    let mut visited: HashSet<String> = HashSet::new();
    let mut current = summary_id.to_string();
    loop {
        if !visited.insert(current.clone()) {
            break;
        }
        let found = parents(c, &current)?;
        let Some(parent) = found.into_iter().reduce(|a, b| if a.depth > b.depth { a } else { b }) else {
            break;
        };
        current = parent.id.clone();
        out.push(parent);
    }
    Ok(out)
}

pub fn by_depth(c: &Connection, conversation_id: &str, depth: i64) -> napi::Result<Vec<Summary>> {
    query_summaries(
        c,
        &format!("{SUM_SELECT} WHERE cv.uuid = ?1 AND s.depth = ?2 ORDER BY s.created_at ASC, s.id ASC"),
        vec![Value::from(conversation_id.to_string()), Value::Integer(depth)],
    )
}

pub fn unconsumed_by_depth(c: &Connection, conversation_id: &str, depth: i64) -> napi::Result<Vec<Summary>> {
    query_summaries(
        c,
        &format!("{SUM_SELECT} WHERE cv.uuid = ?1 AND s.depth = ?2 AND s.consumed = 0 ORDER BY s.created_at ASC, s.id ASC"),
        vec![Value::from(conversation_id.to_string()), Value::Integer(depth)],
    )
}

pub fn max_depth(c: &Connection, conversation_id: &str) -> napi::Result<i64> {
    let max: Option<i64> = c
        .query_row(
            "SELECT MAX(s.depth) FROM summaries s JOIN conversations cv ON cv.id = s.conversation_id WHERE cv.uuid = ?1",
            [conversation_id],
            |r| r.get(0),
        )
        .sq()?;
    Ok(max.unwrap_or(-1))
}

pub fn all(c: &Connection, conversation_id: &str, limit: Option<i64>) -> napi::Result<Vec<Summary>> {
    query_summaries(
        c,
        &format!("{SUM_SELECT} WHERE cv.uuid = ?1 ORDER BY s.depth DESC, s.created_at DESC, s.id DESC LIMIT ?2"),
        vec![Value::from(conversation_id.to_string()), Value::Integer(limit.unwrap_or(100))],
    )
}

/// Highest-id summary per depth (id is the rowid, so this is the latest inserted).
pub fn latest_per_depth(c: &Connection, conversation_id: &str) -> napi::Result<Vec<Summary>> {
    query_summaries(
        c,
        &format!(
            "{SUM_SELECT} WHERE cv.uuid = ?1 AND s.id IN (SELECT MAX(x.id) FROM summaries x WHERE x.conversation_id = cv.id GROUP BY x.depth) ORDER BY s.depth DESC"
        ),
        vec![Value::from(conversation_id.to_string())],
    )
}

pub fn stats(c: &Connection, conversation_id: &str) -> napi::Result<LcmStats> {
    let messages = messages::message_count(c, conversation_id)?;
    let summaries: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM summaries s JOIN conversations cv ON cv.id = s.conversation_id WHERE cv.uuid = ?1",
            [conversation_id],
            |r| r.get(0),
        )
        .sq()?;
    let max = max_depth(c, conversation_id)?;
    let db_size_bytes: i64 = c
        .query_row(
            "SELECT page_count * page_size FROM pragma_page_count(), pragma_page_size()",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    Ok(LcmStats {
        messages,
        summaries,
        max_depth: max.max(0),
        db_size_bytes,
    })
}

fn insert_summary(
    c: &Connection,
    conversation_id: &str,
    depth: i64,
    text: &str,
    metadata_json: Option<String>,
) -> napi::Result<(i64, Summary)> {
    let cpk = require_conv(c, conversation_id)?;
    let id = new_id();
    let now = now_iso(c)?;
    let tokens = estimate_tokens(text);
    c.execute(
        "INSERT INTO summaries (uuid, conversation_id, depth, consumed, text, tokens, meta, created_at) VALUES (?1, ?2, ?3, 0, ?4, ?5, ?6, ?7)",
        params![id, cpk, depth, text, tokens, metadata_json, now],
    )
    .sq()?;
    let sid = c.last_insert_rowid();
    let summary = Summary {
        id,
        conversation_id: conversation_id.to_string(),
        depth,
        text: text.to_string(),
        token_estimate: tokens,
        metadata_json,
        created_at: now,
    };
    Ok((sid, summary))
}

/// Caller wraps this in a transaction.
pub fn create_leaf(
    c: &Connection,
    conversation_id: &str,
    text: &str,
    message_ids: &[String],
    metadata_json: Option<String>,
) -> napi::Result<Summary> {
    let (sid, summary) = insert_summary(c, conversation_id, 0, text, metadata_json)?;
    let cpk = require_conv(c, conversation_id)?;
    for (ord, message_id) in message_ids.iter().enumerate() {
        let linked = c
            .execute(
                "INSERT INTO summary_messages (summary_id, message_id, ord) SELECT ?1, m.id, ?2 FROM messages m WHERE m.uuid = ?3 AND m.conversation_id = ?4",
                params![sid, ord as i64, message_id, cpk],
            )
            .sq()?;
        if linked != 1 {
            return fail(format!("Unknown message {message_id} in conversation {conversation_id}"));
        }
    }
    c.execute(
        "UPDATE messages SET compacted = 1 WHERE id IN (SELECT message_id FROM summary_messages WHERE summary_id = ?1)",
        [sid],
    )
    .sq()?;
    Ok(summary)
}

/// Caller wraps this in a transaction.
pub fn create_condensed(
    c: &Connection,
    conversation_id: &str,
    depth: i64,
    text: &str,
    child_ids: &[String],
    metadata_json: Option<String>,
) -> napi::Result<Summary> {
    let (sid, summary) = insert_summary(c, conversation_id, depth, text, metadata_json)?;
    let cpk = require_conv(c, conversation_id)?;
    for (ord, child_id) in child_ids.iter().enumerate() {
        let linked = c
            .execute(
                "INSERT INTO summary_children (summary_id, child_id, ord) SELECT ?1, s.id, ?2 FROM summaries s WHERE s.uuid = ?3 AND s.conversation_id = ?4",
                params![sid, ord as i64, child_id, cpk],
            )
            .sq()?;
        if linked != 1 {
            return fail(format!("Unknown summary {child_id} in conversation {conversation_id}"));
        }
    }
    c.execute(
        "UPDATE summaries SET consumed = 1 WHERE id IN (SELECT child_id FROM summary_children WHERE summary_id = ?1)",
        [sid],
    )
    .sq()?;
    Ok(summary)
}

pub fn search(c: &Connection, conversation_id: &str, query: &str, limit: Option<i64>) -> napi::Result<Vec<Summary>> {
    if is_blank(query) {
        return Ok(Vec::new());
    }
    let limit = limit.unwrap_or(20).clamp(0, 100);
    let fts = sanitize_fts_query(query);
    match search_fts(c, conversation_id, &fts, limit) {
        Ok(found) => Ok(found),
        Err(_) => search_like(c, conversation_id, query, limit),
    }
}

fn search_fts(c: &Connection, conversation_id: &str, fts: &str, limit: i64) -> napi::Result<Vec<Summary>> {
    query_summaries(
        c,
        &format!(
            "{SUM_SELECT} JOIN summaries_fts ON summaries_fts.rowid = s.id WHERE summaries_fts MATCH ?1 AND cv.uuid = ?2 ORDER BY s.created_at DESC, s.id DESC LIMIT ?3"
        ),
        vec![
            Value::from(fts.to_string()),
            Value::from(conversation_id.to_string()),
            Value::Integer(limit),
        ],
    )
}

fn search_like(c: &Connection, conversation_id: &str, query: &str, limit: i64) -> napi::Result<Vec<Summary>> {
    query_summaries(
        c,
        &format!(
            "{SUM_SELECT} WHERE cv.uuid = ?1 AND s.text LIKE ?2 ESCAPE '\\' ORDER BY s.created_at DESC, s.id DESC LIMIT ?3"
        ),
        vec![
            Value::from(conversation_id.to_string()),
            Value::from(like_pattern(query)),
            Value::Integer(limit),
        ],
    )
}
