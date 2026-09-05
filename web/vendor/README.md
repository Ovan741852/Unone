# Vendored presentation runtimes

`web/presentation/` needs two third-party runtimes to draw what the engine
publishes. They are vendored so the demo runs from a clean checkout without a
package manager, and they are never part of `unone-engine`.

| Path | Version | Source | Licence |
| --- | --- | --- | --- |
| `spine/spine-webgl.js` | 4.2.120 | npm `@esotericsoftware/spine-webgl` | Spine Runtimes License Agreement (`spine/LICENSE`) |
| `effekseer/effekseer.js`, `effekseer/effekseer.wasm` | 1.60e (repo tag 170) | github.com/effekseer/EffekseerForWebGL | MIT (`effekseer/LICENSE`) |

**Spine is not free software.** The Spine Runtimes License Agreement requires a
valid Spine licence for every developer who integrates or ships these runtimes,
and it forbids redistributing the runtime source outside a licensed product. The
same applies to the `spineboy` example skeleton used by the slot machine
validation project. Before this leaves a prototype, either hold Spine licences
for the team or replace the skeletal layer; the engine side does not depend on
Spine, only on the semantic animation contract in Decision 0028.

Effekseer is MIT and carries no such condition.
