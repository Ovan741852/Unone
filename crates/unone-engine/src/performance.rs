//! Where a frame's time goes, and how much of everything a frame carries.
//!
//! An author who cannot profile cannot optimise. The engine owns the phases of
//! a frame, so it is the only thing that can say whether a slow game is slow in
//! its own Luau, in physics, or in publishing its state.
//!
//! Timings are wall clock, so they are deliberately kept out of `WorldSnapshot`
//! and therefore out of the observation digest: measuring a run must never
//! change what the run means. This module reports numbers and never a verdict —
//! "fast enough" depends on a target the engine does not know.

use std::{
    collections::VecDeque,
    time::{Duration, Instant},
};

use serde::Serialize;

/// Milliseconds, rounded so a report diffs cleanly between runs.
fn millis(duration: Duration) -> f64 {
    (duration.as_secs_f64() * 1_000.0 * 1_000.0).round() / 1_000.0
}

#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct FrameTiming {
    pub script: Duration,
    pub physics: Duration,
    pub observe: Duration,
    pub total: Duration,
}

/// What one frame contained, so a cost can be read against a size.
#[derive(Debug, Clone, Copy, Default, Serialize, PartialEq, Eq)]
pub struct FrameCounts {
    pub entities: usize,
    pub instances: usize,
    pub instance_bytes: usize,
    pub rigidbodies: usize,
    pub ui_nodes: usize,
    pub effects: usize,
    pub particles: usize,
    pub observations: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct PhaseCost {
    pub name: String,
    pub total_ms: f64,
    pub mean_ms: f64,
    /// Share of measured frame time, 0..1.
    pub share: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct SlowestFrame {
    /// Completed world frame, not the index within a profiling window.
    pub frame: u64,
    pub total_ms: f64,
    pub script_ms: f64,
    pub physics_ms: f64,
    pub observe_ms: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PerformanceReport {
    /// Number of frames recorded, including frames outside the sample window.
    pub frames: u64,
    pub total_ms: f64,
    pub mean_frame_ms: f64,
    /// Median of the most recent bounded sample window.
    pub median_frame_ms: f64,
    /// The frame time 95% of retained sample-window frames came in under.
    pub p95_frame_ms: f64,
    pub slowest_frame: Option<SlowestFrame>,
    /// Frames per second this run would sustain at the measured mean.
    pub sustained_fps: f64,
    /// Fixed timestep budget per frame, for comparison.
    pub frame_budget_ms: f64,
    /// Retained sample-window frames that took longer than the fixed timestep budget.
    pub frames_over_budget: u64,
    pub phases: Vec<PhaseCost>,
    pub counts: FrameCounts,
    pub luau_memory_bytes: usize,
    /// Mean of max(heap_after - heap_before, 0) across recorded frames.
    /// Not allocation throughput: allocations freed within a frame are invisible.
    /// Cannot attribute GC pauses, native allocations or individual functions.
    pub luau_positive_heap_delta_bytes_per_frame: usize,
    /// Mean canonical snapshot JSON bytes in explicitly measured frames.
    ///
    /// Canonical JSON excludes packed instance pose payloads. Web JSON
    /// presentation and binary instance transport can make host envelope sizes
    /// substantially different.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub observation_bytes: Option<usize>,
    /// Which build produced these numbers.
    ///
    /// A debug build measures debug costs, and the difference is large enough
    /// to invert a conclusion. Naming the profile in the report means nobody
    /// has to remember to ask.
    pub profile: &'static str,
    pub notes: Vec<String>,
}

/// The build these timings came from.
pub const fn build_profile() -> &'static str {
    if cfg!(debug_assertions) {
        "debug"
    } else {
        "release"
    }
}

const MAX_FRAME_SAMPLES: usize = 1_024;

#[derive(Debug, Clone, Copy)]
struct FrameSample {
    frame: u64,
    timing: FrameTiming,
}

/// Retains exact cumulative counters for run-wide totals and a bounded recent
/// window for distributional metrics. A long-lived runtime therefore cannot
/// grow its profiling allocation once the window is full.
#[derive(Debug)]
pub(crate) struct PerformanceCollector {
    samples: VecDeque<FrameSample>,
    frame_count: u64,
    total: Duration,
    script: Duration,
    physics: Duration,
    observe: Duration,
    serialize: Duration,
    serialize_frames: u64,
    observation_bytes: u64,
    positive_heap_delta_bytes: u64,
    slowest: Option<FrameSample>,
}

impl Default for PerformanceCollector {
    fn default() -> Self {
        Self {
            samples: VecDeque::with_capacity(MAX_FRAME_SAMPLES),
            frame_count: 0,
            total: Duration::ZERO,
            script: Duration::ZERO,
            physics: Duration::ZERO,
            observe: Duration::ZERO,
            serialize: Duration::ZERO,
            serialize_frames: 0,
            observation_bytes: 0,
            positive_heap_delta_bytes: 0,
            slowest: None,
        }
    }
}

impl PerformanceCollector {
    /// Record what producing the host's observation cost this frame.
    ///
    /// Kept apart from `record` because only a profiling run pays for it: a
    /// normal `run` or `test` never serializes a snapshot per frame, and
    /// measuring a cost by adding it would be its own kind of lie.
    pub(crate) fn record_serialization(&mut self, duration: Duration, bytes: usize) {
        self.serialize = self.serialize.saturating_add(duration);
        self.serialize_frames = self.serialize_frames.saturating_add(1);
        self.observation_bytes = self.observation_bytes.saturating_add(bytes as u64);
    }

    /// Record the positive net heap change in one measured frame.
    pub(crate) fn record_heap_delta(&mut self, bytes: usize) {
        self.positive_heap_delta_bytes =
            self.positive_heap_delta_bytes.saturating_add(bytes as u64);
    }

    pub(crate) fn record(&mut self, frame: u64, timing: FrameTiming) {
        self.frame_count = self.frame_count.saturating_add(1);
        self.total = self.total.saturating_add(timing.total);
        self.script = self.script.saturating_add(timing.script);
        self.physics = self.physics.saturating_add(timing.physics);
        self.observe = self.observe.saturating_add(timing.observe);

        let sample = FrameSample { frame, timing };
        if self
            .slowest
            .map_or(true, |slowest| timing.total >= slowest.timing.total)
        {
            self.slowest = Some(sample);
        }

        if MAX_FRAME_SAMPLES != 0 {
            if self.samples.len() == MAX_FRAME_SAMPLES {
                self.samples.pop_front();
            }
            self.samples.push_back(sample);
        }
    }

    pub(crate) fn report(
        &self,
        counts: FrameCounts,
        luau_memory_bytes: usize,
        frame_budget: Duration,
    ) -> PerformanceReport {
        let budget_ms = millis(frame_budget);
        if self.frame_count == 0 {
            return PerformanceReport {
                frames: 0,
                total_ms: 0.0,
                mean_frame_ms: 0.0,
                median_frame_ms: 0.0,
                p95_frame_ms: 0.0,
                slowest_frame: None,
                sustained_fps: 0.0,
                frame_budget_ms: budget_ms,
                frames_over_budget: 0,
                phases: Vec::new(),
                counts,
                luau_memory_bytes,
                luau_positive_heap_delta_bytes_per_frame: 0,
                observation_bytes: None,
                profile: build_profile(),
                notes: vec!["no frames were run".to_string()],
            };
        }

        let mut totals: Vec<Duration> = self
            .samples
            .iter()
            .map(|sample| sample.timing.total)
            .collect();
        totals.sort_unstable();
        let sample_count = totals.len();
        debug_assert!(sample_count > 0);
        let mean = self.total.div_f64(self.frame_count as f64);
        let median = totals[sample_count / 2];
        // Nearest-rank p95, which for small runs is simply the worst frames.
        let p95_index = ((sample_count as f64 * 0.95).ceil() as usize).clamp(1, sample_count) - 1;
        let p95 = totals[p95_index];

        let slowest = self.slowest.expect("frame_count is not zero");
        let measured = self
            .script
            .saturating_add(self.physics)
            .saturating_add(self.observe)
            .saturating_add(self.serialize);
        let share = |part: Duration| {
            if measured.is_zero() {
                0.0
            } else {
                (part.as_secs_f64() / measured.as_secs_f64() * 1_000.0).round() / 1_000.0
            }
        };
        let phase = |name: &str, part: Duration| PhaseCost {
            name: name.to_string(),
            total_ms: millis(part),
            mean_ms: millis(part.div_f64(self.frame_count as f64)),
            share: share(part),
        };

        let over_budget = self
            .samples
            .iter()
            .filter(|sample| sample.timing.total > frame_budget)
            .count() as u64;
        let mean_ms = millis(mean);

        PerformanceReport {
            frames: self.frame_count,
            total_ms: millis(self.total),
            mean_frame_ms: mean_ms,
            median_frame_ms: millis(median),
            p95_frame_ms: millis(p95),
            slowest_frame: Some(SlowestFrame {
                frame: slowest.frame,
                total_ms: millis(slowest.timing.total),
                script_ms: millis(slowest.timing.script),
                physics_ms: millis(slowest.timing.physics),
                observe_ms: millis(slowest.timing.observe),
            }),
            sustained_fps: if mean.is_zero() {
                0.0
            } else {
                (1.0 / mean.as_secs_f64() * 10.0).round() / 10.0
            },
            frame_budget_ms: budget_ms,
            frames_over_budget: over_budget,
            phases: {
                let mut phases = vec![
                    phase("script", self.script),
                    phase("physics", self.physics),
                    phase("observe", self.observe),
                ];
                if self.serialize_frames > 0 {
                    phases.push(PhaseCost {
                        mean_ms: millis(self.serialize.div_f64(self.serialize_frames as f64)),
                        ..phase("serialize", self.serialize)
                    });
                }
                phases
            },
            counts,
            luau_memory_bytes,
            luau_positive_heap_delta_bytes_per_frame: (self.positive_heap_delta_bytes
                / self.frame_count) as usize,
            observation_bytes: (self.serialize_frames > 0)
                .then(|| (self.observation_bytes / self.serialize_frames) as usize),
            profile: build_profile(),
            notes: {
                let mut notes =
                    vec!["wall clock timings, excluded from the observation digest".to_string()];
                if build_profile() == "debug" {
                    notes.push(
                        "THIS IS A DEBUG BUILD. These are debug costs and are not a shipping measurement; rebuild with --release before drawing a conclusion."
                            .to_string(),
                    );
                }
                notes.push(
                    "serialize is an optional canonical-JSON probe, not actual Web publication or decode time; measure those separately"
                        .to_string(),
                );
                notes.push("luau_positive_heap_delta_bytes_per_frame is positive net heap growth, not total allocated bytes or GC pause attribution".to_string());
                notes.push(format!(
                    "median, p95, and frames-over-budget use the most recent bounded sample window (up to {MAX_FRAME_SAMPLES} frames)"
                ));
                notes
            },
        }
    }
}

/// Render the report the way an author reads it before deciding what to fix.
pub fn to_markdown(report: &PerformanceReport) -> String {
    let mut out = String::new();
    out.push_str(&format!(
        "## Performance: {} frames in {:.3} ms\n\n",
        report.frames, report.total_ms
    ));
    out.push_str(&format!(
        "- mean {:.3} ms/frame, median {:.3}, p95 {:.3}\n",
        report.mean_frame_ms, report.median_frame_ms, report.p95_frame_ms
    ));
    out.push_str(&format!(
        "- sustained {:.1} fps against a {:.3} ms fixed timestep budget\n",
        report.sustained_fps, report.frame_budget_ms
    ));
    out.push_str(&format!(
        "- {} frame(s) over budget\n",
        report.frames_over_budget
    ));
    out.push_str(&format!(
        "- Luau heap {} bytes\n\n",
        report.luau_memory_bytes
    ));
    out.push_str("| phase | total ms | mean ms | share |\n|---|---|---|---|\n");
    for phase in &report.phases {
        out.push_str(&format!(
            "| {} | {:.3} | {:.3} | {:.1}% |\n",
            phase.name,
            phase.total_ms,
            phase.mean_ms,
            phase.share * 100.0
        ));
    }
    if let Some(slowest) = &report.slowest_frame {
        out.push_str(&format!(
            "\nSlowest frame {}: {:.3} ms (script {:.3}, physics {:.3}, observe {:.3})\n",
            slowest.frame,
            slowest.total_ms,
            slowest.script_ms,
            slowest.physics_ms,
            slowest.observe_ms
        ));
    }
    out.push_str(&format!(
        "\nPer frame: {} entities ({} with rigidbodies), {} UI nodes, {} effects, {} observations\n",
        report.counts.entities,
        report.counts.rigidbodies,
        report.counts.ui_nodes,
        report.counts.effects,
        report.counts.observations
    ));
    for note in &report.notes {
        out.push_str(&format!("\n> {note}\n"));
    }
    out
}

/// Time one phase of a frame.
pub(crate) fn timed<T>(work: impl FnOnce() -> T) -> (T, Duration) {
    let started = Instant::now();
    let value = work();
    (value, started.elapsed())
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::{FrameCounts, FrameTiming, MAX_FRAME_SAMPLES, PerformanceCollector, build_profile};

    /// A profile that cannot see the cost a host actually pays sends an author
    /// optimising the wrong phase. These three were invisible until now.
    #[test]
    fn a_profile_reports_the_costs_a_frame_time_alone_hides() {
        let mut collector = PerformanceCollector::default();
        for index in 0..4 {
            collector.record(index, frame(100, 200, 300));
            collector.record_heap_delta(1_000);
        }
        // Nothing asked for it, so nothing paid for it, and it is not reported.
        let quiet = collector.report(
            FrameCounts::default(),
            0,
            std::time::Duration::from_millis(16),
        );
        assert!(quiet.observation_bytes.is_none());
        assert!(!quiet.phases.iter().any(|phase| phase.name == "serialize"));
        assert_eq!(quiet.luau_positive_heap_delta_bytes_per_frame, 1_000);
        assert_eq!(quiet.profile, build_profile());

        for _ in 0..2 {
            collector.record_serialization(std::time::Duration::from_micros(500), 2_048);
        }
        let measured = collector.report(
            FrameCounts::default(),
            0,
            std::time::Duration::from_millis(16),
        );
        assert_eq!(measured.observation_bytes, Some(2_048));
        let serialize = measured
            .phases
            .iter()
            .find(|phase| phase.name == "serialize")
            .expect("a measured serialization cost must be reported as a phase");
        assert_eq!(serialize.mean_ms, 0.5, "use measured serialization frames");
        assert!((measured.phases.iter().map(|phase| phase.share).sum::<f64>() - 1.0).abs() < 0.003);
    }

    /// A debug number read as a shipping number inverts conclusions, so the
    /// report says which build it came from without being asked.
    #[test]
    fn a_debug_profile_says_so_in_its_own_notes() {
        let mut collector = PerformanceCollector::default();
        collector.record(0, frame(100, 200, 300));
        let report = collector.report(
            FrameCounts::default(),
            0,
            std::time::Duration::from_millis(16),
        );
        assert_eq!(report.profile, build_profile());
        let warned = report.notes.iter().any(|note| note.contains("DEBUG BUILD"));
        assert_eq!(
            warned,
            build_profile() == "debug",
            "the warning must appear exactly when the build is a debug build: {:?}",
            report.notes
        );
    }

    fn frame(script_us: u64, physics_us: u64, observe_us: u64) -> FrameTiming {
        let script = Duration::from_micros(script_us);
        let physics = Duration::from_micros(physics_us);
        let observe = Duration::from_micros(observe_us);
        FrameTiming {
            script,
            physics,
            observe,
            total: script + physics + observe,
        }
    }

    #[test]
    fn it_names_the_phase_that_costs_the_most_and_the_worst_frame() {
        let mut collector = PerformanceCollector::default();
        collector.record(40, frame(1_000, 100, 100));
        collector.record(41, frame(1_000, 100, 100));
        collector.record(42, frame(9_000, 100, 100));

        let report = collector.report(
            FrameCounts {
                entities: 3,
                ..FrameCounts::default()
            },
            2048,
            Duration::from_micros(16_667),
        );

        assert_eq!(report.frames, 3);
        let script = &report.phases[0];
        assert_eq!(script.name, "script");
        assert!(script.share > 0.9, "script share was {}", script.share);
        let slowest = report.slowest_frame.expect("a slowest frame");
        assert_eq!(slowest.frame, 42);
        assert!((slowest.script_ms - 9.0).abs() < 0.01, "{slowest:?}");
        assert_eq!(report.counts.entities, 3);
        assert_eq!(report.luau_memory_bytes, 2048);
    }

    #[test]
    fn it_counts_frames_that_missed_the_fixed_timestep_budget() {
        let mut collector = PerformanceCollector::default();
        collector.record(collector.frame_count, frame(1_000, 0, 0));
        collector.record(1, frame(20_000, 0, 0));
        let report = collector.report(FrameCounts::default(), 0, Duration::from_micros(16_667));
        assert_eq!(report.frames_over_budget, 1);
        assert!(report.sustained_fps > 0.0);
        assert!((report.frame_budget_ms - 16.667).abs() < 0.001);
    }

    #[test]
    fn an_empty_run_reports_nothing_rather_than_dividing_by_zero() {
        let report = PerformanceCollector::default().report(
            FrameCounts::default(),
            0,
            Duration::from_micros(16_667),
        );
        assert_eq!(report.frames, 0);
        assert!(report.slowest_frame.is_none());
        assert_eq!(report.sustained_fps, 0.0);
    }

    #[test]
    fn it_bounds_samples_while_preserving_cumulative_totals_and_maxima() {
        let mut collector = PerformanceCollector::default();
        collector.record(0, frame(100_000, 0, 0));
        for _ in 0..MAX_FRAME_SAMPLES {
            collector.record(collector.frame_count, frame(1_000, 0, 0));
        }

        assert_eq!(collector.samples.len(), MAX_FRAME_SAMPLES);

        let report = collector.report(FrameCounts::default(), 0, Duration::from_micros(16_667));

        assert_eq!(report.frames, (MAX_FRAME_SAMPLES + 1) as u64);
        assert_eq!(report.total_ms, 100.0 + MAX_FRAME_SAMPLES as f64);
        assert!((report.mean_frame_ms - 1.097).abs() < 0.001, "{report:?}");
        assert_eq!(report.median_frame_ms, 1.0);
        assert_eq!(report.p95_frame_ms, 1.0);
        assert_eq!(report.frames_over_budget, 0);

        let slowest = report.slowest_frame.expect("a slowest frame");
        assert_eq!(slowest.frame, 0);
        assert_eq!(slowest.total_ms, 100.0);
    }
}
