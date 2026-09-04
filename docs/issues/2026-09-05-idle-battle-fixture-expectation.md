# Issue: Idle Battle fixture assumed pre-tick HP

## Symptom

The first Idle Battle fixtures expected victory with empty unit arrays and expected a save checkpoint before combat. The real fixed-dt replay showed that a normal update advances elapsed time and both teams attack on the first frame; the 360-frame result was victory at elapsed `3.02`, knight HP `11`, mage HP `30`, and both enemies at `0` HP. A one-frame checkpoint contained knight HP `31` and slime HP `33`.

## Classification

Game validation fixture issue, not an engine architecture issue. The fixture did not model the declared update order.

## Fix

Replace guessed assertions with values from the exact seed/input replay. Keep the battle update order explicit in Luau and keep the fixed-step contract in the engine. The test now asserts all unit views and the rounded elapsed value.

## Regression

`check --types` and all Idle Battle tests must pass with seed `42`; changing update order or RNG call order should change the deterministic evidence and require an intentional fixture update.
