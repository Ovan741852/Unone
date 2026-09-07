//! Deterministic dynamic uniform grid for the existing circle solver.
//! Re-query only newly entered cells after a positional correction. This keeps
//! the legacy lexicographic single-pass order, including correction-created hits.
use crate::world::Vec2;
use std::collections::{BTreeMap, BTreeSet};
type Cell = (i64, i64);
pub(crate) struct CircleGrid {
    size: f64,
    cells: BTreeMap<Cell, BTreeSet<usize>>,
    occupied: Vec<Option<Vec<Cell>>>,
    oversized: BTreeSet<usize>,
}
impl CircleGrid {
    pub fn new(circles: &[(Vec2, f64)]) -> Self {
        let mut radii = circles.iter().map(|(_, r)| *r).collect::<Vec<_>>();
        radii.sort_by(f64::total_cmp);
        let size = (radii.get(radii.len() / 2).copied().unwrap_or(0.5) * 2.0).clamp(1e-6, 1e100);
        let mut grid = Self {
            size,
            cells: BTreeMap::new(),
            occupied: vec![Some(vec![]); circles.len()],
            oversized: BTreeSet::new(),
        };
        for (i, (position, radius)) in circles.iter().enumerate() {
            grid.update(i, *position, *radius);
        }
        grid
    }
    fn keys(&self, p: Vec2, r: f64) -> Option<Vec<Cell>> {
        let bounds = [
            (p.x - r) / self.size,
            (p.y - r) / self.size,
            (p.x + r) / self.size,
            (p.y + r) / self.size,
        ];
        if !bounds
            .iter()
            .all(|v| v.is_finite() && v.abs() < (i64::MAX - 1) as f64)
        {
            return None;
        }
        let [x0, y0, x1, y1] = bounds.map(|v| v.floor() as i64);
        let width = x1.checked_sub(x0)?.checked_add(1)?;
        let height = y1.checked_sub(y0)?.checked_add(1)?;
        if width <= 0 || height <= 0 || width.checked_mul(height)? > 64 {
            return None;
        }
        let mut keys = Vec::new();
        for x in x0..=x1 {
            for y in y0..=y1 {
                keys.push((x, y));
            }
        }
        Some(keys)
    }
    pub fn update(&mut self, index: usize, p: Vec2, r: f64) {
        let next = self.keys(p, r);
        if self.occupied[index] == next {
            return;
        }
        if let Some(old) = self.occupied[index].take() {
            for key in old {
                if let Some(members) = self.cells.get_mut(&key) {
                    members.remove(&index);
                    if members.is_empty() {
                        self.cells.remove(&key);
                    }
                }
            }
        } else {
            self.oversized.remove(&index);
        }
        if let Some(keys) = &next {
            for key in keys {
                self.cells.entry(*key).or_default().insert(index);
            }
        } else {
            self.oversized.insert(index);
        }
        self.occupied[index] = next;
    }
    pub fn extend_candidates(
        &self,
        index: usize,
        seen: &mut BTreeSet<Cell>,
        pending: &mut BTreeSet<usize>,
        after: usize,
    ) {
        // Large/out-of-range bodies fall back conservatively, never disappear.
        let Some(keys) = &self.occupied[index] else {
            pending.extend(after + 1..self.occupied.len());
            return;
        };
        pending.extend(self.oversized.range(after + 1..).copied());
        for key in keys {
            if !seen.insert(*key) {
                continue;
            }
            if let Some(members) = self.cells.get(key) {
                pending.extend(members.range(after + 1..).copied());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sparse_thousands_have_no_quadratic_candidate_list() {
        let circles = (0..4000)
            .map(|i| {
                (
                    Vec2 {
                        x: (i % 100) as f64 * 4.0,
                        y: (i / 100) as f64 * 4.0,
                    },
                    0.5,
                )
            })
            .collect::<Vec<_>>();
        let grid = CircleGrid::new(&circles);
        let mut count = 0;
        for i in 0..circles.len() {
            let mut candidates = BTreeSet::new();
            grid.extend_candidates(i, &mut BTreeSet::new(), &mut candidates, i);
            count += candidates.len();
        }
        assert_eq!(count, 0); // Brute force would test 7,998,000 pairs.
    }
    #[test]
    fn negative_cells_large_bodies_and_updates_remain_conservative() {
        let mut grid = CircleGrid::new(&[
            (Vec2 { x: -2.0, y: -2.0 }, 0.5),
            (Vec2 { x: 20.0, y: 20.0 }, 0.5),
            (Vec2::default(), 1e12),
        ]);
        let mut seen = BTreeSet::new();
        let mut pending = BTreeSet::new();
        grid.extend_candidates(0, &mut seen, &mut pending, 0);
        assert_eq!(pending, BTreeSet::from([2]));
        grid.update(0, Vec2 { x: 20.0, y: 20.0 }, 0.5);
        grid.extend_candidates(0, &mut seen, &mut pending, 0);
        assert_eq!(pending, BTreeSet::from([1, 2]));
    }
}
