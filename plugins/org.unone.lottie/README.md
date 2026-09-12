# Unone Lottie

`org.unone.lottie` is the first supported, deliberately small Lottie host
runtime for Unone. It validates and plays the shape-only JSON subset used by
the Ashen Legion reward fixtures (`big-win`, `mega-win`, `legendary-win`, and
`coin-burst`) on a host-supplied Canvas2D context.

The runtime exposes `createLottieHost()` and `createLottiePlayer()` from
`runtime/lottie.mjs`. Host commands are structured results, not exceptions:

```js
const host = createLottieHost({ assets: { "reward.big_win": data }, createCanvas });
const mounted = host.mount({
  instanceId: "reward-overlay",
  asset: "reward.big_win",
  rect: { x: 0, y: 0, w: 100, h: 100 },
  pointerEvents: "passthrough",
});
host.play("reward-overlay", { mode: "once", speed: 1 });
host.update(dt);
host.render();
```

The lifecycle includes `ready`, `complete` (`reason: "natural_end"`) and
actionable `error` events with `instanceId` and `generation`. Seek to the
terminal frame never emits completion; a restart or source replacement creates
a new generation. Reduced motion renders a declared static frame and pauses
playback. The host does not decide reward/economy outcomes; Luau consumes the
already-settled event and may choose to show an animation.

Supported: Lottie 5.x, 2D shape layers, path geometry, solid fills, layer
position/scale/rotation/opacity keyframes, markers, once/loop controls. Not
supported: text/fonts, images, precomps, masks, mattes, effects, 3D layers,
expressions, audio, network loading, SVG/DOM galleries or GPU timing.
