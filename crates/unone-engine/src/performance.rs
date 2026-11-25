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
    /// The `api.profile.span` names this frame ran, most time first (at most
    /// `MAX_FRAME_SPANS`): which part of the game made this frame slow. Run-wide
    /// span maxima cannot say that, since they may come from different frames.
    pub spans: Vec<FrameSpan>,
    /// Span names this frame also ran that `spans` leaves out (the least time).
    /// Names refused by the 256-name limit are not counted; the notes list them.
    pub spans_omitted: usize,
}

/// One span name's part of one frame.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct FrameSpan {
    pub name: String,
    /// The span open around its longest call in this frame (none for a span
    /// called straight from `update`): where its time went.
    pub parent: Option<String>,
    /// How many spans were open around that call: 0 straight from `update`.
    pub depth: u32,
    pub calls: u64,
    /// Inclusive, like `SpanCost.total_ms`: it contains the spans nested in it.
    pub total_ms: f64,
    pub max_ms: f64,
}

/// What a frame's spans came to: the kept ones and how many were left out.
#[derive(Debug, Clone, Default)]
pub(crate) struct FrameParts {
    pub spans: Vec<FrameSpan>,
    pub omitted: usize,
}

/// The slowest frames kept with their spans, per run or profiling window.
pub const MAX_SLOWEST_FRAMES: usize = 8;
/// Span names kept per slow frame, most time first.
pub const MAX_FRAME_SPANS: usize = 24;

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
    /// The slowest frames, slowest first (at most `MAX_SLOWEST_FRAMES`, the
    /// first is `slowest_frame`), each with the spans it ran: where to look
    /// before optimizing a frame-time tail.
    pub slowest_frames: Vec<SlowestFrame>,
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
    /// Where loading the project went, when this runtime loaded one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub startup: Option<StartupCost>,
    /// Spans the game recorded with `api.profile.span`, most total time first.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub spans: Vec<SpanCost>,
    /// Counters the game recorded with `api.profile.count`.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub counters: Vec<CounterTotal>,
    /// Milestones the game declared with `api.profile.mark`, in the order they happened.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub marks: Vec<ProfileMark>,
}

/// Loading a project, phase by phase. `imports` and `project` are zero for a
/// runtime made from packaged content.
#[derive(Debug, Clone, Copy, Default, Serialize, PartialEq)]
pub struct StartupCost {
    /// Bringing imported asset files up to date (docs/import-pipeline.md).
    pub imports_ms: f64,
    /// Reading the project, scene, data assets and sprite catalog.
    pub project_ms: f64,
    /// Compiling the entry script and running its top level.
    pub script_ms: f64,
    /// `Game.start`.
    pub start_ms: f64,
    pub luau_heap_after_start_bytes: usize,
}

impl StartupCost {
    pub(crate) fn set(&mut self, field: StartupPhase, duration: Duration) {
        let ms = millis(duration);
        match field {
            StartupPhase::Imports => self.imports_ms = ms,
            StartupPhase::Project => self.project_ms = ms,
            StartupPhase::Script => self.script_ms = ms,
            StartupPhase::Start => self.start_ms = ms,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub(crate) enum StartupPhase { Imports, Project, Script, Start }

#[derive(Debug, Clone, Serialize)]
pub struct SpanCost {
    pub name: String,
    pub calls: u64,
    /// Inclusive: a span's time contains the spans nested in it.
    pub total_ms: f64,
    pub mean_ms: f64,
    /// Over the most recent calls (up to the frame sample window).
    pub p95_ms: f64,
    pub max_ms: f64,
    /// Sum of positive Luau heap growth across calls; not allocation volume.
    pub heap_growth_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct CounterTotal {
    pub name: String,
    pub total: f64,
    /// Over every frame since the runtime started, counting frames where it stayed 0.
    pub per_frame_mean: f64,
    pub per_frame_max: f64,
}

/// A milestone the game declared with `api.profile.mark` ("city interactive").
/// The game owns what it means; the engine records the world frame it happened
/// in, and a host adds its own clock when it sees that frame (the official Web
/// player: when it accepts the snapshot and when it first presents it).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ProfileMark {
    pub name: String,
    /// The world frame whose update declared it: the loaded frame (0) for the
    /// top level and `Game.start`, otherwise the frame that update produced.
    pub frame: u64,
    /// 1-based order among this runtime's marks.
    pub sequence: u64,
}

/// Marks since a host's last read, for hosts that poll them beside the world.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ProfileMarksUpdate {
    /// Changes whenever a mark is recorded (or the first one is dropped).
    pub revision: u64,
    pub marks: Vec<ProfileMark>,
    /// Marks refused because `MAX_PROFILE_MARKS` were already kept.
    pub dropped: u64,
}

/// At most this many marks are kept per runtime; later ones are counted as
/// dropped, so a mark called every frame cannot grow memory. Marks are for
/// milestones, not per-frame events.
pub const MAX_PROFILE_MARKS: usize = 256;

/// At most this many distinct span and counter names are kept; later names are
/// dropped and reported, so a name built from data cannot grow memory.
pub(crate) const MAX_PROFILE_NAMES: usize = 256;

#[derive(Debug, Default)]
struct SpanStats {
    calls: u64,
    total: Duration,
    max: Duration,
    recent: VecDeque<Duration>,
    heap_growth: u64,
    /// The current frame's part, cleared when the next update begins.
    frame_calls: u64,
    frame_total: Duration,
    frame_max: Duration,
    frame_depth: u32,
    frame_parent: Option<String>,
}

#[derive(Debug, Default)]
struct CounterStats {
    total: f64,
    frame: f64,
    frame_max: f64,
}

/// What a game measures about itself with `api.profile`. Wall clock like the
/// frame phases: kept with the host and never returned to the game, so it
/// cannot reach the world, observations, digests or replay tapes.
#[derive(Debug, Default)]
pub(crate) struct ScriptProfile {
    spans: std::collections::BTreeMap<String, SpanStats>,
    counters: std::collections::BTreeMap<String, CounterStats>,
    frames: u64,
    dropped: std::collections::BTreeSet<String>,
    marks: Vec<ProfileMark>,
    dropped_marks: u64,
    /// The world frame a mark made now belongs to; the runtime sets it before each update.
    mark_frame: u64,
    /// Names of the spans open now (entered, not yet recorded), outermost
    /// first: `open[..open_len]`; the rest are spare buffers.
    open: Vec<String>,
    open_len: usize,
    /// Whether any span has a part in the current frame.
    frame_touched: bool,
}

impl ScriptProfile {
    /// Span `name`'s work is about to run; `span` closes it.
    pub(crate) fn enter(&mut self, name: &str) {
        if let Some(slot) = self.open.get_mut(self.open_len) {
            slot.clear();
            slot.push_str(name);
        } else {
            self.open.push(name.to_string());
        }
        self.open_len += 1;
    }

    fn clear_frame(&mut self) {
        if !self.frame_touched { return; }
        for stats in self.spans.values_mut() {
            stats.frame_calls = 0;
            stats.frame_total = Duration::ZERO;
            stats.frame_max = Duration::ZERO;
            stats.frame_depth = 0;
        }
        self.frame_touched = false;
    }

    /// The current frame's spans, most time first, if `keep` (the frame is
    /// one of the slowest so far); the frame's parts are cleared either way.
    pub(crate) fn frame_spans(&mut self, keep: bool) -> FrameParts {
        let mut parts = FrameParts::default();
        if keep && self.frame_touched {
            let mut ran: Vec<(&String, &SpanStats)> = self.spans.iter().filter(|(_, s)| s.frame_calls > 0).collect();
            // Ranked on exact durations: rounding to microseconds could tie two
            // spans at the cut and keep the faster one.
            ran.sort_by(|(an, a), (bn, b)| b.frame_total.cmp(&a.frame_total).then(a.frame_depth.cmp(&b.frame_depth)).then_with(|| an.cmp(bn)));
            parts.omitted = ran.len().saturating_sub(MAX_FRAME_SPANS);
            parts.spans = ran.into_iter().take(MAX_FRAME_SPANS).map(|(name, s)| FrameSpan {
                name: name.clone(), parent: s.frame_parent.clone(), depth: s.frame_depth, calls: s.frame_calls,
                total_ms: millis(s.frame_total), max_ms: millis(s.frame_max),
            }).collect();
        }
        self.clear_frame();
        parts
    }

    fn admits(&mut self, name: &str, known: bool) -> bool {
        if known { return true; }
        if self.spans.len() + self.counters.len() < MAX_PROFILE_NAMES { return true; }
        if self.dropped.len() < 16 { self.dropped.insert(name.to_string()); }
        false
    }

    /// A span entered with `enter` finished after `elapsed`.
    pub(crate) fn span(&mut self, name: &str, elapsed: Duration, heap_growth: usize) {
        self.open_len = self.open_len.saturating_sub(1);
        let depth = u32::try_from(self.open_len).unwrap_or(u32::MAX);
        let known = self.spans.contains_key(name);
        if !self.admits(name, known) { return; }
        if !known { self.spans.insert(name.to_string(), SpanStats::default()); }
        let parent = self.open_len.checked_sub(1).map(|at| self.open[at].as_str());
        let stats = self.spans.get_mut(name).expect("admitted above");
        stats.calls += 1;
        stats.total = stats.total.saturating_add(elapsed);
        stats.max = stats.max.max(elapsed);
        stats.heap_growth = stats.heap_growth.saturating_add(heap_growth as u64);
        if stats.recent.len() == MAX_FRAME_SAMPLES { stats.recent.pop_front(); }
        stats.recent.push_back(elapsed);
        // Where its longest call ran: a short call elsewhere must not hide
        // where the time went.
        if stats.frame_calls == 0 || elapsed > stats.frame_max {
            stats.frame_depth = depth;
            if stats.frame_parent.as_deref() != parent { stats.frame_parent = parent.map(str::to_string); }
        }
        stats.frame_calls += 1;
        stats.frame_total = stats.frame_total.saturating_add(elapsed);
        stats.frame_max = stats.frame_max.max(elapsed);
        self.frame_touched = true;
    }

    pub(crate) fn count(&mut self, name: &str, amount: f64) {
        let known = self.counters.contains_key(name);
        if !self.admits(name, known) { return; }
        let stats = self.counters.entry(name.to_string()).or_default();
        stats.total += amount;
        stats.frame += amount;
    }

    /// The update about to run produces world frame `frame`. No span is open
    /// between updates, and the last frame's parts are cleared even when it
    /// failed or was not recorded.
    pub(crate) fn begin_update(&mut self, frame: u64) {
        self.mark_frame = frame;
        self.open_len = 0;
        self.clear_frame();
    }

    pub(crate) fn mark(&mut self, name: &str) {
        if self.marks.len() >= MAX_PROFILE_MARKS {
            self.dropped_marks = self.dropped_marks.saturating_add(1);
            return;
        }
        let sequence = self.marks.len() as u64 + 1;
        self.marks.push(ProfileMark { name: name.to_string(), frame: self.mark_frame, sequence });
    }

    /// Cheap to poll every frame: changes only when a mark is recorded or the first is dropped.
    pub(crate) fn marks_revision(&self) -> u64 {
        self.marks.len() as u64 + u64::from(self.dropped_marks > 0)
    }

    /// The marks after sequence `after` (0 for all).
    pub(crate) fn marks_since(&self, after: u64) -> ProfileMarksUpdate {
        let start = usize::try_from(after).unwrap_or(usize::MAX).min(self.marks.len());
        ProfileMarksUpdate { revision: self.marks_revision(), marks: self.marks[start..].to_vec(), dropped: self.dropped_marks }
    }

    /// A frame finished: each counter's value for it is final.
    pub(crate) fn end_frame(&mut self) {
        self.frames += 1;
        for stats in self.counters.values_mut() {
            stats.frame_max = stats.frame_max.max(stats.frame);
            stats.frame = 0.0;
        }
    }

    pub(crate) fn apply(&self, report: &mut PerformanceReport) {
        let mut spans: Vec<SpanCost> = self.spans.iter().map(|(name, s)| {
            let mut recent: Vec<Duration> = s.recent.iter().copied().collect();
            recent.sort();
            let p95 = recent.get((recent.len() * 95).div_ceil(100).saturating_sub(1)).copied().unwrap_or_default();
            SpanCost {
                name: name.clone(), calls: s.calls, total_ms: millis(s.total),
                mean_ms: millis(s.total.div_f64(s.calls.max(1) as f64)), p95_ms: millis(p95), max_ms: millis(s.max),
                heap_growth_bytes: s.heap_growth,
            }
        }).collect();
        spans.sort_by(|a, b| b.total_ms.total_cmp(&a.total_ms).then_with(|| a.name.cmp(&b.name)));
        report.spans = spans;
        report.counters = self.counters.iter().map(|(name, c)| CounterTotal {
            name: name.clone(), total: c.total,
            per_frame_mean: if self.frames == 0 { c.frame } else { c.total / self.frames as f64 },
            per_frame_max: c.frame_max.max(c.frame),
        }).collect();
        if !self.dropped.is_empty() {
            report.notes.push(format!("api.profile keeps {MAX_PROFILE_NAMES} names; dropped: {}",
                self.dropped.iter().cloned().collect::<Vec<_>>().join(", ")));
        }
        report.marks = self.marks.clone();
        if self.dropped_marks > 0 {
            report.notes.push(format!("api.profile.mark keeps {MAX_PROFILE_MARKS} marks; {} later marks were dropped (mark milestones, not every frame)", self.dropped_marks));
        }
    }
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

#[derive(Debug, Clone)]
struct SlowFrame {
    sample: FrameSample,
    parts: FrameParts,
}

impl SlowFrame {
    fn report(&self) -> SlowestFrame {
        let timing = self.sample.timing;
        SlowestFrame {
            frame: self.sample.frame,
            total_ms: millis(timing.total),
            script_ms: millis(timing.script),
            physics_ms: millis(timing.physics),
            observe_ms: millis(timing.observe),
            spans: self.parts.spans.clone(),
            spans_omitted: self.parts.omitted,
        }
    }
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
    /// Slowest first; among equal times the later frame first.
    slowest: Vec<SlowFrame>,
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
            slowest: Vec::with_capacity(MAX_SLOWEST_FRAMES + 1),
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

    /// Whether a frame that took `total` would be kept among the slowest, so
    /// its spans are worth collecting.
    pub(crate) fn keeps(&self, total: Duration) -> bool {
        self.slowest.len() < MAX_SLOWEST_FRAMES
            || self.slowest.last().is_some_and(|slow| total >= slow.sample.timing.total)
    }

    /// `parts` is what `ScriptProfile::frame_spans` collected for this frame
    /// (empty when `keeps` said no).
    pub(crate) fn record(&mut self, frame: u64, timing: FrameTiming, parts: FrameParts) {
        self.frame_count = self.frame_count.saturating_add(1);
        self.total = self.total.saturating_add(timing.total);
        self.script = self.script.saturating_add(timing.script);
        self.physics = self.physics.saturating_add(timing.physics);
        self.observe = self.observe.saturating_add(timing.observe);

        let sample = FrameSample { frame, timing };
        if self.keeps(timing.total) {
            let at = self.slowest.partition_point(|slow| slow.sample.timing.total > timing.total);
            self.slowest.insert(at, SlowFrame { sample, parts });
            self.slowest.truncate(MAX_SLOWEST_FRAMES);
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
                slowest_frames: Vec::new(),
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
                startup: None,
                spans: Vec::new(),
                counters: Vec::new(),
                marks: Vec::new(),
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

        let slowest_frames: Vec<SlowestFrame> = self.slowest.iter().map(SlowFrame::report).collect();
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
            slowest_frame: slowest_frames.first().cloned(),
            slowest_frames,
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
            startup: None,
            spans: Vec::new(),
            counters: Vec::new(),
            marks: Vec::new(),
        }
    }
}

/// Span lines printed per slow frame in Markdown; JSON keeps `MAX_FRAME_SPANS`.
const MARKDOWN_FRAME_SPANS: usize = 12;

/// A slow frame's spans as a tree, each under the span open around its
/// longest call; one whose parent is not listed starts a branch of its own.
fn push_frame_spans(out: &mut String, frame: &SlowestFrame) {
    struct Tree<'a> { spans: &'a [FrameSpan], shown: Vec<bool>, lines: usize }
    impl Tree<'_> {
        fn line(&mut self, out: &mut String, at: usize, indent: usize, orphan: bool) {
            let spans = self.spans;
            let span = &spans[at];
            let calls = if span.calls == 1 { String::new() } else { format!(", {} calls, max {:.3}", span.calls, span.max_ms) };
            let within = match (&span.parent, orphan) { (Some(parent), true) => format!(" (in {parent})"), _ => String::new() };
            out.push_str(&format!("{}- {} {:.3}{calls}{within}\n", "  ".repeat(indent), span.name, span.total_ms));
            self.shown[at] = true;
            self.lines += 1;
            for child in 0..self.spans.len() {
                if !self.shown[child] && self.lines < MARKDOWN_FRAME_SPANS && self.spans[child].parent.as_deref() == Some(span.name.as_str()) {
                    self.line(out, child, indent + 1, false);
                }
            }
        }
    }
    let mut tree = Tree { spans: &frame.spans, shown: vec![false; frame.spans.len()], lines: 0 };
    // Roots, then branches whose parent is not listed, then anything left.
    let listed = |name: &str| frame.spans.iter().any(|span| span.name == name);
    for pass in 0..3 {
        for at in 0..frame.spans.len() {
            let parent = frame.spans[at].parent.as_deref();
            let starts = match pass { 0 => parent.is_none(), 1 => parent.is_some_and(|p| !listed(p)), _ => true };
            if starts && !tree.shown[at] && tree.lines < MARKDOWN_FRAME_SPANS {
                tree.line(out, at, 1, pass > 0);
            }
        }
    }
    let hidden = frame.spans.len() - tree.lines + frame.spans_omitted;
    if hidden > 0 {
        out.push_str(&format!("  - ... {hidden} more span name(s)\n"));
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
    if report.slowest_frames.iter().any(|frame| !frame.spans.is_empty()) {
        out.push_str("\nSlowest frames with their spans (inclusive ms, each under the span it ran in):\n");
        for frame in &report.slowest_frames {
            out.push_str(&format!("- frame {}: {:.3} ms (script {:.3})\n", frame.frame, frame.total_ms, frame.script_ms));
            push_frame_spans(&mut out, frame);
        }
    }
    out.push_str(&format!(
        "\nPer frame: {} entities ({} with rigidbodies), {} UI nodes, {} effects, {} observations\n",
        report.counts.entities,
        report.counts.rigidbodies,
        report.counts.ui_nodes,
        report.counts.effects,
        report.counts.observations
    ));
    if let Some(startup) = &report.startup {
        out.push_str(&format!(
            "\nStartup: imports {:.3} ms, project {:.3} ms, script {:.3} ms, Game.start {:.3} ms; Luau heap after start {} bytes\n",
            startup.imports_ms, startup.project_ms, startup.script_ms, startup.start_ms, startup.luau_heap_after_start_bytes
        ));
    }
    if !report.spans.is_empty() {
        out.push_str("\n| span | calls | total ms | mean ms | p95 ms | max ms | heap growth |\n|---|---|---|---|---|---|---|\n");
        for span in &report.spans {
            out.push_str(&format!("| {} | {} | {:.3} | {:.3} | {:.3} | {:.3} | {} |\n",
                span.name, span.calls, span.total_ms, span.mean_ms, span.p95_ms, span.max_ms, span.heap_growth_bytes));
        }
    }
    if !report.counters.is_empty() {
        out.push_str("\n| counter | total | per frame mean | per frame max |\n|---|---|---|---|\n");
        for counter in &report.counters {
            out.push_str(&format!("| {} | {} | {:.3} | {} |\n", counter.name, counter.total, counter.per_frame_mean, counter.per_frame_max));
        }
    }
    if !report.marks.is_empty() {
        out.push_str("\n| mark | frame |\n|---|---|\n");
        for mark in &report.marks {
            out.push_str(&format!("| {} | {} |\n", mark.name, mark.frame));
        }
    }
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

    use super::{FrameCounts, FrameParts, FrameSpan, FrameTiming, MAX_FRAME_SAMPLES, MAX_FRAME_SPANS, MAX_SLOWEST_FRAMES, PerformanceCollector, ScriptProfile, build_profile, to_markdown};

    /// Run-wide span maxima may come from different frames, so they cannot say
    /// which spans made one slow frame; the slowest frames keep their own.
    #[test]
    fn the_slowest_frames_keep_the_spans_they_ran() {
        let ms = |n: u64| Duration::from_millis(n);
        let mut profile = ScriptProfile::default();
        let mut collector = PerformanceCollector::default();
        for index in 1..=20u64 {
            profile.begin_update(index);
            let ai = if index == 7 { 40 } else { 1 };
            profile.enter("world");
            profile.enter("ai");
            profile.span("ai", ms(ai), 0);
            profile.span("world", ms(ai + 2), 0);
            profile.enter("draw");
            profile.span("draw", ms(3), 0);
            if index == 7 {
                profile.enter("draw");
                profile.span("draw", ms(2), 0);
            }
            let total = ms(ai + 6);
            let parts = profile.frame_spans(collector.keeps(total));
            collector.record(index, FrameTiming { script: total, total, ..FrameTiming::default() }, parts);
        }
        let report = collector.report(FrameCounts::default(), 0, Duration::from_millis(16));
        let slowest = report.slowest_frame.clone().expect("a slowest frame");
        assert_eq!((slowest.frame, slowest.spans_omitted), (7, 0));
        let span = |name: &str, parent: Option<&str>, depth: u32, calls: u64, total_ms: f64, max_ms: f64| FrameSpan {
            name: name.to_string(), parent: parent.map(str::to_string), depth, calls, total_ms, max_ms,
        };
        assert_eq!(slowest.spans, [span("world", None, 0, 1, 42.0, 42.0), span("ai", Some("world"), 1, 1, 40.0, 40.0), span("draw", None, 0, 2, 5.0, 3.0)]);
        assert_eq!(report.slowest_frames.len(), MAX_SLOWEST_FRAMES);
        assert_eq!(report.slowest_frames[0].frame, 7);
        // Equal frames: the latest first, each with only its own frame's spans.
        let rest: Vec<u64> = report.slowest_frames[1..].iter().map(|f| f.frame).collect();
        assert_eq!(rest, [20, 19, 18, 17, 16, 15, 14]);
        assert!(report.slowest_frames[1..].iter().all(|f| f.spans == [span("draw", None, 0, 1, 3.0, 3.0), span("world", None, 0, 1, 3.0, 3.0), span("ai", Some("world"), 1, 1, 1.0, 1.0)]));
        // A child prints under its own parent, not under whatever sorts above it.
        let text = to_markdown(&report);
        assert!(text.contains("- frame 7: 46.000 ms (script 46.000)\n  - world 42.000\n    - ai 40.000\n  - draw 5.000, 2 calls, max 3.000\n"), "{text}");

        // A frame that failed or was not recorded leaves nothing to the next one.
        profile.begin_update(21);
        profile.enter("ai");
        profile.span("ai", ms(1), 0);
        profile.enter("left open");
        profile.begin_update(22);
        profile.enter("draw");
        profile.span("draw", ms(1), 0);
        assert_eq!(profile.frame_spans(true).spans, [span("draw", None, 0, 1, 1.0, 1.0)]);
        // A frame not kept collects nothing and is still cleared.
        profile.begin_update(23);
        profile.enter("ai");
        profile.span("ai", ms(1), 0);
        assert!(profile.frame_spans(false).spans.is_empty());
        assert!(profile.frame_spans(true).spans.is_empty());
        // Parent and depth are those of the longest call: a short shallow call
        // must not hide where the time went.
        profile.begin_update(24);
        profile.enter("hooks");
        profile.enter("path");
        profile.span("path", ms(1), 0);
        profile.span("hooks", ms(1), 0);
        profile.enter("ai");
        profile.enter("plan");
        profile.enter("path");
        profile.span("path", ms(30), 0);
        profile.span("plan", ms(31), 0);
        profile.span("ai", ms(32), 0);
        let path = profile.frame_spans(true).spans.into_iter().find(|s| s.name == "path").expect("path ran");
        assert_eq!((path.parent.as_deref(), path.depth, path.calls, path.total_ms), (Some("plan"), 2, 2, 31.0));
    }

    /// A frame with more span names than are kept says how many it left out,
    /// ranks them on exact time, and a span whose parent was cut still shows.
    #[test]
    fn a_slow_frame_counts_the_spans_it_leaves_out() {
        let mut profile = ScriptProfile::default();
        profile.begin_update(1);
        profile.enter("outer");
        // outer and s02..s23 come first; s01 (2.4 us) and s00 (1.6 us) both
        // round to 0.002 ms and stand at the cut, 24th and 25th; s24..s29 less.
        for n in 0..30u64 {
            let name = format!("s{n:02}");
            profile.enter(&name);
            let nanos = match n { 0 => 1_600, 1 => 2_400, 2..=23 => 10_000 * (n + 1), _ => 1_000 };
            profile.span(&name, Duration::from_nanos(nanos), 0);
        }
        profile.span("outer", Duration::from_millis(5), 0);
        let parts = profile.frame_spans(true);
        assert_eq!((parts.spans.len(), parts.omitted), (MAX_FRAME_SPANS, 31 - MAX_FRAME_SPANS));
        assert_eq!(parts.spans[0].name, "outer");
        assert_eq!(parts.spans.last().map(|s| s.name.as_str()), Some("s01"), "ranked on exact time, not on rounded time then name");
        assert!(parts.spans.iter().all(|s| s.name != "s00"));

        let mut collector = PerformanceCollector::default();
        collector.record(1, FrameTiming { script: Duration::from_millis(6), total: Duration::from_millis(6), ..FrameTiming::default() }, parts);
        let mut report = collector.report(FrameCounts::default(), 0, Duration::from_millis(16));
        let text = to_markdown(&report);
        assert!(text.contains("  - outer 5.000\n    - s23 0.240\n") && text.contains("  - ... 19 more span name(s)\n"), "{text}");
        // A span whose parent is not listed starts a branch and names it.
        report.slowest_frames[0].spans.remove(0);
        let text = to_markdown(&report);
        assert!(text.contains("  - s23 0.240 (in outer)\n"), "{text}");
        // A branch whose parent is not listed stays one branch: C under B, B (in A).
        let span = |name: &str, parent: &str, total_ms: f64| FrameSpan { name: name.to_string(), parent: Some(parent.to_string()), depth: 1, calls: 1, total_ms, max_ms: total_ms };
        report.slowest_frames[0].spans = vec![span("C", "B", 10.0), span("B", "A", 9.0)];
        let text = to_markdown(&report);
        assert!(text.contains("  - B 9.000 (in A)\n    - C 10.000\n"), "{text}");
        // Without spans a frame still has an (empty) list, never a missing field.
        let mut plain = PerformanceCollector::default();
        plain.record(1, FrameTiming::default(), FrameParts::default());
        let json = serde_json::to_value(plain.report(FrameCounts::default(), 0, Duration::from_millis(16))).unwrap();
        assert_eq!(json["slowest_frames"][0]["spans"], serde_json::json!([]));
        assert_eq!(json["slowest_frame"]["spans_omitted"], 0);
    }

    /// A profile that cannot see the cost a host actually pays sends an author
    /// optimising the wrong phase. These three were invisible until now.
    #[test]
    fn a_profile_reports_the_costs_a_frame_time_alone_hides() {
        let mut collector = PerformanceCollector::default();
        for index in 0..4 {
            collector.record(index, frame(100, 200, 300), FrameParts::default());
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
        collector.record(0, frame(100, 200, 300), FrameParts::default());
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
        collector.record(40, frame(1_000, 100, 100), FrameParts::default());
        collector.record(41, frame(1_000, 100, 100), FrameParts::default());
        collector.record(42, frame(9_000, 100, 100), FrameParts::default());

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
        collector.record(collector.frame_count, frame(1_000, 0, 0), FrameParts::default());
        collector.record(1, frame(20_000, 0, 0), FrameParts::default());
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
        collector.record(0, frame(100_000, 0, 0), FrameParts::default());
        for _ in 0..MAX_FRAME_SAMPLES {
            collector.record(collector.frame_count, frame(1_000, 0, 0), FrameParts::default());
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
