# Memory-light particle renderer: engine scope request

Date: 2026-09-14

Status: requested for engine-owner assessment
Category: renderer / particles / host boundary

## Context

An external mobile-first app wants a quiet, authored-looking memory surface: many
small text or photo fragments float in depth, each fragment can have a user-chosen
color, and the focused foreground fragment may emit a short luminous trail and a
few fairy-like sparks. The effect must feel like light with a designed lifetime,
not like a UI sticker or an always-running game HUD.

This request is intentionally asking Unone to decide what is engine-worthy. It is
not asking for the app to be rewritten as a game, and it is not assuming that an
Effekseer WebGL presentation path is available on native mobile hosts.

## Questions for Unone

Please classify each item as one of:

1. **Engine primitive**: should be deterministic, reusable, and owned by the
   simulation or renderer contract.
2. **Presentation-host concern**: should remain in a WebGL/native host or app
   adapter and should not enter engine core.
3. **Not necessary** for this use case.

Assess at least:

- seeded emitter state and deterministic replay;
- spawn, lifetime, alpha/size easing, and pause/resume;
- a short curved trail with a decaying head/tail;
- additive glow/bloom and sprite or texture material support;
- depth-aware composition and an explicit foreground budget;
- reduced-motion and accessibility/focus pause semantics;
- text/photo fragment rendering, hit testing, and readable contrast;
- iOS, Android, and Web parity, including Expo/EAS or native-module costs;
- whether a single renderer contract can support a native fallback and a WebGL
  presentation without leaking app data or navigation concerns.

## Proposed minimum contract to review

```ts
interface MemoryParticleRendererProps {
  seed: number;
  color: string;
  phase: number;
  depth: 0 | 1 | 2;
  active: boolean;
  reducedMotion: boolean;
}
```

The host owns memory text/photo content, layout, hit targets, navigation,
accessibility labels, and the choice of which fragment is foreground. The engine
should receive only the visual parameters required for the effect.

## Acceptance evidence requested

Please respond with the smallest viable engine/host split and, if an engine change
is justified, a focused preview rather than a broad refactor:

- fixed-seed preview at 320 px and 390 px mobile widths plus desktop Web;
- a 0.25x slow-motion view showing spawn, trail, spark, and fade curves;
- a reduced-motion/static mode and focus pause demonstration;
- a stated maximum instance/particle budget and a 30-second stability check;
- a clear list of primitives that belong in Unone versus adapters that should stay
  in the app;
- any native-module, renderer, package-size, license, or Expo Go/EAS limitation.

If current Unone capabilities cannot meet the authored trail/material requirement,
please report the reachable quality level and the smallest missing primitive. A
native fallback must remain possible; do not require SQLite, routing, auth, or
memory business rules inside the particle runtime.
