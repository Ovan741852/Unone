# Vendored presentation runtimes

`web/presentation/` needs two third-party runtimes to draw what the engine
publishes. They are vendored so the demo runs from a clean checkout without a
package manager, and they are never part of `unone-engine`.

| Path | Version | Source | Licence |
| --- | --- | --- | --- |
| `spine/spine-webgl.js` | 4.2.120 | npm `@esotericsoftware/spine-webgl` | Spine Runtimes License Agreement (`spine/LICENSE`) |
| `effekseer/effekseer.js`, `effekseer/effekseer.wasm` | 1.60e (repo tag 170) | github.com/effekseer/EffekseerForWebGL | MIT (`effekseer/LICENSE`) |

## What the Spine licence actually requires

The runtimes themselves cost nothing and carry no royalty. What the agreement
attaches is a condition: integrating them is permitted provided each user of the
resulting product obtains their own **Spine Editor** licence, and any
redistribution keeps the licence and copyright notice. The paid product is the
editor, not the runtime.

Esoteric Software reads "each user" as the people who work with Spine on the
project — the seats that author or edit skeletons — not the players of the
finished game. So in practice: whoever makes the Spine art needs an editor
licence; shipping the runtime inside the game does not add a per-player cost.

For this repository that means:

- The `spineboy` skeleton used by the slot machine validation project is an
  official Esoteric example. Nobody here authored it, so no editor seat was
  consumed to produce it.
- The moment this project wants its own skeletal art, whoever builds it needs a
  Spine Editor licence (Essential or Professional).
- `spine/LICENSE` must travel with any redistribution, which is why it is
  vendored next to the runtime.

Effekseer is MIT and carries no condition of this kind.

None of this reaches `unone-engine`: the engine depends only on the semantic
animation contract in Decision 0028, so the skeletal backend can be replaced
without touching a game.
