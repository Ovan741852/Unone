//! Read-only, bounded source evidence. Never executes scripts or proves dead assets.
use crate::{
    asset::load_declared_manifest,
    bundle::digest_bytes,
    diagnostics::{Diagnostic, EngineResult},
    project::{ProjectConfig, ProjectPaths, resolve_project_path},
};
use serde::Serialize;
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::Read,
    path::Path,
};

const MAX_FILES: usize = 512;
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES: usize = 16 * 1024 * 1024;
const MAX_REFERENCES: usize = 20_000;
const EXCLUDED: &[&str] = &[
    ".git",
    ".agents",
    "dist",
    "target",
    "node_modules",
    "tests",
    "test",
    "bundles",
    "assets",
];

#[derive(Debug, Clone, Serialize)]
pub struct AssetUsageIndex {
    pub version: u32,
    pub project_root: String,
    pub assets: BTreeMap<String, String>,
    pub source_files: Vec<AssetUsageFile>,
    pub references: Vec<AssetUsageReference>,
    pub unresolved: Vec<AssetUsageReference>,
    pub scope: AssetUsageScope,
}
#[derive(Debug, Clone, Serialize)]
pub struct AssetUsageFile {
    pub path: String,
    pub role: String,
    pub sha256: String,
}
#[derive(Debug, Clone, Serialize)]
pub struct AssetUsageReference {
    pub asset_ids: Vec<String>,
    pub path: String,
    pub line: usize,
    pub column: usize,
    pub kind: String,
    pub evidence: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub via: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub json_pointer: Option<String>,
}
#[derive(Debug, Clone, Serialize)]
pub struct AssetUsageScope {
    pub scan_complete: bool,
    pub runtime_complete: bool,
    pub excluded_directories: Vec<String>,
    pub issues: Vec<String>,
    pub limitations: Vec<String>,
}

impl AssetUsageIndex {
    /// Same-file aliases are included: changing a texture affects all IDs backed by it.
    pub fn select(mut self, query: &str) -> EngineResult<Self> {
        let sources: BTreeSet<_> = self
            .assets
            .iter()
            .filter(|(id, source)| id.as_str() == query || source.as_str() == query)
            .map(|(_, source)| source.clone())
            .collect();
        if sources.is_empty() {
            return EngineResult::failure(Diagnostic::error(
                "ASSET_USAGE_NOT_DECLARED",
                "Unknown asset id or source",
                format!("'{query}' is not a declared asset id or primary source path."),
            ));
        }
        self.assets.retain(|_, source| sources.contains(source));
        for reference in &mut self.references {
            reference
                .asset_ids
                .retain(|id| self.assets.contains_key(id));
        }
        self.references
            .retain(|reference| !reference.asset_ids.is_empty());
        EngineResult::success(self)
    }
}

pub fn asset_usages(root: impl AsRef<Path>, query: Option<&str>) -> EngineResult<AssetUsageIndex> {
    let (config, paths) = match ProjectPaths::discover(root) {
        Ok(value) => value,
        Err(error) => return EngineResult::failure(*error),
    };
    let manifest = match load_declared_manifest(&paths) {
        Ok(value) => value,
        Err(error) => return EngineResult::failure(*error),
    };
    let root = match fs::canonicalize(&paths.root) {
        Ok(value) => value,
        Err(error) => {
            return EngineResult::failure(Diagnostic::error(
                "PROJECT_ROOT_INVALID",
                "Cannot resolve project",
                error.to_string(),
            ));
        }
    };
    let mut index = AssetUsageIndex {
        version: 1, project_root: root.display().to_string(),
        assets: manifest.assets.into_iter().map(|asset| (asset.id, asset.source)).collect(),
        source_files: Vec::new(), references: Vec::new(), unresolved: Vec::new(),
        scope: AssetUsageScope {
            scan_complete: true, runtime_complete: false,
            excluded_directories: EXCLUDED.iter().map(|value| value.to_string()).collect(), issues: Vec::new(),
            limitations: vec![
                "Scans project Luau/Lua, scene.json/*.scene.json and ui.json/*.ui.json sources, excluding hidden/generated/dependency/test/asset directories; configured entry, job and main scene files are always inspected.".into(),
                "asset_field is syntactic source evidence, not proof a page executes. literal/template_prefix/source_path/template_call are candidates; comments are excluded. Template calls are one-hop lexical named-helper dependencies, not resolved bindings or a reachability proof.".into(),
                "Dynamic expressions, interpolation, aliases and external sources cannot be exhaustively resolved. unresolved sites are project-wide, not evidence that a particular asset is used.".into(),
                "Entry and authoring sources are reported separately; bundled copies may repeat evidence. Only currently published runtime nodes can confirm live use; unvisited pages and virtualized items are not live evidence.".into(),
                "Zero references NEVER proves safe deletion. Exported source hashes describe that export, not subsequent local edits. Limits: 512 files, 2 MiB/file, 16 MiB total, 20000 evidence sites.".into(),
            ],
        },
    };
    let mut files = BTreeSet::new();
    // Configured files must not disappear merely because they live in a normally excluded directory.
    for file in std::iter::once(&config.entry_script)
        .chain(config.job_scripts.values())
        .chain(config.main_scene.iter())
    {
        files.insert(file.replace('\\', "/"));
    }
    collect_files(&root, &root, &config, &mut files, &mut index.scope);
    let mut total: usize = 0;
    for path in files {
        if index.source_files.len() >= MAX_FILES {
            issue(&mut index.scope, "File limit reached".into());
            break;
        }
        let file = match resolve_project_path(&root, &path) {
            Ok(file) => file,
            Err(error) => {
                issue(&mut index.scope, format!("{path}: {}", error.explanation));
                continue;
            }
        };
        let size = match fs::metadata(&file) {
            Ok(value) => value.len(),
            Err(error) => {
                issue(&mut index.scope, format!("{path}: {error}"));
                continue;
            }
        };
        if size > MAX_FILE_BYTES || total.saturating_add(size as usize) > MAX_TOTAL_BYTES {
            issue(
                &mut index.scope,
                format!("{path}: source byte limit exceeded"),
            );
            continue;
        }
        let mut text = String::new();
        let read = fs::File::open(file)
            .and_then(|file| file.take(MAX_FILE_BYTES + 1).read_to_string(&mut text));
        match read {
            Ok(_)
                if text.len() <= MAX_FILE_BYTES as usize
                    && total.saturating_add(text.len()) <= MAX_TOTAL_BYTES => {}
            Ok(_) => {
                issue(
                    &mut index.scope,
                    format!("{path}: source grew beyond byte limit"),
                );
                continue;
            }
            Err(error) => {
                issue(&mut index.scope, format!("{path}: {error}"));
                continue;
            }
        }
        total += text.len();
        index.source_files.push(AssetUsageFile {
            role: if path == config.entry_script {
                "entry"
            } else {
                "authoring_candidate"
            }
            .into(),
            path: path.clone(),
            sha256: digest_bytes(text.as_bytes()),
        });
        if path.ends_with(".json") {
            match serde_json::from_str::<serde_json::Value>(&text) {
                Ok(value) => scan_json(&value, "", &path, &mut index),
                Err(error) => issue(&mut index.scope, format!("{path}: {error}")),
            }
        } else {
            scan_luau(&text, &path, &mut index);
        }
    }
    if let Some(query) = query {
        index.select(query)
    } else {
        EngineResult::success(index)
    }
}

fn issue(scope: &mut AssetUsageScope, message: String) {
    scope.scan_complete = false;
    if scope.issues.len() < 100 {
        scope.issues.push(message);
    }
}
fn collect_files(
    root: &Path,
    dir: &Path,
    config: &ProjectConfig,
    files: &mut BTreeSet<String>,
    scope: &mut AssetUsageScope,
) {
    if dir.strip_prefix(root).unwrap().components().count() > 32 {
        issue(
            scope,
            format!("{}: directory depth limit exceeded", dir.display()),
        );
        return;
    }
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) => {
            issue(scope, format!("{}: {error}", dir.display()));
            return;
        }
    };
    let mut entries = entries
        .filter_map(|entry| match entry {
            Ok(entry) => Some(entry),
            Err(error) => {
                issue(scope, error.to_string());
                None
            }
        })
        .collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        if files.len() >= MAX_FILES {
            issue(scope, "File discovery limit reached".into());
            return;
        }
        let path = entry.path();
        let relative = path
            .strip_prefix(root)
            .unwrap()
            .to_string_lossy()
            .replace('\\', "/");
        let kind = match entry.file_type() {
            Ok(kind) => kind,
            Err(error) => {
                issue(scope, format!("{relative}: {error}"));
                continue;
            }
        };
        if kind.is_symlink() {
            issue(scope, format!("{relative}: symlink not traversed"));
            continue;
        }
        if kind.is_dir() {
            if !entry.file_name().to_string_lossy().starts_with('.')
                && !EXCLUDED.contains(&entry.file_name().to_string_lossy().as_ref())
            {
                collect_files(root, &path, config, files, scope);
            }
        } else if kind.is_file()
            && (matches!(
                path.extension().and_then(|value| value.to_str()),
                Some("luau" | "lua")
            ) || matches!(entry.file_name().to_str(), Some("scene.json" | "ui.json"))
                || relative.ends_with(".scene.json")
                || relative.ends_with(".ui.json"))
            && !config.test_files.contains(&relative)
            && relative != "project.unone.json"
            && Some(&relative) != config.asset_manifest.as_ref()
            && Some(&relative) != config.bundle_manifest.as_ref()
        {
            files.insert(relative);
        }
    }
}

fn add(index: &mut AssetUsageIndex, reference: AssetUsageReference) {
    if index.references.len() + index.unresolved.len() >= MAX_REFERENCES {
        issue(&mut index.scope, "Evidence limit reached".into());
        return;
    }
    if reference.asset_ids.is_empty() {
        index.unresolved.push(reference);
    } else {
        index.references.push(reference);
    }
}
fn scan_json(value: &serde_json::Value, pointer: &str, path: &str, index: &mut AssetUsageIndex) {
    match value {
        serde_json::Value::Object(object) => {
            for (key, value) in object {
                let next = format!("{pointer}/{}", key.replace('~', "~0").replace('/', "~1"));
                if key == "asset"
                    && let Some(id) = value.as_str()
                    && index.assets.contains_key(id)
                {
                    add(
                        index,
                        AssetUsageReference {
                            asset_ids: vec![id.into()],
                            path: path.into(),
                            line: 0,
                            column: 0,
                            kind: "asset_field".into(),
                            evidence: format!(
                                "{}: {id}",
                                object
                                    .get("id")
                                    .and_then(|value| value.as_str())
                                    .unwrap_or("asset")
                            ),
                            via: None,
                            json_pointer: Some(next.clone()),
                        },
                    );
                }
                scan_json(value, &next, path, index);
            }
        }
        serde_json::Value::Array(values) => {
            for (i, value) in values.iter().enumerate() {
                scan_json(value, &format!("{pointer}/{i}"), path, index);
            }
        }
        _ => {}
    }
}

#[derive(Debug)]
struct Token {
    value: String,
    string: bool,
    offset: usize,
}
fn named_helpers(tokens: &[Token]) -> Vec<(String, usize, usize)> {
    // ponytail: conservative lexical blocks for one-hop helper candidates; no whole-program binding/data-flow solver.
    let mut stack: Vec<(&str, Option<(String, usize)>)> = Vec::new();
    let mut functions = Vec::new();
    let mut pending_do = 0;
    for (i, token) in tokens.iter().enumerate().filter(|(_, token)| !token.string) {
        match token.value.as_str() {
            "function" => {
                let mut name = String::new();
                let mut at = i + 1;
                while let Some(next) = tokens
                    .get(at)
                    .filter(|next| !next.string && next.value != "(")
                {
                    if next
                        .value
                        .chars()
                        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '.' | ':'))
                    {
                        name.push_str(&next.value);
                        at += 1;
                    } else {
                        break;
                    }
                }
                stack.push((
                    "function",
                    (!name.is_empty() && tokens.get(at).is_some_and(|token| token.value == "("))
                        .then_some((name, i)),
                ));
            }
            // Expression-if has no matching end; keep it out of statement blocks.
            "if" if i == 0 || !matches!(tokens[i - 1].value.as_str(), "=" | "(" | "," | "return") => {
                stack.push(("if", None));
            }
            "for" | "while" => {
                stack.push(("loop", None));
                pending_do += 1;
            }
            "do" => {
                if pending_do > 0 {
                    pending_do -= 1;
                } else {
                    stack.push(("do", None));
                }
            }
            "repeat" => stack.push(("repeat", None)),
            "until" if stack.last().is_some_and(|(kind, _)| *kind == "repeat") => {
                stack.pop();
            }
            "end" => {
                if let Some((_, Some((name, start)))) = stack.pop() {
                    functions.push((name, start, i));
                }
            }
            _ => {}
        }
    }
    functions
}
fn long_open(bytes: &[u8], at: usize) -> Option<(usize, usize)> {
    if bytes.get(at) != Some(&b'[') {
        return None;
    }
    let mut end = at + 1;
    while bytes.get(end) == Some(&b'=') {
        end += 1;
    }
    (bytes.get(end) == Some(&b'[')).then_some((end - at - 1, end + 1))
}
fn long_end(bytes: &[u8], start: usize, equals: usize) -> Option<usize> {
    (start..bytes.len()).find(|&at| {
        bytes[at] == b']'
            && bytes
                .get(at + 1..at + 1 + equals)
                .is_some_and(|slice| slice.iter().all(|byte| *byte == b'='))
            && bytes.get(at + equals + 1) == Some(&b']')
    })
}
fn tokens(text: &str) -> Result<Vec<Token>, &'static str> {
    let bytes = text.as_bytes();
    let mut out = Vec::new();
    let mut at = 0;
    while at < bytes.len() {
        if bytes[at].is_ascii_whitespace() {
            at += 1;
            continue;
        }
        if bytes.get(at..at + 2) == Some(b"--") {
            if let Some((equals, start)) = long_open(bytes, at + 2) {
                at = long_end(bytes, start, equals).ok_or("Unclosed block comment")? + equals + 2;
            } else {
                while at < bytes.len() && bytes[at] != b'\n' {
                    at += 1;
                }
            }
            continue;
        }
        let offset = at;
        if let Some((equals, start)) = long_open(bytes, at) {
            let end = long_end(bytes, start, equals).ok_or("Unclosed long string")?;
            out.push(Token {
                value: text[start..end]
                    .strip_prefix("\r\n")
                    .or_else(|| text[start..end].strip_prefix(['\r', '\n']))
                    .unwrap_or(&text[start..end])
                    .into(),
                string: true,
                offset,
            });
            at = end + equals + 2;
        } else if matches!(bytes[at], b'\'' | b'"') {
            let quote = bytes[at];
            at += 1;
            let start = at;
            while at < bytes.len() && bytes[at] != quote {
                if bytes[at] == b'\\' {
                    at += 1;
                }
                at += 1;
            }
            if at >= bytes.len() {
                return Err("Unclosed quoted string");
            }
            let value = decode_string(&text[start..at])?;
            at += 1;
            out.push(Token {
                value,
                string: true,
                offset,
            });
        } else if bytes[at] == b'`' {
            // Interpolated Luau strings are intentionally not evaluated or attributed to an asset.
            at += 1;
            while at < bytes.len() && bytes[at] != b'`' {
                if bytes[at] == b'\\' {
                    at += 1;
                }
                at += 1;
            }
            if at >= bytes.len() {
                return Err("Unclosed interpolated string");
            }
            at += 1;
            out.push(Token {
                value: "<interpolation>".into(),
                string: false,
                offset,
            });
        } else {
            at += 1;
            if bytes[offset].is_ascii_alphabetic() || bytes[offset] == b'_' {
                while at < bytes.len() && (bytes[at].is_ascii_alphanumeric() || bytes[at] == b'_') {
                    at += 1;
                }
            } else {
                while at < bytes.len() && !text.is_char_boundary(at) {
                    at += 1;
                }
            }
            out.push(Token {
                value: text[offset..at].into(),
                string: false,
                offset,
            });
        }
    }
    Ok(out)
}
fn decode_string(value: &str) -> Result<String, &'static str> {
    let mut chars = value.chars().peekable();
    let mut out = Vec::new();
    fn utf8(out: &mut Vec<u8>, ch: char) {
        out.extend_from_slice(ch.encode_utf8(&mut [0; 4]).as_bytes());
    }
    while let Some(ch) = chars.next() {
        if ch != '\\' {
            utf8(&mut out, ch);
            continue;
        }
        let next = chars.next().ok_or("Invalid string escape")?;
        match next {
            'n' => out.push(b'\n'),
            'r' => out.push(b'\r'),
            't' => out.push(b'\t'),
            'a' => out.push(7),
            'b' => out.push(8),
            'f' => out.push(12),
            'v' => out.push(11),
            '\\' | '\'' | '"' => utf8(&mut out, next),
            '\n' => out.push(b'\n'),
            '\r' => {
                if chars.peek() == Some(&'\n') {
                    chars.next();
                }
                out.push(b'\n');
            }
            'z' => {
                while chars.peek().is_some_and(|ch| ch.is_whitespace()) {
                    chars.next();
                }
            }
            'x' => {
                let hex: String = chars.by_ref().take(2).collect();
                if hex.len() != 2 {
                    return Err("Invalid hex escape");
                }
                out.push(u8::from_str_radix(&hex, 16).map_err(|_| "Invalid hex escape")?);
            }
            'u' => {
                if chars.next() != Some('{') {
                    return Err("Invalid Unicode escape");
                }
                let mut hex = String::new();
                loop {
                    match chars.next() {
                        Some('}') => break,
                        Some(ch) => hex.push(ch),
                        None => return Err("Invalid Unicode escape"),
                    }
                }
                utf8(
                    &mut out,
                    char::from_u32(
                        u32::from_str_radix(&hex, 16).map_err(|_| "Invalid Unicode escape")?,
                    )
                    .ok_or("Invalid Unicode escape")?,
                );
            }
            '0'..='9' => {
                let mut number = next.to_string();
                for _ in 0..2 {
                    if chars.peek().is_some_and(|ch| ch.is_ascii_digit()) {
                        number.push(chars.next().unwrap());
                    }
                }
                let byte = number.parse::<u8>().map_err(|_| "Invalid decimal escape")?;
                out.push(byte);
            }
            _ => return Err("Unsupported string escape"),
        }
    }
    String::from_utf8(out).map_err(|_| "String escape produces non-UTF8 bytes")
}
fn scan_luau(text: &str, path: &str, index: &mut AssetUsageIndex) {
    let tokens = match tokens(text) {
        Ok(tokens) => tokens,
        Err(error) => {
            issue(&mut index.scope, format!("{path}: {error}"));
            return;
        }
    };
    let lines: Vec<_> = text.lines().collect();
    let mut line_starts = vec![0];
    for (at, byte) in text.bytes().enumerate() {
        if byte == b'\n' {
            line_starts.push(at + 1);
        }
    }
    let mut sources: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut names: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for (id, source) in &index.assets {
        sources.entry(source.clone()).or_default().push(id.clone());
        // Derive complete shorthand names only; arbitrary hyphen prefixes like "shop" produce noisy false families.
        for start in std::iter::once(0).chain(
            id.char_indices()
                .filter(|(_, ch)| matches!(ch, '/' | '_' | ':'))
                .map(|(at, ch)| at + ch.len_utf8()),
        ) {
            let suffix = &id[start..];
            if suffix.len() >= 3 {
                names.entry(suffix.into()).or_default().insert(id.clone());
            }
        }
    }
    let helpers = named_helpers(&tokens);
    let mut dependencies: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for (i, token) in tokens.iter().enumerate() {
        let asset_field = i >= 2 && tokens[i - 1].value == "=" && tokens[i - 2].value == "asset";
        let (ids, kind) = if token.string {
            if index.assets.contains_key(&token.value) {
                (
                    vec![token.value.clone()],
                    if asset_field {
                        "asset_field"
                    } else {
                        "literal"
                    },
                )
            } else if let Some(ids) = sources.get(token.value.as_str()) {
                (ids.clone(), "source_path")
            } else {
                // ponytail: lexical template candidates, not a fabricated call graph. A precomputed name index avoids an assets × strings scan.
                let ids = names
                    .get(token.value.as_str())
                    .map(|ids| ids.iter().cloned().collect())
                    .unwrap_or_default();
                (
                    ids,
                    if asset_field {
                        "unresolved_asset_literal"
                    } else {
                        "template_prefix"
                    },
                )
            }
        } else {
            (Vec::new(), "dynamic_asset_expression")
        };
        if ids.is_empty() && !asset_field && token.value != "<interpolation>" {
            continue;
        }
        if !ids.is_empty()
            && let Some((name, _, _)) = helpers
                .iter()
                .filter(|(_, start, end)| *start < i && i < *end)
                .min_by_key(|(_, start, end)| end - start)
        {
            dependencies
                .entry(name.clone())
                .or_default()
                .extend(ids.iter().cloned());
        }
        let line = line_starts.partition_point(|start| *start <= token.offset);
        add(
            index,
            AssetUsageReference {
                asset_ids: ids,
                path: path.into(),
                line,
                column: text[line_starts[line - 1]..token.offset].chars().count() + 1,
                kind: kind.into(),
                evidence: lines
                    .get(line - 1)
                    .unwrap_or(&"")
                    .trim()
                    .chars()
                    .take(300)
                    .collect(),
                via: None,
                json_pointer: None,
            },
        );
    }
    for (i, token) in tokens.iter().enumerate().filter(|(i, token)| {
        !token.string && tokens.get(i + 1).is_some_and(|next| next.value == "(")
    }) {
        let mut start = i;
        while start >= 2
            && matches!(tokens[start - 1].value.as_str(), "." | ":")
            && !tokens[start - 2].string
        {
            start -= 2;
        }
        if start > 0 && tokens[start - 1].value == "function" {
            continue;
        }
        let name = tokens[start..=i]
            .iter()
            .map(|token| token.value.as_str())
            .collect::<String>();
        let Some(ids) = dependencies.get(&name) else {
            continue;
        };
        let line = line_starts.partition_point(|start| *start <= token.offset);
        add(
            index,
            AssetUsageReference {
                asset_ids: ids.iter().cloned().collect(),
                path: path.into(),
                line,
                column: text[line_starts[line - 1]..token.offset].chars().count() + 1,
                kind: "template_call".into(),
                evidence: lines
                    .get(line - 1)
                    .unwrap_or(&"")
                    .trim()
                    .chars()
                    .take(300)
                    .collect(),
                via: Some(name),
                json_pointer: None,
            },
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn source_evidence_is_bounded_readonly_and_never_claims_runtime_completeness() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("ui")).unwrap();
        fs::create_dir(dir.path().join("dist")).unwrap();
        fs::write(dir.path().join("project.unone.json"), r#"{"name":"fixture","entry_script":"main.luau","asset_manifest":"assets.json","main_scene":"scene.json"}"#).unwrap();
        fs::write(dir.path().join("assets.json"), r#"{"version":1,"assets":[{"id":"texture://ui_button-v3","source":"button.png","kind":"texture2d","bundle":"content"},{"id":"texture://alias","source":"button.png","kind":"texture2d","bundle":"content"},{"id":"texture://ui_button-v3-tl","source":"tl.png","kind":"texture2d","bundle":"content"}]}"#).unwrap();
        let script = "-- 'texture://alias'\n--[=[ asset='texture://alias' ]=]\nlocal n={asset=\"texture://ui_button-v3\"}\nlocal other=[=[texture://alias]=]\nlocal a={asset=choose()}\nlocal b='button-v3'\nlocal c=\"texture://\\097lias\"\nlocal d=`texture://{name}`";
        fs::write(dir.path().join("main.luau"), script).unwrap();
        fs::write(dir.path().join("ui/other.luau"), "img('node', 'button-v3', 0)\nlocal function button(id)\nif id then\nreturn {asset='texture://ui_button-v3'}\nend\nend\nbutton('choice_start')").unwrap();
        fs::write(dir.path().join("dist/old.luau"), "'texture://alias'").unwrap();
        fs::write(
            dir.path().join("scene.json"),
            r#"{"entities":[{"id":"sprite","sprite":{"asset":"texture://alias"}}]}"#,
        )
        .unwrap();
        let report = asset_usages(dir.path(), Some("button.png")).value.unwrap();
        assert!(report.scope.scan_complete, "{:?}", report.scope.issues);
        assert!(!report.scope.runtime_complete);
        assert_eq!(report.assets.len(), 2);
        assert!(
            report
                .references
                .iter()
                .any(|r| r.path == "ui/other.luau" && r.line == 1 && r.kind == "template_prefix")
        );
        assert!(report.references.iter().any(|r| r.path == "ui/other.luau"
            && r.line == 7
            && r.kind == "template_call"
            && r.via.as_deref() == Some("button")));
        assert!(
            report
                .references
                .iter()
                .any(|r| r.json_pointer.as_deref() == Some("/entities/0/sprite/asset"))
        );
        assert!(
            !report
                .references
                .iter()
                .any(|r| r.line == 1 && r.path == "main.luau")
        );
        assert!(report.unresolved.iter().any(|r| r.line == 5));
        assert!(report.unresolved.iter().any(|r| r.line == 8));
        assert!(
            !report
                .source_files
                .iter()
                .any(|r| r.path.starts_with("dist/"))
        );
        assert_eq!(
            fs::read_to_string(dir.path().join("main.luau")).unwrap(),
            script
        );
        assert!(!asset_usages(dir.path(), Some("missing")).ok);
        fs::write(dir.path().join("ui/broken.luau"), "--[=[unclosed").unwrap();
        assert!(
            !asset_usages(dir.path(), None)
                .value
                .unwrap()
                .scope
                .scan_complete
        );
    }
    #[test]
    fn lexer_handles_comments_strings_and_escape_boundaries() {
        let values =
            tokens("--\"ignored\"\n[==[a\nb]==] '\\x61\\u{62}\\099' --[[ignored]]\n '中文'")
                .unwrap();
        assert_eq!(
            values
                .iter()
                .map(|token| token.value.as_str())
                .collect::<Vec<_>>(),
            vec!["a\nb", "abc", "中文"]
        );
        assert!(tokens("'unclosed").is_err());
        assert!(tokens("`unclosed").is_err());
        assert_eq!(decode_string("\\xE4\\184\\173").unwrap(), "中");
        assert_eq!(decode_string("\\z \n label").unwrap(), "label");
        assert_eq!(tokens("[[\n\nvalue]]").unwrap()[0].value, "\nvalue");
    }
}
