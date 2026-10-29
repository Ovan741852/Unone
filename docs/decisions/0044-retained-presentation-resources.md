# Decision 0044: Shared Render Resources, Retained Instances and Explicit Streams

- Date: 2026-10-30
- Status: selected architecture; first retained UI resource/transport slice implemented, official-player acceptance in progress
- Scope: reusable engine presentation, including 2D workflows in the 3D engine

## Problem

`projected.set` accepts a complete preprojected indexed batch. It is useful when
Luau intentionally owns a custom projector, deformation or compatibility renderer.
It is a poor default for ordinary images: the caller must generate clip-space
vertices, triangle indices and normalized UVs, choose GPU material state, split
consecutive texture runs and remove obsolete batches. A `set2D` material preset
reduces the field list but leaves all of that work in the game.

The unshipped `set2D` prototype is withdrawn. Existing `projected.set` and ordered
`setFrame` contracts remain expert capabilities; they are not the normal sprite
authoring route. A full replacement setter is valid for genuinely changing
procedural geometry. The defect is making it the only efficient normal route.

This is an engine primitive, not gameplay logic. Assets, local geometry,
transforms, explicit drawing order, clipping and resource lifetime are shared
presentation concerns. Map topology, fog rules, isometric projection, animation
timing, picking, damage and other game meanings remain in Luau.

## References and the useful common pattern

These are design references, not claims that Unone implements their features.

| Engine | Relevant model | What to adopt |
|---|---|---|
| Godot | [Sprite2D](https://docs.godotengine.org/en/stable/classes/class_sprite2d.html) exposes texture, atlas region, frame and appearance; [CanvasItem](https://docs.godotengine.org/en/stable/classes/class_canvasitem.html) carries transform/order; [custom drawing](https://docs.godotengine.org/en/stable/tutorials/2d/custom_drawing_in_2d.html) retains commands until redraw. | Describe images and placement; retain unchanged data. |
| Unity | [MeshFilter](https://docs.unity.com/en-us/engine/6000.0/manual/assets-and-media/asset-types/mesh/components-reference/class-mesh-filter) references a mesh rendered by MeshRenderer; [SpriteRenderer](https://docs.unity.com/en-us/engine/6000.0/manual/unity2d/sprite/sprite-renderer-reference) exposes sprite/color/sorting; [raw vertex-buffer updates](https://docs.unity.com/en-us/engine/6000.0/script-reference/unityengine/mesh/setvertexbufferdata) are advanced. | Separate reusable definitions from changing instance state and expert buffer operations. |
| Bevy | The [Mesh2d example](https://bevy.org/examples/2d-rendering/mesh2d/) uses mesh/material asset references and a separate Transform; the [sprite-sheet example](https://bevy.org/examples/2d-rendering/sprite-sheet/) changes an atlas index. | A sprite animation or move should update a small property, not recreate mesh data. |

Large populations also need a bulk route: Godot provides
[MultiMesh](https://docs.godotengine.org/en/stable/tutorials/performance/using_multimesh.html)
and Bevy demonstrates [tilemap chunks](https://bevy.org/examples/2d-rendering/tilemap-chunk/).
These have specific visibility/order tradeoffs. Unity explicitly warns that
[CPU dynamic batching](https://docs.unity.com/en-us/engine/6000.0/manual/analysis/graphics-performance-profiling/reduce-draw-calls/draw-call-batching/draw-call-batching)
can cost more than a draw call. Therefore draw-count reduction alone is not an
acceptance criterion, and a single enormous batch is not the universal solution.

## Decision

Use one shared ownership model under the existing entity, asset and UI contracts:

1. **Resources** describe reusable texture regions, geometry and materials.
   Existing manifest assets remain the normal source. Runtime geometry has
   validated, immutable generations owned by the Core; GPU objects remain host
   resources. Creating an ordinary sprite does not require manually creating a
   mesh or material. Built-in defaults supply those resources.
2. **Instances** reference resources and retain transform, color/opacity,
   visibility and explicit sorting state. Complete the existing entity sprite
   and mesh capabilities, including runtime attachment and image/region changes,
   rather than adding a competing scene/entity system.
3. **Streams** remain available when geometry genuinely changes every tick.
   Stable indices, UVs and material definitions should be reusable independently
   of changing positions. A custom or nonlinear projector remains authored in
   Luau; the engine does not infer one game's projection from its images.

This model applies to 2D and 3D resources without pretending that their depth,
lighting and ordering defaults are the same. Material behavior has named,
documented defaults and explicit supported extensions. Ordinary callers select
appearance, not a long list of low-level blend/depth/color switches.
Changing an instance's selected image region, tint or opacity must not recreate
its shared geometry. Region selection is small instance state even when atlas
definitions are reusable resources.

### High-volume artwork and UI

Do not require a simulation entity for every decorative quad. Provide a dense,
ordered collection/bulk-update route over the same visual resource/instance
semantics when individual entities are inappropriate. It must accept logical
images/crops/rectangles or explicit quad corners; the engine constructs shared
quad indices, resolves texture dimensions and forms compatible GPU runs. This
is not a map, fog, tile-rule, picking or automatic-layout subsystem.

First reuse the existing declarative `image_batch` authoring semantics for UI
artwork. Extend them with retained resource references and independently changing
placement only where profiling justifies it. Keep pure View, layout, hit testing,
scrolling and event ownership intact. Do not introduce a second rectangle-array
API with the same semantics merely to reach a faster renderer.

A collection facade for world/screen artwork must share the renderer and resource
model; exact public names and whether it is needed in the first slice remain an
implementation design task. Bulk operations are necessary, but exposing a GPU
batch is not: a game should not regroup A/B/A textures or know buffer capacity.
The renderer needs dense internal storage; a new public collection API requires
demonstrated authoring or entity-overhead need beyond the existing bulk UI path.
Ordinary 2D corners do not encode perspective W or arbitrary interpolation;
those requirements remain in the explicit expert mesh/stream contract.

### Coordinates, order and batching

- Geometry is normally local. Entity/camera transforms, and explicit collection
  transforms when needed, change independently of resources. This does not add a
  general parent/child hierarchy or change UI component coordinate semantics.
  Moving a camera over unchanged content must not rebuild its UVs
  and indices. Truly nonlinear projected output may still need vertex updates.
- World, stage and viewport coordinates have explicit contracts. Reuse existing
  coordinate conventions; do not infer conversions or silently mix spaces.
- The game owns semantic layers and explicit paint order. The engine may merge
  only compatible draws without changing that order. Transparent A/B/A remains
  A/B/A unless equivalence is proven; texture sorting is not permission to reorder.
- UI `image_batch` cannot simply be moved underneath the Canvas overlay: images
  can interleave with text, controls and other images. Acceleration must preserve
  the complete compositor order, or use a proven eligible run with an equivalent
  fallback. A separate GPU surface is not automatically equivalent presentation.
- Culling is a rendering optimization with explicit bounds. It must not suppress
  game updates or change simulation and interaction outcomes.

### Update, transport and lifecycle contract

Retention must exist across the complete path, not only in a JavaScript cache.

- Validate resource content at creation/replacement; validate small instance
  changes separately. Validate bulk operations before publishing any part.
  Unknown fields, missing references, bad numeric values and budgets fail clearly.
- The engine issues revisions. Caller buffer identity, an unchecked caller
  revision or an authored dirty flag is never proof that bytes are unchanged.
- Player transport sends new resource generations when required and cheap
  instance updates/references otherwise. It must not embed every unchanged
  vertex/index payload in every JSON publication. A registry that still does
  that has not solved the transport problem. Choose and measure a versioned delta
  or leased-binary protocol before committing its public shape.
- Canonical snapshots/replay remain complete and deterministic. Full inspection,
  player deltas and GPU handles are separate representations. Reattachment,
  dropped/invalid deltas, reload, scene reset and GPU context loss require an
  explicit full-state recovery path with host epoch/generation checks.
- Prioritize the effective model over backward compatibility, as directed by the
  user. This coordinated contract is engine 0.2.0 with `@unone/ui` 0.5.0. Keep
  canonical state complete and deterministic within that version; do not omit
  resource content from a digest merely to improve frame time. Existing game
  products are not silently migrated or rewritten.
- Core definitions have an explicit owner and bounded lifetime. Destroying an
  instance releases its references; shared definitions live until their owner
  releases them or the scene ends. In-use destruction has a specified error or
  deferred-retirement policy, never a dangling reference.
- Pure View/renderItem constructors only describe references; they must not
  allocate persistent resource-registry entries. Create/update/release belong
  to the declared mutation phase. A successfully published UI tree holds its
  referenced generations until successful replacement; a failed publication
  preserves the previous tree and references. Retiring virtual items releases
  their tree references without retaining their old key graphs. Test rapid
  virtual churn and failed replacement in addition to ordinary entity deletion.
- Old snapshots/leases may retain immutable generations until release. The host
  retires previous GPU resources after successful preparation and cancels stale
  asynchronous work. Reload rollback restores resource and instance state
  together. No unbounded history, pointer-keyed cache or forced per-frame GC.
- Declare supported default material, crop and clip semantics per target. Admit
  only an equivalent implementation/fallback, or return an explicit unsupported
  diagnostic before publication. Web-first implementation is not permission to
  silently select a different native material or erase clipping/alpha. The new
  ordinary path must not inherit the expert Web-only blend profile accidentally.

## Current source facts and limits

The first slice implements existing UI `image_batch` references to immutable
logical image resources, an independent affine instance transform, the matching
private ABI/worker resource wire, and explicit project teardown. Core ownership,
definition/crop/alpha validation and transport tests exist; official renderer and
actual-player acceptance are still in progress. Runtime entity sprite attachment,
general mesh resource APIs and dense independent-instance updates remain future
slices. A retained artwork group is appropriate for content that moves together;
it is not a claim that changing every independent object's data is free.

`runtime/bindings/projected.rs` copies both supplied buffers and constructs a
validated candidate before `World::set_projected` compares it with the old batch.
An identical call therefore still performs admission work. A retained world
snapshot shares the immutable bytes through Arc; it does not deep-copy the entire
binary geometry. `ProjectedBatch::serialize` caches the base64 encoding but still
writes the full strings into each publication. Changing the combined descriptor
can replace that cache even when geometry is unchanged.

The current Web decoder and GPU changes avoid repeated decoding and GPU object
recreation in the tested paths. They do not change that Core-to-host data model.
The source-over extension is useful in the advanced path, but passing its bounded
pixel/resource tests does not establish a suitable ordinary 2D API or 60 FPS.

## Implementation sequence and acceptance

1. Keep independent publication/resource-lifecycle fixes. Withdraw the new preset
   API before distributing an SDK that presents it as the ordinary route.
2. Specify the smallest retained resource/instance transport and lifecycle with
   an end-to-end official Web prototype. Exercise ordinary sprites and existing
   ordered UI artwork, including image crop/alpha and interleaved controls.
3. Complete existing entity sprite attachment/appearance APIs and a measured bulk
   path using that model. Reuse local geometry/material resources for meshes;
   extend expert streaming only where a genuine projector/deformation requires it.
4. Validate more than one workload: moving camera over static atlas artwork;
   many independently moving/fading sprites; dynamic/custom-projected geometry;
   and mixed UI images/text/scroll/input. Include deletion/reload/context loss.

Measure complete Luau, validation, publication, decode, upload and render costs;
bytes transferred, allocations/GC pauses and retained CPU/GPU memory; both actual
simulation and RAF cadence. No unchanged resource upload during camera-only
changes, no visual/order/input regression and bounded post-release ownership are
required. The current representative Web target remains at least 59 simulation
ticks/s and RAF callbacks/s, frame interval p95 <=18.5 ms and p99 <=25 ms, without
sustained dropped steps. Also count completed, ready presentation submissions and
their intervals/skips: a RAF callback that exits for pending resources, lost
context or an incomplete pass is not a rendered frame. Browser callback cadence
alone does not prove presentation or physical display scanout. Passing one map
is not a general engine performance claim.

Provide low-cost, read-only official-host counters for completed simulation
frame/time, completed draw count, last successfully presented snapshot frame,
dropped-step total and publication host timestamp. These counters must update
only at their actual completion boundaries, including worker presentation. The
last dirty UI render cost is not a per-frame render cost. A 30-draw publication
cadence alone is insufficient to certify short windows without endpoint bounds;
missing completed-presentation evidence is insufficient, not a passing result.
