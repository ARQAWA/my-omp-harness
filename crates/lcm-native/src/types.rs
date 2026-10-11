use napi_derive::napi;

#[napi(object)]
#[derive(Clone, Debug)]
pub struct Conversation {
    pub id: String,
    #[napi(js_name = "session_id")]
    pub session_id: String,
    #[napi(js_name = "session_file")]
    pub session_file: Option<String>,
    pub cwd: String,
    #[napi(js_name = "created_at")]
    pub created_at: String,
    #[napi(js_name = "updated_at")]
    pub updated_at: String,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct StoredMessage {
    pub id: String,
    #[napi(js_name = "conversation_id")]
    pub conversation_id: String,
    #[napi(js_name = "entry_id")]
    pub entry_id: Option<String>,
    pub role: String,
    #[napi(js_name = "content_text")]
    pub content_text: String,
    #[napi(js_name = "content_json")]
    pub content_json: String,
    #[napi(js_name = "tool_name")]
    pub tool_name: Option<String>,
    #[napi(js_name = "token_estimate")]
    pub token_estimate: i64,
    pub timestamp: i64,
    pub seq: i64,
    #[napi(js_name = "is_compacted")]
    pub is_compacted: i64,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct Summary {
    pub id: String,
    #[napi(js_name = "conversation_id")]
    pub conversation_id: String,
    pub depth: i64,
    pub text: String,
    #[napi(js_name = "token_estimate")]
    pub token_estimate: i64,
    #[napi(js_name = "metadata_json")]
    pub metadata_json: Option<String>,
    #[napi(js_name = "created_at")]
    pub created_at: String,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct SourceRef {
    #[napi(js_name = "source_type")]
    pub source_type: String,
    #[napi(js_name = "source_id")]
    pub source_id: String,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct SearchResult {
    pub id: String,
    pub role: String,
    #[napi(js_name = "content_text")]
    pub content_text: String,
    pub timestamp: i64,
    pub seq: i64,
    pub snippet: Option<String>,
    #[napi(js_name = "summary_id")]
    pub summary_id: Option<String>,
    #[napi(js_name = "summary_depth")]
    pub summary_depth: Option<i64>,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct RegexSearch {
    pub results: Vec<SearchResult>,
    #[napi(js_name = "timed_out")]
    pub timed_out: bool,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct LcmStats {
    pub messages: i64,
    pub summaries: i64,
    #[napi(js_name = "maxDepth")]
    pub max_depth: i64,
    #[napi(js_name = "dbSizeBytes")]
    pub db_size_bytes: i64,
}

#[napi(object)]
#[derive(Clone, Copy, Debug)]
pub struct MigrationReport {
    pub conversations: i64,
    pub messages: i64,
    pub summaries: i64,
    pub sources: i64,
}
