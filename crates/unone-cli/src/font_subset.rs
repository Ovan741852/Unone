//! Web export font subsetting. Export tooling, not an engine capability.
//!
//! A face declared with `"subset": true` in `player.presentation.json` ships
//! only the glyphs for the text the game can show: the string literals of the
//! entry script, its modules and job scripts, every string in the main scene,
//! the JSON and text data assets, plus the characters the project declares in
//! `ui.font_subset` because they only appear at run time. Printable ASCII is
//! always kept so numbers and Latin text formatted at run time still render.
//! The text is read from the exact payload the export ships, so it cannot go
//! stale. A shown character that no packaged face has is reported with where
//! it appears; by default that fails the export.

use anyhow::{anyhow, bail, ensure, Context, Result};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::{fs, path::Path};
use unone_engine::Diagnostic;

use crate::hosts::{MissingGlyphPolicy, PresentationUi};
use crate::truetype_subset;

pub(crate) const SCHEMA: &str = "unone.font-subset.v1";
/// Places remembered per character for the missing-glyph report.
const SOURCES_PER_CHARACTER: usize = 3;
/// Characters listed per face in the report; counts stay exact.
const LISTED_PER_FACE: usize = 200;

/// The characters packaged content can show, each with the first places it appears.
#[derive(Default)]
pub(crate) struct GameText {
    chars: BTreeMap<char, Vec<String>>,
    /// Characters of JSON object keys: almost always identifiers, so they are
    /// kept when a face has them but never reported as missing.
    key_chars: BTreeSet<char>,
    scripts: usize,
    data_assets: usize,
    scene: bool,
    skipped_data_assets: Vec<Value>,
}

impl GameText {
    fn add(&mut self, text: &str, source: &dyn Fn() -> String) {
        for ch in text.chars() {
            let sources = self.chars.entry(ch).or_default();
            if sources.len() < SOURCES_PER_CHARACTER {
                let place = source();
                if !sources.contains(&place) { sources.push(place); }
            }
        }
    }

    fn add_luau(&mut self, source: &str, path: &str) {
        for (line, text) in unone_engine::string_literal_texts(source) {
            self.add(&text, &|| format!("{path}:{line}"));
        }
        self.scripts += 1;
    }

    fn add_json(&mut self, value: &Value, path: &str) {
        match value {
            Value::String(text) => self.add(text, &|| path.to_string()),
            Value::Array(items) => for item in items { self.add_json(item, path) },
            Value::Object(fields) => for (key, item) in fields {
                self.key_chars.extend(key.chars());
                self.add_json(item, path);
            },
            _ => {}
        }
    }

    fn add_lines(&mut self, text: &str, path: &str) {
        for (index, line) in text.lines().enumerate() {
            self.add(line, &|| format!("{path}:{}", index + 1));
        }
    }
}

/// Reads the text of the content an export is about to ship. Call it before
/// script sources are replaced by bytecode.
pub(crate) fn collect_text(files: &[(String, Vec<u8>)]) -> Result<GameText> {
    let file = |path: &str| files.iter().find(|(p, _)| p == path).map(|(_, bytes)| bytes.as_slice());
    let payload: Value = serde_json::from_slice(file("content/project.json").context("content/project.json missing")?)?;
    let config = &payload["config"];
    let entry = config["entry_script"].as_str().unwrap_or("entry script");
    let script_dir = entry.rsplit_once('/').map_or("", |(dir, _)| dir);
    let mut text = GameText::default();
    if let Some(source) = payload["script"].as_str() { text.add_luau(source, entry); }
    for (module, source) in payload["script_modules"].as_object().into_iter().flatten() {
        let path = if script_dir.is_empty() { module.clone() } else { format!("{script_dir}/{module}") };
        text.add_luau(source.as_str().unwrap_or_default(), &path);
    }
    for (id, source) in payload["job_sources"].as_object().into_iter().flatten() {
        text.add_luau(source.as_str().unwrap_or_default(), config["job_scripts"][id].as_str().unwrap_or(id));
    }
    if !payload["scene"].is_null() {
        text.add_json(&payload["scene"], config["main_scene"].as_str().unwrap_or("main scene"));
        text.scene = true;
    }
    for asset in payload["data_assets"].as_array().into_iter().flatten() {
        let (id, source, loader) = (asset["id"].as_str().unwrap_or_default(), asset["source"].as_str().unwrap_or_default(), asset["loader"].as_str().unwrap_or("bytes"));
        let bytes = file(&format!("content/{source}")).with_context(|| format!("data asset {id} was not packaged"))?;
        match loader {
            "json" => {
                let value: Value = serde_json::from_slice(bytes).with_context(|| format!("data asset {id} ({source}) is not JSON"))?;
                text.add_json(&value, source);
            }
            "text" => text.add_lines(&bytes.utf8_chunks().map(|chunk| chunk.valid()).collect::<String>(), source),
            _ => {
                // Bytes and game-registered loaders have no known text encoding.
                text.skipped_data_assets.push(json!({"id": id, "source": source, "loader": loader}));
                continue;
            }
        }
        text.data_assets += 1;
    }
    Ok(text)
}

/// One packaged font file and the faces (name, weight) that name it.
struct FontSource {
    path: String,
    faces: Vec<(String, u16)>,
    subset: bool,
}

fn suffixed_path(path: &str, suffix: &str) -> String {
    match path.rsplit_once('.') {
        Some((stem, extension)) if !extension.contains('/') => format!("{stem}.{suffix}.{extension}"),
        _ => format!("{path}.{suffix}"),
    }
}

fn available_font_output(files: &[(String, Vec<u8>)], source: &str, suffix: &str) -> String {
    let mut output = suffixed_path(source, suffix);
    let mut sequence = 0;
    loop {
        let packaged = format!("content/{output}");
        if !files.iter().any(|(path, _)| path.eq_ignore_ascii_case(&packaged)) { return output; }
        sequence += 1;
        output = suffixed_path(source, &format!("{suffix}.{sequence}"));
    }
}

/// Subsets the faces that ask for it in `files` and returns the report, or
/// `None` when no face asks. The presentation names the subset files, while
/// sources also declared as data keep their original bytes. Development
/// exports keep whole faces for reloaded scripts and still check coverage.
pub(crate) fn apply(project: &Path, ui: &PresentationUi, assets: &Value, mut text: GameText, files: &mut Vec<(String, Vec<u8>)>, development: bool) -> Result<Option<Value>> {
    if !ui.subset_enabled() { return Ok(None); }
    let default_settings = Default::default();
    let settings = ui.font_subset.as_ref().unwrap_or(&default_settings);
    let mut runtime: BTreeSet<char> = settings.runtime_text.chars().collect();
    text.add(&settings.runtime_text, &|| "player.presentation.json ui.font_subset.runtime_text".to_string());
    for path in &settings.runtime_text_files {
        let bytes = fs::read(project.join(path)).with_context(|| format!("UI_FONT_SUBSET_TEXT_MISSING: cannot read runtime_text_files entry {path}"))?;
        let file = String::from_utf8(bytes).map_err(|_| anyhow!("UI_FONT_SUBSET_TEXT_INVALID: runtime_text_files entry {path} is not UTF-8 text"))?;
        runtime.extend(file.chars());
        text.add_lines(&file, path);
    }

    let mut sources: Vec<FontSource> = Vec::new();
    let legacy = ui.font_source.iter().map(|path| (path, ui.font_family.clone().unwrap_or_default(), 400, false));
    for (path, family, weight, subset) in legacy.chain(ui.fonts.iter().map(|face| (&face.source, face.family.clone(), face.weight, face.subset))) {
        let face = (format!("{family} {weight}"), weight);
        match sources.iter_mut().find(|source| &source.path == path) {
            Some(source) => source.faces.push(face),
            None => sources.push(FontSource { path: path.clone(), faces: vec![face], subset }),
        }
    }
    let index_of = |files: &[(String, Vec<u8>)], path: &str| files.iter().position(|(p, _)| p == &format!("content/{path}"))
        .with_context(|| format!("font {path} was not packaged"));
    let mut coverage = Vec::with_capacity(sources.len());
    for source in &sources {
        let bytes = &files[index_of(files, &source.path)?].1;
        coverage.push(truetype_subset::coverage(bytes).map_err(|error| anyhow!("{error:#} (font {})", source.path))?);
    }
    let covered: BTreeSet<char> = coverage.iter().flatten().copied().collect();
    let ignored: BTreeSet<char> = settings.ignore_missing.chars().collect();
    let required: BTreeSet<char> = text.chars.keys().copied().filter(|ch| shown(*ch) && !ignored.contains(ch)).collect();
    let keep: BTreeSet<char> = text.chars.keys().chain(&text.key_chars).copied().chain((0x20u8..0x7F).map(char::from)).collect();

    let mut faces = Vec::with_capacity(sources.len());
    // Use the authored manifest: two equal data files may share one runtime
    // source, but both of their published paths still name the original bytes.
    let data_sources: BTreeSet<_> = assets["assets"].as_array().into_iter().flatten()
        .filter(|asset| asset["kind"] == "data")
        .filter_map(|asset| asset["source"].as_str().map(str::to_ascii_lowercase)).collect();
    let mut font_outputs: Vec<(String, Option<u16>, String)> = Vec::new();
    for (source, coverage) in sources.iter().zip(&coverage) {
        let index = index_of(files, &source.path)?;
        let original = files[index].1.len();
        let missing: Vec<char> = required.difference(coverage).copied().collect();
        let row = |names: Vec<&String>| json!({
            "source": source.path,
            "output": source.path,
            "faces": names,
            "subset": source.subset && !development,
            "original_bytes": original,
            "bytes": original,
            "characters": coverage.len(),
            "covered": required.len() - missing.len(),
            "missing_count": missing.len(),
            "missing": missing.iter().take(LISTED_PER_FACE).map(|ch| character(*ch)).collect::<Vec<_>>(),
        });
        if !source.subset || development {
            faces.push(row(source.faces.iter().map(|(name, _)| name).collect()));
            continue;
        }
        let bytes = files[index].1.clone();
        let layout = [b"GSUB", b"GPOS"].into_iter().filter(|tag| truetype_subset::has_table(&bytes, tag)).count() > 0;
        let shaped: Vec<char> = keep.intersection(coverage).copied().filter(|ch| needs_layout(*ch)).collect();
        if layout && !shaped.is_empty() {
            bail!("UI_FONT_SUBSET_SHAPING_UNSUPPORTED: {} needs OpenType layout (GSUB/GPOS) for {}, which subsetting does not keep; set \"subset\": false for this face",
                source.path, list(&shaped, 10));
        }
        let keep_whole = data_sources.contains(&source.path.to_ascii_lowercase());
        // Variable fonts have a distinct static instance per declared weight.
        let variable = truetype_subset::is_variable(&bytes);
        let weights: Vec<Option<u16>> = if variable {
            source.faces.iter().map(|(_, weight)| *weight).collect::<BTreeSet<_>>().into_iter().map(Some).collect()
        } else {
            vec![None]
        };
        for weight in weights {
            let result = truetype_subset::subset(&bytes, &keep, weight.unwrap_or(400))
                .map_err(|error| anyhow!("{error:#} (font {}{})", source.path, weight.map_or(String::new(), |w| format!(" at weight {w}"))))?;
            let mut face = row(source.faces.iter().filter(|(_, w)| weight.is_none_or(|weight| *w == weight)).map(|(name, _)| name).collect());
            face["bytes"] = json!(result.bytes.len());
            face["original_glyphs"] = json!(result.original_glyphs);
            face["glyphs"] = json!(result.glyphs);
            face["characters"] = json!(result.characters);
            face["dropped_tables"] = json!(result.dropped_tables);
            let output = if let Some(weight) = weight {
                let suffix = format!("w{weight}");
                let mut path = suffixed_path(&source.path, &suffix);
                if data_sources.contains(&path.to_ascii_lowercase()) {
                    path = available_font_output(files, &source.path, &suffix);
                } else {
                    ensure!(index_of(files, &path).is_err(), "UI_FONT_SUBSET_PATH_CONFLICT: the instance of {} at weight {weight} would replace the packaged file {path}", source.path);
                }
                face["instance"] = json!({"wght": weight});
                Some(path)
            } else if keep_whole {
                Some(available_font_output(files, &source.path, "subset"))
            } else {
                None
            };
            if let Some(output) = output {
                face["output"] = json!(output);
                files.push((format!("content/{output}"), result.bytes));
                font_outputs.push((source.path.clone(), weight, output));
            } else {
                files[index].1 = result.bytes;
            }
            faces.push(face);
        }
        if variable && !keep_whole {
            let whole = format!("content/{}", source.path);
            files.retain(|(path, _)| path != &whole);
        }
    }
    if !font_outputs.is_empty() {
        let at = index_of(files, "presentation.json")?;
        let mut presentation: Value = serde_json::from_slice(&files[at].1)?;
        for face in presentation["ui"]["fonts"].as_array_mut().into_iter().flatten() {
            let named = |(source, weight, _): &&(String, Option<u16>, String)| face["source"] == json!(source) && weight.is_none_or(|w| face["weight"] == w);
            if let Some((_, _, output)) = font_outputs.iter().find(named) { face["source"] = json!(output); }
        }
        files[at].1 = serde_json::to_vec(&presentation)?;
    }
    let missing: Vec<char> = required.difference(&covered).copied().collect();
    if settings.missing == MissingGlyphPolicy::Error && !missing.is_empty() {
        let places = missing.iter().take(20)
            .map(|ch| format!("{} [{}]", character(*ch)["code"].as_str().unwrap_or_default(), text.chars[ch].join(", ")))
            .collect::<Vec<_>>().join("; ");
        bail!("UI_FONT_GLYPHS_MISSING: {} character(s) the game shows are in no packaged font: {places}. Package a face that has them, \
               list characters that are never shown in ui.font_subset.ignore_missing, or set ui.font_subset.missing to \"warn\"", missing.len());
    }
    Ok(Some(json!({
        "schema": SCHEMA,
        "applied": !development,
        "note": if development { "Development exports keep whole faces so reloaded scripts can show new text; coverage is still checked." } else { "Faces marked subset keep only the glyphs for the collected text and printable ASCII. OpenType layout tables (kerning, ligatures) are dropped from them; a variable face becomes one static instance per declared weight." },
        "missing_policy": settings.missing,
        "text": {
            "characters": text.chars.len(),
            "runtime_characters": runtime.iter().filter(|ch| shown(**ch)).count(),
            "scripts": text.scripts,
            "scene": text.scene,
            "data_assets": text.data_assets,
            "skipped_data_assets": text.skipped_data_assets,
        },
        "faces": faces,
        "missing": missing.iter().map(|ch| {
            let mut entry = character(*ch);
            entry["sources"] = json!(text.chars[ch]);
            entry
        }).collect::<Vec<_>>(),
    })))
}

/// A warning for each export report that lists characters no face has (the
/// `warn` policy; `error` stops the export instead).
pub(crate) fn diagnostics(export: &Value) -> Vec<Diagnostic> {
    let report = &export["font_subset"];
    let Some(missing) = report["missing"].as_array().filter(|missing| !missing.is_empty()) else { return Vec::new(); };
    let shown: Vec<String> = missing.iter().take(20).filter_map(|entry| entry["code"].as_str().map(str::to_string)).collect();
    let mut diagnostic = Diagnostic::warning(
        "UI_FONT_GLYPHS_MISSING",
        "Characters the game shows are in no packaged font",
        format!("{} character(s) have no glyph in any packaged face ({}); players see a fallback font or empty boxes. \
                 export.json font_subset.missing lists where each appears.", missing.len(), shown.join(", ")),
    );
    diagnostic.facts = json!({"missing": missing.iter().take(100).collect::<Vec<_>>(), "count": missing.len()});
    vec![diagnostic]
}

fn character(ch: char) -> Value {
    json!({"code": format!("U+{:04X}", ch as u32), "char": ch.to_string()})
}

fn list(chars: &[char], limit: usize) -> String {
    let mut text = chars.iter().take(limit).map(|ch| format!("U+{:04X} {ch}", *ch as u32)).collect::<Vec<_>>().join(", ");
    if chars.len() > limit { text.push_str(&format!(" and {} more", chars.len() - limit)); }
    text
}

/// Whether a character draws something: not whitespace, a control, a
/// format/invisible character or a variation selector.
fn shown(ch: char) -> bool {
    let code = ch as u32;
    !(ch.is_whitespace() || ch.is_control()
        || matches!(code, 0x00AD | 0x034F | 0x061C | 0x115F | 0x1160 | 0x17B4 | 0x17B5 | 0x180B..=0x180F | 0x200B..=0x200F
            | 0x202A..=0x202E | 0x2060..=0x206F | 0x3164 | 0xFE00..=0xFE0F | 0xFEFF | 0xFFA0 | 0xFFF0..=0xFFF8
            | 0x1BCA0..=0x1BCA3 | 0x1D173..=0x1D17A | 0xE0000..=0xE0FFF))
}

/// Whether drawing a character relies on OpenType layout: joining, reordering
/// or mark positioning. Such text cannot keep its shape in a subset without
/// GSUB/GPOS.
fn needs_layout(ch: char) -> bool {
    matches!(ch as u32,
        0x0300..=0x036F | 0x0483..=0x0489 | 0x0591..=0x05C7 // combining marks, Cyrillic and Hebrew marks
        | 0x0600..=0x08FF // Arabic, Syriac, Thaana, NKo, Samaritan, Mandaic, Arabic supplements
        | 0x0900..=0x0DFF // Indic scripts through Sinhala
        | 0x0E00..=0x0FFF // Thai, Lao, Tibetan
        | 0x1000..=0x109F // Myanmar
        | 0x1100..=0x11FF // conjoining Hangul jamo
        | 0x1700..=0x18AF // Philippine scripts, Khmer, Mongolian
        | 0x1A00..=0x1AFF | 0x1B00..=0x1BFF | 0x1C00..=0x1C4F // Buginese, Tai Tham, Balinese, Sundanese, Batak, Lepcha
        | 0x1DC0..=0x1DFF | 0x20D0..=0x20FF | 0x302A..=0x302F | 0x3099 | 0x309A // combining marks
        | 0xA800..=0xA82F | 0xA840..=0xA8FF | 0xA900..=0xA9DF | 0xAA00..=0xAA7F // Syloti Nagri, Phags-pa, Saurashtra, Devanagari ext., Kayah Li, Rejang, Javanese, Cham
        | 0xFB1D..=0xFB4F | 0xFB50..=0xFDFF | 0xFE20..=0xFE2F | 0xFE70..=0xFEFE // presentation forms, combining half marks
        | 0x10A00..=0x10A5F | 0x11000..=0x11FFF // Kharoshthi, Brahmic scripts
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::truetype_subset::{coverage, fixture};
    use sha2::{Digest, Sha256};
    use std::path::PathBuf;

    const SCRIPT: &str = "local Game={}\nlocal title = \"文\" -- 中 only in a comment\nfunction Game.start(_api) end\nfunction Game.update(_api,_dt) end\nreturn Game\n";

    /// A project whose script shows 文, whose scene shows 字 and whose JSON
    /// data asset shows U+20000, packaging the fixture font as fonts/a.ttf.
    struct Project { dir: tempfile::TempDir, runtime: PathBuf, repo: PathBuf }

    impl Project {
        fn new(ui: Value) -> Self {
            let dir = tempfile::tempdir().unwrap();
            let root = dir.path();
            let runtime = root.join("runtime");
            for directory in ["runtime", "scripts", "scenes", "data", "fonts"] { fs::create_dir(root.join(directory)).unwrap(); }
            let (javascript, wasm) = (b"// packaging fixture".as_slice(), b"\0asm\x01\0\0\0".as_slice());
            fs::write(runtime.join("fixture.js"), javascript).unwrap();
            fs::write(runtime.join("fixture.wasm"), wasm).unwrap();
            let hash = |bytes: &[u8]| format!("{:x}", Sha256::digest(bytes));
            fs::write(runtime.join("runtime.json"), serde_json::to_vec(&json!({"profile":"release","dev_tools":false,"preview_tools":false,
                "javascript":"fixture.js","javascript_sha256":hash(javascript),"wasm":"fixture.wasm","wasm_sha256":hash(wasm),
                "compiled_systems":unone_engine::SystemSettings::default().enabled_ids()})).unwrap()).unwrap();
            fs::write(root.join("project.unone.json"), serde_json::to_vec(&json!({"name":"subset fixture","entry_script":"scripts/main.luau",
                "main_scene":"scenes/main.scene.json","asset_manifest":"assets.json"})).unwrap()).unwrap();
            fs::write(root.join("scripts/main.luau"), SCRIPT).unwrap();
            fs::write(root.join("scenes/main.scene.json"), serde_json::to_vec(&json!({"entities":[{"id":"字"}]})).unwrap()).unwrap();
            fs::write(root.join("data/names.json"), serde_json::to_vec(&json!({"names":["\u{20000}"]})).unwrap()).unwrap();
            fs::write(root.join("assets.json"), serde_json::to_vec(&json!({"version":1,"assets":[{"id":"data://names","kind":"data",
                "source":"data/names.json","encoding":{"format":"json","mime":"application/json","decoder":"json"}}]})).unwrap()).unwrap();
            fs::write(root.join("fonts/a.ttf"), fixture::font(fixture::Options::default())).unwrap();
            let project = Self { dir, runtime, repo: Path::new(env!("CARGO_MANIFEST_DIR")).join("../..") };
            project.presentation(ui);
            project
        }

        fn presentation(&self, ui: Value) {
            fs::write(self.dir.path().join("player.presentation.json"), serde_json::to_vec(&json!({"ui": ui})).unwrap()).unwrap();
        }

        fn export(&self, name: &str, development: bool) -> Result<(PathBuf, Value)> {
            if development {
                let mut descriptor: Value = serde_json::from_slice(&fs::read(self.runtime.join("runtime.json")).unwrap()).unwrap();
                descriptor["preview_tools"] = json!(true);
                fs::write(self.runtime.join("runtime.json"), serde_json::to_vec(&descriptor).unwrap()).unwrap();
            }
            let output = self.dir.path().join(name);
            let report = crate::export::web_with_templates(self.dir.path(), &output, Some(&self.runtime), development, &self.repo);
            report.map(|report| (output, report))
        }
    }

    fn face(subset: bool) -> Value {
        json!([{"family": "Fixture", "source": "fonts/a.ttf", "subset": subset}])
    }

    #[test]
    fn shared_font_sources_keep_whole_bytes_for_every_data_id() {
        for variable in [false, true] {
            for font_first in [false, true] {
                let project = Project::new(json!({"fonts": face(true)}));
                let root = project.dir.path();
                let whole = fixture::font(fixture::Options { variable, ..Default::default() });
                let font = "fonts/a.ttf";
                let alias = "data/duplicate.bin";
                let reserved = if variable { "fonts/a.w400.ttf" } else { "fonts/a.subset.ttf" };
                for path in [font, alias] { fs::write(root.join(path), &whole).unwrap(); }
                fs::write(root.join(reserved), b"reserved data").unwrap();
                let sources = if font_first { [font, alias] } else { [alias, font] };
                let manifest = json!({"version": 1, "assets": [
                    {"id": "data://first", "kind": "data", "source": sources[0]},
                    {"id": "data://second", "kind": "data", "source": sources[1]},
                    {"id": "data://reserved", "kind": "data", "source": reserved}
                ]});
                fs::write(root.join("assets.json"), serde_json::to_vec(&manifest).unwrap()).unwrap();
                let (_, _, _, common) = crate::export::content(root).unwrap();
                for path in [font, alias] {
                    assert_eq!(common.iter().find(|(p, _)| p == &format!("content/{path}")).unwrap().1, whole);
                }
                let (output, report) = project.export("shared", false).unwrap();
                for base in [output.clone(), output.join(report["release_root"].as_str().unwrap())] {
                    let content = base.join("content");
                    for path in [font, alias] { assert!(fs::read(content.join(path)).is_ok_and(|b| b == whole), "{path}, variable={variable}, font_first={font_first}"); }
                    assert_eq!(fs::read(content.join(reserved)).unwrap(), b"reserved data");
                    let read_json = |path| serde_json::from_slice::<Value>(&fs::read(content.join(path)).unwrap()).unwrap();
                    let payload = read_json("project.json");
                    for (i, id) in ["data://first", "data://second"].iter().enumerate() {
                        let decl = &payload["data_assets"][i];
                        assert_eq!(decl["id"], *id);
                        assert_eq!(decl["source"], sources[0]);
                        assert!(fs::read(content.join(decl["source"].as_str().unwrap())).unwrap() == whole);
                    }
                    let presentation = read_json("presentation.json");
                    let path = presentation["ui"]["fonts"][0]["source"].as_str().unwrap();
                    assert_eq!(report["font_subset"]["faces"][0]["output"], path);
                    let subset = fs::read(content.join(path)).unwrap();
                    assert!(subset.len() < whole.len());
                    assert!(!truetype_subset::is_variable(&subset));
                    assert_eq!(coverage(&subset).unwrap(), ['A', 'Z', '文', '字'].into());
                }
            }
        }
    }

    #[test]
    fn web_export_subsets_marked_faces_to_the_text_the_game_shows() {
        let project = Project::new(json!({"fonts": face(true)}));
        let original = fs::read(project.dir.path().join("fonts/a.ttf")).unwrap();
        let (output, report) = project.export("production", false).unwrap();
        let packaged = fs::read(output.join("content/fonts/a.ttf")).unwrap();
        // 文 (script), 字 (scene), U+20000 (data asset), A and Z (printable ASCII);
        // 中 appears only in a comment and as a part of 文's glyph.
        assert_eq!(coverage(&packaged).unwrap(), ['A', 'Z', '文', '字', '\u{20000}'].into());
        assert!(packaged.len() < original.len());
        let release = report["release_root"].as_str().unwrap();
        assert_eq!(fs::read(output.join(release).join("content/fonts/a.ttf")).unwrap(), packaged, "the sealed generation ships the subset");
        let subset = &report["font_subset"];
        assert_eq!((subset["schema"].as_str(), subset["applied"].as_bool(), subset["missing_policy"].as_str()), (Some(SCHEMA), Some(true), Some("error")));
        assert_eq!(subset["text"]["scripts"], 1);
        assert_eq!((subset["text"]["scene"].as_bool(), subset["text"]["data_assets"].as_u64()), (Some(true), Some(1)));
        let entry = &subset["faces"][0];
        assert_eq!((entry["original_bytes"].as_u64(), entry["bytes"].as_u64()), (Some(original.len() as u64), Some(packaged.len() as u64)));
        assert_eq!((entry["glyphs"].as_u64(), entry["characters"].as_u64(), entry["missing_count"].as_u64()), (Some(7), Some(5), Some(0)));
        assert_eq!(subset["missing"], json!([]));
        assert_eq!(serde_json::from_slice::<Value>(&fs::read(output.join("export.json")).unwrap()).unwrap()["font_subset"], *subset);
        let presentation = fs::read_to_string(output.join("content/presentation.json")).unwrap();
        assert!(!presentation.contains("subset"), "players never see build settings: {presentation}");

        project.presentation(json!({"fonts": face(true), "font_subset": {"runtime_text": "中"}}));
        let (output, report) = project.export("with-runtime-text", false).unwrap();
        assert!(coverage(&fs::read(output.join("content/fonts/a.ttf")).unwrap()).unwrap().contains(&'中'), "declared run-time characters are kept");
        assert_eq!(report["font_subset"]["text"]["runtime_characters"], 1);

        let (output, report) = project.export("development", true).unwrap();
        assert_eq!(fs::read(output.join("content/fonts/a.ttf")).unwrap(), original, "development keeps whole faces for reloaded scripts");
        assert_eq!(report["font_subset"]["applied"], false);
    }

    #[test]
    fn characters_no_packaged_face_has_are_reported_with_where_they_appear() {
        let project = Project::new(json!({"fonts": face(true)}));
        fs::write(project.dir.path().join("scripts/main.luau"), SCRIPT.replace("\"文\"", "\"文缺\"")).unwrap();
        let message = format!("{:#}", project.export("rejected", false).unwrap_err());
        assert!(message.contains("UI_FONT_GLYPHS_MISSING") && message.contains("U+7F3A [scripts/main.luau:2]"), "{message}");
        assert!(!project.dir.path().join("rejected").exists(), "a failed export writes nothing");

        project.presentation(json!({"fonts": face(true), "font_subset": {"missing": "warn"}}));
        let (_, report) = project.export("warned", false).unwrap();
        assert_eq!(report["font_subset"]["missing"], json!([{"code": "U+7F3A", "char": "缺", "sources": ["scripts/main.luau:2"]}]));
        assert_eq!(report["font_subset"]["faces"][0]["missing"], json!([{"code": "U+7F3A", "char": "缺"}]));
        let warnings = diagnostics(&report);
        assert_eq!(warnings.len(), 1);
        assert_eq!(warnings[0].code, "UI_FONT_GLYPHS_MISSING");
        assert!(warnings[0].explanation.contains("U+7F3A"));

        project.presentation(json!({"fonts": face(true), "font_subset": {"ignore_missing": "缺"}}));
        let (_, report) = project.export("ignored", false).unwrap();
        assert_eq!(report["font_subset"]["missing"], json!([]));
        assert!(diagnostics(&report).is_empty());

        fs::write(project.dir.path().join("scripts/main.luau"), SCRIPT).unwrap();
        fs::write(project.dir.path().join("data/player-names.txt"), "文\n字缺\n").unwrap();
        project.presentation(json!({"fonts": face(true), "font_subset": {"runtime_text_files": ["data/player-names.txt"]}}));
        let message = format!("{:#}", project.export("runtime-missing", false).unwrap_err());
        assert!(message.contains("U+7F3A [data/player-names.txt:2]"), "{message}");

        // A character another packaged face has is not missing, though the
        // subset face lacks it.
        fs::write(project.dir.path().join("scripts/main.luau"), SCRIPT.replace("\"文\"", "\"文\u{0627}\"")).unwrap();
        fs::write(project.dir.path().join("fonts/arabic.ttf"), fixture::font(fixture::Options { arabic: true, ..Default::default() })).unwrap();
        project.presentation(json!({"fonts": [{"family": "Fixture", "source": "fonts/a.ttf", "subset": true},
            {"family": "Fallback", "source": "fonts/arabic.ttf"}]}));
        let (_, report) = project.export("fallback", false).unwrap();
        assert_eq!(report["font_subset"]["missing"], json!([]));
        assert_eq!(report["font_subset"]["faces"][0]["missing_count"], 1);
        assert_eq!((report["font_subset"]["faces"][1]["subset"].as_bool(), report["font_subset"]["faces"][1]["missing_count"].as_u64()), (Some(false), Some(0)));
    }

    #[test]
    fn a_variable_face_ships_one_static_instance_per_declared_weight() {
        let fonts = json!([
            {"family": "Fixture", "source": "fonts/a.ttf", "weight": 400, "subset": true},
            {"family": "Fixture", "source": "fonts/a.ttf", "weight": 900, "subset": true},
            {"family": "Alias", "source": "fonts/a.ttf", "weight": 900, "subset": true}]);
        let project = Project::new(json!({"fonts": fonts}));
        fs::write(project.dir.path().join("fonts/a.ttf"), fixture::font(fixture::Options { variable: true, ..Default::default() })).unwrap();
        let (output, report) = project.export("instances", false).unwrap();
        assert!(!output.join("content/fonts/a.ttf").exists(), "the whole variable font is not shipped");
        let presentation: Value = serde_json::from_slice(&fs::read(output.join("content/presentation.json")).unwrap()).unwrap();
        let sources: Vec<&str> = presentation["ui"]["fonts"].as_array().unwrap().iter().map(|face| face["source"].as_str().unwrap()).collect();
        assert_eq!(sources, ["fonts/a.w400.ttf", "fonts/a.w900.ttf", "fonts/a.w900.ttf"]);
        for (row, weight) in report["font_subset"]["faces"].as_array().unwrap().iter().zip([400u16, 900]) {
            let path = format!("fonts/a.w{weight}.ttf");
            assert_eq!((row["output"].as_str(), row["instance"]["wght"].as_u64()), (Some(path.as_str()), Some(u64::from(weight))));
            let bytes = fs::read(output.join("content").join(&path)).unwrap();
            assert!(!truetype_subset::is_variable(&bytes));
            assert_eq!(ttf_parser::Face::parse(&bytes, 0).unwrap().weight().to_number(), weight);
            assert_eq!(coverage(&bytes).unwrap(), ['A', 'Z', '文', '字', '\u{20000}'].into());
        }
        assert_eq!(report["font_subset"]["faces"][1]["faces"], json!(["Fixture 900", "Alias 900"]));

        // Development keeps the variable font whole, under its own name.
        let (output, _) = project.export("instances-development", true).unwrap();
        assert!(output.join("content/fonts/a.ttf").exists());
        let presentation = fs::read_to_string(output.join("content/presentation.json")).unwrap();
        assert!(!presentation.contains(".w400."), "{presentation}");
    }

    #[test]
    fn projects_that_do_not_mark_a_face_export_exactly_as_before() {
        let project = Project::new(json!({"fonts": face(false)}));
        // Even text no face has is not checked when no face asks for a subset.
        fs::write(project.dir.path().join("scripts/main.luau"), SCRIPT.replace("\"文\"", "\"缺\"")).unwrap();
        let (output, report) = project.export("plain", false).unwrap();
        assert_eq!(fs::read(output.join("content/fonts/a.ttf")).unwrap(), fs::read(project.dir.path().join("fonts/a.ttf")).unwrap());
        assert!(report.get("font_subset").is_none());
        let presentation: Value = serde_json::from_slice(&fs::read(output.join("content/presentation.json")).unwrap()).unwrap();
        assert_eq!(presentation["ui"]["fonts"], json!([{"family": "Fixture", "source": "fonts/a.ttf", "weight": 400}]));
    }

    #[test]
    fn text_that_needs_opentype_layout_keeps_its_face_whole() {
        let project = Project::new(json!({"fonts": face(true)}));
        let shaped = fixture::font(fixture::Options { arabic: true, extra_tables: vec![(*b"GSUB", vec![0; 10])], ..Default::default() });
        fs::write(project.dir.path().join("fonts/a.ttf"), shaped).unwrap();
        fs::write(project.dir.path().join("scripts/main.luau"), SCRIPT.replace("\"文\"", "\"\u{0627}\"")).unwrap();
        let message = format!("{:#}", project.export("shaped", false).unwrap_err());
        assert!(message.contains("UI_FONT_SUBSET_SHAPING_UNSUPPORTED") && message.contains("U+0627"), "{message}");
        project.presentation(json!({"fonts": face(false)}));
        project.export("whole", false).unwrap();
    }

    #[test]
    fn subset_declarations_are_validated() {
        for (ui, code) in [
            (json!({"fonts": [{"family": "A", "source": "fonts/a.ttf", "subset": true}, {"family": "B", "source": "fonts/a.ttf"}]}), "UI_FONT_SUBSET_CONFLICT"),
            (json!({"font_source": "fonts/a.ttf", "font_family": "A", "fonts": [{"family": "B", "source": "fonts/a.ttf", "subset": true}]}), "UI_FONT_SUBSET_CONFLICT"),
            (json!({"fonts": face(false), "font_subset": {"runtime_text": "中"}}), "UI_FONT_SUBSET_UNUSED"),
            (json!({"fonts": face(true), "font_subset": {"runtime_text_files": ["../names.txt"]}}), "UI_FONT_SUBSET_PATH_INVALID"),
        ] {
            let ui: PresentationUi = serde_json::from_value(ui).unwrap();
            let message = ui.validate_fonts().unwrap_err().to_string();
            assert!(message.contains(code), "expected {code}: {message}");
        }
        for invalid in [json!({"font_subset": {"missing": "ignore"}}), json!({"font_subset": {"runtime_txt": "x"}})] {
            assert!(serde_json::from_value::<PresentationUi>(invalid).is_err(), "unknown settings fail");
        }
    }
}
