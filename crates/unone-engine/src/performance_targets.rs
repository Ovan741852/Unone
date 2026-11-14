//! Targets a project holds its performance to, and what a measurement that
//! misses one tells the author.
//!
//! The engine measures and never decides what "fast enough" is
//! ([`crate::performance`]): that depends on a target only the game knows. A
//! project that declares its targets gives the engine that fact, so `perf`,
//! `run` and `verify` can say when to optimise and where to start: which phase
//! of the frame costs most and which of the game's own spans. Nothing here is a
//! guessed constant; without declared targets the only finding is that none are
//! declared, together with what was measured.

use std::{collections::BTreeMap, num::NonZeroU64};

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::{
    diagnostics::{ActionSuggestion, Diagnostic},
    performance::{PerformanceReport, SpanCost},
};

/// What a project's measurements must stay under. Every target is optional;
/// an undeclared one is not checked.
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct PerformanceTargets {
    /// Most milliseconds a frame's engine work (script, physics, observe) may
    /// take at the 95th percentile. Host rendering is not part of it, so leave
    /// it room inside the 16.667 ms fixed step.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub p95_frame_ms: Option<f64>,
    /// Most milliseconds loading may take: imports, reading the project, the
    /// entry script's top level and `Game.start`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub startup_ms: Option<f64>,
    /// Most bytes of Luau heap a measured run may end with.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub luau_heap_bytes: Option<u64>,
    /// Most bytes of positive Luau heap growth a frame may average: growth is
    /// garbage the collector has to find later.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub heap_growth_bytes_per_frame: Option<u64>,
    /// Most milliseconds one call of a game span (`api.profile.span`) may take
    /// at the 95th percentile, by span name.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub span_p95_ms: BTreeMap<String, f64>,
    /// Frames `verify` measures; undeclared means 600.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub frames: Option<NonZeroU64>,
    /// A JSON array of input frames, relative to the project root, that drives
    /// the run `verify` measures, so it measures play instead of an idle
    /// opening screen.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_sequence: Option<String>,
}

/// Frames `verify` measures when the targets do not say.
pub const DEFAULT_MEASURED_FRAMES: u64 = 600;

/// Fewer frames than one second of fixed steps make a percentile or a mean
/// growth the noise of a handful of frames, so timings are not compared.
pub const MIN_COMPARED_FRAMES: u64 = 60;

/// Who asked: a measuring command (`perf`, `verify`) reports why a target was
/// not compared and names targets nothing measured; `run`, whose frame count
/// is the author's own business, stays quiet about both.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Review {
    Measure,
    Run,
}

/// Every declared number must be a positive, finite amount; a zero or negative
/// target can never be met and a typo must not pass as a target.
pub fn validate(targets: Option<&PerformanceTargets>) -> Result<(), Box<Diagnostic>> {
    let Some(targets) = targets else { return Ok(()) };
    let mut bad = Vec::new();
    let mut milliseconds = |name: String, value: Option<f64>| {
        if let Some(value) = value
            && !(value.is_finite() && value > 0.0)
        {
            bad.push(json!({"target": name, "value": value}));
        }
    };
    milliseconds("p95_frame_ms".into(), targets.p95_frame_ms);
    milliseconds("startup_ms".into(), targets.startup_ms);
    for (name, value) in &targets.span_p95_ms {
        milliseconds(format!("span_p95_ms.{name}"), Some(*value));
    }
    for (name, value) in [("luau_heap_bytes", targets.luau_heap_bytes), ("heap_growth_bytes_per_frame", targets.heap_growth_bytes_per_frame)] {
        if value == Some(0) {
            bad.push(json!({"target": name, "value": 0}));
        }
    }
    if targets.span_p95_ms.keys().any(|name| name.is_empty()) {
        bad.push(json!({"target": "span_p95_ms", "value": "an empty span name"}));
    }
    if bad.is_empty() {
        return Ok(());
    }
    let mut diagnostic = Diagnostic::error(
        "PERFORMANCE_TARGET_INVALID",
        "A declared performance target can never be met",
        "Every performance target must be a positive, finite number; a zero, negative or non-number target is either a typo or a target nothing can reach. Fix or remove it.",
    );
    diagnostic.facts = json!({"invalid": bad});
    Err(Box::new(diagnostic))
}

/// Compare a measurement with the project's targets.
pub fn review(report: &PerformanceReport, targets: Option<&PerformanceTargets>, asked: Review) -> Vec<Diagnostic> {
    let enough = report.frames >= MIN_COMPARED_FRAMES;
    let Some(targets) = targets else {
        return if asked == Review::Measure || enough { vec![undeclared(report)] } else { Vec::new() };
    };
    let mut out = Vec::new();
    let release = report.profile != "debug";
    if asked == Review::Measure {
        if !release {
            out.push(not_compared("PERF_TARGETS_DEBUG_BUILD", "Timing targets were not compared: this is a debug build",
                "Debug costs are large enough to invert a conclusion, so frame, startup and span timings are not compared with their targets. Measure with a --release build.", report));
        } else if !enough {
            out.push(not_compared("PERF_TARGETS_TOO_FEW_FRAMES", "Frame targets were not compared: too few frames",
                &format!("{} frames is less than one second of fixed steps ({MIN_COMPARED_FRAMES}); a percentile of so few frames is noise. Measure at least {MIN_COMPARED_FRAMES} frames, 600 by default.", report.frames), report));
        }
    }
    if release {
        if let (Some(target), Some(startup)) = (targets.startup_ms, report.startup) {
            let total = startup.imports_ms + startup.project_ms + startup.script_ms + startup.start_ms;
            if total > target {
                out.push(startup_over(report, total, target));
            }
        }
        if enough {
            if let Some(target) = targets.p95_frame_ms
                && report.p95_frame_ms > target
            {
                out.push(frame_over(report, target));
            }
            for (name, target) in &targets.span_p95_ms {
                match report.spans.iter().find(|span| &span.name == name) {
                    Some(span) if span.p95_ms > *target => out.push(span_over(span, *target)),
                    Some(_) => {}
                    None if asked == Review::Measure => out.push(span_unmeasured(name, report)),
                    None => {}
                }
            }
        }
    }
    if let Some(target) = targets.luau_heap_bytes
        && report.luau_memory_bytes as u64 > target
    {
        out.push(heap_over(report, target));
    }
    if enough
        && let Some(target) = targets.heap_growth_bytes_per_frame
        && report.luau_positive_heap_delta_bytes_per_frame as u64 > target
    {
        out.push(growth_over(report, target));
    }
    out
}

/// Whether a review found a target missed (as opposed to only saying what it
/// could not compare).
pub fn missed(diagnostics: &[Diagnostic]) -> bool {
    diagnostics.iter().any(|diagnostic| diagnostic.code.ends_with("_OVER_TARGET") || diagnostic.code == "PERF_SPAN_UNMEASURED")
}

fn suggestion(action: &str, description: String) -> ActionSuggestion {
    ActionSuggestion { action: action.to_string(), description, command: Some("game perf --frames 600".to_string()) }
}

fn warning(code: &str, summary: String, explanation: String, facts: serde_json::Value) -> Diagnostic {
    let mut diagnostic = Diagnostic::warning(code, summary, explanation);
    diagnostic.facts = facts;
    diagnostic
}

fn startup_total(report: &PerformanceReport) -> Option<f64> {
    report.startup.map(|startup| startup.imports_ms + startup.project_ms + startup.script_ms + startup.start_ms)
}

/// The game's spans, costliest first by `key`.
fn top_spans<'a>(report: &'a PerformanceReport, key: impl Fn(&SpanCost) -> f64) -> Vec<&'a SpanCost> {
    let mut spans: Vec<&SpanCost> = report.spans.iter().collect();
    spans.sort_by(|a, b| key(b).total_cmp(&key(a)));
    spans.truncate(3);
    spans
}

fn undeclared(report: &PerformanceReport) -> Diagnostic {
    let mut diagnostic = warning(
        "PERF_TARGETS_UNDECLARED",
        "No performance targets are declared".to_string(),
        "The engine measured this run but does not know what fast enough is for this game, so it cannot say when to optimise. Declare `performance` in project.unone.json (p95_frame_ms, startup_ms, luau_heap_bytes, heap_growth_bytes_per_frame, span_p95_ms) and perf, run and verify warn when a measurement misses one, naming where the time goes.".to_string(),
        json!({
            "frames": report.frames,
            "profile": report.profile,
            "p95_frame_ms": report.p95_frame_ms,
            "startup_ms": startup_total(report),
            "luau_heap_bytes": report.luau_memory_bytes,
            "heap_growth_bytes_per_frame": report.luau_positive_heap_delta_bytes_per_frame,
        }),
    );
    diagnostic.suggested_actions.push(ActionSuggestion {
        action: "declare_targets".to_string(),
        description: "Add for example \"performance\": {\"p95_frame_ms\": 8, \"startup_ms\": 3000} to project.unone.json, choosing numbers from the game's target devices.".to_string(),
        command: None,
    });
    diagnostic
}

fn not_compared(code: &str, summary: &str, explanation: &str, report: &PerformanceReport) -> Diagnostic {
    warning(code, summary.to_string(), explanation.to_string(), json!({"frames": report.frames, "profile": report.profile}))
}

fn frame_over(report: &PerformanceReport, target: f64) -> Diagnostic {
    let dominant = report.phases.iter().max_by(|a, b| a.share.total_cmp(&b.share));
    let spans = top_spans(report, |span| span.total_ms);
    let mut explanation = match dominant {
        Some(phase) => format!("{} takes {:.0}% of the measured frame time ({:.3} ms a frame).", phase.name, phase.share * 100.0, phase.mean_ms),
        None => String::new(),
    };
    if let Some(span) = spans.first() {
        explanation.push_str(&format!(" The game's costliest span is '{}': {:.3} ms a call over {} calls ({:.1} ms in all).", span.name, span.mean_ms, span.calls, span.total_ms));
    }
    let mut diagnostic = warning(
        "PERF_FRAME_OVER_TARGET",
        format!("p95 frame {:.3} ms is over the {:.3} ms target", report.p95_frame_ms, target),
        explanation.trim().to_string(),
        json!({
            "p95_frame_ms": report.p95_frame_ms,
            "target_ms": target,
            "mean_frame_ms": report.mean_frame_ms,
            "frames": report.frames,
            "slowest_frame": report.slowest_frame,
            "phases": report.phases,
            "top_spans": spans,
            "counts": report.counts,
            "profile": report.profile,
        }),
    );
    let counts = &report.counts;
    let action = match dominant.map(|phase| phase.name.as_str()) {
        Some("script") => match spans.first() {
            Some(span) => suggestion("optimise_span", format!("Start with span '{}' ({:.3} ms a call, {} calls), then measure again.", span.name, span.mean_ms, span.calls)),
            None => suggestion("profile_script", "Wrap the game's systems in api.profile.span and measure again to see which one costs most.".to_string()),
        },
        Some("physics") => suggestion("reduce_physics", format!("Physics costs most with {} rigid bodies; fewer, sleeping or simpler bodies cost less.", counts.rigidbodies)),
        Some("observe") => suggestion("reduce_observation", format!("Publishing the frame costs most: {} entities, {} instances, {} UI nodes and {} observations a frame; publish less, or only what changed.", counts.entities, counts.instances, counts.ui_nodes, counts.observations)),
        Some("serialize") => suggestion("shrink_observation", format!("Handing the observation to the host costs most ({} bytes a frame); a smaller observation costs less.", report.observation_bytes.unwrap_or(0))),
        _ => suggestion("measure_again", "Measure again with more frames to see which phase costs most.".to_string()),
    };
    diagnostic.suggested_actions.push(action);
    diagnostic
}

fn startup_over(report: &PerformanceReport, total: f64, target: f64) -> Diagnostic {
    let startup = report.startup.unwrap_or_default();
    let phases = [("imports", startup.imports_ms), ("project", startup.project_ms), ("script", startup.script_ms), ("start", startup.start_ms)];
    let (name, ms) = phases.iter().copied().max_by(|a, b| a.1.total_cmp(&b.1)).unwrap_or(("start", 0.0));
    let mut diagnostic = warning(
        "PERF_STARTUP_OVER_TARGET",
        format!("Startup {total:.1} ms is over the {target:.1} ms target"),
        format!("Of loading, {name} takes most: {ms:.1} ms."),
        json!({"startup_ms": total, "target_ms": target, "phases": startup, "profile": report.profile}),
    );
    let description = match name {
        "imports" => "Bringing imported assets up to date takes most: keep .unone/import-stamp.json and make importers skip unchanged files.",
        "project" => "Reading the project, scene, data assets and sprite catalog takes most: large scene or data files load slowly.",
        "script" => "Compiling the entry script and running its top level takes most: move work out of the top level.",
        _ => "Game.start takes most: spread its work over the first frames or build less up front.",
    };
    diagnostic.suggested_actions.push(suggestion("reduce_startup", description.to_string()));
    diagnostic
}

fn span_over(span: &SpanCost, target: f64) -> Diagnostic {
    let mut diagnostic = warning(
        "PERF_SPAN_OVER_TARGET",
        format!("Span '{}' p95 {:.3} ms is over its {:.3} ms target", span.name, span.p95_ms, target),
        format!("'{}' ran {} times, {:.3} ms a call on average and {:.3} ms at most.", span.name, span.calls, span.mean_ms, span.max_ms),
        json!({"span": span, "target_ms": target}),
    );
    diagnostic.suggested_actions.push(suggestion("optimise_span", format!("Make '{}' cheaper, or split it into nested spans to see which part costs most.", span.name)));
    diagnostic
}

fn span_unmeasured(name: &str, report: &PerformanceReport) -> Diagnostic {
    let mut diagnostic = warning(
        "PERF_SPAN_UNMEASURED",
        format!("Span '{name}' has a target but was never recorded"),
        "A span target only means something when the measured run reaches that span. Either the name differs from the one passed to api.profile.span, or the run never reached that code (point performance.input_sequence at play that does).".to_string(),
        json!({"span": name, "recorded": report.spans.iter().map(|span| span.name.as_str()).collect::<Vec<_>>()}),
    );
    diagnostic.likely_causes.push("a typo in the span name".to_string());
    diagnostic.likely_causes.push("the measured run never reaches the code the span wraps".to_string());
    diagnostic
}

fn heap_over(report: &PerformanceReport, target: u64) -> Diagnostic {
    let spans = top_spans(report, |span| span.heap_growth_bytes as f64);
    let mut diagnostic = warning(
        "PERF_HEAP_OVER_TARGET",
        format!("Luau heap {} bytes is over the {target} byte target", report.luau_memory_bytes),
        "The script holds more memory than the project allows at the end of the measured run.".to_string(),
        json!({"luau_heap_bytes": report.luau_memory_bytes, "target_bytes": target, "top_spans_by_heap_growth": spans, "counts": report.counts}),
    );
    diagnostic.suggested_actions.push(suggestion("hold_less", "Keep fewer or smaller tables alive, and drop references to what the game no longer uses.".to_string()));
    diagnostic
}

fn growth_over(report: &PerformanceReport, target: u64) -> Diagnostic {
    let spans = top_spans(report, |span| span.heap_growth_bytes as f64);
    let mut explanation = "Every frame leaves more garbage than the project allows; the collector pays for it later, in frames it chooses.".to_string();
    if let Some(span) = spans.first().filter(|span| span.heap_growth_bytes > 0) {
        explanation.push_str(&format!(" Span '{}' grows the heap most ({} bytes over {} calls).", span.name, span.heap_growth_bytes, span.calls));
    }
    let mut diagnostic = warning(
        "PERF_HEAP_GROWTH_OVER_TARGET",
        format!("Heap growth {} bytes a frame is over the {target} byte target", report.luau_positive_heap_delta_bytes_per_frame),
        explanation,
        json!({"heap_growth_bytes_per_frame": report.luau_positive_heap_delta_bytes_per_frame, "target_bytes": target, "top_spans_by_heap_growth": spans}),
    );
    diagnostic.suggested_actions.push(suggestion("allocate_less", "Reuse tables and strings each frame instead of building new ones.".to_string()));
    diagnostic
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::performance::{FrameCounts, PhaseCost, StartupCost};

    fn report(frames: u64, p95: f64, profile: &'static str) -> PerformanceReport {
        let phase = |name: &str, share: f64| PhaseCost { name: name.to_string(), total_ms: share * 100.0, mean_ms: share, share };
        PerformanceReport {
            frames,
            total_ms: 0.0,
            mean_frame_ms: p95 / 2.0,
            median_frame_ms: p95 / 2.0,
            p95_frame_ms: p95,
            slowest_frame: None,
            sustained_fps: 0.0,
            frame_budget_ms: 16.667,
            frames_over_budget: 0,
            phases: vec![phase("script", 0.7), phase("physics", 0.2), phase("observe", 0.1)],
            counts: FrameCounts::default(),
            luau_memory_bytes: 1000,
            luau_positive_heap_delta_bytes_per_frame: 50,
            observation_bytes: None,
            profile,
            notes: Vec::new(),
            startup: Some(StartupCost { imports_ms: 10.0, project_ms: 20.0, script_ms: 30.0, start_ms: 400.0, luau_heap_after_start_bytes: 0 }),
            spans: vec![SpanCost { name: "ai".to_string(), calls: 600, total_ms: 900.0, mean_ms: 1.5, p95_ms: 2.5, max_ms: 4.0, heap_growth_bytes: 9000 }],
            counters: Vec::new(),
        }
    }

    fn codes(diagnostics: &[Diagnostic]) -> Vec<&str> {
        diagnostics.iter().map(|diagnostic| diagnostic.code.as_str()).collect()
    }

    #[test]
    fn missed_targets_name_the_phase_and_the_span_to_start_with() {
        let targets = PerformanceTargets {
            p95_frame_ms: Some(8.0),
            startup_ms: Some(100.0),
            luau_heap_bytes: Some(500),
            heap_growth_bytes_per_frame: Some(10),
            span_p95_ms: BTreeMap::from([("ai".to_string(), 2.0), ("path".to_string(), 1.0)]),
            ..Default::default()
        };
        let found = review(&report(600, 12.0, "release"), Some(&targets), Review::Measure);
        assert_eq!(codes(&found), vec!["PERF_STARTUP_OVER_TARGET", "PERF_FRAME_OVER_TARGET", "PERF_SPAN_OVER_TARGET", "PERF_SPAN_UNMEASURED",
            "PERF_HEAP_OVER_TARGET", "PERF_HEAP_GROWTH_OVER_TARGET"]);
        assert!(missed(&found));
        let frame = &found[1];
        assert!(frame.explanation.starts_with("script takes 70%"), "{}", frame.explanation);
        assert!(frame.explanation.contains("'ai'"), "{}", frame.explanation);
        assert_eq!(frame.suggested_actions[0].action, "optimise_span");
        assert!(found[0].explanation.contains("start takes most"), "{}", found[0].explanation);
        // A run reports what it missed but not a span it may simply not have reached.
        let run = review(&report(600, 12.0, "release"), Some(&targets), Review::Run);
        assert!(!codes(&run).contains(&"PERF_SPAN_UNMEASURED"));
    }

    #[test]
    fn met_targets_are_silent() {
        let targets = PerformanceTargets { p95_frame_ms: Some(16.0), startup_ms: Some(1000.0), luau_heap_bytes: Some(2000), ..Default::default() };
        let found = review(&report(600, 12.0, "release"), Some(&targets), Review::Measure);
        assert!(found.is_empty(), "{found:?}");
        assert!(!missed(&found));
    }

    #[test]
    fn timings_are_not_compared_when_they_cannot_mean_anything() {
        let targets = PerformanceTargets { p95_frame_ms: Some(1.0), luau_heap_bytes: Some(500), ..Default::default() };
        // A debug build: no timing verdict, but the heap still counts.
        let debug = review(&report(600, 12.0, "debug"), Some(&targets), Review::Measure);
        assert_eq!(codes(&debug), vec!["PERF_TARGETS_DEBUG_BUILD", "PERF_HEAP_OVER_TARGET"]);
        // Ten frames are noise; a measuring command says so, a run stays quiet.
        let few = review(&report(10, 12.0, "release"), Some(&targets), Review::Measure);
        assert_eq!(codes(&few), vec!["PERF_TARGETS_TOO_FEW_FRAMES", "PERF_HEAP_OVER_TARGET"]);
        let run = review(&report(10, 12.0, "release"), Some(&targets), Review::Run);
        assert_eq!(codes(&run), vec!["PERF_HEAP_OVER_TARGET"]);
    }

    #[test]
    fn a_project_without_targets_is_told_what_was_measured() {
        let found = review(&report(600, 12.0, "release"), None, Review::Run);
        assert_eq!(codes(&found), vec!["PERF_TARGETS_UNDECLARED"]);
        assert_eq!(found[0].facts["p95_frame_ms"], json!(12.0));
        assert_eq!(found[0].facts["startup_ms"], json!(460.0));
        assert!(!missed(&found));
        // A short run is not a measurement worth a warning.
        assert!(review(&report(5, 12.0, "release"), None, Review::Run).is_empty());
        assert_eq!(codes(&review(&report(5, 12.0, "release"), None, Review::Measure)), vec!["PERF_TARGETS_UNDECLARED"]);
    }

    #[test]
    fn unreachable_targets_are_refused() {
        assert!(validate(None).is_ok());
        assert!(validate(Some(&PerformanceTargets { p95_frame_ms: Some(8.0), ..Default::default() })).is_ok());
        for bad in [
            PerformanceTargets { p95_frame_ms: Some(0.0), ..Default::default() },
            PerformanceTargets { startup_ms: Some(-1.0), ..Default::default() },
            PerformanceTargets { luau_heap_bytes: Some(0), ..Default::default() },
            PerformanceTargets { span_p95_ms: BTreeMap::from([(String::new(), 1.0)]), ..Default::default() },
            PerformanceTargets { span_p95_ms: BTreeMap::from([("ai".to_string(), f64::NAN)]), ..Default::default() },
        ] {
            assert_eq!(validate(Some(&bad)).unwrap_err().code, "PERFORMANCE_TARGET_INVALID", "{bad:?}");
        }
    }
}
