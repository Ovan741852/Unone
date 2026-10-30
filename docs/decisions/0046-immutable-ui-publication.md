# Decision 0046: Immutable UI Publications Across Presentation Boundaries

- Date: 2026-10-30
- Status: implemented; packaged official-player acceptance in progress
- Scope: reusable engine presentation ownership and unchanged-data work

## Evidence and ownership

Decision 0045 removes repeated Luau composition copies of proven immutable
values. It does not carry that ownership through the Web presentation boundary.
SDK9 passed the actual seven-case official Web-player cadence checks at
59.98–60.04 advancing frames per second, with zero dropped steps. Its separate
45-second idle/inventory diagnostics still observed V8 GC producer activity.
WASM capacity and settled rendering owners were bounded in these windows;
neither fact establishes no GC or universal leak freedom.

The [SDK9 baseline](../evidence/2026-10-29-engine-stability/retained-sdk9-seven-scene-baseline.json)
pins the actual player, unchanged gates, fixed-state allocation pair and
natural-GC/resource-cycle evidence. This decision's source checks are separate
from acceptance of the newly packaged player.

The remaining repeated work is concrete: the ordinary UI is serialized in the
presentation envelope, parsed into fresh JavaScript objects each tick and
structured-cloned by the worker boundary. Scroll projection copies the leaves
on each draw, and Canvas UI stringifies the projected tree to detect changes.
This repeats even when the complete serialized UI is identical.

This is an engine primitive. The engine owns validated UI publication,
presentation transport, projection and renderer lifetime. Game rules, deciding
when to author a new View, themes and application cache policies stay in Luau.
The official renderer and update → acceptance → draw ordering are preserved.

## Decision

Retain one current immutable **encoded UI generation** at each boundary. The
Core compares complete encoded bytes, not an authored ID, revision, Lua table
identity or shallow-freeze claim. An unchanged encoding keeps its private
generation. This slice does not reuse an older Rust UiTree: resource replacement
must still refresh internal, nonserialized validation/usage metadata.

The full canonical world, digest and validation rules remain unchanged. Only
the official presentation envelope can omit an ordinary UI tree in favor of a
private synchronous memory descriptor:

```text
ui_tree_transport = {
  format: "ui-tree-memory-v1",
  epoch: decimal-u64-string,
  revision: decimal-u64-string,
  memory: { offset: safe-integer, byte_length: safe-integer }
}
```

An envelope cannot contain both this descriptor and inline `world.ui`.
The generation is prepared before publication and committed only after the
complete envelope succeeds. Previous bytes remain leased until that boundary.
A failed candidate does not advance the revision or replace the current lease.
Revisions never repeat in an epoch, including clear, disable/re-enable and
developer reload paths. A new runtime starts a new epoch. Unload retires the
current lease and reusable scratch capacity.

The optimized representation has a 64 MiB limit on actual escaped JSON bytes.
An otherwise valid larger tree uses the ordinary inline representation; this
limit must not become a new Core admission failure. An absent UI stays absent,
while a present empty screen stays a present empty screen. Absence or inline
fallback clears the corresponding retained consumer state. Retention is bounded
to the current generation and a publication candidate, with no historical
generation registry and no permanently retained oversized scratch allocation.

The synchronous WASM reader validates descriptor shape, integers and bounds,
decodes without retaining a heap view, and parses and transitively freezes a new
generation once. A private weak grant binds the actual owned tree to its encoded
publication. All cache changes wait until the complete envelope validates.
A caller-supplied frozen object or revision does not receive this grant.

The worker sends encoded UI only when the private generation changes. Its
receiver parses and freezes its own generation, checks the delta transaction,
and reconstructs the same public snapshot shape on every packet. Missing,
stale or malformed references fail explicitly without replacing valid state.
The ordinary inline path remains fully processed and ungranted.

## Projection and rendering

A trusted immutable tree allows the scroll host to retain one projected result.
The cache also checks actual host scroll offsets and the existing lifecycle;
inertia and capture continue to update normally. Changed scroll state creates
a new projection. Only the projection owner can grant its frozen derived tree.
Raw or merely caller-frozen input still follows the full projection path.

Canvas UI may use these private identities instead of repeatedly stringifying
an unchanged tree. This is an unchanged-content proof, not permission to skip
initial geometry validation or other invalidation. Viewport/DPR, asset/font
readiness, context restoration, resource generations, active text editing,
scroll rails, pointer capture and hit testing keep their existing owners and
refresh paths. The GPU prefix is still processed on each draw.

## Alternatives and limits

- A caller-authored dirty flag or ID cannot prove immutable contents and can
  silently preserve stale drawing or input geometry.
- Retaining UI only in the WASM reader still leaves worker cloning, projection
  allocation and Canvas stringification on unchanged frames.
- A Core Arc/RawValue redesign could reduce Rust cloning and encoding too, but
  is not required to eliminate the observed JavaScript boundary work. It is
  deferred until measurements justify that larger ownership change.
- This is a whole-tree generation. A moving camera or changing text can produce
  a new encoding every tick; the design does not promise unchanged-data savings
  for those cases, nor does it infer Game dirty rules.

## Required acceptance

Canonical bytes/digests must match for absent, empty, retained-artwork, save and
mixed-instance worlds. Exercise static reuse, every serialized field/order
change, invalid candidate rollback, resource replacement, reload/failure,
load/unload, transport toggling, escaped-byte overflow fallback and retirement.
JavaScript tests must prove one parse/delta for unchanged generations, atomic
malformed-delta rejection, raw mutable-input behavior and all projection/render
invalidation paths. Then build matching artifacts and run the official main and
worker lifecycle checks, the same unprofiled seven Game scenarios, and separate
natural GC/resource-cycle diagnostics. SDK9 results are the baseline, not
retroactive acceptance of this slice. Existing clocks and gates stay unchanged.
