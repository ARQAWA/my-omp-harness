use std::collections::HashSet;

use rusqlite::Connection;

use crate::summaries;
use crate::text::{estimate_tokens, utf16_prefix};
use crate::types::Summary;

/// Notice for the `k` summaries that the budget left out.
fn omitted_notice(k: usize) -> String {
    format!("{k} older summaries are not shown here for budget; find them with lcm_grep (scope summaries) or lcm_describe, and open them with lcm_expand.")
}

/// Notice for the `m` summary IDs that the drill-down list does not show.
fn ids_notice(m: usize) -> String {
    format!("{m} more summary IDs are not listed; lcm_describe lists them.")
}

/// Builds the compaction summary text from stored summaries.
pub fn assemble(c: &Connection, conversation_id: &str, max_tokens: f64) -> napi::Result<String> {
    let stats = summaries::stats(c, conversation_id)?;
    let latest = summaries::latest_per_depth(c, conversation_id)?;

    if latest.is_empty() {
        return Ok(format!(
            "## Conversation History (Lossless Context Management)\n{} messages stored | 0 summaries\n\nNo summaries generated yet.",
            stats.messages
        ));
    }

    let mut parts: Vec<String> = vec![
        "## Conversation History (Lossless Context Management)".to_string(),
        format!(
            "{} messages stored | {} summaries | DAG depth {}",
            stats.messages, stats.summaries, stats.max_depth
        ),
        String::new(),
    ];

    let mut tokens_used = estimate_tokens(&parts.join("\n")) as f64;

    // Deepest levels first, then D0; each level chronological.
    let mut ordered: Vec<Summary> = Vec::new();
    let mut depth = stats.max_depth;
    while depth >= 1 {
        ordered.extend(summaries::unconsumed_by_depth(c, conversation_id, depth)?);
        depth -= 1;
    }
    ordered.extend(summaries::unconsumed_by_depth(c, conversation_id, 0)?);

    // Budget selection fills newest-created first across all levels.
    let mut by_recency = ordered.clone();
    by_recency.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    // When not everything fits, hold back room for the omission notice so the output stays within max_tokens.
    let all_needed: f64 = by_recency.iter().map(|s| estimate_tokens(&s.text) as f64 + 20.0).sum();
    let limit = if tokens_used + all_needed <= max_tokens {
        max_tokens
    } else {
        max_tokens - estimate_tokens(&omitted_notice(ordered.len())) as f64
    };
    let mut chosen: HashSet<String> = HashSet::new();
    for s in &by_recency {
        let needed = estimate_tokens(&s.text) as f64 + 20.0;
        if tokens_used + needed > limit {
            break;
        }
        chosen.insert(s.id.clone());
        tokens_used += needed;
    }
    let selected: Vec<&Summary> = ordered.iter().filter(|s| chosen.contains(&s.id)).collect();

    let high: Vec<&Summary> = selected.iter().copied().filter(|s| s.depth >= 1).collect();
    if !high.is_empty() {
        parts.push("### High-Level Summary".to_string());
        for s in &high {
            parts.push(format!("#### D{}", s.depth));
            parts.push(s.text.clone());
            parts.push(String::new());
        }
    }

    let recent: Vec<&Summary> = selected.iter().copied().filter(|s| s.depth == 0).collect();
    if !recent.is_empty() {
        parts.push("### Recent Activity".to_string());
        for s in &recent {
            parts.push("#### D0".to_string());
            parts.push(s.text.clone());
            parts.push(String::new());
        }
    }

    let omitted = ordered.len() - chosen.len();
    if omitted > 0 {
        let notice = omitted_notice(omitted);
        tokens_used += estimate_tokens(&notice) as f64;
        parts.push(notice);
        parts.push(String::new());
    }

    let all = summaries::all(c, conversation_id, Some(100))?;
    if !all.is_empty() {
        parts.push("### Summary IDs for Drill-Down".to_string());
        // Room for the notice that counts the IDs left out, so the list stays within max_tokens.
        let ids_reserve = estimate_tokens(&ids_notice(stats.summaries.max(0) as usize)) as f64;
        let id_budget = max_tokens - tokens_used - 50.0 - ids_reserve;
        let mut id_tokens = 0.0_f64;
        let mut listed = 0usize;
        for s in &all {
            let preview = utf16_prefix(&s.text, 60).replace('\n', " ");
            let line = format!("- {} (D{}): \"{}...\"", s.id, s.depth, preview);
            let line_tokens = estimate_tokens(&line) as f64;
            if id_tokens + line_tokens > id_budget {
                break;
            }
            parts.push(line);
            id_tokens += line_tokens;
            listed += 1;
        }
        let hidden = (stats.summaries.max(0) as usize).saturating_sub(listed);
        if hidden > 0 {
            parts.push(ids_notice(hidden));
        }
    }

    Ok(parts.join("\n"))
}
