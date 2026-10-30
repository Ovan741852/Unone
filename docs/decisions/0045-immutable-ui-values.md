# Decision 0045: Immutable UI Values with Private Ownership Proof

- Date: 2026-10-30
- Status: accepted; source and focused regressions implemented, packaged-player performance acceptance pending
- Scope: `@unone/ui` 0.6.0 ownership semantics in engine 0.2.0

## Problem and ownership

Unone's View and virtual `renderItem` functions describe presentation without
advancing gameplay. The official UI package already returns ordinary portable
node tables, which Core validates and converts into a complete UI snapshot.
Repeatedly deep-copying those results while constructing a component and then a
screen makes composition revisit unchanged descendants. A leaf's immutable
style is also useful to other leaves without another deep copy.

This is a reusable package ownership problem. Game state, content, themes,
inventory rules, interaction meanings and decisions about when to build a View
remain in project Luau. It does not justify moving a game's View into Rust,
adding mutable scene handles, or replacing the official renderer. The resource
and presentation boundary in [Decision 0044](0044-retained-presentation-resources.md)
remains separate: immutable Lua nodes do not themselves retain GPU resources or
remove Core-to-host serialization.

## Decision

Ordinary package constructors and `composeStyle` return immutable value
snapshots. The package may reuse a subtree only when its own private proof says
that the entire subtree is detached, portable and frozen. The public contract is
documented in [UI components](../ui-components.md#theme-copying-and-surfaces)
and the [canonical Luau declarations](../../crates/unone-engine/src/engine.d.luau).

### Borrowed inputs and owned results

- Mutable authored props, theme records, rectangles, styles, colors and child
  arrays are borrowed. Copy them at the ownership boundary; do not freeze or
  retain the caller's mutable graph. Later edits to a builder cannot change an
  earlier result.
- Previously proven immutable package values can be shared. Sharing a frozen
  child or style across results is intentional; returning a borrowed mutable
  table through that path is an ownership defect.
- Seal detached pure descendants while copying borrowed input, using the same
  admission traversal to compute expanded work and height. Keep each construction
  envelope mutable until its generated fields are installed. In particular,
  slider `drag` metadata is installed before finalization. Adding a
  component surface requires a fresh child-array envelope, and padding overrides
  require a fresh padding record. Unchanged frozen descendants remain shared.
- Snapshot theme defaults once per kit. Merging styles uses copy-on-write for
  changed envelopes and padding. Padding still merges by edge; colors and other
  values still replace as a whole. Omitted style and explicit empty style keep
  their existing distinct typography behavior.

The private weak-key registry stores only numeric expanded-work and height
metadata. It contains no node, descendant or closure back-reference. Luau's weak
keys do not make such value back-references harmless: registry values are still
marked strongly. Keeping a kit alive must not retain all its retired views.
The registry belongs to its package instance and VM, and is discarded with that
VM on successful replacement or unload.

The common registry value packs expanded work and height into one exactly
representable number (`work * 256 + height`), avoiding an allocation for every
ownership record. A numeric-field record remains the fallback outside that
private representation's exact range; this optimization adds no input limit.
Pure copied descendants are frozen and granted during detachment, so finalization
can skip them instead of traversing the raw graph a second time. Branches with a
managed handle remain mutable until finalization and receive no pure grant.
The public `info()` metadata copy opts out and remains recursively mutable.

Reuse is an allocation optimization, not a budget exemption. Each occurrence of
a reused subtree consumes its complete cached expanded work and contributes its
height at the new depth. Repeated references to one small immutable DAG cannot
bypass the existing 131,072-copy-work or depth-64 limits. A caller's
`table.isfrozen`, ID, table shape or revision is not an ownership grant.

### Managed virtual nodes remain a distinct boundary

`virtualList` and `virtualGrid` return engine-managed live handles. Their registry
must preserve exact identity: a viewport request updates the registered node's
materialized children and window fields, publishes the root, and rolls those
changes back if publication fails. Replacing that handle with a copied ordinary
value would disconnect this lifecycle.

Private identity checks use a captured `rawget` and `rawequal`, without authored
`__index` or `__eq` callbacks. Finalization skips an exact registered live handle.
An ordinary component or screen containing one freezes its detached envelope
but receives no pure-subtree grant, including for intervening child arrays.
Later composition revisits that branch. Retiring the handle cannot leave a
previously granted pure ancestor hiding newly mutable or invalid data.

The public handle type is a readonly view, not a claim that its live table is
recursively frozen. Only the helper owns mutation; manual edits violate the
contract. Ordinary package `scrollView` results are detached frozen snapshots.
Slider controllers and responsive models retain their stateful APIs; ordinary
slider `view` nodes are immutable values.

### Ownership authority includes trusted intrinsics

Independent review found an authority defect in the first prototype. Core's
sandbox freezes standard library tables, but its VM-local global proxy remains
writable. The package and Game originally used that same environment. A game
could call `getfenv`, replace the environment's `table` with a copy whose
`freeze` was a no-op, and obtain a mutable node carrying the package's private
grant. Restoring the real library before composing a parent did not revoke it.

The package and scroll helper now capture every used library and validation
intrinsic into lexical locals while Core loads them, before Game code executes.
Original library tables are already readonly. Changing globals or a public
function's environment cannot replace these captured dependencies. Validation,
freezing, cloning and exact managed identity use the captured operations. This
fix addresses the demonstrated path without changing the whole Game sandbox.

### Types, migration and versioning

Canonical output types use readonly records and `UiReadArray<T>`. Mutable
authoring aliases include `UiRectInput`, `UiStyleInput`, `UiImageQuadInput` and
`UiImageBatchDefinitionInput`. Constructor parameters accept mutable builders
and existing readonly values. Build another value when presentation changes;
do not patch the returned node, style or child array.

Both pinned analyzers, Luau 0.734 and 0.743, accept recursive readonly record and
numeric-indexer types and reject the exercised direct mutations. Their `ipairs`
typing can require writable arrays; use generalized iteration over readonly
output arrays. Some mutating builtins, including `table.clear`, remain accepted
through readonly views, and `table.freeze` alone does not infer a deep readonly
type. Runtime freezing supplies the ordinary-node protection that these static
checks cannot prove. Live managed handles retain the explicit exception above.

The actual vendored Runtime 709 parser also accepted the recursive readonly
syntax in a three-tick SDK8 fixture. That parser check used the existing 0.5
production runtime; it verifies syntax acceptance, not packaged UI 0.6 behavior.

This is a breaking package contract: engine 0.2.0 declares exact `@unone/ui`
0.6.0. Refresh canonical typings, CLI, embedded package and SDK together. The
portable UI fields and existing WASM publication ABI are unchanged by this
ownership decision, so it does not introduce an unrelated ABI version bump.

## Alternatives and consequences

| Alternative | Reason not selected |
|---|---|
| Keep mutable results and deep-copy every composition | Preserves repeated traversal and allocation even for unchanged package-owned descendants. Pure value results allow a smaller, enforceable ownership contract. |
| Trust `table.isfrozen` or an authored ID | A shallow-frozen caller table can contain mutable, cyclic or nonportable descendants. An ID proves no content or identity property. |
| Memoize caller tables or trust caller revisions | Mutable builders can change without a revision. Such a cache can publish stale data and must either rescan or introduce a separate mutation protocol. |
| Add opaque Rust UI handles or a Rust subtree cache | Adds another registry, lifetime, reload and validation boundary before the package's repeated copying is addressed. Core still receives complete values and validates them in this slice. |
| Adopt mutable engine-style node handles everywhere | Conflicts with the established pure View model and turns ordinary composition into stateful mutation. Existing virtual handles retain their narrow lifecycle exception. |

The selected implementation still allocates new nodes, changed envelopes and
small grant-metadata records. It traverses newly borrowed data, and Core still
converts and validates the full published tree. Web readers still parse the
publication into JavaScript objects; Lua identity does not cross that boundary.
No renderer, shader, gameplay rule or host readiness contract changes here.

## Validation and practical limits

The [fixed-source validation record](../evidence/2026-10-29-engine-stability/ui06-immutable-values-validation.json)
pins the source hashes, commands, raw logs, authority counterexample and paired
metrics below. Superseded prototype counts remain explicitly historical.

The [ownership regressions](../../crates/unone-engine/tests/ui_immutable.rs) and
[authority fixture](../../crates/unone-engine/tests/fixtures/ui-immutable-authority.luau)
cover borrowed-input isolation, copy-on-write, full repeated-occurrence budgets,
managed materialization/rollback/retirement, weak registry release while the kit
remains live, reload, environment shadowing and exact identity. The initial
32-test pass preceded the authority finding and is not final evidence. After
the fix, 33 focused package/ownership/control tests passed (19 + 4 + 10), and
the actual cache-only CLI counterexample failed before the fix and passed after
it. Independent source review found no further concrete P1/P2 in this bounded
ownership and consumer scope.
The weak-registry reachability unit explicitly collects its isolated VM;
the allocation diagnostic below does not force collection.

The [canonical package pair](../../crates/unone-engine/tests/ui_components.rs)
compares historical 0.5 source with authority-fixed 0.6, using the same real
scroll helper and authored 96-leaf view. Canonical worlds match over 120 warmup
ticks and 10 measured ticks. The diagnostic ran on Windows x86-64 with a debug
Rust test executable, Luau interpreter bytecode optimization 2,
`sampling-profile`, `sampling=false`, and no phase-only profile:

| Measured update-window value | Historical 0.5 | Authority-fixed 0.6 |
|---|---:|---:|
| Allocation growth bytes | 8,322,395 | 3,822,412 |
| Allocation growth events | 122,167 | 48,356 |
| Incremental GC steps | 1,855 | 711 |
| Instrumented incremental GC wall time | 3.4003 ms | 2.5972 ms |
| Maximum instrumented GC step | 0.0305 ms | 0.1882 ms |

Allocation growth decreased about 54.1% in bytes and 60.4% in events in this
synthetic window. The maximum observed GC step increased. The allocation hook
counts positive allocation/reallocation growth, not frees, live memory or all
allocator traffic; GC probes count paired incremental steps, not full cycles.
Initialization and Game.start are outside this update-window scope. Instrumented
wall times include probe overhead and are not a latency guarantee.

[Readonly-type evidence](../evidence/2026-10-29-engine-stability/ui06-readonly-types-validation.json)
separates analyzer rejection, analyzer builtin gaps and actual Runtime 709 parser
execution. The source and synthetic checks do not establish Web frame rate,
V8 heap behavior, GC frequency, leak freedom or seven-game acceptance. A matching
packaged official player still needs visual/input/lifecycle checks and separate
unprofiled performance windows on the intended workloads. Existing SDK8 player
results are not retroactively UI 0.6 acceptance.
