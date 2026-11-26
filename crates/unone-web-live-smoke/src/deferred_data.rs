use super::{RUNTIME,OUTPUT};
use std::cell::Cell;

thread_local! { static SESSION: Cell<u32> = const { Cell::new(0) }; }
pub(super) fn new_session()->Result<(),&'static str> {
    SESSION.with(|s| {s.set(s.get().checked_add(1).ok_or("DEFERRED_DATA_SESSION_EXHAUSTED")?);Ok(())})
}

#[unsafe(no_mangle)]
pub extern "C" fn unone_web_data_requests(after_revision:u32)->i32 {
    RUNTIME.with(|r| {
        let runtime=r.borrow();
        let Some(runtime)=runtime.as_ref() else {return -1};
        let Some(plan)=runtime.data_asset_request_plan(SESSION.with(Cell::get),after_revision) else {return 1};
        OUTPUT.with(|o| *o.borrow_mut()=serde_json::to_vec(&plan).expect("request plan serializes"));
        0
    })
}
#[unsafe(no_mangle)]
pub extern "C" fn unone_web_deferred_reserve(session:u32,request:u32,length:usize)->*mut u8 {
    if session==0 || SESSION.with(Cell::get)!=session {return std::ptr::null_mut();}
    RUNTIME.with(|r| r.borrow_mut().as_mut().and_then(|runtime|runtime.reserve_deferred_bytes(request,length)))
        .unwrap_or(std::ptr::null_mut())
}
