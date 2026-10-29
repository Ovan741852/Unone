//! Scoped, development-only Luau VM counters. No timing is exposed to scripts.
//! Luau 709's onallocate reports successful allocation/reallocation requests,
//! but not frees. Its non-negative interrupt calls bracket incremental GC
//! steps (including assists), not full collections. Re-audit on Luau upgrades.
#[cfg(not(feature = "phase-profile"))]
use mlua::{Lua, ffi};
use serde::Serialize;
#[cfg(not(feature = "phase-profile"))]
use std::{cell::Cell, ptr, time::Instant};

#[cfg(not(feature = "phase-profile"))]
type Allocate = unsafe extern "C-unwind" fn(*mut ffi::lua_State, usize, usize);
#[cfg(not(feature = "phase-profile"))]
type Interrupt = unsafe extern "C-unwind" fn(*mut ffi::lua_State, i32);
#[cfg(not(feature = "phase-profile"))]
thread_local! { static ACTIVE: Cell<*const Counters> = const { Cell::new(ptr::null()) }; }

#[cfg(not(feature = "phase-profile"))]
struct Counters {
    callbacks: *mut ffi::lua_Callbacks,
    previous: *const Counters,
    allocate: Option<Allocate>,
    interrupt: Option<Interrupt>,
    bytes: Cell<u64>,
    events: Cell<u64>,
    gc_start: Cell<Option<Instant>>,
    gc_steps: Cell<u64>,
    gc_ms: Cell<f64>,
    gc_max_ms: Cell<f64>,
}

#[derive(Default, Clone, Serialize)]
pub(super) struct Frame {
    pub frame: u64,
    pub completed: bool,
    pub allocation_growth_bytes: u64,
    pub allocation_growth_events: u64,
    pub incremental_gc_steps: u64,
    pub incremental_gc_ms: f64,
    pub incremental_gc_max_step_ms: f64,
}

/// Owns the VM and the stable callback storage until restoration, including on
/// errors/unwind. mlua's userdata and existing sampling hook remain untouched.
#[cfg(not(feature = "phase-profile"))]
pub(super) struct Probe {
    _lua: Lua,
    counters: Box<Counters>,
}
#[cfg(not(feature = "phase-profile"))]
impl Probe {
    /// # Safety
    /// Probes on this thread must finish/drop in reverse creation order. The
    /// caller must not replace VM callbacks while a probe is alive.
    pub unsafe fn begin(lua: &Lua) -> mlua::Result<Self> {
        let mut callbacks = ptr::null_mut();
        // SAFETY: exec_raw provides a live state; no Lua stack is modified.
        unsafe {
            lua.exec_raw::<()>((), |state| callbacks = ffi::lua_callbacks(state))?;
        }
        let previous = ACTIVE.with(Cell::get);
        // No nested scopes for the same VM: recursively chaining our hook would
        // count twice. Other VMs on this thread are supported by the linked list.
        let mut cursor = previous;
        while !cursor.is_null() {
            // SAFETY: active scopes own their boxes and drop in stack order.
            let c = unsafe { &*cursor };
            if c.callbacks == callbacks {
                return Err(mlua::Error::RuntimeError(
                    "nested VM measurement scope".into(),
                ));
            }
            cursor = c.previous;
        }
        // SAFETY: Lua is owned by this thread (mlua send is disabled), clone
        // keeps it alive, callbacks are restored before releasing that clone.
        let counters = unsafe {
            Box::new(Counters {
                callbacks,
                previous,
                allocate: (*callbacks).onallocate,
                interrupt: (*callbacks).interrupt,
                bytes: Cell::new(0),
                events: Cell::new(0),
                gc_start: Cell::new(None),
                gc_steps: Cell::new(0),
                gc_ms: Cell::new(0.0),
                gc_max_ms: Cell::new(0.0),
            })
        };
        ACTIVE.with(|p| p.set(&*counters));
        unsafe {
            (*callbacks).onallocate = Some(on_allocate);
            (*callbacks).interrupt = Some(on_interrupt);
        }
        Ok(Self {
            _lua: lua.clone(),
            counters,
        })
    }
    pub fn finish(self, frame: u64, completed: bool) -> Frame {
        let c = &self.counters;
        Frame {
            frame,
            completed,
            allocation_growth_bytes: c.bytes.get(),
            allocation_growth_events: c.events.get(),
            incremental_gc_steps: c.gc_steps.get(),
            incremental_gc_ms: c.gc_ms.get(),
            incremental_gc_max_step_ms: c.gc_max_ms.get(),
        }
    }
}
#[cfg(not(feature = "phase-profile"))]
impl Drop for Probe {
    fn drop(&mut self) {
        // SAFETY: same-thread, stack-scoped usage; owned Lua is still alive.
        unsafe {
            (*self.counters.callbacks).onallocate = self.counters.allocate;
            (*self.counters.callbacks).interrupt = self.counters.interrupt;
        }
        ACTIVE.with(|p| p.set(self.counters.previous));
    }
}
#[cfg(not(feature = "phase-profile"))]
unsafe fn find(state: *mut ffi::lua_State) -> *const Counters {
    let callbacks = unsafe { ffi::lua_callbacks(state) };
    let mut cursor = ACTIVE.with(Cell::get);
    while !cursor.is_null() {
        let c = unsafe { &*cursor };
        if c.callbacks == callbacks {
            return cursor;
        }
        cursor = c.previous;
    }
    ptr::null()
}
#[cfg(not(feature = "phase-profile"))]
unsafe extern "C-unwind" fn on_allocate(state: *mut ffi::lua_State, old: usize, new: usize) {
    let p = unsafe { find(state) };
    if p.is_null() {
        return;
    }
    let c = unsafe { &*p };
    if new > old {
        c.bytes
            .set(c.bytes.get().saturating_add((new - old) as u64));
        c.events.set(c.events.get().saturating_add(1));
    }
    if let Some(previous) = c.allocate {
        unsafe {
            previous(state, old, new);
        }
    }
}
#[cfg(not(feature = "phase-profile"))]
unsafe extern "C-unwind" fn on_interrupt(state: *mut ffi::lua_State, gc: i32) {
    let p = unsafe { find(state) };
    if p.is_null() {
        return;
    }
    let c = unsafe { &*p };
    if gc >= 0 {
        // Both entry and exit may be 0: pair calls, do not infer from state id.
        if let Some(start) = c.gc_start.take() {
            let ms = start.elapsed().as_secs_f64() * 1000.0;
            c.gc_steps.set(c.gc_steps.get().saturating_add(1));
            c.gc_ms.set(c.gc_ms.get() + ms);
            c.gc_max_ms.set(c.gc_max_ms.get().max(ms));
        } else {
            c.gc_start.set(Some(Instant::now()));
        }
    }
    // mlua ignores GC interrupts but uses negative interrupts for its sampler.
    if let Some(previous) = c.interrupt {
        unsafe {
            previous(state, gc);
        }
    }
}

#[cfg(all(test, not(feature = "phase-profile")))]
mod tests {
    use super::*;
    #[test]
    fn counts_churn_and_incremental_gc_and_restores_hooks() {
        let lua = Lua::new();
        let probe = unsafe { Probe::begin(&lua) }.unwrap();
        lua.load("for i=1,1000 do local t=table.create(100, i) end")
            .exec()
            .unwrap();
        lua.gc_step_kbytes(1024).unwrap();
        let f = probe.finish(1, true);
        assert!(f.allocation_growth_bytes > 100_000);
        assert!(f.allocation_growth_events >= 1000);
        assert!(f.incremental_gc_steps > 0);
        assert!(f.incremental_gc_ms >= f.incremental_gc_max_step_ms);
        assert!(ACTIVE.with(Cell::get).is_null());
        let fresh = unsafe { Probe::begin(&lua) }.unwrap().finish(2, true);
        assert_eq!(fresh.allocation_growth_bytes, 0);
    }
    #[test]
    fn nested_vms_and_errors_restore_sampling() {
        let lua = Lua::new();
        let calls = std::rc::Rc::new(Cell::new(0));
        let shared = calls.clone();
        lua.set_interrupt(move |_| {
            shared.set(shared.get() + 1);
            Ok(mlua::VmState::Continue)
        });
        let probe = unsafe { Probe::begin(&lua) }.unwrap();
        assert!(unsafe { Probe::begin(&lua) }.is_err());
        let other = Lua::new();
        let nested = unsafe { Probe::begin(&other) }.unwrap();
        lua.load("local t=table.create(1000); error('test')")
            .exec()
            .unwrap_err();
        assert_eq!(nested.finish(0, false).allocation_growth_bytes, 0);
        assert!(probe.finish(0, false).allocation_growth_bytes > 0);
        let before = calls.get();
        lua.load("for i=1,100 do end").exec().unwrap();
        assert!(calls.get() > before);
    }
}
