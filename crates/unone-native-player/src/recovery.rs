//! The native host's side of the error policy (docs/player-export.md#runtime-errors).
//! The engine recovers as the package's `error_policy` allows; this chooses
//! when that policy applies and makes every recovery visible: a rate-limited
//! `UNONE_PLAYER_RECOVERED` warning on stderr (logcat on Android) and the
//! report's `recovered_errors`.
use serde_json::{Value, json};
use std::time::{Duration, Instant};
use unone_engine::{ErrorPolicy, RecoveredErrors};

const WARN_INTERVAL: Duration = Duration::from_secs(5);

/// Interactive play runs the package's policy, like the production Web player.
/// Tool runs (replay, headless, measurement, capture) stay strict so they stop
/// at the first error; `--error-policy package|strict` overrides either way.
/// A package without a policy (an older export) is strict.
pub(crate) fn resolve(requested: Option<&str>, tool_run: bool, presentation: &Value) -> Result<(Option<ErrorPolicy>, &'static str), String> {
    let (use_package, source) = match requested {
        Some("package") => (true, "flag"),
        Some("strict") => (false, "flag"),
        Some(other) => return Err(format!("NATIVE_ERROR_POLICY_INVALID: --error-policy expects package or strict, got {other}")),
        None if tool_run => (false, "tool_run"),
        None => (true, "package"),
    };
    if !use_package { return Ok((None, source)); }
    let Some(declared) = presentation.get("error_policy") else { return Ok((None, "package_missing")) };
    let policy: ErrorPolicy = serde_json::from_value(declared.clone())
        .map_err(|e| format!("NATIVE_ERROR_POLICY_INVALID: presentation.json error_policy: {e}"))?;
    policy.validate()?;
    Ok(((!policy.is_strict()).then_some(policy), source))
}

pub(crate) fn report(policy: Option<&ErrorPolicy>, source: &str, recovered: Option<&RecoveredErrors>) -> Value {
    json!({"policy": policy.map_or(json!("strict"), |p| json!(p)), "source": source, "recovered_errors": recovered})
}

pub(crate) fn declaration() -> Value {
    json!({"configured_by":"player.presentation.json:error_policy, written into content/presentation.json by game export",
        "interactive":"package policy","tool_runs":"strict (replay, headless, --frames, --seconds, --capture-dir)",
        "override":"--error-policy package|strict","missing_policy":"strict",
        "warning_prefix":"UNONE_PLAYER_RECOVERED ","report":"error_policy {policy, source, recovered_errors}"})
}

/// Turns the snapshot's cumulative counters into at most one warning per kind
/// every five seconds, counting what it skipped.
#[derive(Default)]
pub(crate) struct RecoveryLog {
    seen: [u64; 2],
    last_warn: [Option<Instant>; 2],
    skipped: [u64; 2],
}

impl RecoveryLog {
    pub(crate) fn observe(&mut self, recovered: Option<&RecoveredErrors>, now: Instant) -> Vec<String> {
        let Some(recovered) = recovered else { self.seen = [0; 2]; return Vec::new() };
        let counts = [recovered.ui_rejections, recovered.script_errors];
        let mut lines = Vec::new();
        for kind in 0..2 {
            let added = counts[kind].saturating_sub(self.seen[kind]);
            self.seen[kind] = counts[kind];
            if added == 0 { continue; }
            if self.last_warn[kind].is_some_and(|at| now.duration_since(at) < WARN_INTERVAL) {
                self.skipped[kind] += added;
                continue;
            }
            let more = self.skipped[kind] + added - 1;
            self.skipped[kind] = 0;
            self.last_warn[kind] = Some(now);
            let (label, record) = if kind == 0 {
                ("UI publish over capacity; kept the previous screen", json!(recovered.last_ui_rejection))
            } else {
                ("Game.update error; skipped the rest of that update", json!(recovered.last_script_error))
            };
            let more = if more > 0 { format!(" (+{more} more)") } else { String::new() };
            lines.push(format!("UNONE_PLAYER_RECOVERED {label}{more}: {record}"));
        }
        lines
    }
}

pub(crate) fn warn(line: &str) {
    eprintln!("{line}");
    #[cfg(target_os = "android")]
    unsafe {
        unsafe extern "C" {
            fn __android_log_write(priority: i32, tag: *const i8, text: *const i8) -> i32;
        }
        if let Ok(text) = std::ffi::CString::new(line.chars().take(800).collect::<String>()) {
            __android_log_write(5, c"UnoneNativePlayer".as_ptr(), text.as_ptr());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn presentation(policy: Value) -> Value { json!({"bloom": false, "error_policy": policy}) }
    const RELEASE: &str = r#"{"ui_capacity":"keep_previous","script_errors":"continue","max_consecutive_script_errors":60}"#;

    #[test]
    fn interactive_play_runs_the_package_policy_and_tool_runs_stay_strict() {
        let release: Value = serde_json::from_str(RELEASE).unwrap();
        let package = presentation(release.clone());
        let (policy, source) = resolve(None, false, &package).unwrap();
        assert_eq!((serde_json::to_value(policy.unwrap()).unwrap(), source), (release.clone(), "package"));
        assert_eq!(resolve(None, true, &package).unwrap(), (None, "tool_run"));
        assert_eq!(resolve(Some("package"), true, &package).unwrap().1, "flag");
        assert!(resolve(Some("package"), true, &package).unwrap().0.is_some());
        assert_eq!(resolve(Some("strict"), false, &package).unwrap(), (None, "flag"));
        assert_eq!(resolve(None, false, &json!({})).unwrap(), (None, "package_missing"), "an older export stays strict");
        let strict = presentation(json!({"ui_capacity":"fail","script_errors":"fail"}));
        assert_eq!(resolve(None, false, &strict).unwrap().0, None);
        assert!(resolve(Some("lenient"), false, &package).unwrap_err().contains("NATIVE_ERROR_POLICY_INVALID"));
        for bad in [json!({"ui_capacity":"truncate"}), json!({"max_consecutive_script_errors":0}), json!("continue")] {
            assert!(resolve(None, false, &presentation(bad)).unwrap_err().contains("ERROR_POLICY_INVALID"));
        }
    }

    #[test]
    fn warnings_are_rate_limited_per_kind_and_count_what_they_skipped() {
        let mut log = RecoveryLog::default();
        let start = Instant::now();
        let record = |ui: u64, script: u64| RecoveredErrors { ui_rejections: ui, script_errors: script, ..Default::default() };
        assert!(log.observe(None, start).is_empty());
        let first = log.observe(Some(&record(1, 0)), start);
        assert_eq!(first.len(), 1);
        assert!(first[0].starts_with("UNONE_PLAYER_RECOVERED UI publish over capacity; kept the previous screen: "));
        for n in 2..=10 { assert!(log.observe(Some(&record(n, 0)), start + Duration::from_millis(n * 100)).is_empty()); }
        let both = log.observe(Some(&record(11, 1)), start + Duration::from_secs(6));
        assert_eq!(both.len(), 2);
        assert!(both[0].contains("(+9 more)"), "{}", both[0]);
        assert!(both[1].starts_with("UNONE_PLAYER_RECOVERED Game.update error; skipped the rest of that update: "));
        assert!(log.observe(Some(&record(11, 1)), start + Duration::from_secs(20)).is_empty(), "no new recovery, no warning");
    }
}
