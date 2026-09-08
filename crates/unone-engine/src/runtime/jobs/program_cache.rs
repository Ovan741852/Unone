//! Executor-local bytecode only; never caches a VM, environment or closure.
use std::{cell::RefCell, collections::VecDeque, sync::Arc};

const LIMIT: usize = 1024 * 1024;
const ENTRIES: usize = 32;
#[derive(Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Profile {
    pub vm_ms: f64,
    pub compile_ms: f64,
    pub load_ms: f64,
    pub call_copy_ms: f64,
    pub cache_hit: bool,
    pub cache_bytes: usize,
}
impl Profile {
    pub fn valid(&self) -> bool {
        [self.vm_ms, self.compile_ms, self.load_ms, self.call_copy_ms]
            .iter()
            .all(|v| v.is_finite() && *v >= 0.)
            && self.cache_bytes <= LIMIT
    }
}
#[derive(Default)]
struct Cache {
    entries: VecDeque<(Arc<str>, Arc<[u8]>)>,
    bytes: usize,
}
thread_local! { static CACHE: RefCell<Cache> = RefCell::new(Cache::default()); }

pub(super) fn get(source: &Arc<str>) -> Result<(Arc<[u8]>, bool, usize), String> {
    CACHE.with(|cell| {
        let mut cache = cell.borrow_mut();
        if let Some(index) = cache.entries.iter().position(|(s, _)| s == source) {
            let entry = cache.entries.remove(index).unwrap();
            let code = Arc::clone(&entry.1);
            cache.entries.push_back(entry);
            return Ok((code, true, cache.bytes));
        }
        // Match mlua eval: expression first, then a statement chunk. Options
        // remain Compiler::default, matching the original load/eval path.
        let compiler = mlua::Compiler::default();
        let code: Arc<[u8]> = compiler
            .compile(format!("return {source}"))
            .or_else(|_| compiler.compile(source.as_bytes()))
            .map_err(|e| e.to_string())?
            .into();
        let size = source.len() + code.len();
        if size <= LIMIT {
            while cache.entries.len() >= ENTRIES || cache.bytes + size > LIMIT {
                let (s, c) = cache.entries.pop_front().unwrap();
                cache.bytes -= s.len() + c.len();
            }
            cache.bytes += size;
            cache
                .entries
                .push_back((Arc::clone(source), Arc::clone(&code)));
        }
        Ok((code, false, cache.bytes))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_source_lru_is_bounded_and_errors_are_not_cached() {
        CACHE.with(|c| *c.borrow_mut() = Cache::default());
        let source: Arc<str> = "return function(b) return b end".into();
        assert!(!get(&source).unwrap().1);
        assert!(get(&source).unwrap().1);
        for i in 0..40 {
            get(&format!("return {i}").into()).unwrap();
        }
        assert!(!get(&source).unwrap().1);
        assert!(get(&"function broken(".into()).is_err());
        CACHE.with(|c| {
            let c = c.borrow();
            assert!(c.entries.len() <= ENTRIES);
            assert!(c.bytes <= LIMIT);
        });
    }
}
