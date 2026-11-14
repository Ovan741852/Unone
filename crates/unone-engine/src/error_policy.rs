//! How a runtime answers errors a released player can survive.
//!
//! Every tool (`game check`, `run`, `test`, previews, replays, development
//! players) keeps the strict default: a refused UI publish or a failing
//! `Game.update` stops the run with its diagnostic. Only a host that presents
//! a game to players opts in to recovery, and then reports what it recovered
//! from in the snapshot's `recovered_errors`.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum UiCapacityPolicy {
    /// `ui.setRoot` raises the capacity error (strict default).
    #[default]
    Fail,
    /// `ui.setRoot` returns false and the previous valid screen stays published.
    KeepPrevious,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum ScriptErrorPolicy {
    /// An error escaping `Game.update` fails the tick (strict default).
    #[default]
    Fail,
    /// The rest of that update is skipped, the frame completes and the next
    /// tick runs `Game.update` again, until too many frames fail in a row.
    Continue,
}

/// Declared in `player.presentation.json` as `error_policy` and passed to the
/// runtime in the host load payload. Missing fields take the strict values.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(default, deny_unknown_fields)]
pub struct ErrorPolicy {
    pub ui_capacity: UiCapacityPolicy,
    pub script_errors: ScriptErrorPolicy,
    /// Under `continue`, the run stops with `SCRIPT_ERROR_LIMIT` once this many
    /// consecutive ticks have failed. One second at the fixed 60 Hz step.
    pub max_consecutive_script_errors: u32,
}

impl Default for ErrorPolicy {
    fn default() -> Self { Self::strict() }
}

impl ErrorPolicy {
    pub const MAX_CONSECUTIVE_SCRIPT_ERRORS: u32 = 3600;
    const DEFAULT_CONSECUTIVE_SCRIPT_ERRORS: u32 = 60;

    /// What every tool and development player uses.
    pub const fn strict() -> Self {
        Self { ui_capacity: UiCapacityPolicy::Fail, script_errors: ScriptErrorPolicy::Fail,
            max_consecutive_script_errors: Self::DEFAULT_CONSECUTIVE_SCRIPT_ERRORS }
    }

    /// What a production player uses when the project declares nothing.
    pub const fn release() -> Self {
        Self { ui_capacity: UiCapacityPolicy::KeepPrevious, script_errors: ScriptErrorPolicy::Continue,
            max_consecutive_script_errors: Self::DEFAULT_CONSECUTIVE_SCRIPT_ERRORS }
    }

    pub fn is_strict(&self) -> bool {
        self.ui_capacity == UiCapacityPolicy::Fail && self.script_errors == ScriptErrorPolicy::Fail
    }

    pub fn validate(&self) -> Result<(), String> {
        if !(1..=Self::MAX_CONSECUTIVE_SCRIPT_ERRORS).contains(&self.max_consecutive_script_errors) {
            return Err(format!("ERROR_POLICY_INVALID: max_consecutive_script_errors must be 1..={}, got {}",
                Self::MAX_CONSECUTIVE_SCRIPT_ERRORS, self.max_consecutive_script_errors));
        }
        Ok(())
    }
}

/// One `Game.update` error the runtime recovered from.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ScriptErrorRecord {
    /// Simulation frame the failed update produced (the snapshot's `frame`).
    pub frame: u64,
    pub code: String,
    pub message: String,
}

/// What a lenient runtime recovered from, published as the snapshot's
/// `recovered_errors`. Absent under the strict policy and until the first
/// recovery, so strict snapshots and their digests are unchanged.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct RecoveredErrors {
    /// Publishes refused for capacity while the previous screen stayed.
    pub ui_rejections: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_ui_rejection: Option<crate::UiRejection>,
    /// Ticks whose `Game.update` failed and was skipped.
    pub script_errors: u64,
    /// Failed ticks in a row, reset by a tick whose update returns.
    pub consecutive_script_errors: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_script_error: Option<ScriptErrorRecord>,
}

impl RecoveredErrors {
    /// Bound each recorded message; the full text went to the host log.
    pub(crate) const MAX_MESSAGE_BYTES: usize = 2048;

    pub fn is_empty(&self) -> bool { self.ui_rejections == 0 && self.script_errors == 0 }
}

pub(crate) fn bounded(message: &str) -> String {
    if message.len() <= RecoveredErrors::MAX_MESSAGE_BYTES { return message.to_owned(); }
    let mut end = RecoveredErrors::MAX_MESSAGE_BYTES;
    while !message.is_char_boundary(end) { end -= 1; }
    format!("{}…", &message[..end])
}

/// Runtime-owned error state shared with the Luau bindings.
#[derive(Debug, Default)]
pub(crate) struct ErrorState {
    pub policy: ErrorPolicy,
    /// Every refused publish, under any policy (`api.ui.inspect()`).
    pub ui_rejections: u64,
    pub last_ui_rejection: Option<crate::UiRejection>,
    /// What the lenient policy recovered from (snapshot `recovered_errors`).
    pub recovered: RecoveredErrors,
}

impl ErrorState {
    pub fn new(policy: ErrorPolicy) -> Self { Self { policy, ..Self::default() } }

    /// Record a refused publish. Returns whether the caller keeps the previous
    /// screen (true) or raises the rejection (false).
    pub fn reject_ui(&mut self, rejection: crate::UiRejection) -> bool {
        self.ui_rejections += 1;
        let keep = self.policy.ui_capacity == UiCapacityPolicy::KeepPrevious;
        if keep {
            self.recovered.ui_rejections += 1;
            self.recovered.last_ui_rejection = Some(rejection.clone());
        }
        self.last_ui_rejection = Some(rejection);
        keep
    }

    /// The snapshot report, absent until the lenient policy recovered once.
    pub fn report(&self) -> Option<RecoveredErrors> {
        (!self.recovered.is_empty()).then(|| self.recovered.clone())
    }

    /// Answer an error that escaped `Game.update` during the tick producing
    /// `frame`. Ok means: record it and finish the frame without the rest of
    /// that update. The strict policy and unrecoverable errors return the
    /// diagnostic unchanged; reaching the consecutive limit returns
    /// `SCRIPT_ERROR_LIMIT` carrying the last error.
    pub fn recover_script_error(&mut self, frame: u64, diagnostic: Box<crate::Diagnostic>, recoverable: bool) -> Result<(), Box<crate::Diagnostic>> {
        if !recoverable || self.policy.script_errors != ScriptErrorPolicy::Continue {
            return Err(diagnostic);
        }
        let recovered = &mut self.recovered;
        recovered.script_errors += 1;
        recovered.consecutive_script_errors = recovered.consecutive_script_errors.saturating_add(1);
        recovered.last_script_error = Some(ScriptErrorRecord { frame, code: diagnostic.code.clone(), message: bounded(&diagnostic.explanation) });
        let max = self.policy.max_consecutive_script_errors;
        if recovered.consecutive_script_errors < max {
            return Ok(());
        }
        let mut limit = crate::Diagnostic::error(
            "SCRIPT_ERROR_LIMIT",
            "Game.update failed too many frames in a row",
            format!("Game.update raised an error in {max} consecutive ticks (error_policy.max_consecutive_script_errors={max}), so the player stopped. The last error, at frame {frame}: {}", diagnostic.explanation),
        );
        limit.facts = serde_json::json!({
            "consecutive_script_errors": recovered.consecutive_script_errors,
            "max_consecutive_script_errors": max,
            "script_errors": recovered.script_errors,
            "last_error": {"frame": frame, "code": diagnostic.code, "explanation": diagnostic.explanation, "facts": diagnostic.facts},
        });
        limit.source = diagnostic.source;
        limit.likely_causes = vec!["Game.update raises on every frame, so skipping the rest of it never lets the game recover".into()];
        limit.suggested_actions = diagnostic.suggested_actions;
        Err(Box::new(limit))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_fields_are_strict_and_limits_are_bounded() {
        let declared: ErrorPolicy = serde_json::from_value(serde_json::json!({"script_errors":"continue"})).unwrap();
        assert_eq!(declared.ui_capacity, UiCapacityPolicy::Fail);
        assert_eq!(declared.max_consecutive_script_errors, 60);
        assert!(ErrorPolicy::default().is_strict());
        assert!(!ErrorPolicy::release().is_strict());
        for bad in [0, ErrorPolicy::MAX_CONSECUTIVE_SCRIPT_ERRORS + 1] {
            let policy = ErrorPolicy { max_consecutive_script_errors: bad, ..ErrorPolicy::release() };
            assert!(policy.validate().unwrap_err().contains("ERROR_POLICY_INVALID"));
        }
        assert!(serde_json::from_value::<ErrorPolicy>(serde_json::json!({"ui_capacity":"truncate"})).is_err());
        assert!(serde_json::from_value::<ErrorPolicy>(serde_json::json!({"retry":true})).is_err());
    }

    #[test]
    fn long_messages_are_cut_on_a_character_boundary() {
        let message = "錯".repeat(RecoveredErrors::MAX_MESSAGE_BYTES);
        let cut = bounded(&message);
        assert!(cut.len() <= RecoveredErrors::MAX_MESSAGE_BYTES + '…'.len_utf8());
        assert!(cut.ends_with('…'));
        assert_eq!(bounded("short"), "short");
    }
}
