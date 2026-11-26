//! Memory for `game test`: how many test processes the machine holds at once.
//!
//! A test starts only when the physical memory the OS reports as available,
//! less what the tests already running may still grow (each is taken to need
//! its last measured peak and an eighth more), leaves the reserve free after it:
//! a quarter of the memory, at least 8 GiB (half the memory on machines with
//! less than 16 GiB). When the machine runs no test, one starts while more than
//! half the reserve is free, so a test too large to fit beside the reserve still
//! runs, alone, and a run waits only while other programs hold the memory.
//!
//! Every `game test` on the machine shares that budget through a ledger in one
//! directory ([`shared_dir`]): `ledger.json` lists the tests running and the runs
//! waiting, changed only under the lock on `ledger.lock`. A run that cannot start
//! its next test is listed as waiting, and only the run that has waited longest
//! starts a test, so no run starves while another keeps the memory busy. Each
//! run holds the lock on its own `<owner>.alive` file while it lives; when it
//! dies the OS releases that lock and the next run to look drops what it held.
use std::{
    collections::BTreeSet,
    fs::{self, File, OpenOptions},
    io,
    path::{Path, PathBuf},
    process::{Child, ExitStatus},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

pub const GIB: u64 = 1 << 30;
/// What a test is taken to need when no test of the project was measured yet.
pub const DEFAULT_NEED: u64 = 2 * GIB;
/// Where every `game test` on the machine shares the memory; the default is per user.
pub const DIR_VARIABLE: &str = "UNONE_TEST_MEMORY_DIR";
/// Bytes to keep free instead of the default (`12G`, `512M` and plain bytes read).
pub const RESERVE_VARIABLE: &str = "UNONE_TEST_MEMORY_RESERVE";

/// Physical memory as the OS reports it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct Memory {
    pub total: u64,
    pub available: u64,
}

/// What stays free by default: a quarter of the memory, at least 8 GiB, but
/// never more than half of it.
pub fn default_reserve(total: u64) -> u64 {
    (total / 4).max((8 * GIB).min(total / 2))
}

/// The reserve: [`RESERVE_VARIABLE`] when it reads as bytes, else [`default_reserve`].
pub fn reserve(total: u64) -> u64 {
    std::env::var(RESERVE_VARIABLE).ok().and_then(|text| parse_bytes(&text)).unwrap_or_else(|| default_reserve(total))
}

/// `12G`, `12GB`, `12GiB`, `1.5T`, `512M`, `4096K` or plain bytes; units are powers of 1024.
pub fn parse_bytes(text: &str) -> Option<u64> {
    let text = text.trim();
    let split = text.find(|c: char| !c.is_ascii_digit() && c != '.').unwrap_or(text.len());
    let (number, unit) = text.split_at(split);
    let number: f64 = number.parse().ok()?;
    let unit = unit.trim().to_ascii_uppercase();
    let shift = match unit.trim_end_matches("IB").trim_end_matches('B') {
        "" => 0,
        "K" => 10,
        "M" => 20,
        "G" => 30,
        "T" => 40,
        _ => return None,
    };
    (number.is_finite() && number >= 0.0).then(|| (number * (1u64 << shift) as f64) as u64)
}

/// What a test is taken to need: its last measured peak and an eighth more; a
/// test never measured, the largest peak measured in the project and an eighth
/// more; [`DEFAULT_NEED`] when none was measured.
pub fn need(peak: Option<u64>, largest: Option<u64>) -> u64 {
    peak.or(largest).map_or(DEFAULT_NEED, |peak| peak.saturating_add(peak / 8))
}

/// A test running on the machine: what it was taken to need, and what it uses now.
#[derive(Clone, Copy, Debug)]
pub struct Holding {
    pub need: u64,
    pub using: u64,
}

/// What the running tests may still grow: each up to what it was taken to need.
pub fn growth(holdings: &[Holding]) -> u64 {
    holdings.iter().map(|holding| holding.need.saturating_sub(holding.using)).sum()
}

/// What a new test may use: the available memory less the reserve and what the
/// running tests may still grow.
pub fn room(memory: Memory, reserve: u64, holdings: &[Holding]) -> u64 {
    memory.available.saturating_sub(reserve).saturating_sub(growth(holdings))
}

/// What must be free for a test to start when the machine runs none: half the
/// reserve, or half the default one when a larger reserve was asked for.
pub fn floor(memory: Memory, reserve: u64) -> u64 {
    reserve.min(default_reserve(memory.total)) / 2
}

/// Whether a test that needs `need` may start now. When the machine runs no
/// test, one may while more than the [`floor`] is free, whatever it needs, so
/// a run waits only while the memory is short, not forever for a test that
/// would not fit beside the reserve.
pub fn may_start(memory: Memory, reserve: u64, holdings: &[Holding], need: u64) -> bool {
    if holdings.is_empty() {
        return memory.available > floor(memory, reserve);
    }
    need <= room(memory, reserve, holdings)
}

/// Why a test did not start.
#[derive(Clone, Debug, Serialize)]
pub struct Wait {
    pub need: u64,
    pub memory: Memory,
    pub reserve: u64,
    /// What the running tests may still grow.
    pub growth: u64,
    /// What a new test may use now.
    pub room: u64,
    /// Waiting runs that go first.
    pub ahead: usize,
    /// Tests running on the machine: of this run, and of other runs.
    pub running_here: usize,
    pub running_elsewhere: usize,
    /// The projects of the other runs that hold or wait for memory.
    pub others: Vec<String>,
}

impl Wait {
    /// One line on what the run waits for.
    pub fn sentence(&self) -> String {
        let mut text = format!(
            "{} of {} free, {} kept free, {} test(s) running may still grow {}: {} left for a test that needs about {}",
            gb(self.memory.available),
            gb(self.memory.total),
            gb(self.reserve),
            self.running_here + self.running_elsewhere,
            gb(self.growth),
            gb(self.room),
            gb(self.need),
        );
        if self.ahead > 0 {
            text = format!("{} other game test run(s) waited first; {text}", self.ahead);
        }
        if self.running_here + self.running_elsewhere == 0 {
            text.push_str(&format!("; with no test running on the machine one starts once more than {} is free", gb(floor(self.memory, self.reserve))));
        }
        if self.running_elsewhere > 0 || !self.others.is_empty() {
            text.push_str(&format!(" ({} of the running tests belong to other runs: {})", self.running_elsewhere, self.others.join(", ")));
        }
        text
    }
}

/// Bytes as GB with one decimal.
pub fn gb(bytes: u64) -> String {
    format!("{:.1} GB", bytes as f64 / GIB as f64)
}

/// How the ledger reads memory: the OS, or fixed numbers in tests.
pub struct Probe {
    pub memory: Box<dyn Fn() -> Option<Memory>>,
    /// What a process uses now (its working set), if it can be read.
    pub using: Box<dyn Fn(u32) -> Option<u64>>,
    /// The bytes to keep free out of the total.
    pub reserve: Box<dyn Fn(u64) -> u64>,
}

impl Probe {
    pub fn os() -> Self {
        Self { memory: Box::new(os::memory), using: Box::new(os::using), reserve: Box::new(reserve) }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum State {
    Waiting,
    Running,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
struct Entry {
    owner: String,
    state: State,
    /// This run's number for a running test; 0 for a waiting run.
    #[serde(default)]
    id: u64,
    need: u64,
    /// The process that holds the memory; 0 when there is none.
    #[serde(default)]
    pid: u32,
    /// Since when it runs, or waits (milliseconds since 1970).
    since_ms: u64,
    project: String,
    test: String,
}

#[derive(Default, Serialize, Deserialize)]
struct Book {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    entries: Vec<Entry>,
}

const LEDGER: &str = "ledger.json";
const LOCK: &str = "ledger.lock";
const ALIVE: &str = ".alive";

/// Where every `game test` of this user on this machine shares the memory:
/// [`DIR_VARIABLE`], else `%LOCALAPPDATA%\Unone\test-memory` on Windows and
/// `<temp>/unone-test-memory-<user>` elsewhere.
pub fn shared_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os(DIR_VARIABLE).filter(|dir| !dir.is_empty()) {
        return PathBuf::from(dir);
    }
    if cfg!(windows)
        && let Some(local) = std::env::var_os("LOCALAPPDATA").filter(|dir| !dir.is_empty())
    {
        return PathBuf::from(local).join("Unone").join("test-memory");
    }
    let user = std::env::var("USER").or_else(|_| std::env::var("USERNAME")).unwrap_or_else(|_| "user".to_string());
    let user: String = user.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '_' }).collect();
    std::env::temp_dir().join(format!("unone-test-memory-{user}"))
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |since| u64::try_from(since.as_millis()).unwrap_or(u64::MAX))
}

/// This run's place in the machine's ledger.
pub struct Ledger {
    /// The shared directory; `None` when it cannot be used, and then the run
    /// only counts its own tests.
    dir: Option<PathBuf>,
    /// Why the shared directory is not used.
    pub problem: Option<String>,
    owner: String,
    alive: Option<File>,
    /// The entries when there is no shared directory.
    local: Vec<Entry>,
    project: String,
    probe: Probe,
    next_id: u64,
    waiting: bool,
}

static OWNERS: AtomicU64 = AtomicU64::new(0);

impl Ledger {
    /// Joins the ledger in [`shared_dir`] for a run of `project`.
    pub fn open(project: &str, probe: Probe) -> Self {
        Self::open_in(Some(shared_dir()), project, probe)
    }

    /// Joins the ledger in `dir`, or only this run's own when `None`.
    pub fn open_in(dir: Option<PathBuf>, project: &str, probe: Probe) -> Self {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |since| since.as_nanos());
        let owner = format!("{}-{nanos}-{}", std::process::id(), OWNERS.fetch_add(1, Ordering::Relaxed));
        let mut ledger = Self {
            dir: None,
            problem: None,
            owner,
            alive: None,
            local: Vec::new(),
            project: project.to_string(),
            probe,
            next_id: 1,
            waiting: false,
        };
        if let Some(dir) = dir {
            let joined = fs::create_dir_all(&dir).and_then(|()| {
                let alive = OpenOptions::new().write(true).create_new(true).open(dir.join(format!("{}{ALIVE}", ledger.owner)))?;
                alive.lock()?;
                Ok(alive)
            });
            match joined {
                Ok(alive) => {
                    ledger.alive = Some(alive);
                    ledger.dir = Some(dir);
                }
                Err(error) => ledger.problem = Some(format!("{}: {error}", dir.display())),
            }
        }
        ledger
    }

    /// The shared directory, when the run uses one.
    pub fn dir(&self) -> Option<&Path> {
        self.dir.as_deref()
    }

    /// Starts a test that needs `need` bytes if the machine has room for it and
    /// no other run waited longer: `start` runs under the ledger's lock and
    /// returns the process that holds the memory (0 for none) and what the
    /// caller keeps. Otherwise the run is listed as waiting and learns why.
    pub fn try_start<T>(&mut self, need: u64, test: &str, start: impl FnOnce() -> (u32, T)) -> Result<(u64, T), Wait> {
        let mut start = Some(start);
        let id = self.next_id;
        let (owner, project) = (self.owner.clone(), self.project.clone());
        let probe = &self.probe;
        let now = now_ms();
        let outcome = transact(self.dir.as_deref(), &owner, &mut self.local, |entries| {
            let mine = entries.iter().position(|entry| entry.owner == owner && entry.state == State::Waiting);
            let since = mine.map_or(now, |at| entries[at].since_ms);
            let ahead = entries
                .iter()
                .filter(|entry| entry.state == State::Waiting && entry.owner != owner && (entry.since_ms, &entry.owner) < (since, &owner))
                .count();
            let running: Vec<&Entry> = entries.iter().filter(|entry| entry.state == State::Running).collect();
            let holdings: Vec<Holding> = running
                .iter()
                .map(|entry| Holding { need: entry.need, using: if entry.pid == 0 { 0 } else { (probe.using)(entry.pid).unwrap_or(0) } })
                .collect();
            let memory = (probe.memory)();
            let go = match memory {
                // Memory that cannot be read does not hold tests back.
                None => true,
                Some(memory) => ahead == 0 && may_start(memory, (probe.reserve)(memory.total), &holdings, need),
            };
            if go {
                if let Some(at) = mine {
                    entries.remove(at);
                }
                let (pid, value) = (start.take().expect("started once"))();
                entries.push(Entry { owner: owner.clone(), state: State::Running, id, need, pid, since_ms: now, project: project.clone(), test: test.to_string() });
                return Ok(value);
            }
            let memory = memory.expect("memory read");
            let reserve = (probe.reserve)(memory.total);
            let others: BTreeSet<String> = entries.iter().filter(|entry| entry.owner != owner).map(|entry| entry.project.clone()).collect();
            let wait = Wait {
                need,
                memory,
                reserve,
                growth: growth(&holdings),
                room: room(memory, reserve, &holdings),
                ahead,
                running_here: running.iter().filter(|entry| entry.owner == owner).count(),
                running_elsewhere: running.iter().filter(|entry| entry.owner != owner).count(),
                others: others.into_iter().collect(),
            };
            let entry = Entry { owner: owner.clone(), state: State::Waiting, id: 0, need, pid: 0, since_ms: since, project: project.clone(), test: test.to_string() };
            match mine {
                Some(at) => entries[at] = entry,
                None => entries.push(entry),
            }
            Err(wait)
        });
        let outcome = match outcome {
            Ok(outcome) => outcome,
            Err(error) => {
                // The shared ledger failed: this run goes on counting only its own tests.
                self.problem = Some(format!("{}: {error}", self.dir.as_ref().map_or_else(String::new, |dir| dir.display().to_string())));
                self.dir = None;
                match start.take() {
                    Some(start) => {
                        let (pid, value) = start();
                        self.local.push(Entry { owner, state: State::Running, id, need, pid, since_ms: now, project, test: test.to_string() });
                        Ok(value)
                    }
                    None => unreachable!("a started test is recorded before the ledger is written"),
                }
            }
        };
        self.waiting = outcome.is_err();
        match outcome {
            Ok(value) => {
                self.next_id += 1;
                Ok((id, value))
            }
            Err(wait) => Err(wait),
        }
    }

    /// The test `id` (from [`Ledger::try_start`]) ended: its memory is free.
    pub fn finish(&mut self, id: u64) {
        let owner = self.owner.clone();
        let _ = transact(self.dir.as_deref(), &owner, &mut self.local, |entries| {
            entries.retain(|entry| !(entry.owner == owner && entry.state == State::Running && entry.id == id));
        });
    }

    /// The run no longer waits (it has all the tests it may run going, or none
    /// left to start), so it lets the runs behind it go first.
    pub fn stop_waiting(&mut self) {
        if !self.waiting {
            return;
        }
        self.waiting = false;
        let owner = self.owner.clone();
        let _ = transact(self.dir.as_deref(), &owner, &mut self.local, |entries| {
            entries.retain(|entry| !(entry.owner == owner && entry.state == State::Waiting));
        });
    }
}

impl Drop for Ledger {
    fn drop(&mut self) {
        let owner = self.owner.clone();
        let _ = transact(self.dir.as_deref(), &owner, &mut self.local, |entries| entries.retain(|entry| entry.owner != owner));
        if let (Some(dir), Some(alive)) = (&self.dir, self.alive.take()) {
            drop(alive);
            let _ = fs::remove_file(dir.join(format!("{}{ALIVE}", self.owner)));
        }
    }
}

/// Reads the ledger in `dir` (or `local`) under its lock, drops what dead runs
/// held, applies `change` and writes it back if it changed. An error means
/// `change` did not run.
fn transact<R>(dir: Option<&Path>, owner: &str, local: &mut Vec<Entry>, change: impl FnOnce(&mut Vec<Entry>) -> R) -> io::Result<R> {
    let Some(dir) = dir else { return Ok(change(local)) };
    let lock = OpenOptions::new().write(true).create(true).truncate(false).open(dir.join(LOCK))?;
    lock.lock()?;
    let path = dir.join(LEDGER);
    let mut book: Book = fs::read(&path).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default();
    let alive = live_owners(dir, owner);
    let read = book.entries.clone();
    book.entries.retain(|entry| entry.owner == owner || alive.contains(&entry.owner));
    let result = change(&mut book.entries);
    if book.entries != read {
        book.version = 1;
        let bytes = serde_json::to_vec_pretty(&book).unwrap_or_default();
        let temporary = dir.join(format!("{LEDGER}.{owner}.tmp"));
        // A scanner holding the ledger open can refuse the rename; then write it in place.
        if fs::write(&temporary, &bytes).and_then(|()| fs::rename(&temporary, &path)).is_err() {
            let _ = fs::remove_file(&temporary);
            let _ = fs::write(&path, &bytes);
        }
    }
    // Closing the file releases the lock too; errors here come after the change.
    let _ = lock.unlock();
    Ok(result)
}

/// The runs whose `.alive` lock is held. The files of dead runs are removed.
fn live_owners(dir: &Path, me: &str) -> BTreeSet<String> {
    let mut alive = BTreeSet::new();
    let Ok(listing) = fs::read_dir(dir) else { return alive };
    for item in listing.flatten() {
        let name = item.file_name().to_string_lossy().into_owned();
        let Some(owner) = name.strip_suffix(ALIVE) else { continue };
        if owner == me {
            continue;
        }
        let Ok(file) = OpenOptions::new().write(true).open(item.path()) else {
            // Not readable now (being removed, or scanned): count it alive until it can be read.
            alive.insert(owner.to_string());
            continue;
        };
        match file.try_lock() {
            Ok(()) => {
                drop(file);
                let _ = fs::remove_file(item.path());
            }
            Err(_) => {
                alive.insert(owner.to_string());
            }
        }
    }
    alive
}

/// Waits for `child` and reads the peak of its working set (bytes).
pub fn wait_with_peak(child: &mut Child) -> io::Result<(ExitStatus, Option<u64>)> {
    os::wait_with_peak(child)
}

#[cfg(windows)]
mod os {
    use super::Memory;
    use std::{
        io,
        os::windows::io::AsRawHandle,
        process::{Child, ExitStatus},
    };
    use windows_sys::Win32::{
        Foundation::{CloseHandle, HANDLE},
        System::{
            ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS},
            SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX},
            Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_VM_READ},
        },
    };

    pub fn memory() -> Option<Memory> {
        // SAFETY: MEMORYSTATUSEX is plain data; dwLength is set as the call requires.
        let mut status: MEMORYSTATUSEX = unsafe { std::mem::zeroed() };
        status.dwLength = size_of::<MEMORYSTATUSEX>() as u32;
        (unsafe { GlobalMemoryStatusEx(&mut status) } != 0).then_some(Memory { total: status.ullTotalPhys, available: status.ullAvailPhys })
    }

    fn counters(process: HANDLE) -> Option<PROCESS_MEMORY_COUNTERS> {
        // SAFETY: plain data, with cb set to its size; the handle is valid for the call.
        let mut counters: PROCESS_MEMORY_COUNTERS = unsafe { std::mem::zeroed() };
        counters.cb = size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
        (unsafe { GetProcessMemoryInfo(process, &mut counters, counters.cb) } != 0).then_some(counters)
    }

    pub fn using(pid: u32) -> Option<u64> {
        // SAFETY: the handle is checked and closed here.
        let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ, 0, pid) };
        if process.is_null() {
            return None;
        }
        let read = counters(process);
        unsafe { CloseHandle(process) };
        read.map(|counters| counters.WorkingSetSize as u64)
    }

    pub fn wait_with_peak(child: &mut Child) -> io::Result<(ExitStatus, Option<u64>)> {
        let status = child.wait()?;
        // The ended process keeps its counters while its handle is open.
        Ok((status, counters(child.as_raw_handle() as HANDLE).map(|counters| counters.PeakWorkingSetSize as u64)))
    }
}

#[cfg(unix)]
mod os {
    use super::Memory;
    use std::{
        io,
        os::unix::process::ExitStatusExt,
        process::{Child, ExitStatus},
    };

    pub fn wait_with_peak(child: &mut Child) -> io::Result<(ExitStatus, Option<u64>)> {
        let pid = child.id() as libc::pid_t;
        let mut status: libc::c_int = 0;
        // SAFETY: rusage is plain data that wait4 fills.
        let mut usage: libc::rusage = unsafe { std::mem::zeroed() };
        loop {
            if unsafe { libc::wait4(pid, &mut status, 0, &mut usage) } == pid {
                break;
            }
            let error = io::Error::last_os_error();
            if error.kind() != io::ErrorKind::Interrupted {
                return Err(error);
            }
        }
        // Linux counts the peak in KiB, macOS in bytes.
        let scale = if cfg!(target_vendor = "apple") { 1 } else { 1024 };
        Ok((ExitStatus::from_raw(status), u64::try_from(usage.ru_maxrss).ok().map(|peak| peak * scale)))
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    fn kib(text: &str, key: &str) -> Option<u64> {
        let line = text.lines().find(|line| line.starts_with(key))?;
        line[key.len()..].trim().trim_end_matches("kB").trim().parse::<u64>().ok().map(|kib| kib * 1024)
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub fn memory() -> Option<Memory> {
        let text = std::fs::read_to_string("/proc/meminfo").ok()?;
        Some(Memory { total: kib(&text, "MemTotal:")?, available: kib(&text, "MemAvailable:")? })
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub fn using(pid: u32) -> Option<u64> {
        kib(&std::fs::read_to_string(format!("/proc/{pid}/status")).ok()?, "VmRSS:")
    }

    #[cfg(target_vendor = "apple")]
    fn sysctl<T: Copy>(name: &str) -> Option<T> {
        let name = std::ffi::CString::new(name).ok()?;
        let mut value = std::mem::MaybeUninit::<T>::uninit();
        let mut size = size_of::<T>();
        // SAFETY: the buffer holds size bytes; the call writes at most that.
        let read = unsafe { libc::sysctlbyname(name.as_ptr(), value.as_mut_ptr().cast(), &mut size, std::ptr::null_mut(), 0) };
        (read == 0 && size == size_of::<T>()).then(|| unsafe { value.assume_init() })
    }

    #[cfg(target_vendor = "apple")]
    pub fn memory() -> Option<Memory> {
        let total: u64 = sysctl("hw.memsize")?;
        // The share of memory the kernel counts as available, in percent.
        let level: libc::c_int = sysctl("kern.memorystatus_level")?;
        Some(Memory { total, available: total / 100 * u64::try_from(level.clamp(0, 100)).ok()? })
    }

    #[cfg(target_vendor = "apple")]
    pub fn using(pid: u32) -> Option<u64> {
        // SAFETY: proc_taskinfo is plain data and the call writes at most its size.
        let mut info: libc::proc_taskinfo = unsafe { std::mem::zeroed() };
        let size = size_of::<libc::proc_taskinfo>() as libc::c_int;
        let read = unsafe { libc::proc_pidinfo(pid as libc::c_int, libc::PROC_PIDTASKINFO, 0, (&mut info as *mut libc::proc_taskinfo).cast(), size) };
        (read == size).then_some(info.pti_resident_size)
    }

    #[cfg(not(any(target_os = "linux", target_os = "android", target_vendor = "apple")))]
    pub fn memory() -> Option<Memory> {
        None
    }

    #[cfg(not(any(target_os = "linux", target_os = "android", target_vendor = "apple")))]
    pub fn using(_pid: u32) -> Option<u64> {
        None
    }
}

#[cfg(not(any(windows, unix)))]
mod os {
    use super::Memory;
    use std::{
        io,
        process::{Child, ExitStatus},
    };
    pub fn memory() -> Option<Memory> {
        None
    }
    pub fn using(_pid: u32) -> Option<u64> {
        None
    }
    pub fn wait_with_peak(child: &mut Child) -> io::Result<(ExitStatus, Option<u64>)> {
        Ok((child.wait()?, None))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};
    use std::{
        io::{BufRead, BufReader},
        process::{Command, Stdio},
        time::{Duration, Instant},
    };

    /// Set for a helper process: what it does, as JSON.
    const HELPER: &str = "UNONE_TEST_MEMORY_HELPER";

    fn fixed(available: u64, total: u64, reserve: u64) -> Probe {
        Probe { memory: Box::new(move || Some(Memory { total, available })), using: Box::new(|_| Some(0)), reserve: Box::new(move |_| reserve) }
    }

    fn micros() -> u128 {
        SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_micros()
    }

    #[test]
    fn the_reserve_is_a_quarter_but_at_least_8_gib_and_at_most_half() {
        assert_eq!(default_reserve(64 * GIB), 16 * GIB);
        assert_eq!(default_reserve(24 * GIB), 8 * GIB);
        assert_eq!(default_reserve(16 * GIB), 8 * GIB);
        assert_eq!(default_reserve(8 * GIB), 4 * GIB);
        // The machine that ran out of memory with five suites: 61.6 GiB keeps 15.4 GiB.
        let total = (61.6 * GIB as f64) as u64;
        assert_eq!(default_reserve(total), total / 4);
    }

    #[test]
    fn bytes_read_with_or_without_units() {
        assert_eq!(parse_bytes("12G"), Some(12 * GIB));
        assert_eq!(parse_bytes("12GB"), Some(12 * GIB));
        assert_eq!(parse_bytes(" 12 GiB "), Some(12 * GIB));
        assert_eq!(parse_bytes("1.5t"), Some(1536 * GIB));
        assert_eq!(parse_bytes("512M"), Some(512 << 20));
        assert_eq!(parse_bytes("4096"), Some(4096));
        assert_eq!(parse_bytes("lots"), None);
        assert_eq!(parse_bytes("12X"), None);
        assert_eq!(parse_bytes(""), None);
    }

    #[test]
    fn a_test_needs_its_last_peak_and_an_eighth_more() {
        assert_eq!(need(Some(8 * GIB), Some(16 * GIB)), 9 * GIB);
        assert_eq!(need(None, Some(8 * GIB)), 9 * GIB, "never measured: the largest peak of the project");
        assert_eq!(need(None, None), DEFAULT_NEED);
    }

    #[test]
    fn a_test_starts_when_the_reserve_stays_free_after_it_and_what_running_tests_may_grow() {
        let memory = Memory { total: 64 * GIB, available: 40 * GIB };
        let reserve = 16 * GIB;
        // None runs: one may, even one that does not fit, while more than half the reserve is free.
        assert!(may_start(memory, reserve, &[], 100 * GIB));
        assert!(may_start(Memory { total: 64 * GIB, available: 8 * GIB + 1 }, reserve, &[], 100 * GIB));
        assert!(!may_start(Memory { total: 64 * GIB, available: 8 * GIB }, reserve, &[], 1));
        // A reserve larger than the default does not raise that floor.
        assert_eq!(floor(memory, 1 << 50), 8 * GIB);
        assert_eq!(floor(memory, 4 * GIB), 2 * GIB);
        // Two 4 GiB tests that just started use nothing yet: 40 - 16 - 8 = 16 GiB left.
        let fresh = [Holding { need: 4 * GIB, using: 0 }; 2];
        assert_eq!(growth(&fresh), 8 * GIB);
        assert_eq!(room(memory, reserve, &fresh), 16 * GIB);
        assert!(may_start(memory, reserve, &fresh, 16 * GIB));
        assert!(!may_start(memory, reserve, &fresh, 16 * GIB + 1));
        // Grown to (or past) their need, they hold back only what the available memory already shows.
        let grown = [Holding { need: 4 * GIB, using: 4 * GIB }, Holding { need: 4 * GIB, using: 5 * GIB }];
        assert_eq!(growth(&grown), 0);
        assert_eq!(room(Memory { total: 64 * GIB, available: 31 * GIB }, reserve, &grown), 15 * GIB);
        // Other programs took the memory down below the reserve: no room.
        assert_eq!(room(Memory { total: 64 * GIB, available: 10 * GIB }, reserve, &fresh), 0);
        assert!(!may_start(Memory { total: 64 * GIB, available: 10 * GIB }, reserve, &fresh, 1));
    }

    #[test]
    fn the_run_that_waited_longest_starts_first() {
        let dir = tempfile::tempdir().unwrap();
        // 40 GiB available, 16 kept free: 24 GiB, three tests of 8 GiB.
        let open = || Ledger::open_in(Some(dir.path().to_path_buf()), "p", fixed(40 * GIB, 64 * GIB, 16 * GIB));
        let (mut a, mut b, mut c) = (open(), open(), open());
        let held: Vec<u64> = (0..3).map(|_| a.try_start(8 * GIB, "a", || (0, ())).unwrap().0).collect();
        let wait = a.try_start(8 * GIB, "a", || (0, ())).unwrap_err();
        assert_eq!((wait.room, wait.running_here, wait.running_elsewhere, wait.ahead), (0, 3, 0, 0));
        assert!(wait.sentence().contains("0.0 GB left for a test that needs about 8.0 GB"), "{}", wait.sentence());
        a.stop_waiting();
        let wait = b.try_start(8 * GIB, "b", || (0, ())).unwrap_err();
        assert_eq!((wait.running_here, wait.running_elsewhere, wait.ahead), (0, 3, 0));
        std::thread::sleep(Duration::from_millis(5));
        assert_eq!(c.try_start(8 * GIB, "c", || (0, ())).unwrap_err().ahead, 1, "b waited first");
        a.finish(held[0]);
        // Room for one: c would fit, but b waited longer.
        let wait = c.try_start(8 * GIB, "c", || (0, ())).unwrap_err();
        assert_eq!((wait.ahead, wait.room), (1, 8 * GIB));
        assert!(b.try_start(8 * GIB, "b", || (0, ())).is_ok());
        // b waits no more: c goes next, once there is room.
        let wait = c.try_start(8 * GIB, "c", || (0, ())).unwrap_err();
        assert_eq!((wait.ahead, wait.room), (0, 0));
        drop(a);
        assert!(c.try_start(8 * GIB, "c", || (0, ())).is_ok(), "a run that ends frees what it held");
        assert!(c.try_start(8 * GIB, "c", || (0, ())).is_ok());
        assert!(c.try_start(8 * GIB, "c", || (0, ())).is_err());
    }

    #[test]
    fn with_no_test_running_one_waits_only_while_memory_is_short() {
        let dir = tempfile::tempdir().unwrap();
        // Other programs left 6 GiB of 64: less than half the 16 GiB reserve.
        let mut short = Ledger::open_in(Some(dir.path().to_path_buf()), "p", fixed(6 * GIB, 64 * GIB, 16 * GIB));
        let wait = short.try_start(GIB, "t", || (0, ())).unwrap_err();
        assert!(wait.sentence().contains("with no test running on the machine one starts once more than 8.0 GB is free"), "{}", wait.sentence());
        drop(short);
        // 9 GiB: a 12 GiB test cannot fit beside the reserve, but runs alone.
        let mut alone = Ledger::open_in(Some(dir.path().to_path_buf()), "p", fixed(9 * GIB, 64 * GIB, 16 * GIB));
        alone.try_start(12 * GIB, "big", || (0, ())).unwrap();
        assert_eq!(alone.try_start(GIB, "small", || (0, ())).unwrap_err().running_here, 1);
    }

    #[test]
    fn a_ledger_that_cannot_be_shared_still_counts_the_runs_own_tests() {
        let file = tempfile::NamedTempFile::new().unwrap();
        // A file where the directory should be.
        let mut ledger = Ledger::open_in(Some(file.path().join("ledger")), "p", fixed(40 * GIB, 64 * GIB, 16 * GIB));
        assert!(ledger.problem.is_some());
        assert!(ledger.dir().is_none());
        for _ in 0..3 {
            ledger.try_start(8 * GIB, "a", || (0, ())).unwrap();
        }
        assert_eq!(ledger.try_start(8 * GIB, "a", || (0, ())).unwrap_err().running_here, 3);
    }

    #[test]
    fn the_os_reports_memory_and_peaks() {
        let memory = os::memory().expect("this OS reports its memory");
        assert!(memory.total > 0 && memory.available <= memory.total, "{memory:?}");
        assert!(os::using(std::process::id()).is_some_and(|using| using > 0));
        // A helper that touches 256 MiB and ends: its peak counts them.
        let mut child = helper(json!({"mode": "touch", "bytes": 256u64 << 20})).spawn().unwrap();
        let (status, peak) = wait_with_peak(&mut child).unwrap();
        assert!(status.success());
        let peak = peak.expect("the peak of an ended child");
        assert!(peak >= 256 << 20 && peak < 4 * GIB, "{peak}");
    }

    /// This test binary again, running [`helper_process`] with `spec`.
    fn helper(spec: Value) -> Command {
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args(["--exact", "test_memory::tests::helper_process", "--ignored", "--nocapture", "--test-threads", "1"])
            .env(HELPER, spec.to_string())
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        command
    }

    /// The `start <id> <µs>` / `end <id> <µs>` a helper printed, as (µs, +1 or -1, run). The
    /// harness prints on the same lines, so they are read word by word.
    fn spans(output: &[u8], run: usize) -> Vec<(u128, i32, usize)> {
        let text = String::from_utf8_lossy(output);
        let words: Vec<&str> = text.split_whitespace().collect();
        words
            .windows(3)
            .filter_map(|three| {
                let step = match three[0] {
                    "start" => 1,
                    "end" => -1,
                    _ => return None,
                };
                Some((three[2].parse().ok()?, step, run))
            })
            .collect()
    }

    #[test]
    fn two_runs_at_once_never_hold_more_than_the_machine_has() {
        let dir = tempfile::tempdir().unwrap();
        // 40 GiB available, 16 kept free: room for six 4 GiB tests on the machine.
        // Each run would take eight at once on its own.
        let spec = |name: &str| {
            json!({"mode": "run", "dir": dir.path(), "name": name, "available": 40 * GIB, "total": 64 * GIB,
                   "reserve": 16 * GIB, "need": 4 * GIB, "tests": 12, "jobs": 8, "hold_ms": 150})
        };
        let runs: Vec<_> = ["one", "two"].iter().map(|name| helper(spec(name)).spawn().unwrap()).collect();
        let outputs: Vec<_> = runs.into_iter().map(|run| run.wait_with_output().unwrap()).collect();
        let mut events = Vec::new();
        for (run, output) in outputs.iter().enumerate() {
            assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stdout));
            let spans = spans(&output.stdout, run);
            assert_eq!(spans.len(), 24, "every test of run {run} started and ended: {}", String::from_utf8_lossy(&output.stdout));
            events.extend(spans);
        }
        // Ends first where times tie: a test's end is printed before its memory is freed.
        events.sort();
        let (mut running, mut most, mut per_run, mut together) = (0i32, 0, [0i32; 2], false);
        for (_, step, run) in events {
            running += step;
            per_run[run] += step;
            most = most.max(running);
            together |= per_run[0] > 0 && per_run[1] > 0;
        }
        assert!(most <= 6, "{most} tests of 4 GiB held memory at once; the machine had room for 6");
        assert!(together, "the two runs ran tests at the same time");
    }

    #[test]
    fn what_a_run_that_dies_held_is_freed() {
        let dir = tempfile::tempdir().unwrap();
        let mut run = helper(json!({"mode": "hold", "dir": dir.path(), "name": "doomed", "available": 40 * GIB, "total": 64 * GIB,
                                     "reserve": 16 * GIB, "need": 12 * GIB, "tests": 2}))
        .spawn()
        .unwrap();
        let mut lines = BufReader::new(run.stdout.take().unwrap()).lines();
        assert!(lines.any(|line| line.unwrap().contains("HELD")), "the helper took the whole machine");
        let mut ledger = Ledger::open_in(Some(dir.path().to_path_buf()), "here", fixed(40 * GIB, 64 * GIB, 16 * GIB));
        let wait = ledger.try_start(4 * GIB, "t", || (0, ())).unwrap_err();
        assert_eq!((wait.running_elsewhere, wait.room, wait.others.as_slice()), (2, 0, ["doomed".to_string()].as_slice()));
        run.kill().unwrap();
        run.wait().unwrap();
        let started = Instant::now();
        loop {
            match ledger.try_start(4 * GIB, "t", || (0, ())) {
                Ok(_) => break,
                // The OS may take a moment to release a killed process's lock.
                Err(wait) => assert!(started.elapsed() < Duration::from_secs(10), "still held: {}", wait.sentence()),
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        let alive = fs::read_dir(dir.path()).unwrap().flatten().filter(|item| item.file_name().to_string_lossy().ends_with(ALIVE)).count();
        assert_eq!(alive, 1, "only this run's .alive file is left");
    }

    /// Not a test: what the tests above start as other processes (`HELPER`).
    #[test]
    #[ignore = "a helper process of the tests above"]
    fn helper_process() {
        let Ok(spec) = std::env::var(HELPER) else { return };
        let spec: Value = serde_json::from_str(&spec).unwrap();
        let number = |key: &str| spec[key].as_u64().unwrap();
        if spec["mode"] == "touch" {
            let mut bytes = vec![0u8; number("bytes") as usize];
            for page in bytes.chunks_mut(4096) {
                page[0] = 1;
            }
            let touched = std::hint::black_box(&bytes).iter().step_by(4096).filter(|byte| **byte == 1).count();
            assert_eq!(touched, bytes.len().div_ceil(4096));
            return;
        }
        let dir = PathBuf::from(spec["dir"].as_str().unwrap());
        let name = spec["name"].as_str().unwrap();
        let mut ledger = Ledger::open_in(Some(dir), name, fixed(number("available"), number("total"), number("reserve")));
        let (need, tests) = (number("need"), number("tests"));
        if spec["mode"] == "hold" {
            let mut held = 0;
            while held < tests {
                if ledger.try_start(need, "held", || (0, ())).is_ok() {
                    held += 1;
                }
            }
            println!("HELD");
            std::thread::sleep(Duration::from_secs(120));
            return;
        }
        // "run": a run as test_runs schedules it, with tests that hold their memory for hold_ms.
        let (jobs, hold) = (number("jobs") as usize, Duration::from_millis(number("hold_ms")));
        let (mut left, mut running): (u64, Vec<(u64, Instant)>) = (tests, Vec::new());
        while left > 0 || !running.is_empty() {
            while running.len() < jobs && left > 0 {
                match ledger.try_start(need, "test", || (0, ())) {
                    Ok((id, ())) => {
                        println!("start {id} {}", micros());
                        running.push((id, Instant::now() + hold));
                        left -= 1;
                    }
                    Err(_) => break,
                }
            }
            if running.len() >= jobs || left == 0 {
                ledger.stop_waiting();
            }
            let now = Instant::now();
            for (id, _) in running.iter().filter(|(_, until)| *until <= now) {
                println!("end {id} {}", micros());
                ledger.finish(*id);
            }
            running.retain(|(_, until)| *until > now);
            std::thread::sleep(Duration::from_millis(5));
        }
    }
}
