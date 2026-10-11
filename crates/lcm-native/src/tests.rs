use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection};

use crate::db::LcmDb;
use crate::summaries;
use crate::text::dedup_key;

const CWD: &str = "/work/project";
const T0: &str = "2026-01-01T00:00:00.000Z";

/// Legacy schema of the old TypeScript LCM (V1 plus the V2 dedup_hash column).
const LEGACY_SCHEMA: &str = "
CREATE TABLE _metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE conversations (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL UNIQUE, session_file TEXT, cwd TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  entry_id TEXT, role TEXT NOT NULL, content_text TEXT NOT NULL, content_json TEXT NOT NULL,
  tool_name TEXT, token_estimate INTEGER NOT NULL, timestamp INTEGER NOT NULL, seq INTEGER NOT NULL,
  is_compacted INTEGER DEFAULT 0, dedup_hash TEXT,
  UNIQUE(conversation_id, seq), UNIQUE(conversation_id, dedup_hash)
);
CREATE TABLE summaries (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id),
  depth INTEGER NOT NULL, text TEXT NOT NULL, token_estimate INTEGER NOT NULL,
  metadata_json TEXT, created_at TEXT NOT NULL
);
CREATE TABLE summary_sources (
  summary_id TEXT NOT NULL REFERENCES summaries(id), source_type TEXT NOT NULL,
  source_id TEXT NOT NULL, seq INTEGER NOT NULL,
  PRIMARY KEY (summary_id, source_type, source_id)
);
";

struct Fixture {
    dir: PathBuf,
    legacy: String,
    db: String,
}

fn s(v: &str) -> String {
    v.to_string()
}

/// Dedup hash exactly as the legacy store wrote it: 16 hex chars of SHA-1(role|timestamp|text).
fn legacy_hash(role: &str, ts: i64, text: &str) -> String {
    format!("{:016x}", dedup_key(role, ts, text) as u64)
}

fn legacy_message(conn: &Connection, id: &str, role: &str, text: &str, ts: i64, seq: i64, compacted: i64, dedup: Option<String>) {
    let tokens = ((text.encode_utf16().count() as f64) / 3.5).ceil() as i64;
    conn.execute(
        "INSERT INTO messages (id, conversation_id, entry_id, role, content_text, content_json, tool_name, token_estimate, timestamp, seq, is_compacted, dedup_hash)
         VALUES (?1, 'c1', ?2, ?3, ?4, ?5, NULL, ?6, ?7, ?8, ?9, ?10)",
        params![id, format!("e-{id}"), role, text, format!("{{\"role\":\"{role}\"}}"), tokens, ts, seq, compacted, dedup],
    )
    .unwrap();
}

fn legacy_summary(conn: &Connection, id: &str, depth: i64, text: &str, created: &str, meta: Option<&str>) {
    conn.execute(
        "INSERT INTO summaries (id, conversation_id, depth, text, token_estimate, metadata_json, created_at)
         VALUES (?1, 'c1', ?2, ?3, 1, ?4, ?5)",
        params![id, depth, text, meta, created],
    )
    .unwrap();
}

fn legacy_source(conn: &Connection, summary: &str, kind: &str, source: &str, seq: i64) {
    conn.execute(
        "INSERT INTO summary_sources (summary_id, source_type, source_id, seq) VALUES (?1, ?2, ?3, ?4)",
        params![summary, kind, source, seq],
    )
    .unwrap();
}

/// Legacy DB: one conversation, five messages (m1-m4 summarized, m5 open with NULL dedup_hash),
/// two depth-0 summaries (sd0a, sd0b) and one depth-1 summary (sd1) over them.
fn fixture(name: &str) -> Fixture {
    let dir = std::env::temp_dir().join(format!("lcm-native-{name}-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&dir).unwrap();
    let legacy = dir.join("legacy.db").to_string_lossy().into_owned();
    let db = dir.join("lcm").join("new.db").to_string_lossy().into_owned();

    let conn = Connection::open(&legacy).unwrap();
    conn.execute_batch(LEGACY_SCHEMA).unwrap();
    conn.execute("INSERT INTO _metadata (key, value) VALUES ('cwd', ?1)", [CWD]).unwrap();
    conn.execute(
        "INSERT INTO conversations (id, session_id, session_file, cwd, created_at, updated_at) VALUES ('c1', 'sess-1', '/tmp/old.jsonl', ?1, ?2, ?2)",
        params![CWD, T0],
    )
    .unwrap();
    legacy_message(&conn, "m1", "user", "alpha beta", 1000, 0, 1, Some(legacy_hash("user", 1000, "alpha beta")));
    legacy_message(&conn, "m2", "assistant", "delta epsilon", 2000, 1, 1, Some(legacy_hash("assistant", 2000, "delta epsilon")));
    legacy_message(&conn, "m3", "user", "gamma 3 zeta", 3000, 2, 1, Some(legacy_hash("user", 3000, "gamma 3 zeta")));
    legacy_message(&conn, "m4", "assistant", "eta theta", 4000, 3, 1, Some(legacy_hash("assistant", 4000, "eta theta")));
    legacy_message(&conn, "m5", "user", "iota kappa", 5000, 4, 0, None);
    legacy_summary(&conn, "sd0a", 0, "Recent A", "2026-01-01T00:00:01.000Z", None);
    legacy_summary(&conn, "sd0b", 0, "Recent B", "2026-01-01T00:00:02.000Z", None);
    legacy_summary(&conn, "sd1", 1, "Overall summary of the first half", "2026-01-01T00:00:03.000Z", Some("{\"kind\":\"condensed\"}"));
    legacy_source(&conn, "sd0a", "message", "m1", 0);
    legacy_source(&conn, "sd0a", "message", "m2", 1);
    legacy_source(&conn, "sd0b", "message", "m3", 0);
    legacy_source(&conn, "sd0b", "message", "m4", 1);
    legacy_source(&conn, "sd1", "summary", "sd0a", 0);
    legacy_source(&conn, "sd1", "summary", "sd0b", 1);
    drop(conn);

    Fixture { dir, legacy, db }
}

fn open(f: &Fixture) -> LcmDb {
    LcmDb::open(f.db.clone(), s(CWD), Some(f.legacy.clone())).unwrap()
}

fn strings(conn: &Connection, sql: &str) -> Vec<String> {
    let mut stmt = conn.prepare(sql).unwrap();
    let rows = stmt.query_map([], |r| r.get::<_, String>(0)).unwrap();
    rows.map(|r| r.unwrap()).collect()
}

fn pairs(conn: &Connection, sql: &str) -> Vec<(String, i64)> {
    let mut stmt = conn.prepare(sql).unwrap();
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))).unwrap();
    rows.map(|r| r.unwrap()).collect()
}

fn owned(v: &[(&str, &str)]) -> Vec<(String, String)> {
    v.iter().map(|(a, b)| (s(a), s(b))).collect()
}

#[test]
fn migration_keeps_ids_flags_sources_and_counts() {
    let f = fixture("lossless");
    let db = open(&f);
    let report = db.last_migration().unwrap();
    assert_eq!(
        (report.conversations, report.messages, report.summaries, report.sources),
        (1, 5, 3, 6)
    );
    drop(db);

    let conn = Connection::open(&f.db).unwrap();
    assert_eq!(strings(&conn, "SELECT uuid FROM messages ORDER BY seq"), vec!["m1", "m2", "m3", "m4", "m5"]);
    assert_eq!(
        pairs(&conn, "SELECT uuid, consumed FROM summaries ORDER BY uuid"),
        vec![(s("sd0a"), 1), (s("sd0b"), 1), (s("sd1"), 0)]
    );
    assert_eq!(
        strings(&conn, "SELECT meta FROM summaries WHERE uuid = 'sd1'"),
        vec!["{\"kind\":\"condensed\"}"]
    );

    let children = summaries::sources(&conn, "sd1").unwrap();
    let children: Vec<(String, String)> = children.into_iter().map(|r| (r.source_type, r.source_id)).collect();
    assert_eq!(children, owned(&[("summary", "sd0a"), ("summary", "sd0b")]));
    let messages = summaries::sources(&conn, "sd0a").unwrap();
    let messages: Vec<(String, String)> = messages.into_iter().map(|r| (r.source_type, r.source_id)).collect();
    assert_eq!(messages, owned(&[("message", "m1"), ("message", "m2")]));

    assert_eq!(
        strings(&conn, "SELECT key || '=' || value FROM meta ORDER BY key"),
        vec![
            s("cwd=/work/project"),
            format!("migrated_from={}", f.legacy),
            s("schema_version=1"),
        ]
    );
    assert!(!Path::new(&format!("{}.tmp", f.db)).exists());

    // The legacy file is still untouched: m5 still has its NULL dedup_hash.
    let legacy = Connection::open(&f.legacy).unwrap();
    assert_eq!(strings(&legacy, "SELECT id FROM messages WHERE dedup_hash IS NULL"), vec!["m5"]);
    let _ = fs::remove_dir_all(&f.dir);
}

#[test]
fn reopen_does_not_migrate_again_and_conversation_is_kept() {
    let f = fixture("reopen");
    let first = open(&f);
    assert!(first.last_migration().is_some());
    drop(first);

    let mut db = open(&f);
    assert!(db.last_migration().is_none());
    let conv = db
        .get_or_create_conversation(s("sess-1"), None, s(CWD))
        .unwrap();
    assert_eq!(conv.id, "c1");
    assert_eq!(conv.session_file.as_deref(), Some("/tmp/old.jsonl"));
    assert_eq!(conv.created_at, T0);
    drop(db);
    let _ = fs::remove_dir_all(&f.dir);
}

#[test]
fn fts_and_regex_search_find_migrated_messages_with_summary_info() {
    let f = fixture("search");
    let db = open(&f);

    let hits = db.search_messages(s("c1"), s("alpha"), None, None, None).unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].id, "m1");
    assert_eq!(hits[0].summary_id.as_deref(), Some("sd0a"));
    assert_eq!(hits[0].summary_depth, Some(0));

    let case_insensitive = db.search_messages(s("c1"), s("EPSILON"), None, None, None).unwrap();
    assert_eq!(case_insensitive.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(), vec!["m2"]);

    let regex = db.search_messages_regex(s("c1"), s(r"GAMMA\s\d"), None, None).unwrap().results;
    assert_eq!(regex.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(), vec!["m3"]);
    assert_eq!(regex[0].summary_id.as_deref(), Some("sd0b"));

    match db.search_messages_regex(s("c1"), s("("), None, None) {
        Ok(_) => panic!("invalid pattern must fail"),
        Err(e) => assert!(e.reason.starts_with("Invalid regex pattern \"(\""), "reason: {}", e.reason),
    }
    drop(db);
    let _ = fs::remove_dir_all(&f.dir);
}

#[test]
fn append_dedups_against_migrated_hashes_and_assigns_next_seq() {
    let f = fixture("append");
    let mut db = open(&f);

    // Same role|timestamp|text as legacy m1 (stored hash) and m5 (computed during migration).
    assert!(db
        .append_message(s("c1"), None, s("user"), None, 1000, s("alpha beta"), s("{}"))
        .unwrap()
        .is_none());
    assert!(db
        .append_message(s("c1"), None, s("user"), None, 5000, s("iota kappa"), s("{}"))
        .unwrap()
        .is_none());

    let added = db
        .append_message(s("c1"), Some(s("e9")), s("user"), None, 6000, s("new message here"), s("{}"))
        .unwrap()
        .unwrap();
    assert_eq!(added.seq, 5);
    assert_eq!(added.token_estimate, 5);
    assert_eq!(added.is_compacted, 0);
    assert_eq!(db.get_message_count(s("c1")).unwrap(), 6);
    assert_eq!(db.get_uncompacted_tokens(s("c1")).unwrap(), 3 + 5);
    drop(db);
    let _ = fs::remove_dir_all(&f.dir);
}

#[test]
fn leaf_and_condensed_summaries_mark_their_sources() {
    let f = fixture("leaf");
    let mut db = open(&f);

    let leaf = db
        .create_leaf_summary(s("c1"), s("Leaf over iota"), vec![s("m5")], None)
        .unwrap();
    assert_eq!(leaf.depth, 0);
    assert!(db.get_uncompacted_messages(s("c1")).unwrap().is_empty());
    assert_eq!(db.get_uncompacted_tokens(s("c1")).unwrap(), 0);

    let leaf_sources = db.get_summary_sources(leaf.id.clone()).unwrap();
    assert_eq!(leaf_sources.len(), 1);
    assert_eq!(leaf_sources[0].source_type, "message");
    assert_eq!(leaf_sources[0].source_id, "m5");

    let open_d0 = db.get_unconsumed_summaries_by_depth(s("c1"), 0).unwrap();
    assert_eq!(open_d0.iter().map(|x| x.id.as_str()).collect::<Vec<_>>(), vec![leaf.id.as_str()]);

    let condensed = db
        .create_condensed_summary(s("c1"), 1, s("Second level"), vec![leaf.id.clone()], None)
        .unwrap();
    assert_eq!(condensed.depth, 1);
    assert!(db.get_unconsumed_summaries_by_depth(s("c1"), 0).unwrap().is_empty());
    assert_eq!(db.get_max_depth(s("c1")).unwrap(), 1);

    let lineage = db.get_summary_lineage(s("sd0a")).unwrap();
    assert_eq!(lineage.iter().map(|x| x.id.as_str()).collect::<Vec<_>>(), vec!["sd1"]);

    let stats = db.get_stats(s("c1")).unwrap();
    assert_eq!((stats.messages, stats.summaries, stats.max_depth), (5, 5, 1));
    drop(db);
    let _ = fs::remove_dir_all(&f.dir);
}

#[test]
fn assemble_summary_matches_fixed_fixture() {
    let f = fixture("assemble");
    let db = open(&f);
    let text = db.assemble_summary(s("c1"), 10000.0).unwrap();
    let expected = "## Conversation History (Lossless Context Management)\n5 messages stored | 3 summaries | DAG depth 1\n\n### High-Level Summary\n#### D1\nOverall summary of the first half\n\n### Summary IDs for Drill-Down\n- sd1 (D1): \"Overall summary of the first half...\"\n- sd0b (D0): \"Recent B...\"\n- sd0a (D0): \"Recent A...\"";
    assert_eq!(text, expected);
    drop(db);
    let _ = fs::remove_dir_all(&f.dir);
}
