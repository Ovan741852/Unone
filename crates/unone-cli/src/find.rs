//! `game find "<need>"`: look for an existing way to meet a need before
//! writing new code. Sources, in the order to prefer them: engine APIs,
//! built-in render passes and systems, bundled runtime packages, local plugins,
//! and the plugin marketplace (Koncrate, through its local Viewer). Nothing is
//! installed, enabled or called; every candidate names its next step.
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{Value, json};
use unone_engine::{ActionSuggestion, Diagnostic, DiagnosticSeverity, EngineResult};

use crate::marketplace::{self, Search};

const DEFAULT_LIMIT: usize = 5;
const MAX_LIMIT: usize = 20;
pub const POLICY: &str = "Prefer, in order: an engine API, render pass or system; an official runtime package; a local plugin; a marketplace plugin. Write new code only when none fits, and say which candidates you rejected and why.";

/// Words that carry no need of their own.
const FILLER: &[&str] = &[
    "a", "an", "the", "to", "of", "for", "in", "on", "at", "by", "with", "and", "or", "my", "me", "i", "we", "you", "it", "is", "are", "be",
    "want", "need", "needs", "make", "add", "adding", "how", "do", "does", "use", "using", "can", "should", "would", "like", "some", "get",
    "into", "that", "this", "these", "please", "game", "games", "api", "engine", "unone", "support", "supports", "have", "has", "there", "any",
];

#[derive(Debug, Clone)]
pub enum Marketplace {
    /// Skipped: "offline" (--offline) or "disabled" (UNONE_MARKETPLACE=off).
    Off(&'static str),
    /// The Koncrate Viewer described by this development-tools.json.
    Koncrate(Option<PathBuf>),
}

impl Marketplace {
    /// `--offline`, then UNONE_MARKETPLACE=off, then the Koncrate Viewer
    /// endpoint at UNONE_KONCRATE_ENDPOINT or its documented location
    /// `%APPDATA%/Koncrate Viewer Development/development-tools.json`.
    pub fn from_env(offline: bool) -> Self {
        if offline {
            return Self::Off("offline");
        }
        if std::env::var("UNONE_MARKETPLACE").is_ok_and(|value| value.eq_ignore_ascii_case("off")) {
            return Self::Off("disabled");
        }
        let file = std::env::var_os("UNONE_KONCRATE_ENDPOINT").map(PathBuf::from).or_else(|| {
            std::env::var_os("APPDATA").map(|dir| PathBuf::from(dir).join("Koncrate Viewer Development").join("development-tools.json"))
        });
        Self::Koncrate(file)
    }
}

#[derive(Debug, Serialize)]
pub struct FindReport {
    pub need: String,
    pub policy: &'static str,
    /// Ranked within each source; sources appear in the order to prefer them.
    pub candidates: Vec<Candidate>,
    pub sources: BTreeMap<&'static str, SourceStatus>,
}

#[derive(Debug, Serialize)]
pub struct Candidate {
    /// engine_api, render_pass, system, package, plugin or marketplace.
    pub source: &'static str,
    pub id: String,
    pub summary: String,
    /// strong: the whole need, a keyword or every word matched; weak: only
    /// some words did, so it may not do what was asked.
    pub confidence: &'static str,
    /// The keywords or words of the need that matched.
    pub matched: Vec<String>,
    pub next: Next,
    /// The marketplace entry as the catalogue returned it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

#[derive(Debug, Serialize)]
pub struct Next {
    /// `game` arguments to run next, when the next step is a game command.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub argv: Option<Vec<String>>,
    pub note: String,
}

#[derive(Debug, Serialize)]
pub struct SourceStatus {
    /// ok, offline, disabled, not_connected, auth_required, unavailable or error.
    pub status: &'static str,
    pub matches: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

fn status(status: &'static str, matches: usize, detail: Option<String>) -> SourceStatus {
    SourceStatus { status, matches, detail }
}

fn argv(parts: &[&str]) -> Option<Vec<String>> {
    Some(parts.iter().map(|part| part.to_string()).collect())
}

/// The need, lowercased, and its meaningful words.
struct Query {
    lower: String,
    terms: Vec<String>,
}

impl Query {
    fn new(need: &str) -> Self {
        let lower = need.to_lowercase();
        let mut terms: Vec<String> = Vec::new();
        for word in lower.split(|c: char| c.is_whitespace() || (c.is_ascii_punctuation() && c != '-')) {
            let word = word.trim_matches('-');
            let meaningful = if word.is_ascii() { word.len() >= 2 && !FILLER.contains(&word) } else { !word.is_empty() };
            if meaningful && !terms.iter().any(|term| term == word) {
                terms.push(word.to_string());
            }
        }
        Self { lower, terms }
    }

    /// strong when `decisive` (a whole-need or keyword hit) or every word of
    /// the need is among `matched`.
    fn confidence(&self, decisive: bool, matched: &[String]) -> &'static str {
        let every = !self.terms.is_empty() && self.terms.iter().all(|term| matched.contains(term));
        if decisive || every { "strong" } else { "weak" }
    }

    /// Keyword hits (3 each: the phrase is in the need) plus words of the need
    /// found in `text` (1 each).
    fn score(&self, keywords: &[&str], text: &str) -> (u32, Vec<String>) {
        let mut score = 0;
        let mut matched: Vec<String> = Vec::new();
        for keyword in keywords {
            let keyword = keyword.to_lowercase();
            let hit = if keyword.is_ascii() { contains_word(&self.lower, &keyword, true) } else { self.lower.contains(&keyword) };
            if hit && !matched.contains(&keyword) {
                score += 3;
                matched.push(keyword);
            }
        }
        let text = text.to_lowercase();
        for term in &self.terms {
            let counted = matched.iter().any(|keyword| keyword.split(' ').any(|word| word == term));
            let useful = !term.is_ascii() || term.len() >= 3;
            if !counted && useful && contains_word(&text, term, false) {
                score += 1;
                matched.push(term.clone());
            }
        }
        (score, matched)
    }
}

/// Whether `needle` occurs in `hay` starting at a word boundary, and, when
/// `whole`, ending at one too. Non-ASCII needles match anywhere.
fn contains_word(hay: &str, needle: &str, whole: bool) -> bool {
    if needle.is_empty() {
        return false;
    }
    if !needle.is_ascii() {
        return hay.contains(needle);
    }
    let word = |c: Option<char>| c.is_some_and(|c| c.is_ascii_alphanumeric());
    hay.match_indices(needle).any(|(start, _)| {
        let before = hay[..start].chars().next_back();
        let after = hay[start + needle.len()..].chars().next();
        !word(before) && (!whole || !word(after))
    })
}

fn engine_apis(query: &Query, need: &str, limit: usize) -> Vec<Candidate> {
    let mut found: BTreeMap<String, (u32, unone_engine::ApiDescriptor, Vec<String>)> = BTreeMap::new();
    // The whole need first, then each word on its own for broader recall.
    let whole = unone_engine::api_search(need);
    let count = whole.len() as u32;
    for (rank, descriptor) in whole.into_iter().enumerate() {
        found.insert(descriptor.name.clone(), (20 + count - rank as u32, descriptor, vec![need.trim().to_string()]));
    }
    for term in &query.terms {
        for descriptor in unone_engine::api_search(term).into_iter().take(8) {
            let entry = found.entry(descriptor.name.clone()).or_insert_with(|| (0, descriptor, Vec::new()));
            entry.0 += 1;
            if !entry.2.contains(term) {
                entry.2.push(term.clone());
            }
        }
    }
    let mut ranked: Vec<_> = found.into_values().collect();
    ranked.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.name.cmp(&b.1.name)));
    ranked
        .into_iter()
        .take(limit)
        .map(|(_, descriptor, matched)| Candidate {
            source: "engine_api",
            confidence: query.confidence(matched.iter().any(|word| word == need.trim()), &matched),
            next: Next { argv: argv(&["api", "describe", &descriptor.name]), note: "Describe it, then call it from project Luau.".into() },
            id: descriptor.name,
            summary: descriptor.purpose,
            matched,
            details: None,
        })
        .collect()
}

fn render_passes(query: &Query, limit: usize) -> Vec<Candidate> {
    let mut ranked: Vec<_> = unone_engine::RENDER_PASS_GUIDE
        .iter()
        .filter_map(|guide| {
            let (score, matched) = query.score(guide.keywords, guide.summary);
            // A keyword must hit: summary words alone are too weak for passes.
            (score >= 3).then_some((score, guide, matched))
        })
        .collect();
    ranked.sort_by(|a, b| b.0.cmp(&a.0));
    ranked
        .into_iter()
        .take(limit)
        .map(|(_, guide, matched)| Candidate {
            source: "render_pass",
            confidence: "strong",
            id: guide.kind.to_string(),
            summary: format!("{} Params: {}.", guide.summary, guide.params),
            matched,
            next: Next {
                argv: argv(&["api", "describe", "render.setPass"]),
                note: format!(
                    "Declare {{\"id\": \"{0}\", \"kind\": \"{0}\"}} in project.unone.json render_pipeline (docs/render-pipeline.md), then tune it with api.render.setPass.",
                    guide.kind
                ),
            },
            details: None,
        })
        .collect()
}

fn systems(query: &Query, limit: usize) -> Vec<Candidate> {
    let mut found: BTreeMap<String, (u32, unone_engine::SystemDescriptor, Vec<String>)> = BTreeMap::new();
    for term in &query.terms {
        for system in unone_engine::search_systems(term) {
            let entry = found.entry(system.id.clone()).or_insert_with(|| (0, system, Vec::new()));
            entry.0 += 1;
            entry.2.push(term.clone());
        }
    }
    let mut ranked: Vec<_> = found.into_values().collect();
    ranked.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.id.cmp(&b.1.id)));
    ranked
        .into_iter()
        .take(limit)
        .map(|(_, system, matched)| Candidate {
            source: "system",
            confidence: query.confidence(false, &matched),
            next: Next { argv: argv(&["systems", "list"]), note: format!("Check that this project enables '{}'.", system.id) },
            id: system.id,
            summary: system.summary,
            matched,
            details: None,
        })
        .collect()
}

fn packages(query: &Query, apis: &[Candidate]) -> Vec<Candidate> {
    unone_engine::runtime_package_manifests()
        .into_iter()
        .filter_map(|manifest| {
            let name = manifest["name"].as_str()?.to_string();
            let version = manifest["version"].as_str()?.to_string();
            let namespace = manifest["api"].as_str()?.trim_start_matches("api.").to_string();
            let by_api = apis.iter().filter(|api| api.id.starts_with(&format!("{namespace}."))).map(|api| api.id.clone()).collect::<Vec<_>>();
            let (score, mut matched) = query.score(&[name.as_str(), name.trim_start_matches("@unone/")], &namespace);
            if by_api.is_empty() && score == 0 {
                return None;
            }
            let strong = score >= 3 || apis.iter().any(|api| by_api.contains(&api.id) && api.confidence == "strong");
            matched.extend(by_api);
            let info = format!("{namespace}.info");
            Some(Candidate {
                source: "package",
                confidence: if strong { "strong" } else { "weak" },
                summary: format!("Official pure Luau package {name} {version} (api.{namespace}), bundled with the engine."),
                next: Next {
                    argv: argv(&["api", "describe", &info]),
                    note: format!("Declare \"runtime_packages\": {{\"{name}\": \"{version}\"}} in project.unone.json."),
                },
                id: name,
                matched,
                details: None,
            })
        })
        .collect()
}

fn plugins(query: &Query, manifests: &[crate::plugins::PluginManifest], limit: usize) -> Vec<Candidate> {
    let mut ranked: Vec<_> = manifests
        .iter()
        .filter_map(|manifest| {
            let keywords: Vec<&str> = manifest.keywords.iter().chain(&manifest.capabilities).map(String::as_str).collect();
            let mut text = format!("{} {} {}", manifest.id, manifest.name, manifest.description);
            for tool in &manifest.tools {
                text.push_str(&format!(" {} {} {}", tool.name, tool.title.as_deref().unwrap_or(""), tool.description));
            }
            let (score, matched) = query.score(&keywords, &text);
            (score >= 2).then_some((score, manifest, matched))
        })
        .collect();
    ranked.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.id.cmp(&b.1.id)));
    ranked
        .into_iter()
        .take(limit)
        .map(|(score, manifest, matched)| Candidate {
            source: "plugin",
            confidence: query.confidence(score >= 3, &matched),
            id: manifest.id.clone(),
            summary: if manifest.description.is_empty() { manifest.name.clone() } else { manifest.description.clone() },
            matched,
            next: Next { argv: argv(&["plugin", "inspect", "--id", &manifest.id]), note: "Inspect its tools before calling it.".into() },
            details: None,
        })
        .collect()
}

fn marketplace_candidates(results: Vec<Value>, limit: usize) -> Vec<Candidate> {
    results
        .into_iter()
        .take(limit)
        .filter_map(|entry| {
            let id = entry["pluginId"].as_str()?.to_string();
            let name = entry["name"].as_str().unwrap_or(&id).to_string();
            let summary = entry["description"].as_str().or_else(|| entry["summary"].as_str()).map_or(name.clone(), |text| format!("{name}: {text}"));
            Some(Candidate {
                source: "marketplace",
                // The catalogue marks entries covering only part of the query.
                confidence: if entry["coverage"] == "partial" { "weak" } else { "strong" },
                summary,
                matched: Vec::new(),
                next: Next {
                    argv: None,
                    note: format!("Koncrate catalogue entry. Inspect it with plugins.inspect {{\"pluginId\": \"{id}\"}} through the Koncrate Viewer; installing or buying is the user's decision."),
                },
                id,
                details: Some(entry),
            })
        })
        .collect()
}

pub fn find(project: &Path, need: &str, limit: Option<usize>, marketplace: Marketplace) -> EngineResult<FindReport> {
    if need.trim().is_empty() {
        return EngineResult::failure(Diagnostic::error(
            "FIND_NEED_REQUIRED",
            "Say what you need",
            "Pass the need in plain words, such as `game find \"distance fog\"` or `game find \"雙指縮放\"`. To list every engine API, use `game api search \"\"`.",
        ));
    }
    let limit = limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    let query = Query::new(need);
    let mut diagnostics = Vec::new();
    let mut sources = BTreeMap::new();
    let mut candidates = Vec::new();

    let apis = engine_apis(&query, need, limit);
    let passes = render_passes(&query, limit);
    let systems = systems(&query, limit);
    let packages = packages(&query, &apis);
    let (manifests, plugin_diagnostics) = crate::plugins::discover(project);
    diagnostics.extend(plugin_diagnostics);
    let plugins = plugins(&query, &manifests, limit);
    for (name, found) in [("engine_api", &apis), ("render_passes", &passes), ("systems", &systems), ("packages", &packages), ("plugins", &plugins)] {
        sources.insert(name, status("ok", found.len(), None));
    }
    let market = match marketplace {
        Marketplace::Off(reason) => {
            sources.insert("marketplace", status(reason, 0, None));
            Vec::new()
        }
        Marketplace::Koncrate(file) => match marketplace::search(file.as_deref(), need, limit) {
            Search::Found { results, endpoint } => {
                let found = marketplace_candidates(results, limit);
                sources.insert("marketplace", status("ok", found.len(), Some(format!("Koncrate catalogue via the Viewer at {endpoint}"))));
                found
            }
            Search::Failed { status: state, detail } => {
                diagnostics.push(Diagnostic {
                    severity: DiagnosticSeverity::Info,
                    facts: json!({"status": state}),
                    suggested_actions: vec![
                        ActionSuggestion {
                            action: "connect_koncrate".into(),
                            description: "Start the Koncrate Viewer with --development-tools and sign in there; or set UNONE_KONCRATE_ENDPOINT to its development-tools.json.".into(),
                            command: None,
                        },
                        ActionSuggestion {
                            action: "search_offline".into(),
                            description: "Pass --offline to search only this engine and local plugins.".into(),
                            command: Some(format!("game find \"{}\" --offline", need.replace('"', "'"))),
                        },
                    ],
                    ..Diagnostic::warning("FIND_MARKETPLACE_UNREACHED", "The plugin marketplace was not searched", detail.clone())
                });
                sources.insert("marketplace", status(state, 0, Some(detail)));
                Vec::new()
            }
        },
    };
    for found in [apis, passes, systems, packages, plugins, market] {
        candidates.extend(found);
    }
    if !candidates.is_empty() && candidates.iter().all(|candidate| candidate.confidence == "weak") {
        let mut weak = Diagnostic::warning(
            "FIND_WEAK_ONLY",
            "Only partial matches",
            "Every candidate matched only some words of the need, so nothing clearly does this yet. Check them; if none fits, writing it is reasonable.",
        );
        weak.facts = json!({"need": need, "terms": query.terms});
        diagnostics.push(weak);
    }
    if candidates.is_empty() {
        let mut empty = Diagnostic::warning(
            "FIND_EMPTY",
            "Nothing existing matched",
            "No engine API, render pass, system, runtime package, local plugin or marketplace plugin matched. Try other words or another language; if it is still empty, writing it in project Luau is reasonable, and saying you searched helps reviewers.",
        );
        empty.facts = json!({"need": need, "terms": query.terms});
        diagnostics.push(empty);
    }
    let mut result = EngineResult::success(FindReport { need: need.to_string(), policy: POLICY, candidates, sources });
    result.diagnostics = diagnostics;
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(report: &FindReport, source: &str) -> Vec<String> {
        report.candidates.iter().filter(|candidate| candidate.source == source).map(|candidate| candidate.id.clone()).collect()
    }

    fn offline(need: &str) -> FindReport {
        let directory = tempfile::tempdir().unwrap();
        find(directory.path(), need, None, Marketplace::Off("offline")).value.unwrap()
    }

    #[test]
    fn words_match_at_word_starts_and_keywords_as_whole_phrases() {
        assert!(contains_word("add ao please", "ao", true));
        assert!(!contains_word("chaos", "ao", true), "inside a word");
        assert!(!contains_word("aoe damage", "ao", true), "a keyword must end at a boundary");
        assert!(contains_word("particles", "particle", false), "need words may take suffixes");
        assert!(contains_word("加一點霧", "霧", true));
        let query = Query::new("Add some distance FOG to my 3D game");
        assert_eq!(query.terms, ["distance", "fog", "3d"]);
    }

    #[test]
    fn render_passes_are_found_in_english_and_chinese() {
        assert_eq!(ids(&offline("distance fog"), "render_pass"), ["fog"]);
        assert_eq!(ids(&offline("我想要抗鋸齒"), "render_pass"), ["fxaa"]);
        assert!(ids(&offline("vignette when the player is hurt"), "render_pass").contains(&"vignette".to_string()));
        assert!(ids(&offline("chaos"), "render_pass").is_empty(), "no keyword hit inside other words");
    }

    #[test]
    fn engine_apis_lead_to_their_official_package() {
        let report = offline("pinch zoom");
        assert!(ids(&report, "engine_api").contains(&"input.gestures.create".to_string()), "{:?}", ids(&report, "engine_api"));
        assert_eq!(ids(&report, "package"), ["@unone/gestures"]);
        let package = report.candidates.iter().find(|candidate| candidate.source == "package").unwrap();
        assert_eq!(package.next.argv.as_deref(), Some(&["api".to_string(), "describe".into(), "input.gestures.info".into()][..]));
    }

    #[test]
    fn local_plugins_match_their_keywords() {
        let directory = tempfile::tempdir().unwrap();
        let plugin = directory.path().join("plugins/studio.crt");
        std::fs::create_dir_all(&plugin).unwrap();
        std::fs::write(plugin.join("plugin.json"), serde_json::to_string(&json!({
            "api": "unone.plugin.v1", "id": "studio.crt", "name": "CRT look", "version": "1.0.0",
            "description": "Retro screen effects.", "entry": {"command": "node", "args": ["main.mjs"]},
            "keywords": ["crt", "scanlines", "掃描線"]
        })).unwrap()).unwrap();
        let report = find(directory.path(), "掃描線 effect", None, Marketplace::Off("offline")).value.unwrap();
        assert_eq!(ids(&report, "plugin"), ["studio.crt"]);
        assert_eq!(report.sources["marketplace"].status, "offline");
    }

    #[test]
    fn partial_word_matches_are_weak_and_flagged() {
        let directory = tempfile::tempdir().unwrap();
        let result = find(directory.path(), "pathfinding for units", None, Marketplace::Off("offline"));
        let report = result.value.as_ref().unwrap();
        assert!(report.candidates.iter().all(|candidate| candidate.confidence == "weak"), "{:?}", report.candidates);
        assert!(result.diagnostics.iter().any(|diagnostic| diagnostic.code == "FIND_WEAK_ONLY"));
        let strong = offline("explosion particles");
        assert_eq!(strong.candidates[0].confidence, "strong");
    }

    #[test]
    fn an_empty_need_fails_and_an_unmatched_one_says_so() {
        let directory = tempfile::tempdir().unwrap();
        let result = find(directory.path(), "  ", None, Marketplace::Off("offline"));
        assert!(!result.ok && result.diagnostics[0].code == "FIND_NEED_REQUIRED");
        let result = find(directory.path(), "zzqxv blorpt", None, Marketplace::Off("offline"));
        assert!(result.ok && result.value.as_ref().unwrap().candidates.is_empty());
        assert_eq!(result.diagnostics[0].code, "FIND_EMPTY");
    }

    #[test]
    fn an_unreachable_marketplace_is_reported_beside_local_results() {
        let directory = tempfile::tempdir().unwrap();
        let missing = directory.path().join("no-viewer.json");
        let result = find(directory.path(), "fog", None, Marketplace::Koncrate(Some(missing)));
        assert!(result.ok);
        let report = result.value.unwrap();
        assert_eq!(report.sources["marketplace"].status, "not_connected");
        assert_eq!(ids(&report, "render_pass"), ["fog"]);
        let diagnostic = result.diagnostics.iter().find(|diagnostic| diagnostic.code == "FIND_MARKETPLACE_UNREACHED").unwrap();
        assert!(matches!(diagnostic.severity, DiagnosticSeverity::Info));
    }
}
