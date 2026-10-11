use std::borrow::Cow;

use sha1::{Digest, Sha1};

/// Length in UTF-16 code units, as JavaScript `String.length` counts it.
pub fn utf16_len(s: &str) -> usize {
    s.encode_utf16().count()
}

/// Same as JS `Math.ceil(text.length / 3.5)`.
pub fn estimate_tokens(s: &str) -> i64 {
    let n = utf16_len(s) as i64;
    (2 * n + 6) / 7
}

/// First `units` UTF-16 code units, like JS `s.slice(0, units)`; lone surrogates become U+FFFD.
pub fn utf16_prefix(s: &str, units: usize) -> String {
    if s.len() <= units {
        return s.to_string();
    }
    let kept: Vec<u16> = s.encode_utf16().take(units).collect();
    String::from_utf16_lossy(&kept)
}

/// Text the regex search tests: at most the first 50 000 UTF-16 units.
pub fn capped_text(s: &str) -> Cow<'_, str> {
    if s.len() <= 50_000 {
        Cow::Borrowed(s)
    } else {
        Cow::Owned(utf16_prefix(s, 50_000))
    }
}

/// Dedup key: first 16 hex chars of SHA-1(`role|timestamp|first 200 chars`), as i64.
pub fn dedup_key(role: &str, timestamp: i64, content_text: &str) -> i64 {
    let key = format!("{}|{}|{}", role, timestamp, utf16_prefix(content_text, 200));
    let digest = Sha1::digest(key.as_bytes());
    let mut value: u64 = 0;
    for byte in &digest[..8] {
        value = (value << 8) | u64::from(*byte);
    }
    value as i64
}

/// Parses a legacy 16-char hex dedup hash into the i64 stored in `messages.dedup`.
pub fn hex_dedup(hex: &str) -> Option<i64> {
    u64::from_str_radix(hex, 16).ok().map(|v| v as i64)
}

/// Whitespace as JavaScript `\s` defines it.
pub fn is_js_space(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{0B}' | '\u{0C}' | '\r' | ' ' | '\u{A0}' | '\u{1680}'
            | '\u{2000}'..='\u{200A}'
            | '\u{2028}' | '\u{2029}' | '\u{202F}' | '\u{205F}' | '\u{3000}' | '\u{FEFF}'
    )
}

/// True when `s.trim()` would be empty.
pub fn is_blank(s: &str) -> bool {
    s.chars().all(is_js_space)
}

/// Split on whitespace and quote each token for FTS5 MATCH.
pub fn sanitize_fts_query(query: &str) -> String {
    query
        .split(is_js_space)
        .filter(|t| !t.is_empty())
        .map(|t| format!("\"{}\"", t.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" ")
}

/// LIKE pattern with `\` escaping.
pub fn like_pattern(query: &str) -> String {
    let escaped = query.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
    format!("%{escaped}%")
}
