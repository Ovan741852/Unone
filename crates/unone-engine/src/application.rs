//! Host-neutral application lifecycle intent. Games own confirmation and menus.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EscapeBehavior {
    #[default]
    Quit,
    Action,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ApplicationState {
    pub escape_behavior: EscapeBehavior,
    /// A monotonic intent latch; presenting/exiting belongs to the host.
    pub quit_requested: bool,
}

impl ApplicationState {
    pub(crate) fn is_default(&self) -> bool {
        self.escape_behavior == EscapeBehavior::Quit && !self.quit_requested
    }

    pub(crate) fn set_escape_behavior(&mut self, behavior: &str) -> Result<(), String> {
        self.escape_behavior = match behavior {
            "action" => EscapeBehavior::Action,
            "quit" => EscapeBehavior::Quit,
            _ => return Err("APPLICATION_ESCAPE_BEHAVIOR_INVALID: expected 'action' or 'quit'".into()),
        };
        Ok(())
    }

    pub(crate) fn request_quit(&mut self) {
        self.quit_requested = true;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn application_latch_and_escape_policy_survive_scene_replacement() {
        let mut world = crate::world::World::default();
        world.application.set_escape_behavior("action").unwrap();
        world.application.request_quit();
        world.load_scene_data(crate::parse_scene_fragment(r#"{"entities":[]}"#).unwrap()).unwrap();
        assert_eq!(world.application, ApplicationState {
            escape_behavior: EscapeBehavior::Action, quit_requested: true,
        });
    }
}

thread_local! {
    static HOST_PRESENTING: std::cell::Cell<bool> = const { std::cell::Cell::new(true) };
}

/// Host hint for the next tick: false while it is catching up and another tick follows before
/// anything reaches the screen. Hosts that show every tick never call this.
pub fn set_host_presenting(presenting: bool) {
    HOST_PRESENTING.with(|value| value.set(presenting));
}

pub(crate) fn host_presenting() -> bool {
    HOST_PRESENTING.with(|value| value.get())
}

#[cfg(test)]
mod presenting_tests {
    #[test]
    fn a_host_says_whether_the_next_tick_is_shown() {
        assert!(super::host_presenting());
        super::set_host_presenting(false);
        assert!(!super::host_presenting());
        super::set_host_presenting(true);
        assert!(super::host_presenting());
    }
}
