use super::{ApiState, Lua, Table};
use crate::{audio::AudioOptions, world::Vec2};
use std::rc::Rc;

#[cfg(feature = "audio")]
pub(super) fn audio(lua: &Lua, state: &ApiState) -> mlua::Result<Table> {
    let world = Rc::clone(&state.world);
    let audio_api = lua.create_table()?;
    let play_audio_world = Rc::clone(&world);
    let view = Rc::clone(&state.pure_view);
    audio_api.set(
        "play",
        lua.create_function(move |_, (asset, options): (String, Option<Table>)| {
            super::ensure_not_view(&view, "audio.play")?;
            let options = audio_options(options)?;
            let mut world = play_audio_world.borrow_mut();
            let frame = world.frame;
            world
                .audio
                .play(&asset, &options, frame)
                .map_err(mlua::Error::RuntimeError)
        })?,
    )?;
    let loop_audio_world = Rc::clone(&world);
    let view = Rc::clone(&state.pure_view);
    audio_api.set(
        "loop",
        lua.create_function(move |_, (asset, options): (String, Option<Table>)| {
            super::ensure_not_view(&view, "audio.loop")?;
            let options = audio_options(options)?;
            let mut world = loop_audio_world.borrow_mut();
            let frame = world.frame;
            world
                .audio
                .start_loop(&asset, &options, frame)
                .map_err(mlua::Error::RuntimeError)
        })?,
    )?;
    let stop_audio_world = Rc::clone(&world);
    let view = Rc::clone(&state.pure_view);
    audio_api.set(
        "stop",
        lua.create_function(move |_, handle: String| {
            super::ensure_not_view(&view, "audio.stop")?;
            let mut world = stop_audio_world.borrow_mut();
            let frame = world.frame;
            Ok(world.audio.stop(&handle, frame))
        })?,
    )?;
    let stop_all_audio_world = Rc::clone(&world);
    let view = Rc::clone(&state.pure_view);
    audio_api.set(
        "stopAll",
        lua.create_function(move |_, ()| {
            super::ensure_not_view(&view, "audio.stopAll")?;
            let mut world = stop_all_audio_world.borrow_mut();
            let frame = world.frame;
            Ok(world.audio.stop_all(frame) as i64)
        })?,
    )?;

    let pause_audio_world = Rc::clone(&world);
    let view = Rc::clone(&state.pure_view);
    audio_api.set(
        "pause",
        lua.create_function(move |_, handle: String| {
            super::ensure_not_view(&view, "audio.pause")?;
            Ok(pause_audio_world
                .borrow_mut()
                .audio
                .set_paused(&handle, true))
        })?,
    )?;
    let resume_audio_world = Rc::clone(&world);
    let view = Rc::clone(&state.pure_view);
    audio_api.set(
        "resume",
        lua.create_function(move |_, handle: String| {
            super::ensure_not_view(&view, "audio.resume")?;
            Ok(resume_audio_world
                .borrow_mut()
                .audio
                .set_paused(&handle, false))
        })?,
    )?;
    let pause_all_audio_world = Rc::clone(&world);
    let view = Rc::clone(&state.pure_view);
    audio_api.set(
        "pauseAll",
        lua.create_function(move |_, ()| {
            super::ensure_not_view(&view, "audio.pauseAll")?;
            Ok(pause_all_audio_world
                .borrow_mut()
                .audio
                .set_all_paused(true) as i64)
        })?,
    )?;
    let resume_all_audio_world = Rc::clone(&world);
    let view = Rc::clone(&state.pure_view);
    audio_api.set(
        "resumeAll",
        lua.create_function(move |_, ()| {
            super::ensure_not_view(&view, "audio.resumeAll")?;
            Ok(resume_all_audio_world
                .borrow_mut()
                .audio
                .set_all_paused(false) as i64)
        })?,
    )?;
    let set_master_world = Rc::clone(&world);
    let view = Rc::clone(&state.pure_view);
    audio_api.set(
        "setMasterVolume",
        lua.create_function(move |_, volume: f64| {
            super::ensure_not_view(&view, "audio.setMasterVolume")?;
            set_master_world
                .borrow_mut()
                .audio
                .set_master_volume(volume)
                .map_err(mlua::Error::RuntimeError)
        })?,
    )?;
    let get_master_world = Rc::clone(&world);
    audio_api.set(
        "getMasterVolume",
        lua.create_function(move |_, ()| Ok(get_master_world.borrow().audio.master_volume()))?,
    )?;
    let set_category_world = Rc::clone(&world);
    let view = Rc::clone(&state.pure_view);
    audio_api.set(
        "setCategoryVolume",
        lua.create_function(move |_, (category, volume): (String, f64)| {
            super::ensure_not_view(&view, "audio.setCategoryVolume")?;
            set_category_world
                .borrow_mut()
                .audio
                .set_category_volume(&category, volume)
                .map_err(mlua::Error::RuntimeError)
        })?,
    )?;
    let get_category_world = Rc::clone(&world);
    audio_api.set(
        "getCategoryVolume",
        lua.create_function(move |_, category: String| {
            Ok(get_category_world.borrow().audio.category_volume(&category))
        })?,
    )?;
    Ok(audio_api)
}

/// Read the option table a game passes to `api.audio.*`.
///
/// A missing table means "defaults", not an error: the common call is a bare
/// `api.audio.play("sfx://click")`.
fn audio_options(options: Option<Table>) -> mlua::Result<AudioOptions> {
    let Some(options) = options else {
        return Ok(AudioOptions::default());
    };
    super::reject_unknown_keys(&options, &["x", "y", "volume", "speed", "category", "entity"], "audio options")?;
    let x = options.get::<Option<f64>>("x")?;
    let y = options.get::<Option<f64>>("y")?;
    let position = match (x, y) {
        (None, None) => None,
        (x, y) => Some(Vec2 {
            x: x.unwrap_or(0.0),
            y: y.unwrap_or(0.0),
        }),
    };
    Ok(AudioOptions {
        volume: options.get::<Option<f64>>("volume")?,
        speed: options.get::<Option<f64>>("speed")?,
        category: options.get::<Option<String>>("category")?,
        position,
        entity: options.get::<Option<String>>("entity")?,
    })
}
