//! Stops a script call that never returns, so a runaway loop ends as a
//! diagnostic naming its line instead of a command that hangs forever.
//!
//! Developer tools only. Nothing runs in the VM until a call has already
//! overrun, so a call that returns pays no per-instruction cost and game results
//! cannot depend on the clock. Luau checks the interrupt slot at loop back edges
//! and calls, so a long native call (one huge pattern search, say) stops only
//! once it returns. Web builds have no thread to watch from and no limit.
use crate::{ActionSuggestion, Diagnostic, SourceLocation};
use std::num::NonZeroU32;

pub(crate) const CODE: &str = "SCRIPT_TIME_LIMIT_EXCEEDED";
/// For projects that declare nothing. Long enough for existing games that do a
/// whole verification in one update; new projects declare a much shorter limit.
const DEFAULT_SECONDS: NonZeroU32 = NonZeroU32::new(600).unwrap();

/// The part of a load that runs the entry script and whatever it requires.
pub(super) const TOP_LEVEL: &str = "The script's top-level code";

pub(super) fn limit(config: &crate::ProjectConfig) -> NonZeroU32 {
    config.script_time_limit_seconds.unwrap_or(DEFAULT_SECONDS)
}

#[cfg(target_family = "wasm")]
pub(super) struct Guard;
#[cfg(target_family = "wasm")]
pub(super) fn watch(_lua: &mlua::Lua, _what: &'static str, _seconds: NonZeroU32) -> Guard {
    Guard
}
#[cfg(not(target_family = "wasm"))]
pub(super) use watching::watch;

#[cfg(not(target_family = "wasm"))]
mod watching {
    use super::CODE;
    use mlua::{Lua, ffi};
    use std::{
        num::NonZeroU32,
        os::raw::c_int,
        ptr, slice,
        sync::{Mutex, MutexGuard, Once, PoisonError},
        thread,
        time::Duration,
    };

    type Interrupt = unsafe extern "C-unwind" fn(*mut ffi::lua_State, c_int);

    /// Time is counted in wakes rather than read from a clock, so a machine that
    /// sleeps through a call does not expire it, and a starved process gets longer.
    const WAKES_PER_SECOND: u64 = 10;

    struct Call {
        id: u64,
        callbacks: *mut ffi::lua_Callbacks,
        what: &'static str,
        seconds: u32,
        wakes: u64,
        /// What the slot held before expiry; `None` until the call expires.
        displaced: Option<Option<Interrupt>>,
        /// Where the first error was raised. A pcall may catch that one, and the
        /// line that matters is the loop it stopped, not the pcall.
        stuck_at: Option<String>,
    }
    // SAFETY: `callbacks` stays valid while the entry exists, because the Guard
    // that removes it owns the VM. It is only dereferenced under WATCHED's lock.
    unsafe impl Send for Call {}

    struct Watched {
        calls: Vec<Call>,
        next_id: u64,
    }
    static WATCHED: Mutex<Watched> = Mutex::new(Watched { calls: Vec::new(), next_id: 0 });

    fn watched() -> MutexGuard<'static, Watched> {
        WATCHED.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub(in super::super) struct Guard {
        id: Option<u64>,
        _vm: Lua,
    }

    /// Watches one call into the script until the guard drops. A sampler or probe
    /// on the VM must outlive the guard: each restores the interrupt it found.
    pub(in super::super) fn watch(lua: &Lua, what: &'static str, seconds: NonZeroU32) -> Guard {
        static STARTED: Once = Once::new();
        // A process that cannot start a thread just runs without the limit.
        STARTED.call_once(|| {
            let _ = thread::Builder::new().name("unone-script-watchdog".into()).spawn(watch_calls);
        });
        let mut callbacks = ptr::null_mut();
        // SAFETY: exec_raw provides a live state; no Lua stack is modified.
        let vm_is_live = unsafe { lua.exec_raw::<()>((), |state| callbacks = ffi::lua_callbacks(state)) }.is_ok();
        let id = vm_is_live.then(|| {
            let mut watched = watched();
            let id = watched.next_id;
            watched.next_id += 1;
            watched.calls.push(Call { id, callbacks, what, seconds: seconds.get(), wakes: 0, displaced: None, stuck_at: None });
            id
        });
        Guard { id, _vm: lua.clone() }
    }

    impl Drop for Guard {
        fn drop(&mut self) {
            let mut watched = watched();
            let Some(index) = watched.calls.iter().position(|call| Some(call.id) == self.id) else { return };
            let call = watched.calls.swap_remove(index);
            if let Some(displaced) = call.displaced {
                // SAFETY: _vm keeps the VM alive; the lock excludes the watcher.
                unsafe { (*call.callbacks).interrupt = displaced };
            }
        }
    }

    fn watch_calls() {
        loop {
            thread::sleep(Duration::from_secs(1) / WAKES_PER_SECOND as u32);
            for call in &mut watched().calls {
                call.wakes += 1;
                if call.displaced.is_none() && call.wakes >= u64::from(call.seconds) * WAKES_PER_SECOND {
                    // The VM thread reads this word unsynchronized at every safe
                    // point, which is how Luau's own CLI profiler sets it too.
                    // SAFETY: the entry's VM is alive while the lock is held.
                    unsafe {
                        let slot = &raw mut (*call.callbacks).interrupt;
                        call.displaced = Some(slot.read_volatile());
                        slot.write_volatile(Some(expired));
                    }
                }
            }
        }
    }

    /// Left in place until the guard drops, so that the error raised at every
    /// later safe point carries through any pcall in the script's way.
    unsafe extern "C-unwind" fn expired(state: *mut ffi::lua_State, gc: c_int) {
        // Non-negative is a GC step, where an error cannot be raised.
        if gc >= 0 {
            return;
        }
        let callbacks = unsafe { ffi::lua_callbacks(state) };
        // SAFETY: an interrupt may raise and may use the stack once reserved.
        // Level 0 is the running Lua function: no C function is on the stack here.
        let here = unsafe {
            ffi::lua_rawcheckstack(state, 1);
            ffi::luaL_where(state, 0);
            let mut length = 0;
            let text = ffi::lua_tolstring(state, -1, &mut length);
            let here = String::from_utf8_lossy(slice::from_raw_parts(text.cast::<u8>(), length)).into_owned();
            ffi::lua_pop(state, 1);
            here
        };
        let message = watched().calls.iter_mut().find(|call| call.callbacks == callbacks).map(|call| {
            let stuck_at = call.stuck_at.get_or_insert(here);
            format!("{stuck_at}{CODE}: {} did not return within {} s", call.what, call.seconds)
        });
        let Some(message) = message else { return };
        // SAFETY: as above; the String is gone before lua_error unwinds this frame.
        unsafe {
            ffi::lua_rawcheckstack(state, 1);
            ffi::lua_pushlstring(state, message.as_ptr().cast(), message.len());
        }
        drop(message);
        unsafe { ffi::lua_error(state) }
    }
}

/// Fills in what the expiry means, if `message` is one.
pub(super) fn describe(message: &str, diagnostic: &mut Diagnostic) {
    let Some((before, after)) = message.split_once(CODE) else { return };
    let after = after.trim_start_matches(": ");
    diagnostic.code = CODE.to_string();
    diagnostic.summary = after.lines().next().unwrap_or(after).to_string();
    if let Some(source) = stopped_at(before) {
        diagnostic.source = Some(source);
    }
    diagnostic.likely_causes = vec![
        "A loop at the reported line whose exit condition never becomes true".to_string(),
        "Real work that takes this long in one call".to_string(),
    ];
    diagnostic.suggested_actions = vec![
        ActionSuggestion {
            action: "fix_loop".to_string(),
            description: "Read the reported line and the stack in the explanation, and make sure that loop can end.".to_string(),
            command: None,
        },
        ActionSuggestion {
            action: "split_work".to_string(),
            description: "If the work is real, spread it over frames or a job; `script_time_limit_seconds` in project.unone.json raises the limit for work that cannot be split.".to_string(),
            command: None,
        },
    ];
}

/// The location Luau reported for this chunk, unless its name was truncated.
fn stopped_at(before_code: &str) -> Option<SourceLocation> {
    let (_, chunk) = before_code.rsplit_once("[string \"")?;
    let (file, rest) = chunk.split_once("\"]:")?;
    let line = rest.split(':').next()?.parse().ok()?;
    (!file.ends_with("...")).then(|| SourceLocation { file: file.to_string(), line: Some(line), column: None })
}

#[cfg(test)]
mod tests {
    use super::*;
    use mlua::Lua;
    use std::{cell::Cell, rc::Rc, thread, time::Duration};

    const ONE_SECOND: NonZeroU32 = NonZeroU32::new(1).unwrap();

    fn vm() -> Lua {
        let lua = Lua::new();
        let sleep = lua.create_function(|_, ms: u64| {
            thread::sleep(Duration::from_millis(ms));
            Ok(())
        }).unwrap();
        lua.globals().set("sleepMs", sleep).unwrap();
        lua
    }

    #[test]
    fn the_limit_is_per_call_so_a_long_run_of_short_calls_is_not_stopped() {
        let lua = vm();
        for _ in 0..8 {
            let _watch = watch(&lua, "Test", ONE_SECOND);
            lua.load("sleepMs(200)").exec().unwrap();
        }
    }

    #[test]
    fn an_expired_call_restores_the_slot_and_the_vm_runs_on() {
        let lua = vm();
        let safe_points = Rc::new(Cell::new(0));
        let counter = Rc::clone(&safe_points);
        lua.set_interrupt(move |_| {
            counter.set(counter.get() + 1);
            Ok(mlua::VmState::Continue)
        });
        {
            let _watch = watch(&lua, "Test", ONE_SECOND);
            let error = lua.load("while true do end").exec().unwrap_err().to_string();
            assert!(error.contains("SCRIPT_TIME_LIMIT_EXCEEDED: Test did not return within 1 s"), "{error}");
        }
        let before = safe_points.get();
        lua.load("for i = 1, 100 do end").exec().unwrap();
        assert!(safe_points.get() > before, "the interrupt the watchdog displaced is back");
    }

    #[test]
    fn a_call_that_outlives_the_limit_in_native_code_stops_at_its_next_safe_point() {
        let lua = vm();
        let _watch = watch(&lua, "Test", ONE_SECOND);
        let error = lua.load("sleepMs(1500)\nlocal function f() end\nf()").exec().unwrap_err().to_string();
        assert!(error.contains("SCRIPT_TIME_LIMIT_EXCEEDED"), "{error}");
    }

    #[test]
    fn calls_on_other_vms_keep_their_own_clocks() {
        let quick = vm();
        let stuck = thread::spawn(|| {
            let lua = vm();
            let _watch = watch(&lua, "Stuck", ONE_SECOND);
            lua.load("while true do end").exec().unwrap_err().to_string()
        });
        for _ in 0..8 {
            let _watch = watch(&quick, "Quick", ONE_SECOND);
            quick.load("sleepMs(200)").exec().unwrap();
        }
        assert!(stuck.join().unwrap().contains("Stuck did not return"));
    }

    #[cfg(not(feature = "phase-profile"))]
    #[test]
    fn a_sampled_update_is_stopped_with_the_sampler_and_vm_probe_in_the_slot() {
        let mut runtime = super::super::EngineRuntime::load_source_project(super::super::SourceProject {
            config: crate::ProjectConfig {
                name: "sampled".into(),
                entry_script: "main.luau".into(),
                script_time_limit_seconds: Some(ONE_SECOND),
                ..Default::default()
            },
            source: "return {start=function(api) end, update=function(api) while true do end end}".into(),
            ..Default::default()
        }).unwrap();
        runtime.preview_request(super::super::PreviewRequest::ProfileStart { sampling: true }).unwrap();
        assert_eq!(runtime.tick().unwrap_err().code, CODE);
    }

    #[test]
    fn the_location_is_kept_only_when_luau_reported_it_whole() {
        let source = stopped_at("runtime error: [string \"scripts/world/b.luau\"]:12: ").unwrap();
        assert_eq!((source.file.as_str(), source.line), ("scripts/world/b.luau", Some(12)));
        assert!(stopped_at("[string \"D:\\very\\long...\"]:12: ").is_none());
        assert!(stopped_at("runtime error: ").is_none());
    }
}
