//! Wall-clock presentation pacing; authoritative simulation still advances fixed ticks.
#[derive(Default)]
pub struct NativeClock {
    units: u128,
    pub dropped_steps: u64,
}
impl NativeClock {
    pub fn advance(&mut self, elapsed: std::time::Duration, paused: bool) -> u32 {
        if paused {
            self.units = 0;
            return 0;
        }
        // Rational nanoseconds avoid refresh-rate-dependent floating-point drift.
        self.units += elapsed.as_nanos() * 60;
        let due = self.units / 1_000_000_000;
        self.units %= 1_000_000_000;
        self.dropped_steps = self
            .dropped_steps
            .saturating_add(due.saturating_sub(5).min(u64::MAX as u128) as u64);
        due.min(5) as u32
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn refresh_rate_cannot_change_simulation_speed() {
        for hz in [30, 60, 144, 240] {
            let mut clock = NativeClock::default();
            let mut ticks = 0;
            let mut before = 0;
            for frame in 1..=hz {
                let now = frame * 1_000_000_000u64 / hz;
                ticks += clock.advance(std::time::Duration::from_nanos(now - before), false);
                before = now;
            }
            assert_eq!(ticks, 60);
            assert_eq!(clock.dropped_steps, 0);
        }
    }
    #[test]
    fn pause_and_stalls_do_not_create_unbounded_catchup() {
        let mut clock = NativeClock::default();
        assert_eq!(clock.advance(std::time::Duration::from_secs(2), true), 0);
        assert_eq!(clock.advance(std::time::Duration::ZERO, false), 0);
        assert_eq!(clock.advance(std::time::Duration::from_secs(1), false), 5);
        assert_eq!(clock.dropped_steps, 55);
    }
}
