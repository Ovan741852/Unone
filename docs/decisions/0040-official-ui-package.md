# ADR 0040: versioned official Luau UI package in the SDK

Status: accepted, 2026-10-16.

## Context

Official UI leaves, typography, reusable component trees and scoped background
intent already exist. Projects still copy helper implementations to construct
the same leaves, merge styles, derive internal IDs and prepend component
surfaces. The missing common capability is library availability and a typed
construction contract, not another renderer or a game-specific card layout.

The existing plugin protocol runs external authoring tools. The runtime evaluates
one entry script and has no general Luau module loader. Scroll helpers already
demonstrate engine-provided pure Luau code behind the typed `api.ui` boundary.

## Decision

Ship `@unone/ui` as a versioned pure Luau source package in `packages/unone-ui`,
embedded in matching Core binaries and included in portable SDK hash inventories
with its manifest, guide and canonical strict types. Its public namespace is
`api.ui.components`. `info` reports the installed manifest and declaration state;
`create` returns typed constructors for text, buttons, panels, images and generic
components. The package also supplies nonmutating style composition and stable
instance/role IDs.

Themes and overrides remain explicitly authored data. Constructors emit the
existing UI nodes, copy authored geometry unchanged, preserve child order and
select no palette, font, layout, responsive policy or application behavior. A
component's explicitly requested surface shares its declared placement, is
painted first and carries `background_for` ownership. It adds no title/control
placement rule or style inheritance to the transport.

Ordinary tables are copied with bounded cycle/work checks. Registered virtual
list/grid nodes retain their engine-owned identity through a private ownership
predicate: subsequent viewport requests must update the node in the published
tree. This exception preserves the existing scroll lifecycle and is documented;
it is not inferred from IDs, names or arbitrary hand-authored scroll nodes.

Projects declare exact versions in `runtime_packages`. Core checks availability,
system ownership and versions before game execution; undeclared helper calls
give an actionable error. SDK selection adds exact package requirements to its
existing target/variant/ID/system rules, preserving size/ID ordering. Old projects
with no requirements can still use older runtimes. Manifest/runtime descriptor
package facts must agree. Build tools stamp actual source/binary capabilities;
native Android packaging rejects a stale Windows capability binary instead of
copying its old package version into a new library's descriptor.

## Alternatives and consequences

Copying snippets into every entrypoint does not create a maintained common
library. An external authoring plugin or npm wrapper is not the game's Luau
runtime. A general file resolver would add unrelated import, analyzer, reload,
export and confinement policies. A separate widget transport, theme, automatic
layout or UI state manager is not needed for typed composition. None is added.

The package version is pinned to the SDK/player build; declaring it performs no
network installation and replacing a loose source file does not update an
embedded runtime. Different projects reuse the maintained implementation through
the same namespace. Independently updating runtime libraries is a separate
distribution capability. The author still uses normal verify/prepare plus real
target acceptance; package inventory and headless checks are not visual proof.
