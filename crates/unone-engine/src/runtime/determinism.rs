//! Narrow guards against ambient time and the VM's independently seeded RNG.
//! This is not a verifier for arbitrary Luau. See docs/luau-determinism.md.
use mlua::{Lua, Table, Value};

fn install(lua: &Lua) -> mlua::Result<()> {
    for (library, names, guidance) in [
        (
            "math",
            &["random", "randomseed"][..],
            "Use api.random.nextFloat/nextInt and the replay seed.",
        ),
        (
            "os",
            &["clock", "time", "date"][..],
            "Use fixed update dt or recorded input; measure performance outside gameplay.",
        ),
    ] {
        let table: Table = lua.globals().get(library)?;
        for name in names {
            let message =
                format!("LUA_NONDETERMINISTIC_SOURCE: {library}.{name} is unavailable. {guidance}");
            table.set(
                *name,
                lua.create_function(move |_, _: mlua::MultiValue| {
                    Err::<Value, _>(mlua::Error::RuntimeError(message.clone()))
                })?,
            )?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::EngineRuntime;

    #[test]
    fn libraries_are_immutable_but_game_globals_remain_local() {
        let mut r=EngineRuntime::load_source("environment","env.luau",r#"
counter=0
return {start=function(api)
 assert(not pcall(function() math.sqrt=function() return 0 end end))
 assert(not pcall(function() buffer.writef32=function()end end))
 assert(not pcall(function() collectgarbage('collect') end))
end,update=function(api)counter+=1;api.observation.set('counter',counter);api.observation.set('sqrt',math.sqrt(9))end}
"#,None).unwrap();
        let s = r.tick().unwrap();
        assert_eq!(s.observations["counter"], 1);
        assert_eq!(s.observations["sqrt"], 3.0);
    }

    #[test]
    fn real_runtime_rejects_ambient_time_and_vm_random_before_start() {
        for expression in [
            "math.random()",
            "math.randomseed(42)",
            "os.clock()",
            "os.time()",
            "os.date()",
        ] {
            let source = format!(
                "local value = {expression}; return {{start=function() end, update=function() end}}"
            );
            let error = EngineRuntime::load_source("guard", "main.luau", &source, None)
                .err()
                .expect("ambient source must fail");
            assert!(
                error.explanation.contains("LUA_NONDETERMINISTIC_SOURCE"),
                "{}",
                error.explanation
            );
        }
    }
}

pub(super) fn new_vm() -> Result<Lua, Box<crate::Diagnostic>> {
    create_vm(false)
}
#[cfg(feature = "jobs")]
pub(super) fn new_job_vm() -> Result<Lua, Box<crate::Diagnostic>> {
    create_vm(true)
}
fn create_vm(job:bool) -> Result<Lua, Box<crate::Diagnostic>> {
    let lua = Lua::new();
    #[cfg(all(feature="native-codegen",not(feature="preview-tools")))]
    lua.set_compiler(mlua::Compiler::new().set_optimization_level(2).set_type_info_level(1));
    // Native compiled/inlined frames are not reliably attributed by the VM sampler.
    // Diagnostic builds retain the interpreter; production native builds may use codegen.
    #[cfg(all(feature="native-codegen",feature="preview-tools"))]
    lua.enable_jit(false);
    install(&lua).map_err(|error| {
        Box::new(crate::Diagnostic::error(
            "ENGINE_INIT_FAILED",
            "Unable to install Luau replay guards",
            error.to_string(),
        ))
    })?;
    if job {
        let blocked=lua.create_function(|_,_:mlua::MultiValue|Err::<Value,_>(mlua::Error::RuntimeError("JOB_SIDE_EFFECT_FORBIDDEN: print".into())))
            .and_then(|f|lua.globals().set("print",f));
        blocked.map_err(|e|Box::new(crate::Diagnostic::error("ENGINE_INIT_FAILED","Unable to isolate job output",e.to_string())))?;
    }
    // Keep standard libraries immutable and activate Luau's builtin fast paths.
    // Script globals still write into the VM-local environment supplied by mlua.
    lua.sandbox(true).map_err(|error| {
        Box::new(crate::Diagnostic::error(
            "ENGINE_INIT_FAILED",
            "Unable to initialize the Luau environment",
            error.to_string(),
        ))
    })?;
    Ok(lua)
}
