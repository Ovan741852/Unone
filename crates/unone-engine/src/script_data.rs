//! Finds data embedded in Luau scripts as large string literals.
//!
//! Bytes, tables or pixels pasted into a script make it slow to load, impossible
//! to trace to their source and easy to get subtly wrong when regenerated. Data
//! belongs in assets: a `data` asset read with `api.assets.load`, brought in
//! with `import.from` or a project importer when it comes from elsewhere. The
//! entry check reports such literals so authors are steered to that pattern.
use crate::diagnostics::{ActionSuggestion, Diagnostic};
use std::path::Path;

/// Literals at least this many decoded bytes long are data, not text.
pub const EMBEDDED_DATA_BYTES: usize = 4096;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EmbeddedLiteral {
    pub line: usize,
    pub bytes: usize,
}

/// `[[`, `[=[`, ...: the level of a long bracket opening at `i`, if any.
fn long_bracket(src: &[u8], i: usize) -> Option<usize> {
    if src.get(i) != Some(&b'[') { return None; }
    let level = src[i + 1..].iter().take_while(|&&c| c == b'=').count();
    (src.get(i + 1 + level) == Some(&b'[')).then_some(level)
}

/// Index just past the closing `]=*]` of a long bracket whose body starts at `i`.
fn long_bracket_end(src: &[u8], mut i: usize, level: usize) -> usize {
    while i < src.len() {
        if src[i] == b']' && src[i + 1..].iter().take(level).all(|&c| c == b'=')
            && src.get(i + 1 + level) == Some(&b']') { return i + 2 + level; }
        i += 1;
    }
    src.len()
}

/// String literals of at least `min_bytes` decoded bytes, in source order.
pub fn embedded_literals(source: &str, min_bytes: usize) -> Vec<EmbeddedLiteral> {
    let src = source.as_bytes();
    let mut found = Vec::new();
    let (mut i, mut line) = (0, 1);
    let count_lines = |from: usize, to: usize| src[from..to].iter().filter(|&&c| c == b'\n').count();
    while i < src.len() {
        match src[i] {
            b'\n' => { line += 1; i += 1; }
            b'-' if src.get(i + 1) == Some(&b'-') => {
                let start = i;
                i += 2;
                if let Some(level) = long_bracket(src, i) {
                    i = long_bracket_end(src, i + level + 2, level);
                } else {
                    while i < src.len() && src[i] != b'\n' { i += 1; }
                }
                line += count_lines(start, i);
            }
            b'[' if long_bracket(src, i).is_some() => {
                let level = long_bracket(src, i).expect("checked");
                let (start, body) = (i, i + level + 2);
                i = long_bracket_end(src, body, level);
                let bytes = i.saturating_sub(level + 2).saturating_sub(body);
                if bytes >= min_bytes { found.push(EmbeddedLiteral { line, bytes }); }
                line += count_lines(start, i);
            }
            quote @ (b'"' | b'\'' | b'`') => {
                let (start, mut bytes) = (i, 0);
                i += 1;
                while i < src.len() && src[i] != quote {
                    if src[i] == b'\\' {
                        i += 1;
                        match src.get(i) {
                            Some(c) if c.is_ascii_digit() => { let digits = src[i..].iter().take(3).take_while(|c| c.is_ascii_digit()).count(); i += digits; }
                            Some(b'x') => i += 3,
                            Some(b'z') => { i += 1; while i < src.len() && src[i].is_ascii_whitespace() { i += 1; } continue }
                            Some(b'u') => { while i < src.len() && src[i] != b'}' { i += 1; } i += 1; }
                            _ => i += 1,
                        }
                    } else if src[i] == b'\n' && quote != b'`' {
                        break; // unterminated; the parser reports it
                    } else {
                        i += 1;
                    }
                    bytes += 1;
                }
                i += 1;
                if bytes >= min_bytes { found.push(EmbeddedLiteral { line, bytes }); }
                line += count_lines(start, i.min(src.len()));
            }
            _ => i += 1,
        }
    }
    found
}

/// One error per script file that embeds data, naming the literals.
pub fn embedded_data_diagnostic(path: &Path, source: &str) -> Option<Diagnostic> {
    let literals = embedded_literals(source, EMBEDDED_DATA_BYTES);
    let largest = *literals.iter().max_by_key(|l| l.bytes)?;
    let total: usize = literals.iter().map(|l| l.bytes).sum();
    let mut diagnostic = Diagnostic::error(
        "SCRIPT_EMBEDDED_DATA",
        "Script embeds data in string literals",
        format!(
            "{} has {} string literal(s) of {} bytes or more ({} bytes in all; the largest, {} bytes, at line {}). \
             Data belongs in assets: declare a `data` asset (decoder bytes, text or json) and read it with api.assets.load; \
             bring files from another installation in with import.from or a project importer (docs/import-pipeline.md).",
            path.display(), literals.len(), EMBEDDED_DATA_BYTES, total, largest.bytes, largest.line
        ),
    );
    diagnostic.facts = serde_json::json!({
        "file": path.display().to_string(),
        "threshold_bytes": EMBEDDED_DATA_BYTES,
        "count": literals.len(),
        "total_bytes": total,
        "literals": literals.iter().take(20).map(|l| serde_json::json!({"line": l.line, "bytes": l.bytes})).collect::<Vec<_>>(),
    });
    diagnostic.suggested_actions = vec![ActionSuggestion {
        action: "move_data_to_asset".to_string(),
        description: "Declare the bytes as a data asset (with import.from when they are a file of an original installation) and load it in start".to_string(),
        command: Some("game asset init --id data://<name> --source <project-relative-file> --kind data".to_string()),
    }];
    Some(diagnostic)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_large_literals_and_counts_escapes_as_bytes() {
        let blob = "\\000".repeat(5000);
        let source = format!("--!strict\n-- a \"quoted\" comment\nlocal small = \"text\"\nlocal raw = buffer.fromstring(\"{blob}\")\n--[[ {} ]]\nlocal long = [==[{}]==]\nreturn {{}}\n",
            "x".repeat(9000), "y".repeat(4096));
        let found = embedded_literals(&source, EMBEDDED_DATA_BYTES);
        assert_eq!(found, [EmbeddedLiteral { line: 4, bytes: 5000 }, EmbeddedLiteral { line: 6, bytes: 4096 }],
            "escapes decode to one byte each; comments are not literals");
        let sizes: Vec<usize> = embedded_literals("local s = 'a\\'b' .. `x{1}y`", 1).iter().map(|l| l.bytes).collect();
        assert_eq!(sizes, [3, 5], "an escaped quote does not end the string");
        let diagnostic = embedded_data_diagnostic(Path::new("main.luau"), &source).unwrap();
        assert_eq!((diagnostic.code.as_str(), diagnostic.facts["count"].as_u64()), ("SCRIPT_EMBEDDED_DATA", Some(2)));
        assert!(embedded_data_diagnostic(Path::new("main.luau"), "return {}").is_none());
    }
}
