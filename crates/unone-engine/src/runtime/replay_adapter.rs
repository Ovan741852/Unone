//! Narrow developer hook. Scenario meaning and invariant values remain in Luau.
use super::*;
use bindings::value::{json_to_lua, lua_value_to_json};

impl EngineRuntime {
    /// Call a Game.replay callback between ticks on an isolated replay runtime.
    /// The CLI owns version/schema validation, deadlines and persistence.
    pub fn replay_adapter_call(
        &self,
        method: &str,
        payload: serde_json::Value,
    ) -> Result<serde_json::Value, Box<Diagnostic>> {
        // Keep diagnostic callbacks out of gameplay function sampling without
        // replacing the VM interrupt slot used by the profiler/GC hooks.
        struct Resume {
            state: Rc<RefCell<profiling::Profile>>,
            previous: bool,
        }
        impl Drop for Resume {
            fn drop(&mut self) {
                self.state.borrow_mut().sampling_suspended = self.previous;
            }
        }
        let state = profiling::state(&self.lua);
        let previous = state.borrow().sampling_suspended;
        state.borrow_mut().sampling_suspended = true;
        let _resume = Resume { state, previous };
        let result = (|| -> mlua::Result<serde_json::Value> {
            let adapter: Table = self.lua.named_registry_value("unone.replay.adapter")?;
            let callback: Function = adapter.get(method)?;
            let result: Value =
                callback.call((json_to_lua(&self.lua, payload)?, self.api.clone()))?;
            lua_value_to_json(result).map_err(mlua::Error::RuntimeError)
        })();
        result.map_err(|e| {
            Box::new(Diagnostic::error(
                "REPLAY_ADAPTER_FAILED",
                format!("Game.replay.{method} failed"),
                e.to_string(),
            ))
        })
    }
    pub fn replay_adapter_identity(&self) -> Result<serde_json::Value, Box<Diagnostic>> {
        let result = (|| -> mlua::Result<serde_json::Value> {
            let adapter: Table = self.lua.named_registry_value("unone.replay.adapter")?;
            Ok(
                serde_json::json!({"id":adapter.get::<String>("id")?,"version":adapter.get::<String>("version")?}),
            )
        })();
        result.map_err(|e| {
            Box::new(Diagnostic::error(
                "REPLAY_ADAPTER_MISSING",
                "Game must expose Game.replay id/version/restore/inspect",
                e.to_string(),
            ))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn adapter_sampling_is_excluded_and_resumes_after_failure() {
        let mut r = EngineRuntime::load_source(
            "adapter",
            "main.luau",
            r#"
return {start=function()end,update=function()end,replay={id="x",version="1",inspect=function()
 local sum=0 for i=1,1000000 do sum+=i end return {sum=sum%1000}
end,restore=function() error('restore failed') end}}
"#,
            None,
        )
        .unwrap();
        r.preview_request(PreviewRequest::ProfileStart { sampling: true })
            .unwrap();
        r.replay_adapter_call("inspect", serde_json::json!({}))
            .unwrap();
        assert_eq!(profiling::state(&r.lua).borrow().samples, 0);
        assert!(
            r.replay_adapter_call("restore", serde_json::json!({}))
                .is_err()
        );
        assert!(!profiling::state(&r.lua).borrow().sampling_suspended);
    }
    #[test]
    fn ordinary_game_replay_fields_and_metatables_are_not_new_requirements() {
        EngineRuntime::load_source(
            "legacy",
            "main.luau",
            "return {replay='my gameplay property',start=function()end,update=function()end}",
            None,
        )
        .unwrap();
        EngineRuntime::load_source("legacy","main.luau","return setmetatable({start=function()end,update=function()end},{__index=function(_,key) if key=='replay' then error('do not invoke') end end})",None).unwrap();
    }
}
