# UI previews from saved state

Native authoring tools can initialize an ordinary game runtime from a JSON save
fixture before `Game.start`. This avoids repeating a long journey just to inspect
a saved screen's layout. It uses normal `api.save.get()` restoration; the game
still validates the payload and applies its own rules.

```powershell
game --project D:/Games/MyGame ui preview --strict --save-fixture tests/fixtures/workshop.json
```

The path is relative to the project root, even when the command runs elsewhere.
Use forward slashes. Absolute paths, `.`/`..` components and links outside the
root fail explicitly. Unicode and spaces in filenames are supported; quote a
CLI path containing spaces. Invalid JSON reports `UI_SAVE_FIXTURE_INVALID_JSON`,
missing/unreadable files `UI_SAVE_FIXTURE_READ_FAILED`, and unsafe paths
`UI_SAVE_FIXTURE_PATH_INVALID`.

For a repeatable `verify` layout gate, declare the same initialization alongside
the existing frame, seed and input replay controls:

```json
"ui_previews": [{
  "name": "workshop inventory",
  "frames": 2,
  "seed": 42,
  "save_fixture": "tests/fixtures/workshop.json",
  "input_sequence": "tests/open-inventory.json"
}]
```

MCP `unone_ui_preview` accepts `save_fixture` with the same root-relative path
contract. CLI and `verify` retain their existing input replay options. With no
fixture, all three entry points preserve fresh-start behavior.

The project schema marks `save_fixture` as `writeOnly`: authoring tools accept
it, while serialization of the typed project config omits it. Official exports
do not collect the fixture file as a production asset. The exported player keeps
its normal persistence behavior and does not expose a fixture loading command;
unchanged player runtimes can ingest the resulting payload. Do not explicitly
list private QA saves as game assets or other production content.

Keep fixtures deterministic, valid for the current game's save version, and
regenerate them when that format changes. Layout inspection proves the saved
screen's structure; use separate tests for save acquisition, natural navigation
and actual rendered pixels. Engine contract regression:
`node scripts/verify-ui-preview-fixture.mjs <existing-production-runtime> <report.json>`.
