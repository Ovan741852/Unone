# Independent SDK recovery probe

Outcome: successful recovery using only the fixed portable SDK CLI, generated starter, and updated official documentation. No external blocker. No engine source, existing projects, sibling probes, history, web, Cargo, commits, pushes, or SDK modification were used.

Project: `D:\TSProject\UnoneUiUsability-20261016\recovery-project`
Evidence: `D:\TSProject\UnoneUiUsability-20261016\recovery-attempt`
Executable for all CLI invocations: `D:\TSProject\UnoneUiUsability-20261016\fixed-sdk\bin\game.exe`
Analyzer environment for commands 01-09: `UNONE_LUAU_ANALYZER=D:\TSProject\UnoneUiUsability-20261016\tools\luau-analyze.exe`.

## First untouched response

`project init --name "UI Settings Recovery"` exited 0. Before any project modification, Web preflight exited 1 with `SDK_RUNTIME_UNAVAILABLE`, status `incompatible`, no effects and `output:null`. The complete first response is preserved in `02-untouched-web-preflight.output.txt`; its exact argv and exit status are adjacent files. The complete untouched seven-file starter is retained in `untouched-starter`.

The response named the requested target `web`, variant `production`, automatic runtime selection, and sole installed runtime `web-production-0`. All target/variant/id match flags were true. Its `missing_systems` explicitly listed `camera3d`, `physics2d`, and `save`, while `compiled_systems` retained `audio,camera2d,input,observation,particle,random,ui,world`. This made the incompatibility discoverable without engine internals or guessing.

## Recovery and justified changes

I executed the diagnostic's three suggested actions using the supplied game.exe path, retaining its explicit SDK/project paths and target. SDK inspection and systems list both exited 0. I read official `docs/portable-sdk.md` (Starter projects and limited runtimes), `docs/optional-systems.md`, and `docs/ai-workflow.md` sections 0.5 and 1. These explain that omitted system entries still use defaults, describe `systems set --id ... --enabled false`, and prohibit silently adjusting choices to installed runtimes.

The generated script's executable game code uses only particle.play, input.isDown, entity.getPosition and entity.setPosition. The generated scene contains one 2D transform and a starter particle effect; it has no rigid bodies, 3D meshes or save payload. References to physics/camera3d/save in the inline type declaration are API types, not calls. The intended app requires no physics, persistence or perspective/3D gameplay. Therefore I explicitly ran:

- `--project D:\TSProject\UnoneUiUsability-20261016\recovery-project --json systems set --id physics2d --enabled false` (exit 0)
- same command with `--id camera3d` (exit 0)
- same command with `--id save` (exit 0)

Only `project.unone.json` changed, from `systems:{particle:true}` to `systems:{camera3d:false,particle:true,physics2d:false,save:false}`. Before/after SHA-256 values for every project file are in `project-file-hashes.json`; every other file is unchanged. UI stayed enabled. Particle stayed enabled because the starter actually calls it. No API or renderer was invented or replaced.

The diagnostic's concrete preflight retry then exited 0 and returned status `compatible`, runtime_id `web-production-0`, family `web-wasm`, variant `production`, verified true, and no diagnostics/effects.

Normal `verify` (no reduced gates or custom order) exited 0: types passed in strict mode, assets passed, tests passed 2/2, layout not_applicable because the starter publishes no UI tree. The external official analyzer was selected through its documented environment variable. This is the requested configuration/recovery probe; it does not claim a completed settings interface or rendered pixels. No prepare/export was needed for the requested preflight-plus-verify outcome.

## Command evidence

Each CLI command 00-09 has `.argv.json`, `.output.txt` and `.exit.txt` files. The runner `run-cli.ps1` records argv, cwd, the analyzer environment, complete combined CLI output and the immediately captured native exit status. All ran from `D:\TSProject`. CLI invocation order and exit status:

| Label | Operation | Exit |
|---|---|---|
| 00-init-help | project init --help | 0 |
| 01-project-init | project init --name UI Settings Recovery | 0 |
| 02-untouched-web-preflight | project preflight --target web | 1 |
| 03-suggested-inspect-sdk | sdk inspect --json, explicit SDK | 0 |
| 04-suggested-list-systems | systems list | 0 |
| 05-disable-physics2d | systems set physics2d false | 0 |
| 06-disable-camera3d | systems set camera3d false | 0 |
| 07-disable-save | systems set save false | 0 |
| 08-suggested-retry-preflight | explicit SDK/project, project preflight --target web | 0 |
| 09-normal-verify | verify | 0 |

## Usability assessment

The error is sufficient to recover: the machine-readable candidate facts distinguish a system mismatch from target/variant/id mismatch, and the human explanation supplies the same concrete missing systems. The inspection commands were useful; systems list gives disable_when, API namespaces and actual effective defaults. The retry command is concrete and read-only, without a placeholder output. The official portable SDK documentation clearly connects the generic starter to a limited runtime pack and advises explicit unused-system changes.

Remaining friction: the suggested commands use bare `game`, which is not on PATH in this consumer shell. Replacing that executable token with the known `fixed-sdk\bin\game.exe` made all three actions executable; `game-path-resolution.txt` records this. The diagnostic does not itself include the precise `systems set` syntax, so finding that mutation command needs the official workflow documentation or CLI help. The generic starter enables systems it does not actually use, causing an avoidable first-run compatibility failure with this SDK. Some general workflow examples still start with Cargo, whereas the portable SDK document supplies the appropriate packaged binary workflow. The full inline API type declaration can initially look like system use unless one distinguishes types from actual game code.

One evidence-finalization PowerShell command hit a parser error because an if-statement was piped without assignment. It executed no CLI or project mutation and was corrected immediately; it is unrelated to SDK recovery.
