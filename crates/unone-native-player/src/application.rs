//! Native lifecycle policy; application state and confirmation are game-owned.
use unone_engine::{ApplicationState, EscapeBehavior};
use winit::keyboard::{KeyCode, PhysicalKey};

pub(crate) fn escape_quits(state: &ApplicationState, key: PhysicalKey, pressed: bool) -> bool {
    state.escape_behavior == EscapeBehavior::Quit
        && key == PhysicalKey::Code(KeyCode::Escape)
        && pressed
}

pub(crate) fn finish_requested(state: &ApplicationState, presented: bool, headless: bool) -> bool {
    state.quit_requested && presented && !headless
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_escape_quits_only_on_physical_press_and_action_mode_never_quits() {
        let mut state = ApplicationState::default();
        let escape = PhysicalKey::Code(KeyCode::Escape);
        assert!(escape_quits(&state, escape, true));
        assert!(!escape_quits(&state, escape, false));
        assert!(!escape_quits(&state, PhysicalKey::Code(KeyCode::KeyP), true));
        state.escape_behavior = EscapeBehavior::Action;
        assert!(!escape_quits(&state, escape, true));
        assert!(!escape_quits(&state, escape, false));
    }

    #[test]
    fn quit_waits_for_successful_presentation_and_headless_never_claims_it() {
        let mut state = ApplicationState::default();
        assert!(!finish_requested(&state, true, false));
        state.quit_requested = true;
        // Surface loss/timeout retries must retain the requested snapshot.
        for _ in 0..3 { assert!(!finish_requested(&state, false, false)); }
        assert!(finish_requested(&state, true, false));
        assert!(!finish_requested(&state, false, true));
        assert!(!finish_requested(&state, true, true));
    }
}
