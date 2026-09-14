# Unone optional plugin protocol

Unone is AI-first: the runtime is authoritative, while tools are optional
clients of the same Developer Protocol. A plugin must not become a second game
engine API or a hidden source of game state.

## Discovery

The CLI and MCP adapter discover `plugin.json` from:

1. `<project>/.unone/plugins/*/plugin.json`
2. `<project>/plugins/*/plugin.json`
3. paths in `UNONE_PLUGIN_PATHS`
4. the engine package's bundled `plugins/` directory

Use these operations instead of guessing paths:

```powershell
game --project <game> --json plugin list
game --project <game> --json plugin inspect --id org.unone.blender
game --project <game> --json plugin test --id org.unone.blender
game --project <game> --json plugin call --id org.unone.blender --tool blender.preview --input request.json
```

The same operations are available to an AI host as
`unone_plugin_list`, `unone_plugin_inspect`, and `unone_plugin_call` through
MCP. Plugin tools are discovered from `unone_plugin_inspect`; the MCP tool
surface is not hard-coded to a plugin count.

## Manifest

```json
{
  "api": "unone.plugin.v1",
  "id": "org.unone.example",
  "name": "Example plugin",
  "version": "0.1.0",
  "entry": {"command": "node", "args": ["plugin.mjs"]},
  "capabilities": ["scene.preview"],
  "permissions": ["project.read", "project.write_staging"],
  "tools": [
    {
      "name": "example.inspect",
      "description": "Read-only inspection",
      "input_schema": {"type": "object"}
    }
  ]
}
```

The command is started directly, never through a shell. Its working directory
is the plugin root. The host sets `UNONE_PROJECT_ROOT` and
`UNONE_PLUGIN_ID`; the plugin receives one JSON line on stdin and must write
one JSON result line to stdout. Logs belong on stderr.

Request shape:

```json
{
  "protocol": "unone.plugin.v1",
  "action": "call",
  "plugin": "org.unone.example",
  "tool": "example.inspect",
  "project": "C:/Games/demo",
  "input": {}
}
```

The result uses the regular Unone `EngineResult` shape. A plugin may create
staged artifacts, but it must not silently overwrite active project files. The
engine/game decides when a staged artifact becomes authoritative.

For example, a failed validation returns a diagnostic with a stable code,
field-level evidence, and structured recovery actions:

```json
{
  "ok": false,
  "value": null,
  "diagnostics": [{
    "code": "UI_COMPONENT_INVALID",
    "severity": "ERROR",
    "summary": "Component validation failed",
    "explanation": "A required semantic action is missing.",
    "facts": {
      "errors": [{"code": "UI_ACTION_REQUIRED", "path": "spec.action", "message": "Provide an action name."}]
    },
    "likely_causes": [],
    "suggested_actions": [{
      "action": "inspect_component",
      "description": "Call ui.inspect_component for the component's required properties.",
      "command": null
    }],
    "source": null
  }],
  "effects": []
}
```

Each `suggested_actions` entry is an object with `action`, `description`,
and optional `command`, not a string. Return an empty array when no recovery
action applies. Diagnostic severity is `ERROR`, `WARNING`, or `INFO`. Use
`--json` to preserve field paths and other evidence in `facts`; a successful
tool invocation does not by itself prove that a generated component can run
on every host.

## Design rules

- Plugin absence is a structured `PLUGIN_NOT_FOUND` result, not a silent skip.
- Unknown plugin fields and unsupported protocol versions fail closed.
- Plugin output is observable, replayable, and tied to a project path.
- Tools should expose `inspect`, `preview`, `plan`, `apply`, and `test` as
  separate operations when mutation is involved.
- Plugins may own domain documents (for example Blender metadata), but they
  must export canonical Unone scene/assets before runtime consumption.
- Native host adapters remain platform code; they do not become arbitrary
  runtime plugins loaded into a shipping process.

The bundled `plugins/org.unone.blender` plugin is intentionally dependency-free
for its self-test. Blender is only required for the future real export step.
