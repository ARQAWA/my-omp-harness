use std::path::Path;

use napi_derive::napi;
use rusqlite::{Connection, OptionalExtension};

use crate::assemble;
use crate::messages;
use crate::migrate;
use crate::schema;
use crate::summaries;
use crate::types::{Conversation, LcmStats, MigrationReport, RegexSearch, SearchResult, SourceRef, StoredMessage, Summary};
use crate::{io_err, Sql};

#[napi]
pub struct LcmDb {
    conn: Option<Connection>,
    last: Option<MigrationReport>,
}

impl LcmDb {
    fn conn(&self) -> napi::Result<&Connection> {
        self.conn
            .as_ref()
            .ok_or_else(|| napi::Error::from_reason("LcmDb is closed"))
    }

    fn conn_mut(&mut self) -> napi::Result<&mut Connection> {
        self.conn
            .as_mut()
            .ok_or_else(|| napi::Error::from_reason("LcmDb is closed"))
    }
}

#[napi]
impl LcmDb {
    #[napi(factory)]
    pub fn open(db_path: String, cwd: String, legacy_path: Option<String>) -> napi::Result<LcmDb> {
        let path = Path::new(&db_path);
        if let Some(dir) = path.parent() {
            schema::make_private_dir(dir).map_err(io_err)?;
        }
        let mut last = None;
        if !path.exists() {
            if let Some(legacy) = legacy_path.as_deref() {
                if Path::new(legacy).exists() {
                    last = Some(migrate::migrate_legacy(legacy.to_string(), db_path.clone())?);
                }
            }
        }
        schema::make_private_file(path).map_err(io_err)?;
        let conn = Connection::open(path).sq()?;
        schema::configure(&conn)?;
        schema::create_tables(&conn)?;
        schema::create_triggers(&conn)?;
        conn.execute("INSERT OR IGNORE INTO meta (key, value) VALUES ('cwd', ?1)", [cwd]).sq()?;
        Ok(LcmDb {
            conn: Some(conn),
            last,
        })
    }

    #[napi]
    pub fn last_migration(&self) -> Option<MigrationReport> {
        self.last
    }

    #[napi]
    pub fn get_or_create_conversation(
        &mut self,
        session_id: String,
        session_file: Option<String>,
        cwd: String,
    ) -> napi::Result<Conversation> {
        let tx = self.conn_mut()?.transaction().sq()?;
        let conv = messages::get_or_create_conversation(&tx, &session_id, session_file, &cwd)?;
        tx.commit().sq()?;
        Ok(conv)
    }

    #[napi]
    pub fn append_message(
        &mut self,
        conversation_id: String,
        entry_id: Option<String>,
        role: String,
        tool_name: Option<String>,
        timestamp: i64,
        content_text: String,
        content_json: String,
    ) -> napi::Result<Option<StoredMessage>> {
        messages::append_message(
            self.conn()?,
            &conversation_id,
            entry_id,
            &role,
            tool_name,
            timestamp,
            &content_text,
            &content_json,
        )
    }

    #[napi]
    pub fn get_messages_by_ids(&self, ids: Vec<String>) -> napi::Result<Vec<StoredMessage>> {
        messages::messages_by_ids(self.conn()?, &ids)
    }

    #[napi]
    pub fn get_uncompacted_messages(&self, conversation_id: String) -> napi::Result<Vec<StoredMessage>> {
        messages::uncompacted_messages(self.conn()?, &conversation_id)
    }

    #[napi]
    pub fn get_uncompacted_tokens(&self, conversation_id: String) -> napi::Result<i64> {
        messages::uncompacted_tokens(self.conn()?, &conversation_id)
    }

    #[napi]
    pub fn get_message_count(&self, conversation_id: String) -> napi::Result<i64> {
        messages::message_count(self.conn()?, &conversation_id)
    }

    #[napi]
    pub fn search_messages(
        &self,
        conversation_id: String,
        query: String,
        limit: Option<i64>,
        after: Option<i64>,
        before: Option<i64>,
    ) -> napi::Result<Vec<SearchResult>> {
        messages::search_messages(self.conn()?, &conversation_id, &query, limit, after, before)
    }

    #[napi]
    pub fn search_messages_regex(
        &self,
        conversation_id: String,
        pattern: String,
        limit: Option<i64>,
        timeout_ms: Option<i64>,
    ) -> napi::Result<RegexSearch> {
        messages::search_regex(self.conn()?, &conversation_id, &pattern, limit, timeout_ms)
    }

    #[napi]
    pub fn search_summaries(
        &self,
        conversation_id: String,
        query: String,
        limit: Option<i64>,
    ) -> napi::Result<Vec<Summary>> {
        summaries::search(self.conn()?, &conversation_id, &query, limit)
    }

    #[napi]
    pub fn create_leaf_summary(
        &mut self,
        conversation_id: String,
        text: String,
        message_ids: Vec<String>,
        metadata_json: Option<String>,
    ) -> napi::Result<Summary> {
        let tx = self.conn_mut()?.transaction().sq()?;
        let summary = summaries::create_leaf(&tx, &conversation_id, &text, &message_ids, metadata_json)?;
        tx.commit().sq()?;
        Ok(summary)
    }

    #[napi]
    pub fn create_condensed_summary(
        &mut self,
        conversation_id: String,
        depth: i64,
        text: String,
        child_summary_ids: Vec<String>,
        metadata_json: Option<String>,
    ) -> napi::Result<Summary> {
        let tx = self.conn_mut()?.transaction().sq()?;
        let summary =
            summaries::create_condensed(&tx, &conversation_id, depth, &text, &child_summary_ids, metadata_json)?;
        tx.commit().sq()?;
        Ok(summary)
    }

    #[napi]
    pub fn get_summary(&self, id: String) -> napi::Result<Option<Summary>> {
        summaries::get_summary(self.conn()?, &id)
    }

    #[napi]
    pub fn get_summary_sources(&self, summary_id: String) -> napi::Result<Vec<SourceRef>> {
        summaries::sources(self.conn()?, &summary_id)
    }

    #[napi]
    pub fn get_summary_lineage(&self, summary_id: String) -> napi::Result<Vec<Summary>> {
        summaries::lineage(self.conn()?, &summary_id)
    }

    #[napi]
    pub fn get_summaries_by_depth(&self, conversation_id: String, depth: i64) -> napi::Result<Vec<Summary>> {
        summaries::by_depth(self.conn()?, &conversation_id, depth)
    }

    #[napi]
    pub fn get_unconsumed_summaries_by_depth(
        &self,
        conversation_id: String,
        depth: i64,
    ) -> napi::Result<Vec<Summary>> {
        summaries::unconsumed_by_depth(self.conn()?, &conversation_id, depth)
    }

    #[napi]
    pub fn get_max_depth(&self, conversation_id: String) -> napi::Result<i64> {
        summaries::max_depth(self.conn()?, &conversation_id)
    }

    #[napi]
    pub fn get_all_summaries(&self, conversation_id: String, limit: Option<i64>) -> napi::Result<Vec<Summary>> {
        summaries::all(self.conn()?, &conversation_id, limit)
    }

    #[napi]
    pub fn get_latest_summary_per_depth(&self, conversation_id: String) -> napi::Result<Vec<Summary>> {
        summaries::latest_per_depth(self.conn()?, &conversation_id)
    }

    #[napi]
    pub fn get_stats(&self, conversation_id: String) -> napi::Result<LcmStats> {
        summaries::stats(self.conn()?, &conversation_id)
    }

    #[napi]
    pub fn assemble_summary(&self, conversation_id: String, max_tokens: f64) -> napi::Result<String> {
        assemble::assemble(self.conn()?, &conversation_id, max_tokens)
    }

    #[napi]
    pub fn checkpoint(&self) -> napi::Result<()> {
        self.conn()?
            .query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(()))
            .optional()
            .sq()
            .map(|_| ())
    }

    #[napi]
    pub fn close(&mut self) -> napi::Result<()> {
        if let Some(conn) = self.conn.take() {
            conn.close().map_err(|(_, e)| napi::Error::from_reason(e.to_string()))?;
        }
        Ok(())
    }
}
