use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DiagnosticSeverity {
    Error,
    Warning,
    Info,
}

#[derive(Debug, Clone, Serialize)]
pub struct SourceLocation {
    pub file: String,
    pub line: Option<u32>,
    pub column: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ActionSuggestion {
    pub action: String,
    pub description: String,
    pub command: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
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
    pub fn error(code: impl Into<String>, summary: impl Into<String>, explanation: impl Into<String>) -> Self {
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

    pub fn warning(code: impl Into<String>, summary: impl Into<String>, explanation: impl Into<String>) -> Self {
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
        Self { ok: true, value: Some(value), diagnostics: Vec::new(), effects: Vec::new() }
    }

    pub fn failure(diagnostic: Diagnostic) -> Self {
        Self { ok: false, value: None, diagnostics: vec![diagnostic], effects: Vec::new() }
    }
}
