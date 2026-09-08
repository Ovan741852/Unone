//! Development-only Lua tool registry. Callbacks execute between simulation ticks.
use super::*;
use serde::Deserialize;

#[derive(Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(deny_unknown_fields)]
pub struct DebugTab {
    pub id: String,
    pub label: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum DebugControl {
    Button {
        id: String,
        tab: String,
        label: String,
    },
    Label {
        id: String,
        tab: String,
        text: String,
    },
    Checkbox {
        id: String,
        tab: String,
        label: String,
        checked: bool,
    },
}
impl DebugControl {
    fn fields(&self) -> (&str, &str, &str) {
        match self {
            Self::Button { id, tab, label } | Self::Checkbox { id, tab, label, .. } => {
                (id, tab, label)
            }
            Self::Label { id, tab, text } => (id, tab, text),
        }
    }
}
#[derive(Default, Clone)]
pub(super) struct DebugTools {
    pub revision: u64,
    tabs: BTreeMap<String, DebugTab>,
    controls: BTreeMap<String, DebugControl>,
    callbacks: BTreeMap<String, Function>,
}
impl DebugTools {
    #[cfg(feature = "dev-tools")]
    pub fn with_revision(revision: u64) -> Self {
        Self {
            revision,
            ..Self::default()
        }
    }
    fn describe(&self) -> serde_json::Value {
        serde_json::json!({"revision":self.revision,"tabs":self.tabs.values().collect::<Vec<_>>(),"controls":self.controls.values().collect::<Vec<_>>()})
    }
    pub fn tab(&mut self, tab: DebugTab) -> mlua::Result<()> {
        valid_id(&tab.id)?;
        valid_text(&tab.label)?;
        if self.tabs.contains_key(&tab.id) || self.tabs.len() >= 16 {
            return Err(error(
                "DEBUG_TAB_INVALID: duplicate tab or limit of 16 tabs reached",
            ));
        }
        self.tabs.insert(tab.id.clone(), tab);
        self.revision += 1;
        Ok(())
    }
    pub fn register(
        &mut self,
        control: DebugControl,
        callback: Option<Function>,
    ) -> mlua::Result<()> {
        let (id, tab, label) = control.fields();
        valid_id(id)?;
        valid_text(label)?;
        if !self.tabs.contains_key(tab)
            || self.controls.contains_key(id)
            || self.controls.len() >= 128
        {
            return Err(error(
                "DEBUG_CONTROL_INVALID: unknown tab, duplicate control or limit of 128 controls reached",
            ));
        }
        if matches!(control, DebugControl::Label { .. }) != callback.is_none() {
            return Err(error(
                "DEBUG_CALLBACK_INVALID: button/checkbox require a callback; label must not have one",
            ));
        }
        let id = id.to_string();
        if let Some(callback) = callback {
            self.callbacks.insert(id.clone(), callback);
        }
        self.controls.insert(id, control);
        self.revision += 1;
        Ok(())
    }
    pub fn set(&mut self, id: &str, value: Value) -> mlua::Result<()> {
        match (self.controls.get_mut(id), value) {
            (Some(DebugControl::Label { text, .. }), Value::String(value)) => {
                let value = value.to_str()?.to_string();
                valid_text(&value)?;
                *text = value;
            }
            (Some(DebugControl::Checkbox { checked, .. }), Value::Boolean(value)) => {
                *checked = value
            }
            _ => {
                return Err(error(
                    "DEBUG_VALUE_INVALID: set requires a known label/string or checkbox/boolean",
                ));
            }
        };
        Ok(())
    }
}
fn error(message: &str) -> mlua::Error {
    mlua::Error::RuntimeError(message.into())
}
fn valid_id(value: &str) -> mlua::Result<()> {
    if value.is_empty()
        || value.len() > 80
        || !value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"_.-".contains(&c))
    {
        return Err(error(
            "DEBUG_ID_INVALID: use 1..80 ASCII letters, digits, dot, dash or underscore",
        ));
    }
    Ok(())
}
fn valid_text(value: &str) -> mlua::Result<()> {
    if value.len() > 4096 {
        return Err(error("DEBUG_TEXT_LIMIT: maximum 4096 UTF-8 bytes"));
    }
    Ok(())
}

#[derive(Deserialize)]
#[cfg_attr(feature = "dev-tools", derive(schemars::JsonSchema))]
#[serde(tag = "method", rename_all = "snake_case", deny_unknown_fields)]
pub enum PreviewRequest {
    Snapshot {},
    Tools {},
    Profile {},
    ProfileStart {
        #[serde(default)]
        sampling: bool,
    },
    ProfileStop {},
    Invoke {
        id: String,
        revision: u64,
        #[serde(default)]
        value: Option<bool>,
    },
}
impl EngineRuntime {
    pub fn preview_request(
        &mut self,
        request: PreviewRequest,
    ) -> Result<serde_json::Value, Box<Diagnostic>> {
        if matches!(request, PreviewRequest::Tools {}) {
            return Ok(serde_json::json!({"tools":self.debug_tools.borrow().describe()}));
        }
        match &request {
            PreviewRequest::ProfileStart { sampling } => {
                if profiling::state(&self.lua).borrow().active {
                    return Err(Box::new(Diagnostic::error(
                        "PROFILE_ACTIVE",
                        "A measurement is already active",
                        "Call profile.stop before starting another window.",
                    )));
                }
                self.performance = PerformanceCollector::default();
                #[cfg(feature = "jobs")]
                self.jobs.borrow_mut().profile_start();
                profiling::start(&self.lua, self.world.borrow().frame, *sampling);
            }
            PreviewRequest::ProfileStop {} => {
                #[cfg(feature = "jobs")]
                self.jobs.borrow_mut().profile_stop();
                self.lua.remove_interrupt();
                profiling::state(&self.lua).borrow_mut().active = false;
            }
            _ => {}
        }
        if matches!(
            request,
            PreviewRequest::Profile {}
                | PreviewRequest::ProfileStart { .. }
                | PreviewRequest::ProfileStop {}
        ) {
            return Ok(
                serde_json::json!({"performance":self.performance_report(),"window":profiling::state(&self.lua).borrow().report(),
                "build":{"debug_assertions":cfg!(debug_assertions),"preview_tools":true},"counts_frame":self.world.borrow().frame,"jobs":self.jobs_report()}),
            );
        }
        if let PreviewRequest::Invoke {
            id,
            revision,
            value,
        } = request
        {
            let result = (|| -> mlua::Result<()> {
                let (callback, checkbox) = {
                    let tools = self.debug_tools.borrow();
                    if revision != tools.revision {
                        return Err(error("DEBUG_STALE_REVISION: refresh tools before invoking"));
                    }
                    let control = tools.controls.get(&id).ok_or_else(|| {
                        error("DEBUG_CONTROL_NOT_FOUND: refresh tools and use a registered ID")
                    })?;
                    let checkbox = matches!(control, DebugControl::Checkbox { .. });
                    if matches!(control, DebugControl::Label { .. }) || checkbox != value.is_some()
                    {
                        return Err(error(
                            "DEBUG_INVOKE_INVALID: checkbox needs boolean value; button takes no value; label cannot be invoked",
                        ));
                    }
                    (
                        tools
                            .callbacks
                            .get(&id)
                            .cloned()
                            .ok_or_else(|| error("DEBUG_CALLBACK_NOT_FOUND"))?,
                        checkbox,
                    )
                };
                // No registry borrow survives arbitrary Lua execution. Failure can
                // leave Lua/game changes; do not promise rollback of a Lua heap.
                callback.call::<()>(value)?;
                if checkbox {
                    self.debug_tools
                        .borrow_mut()
                        .set(&id, Value::Boolean(value.unwrap()))?;
                }
                Ok(())
            })();
            result.map_err(|error| Box::new(Diagnostic::error("DEBUG_INVOKE_FAILED","Developer tool invocation failed",format!("{error}. A started callback may have changed game state; inspect a fresh snapshot before retrying."))))?;
        }
        let snapshot = self.observe();
        let digest = observation_digest(&snapshot).map_err(|error| {
            Box::new(Diagnostic::error(
                "OBSERVATION_SERIALIZATION_FAILED",
                "Cannot read development snapshot",
                error.to_string(),
            ))
        })?;
        let trace = self.trace.borrow();
        Ok(serde_json::json!({
            "tools":self.debug_tools.borrow().describe(),
            "observation":{"project":self.config.name,"world":snapshot,"observation_digest":digest,"save_payload":self.save_payload()},
            "performance":self.performance_report(),
            "logs":trace.iter().rev().take(200).rev().collect::<Vec<_>>(),
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn runtime() -> EngineRuntime {
        EngineRuntime::load_source("tools","main.luau",r#"
local Game={}
function Game.start(api)
 api.debug.registerTab({id="qa",label="QA"})
 api.debug.register({id="qa.label",tab="qa",kind="label",text="ready"})
 api.debug.register({id="qa.button",tab="qa",kind="button",label="Run"},function()
  api.debug.set("qa.label","done")
  api.observation.set("invoked",true)
 end)
 api.debug.register({id="qa.flag",tab="qa",kind="checkbox",label="Flag",checked=false},function(value) api.observation.set("flag",value) end)
end
function Game.update() end
return Game
"#,None).unwrap()
    }
    #[test]
    fn controls_are_inspectable_and_callbacks_are_explicit_between_ticks() {
        let mut r = runtime();
        let before = r.observe();
        let data = r.preview_request(PreviewRequest::Snapshot {}).unwrap();
        assert_eq!(
            observation_digest(&before).unwrap(),
            data["observation"]["observation_digest"]
        );
        let revision = data["tools"]["revision"].as_u64().unwrap();
        assert!(
            r.preview_request(PreviewRequest::Invoke {
                id: "qa.button".into(),
                revision: revision + 1,
                value: None
            })
            .is_err()
        );
        assert!(
            r.preview_request(PreviewRequest::Invoke {
                id: "qa.flag".into(),
                revision,
                value: None
            })
            .is_err()
        );
        assert!(
            r.preview_request(PreviewRequest::Invoke {
                id: "qa.label".into(),
                revision,
                value: None
            })
            .is_err()
        );
        assert!(!r.observe().observations.contains_key("invoked"));
        let result = r
            .preview_request(PreviewRequest::Invoke {
                id: "qa.button".into(),
                revision,
                value: None,
            })
            .unwrap();
        assert_eq!(
            result["observation"]["world"]["observations"]["invoked"],
            true
        );
        assert_eq!(r.observe().frame, before.frame);
        r.preview_request(PreviewRequest::Invoke {
            id: "qa.flag".into(),
            revision,
            value: Some(true),
        })
        .unwrap();
        assert_eq!(r.observe().observations["flag"], true);
    }
    #[test]
    fn malformed_definitions_and_requests_fail_closed() {
        assert!(
            serde_json::from_str::<PreviewRequest>(r#"{"method":"snapshot","typo":1}"#).is_err()
        );
        assert!(
            serde_json::from_str::<DebugControl>(
                r#"{"kind":"button","id":"x","tab":"qa","label":"X","typo":1}"#
            )
            .is_err()
        );
        let mut tools = DebugTools::default();
        tools
            .tab(DebugTab {
                id: "qa".into(),
                label: "QA".into(),
            })
            .unwrap();
        assert!(
            tools
                .tab(DebugTab {
                    id: "qa".into(),
                    label: "duplicate".into()
                })
                .is_err()
        );
        assert!(
            tools
                .register(
                    DebugControl::Button {
                        id: "x".into(),
                        tab: "qa".into(),
                        label: "X".into()
                    },
                    None
                )
                .is_err()
        );
    }
}
