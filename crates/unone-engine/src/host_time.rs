//! Opt-in demand-sampled host time. Game clock domains and scheduling stay in Luau.
use serde::{Deserialize, Serialize};
use std::{cell::Cell, rc::Rc, time::Instant};

pub const MAX_SAFE_MILLISECONDS: u64 = 9_007_199_254_740_991;
const MAX_SAMPLES: usize = 1_000_000;
const MAX_TRANSACTIONS: usize = 1_000_000;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(tag = "mode", rename_all = "snake_case", deny_unknown_fields)]
pub enum HostTimeConfig {
    Live,
    Record {
        #[serde(default = "default_samples")]
        max_samples: usize,
        #[serde(default = "default_transactions")]
        max_transactions: usize,
    },
    Replay { tape: HostTimeTape },
}
fn default_samples() -> usize { MAX_SAMPLES }
fn default_transactions() -> usize { MAX_TRANSACTIONS }

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct HostTimeSample { pub tag: String, pub milliseconds: u64 }

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct HostTimeTransaction {
    pub phase: String,
    pub frame: u64,
    pub samples: Vec<HostTimeSample>,
}

/// Schema 1 is runtime-creation-origin, floor elapsed milliseconds, safe integer.
/// Epoch labels are identities supplied by the recording host, never OS uptime.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct HostTimeTape {
    pub schema_version: u32,
    #[serde(default = "default_epoch")]
    pub source_epoch: String,
    pub transactions: Vec<HostTimeTransaction>,
}
fn default_epoch() -> String { "runtime-creation".into() }

impl Default for HostTimeTape {
    fn default() -> Self {
        Self { schema_version: 1, source_epoch: default_epoch(), transactions: vec![] }
    }
}

impl HostTimeTape {
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != 1 || self.source_epoch.is_empty() || self.source_epoch.len() > 128 {
            return Err("HOST_TIME_TAPE_INVALID: schema_version/source_epoch".into());
        }
        if self.transactions.len() > MAX_TRANSACTIONS {
            return Err("HOST_TIME_LIMIT: too many tape transactions".into());
        }
        let mut count = 0usize;
        let mut previous = 0;
        for transaction in &self.transactions {
            if !["start", "tick", "reload"].contains(&transaction.phase.as_str()) {
                return Err("HOST_TIME_TAPE_INVALID: transaction phase".into());
            }
            count = count.checked_add(transaction.samples.len()).ok_or("HOST_TIME_LIMIT")?;
            if count > MAX_SAMPLES { return Err("HOST_TIME_LIMIT: too many samples".into()); }
            for sample in &transaction.samples {
                validate_tag(&sample.tag)?;
                if sample.milliseconds > MAX_SAFE_MILLISECONDS || sample.milliseconds < previous {
                    return Err("HOST_TIME_TAPE_INVALID: timestamps must be safe, nondecreasing integers".into());
                }
                previous = sample.milliseconds;
            }
        }
        Ok(())
    }
}

#[derive(Clone)]
struct Source {
    read: Rc<dyn Fn() -> Result<u64, String>>,
    calls: Rc<Cell<u64>>,
}
impl Source {
    fn live() -> Self {
        let origin = Instant::now();
        Self { read: Rc::new(move || u64::try_from(origin.elapsed().as_millis())
            .map_err(|_| "HOST_TIME_OVERFLOW".into())), calls: Rc::new(Cell::new(0)) }
    }
    fn sample(&self) -> Result<u64, String> {
        self.calls.set(self.calls.get().saturating_add(1));
        (self.read)()
    }
}

#[derive(Clone)]
struct Active {
    transaction: HostTimeTransaction,
    reads: usize,
}

#[derive(Clone, Copy)]
enum Mode { Disabled, Live, Record { max_samples: usize, max_transactions: usize }, Replay }

#[derive(Clone)]
pub(crate) struct HostTime {
    mode: Mode,
    source: Source,
    tape: HostTimeTape,
    cursor: usize,
    samples: usize,
    active: Option<Active>,
    fault: Option<String>,
    failed_attempt: Option<HostTimeTransaction>,
    last_milliseconds: Option<u64>,
}

impl HostTime {
    pub(crate) fn new(config: Option<HostTimeConfig>) -> Result<Self, String> {
        let (mode, tape) = match config {
            Some(HostTimeConfig::Replay { tape }) => { tape.validate()?; (Mode::Replay, tape) }
            Some(HostTimeConfig::Record { max_samples, max_transactions }) => {
                if !(1..=MAX_SAMPLES).contains(&max_samples) || !(1..=MAX_TRANSACTIONS).contains(&max_transactions) {
                    return Err("HOST_TIME_LIMIT: record capacities must be within 1..1000000".into());
                }
                (Mode::Record { max_samples, max_transactions }, HostTimeTape::default())
            }
            Some(HostTimeConfig::Live) => (Mode::Live, HostTimeTape::default()),
            None => (Mode::Disabled, HostTimeTape::default()),
        };
        Ok(Self { mode, source: Source::live(), tape, cursor: 0, samples: 0,
            active: None, fault: None, failed_attempt: None, last_milliseconds: None })
    }

    pub(crate) fn begin(&mut self, phase: &str, frame: u64) -> Result<(), String> {
        if matches!(self.mode, Mode::Disabled) { return Ok(()); }
        self.healthy()?;
        if self.active.is_some() { return self.fail("HOST_TIME_PHASE: nested transaction"); }
        if matches!(self.mode, Mode::Replay) {
            let expected = self.tape.transactions.get(self.cursor);
            if expected.is_none_or(|t| t.phase != phase || t.frame != frame) {
                return self.fail("HOST_TIME_REPLAY_MISMATCH: transaction phase/frame or exhausted tape");
            }
        }
        if let Mode::Record { max_transactions, .. } = self.mode {
            if self.tape.transactions.len() >= max_transactions {
                return self.fail("HOST_TIME_LIMIT: record transaction capacity reached");
            }
        }
        self.active = Some(Active { transaction: HostTimeTransaction {
            phase: phase.into(), frame, samples: vec![] }, reads: 0 });
        Ok(())
    }

    pub(crate) fn sample(&mut self, tag: String) -> Result<f64, String> {
        if matches!(self.mode, Mode::Disabled) { return Err("HOST_TIME_DISABLED: declare project.host_time explicitly".into()); }
        self.healthy()?;
        if let Err(error) = validate_tag(&tag) { return self.fail(&error); }
        let Some(active) = &self.active else { return self.fail("HOST_TIME_PHASE: sample requires start/update/onReload"); };
        if active.reads >= MAX_SAMPLES { return self.fail("HOST_TIME_LIMIT: transaction read capacity reached"); }
        let value = if matches!(self.mode, Mode::Replay) {
            match self.tape.transactions[self.cursor].samples.get(active.reads) {
                Some(sample) if sample.tag == tag => sample.milliseconds,
                _ => return self.fail("HOST_TIME_REPLAY_MISMATCH: sample tag/order or extra read"),
            }
        } else {
            if let Mode::Record { max_samples, .. } = self.mode {
                if self.samples + active.reads >= max_samples { return self.fail("HOST_TIME_LIMIT: record sample capacity reached"); }
            }
            match self.source.sample() { Ok(value) => value, Err(error) => return self.fail(&error) }
        };
        if value > MAX_SAFE_MILLISECONDS { return self.fail("HOST_TIME_OVERFLOW: milliseconds exceed 2^53-1"); }
        if self.last_milliseconds.is_some_and(|previous| value < previous) {
            return self.fail("HOST_TIME_SOURCE_INVALID: monotonic sample decreased");
        }
        self.last_milliseconds = Some(value);
        let active = self.active.as_mut().expect("active checked above");
        active.reads += 1;
        // Live is bounded independently of session length; only retain a tail for faults.
        if matches!(self.mode, Mode::Live) && active.transaction.samples.len() == 32 {
            active.transaction.samples.remove(0);
        }
        active.transaction.samples.push(HostTimeSample { tag, milliseconds: value });
        Ok(value as f64)
    }

    pub(crate) fn finish(&mut self) -> Result<(), String> {
        if matches!(self.mode, Mode::Disabled) { return Ok(()); }
        self.healthy()?;
        let active = self.active.as_ref().ok_or("HOST_TIME_PHASE: no transaction")?;
        if matches!(self.mode, Mode::Replay) &&
            active.reads != self.tape.transactions[self.cursor].samples.len() {
            return self.fail("HOST_TIME_REPLAY_MISMATCH: unconsumed samples");
        }
        let active = self.active.take().expect("active checked above");
        self.samples += active.reads;
        if matches!(self.mode, Mode::Record { .. }) {
            self.tape.transactions.push(active.transaction);
        }
        self.cursor += 1;
        Ok(())
    }

    pub(crate) fn abort(&mut self, message: &str) {
        if matches!(self.mode, Mode::Disabled) { return; }
        self.failed_attempt = self.active.take().map(|a| a.transaction);
        if self.fault.is_none() { self.fault = Some(format!("HOST_TIME_TERMINAL: {message}; full runtime load required")); }
    }

    pub(crate) fn healthy(&self) -> Result<(), String> {
        self.fault.as_ref().map_or(Ok(()), |error| Err(error.clone()))
    }
    fn fail<T>(&mut self, message: &str) -> Result<T, String> {
        if self.fault.is_none() { self.fault = Some(message.into()); }
        Err(message.into())
    }
    pub(crate) fn invalid_tag(&mut self) -> Result<f64, String> {
        self.fail("HOST_TIME_TAG_INVALID: expected a UTF-8 string")
    }
    pub(crate) fn tape(&self) -> Option<HostTimeTape> {
        match self.mode {
            Mode::Record { .. } | Mode::Replay => Some(self.tape.clone()),
            _ => None,
        }
    }
    #[cfg(feature = "dev-tools")]
    pub(crate) fn recorded_prefix(&self) -> Option<HostTimeTape> {
        self.tape().map(|mut tape| { tape.transactions.truncate(self.cursor); tape })
    }
    pub(crate) fn replay_complete(&self) -> Result<(), String> {
        self.healthy()?;
        if matches!(self.mode, Mode::Replay) && self.cursor != self.tape.transactions.len() {
            return Err("HOST_TIME_REPLAY_MISMATCH: unconsumed transactions".into());
        }
        Ok(())
    }
    pub(crate) fn report(&self) -> serde_json::Value {
        let mode = match self.mode { Mode::Disabled => "disabled", Mode::Live => "live",
            Mode::Record { .. } => "record", Mode::Replay => "replay" };
        serde_json::json!({"api_version":1,"mode":mode,"source_epoch":self.tape.source_epoch,
            "origin":"runtime_creation","units":"floor_elapsed_milliseconds","max_safe_value":MAX_SAFE_MILLISECONDS,
            "precision":"host dependent; floor does not promise 1ms resolution","overflow":"error_no_wrap",
            "physical_source_calls":self.source.calls.get(),"committed_transactions":self.cursor,
            "record_capacities":match self.mode { Mode::Record { max_samples, max_transactions } => Some(serde_json::json!({"samples":max_samples,"transactions":max_transactions})), _ => None },
            "committed_samples":self.samples,"retained_transactions":self.tape.transactions.len(),
            "active":self.active.as_ref().map(|a|serde_json::json!({"phase":a.transaction.phase,"frame":a.transaction.frame,"reads":a.reads})),
            "fault":self.fault,"failed_attempt":self.failed_attempt})
    }
}

fn validate_tag(tag: &str) -> Result<(), String> {
    if tag.trim().is_empty() || tag.len() > 128 { return Err("HOST_TIME_TAG_INVALID: expected 1..128 nonblank UTF-8 bytes".into()); }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn each_read_invokes_source_and_equal_samples_are_valid() {
        let mut clock=HostTime::new(Some(HostTimeConfig::Record { max_samples: 10, max_transactions: 3 })).unwrap();
        let calls=Rc::new(Cell::new(0)); let counter=Rc::clone(&calls);
        clock.source.read=Rc::new(move || { let n=counter.get(); counter.set(n+1); Ok([77,77,160][n]) });
        clock.begin("start",0).unwrap();
        assert_eq!(clock.sample("first".into()).unwrap(),77.);
        assert_eq!(clock.sample("second".into()).unwrap(),77.);
        assert_eq!(clock.sample("third".into()).unwrap(),160.);
        clock.finish().unwrap();
        assert_eq!(calls.get(),3);
        assert_eq!(clock.tape().unwrap().transactions[0].samples.len(),3);
    }
    #[test]
    fn unsafe_time_is_terminal_without_rounding_or_wrapping() {
        let mut clock=HostTime::new(Some(HostTimeConfig::Live)).unwrap();
        clock.source.read=Rc::new(||Ok(MAX_SAFE_MILLISECONDS+1));
        clock.begin("start",0).unwrap();
        assert!(clock.sample("x".into()).unwrap_err().contains("OVERFLOW"));
        assert!(clock.finish().is_err());
        assert_eq!(clock.source.calls.get(),1);
        assert!(clock.sample("x".into()).is_err());
        assert_eq!(clock.source.calls.get(),1);
    }
}
