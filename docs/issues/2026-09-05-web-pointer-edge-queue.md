# Web pointer press edge lost between animation frames

## Status

Resolved in the generic runner; pending delegated Fish Machine regression.

## Detection

Fish Machine reported that a normal browser click changed the host pointer to
`down=false` before the next `requestAnimationFrame`. The runtime therefore
received only the release state and did not execute the game's press-triggered
shot. Headless `input_sequence` was unaffected because it already supplies one
explicit pointer state per fixed frame.

## Impact

This is a host architecture issue for every Web game using pointer press/release
edges, not a Fish Machine rule. A click could be lost when pointerdown and
pointerup occurred between two animation frames.

## Fix

The generic runner now queues pointer event snapshots and consumes at most one
queued snapshot per engine frame. A fast click produces a down frame followed by
a release frame; drag events preserve their order. The current pointer remains
the fallback while the queue is empty, so held-pointer behavior is preserved.

## Required regression

After the next immutable package is created, run a real canvas click and the
existing pointer replay in Fish Machine and any other pointer-driven game.
Assert semantic shot/action count, economy/target state, and no console error;
do not accept a screenshot alone.
