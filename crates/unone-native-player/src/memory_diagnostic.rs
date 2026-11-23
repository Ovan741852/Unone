//! Isolated investigation of native player memory. Opt in with
//! UNONE_NATIVE_MEMORY_DIAGNOSTIC=performance or memory_usage. No default
//! renderer changes or GPU synchronization are introduced by the probe.
use serde_json::{Value, json};
use std::{io::Write, sync::OnceLock, time::Instant};

const OPT_IN: &str = "UNONE_NATIVE_MEMORY_DIAGNOSTIC";
const BACKEND: &str = "UNONE_NATIVE_MEMORY_BACKEND";
const TOP_ALLOCATIONS: usize = 32;

#[derive(Clone, Copy)]
enum Hint {
    Performance,
    MemoryUsage,
}

struct Diagnostic {
    hint: Hint,
    backend: Option<wgpu::Backends>,
    started: Instant,
}

static DIAGNOSTIC: OnceLock<Option<Diagnostic>> = OnceLock::new();

pub fn initialize() -> super::R<()> {
    let diagnostic = match std::env::var(OPT_IN) {
        Err(std::env::VarError::NotPresent) if std::env::var_os(BACKEND).is_none() => None,
        Err(std::env::VarError::NotPresent) => return Err(format!("{BACKEND} requires {OPT_IN}")),
        Ok(value) if value == "performance" || value == "memory_usage" => Some(Diagnostic {
            hint: if value == "memory_usage" { Hint::MemoryUsage } else { Hint::Performance },
            backend: match std::env::var(BACKEND) {
                Err(std::env::VarError::NotPresent) => None,
                Ok(value) if value == "vulkan" => Some(wgpu::Backends::VULKAN),
                Ok(value) if value == "dx12" => Some(wgpu::Backends::DX12),
                _ => return Err(format!("{BACKEND}: expected vulkan or dx12")),
            },
            started: Instant::now(),
        }),
        _ => return Err(format!("{OPT_IN}: expected performance or memory_usage")),
    };
    let _ = DIAGNOSTIC.set(diagnostic);
    checkpoint("desktop.start", None);
    Ok(())
}

pub fn memory_hints() -> wgpu::MemoryHints {
    match DIAGNOSTIC.get().and_then(Option::as_ref).map(|d| d.hint) {
        Some(Hint::MemoryUsage) => wgpu::MemoryHints::MemoryUsage,
        _ => wgpu::MemoryHints::Performance,
    }
}

pub fn instance() -> wgpu::Instance {
    let Some(backend) = DIAGNOSTIC.get().and_then(Option::as_ref).and_then(|d| d.backend) else {
        return wgpu::Instance::default();
    };
    let mut descriptor = wgpu::InstanceDescriptor::new_without_display_handle();
    descriptor.backends = backend;
    wgpu::Instance::new(descriptor)
}

#[cfg(target_os = "windows")]
fn process_memory() -> Value {
    use std::ffi::c_void;
    #[derive(Default)]
    #[repr(C)]
    struct Counters {
        cb: u32,
        page_fault_count: u32,
        peak_working_set: usize,
        working_set: usize,
        quota_peak_paged_pool: usize,
        quota_paged_pool: usize,
        quota_peak_nonpaged_pool: usize,
        quota_nonpaged_pool: usize,
        pagefile_usage: usize,
        peak_pagefile_usage: usize,
        private_usage: usize,
    }
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetCurrentProcess() -> *mut c_void;
        fn K32GetProcessMemoryInfo(process: *mut c_void, counters: *mut Counters, size: u32) -> i32;
    }
    let size = std::mem::size_of::<Counters>() as u32;
    let mut counters = Counters { cb: size, ..Default::default() };
    let success = unsafe { K32GetProcessMemoryInfo(GetCurrentProcess(), &mut counters, size) };
    if success == 0 {
        return json!({"error": std::io::Error::last_os_error().to_string()});
    }
    json!({
        "private_commit_bytes": counters.private_usage,
        "working_set_bytes": counters.working_set,
        "peak_working_set_bytes": counters.peak_working_set,
    })
}

#[cfg(not(target_os = "windows"))]
fn process_memory() -> Value { Value::Null }

fn allocator_report(device: Option<&wgpu::Device>) -> Value {
    let Some(report) = device.and_then(wgpu::Device::generate_allocator_report) else {
        return Value::Null;
    };
    let mut ordered: Vec<usize> = (0..report.allocations.len()).collect();
    ordered.sort_by_key(|&i| std::cmp::Reverse(report.allocations[i].size));
    let allocations: Vec<_> = ordered.into_iter().take(TOP_ALLOCATIONS).map(|i| {
        let allocation = &report.allocations[i];
        json!({
            "label": allocation.name,
            "block": report.blocks.iter().position(|block| block.allocations.contains(&i)),
            "offset_bytes": allocation.offset,
            "size_bytes": allocation.size,
        })
    }).collect();
    let blocks: Vec<_> = report.blocks.iter().map(|block| json!({
        "capacity_bytes": block.size,
        "live_bytes": report.allocations[block.allocations.clone()].iter().map(|a| a.size).sum::<u64>(),
        "live_count": block.allocations.len(),
    })).collect();
    json!({
        "live_bytes": report.total_allocated_bytes,
        "block_capacity_bytes": report.total_reserved_bytes,
        "allocation_count": report.allocations.len(),
        "blocks": blocks,
        "largest_allocations": allocations,
    })
}

pub fn checkpoint(stage: &'static str, device: Option<&wgpu::Device>) {
    let Some(diagnostic) = DIAGNOSTIC.get().and_then(Option::as_ref) else { return };
    let started = Instant::now();
    let process = process_memory();
    let allocator = allocator_report(device);
    let row = json!({
        "stage": stage,
        "pid": std::process::id(),
        "elapsed_ms": started.duration_since(diagnostic.started).as_secs_f64() * 1000.,
        "query_ms": started.elapsed().as_secs_f64() * 1000.,
        "memory_hint": match diagnostic.hint { Hint::Performance => "performance", Hint::MemoryUsage => "memory_usage" },
        "backend_mask": match diagnostic.backend {
            Some(mask) if mask == wgpu::Backends::VULKAN => "vulkan",
            Some(_) => "dx12",
            None => "default",
        },
        "process": process,
        "wgpu_allocator": allocator,
    });
    let mut stdout = std::io::stdout().lock();
    let _ = writeln!(stdout, "UNONE_NATIVE_MEMORY {row}");
    let _ = stdout.flush();
}
