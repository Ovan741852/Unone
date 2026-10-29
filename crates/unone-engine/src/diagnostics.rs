use serde::{Deserialize, Serialize};

/// A bounded, machine-readable runtime failure. Unlike CLI `Diagnostic`, this
/// record describes one API call and remains independent of canonical state.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EngineDiagnostic {
    pub api_version: u32,
    pub code: String,
    pub operation: String,
    pub message: String,
    pub path: Option<String>,
    pub actual: Option<serde_json::Value>,
    pub expected: Option<serde_json::Value>,
    pub recovery: EngineDiagnosticRecovery,
    pub recoverable: bool,
    pub terminal: bool,
    pub context: EngineDiagnosticContext,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EngineDiagnosticRecovery {
    pub action: String,
    pub retry: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct EngineDiagnosticContext {
    pub frame: u64,
    pub index: Option<u64>,
    pub ticket: Option<u64>,
}

/// Validation sites carry facts independently of their human-readable message.
/// Paths use the public Luau API's one-based array indexing.
#[derive(Debug, Clone)]
pub(crate) struct InputDiagnostic {
    pub message: String,
    pub path: String,
    pub actual: serde_json::Value,
    pub expected: serde_json::Value,
}

impl InputDiagnostic {
    pub fn new(message: impl Into<String>, path: impl Into<String>, actual: serde_json::Value, expected: serde_json::Value) -> Self {
        Self { message: message.into(), path: path.into(), actual, expected }
    }
}

impl EngineDiagnostic {
    pub(crate) fn new(code: &str, operation: &str, message: &str, retry: &str, action: &str) -> Self {
        Self {
            api_version: 1, code: bounded_text(code, 96), operation: bounded_text(operation, 96),
            message: bounded_text(message, 2048), path: None, actual: None, expected: None,
            recovery: EngineDiagnosticRecovery { action: bounded_text(action, 512), retry: retry.into() },
            recoverable: retry != "new_session" && retry != "none", terminal: retry == "new_session",
            context: EngineDiagnosticContext::default(),
        }
    }

    pub(crate) fn input(operation: &str, issue: InputDiagnostic) -> Self {
        let mut diagnostic = Self::new("SPATIAL_INPUT_INVALID", operation, &issue.message,
            "after_correction", "Correct the reported input field and call the operation again.");
        diagnostic.path = Some(bounded_text(&issue.path, 256));
        diagnostic.actual = Some(bound_fact(issue.actual));
        diagnostic.expected = Some(bound_fact(issue.expected));
        diagnostic
    }
}

fn bounded_text(value: &str, maximum: usize) -> String {
    if value.len() <= maximum { return value.into(); }
    let mut end = maximum.saturating_sub(3);
    while !value.is_char_boundary(end) { end -= 1; }
    format!("{}...", &value[..end])
}

fn bound_fact(value: serde_json::Value) -> serde_json::Value {
    if serde_json::to_vec(&value).is_ok_and(|bytes| bytes.len() <= 1024) { value }
    else { serde_json::json!({ "omitted": "value exceeds diagnostic fact limit", "max_bytes": 1024 }) }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DiagnosticSeverity {
    Error,
    Warning,
    Info,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceLocation {
    pub file: String,
    pub line: Option<u32>,
    pub column: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionSuggestion {
    pub action: String,
    pub description: String,
    pub command: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Diagnostic {
    pub code: String,
    pub severity: DiagnosticSeverity,
    pub summary: String,
    pub explanation: String,
    pub facts: serde_json::Value,
    pub likely_causes: Vec<String>,
    pub suggested_actions: Vec<ActionSuggestion>,
    pub source: Option<SourceLocation>,
}

impl Diagnostic {
    pub fn error(
        code: impl Into<String>,
        summary: impl Into<String>,
        explanation: impl Into<String>,
    ) -> Self {
        Self {
            code: code.into(),
            severity: DiagnosticSeverity::Error,
            summary: summary.into(),
            explanation: explanation.into(),
            facts: serde_json::json!({}),
            likely_causes: Vec::new(),
            suggested_actions: Vec::new(),
            source: None,
        }
    }

    pub fn warning(
        code: impl Into<String>,
        summary: impl Into<String>,
        explanation: impl Into<String>,
    ) -> Self {
        Self {
            code: code.into(),
            severity: DiagnosticSeverity::Warning,
            summary: summary.into(),
            explanation: explanation.into(),
            facts: serde_json::json!({}),
            likely_causes: Vec::new(),
            suggested_actions: Vec::new(),
            source: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct EngineResult<T: Serialize> {
    pub ok: bool,
    pub value: Option<T>,
    pub diagnostics: Vec<Diagnostic>,
    pub effects: Vec<String>,
}

impl<T: Serialize> EngineResult<T> {
    pub fn success(value: T) -> Self {
        Self {
            ok: true,
            value: Some(value),
            diagnostics: Vec::new(),
            effects: Vec::new(),
        }
    }

    pub fn failure(diagnostic: Diagnostic) -> Self {
        Self {
            ok: false,
            value: None,
            diagnostics: vec![diagnostic],
            effects: Vec::new(),
        }
    }
}
