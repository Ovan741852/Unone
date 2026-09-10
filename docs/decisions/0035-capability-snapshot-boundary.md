# ADR 0035: One capability snapshot with conservative readiness states

## Context

Unone already exposes `platform capabilities`, `systems list`, and plugin
`list/inspect`, but they describe different slices and use different state
vocabularies. An AI that reads only one command can mistake a compiled system,
an installed plugin manifest, or a browser renderer declaration for a verified
runtime capability.

## Decision

Add the read-only `game platform snapshot --json` command and the equivalent
`unone_platform_snapshot` MCP tool. It composes the existing platform report
and plugin manifests without starting plugins, opening a renderer, or adding a
new verification gate.

The snapshot uses one conservative vocabulary:

- `verified`: the Core report has executable evidence for this target;
- `partial`: only compile, manifest, or host-declared evidence exists;
- `pending`: the capability explicitly requires unverified host work.

Every entry retains `source_state`, `verification_scope`, `checked_by`,
limitations, evidence references, and at least one minimal example or an
explicit statement that a host probe is required. A plugin with `plugin.test`
remains `partial` until that test is explicitly run. `renderer_probe=not_probed`
never becomes `verified`. Project-disabled systems are `partial`, even when
their engine code is compiled. Cross-target host backlog is exposed separately
so it does not make the current target look blocked.

## Ownership and non-goals

The snapshot is an SDK/CLI/MCP discovery projection. Core retains only stable
platform facts and contracts; Workshop may persist and link snapshot evidence;
Koncrate Viewer displays it for humans. It is not a renderer probe, plugin
installer, release gate, requirements database, or gameplay policy. Gameplay
rules remain in Luau, and platform/importer behavior remains in Host/Plugin.

## Consequences

AI gets one current entry point with honest uncertainty and executable next
steps. Existing commands remain compatible and authoritative for their narrow
scope. Renderer and plugin readiness can still be `partial` until a real host
or self-test supplies evidence; this prevents documentation or compile-only
claims from becoming false green results.
