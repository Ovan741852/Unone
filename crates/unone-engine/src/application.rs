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
