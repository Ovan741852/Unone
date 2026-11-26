use super::{OUTPUT, RUNTIME};
use std::cell::Cell;

thread_local! { static SESSION: Cell<u32> = const { Cell::new(0) }; }
pub(super) fn new_session() -> Result<(), &'static str> {
    SESSION.with(|s| {
        s.set(
            s.get()
                .checked_add(1)
                .ok_or("DEFERRED_DATA_SESSION_EXHAUSTED")?,
        );
        Ok(())
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn unone_web_data_requests(after_revision: u32) -> i32 {
    RUNTIME.with(|r| {
        let runtime = r.borrow();
        let Some(runtime) = runtime.as_ref() else {
            return -1;
        };
        let Some(plan) = runtime.data_asset_request_plan(SESSION.with(Cell::get), after_revision)
        else {
            return 1;
        };
        OUTPUT.with(|o| {
            *o.borrow_mut() = serde_json::to_vec(&plan).expect("request plan serializes")
        });
        0
    })
}
#[unsafe(no_mangle)]
pub extern "C" fn unone_web_deferred_reserve(session: u32, request: u32, length: usize) -> *mut u8 {
    if session == 0 || SESSION.with(Cell::get) != session {
        return std::ptr::null_mut();
    }
    RUNTIME
        .with(|r| {
            r.borrow_mut()
                .as_mut()
                .and_then(|runtime| runtime.reserve_deferred_bytes(request, length))
        })
        .unwrap_or(std::ptr::null_mut())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reload_invalidates_a_pending_cross_session_delivery() {
        let bytes=json!({"config":{"name":"lazy"},"script":"return {start=function(a) a.assets.request('data://x') end,update=function(a) if a.assets.status('data://x').state=='ready' then a.observation.set('value',buffer.tostring(a.assets.load('data://x'))) end end}",
            "data_assets":[{"id":"data://x","source":"x.bin","loader":"bytes","on_demand":true}]}).to_string();
        let start = || {
            assert_eq!(
                unsafe { crate::unone_web_load_project(bytes.as_ptr(), bytes.len(), 42) },
                0
            );
            assert_eq!(unone_web_data_requests(0), 0);
            let plan: serde_json::Value =
                OUTPUT.with(|o| serde_json::from_slice(&o.borrow()).unwrap());
            assert_eq!(
                unone_web_data_requests(plan["revision"].as_u64().unwrap() as u32),
                1
            );
            (
                plan["session"].as_u64().unwrap() as u32,
                plan["requests"][0]["request"].as_u64().unwrap() as u32,
            )
        };
        let (old, token) = start();
        let (session, current) = start();
        assert_ne!(old, session);
        assert!(unone_web_deferred_reserve(old, token, 3).is_null());
        let ptr = unone_web_deferred_reserve(session, current, 3);
        assert!(!ptr.is_null());
        unsafe { std::ptr::copy_nonoverlapping(b"abc".as_ptr(), ptr, 3) };
        let receipt=json!({"data_assets":[{"state":"ready","id":"data://x","request":current,"sha256":"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"}]}).to_string();
        assert_eq!(
            unsafe { crate::unone_web_set_input_frame(receipt.as_ptr(), receipt.len()) },
            0
        );
        assert_eq!(crate::unone_web_tick(), 0);
        RUNTIME.with(|r| {
            assert_eq!(
                r.borrow().as_ref().unwrap().semantic_observations()["value"],
                "abc"
            )
        });
        assert!(unone_web_deferred_reserve(session, current, 0).is_null());
    }
}
