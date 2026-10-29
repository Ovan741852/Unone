//! Preserve physical key transitions until the simulation can observe them.
//! Action names and the meaning of held/pressed state belong to the caller.
use std::collections::{BTreeMap, BTreeSet, VecDeque};

#[derive(Default)]
pub(crate) struct ActionQueue {
    physical: BTreeSet<&'static str>,
    presented: BTreeSet<&'static str>,
    pending: BTreeMap<&'static str, VecDeque<bool>>,
}

impl ActionQueue {
    pub(crate) fn event(&mut self, action: &'static str, down: bool) {
        let changed = if down {
            self.physical.insert(action)
        } else {
            self.physical.remove(action)
        };
        // OS key repeats and duplicate releases are not new transitions.
        if changed {
            self.pending.entry(action).or_default().push_back(down);
        }
    }

    /// Advance each key by at most one transition per simulation tick. Different
    /// keys advance together, so a chord is not serialized across game frames.
    pub(crate) fn tick_actions(&mut self) -> impl Iterator<Item = &'static str> + '_ {
        for (action, edges) in &mut self.pending {
            if let Some(down) = edges.pop_front() {
                if down {
                    self.presented.insert(action);
                } else {
                    self.presented.remove(action);
                }
            }
        }
        self.pending.retain(|_, edges| !edges.is_empty());
        self.presented.iter().copied()
    }

    /// Cancel queued taps and release all presented keys on the next tick.
    pub(crate) fn reset(&mut self) {
        self.physical.clear();
        self.presented.clear();
        self.pending.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::ActionQueue;

    fn tick(queue: &mut ActionQueue) -> Vec<&'static str> {
        queue.tick_actions().collect()
    }

    #[test]
    fn short_tap_survives_until_a_down_tick_then_an_up_tick() {
        let mut queue = ActionQueue::default();
        queue.event("W", true);
        queue.event("W", false);
        assert_eq!(tick(&mut queue), ["W"]);
        assert!(tick(&mut queue).is_empty());
        assert!(tick(&mut queue).is_empty());
    }

    #[test]
    fn held_keys_and_autorepeat_do_not_create_extra_edges() {
        let mut queue = ActionQueue::default();
        queue.event("Space", true);
        assert_eq!(tick(&mut queue), ["Space"]);
        for _ in 0..5 {
            queue.event("Space", true);
        }
        assert_eq!(tick(&mut queue), ["Space"]);
        assert_eq!(tick(&mut queue), ["Space"]);
        queue.event("Space", false);
        queue.event("Space", false);
        assert!(tick(&mut queue).is_empty());
        queue.event("Space", true);
        assert_eq!(tick(&mut queue), ["Space"]);
    }

    #[test]
    fn rapid_taps_keep_their_order_and_chords_advance_together() {
        let mut queue = ActionQueue::default();
        for _ in 0..2 {
            queue.event("A", true);
            queue.event("A", false);
        }
        queue.event("D", true);
        queue.event("D", false);
        assert_eq!(tick(&mut queue), ["A", "D"]);
        assert!(tick(&mut queue).is_empty());
        assert_eq!(tick(&mut queue), ["A"]);
        assert!(tick(&mut queue).is_empty());
    }

    #[test]
    fn reset_discards_pending_taps_and_releases_held_keys() {
        let mut queue = ActionQueue::default();
        queue.event("Held", true);
        assert_eq!(tick(&mut queue), ["Held"]);
        queue.event("Pending", true);
        queue.event("Pending", false);
        queue.reset();
        assert!(tick(&mut queue).is_empty());
        // A late physical release cannot replay an old transition.
        queue.event("Held", false);
        assert!(tick(&mut queue).is_empty());
        queue.event("Held", true);
        assert_eq!(tick(&mut queue), ["Held"]);
    }
}
