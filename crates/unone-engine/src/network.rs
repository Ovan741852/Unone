//! Text between the sessions of a room. The game asks through `api.network`; the host carries it (the
//! official Web player over a WebSocket to a relay, see docs/network.md). What arrives comes back as
//! `network` rows of the ordered physical input, so it is in the tick's input and a replay has it.
use serde::{Deserialize, Serialize};

pub const NETWORK_MAX_TEXT: usize = 65536;
const MAX_ROOM: usize = 128;
const MAX_COMMANDS: usize = 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum NetworkCommand {
    Open {
        room: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        url: Option<String>,
    },
    Send {
        data: String,
    },
    Close,
}

/// This tick's commands: what the snapshot after it carries to the host.
#[derive(Debug, Clone, Default)]
pub struct NetworkState {
    frame: u64,
    commands: Vec<NetworkCommand>,
}

impl NetworkState {
    fn push(&mut self, frame: u64, command: NetworkCommand) -> Result<(), String> {
        if self.frame != frame {
            self.frame = frame;
            self.commands.clear();
        }
        if self.commands.len() >= MAX_COMMANDS {
            return Err(format!("NETWORK_TOO_MANY: at most {MAX_COMMANDS} commands a tick"));
        }
        self.commands.push(command);
        Ok(())
    }
    pub(crate) fn open(&mut self, frame: u64, room: String, url: Option<String>) -> Result<(), String> {
        if room.is_empty() || room.len() > MAX_ROOM {
            return Err(format!("NETWORK_ROOM_INVALID: 1 to {MAX_ROOM} bytes"));
        }
        self.push(frame, NetworkCommand::Open { room, url })
    }
    pub(crate) fn send(&mut self, frame: u64, data: String) -> Result<(), String> {
        if data.len() > NETWORK_MAX_TEXT {
            return Err(format!("NETWORK_TEXT_TOO_LONG: at most {NETWORK_MAX_TEXT} bytes"));
        }
        self.push(frame, NetworkCommand::Send { data })
    }
    pub(crate) fn close(&mut self, frame: u64) -> Result<(), String> {
        self.push(frame, NetworkCommand::Close)
    }
    /// The commands of the tick that ran as `frame`.
    pub(crate) fn of_tick(&self, frame: u64) -> Vec<NetworkCommand> {
        if self.frame == frame { self.commands.clone() } else { Vec::new() }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn commands_belong_to_their_tick() {
        let mut state = NetworkState::default();
        state.open(3, "room".into(), None).unwrap();
        state.send(3, "a".into()).unwrap();
        assert_eq!(state.of_tick(3).len(), 2);
        assert!(state.of_tick(4).is_empty());
        state.send(4, "b".into()).unwrap();
        assert_eq!(state.of_tick(4), vec![NetworkCommand::Send { data: "b".into() }]);
        assert!(state.of_tick(3).is_empty());
    }
    #[test]
    fn limits_are_reported() {
        let mut state = NetworkState::default();
        assert!(state.open(0, String::new(), None).unwrap_err().starts_with("NETWORK_ROOM_INVALID"));
        assert!(state.send(0, "x".repeat(NETWORK_MAX_TEXT + 1)).unwrap_err().starts_with("NETWORK_TEXT_TOO_LONG"));
    }
}
