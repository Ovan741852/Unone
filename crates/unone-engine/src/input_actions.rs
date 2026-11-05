//! Which names `api.input` can report, and the diagnostic for one that nothing
//! can produce.
//!
//! Action names are plain strings, so `isDown("Rigth")` is not an error, it is a
//! condition that is never true, and a test feeding the same spelling passes
//! while no key on any host can trigger it. A name is real when a host key
//! produces it, a UI node publishes it, or the project declares it in
//! `input_actions`. A project without that list gets warnings rather than a
//! failed run, so declaring the list, even empty, is what makes these errors.
use crate::diagnostics::{ActionSuggestion, Diagnostic, DiagnosticSeverity, SourceLocation};
use crate::project::{InputFrame, ProjectConfig};
use crate::ui::{UiNode, UiTree};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::sync::Arc;

/// Names official hosts send for keys and extra pointer buttons, beyond A-Z and
/// 0-9 (web/shared/player-input.js, web/player/main.js, unone-native-player).
/// The Arrow names are browser codes, which Web hosts send as aliases, as they
/// do KeyA and Digit1.
const HOST_KEYS: [&str; 32] = [
    "Left", "Right", "Up", "Down", "Space", "Enter", "Escape", "Insert", "Home", "PageUp", "Delete", "PageDown",
    "ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight", "AltLeft", "AltRight", "Minus", "Equal",
    "Numpad8", "Numpad2", "Numpad4", "Numpad6", "Numpad7", "Numpad9", "MouseRight", "MouseMiddle",
    "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown",
];
const READERS: [&str; 3] = ["isDown", "wasPressed", "wasReleased"];
const LISTED_NAMES: usize = 8;
const FACT_NAMES: usize = 50;

fn is_host_key(name: &str) -> bool {
    let single = |text: &str, valid: fn(&u8) -> bool| text.len() == 1 && valid(&text.as_bytes()[0]);
    HOST_KEYS.contains(&name)
        || single(name, |c| c.is_ascii_uppercase() || c.is_ascii_digit())
        || name.strip_prefix("Key").is_some_and(|rest| single(rest, u8::is_ascii_uppercase))
        || name.strip_prefix("Digit").is_some_and(|rest| single(rest, u8::is_ascii_digit))
}

fn is_declared(name: &str, config: &ProjectConfig) -> bool {
    config.input_actions.iter().flatten().any(|entry| match entry.strip_suffix('*') {
        Some(prefix) => name.starts_with(prefix),
        None => entry == name,
    })
}

/// `input_actions` entries are names or `Prefix*` families. A bare `*` would
/// declare everything, which is the same as not checking.
pub(crate) fn validate_declared(config: &ProjectConfig) -> Result<(), Box<Diagnostic>> {
    for entry in config.input_actions.iter().flatten() {
        let body = entry.strip_suffix('*').unwrap_or(entry);
        if body.is_empty() || body.contains('*') {
            return Err(Box::new(Diagnostic::error(
                "INPUT_ACTIONS_INVALID",
                "project.unone.json input_actions has an invalid entry",
                format!("'{entry}' is not an action name or a family like \"Debug_*\": the * may only end a non-empty prefix."),
            )));
        }
    }
    Ok(())
}

/// Splits a trailing identifier off `text`.
fn trailing_identifier(text: &str) -> (&str, &str) {
    let start = text.char_indices().rev()
        .take_while(|(_, c)| c.is_alphanumeric() || *c == '_')
        .last().map_or(text.len(), |(index, _)| index);
    text.split_at(start)
}

/// Does the literal stand alone in `<something>input.isDown(...)`? A literal
/// followed by anything else (`"Debug_" .. name`) is not the whole name.
fn is_input_read(before: &str, after: &str) -> bool {
    if !after.trim_start().starts_with(')') { return false; }
    let Some(call) = before.strip_suffix('(') else { return false };
    let (rest, method) = trailing_identifier(call.trim_end());
    if !READERS.contains(&method) { return false; }
    let Some(rest) = rest.trim_end().strip_suffix('.') else { return false };
    trailing_identifier(rest.trim_end()).1.to_ascii_lowercase().contains("input")
}

/// Does `before` end with `action =`, as a UI node's field does?
fn is_action_field(before: &str) -> bool {
    let Some(rest) = before.strip_suffix('=') else { return false };
    !rest.ends_with(['=', '~', '<', '>']) && trailing_identifier(rest.trim_end()).1 == "action"
}

/// Literal action names in a project's scripts. This sees branches a run never
/// reaches; a run sees names built at runtime. Each covers what the other cannot.
#[derive(Debug, Default)]
pub(crate) struct ScriptActions {
    reads: BTreeMap<String, Vec<(String, u32)>>,
    published: BTreeSet<String>,
    /// Prefixes of `action = "Buy_" .. id`: every name they start is published.
    published_families: BTreeSet<String>,
}

impl ScriptActions {
    pub(crate) fn scan(&mut self, file: &Path, source: &str) {
        crate::script_data::for_each_literal(source, |literal| {
            let Some(name) = literal.text else { return };
            let before = source[..literal.start].trim_end();
            if is_input_read(before, &source[literal.end..]) {
                self.reads.entry(name.to_string()).or_default()
                    .push((file.display().to_string(), literal.line as u32));
            } else if is_action_field(before) {
                if !source[literal.end..].trim_start().starts_with("..") {
                    self.published.insert(name.to_string());
                } else if !name.is_empty() {
                    self.published_families.insert(name.to_string());
                }
            }
        });
    }

    fn is_published(&self, name: &str) -> bool {
        self.published.contains(name) || self.published_families.iter().any(|prefix| name.starts_with(prefix.as_str()))
    }

    /// Names these scripts read that nothing can produce.
    pub(crate) fn diagnostic(&self, config: &ProjectConfig) -> Option<Diagnostic> {
        let unknown = self.reads.iter()
            .filter(|(name, _)| !is_host_key(name) && !is_declared(name, config) && !self.is_published(name))
            .map(|(name, sites)| Unknown { name: name.clone(), sites: sites.clone(), runtime_read: false, fed: false })
            .collect();
        unknown_diagnostic(config, unknown, &self.published)
    }
}

/// What one run fed and what its UI published.
#[derive(Debug, Default)]
pub(crate) struct RunActions {
    fed: BTreeSet<String>,
    published: BTreeSet<String>,
    last_ui: Option<(usize, u64)>,
}

impl RunActions {
    pub(crate) fn new<'a>(held: impl Iterator<Item = &'a String>, sequence: Option<&[InputFrame]>) -> Self {
        let mut fed: BTreeSet<String> = held.cloned().collect();
        for frame in sequence.into_iter().flatten() {
            fed.extend(frame.actions.keys().cloned());
        }
        Self { fed, ..Self::default() }
    }

    /// Walks a tree once; most ticks republish nothing.
    pub(crate) fn note_ui(&mut self, tree: Option<&Arc<UiTree>>) {
        let Some(tree) = tree else { return };
        let identity = (Arc::as_ptr(tree) as usize, tree.publication);
        if self.last_ui == Some(identity) { return; }
        self.last_ui = Some(identity);
        collect_ui_actions(&tree.children, &mut self.published);
    }

    /// Names this run read or fed that nothing can produce. Names a run's UI did
    /// not publish may belong to a screen it never reached, so the scripts'
    /// literal `action =` fields count too; `scripts` reads them only if needed.
    pub(crate) fn diagnostic(
        &self,
        config: &ProjectConfig,
        reads: &BTreeSet<String>,
        scripts: impl FnOnce() -> ScriptActions,
    ) -> Option<Diagnostic> {
        let suspects: Vec<&String> = reads.union(&self.fed)
            .filter(|name| !is_host_key(name) && !is_declared(name, config) && !self.published.contains(*name))
            .collect();
        if suspects.is_empty() { return None; }
        let scripts = scripts();
        let unknown = suspects.into_iter()
            .filter(|name| !scripts.is_published(name))
            .map(|name| Unknown {
                name: name.clone(),
                sites: scripts.reads.get(name).cloned().unwrap_or_default(),
                runtime_read: reads.contains(name),
                fed: self.fed.contains(name),
            })
            .collect();
        let published = self.published.union(&scripts.published).cloned().collect();
        unknown_diagnostic(config, unknown, &published)
    }
}

fn collect_ui_actions(nodes: &[UiNode], actions: &mut BTreeSet<String>) {
    for node in nodes {
        match node {
            UiNode::InputRegion { action, .. } | UiNode::Button { action, .. }
            | UiNode::Slider { action, .. } | UiNode::ComboBox { action, .. } => {
                actions.insert(action.clone());
            }
            UiNode::Component { children, .. } | UiNode::ScrollView { children, .. } => {
                collect_ui_actions(children, actions);
            }
            _ => {}
        }
    }
}

struct Unknown {
    name: String,
    sites: Vec<(String, u32)>,
    runtime_read: bool,
    fed: bool,
}

impl Unknown {
    fn origin(&self) -> String {
        match (self.sites.first(), self.fed, self.runtime_read) {
            (Some((file, line)), _, _) => format!("read at {file}:{line}"),
            (None, true, true) => "fed by this run's input and read by a script".to_string(),
            (None, true, false) => "fed by this run's input".to_string(),
            (None, false, _) => "read by a script".to_string(),
        }
    }
}

fn unknown_diagnostic(config: &ProjectConfig, unknown: Vec<Unknown>, published: &BTreeSet<String>) -> Option<Diagnostic> {
    let first = unknown.first()?;
    let known: Vec<&str> = HOST_KEYS.iter().copied()
        .chain(config.input_actions.iter().flatten().map(String::as_str).filter(|entry| !entry.ends_with('*')))
        .chain(published.iter().map(String::as_str))
        .collect();
    let closest = |name: &str| crate::suggest::misspellings(name, known.iter().copied(), 2);
    let listed: Vec<String> = unknown.iter().take(LISTED_NAMES).map(|item| {
        let spelling = closest(&item.name).iter().map(|name| format!("'{name}'")).collect::<Vec<_>>().join(" or ");
        let hint = if spelling.is_empty() { String::new() } else { format!("; did you mean {spelling}?") };
        format!("'{}' ({}{hint})", item.name, item.origin())
    }).collect();
    let more = unknown.len().saturating_sub(LISTED_NAMES);
    let names = if more > 0 { format!("{} and {more} more", listed.join(", ")) } else { listed.join(", ") };
    let summary = if unknown.len() == 1 {
        format!("Input action '{}' can never fire", first.name)
    } else {
        format!("{} input actions can never fire", unknown.len())
    };
    let contract = if unknown.len() == 1 {
        "no host key, UI node or project.unone.json input_actions entry produces this name, so it is never down or pressed."
    } else {
        "no host key, UI node or project.unone.json input_actions entry produces these names, so they are never down or pressed."
    };
    let mut diagnostic = if config.input_actions.is_some() {
        Diagnostic::error("INPUT_ACTION_UNKNOWN", summary, format!("{names}: {contract}"))
    } else {
        Diagnostic::warning("INPUT_ACTION_UNKNOWN", summary, format!(
            "{names}: {contract} This is a warning only because the project declares no input_actions; declaring the list, even empty, makes it an error."
        ))
    };
    diagnostic.facts = serde_json::json!({
        "total": unknown.len(),
        "names": unknown.iter().take(FACT_NAMES).map(|item| serde_json::json!({
            "name": item.name,
            "sites": item.sites.iter().take(5).map(|(file, line)| format!("{file}:{line}")).collect::<Vec<_>>(),
            "read": item.runtime_read || !item.sites.is_empty(),
            "fed": item.fed,
            "did_you_mean": closest(&item.name),
        })).collect::<Vec<_>>(),
    });
    diagnostic.source = first.sites.first().map(|(file, line)| SourceLocation {
        file: file.clone(),
        line: Some(*line),
        column: None,
    });
    diagnostic.suggested_actions = vec![ActionSuggestion {
        action: "fix_or_declare_action".to_string(),
        description: format!(
            "Fix the spelling, or for a name of the game's own add it to project.unone.json: \"input_actions\": [\"{}\"] (a trailing * declares a family; check cannot see a UI action built at runtime, so declare those too). Keys are Left Right Up Down Space Enter Escape, A-Z, 0-9 and the others listed by game api describe input.isDown.",
            first.name
        ),
        command: Some("game api describe input.isDown".to_string()),
    }];
    Some(diagnostic)
}

pub(crate) fn is_error(diagnostic: &Diagnostic) -> bool {
    matches!(diagnostic.severity, DiagnosticSeverity::Error)
}

/// One warning for a test suite: cases differ only in which names they happened
/// to reach, so the case that reached the most stands for the rest.
pub(crate) fn suite_warning(warnings: Vec<Diagnostic>) -> Option<Diagnostic> {
    let cases = warnings.len();
    let mut widest = warnings.into_iter().max_by_key(|warning| warning.facts["total"].as_u64().unwrap_or(0))?;
    widest.facts["cases_reporting"] = cases.into();
    Some(widest)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(input_actions: Option<&[&str]>) -> ProjectConfig {
        ProjectConfig {
            input_actions: input_actions.map(|names| names.iter().map(|name| name.to_string()).collect()),
            ..ProjectConfig::default()
        }
    }

    fn scan(source: &str) -> ScriptActions {
        let mut actions = ScriptActions::default();
        actions.scan(Path::new("main.luau"), source);
        actions
    }

    #[test]
    fn every_key_a_web_host_sends_is_a_key_name() {
        let source = include_str!("../../../web/shared/player-input.js");
        let table = source.split_once("namedKeys={").unwrap().1.split_once("};").unwrap().0;
        let mut seen = 0;
        for pair in table.split(',') {
            let (code, name) = pair.trim().split_once(':').unwrap();
            let name = name.trim_matches('\'');
            assert!(is_host_key(code) && is_host_key(name), "{code}:{name} is missing from HOST_KEYS");
            seen += 1;
        }
        assert!(seen >= 26, "the table was not parsed: {seen}");
        for name in ["A", "Z", "0", "9", "KeyW", "Digit1", "MouseRight"] { assert!(is_host_key(name), "{name}"); }
        for name in ["a", "Rigth", "Tab", "F1", "Key", "KeyAB", "Digit", "Digit10", ""] { assert!(!is_host_key(name), "{name}"); }
    }

    #[test]
    fn scripts_are_scanned_for_literal_reads_and_published_actions_only() {
        let actions = scan(r#"
            -- api.input.isDown("InComment")
            local a = api.input.isDown("Rigth")
            local b = input.wasPressed( "Shop" )
            local c = gameInput . wasReleased ("Pause")
            local d = keys.isDown("NotInput")
            local e = api.input.isDown("Dyn_" .. name)
            local f = api.input.isDown(name)
            local g = text == "Rigth" or action == "Compared"
            kit.button({id = "buy", action = "Shop", text = "isDown"})
            kit.button({id = "row", action = "Row_" .. id, text = "t"})
            kit.button({id = "any", action = "" .. id, text = "t"})
        "#);
        assert_eq!(actions.reads.keys().map(String::as_str).collect::<Vec<_>>(), ["Pause", "Rigth", "Shop"]);
        assert_eq!(actions.reads["Rigth"], [("main.luau".to_string(), 3)]);
        assert_eq!(actions.published.iter().map(String::as_str).collect::<Vec<_>>(), ["Shop"]);
        assert!(actions.is_published("Row_3") && actions.is_published("Shop"));
        assert!(!actions.is_published("Rigth") && !actions.is_published("Row"), "an empty prefix declares nothing");
    }

    #[test]
    fn a_typo_warns_until_the_project_declares_its_actions_then_it_fails() {
        let actions = scan(r#"local a = api.input.isDown("Rigth") or api.input.isDown("Right")"#);
        let warning = actions.diagnostic(&config(None)).unwrap();
        assert!(!is_error(&warning));
        assert!(warning.explanation.contains("did you mean 'Right'"), "{}", warning.explanation);
        assert!(warning.explanation.contains("main.luau:1"), "{}", warning.explanation);
        assert_eq!(warning.source.as_ref().unwrap().line, Some(1));
        assert_eq!(warning.facts["names"][0]["did_you_mean"][0], "Right");
        let error = actions.diagnostic(&config(Some(&[]))).unwrap();
        assert!(is_error(&error));
        assert!(actions.diagnostic(&config(Some(&["Rigth"]))).is_none());
        assert!(actions.diagnostic(&config(Some(&["Rig*"]))).is_none());
    }

    #[test]
    fn a_run_checks_what_it_read_and_fed_against_its_ui_and_the_scripts() {
        let frames = [InputFrame { actions: [("Fed".to_string(), true), ("Space".to_string(), true)].into(), ..InputFrame::default() }];
        let held = ["Held".to_string()];
        let mut run = RunActions::new(held.iter(), Some(&frames));
        let reads: BTreeSet<String> = ["Later", "Published", "Right"].map(String::from).into();
        let tree = crate::ui::UiNode::Button {
            id: "b".into(),
            rect: serde_json::from_value(serde_json::json!({"x":0,"y":0,"width":1,"height":1})).unwrap(),
            text: "t".into(),
            action: "Published".into(),
            style: None,
        };
        collect_ui_actions(std::slice::from_ref(&tree), &mut run.published);
        let names = |diagnostic: Diagnostic| -> Vec<String> {
            diagnostic.facts["names"].as_array().unwrap().iter().map(|n| n["name"].as_str().unwrap().to_string()).collect()
        };
        let reported = run.diagnostic(&config(Some(&[])), &reads, || scan(r#"local x = {action = "Later"}"#)).unwrap();
        assert_eq!(names(reported), ["Fed", "Held"], "a screen not reached still counts through its literal action");
        let reported = run.diagnostic(&config(Some(&[])), &reads, ScriptActions::default).unwrap();
        assert_eq!(names(reported), ["Fed", "Held", "Later"]);
        let declared = config(Some(&["Fed", "Held", "Later"]));
        assert!(run.diagnostic(&declared, &reads, || panic!("scripts are read only when a name is still unknown")).is_none());
    }

    #[test]
    fn declarations_are_names_or_prefix_families() {
        assert!(validate_declared(&config(None)).is_ok());
        assert!(validate_declared(&config(Some(&["Jump", "Debug_*"]))).is_ok());
        for bad in ["*", "", "a*b", "**"] {
            let error = validate_declared(&config(Some(&[bad]))).unwrap_err();
            assert_eq!(error.code, "INPUT_ACTIONS_INVALID", "{bad}");
        }
    }
}
