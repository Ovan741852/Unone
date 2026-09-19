# Project prepare contract

`project prepare` is the Core handoff for switching one project between the
Web preview and the Windows native player. It is tooling/business workflow,
not an engine gameplay capability.

```powershell
game --sdk <trusted-sdk> --project <project> --json project prepare `
  --target web|windows --output <new-directory> [--runtime-id <id>] [--development]
```

The command rejects an existing output path before it runs synchronization.
It then performs the existing `project sync` sequence (pack, verify, activate)
and the existing SDK export. A failed stage returns a non-zero exit code and a
diagnostic with the stage, cause, and recovery action; it never reports a ready
launch descriptor. No mtime-only cache hit is used.

Hosts that need to display availability before creating a generation can use
the read-only CLI preflight or MCP discovery tool. Both reuse the same
SDK/runtime and presentation checks and never create output:

```powershell
game --sdk <trusted-sdk> --project <project> --json project preflight --target windows
```

MCP clients call `unone_project_prepare_inspect` with `target: "web"` or
`target: "windows"`.

Successful JSON has the normal CLI result envelope. `value.schema` is
`unone.project-prepare.v1`:

```json
{
  "schema": "unone.project-prepare.v1",
  "status": "ready",
  "target": "windows",
  "project": "C:/games/example",
  "output": "C:/games/example/.preview/windows-1",
  "sync": {"status": "synced"},
  "export": {"target": "windows", "files": []},
  "runtime": {
    "target": "windows",
    "family": "native-wgpu",
    "runtime_id": "windows-production-0",
    "variant": "production",
    "verified": true
  },
  "launch": {
    "kind": "native",
    "executable": "C:/ProgramData/Unone/sdk/runtimes/windows-production-0/unone-native-player.exe",
    "executable_source": "sdk-runtime",
    "args": ["--root", "C:/games/example/.preview/windows-1"],
    "cwd": "C:/games/example/.preview/windows-1"
  }
}
```

For Web, `launch` is `{ "kind": "static", "root": <output>,
"entry": "index.html" }`. For Windows, Core selects the single `.exe` named
by the hash-verified SDK runtime descriptor and returns its canonical SDK path
with `executable_source: "sdk-runtime"`. The standalone export still contains
its own executable for delivery; Core confirms that copy's `export.json` entry
and bytes have the same hash as the SDK executable before returning the launch
descriptor. The host passes the long output only as `args[1]` after `--root` and
as `cwd`, so project/output paths are not subject to the SDK executable path
limit.

On Windows, preflight rejects a canonical SDK runtime executable path of 260 or
more UTF-16 code units with `SDK_RUNTIME_EXECUTABLE_PATH_TOO_LONG`. Install the
trusted SDK in a shallow directory and retry; Core does not silently shorten or
alias a project path. The Windows runtime descriptor must also declare the
`unone.native-ready.v1` contract; an older runtime is rejected during preflight
with an update/rebuild diagnostic rather than leaving the host waiting for a
readiness line that can never arrive. Hosts must pass `args` directly to a child
process with shell interpolation disabled; neither project files nor HTML provide
an executable path.
