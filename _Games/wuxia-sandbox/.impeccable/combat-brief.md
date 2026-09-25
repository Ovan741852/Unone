# Combat feedback — Experience

Preserve the existing low-poly jade/paper town, camera and resident inspector.
Focal moment: a Luau-approved strike winds up, then either a gold impact and
damage number or pale MISS. No hit particles for misses. Nonlethal sparring
ends in a named result; no fabricated periodic fight announcements.

Health is authoritative 100 minus injury; show a compact bar with numbers above
each living resident. Combatants also show opponent and execution phase.
One optional Watch fight control locates a current fight without stealing the
free camera. Reduced motion keeps numbers/results, removes lunges and arcs.

Budget: bounded 48-event feed, maximum 24 visual effects, shared geometries,
per-frame transforms/opacity only. No physics/damage/randomness in JS, no new
dependency. Test real Luau execution with clearly synthetic combat fixtures;
verify live model choices separately, do not force a live model demonstration.
