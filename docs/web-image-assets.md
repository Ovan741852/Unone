# Official Web image preload plans

The official player owns image decoding, shared decoded-image leases and GPU
texture lifetime. A project may declare image groups for a required startup
working set. This does not create entities, allocate a second renderer or move
game rules into the host.

Create `player.image-assets.json` in the project root:

```json
{
  "version": 1,
  "groups": {
    "map": ["image://terrain"],
    "ui": ["image://inventory"]
  },
  "startup": ["map", "ui"],
  "budget": {"max_bytes": 67108864, "max_entries": 128}
}
```

`version`, `groups` and `startup` are required. `budget` is optional; its fields
default to 64 MiB and 128 entries. Groups are authored presentation choices;
the engine does not infer groups from IDs or add invisible scene objects.
Every referenced ID must be a declared `texture2d` with an accepted image
encoding. Startup groups must exist and be unique. Repeated asset references
share one decoded image. Group names may contain 1–128 UTF-8 bytes; IDs may
contain 1–2048. The plan allows at most 128 groups, 4096 references per group
and 16384 references in total. Raw and canonical JSON are each limited to
1 MiB. Unknown fields fail explicitly.

The selected startup groups are required before the official player's READY
boundary. Unsupported decoding, required budget admission failure or cancellation
fails startup. Automatic scene-sprite preparation remains a separate, potentially
partial convenience. Budgets estimate decoded RGBA image storage; they do not
raise the renderer's GPU texture-cache budget or represent total driver memory.

## Publish after host integration

CLI 10 does not automatically apply this sidecar. Use Node.js 18 or newer and
the additional SDK-indexed publisher after the normal official-player export
and any project host integration/finalization:

```text
node <sdk>/scripts/prepare-web-image-assets.mjs --project <project> --input-export <export> --output <new-export>
```

`--plan <file>` selects another plan. The default is
`<project>/player.image-assets.json`. The output directory must not exist and
must have an existing parent. Do not finalize or mutate the published files
after this step; publish the complete new generation before exposing its root
`index.html`. Validate the resulting official player on the requested target.

The helper verifies the complete input file inventory and all SHA-256 hashes,
the selected generation's alias pairs, official renderer selection, matching
project config/script/assets, and the host's image-plan capability. The host's
asset module must match the publisher's trusted SDK template, and the entry
must implement the versioned plan loader. The helper never imports code from
the input export. Installed SDK use verifies the tool and validator against
`sdk.json`; repository development uses the sibling engine template.

The canonical plan is added as `content/image-assets.json` with exactly one
`unone-image-assets` HTML meta reference. The helper preserves the CLI's flat
root `index.html` layout and inserts its new release base. It does not invent
an inner release index. All other logical file bytes, including project wheel
adapters, config, scene, runtime and assets, are preserved. The new release
identity uses the engine's exact `seal_web_generation` algorithm: SHA-256 of
the JSON tuple containing the HTML without its base and the UTF-8-byte-sorted
logical `[path, sha256]` inventory. Aliases and selected release copies are
both emitted and indexed. Old generation copies are not carried forward.

Some existing host finalizers refresh indexed file hashes without resealing
the release name. Such an input is accepted only when every indexed byte and
alias pair verifies. `image_assets.input_generation_matches_content` records
that mismatch; the new output is always resealed from its actual contents.
Paths must be portable relative paths and source/output ancestry must contain
no symlinks, junctions or Windows reparse points. No input is modified.

Required unique entries and 24-byte PNG IHDR dimensions receive an early
bounded budget check. Required startup images with unknown/non-PNG dimensions
are rejected because the current official bounded preloader supports PNG.
Non-startup groups may still declare other supported image encodings for
ordinary on-demand use. This header check is not a decoder or an image-validity
guarantee; the browser still validates decoding, admission and completion.

Preflight failures create no output. A copy/write failure preserves its
incomplete output for diagnosis; `export.json` is written last and marks a
completed publication. Select another fresh output after a failure. The tool
does not delete or overwrite an existing export.
