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

use std::time::{Duration, Instant};

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
    pub rigidbodies: usize,
    pub ui_nodes: usize,
    pub effects: usize,
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
    pub frame: u64,
    pub total_ms: f64,
    pub script_ms: f64,
    pub physics_ms: f64,
    pub observe_ms: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PerformanceReport {
    pub frames: u64,
    pub total_ms: f64,
    pub mean_frame_ms: f64,
    pub median_frame_ms: f64,
    /// The frame time 95% of frames came in under.
    pub p95_frame_ms: f64,
    pub slowest_frame: Option<SlowestFrame>,
    /// Frames per second this run would sustain at the measured mean.
    pub sustained_fps: f64,
    /// Fixed timestep budget per frame, for comparison.
    pub frame_budget_ms: f64,
    /// Frames that took longer than the fixed timestep budget.
    pub frames_over_budget: u64,
    pub phases: Vec<PhaseCost>,
    pub counts: FrameCounts,
    pub luau_memory_bytes: usize,
    pub notes: Vec<String>,
}

#[derive(Debug, Default)]
pub(crate) struct PerformanceCollector {
    frames: Vec<FrameTiming>,
}

impl PerformanceCollector {
    pub(crate) fn record(&mut self, timing: FrameTiming) {
        self.frames.push(timing);
    }

    pub(crate) fn report(
        &self,
        counts: FrameCounts,
        luau_memory_bytes: usize,
        frame_budget: Duration,
    ) -> PerformanceReport {
        let budget_ms = millis(frame_budget);
        if self.frames.is_empty() {
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
                notes: vec!["no frames were run".to_string()],
            };
        }

        let mut totals: Vec<Duration> = self.frames.iter().map(|frame| frame.total).collect();
        totals.sort_unstable();
        let total: Duration = totals.iter().sum();
        let count = totals.len();
        let mean = total / count as u32;
        let median = totals[count / 2];
        // Nearest-rank p95, which for small runs is simply the worst frames.
        let p95_index = ((count as f64 * 0.95).ceil() as usize).clamp(1, count) - 1;
        let p95 = totals[p95_index];

        let (slowest_index, slowest) = self
            .frames
            .iter()
            .enumerate()
            .max_by_key(|(_, frame)| frame.total)
            .expect("frames is not empty");

        let script: Duration = self.frames.iter().map(|frame| frame.script).sum();
        let physics: Duration = self.frames.iter().map(|frame| frame.physics).sum();
        let observe: Duration = self.frames.iter().map(|frame| frame.observe).sum();
        let measured = script + physics + observe;
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
            mean_ms: millis(part / count as u32),
            share: share(part),
        };

        let over_budget = self
            .frames
            .iter()
            .filter(|frame| frame.total > frame_budget)
            .count() as u64;
        let mean_ms = millis(mean);

        PerformanceReport {
            frames: count as u64,
            total_ms: millis(total),
            mean_frame_ms: mean_ms,
            median_frame_ms: millis(median),
            p95_frame_ms: millis(p95),
            slowest_frame: Some(SlowestFrame {
                frame: slowest_index as u64,
                total_ms: millis(slowest.total),
                script_ms: millis(slowest.script),
                physics_ms: millis(slowest.physics),
                observe_ms: millis(slowest.observe),
            }),
            sustained_fps: if mean.is_zero() {
                0.0
            } else {
                (1.0 / mean.as_secs_f64() * 10.0).round() / 10.0
            },
            frame_budget_ms: budget_ms,
            frames_over_budget: over_budget,
            phases: vec![
                phase("script", script),
                phase("physics", physics),
                phase("observe", observe),
            ],
            counts,
            luau_memory_bytes,
            notes: vec![
                "wall clock timings, excluded from the observation digest".to_string(),
                "a debug build measures debug costs; compare like with like".to_string(),
            ],
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
    out.push_str(&format!("- {} frame(s) over budget\n", report.frames_over_budget));
    out.push_str(&format!("- Luau heap {} bytes\n\n", report.luau_memory_bytes));
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

    use super::{FrameCounts, FrameTiming, PerformanceCollector};

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
        collector.record(frame(1_000, 100, 100));
        collector.record(frame(1_000, 100, 100));
        collector.record(frame(9_000, 100, 100));

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
        assert_eq!(slowest.frame, 2);
        assert!((slowest.script_ms - 9.0).abs() < 0.01, "{slowest:?}");
        assert_eq!(report.counts.entities, 3);
        assert_eq!(report.luau_memory_bytes, 2048);
    }

    #[test]
    fn it_counts_frames_that_missed_the_fixed_timestep_budget() {
        let mut collector = PerformanceCollector::default();
        collector.record(frame(1_000, 0, 0));
        collector.record(frame(20_000, 0, 0));
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
}
