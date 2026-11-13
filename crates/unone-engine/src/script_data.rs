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

/// One string literal: where it opens and ends, its first line, its decoded
/// length, and its text when that is the source as written (no escapes, no
/// interpolation).
pub(crate) struct Literal<'a> {
    pub start: usize,
    pub end: usize,
    pub line: usize,
    pub bytes: usize,
    pub text: Option<&'a str>,
}

/// String literals of at least `min_bytes` decoded bytes, in source order.
pub fn embedded_literals(source: &str, min_bytes: usize) -> Vec<EmbeddedLiteral> {
    let mut found = Vec::new();
    for_each_literal(source, |literal| {
        if literal.bytes >= min_bytes { found.push(EmbeddedLiteral { line: literal.line, bytes: literal.bytes }); }
    });
    found
}

/// Visits every string literal in source order; comments are not literals.
pub(crate) fn for_each_literal<'a>(source: &'a str, mut visit: impl FnMut(Literal<'a>)) {
    let src = source.as_bytes();
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
                visit(Literal { start, end: i, line, bytes, text: None });
                line += count_lines(start, i);
            }
            quote @ (b'"' | b'\'' | b'`') => {
                let (start, mut bytes, mut plain) = (i, 0, true);
                i += 1;
                while i < src.len() && src[i] != quote {
                    if src[i] == b'\\' {
                        plain = false;
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
                let closed = src.get(i) == Some(&quote);
                let text = (plain && closed).then(|| &source[start + 1..i])
                    .filter(|text| quote != b'`' || !text.contains('{'));
                i += 1;
                visit(Literal { start, end: i.min(src.len()), line, bytes, text });
                line += count_lines(start, i.min(src.len()));
            }
            _ => i += 1,
        }
    }
}

/// The decoded text of every string literal in a Luau source, with the line
/// it starts on, in source order. Escapes are resolved, a long bracket drops
/// the newline right after its opening, and an interpolated string gives its
/// literal parts plus the literals inside its `{...}` expressions. Comments
/// are not literals. Bytes that do not form UTF-8 (binary escapes such as
/// `"\255"`) are left out: they cannot be displayed text.
pub fn string_literal_texts(source: &str) -> Vec<(usize, String)> {
    let mut texts = Vec::new();
    collect_literal_texts(source, 0, &mut texts);
    texts
}

fn collect_literal_texts(source: &str, line_offset: usize, out: &mut Vec<(usize, String)>) {
    for_each_literal(source, |literal| {
        let line = line_offset + literal.line;
        if let Some(text) = literal.text {
            out.push((line, text.to_owned()));
            return;
        }
        let raw = &source[literal.start..literal.end];
        let bytes = raw.as_bytes();
        if bytes[0] == b'[' {
            let level = bytes[1..].iter().take_while(|&&c| c == b'=').count();
            let close = format!("]{}]", "=".repeat(level));
            let open = level + 2;
            let end = if raw.len() >= open + close.len() && raw.ends_with(&close) { raw.len() - close.len() } else { raw.len() };
            let mut body = &raw[open.min(end)..end];
            body = body.strip_prefix("\r\n").or_else(|| body.strip_prefix('\n')).or_else(|| body.strip_prefix('\r')).unwrap_or(body);
            out.push((line, body.to_owned()));
            return;
        }
        let quote = bytes[0];
        let end = if raw.len() >= 2 && bytes[raw.len() - 1] == quote { raw.len() - 1 } else { raw.len() };
        let body = &raw[1..end];
        let text = decode_quoted(body, quote == b'`', |offset, expression| {
            let expression_line = line + body[..offset].matches('\n').count();
            collect_literal_texts(expression, expression_line - 1, out);
        });
        out.push((line, text));
    });
}

/// Resolves the escapes of a quoted literal's body. In an interpolated string
/// each `{expression}` is handed to `expression` (with its byte offset in the
/// body) instead of becoming text.
fn decode_quoted(body: &str, interpolated: bool, mut expression: impl FnMut(usize, &str)) -> String {
    let src = body.as_bytes();
    let mut decoded = Vec::with_capacity(src.len());
    let mut i = 0;
    while i < src.len() {
        match src[i] {
            b'\\' => {
                i += 1;
                let Some(&c) = src.get(i) else { break };
                match c {
                    b'a' => { decoded.push(7); i += 1; }
                    b'b' => { decoded.push(8); i += 1; }
                    b'f' => { decoded.push(12); i += 1; }
                    b'n' => { decoded.push(b'\n'); i += 1; }
                    b'r' => { decoded.push(b'\r'); i += 1; }
                    b't' => { decoded.push(b'\t'); i += 1; }
                    b'v' => { decoded.push(11); i += 1; }
                    b'z' => { i += 1; while i < src.len() && src[i].is_ascii_whitespace() { i += 1; } }
                    b'x' => {
                        let hex = body.get(i + 1..i + 3).and_then(|h| u8::from_str_radix(h, 16).ok());
                        if let Some(byte) = hex { decoded.push(byte); i += 3; } else { i += 1; }
                    }
                    b'u' if src.get(i + 1) == Some(&b'{') => {
                        let close = src[i..].iter().position(|&c| c == b'}').map(|p| i + p);
                        let value = close.and_then(|close| u32::from_str_radix(&body[i + 2..close], 16).ok()).and_then(char::from_u32);
                        if let Some(ch) = value { decoded.extend_from_slice(ch.encode_utf8(&mut [0; 4]).as_bytes()); }
                        i = close.map_or(src.len(), |close| close + 1);
                    }
                    b'0'..=b'9' => {
                        let digits = src[i..].iter().take(3).take_while(|c| c.is_ascii_digit()).count();
                        if let Ok(byte) = body[i..i + digits].parse::<u8>() { decoded.push(byte); }
                        i += digits;
                    }
                    b'\r' => { decoded.push(b'\n'); i += if src.get(i + 1) == Some(&b'\n') { 2 } else { 1 }; }
                    _ => {
                        // \\ \" \' \` \{ and a backslash-newline stand for themselves.
                        let width = body[i..].chars().next().map_or(1, char::len_utf8);
                        decoded.extend_from_slice(&src[i..i + width]);
                        i += width;
                    }
                }
            }
            b'{' if interpolated => {
                let start = i + 1;
                let (mut depth, mut j) = (1usize, start);
                while j < src.len() {
                    match src[j] {
                        b'{' => depth += 1,
                        b'}' => { depth -= 1; if depth == 0 { break; } }
                        quote @ (b'"' | b'\'') => {
                            j += 1;
                            while j < src.len() && src[j] != quote { j += if src[j] == b'\\' { 2 } else { 1 }; }
                        }
                        _ => {}
                    }
                    j += 1;
                }
                let end = j.min(src.len());
                expression(start, &body[start..end]);
                i = end + 1;
            }
            _ => {
                let width = body[i..].chars().next().map_or(1, char::len_utf8);
                decoded.extend_from_slice(&src[i..i + width]);
                i += width;
            }
        }
    }
    decoded.utf8_chunks().map(|chunk| chunk.valid()).collect()
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

    #[test]
    fn literal_texts_are_decoded_with_their_lines() {
        let source = "-- \"註解\" is not text\nlocal a = \"中文\"\nlocal b = '\\u{5879}\\x41\\066\\228\\184\\173'\nlocal c = \"\\0\\255bin\"\nlocal d = [==[\n長字串]==]\nlocal e = `第{n}章{ok and \"是\" or '否'}完`\nlocal f = \"a\\z\n    b\\\"\"\n";
        let texts = string_literal_texts(source);
        let lines: Vec<(usize, &str)> = texts.iter().map(|(line, text)| (*line, text.as_str())).collect();
        assert_eq!(lines, [
            (2, "中文"),
            (3, "塹AB中"),
            (4, "\0bin"),
            (5, "長字串"),
            (7, "是"),
            (7, "否"),
            (7, "第章完"),
            (8, "ab\""),
        ], "escapes resolve, invalid UTF-8 bytes drop, interpolation yields its parts and inner literals");
    }
}
