# Audio voices, pan and on-demand decoding

`api.audio.play` fires a sound nothing can touch again. A game with its own mixer
(a voice limit that cuts the lightest voice, sounds that follow things on screen)
needs to keep hold of a sound while it plays:

```luau
local voice = api.audio.voice("sfx://hit", {category = "sfx", volume = 0.5, pan = -0.5})
api.audio.set(voice, {pan = 0.25, volume = 0.1})   -- any of volume, speed, pan, x, y
api.audio.stop(voice)
```

- A voice plays its clip **once**. It stays live in `world.audio_loops` (with
  `once = true`) until `audio.stop`, even after the clip has ended: the engine never
  learns when a clip ends, so the game stops the handle when it knows the length.
- It counts toward the 64 live sources, like a loop.
- `audio.set` also works on a loop. It answers whether the handle is live.
- `pan` is left (-1) to right (1) on `audio.play`, `audio.loop` and `audio.voice`.
  Centre is left out of the observation, so a game that never pans keeps its digests.
- Volume, category and fade rules are the same as for a loop.

## Decoding on demand

A bank too large to decode before the game starts marks its assets:

```json
{"id": "audio://bank/17", "kind": "audio", "source": "bank/17.wav",
 "encoding": {"format": "wav", "mime": "audio/wav", "decoder": "audio", "on_demand": true}}
```

The Web host fetches and decodes such an asset the first time it is played. A one-shot
waits for its decode; a voice or loop starts on the first sync after it. Either way the
first use starts late by as long as the decode takes. The native host decodes each
play anyway, so the flag changes nothing there.
