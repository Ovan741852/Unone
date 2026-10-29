//! Current save ownership and its immutable host-publication encoding.
use std::{cell::OnceCell, rc::Rc};
use serde_json::{Value, value::RawValue};

#[derive(Clone, Default)]
pub(super) struct SaveState {
    payload: Option<Value>,
    // One current generation, not a frame/pointer-indexed history. Cloned
    // rollback state retains its own immutable encoding until it is retired.
    encoded: OnceCell<Rc<RawValue>>,
}

impl SaveState {
    pub fn new(payload: Option<Value>) -> Self { Self { payload, encoded: OnceCell::new() } }

    pub fn replace(&mut self, payload: Option<Value>) {
        self.payload = payload;
        self.encoded.take();
    }

    pub fn owned(&self) -> Option<Value> { self.payload.clone() }

    pub fn encoded(&self) -> Option<Rc<RawValue>> {
        let payload = self.payload.as_ref()?;
        Some(Rc::clone(self.encoded.get_or_init(|| {
            // serde_json::Value contains only serializable JSON. This cache
            // neither validates new inputs nor changes their acceptance rules.
            Rc::from(serde_json::value::to_raw_value(payload).expect("JSON save value serializes"))
        })))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn current_generation_is_cached_and_replacement_clear_and_rollback_are_atomic() {
        let value = serde_json::json!({"large":"x".repeat(112*1024),"array":[],"escaped":"繁中\n\"\\"});
        let mut state=SaveState::new(Some(value.clone()));
        assert!(state.encoded.get().is_none());
        let first=state.encoded().unwrap();
        for _ in 0..8 {assert!(Rc::ptr_eq(&first,&state.encoded().unwrap()));}
        assert_eq!(first.get(),serde_json::to_string(&value).unwrap());
        let rollback=state.clone();
        state.replace(Some(serde_json::json!({"new":true})));
        assert!(state.encoded.get().is_none());
        assert_eq!(state.encoded().unwrap().get(),"{\"new\":true}");
        assert_eq!(first.get(),serde_json::to_string(&value).unwrap());
        state=rollback;
        assert!(Rc::ptr_eq(&first,&state.encoded().unwrap()));
        let mut detached=state.owned().unwrap();detached["large"]=Value::Null;
        assert_eq!(state.owned(),Some(value));
        state.replace(None);assert!(state.owned().is_none());assert!(state.encoded().is_none());
        state.replace(Some(Value::Null));assert_eq!(state.owned(),Some(Value::Null));
        assert_eq!(state.encoded().unwrap().get(),"null");
    }
}
