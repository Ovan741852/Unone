//! Preserve a secondary mouse button's transitions and their screen positions.
//! The host supplies the action name; games own the meaning of the button.
use std::collections::VecDeque;

#[derive(Default)]
pub(crate) struct ScreenButtonQueue {
    physical: bool,
    presented: bool,
    pending: VecDeque<(bool, [f64; 2])>,
}

impl ScreenButtonQueue {
    pub(crate) fn event(&mut self, down: bool, screen: [f64; 2]) {
        if self.physical != down {
            self.physical = down;
            self.pending.push_back((down, screen));
        }
    }

    /// Consume at most one transition. A primary pointer edge takes precedence:
    /// defer this edge and its action together so they retain the same position.
    pub(crate) fn tick(&mut self, advance: bool) -> (bool, Option<[f64; 2]>) {
        let screen = if advance {
            self.pending.pop_front().map(|(down, screen)| {
                self.presented = down;
                screen
            })
        } else {
            None
        };
        (self.presented, screen)
    }

    pub(crate) fn reset(&mut self) {
        self.physical = false;
        self.presented = false;
        self.pending.clear();
    }
}

pub(crate) fn tick_secondary(primary_edge:bool,right:&mut ScreenButtonQueue,middle:&mut ScreenButtonQueue)->(bool,bool,Option<[f64;2]>) {
    let (r,rs)=right.tick(!primary_edge);
    let (m,ms)=middle.tick(!primary_edge&&rs.is_none());
    (r,m,rs.or(ms))
}

#[cfg(test)]
mod tests {
    use super::ScreenButtonQueue;
    #[test]
    fn independent_middle_and_right_edges_keep_coordinates_and_primary_priority() {
        let (mut r,mut m)=(ScreenButtonQueue::default(),ScreenButtonQueue::default());
        r.event(true,[1.,2.]);m.event(true,[3.,4.]);
        assert_eq!(super::tick_secondary(true,&mut r,&mut m),(false,false,None));
        assert_eq!(super::tick_secondary(false,&mut r,&mut m),(true,false,Some([1.,2.])));
        assert_eq!(super::tick_secondary(false,&mut r,&mut m),(true,true,Some([3.,4.])));
        m.event(false,[5.,6.]);assert_eq!(super::tick_secondary(false,&mut r,&mut m),(true,false,Some([5.,6.])));
    }

    #[test]
    fn short_click_preserves_press_and_release_positions_on_separate_ticks() {
        let mut queue = ScreenButtonQueue::default();
        queue.event(true, [25., 75.]);
        queue.event(false, [80., 20.]);
        assert_eq!(queue.tick(true), (true, Some([25., 75.])));
        assert_eq!(queue.tick(true), (false, Some([80., 20.])));
        assert_eq!(queue.tick(true), (false, None));
    }

    #[test]
    fn primary_pointer_priority_defers_action_and_coordinates_together() {
        let mut queue = ScreenButtonQueue::default();
        queue.event(true, [12., 34.]);
        queue.event(false, [56., 78.]);
        assert_eq!(queue.tick(false), (false, None));
        assert_eq!(queue.tick(true), (true, Some([12., 34.])));
        assert_eq!(queue.tick(false), (true, None));
        assert_eq!(queue.tick(true), (false, Some([56., 78.])));
    }

    #[test]
    fn held_button_does_not_repeat_and_duplicate_events_do_not_move_the_edge() {
        let mut queue = ScreenButtonQueue::default();
        queue.event(true, [1., 2.]);
        queue.event(true, [3., 4.]);
        assert_eq!(queue.tick(true), (true, Some([1., 2.])));
        assert_eq!(queue.tick(true), (true, None));
        queue.event(false, [5., 6.]);
        queue.event(false, [7., 8.]);
        assert_eq!(queue.tick(true), (false, Some([5., 6.])));
        assert_eq!(queue.tick(true), (false, None));
    }

    #[test]
    fn focus_reset_releases_held_state_and_discards_pending_clicks() {
        let mut queue = ScreenButtonQueue::default();
        queue.event(true, [1., 2.]);
        assert_eq!(queue.tick(true).0, true);
        queue.event(false, [3., 4.]);
        queue.event(true, [5., 6.]);
        queue.reset();
        assert_eq!(queue.tick(true), (false, None));
        queue.event(false, [7., 8.]);
        assert_eq!(queue.tick(true), (false, None));
        queue.event(true, [9., 10.]);
        assert_eq!(queue.tick(true), (true, Some([9., 10.])));
    }
}
