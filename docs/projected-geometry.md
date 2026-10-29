# Preprojected indexed geometry

`api.projected` is a generic presentation transport. A game supplies clip-space
vertices after its own projector, deformation or camera calculation. The engine
owns validation, texture lookup, buffers, draw ordering, clipping and GPU lifetime.
No game formula, camera adaptation, picking, terrain, lighting or fog is inferred.

```luau
local geometry: ProjectedGeometry = {
    texture="texture://atlas", vertices=vertexBuffer, indices=indexBuffer,
    order=0, depth_test=true, depth_write=true,
    scissor={x=128,y=0,width=512,height=480},
    color_mode="encoded", filter="linear", sampling_space="encoded",
    address_mode="repeat", alpha_cutoff=127/255,
}
api.projected.set("surface",geometry)
local viewport=api.projected.getViewport()
api.projected.setWorldVisible(false)
-- Later, remove only an ID known to exist:
api.projected.remove("surface")
```

## Bytes and limits

Each vertex is40 bytes: ten little-endian `f32` values, in this order:

| Byte offset | Values | Contract |
| --- | --- | --- |
|0 | clip X,Y,Z,W | Finite, absolute value at most1e9; W strictly positive |
|16 | U,V | Finite, absolute value at most1e9; official mesh UV convention, V0 at bottom |
|24 | R,G,B,A | Vertex modulation, RGB interpretation selected by color_mode; each within0..1 |

Indices are packed little-endian `u32`, zero-based triangle lists. A batch has
3..262144 vertices and3..1572864 indices, with each index below vertex count.
The world allows256 batches,1048576 vertices and6291456 indices in total.
IDs contain1..128 UTF-8 bytes; texture IDs1..256. Order is an integer in
`[-32768,32767]`. Unknown fields and wrong option types fail before replacement.

Clip Z uses the WebGPU/native0..W depth convention. Native passes clip XYZW
directly to the vertex output. Three WebGL changes only Z to`2*Z-W`; it does not
apply model/view/projection matrices or frustum/LOD classification. Hardware
clips offscreen vertices. A game may use W1 for affine texture interpolation;
varying positive W requests ordinary perspective-correct interpolation.

The renderer draws increasing signed order, then UTF-8 batch ID. Within a batch,
triangle order is index order. Depth comparison is strictly Less by default.
`depth_test=false` means Always-pass, independently of`depth_write`; Three keeps
depth testing enabled with AlwaysDepth so writes match native semantics.

Optional`scissor={x,y,width,height}` uses integer physical pixels with a top-left
origin. Width/height must be positive; right/bottom boundaries fit0..32768.
Hosts intersect it with the actual drawing buffer, skipping an empty intersection.
This safely handles resize before the next game publication. No scissor means
the full target. Native sets it per batch in the projected pass; Three converts
top-left physical pixels to bottom-left logical coordinates using its pixel ratio
and restores both rectangle and enable state before UI/other host rendering.

## Lifecycle, snapshots and host layers

`set` atomically replaces a complete batch. Identical descriptors and bytes keep
the existing revision and immutable payload storage. Invalid updates leave the
old batch intact. Effective updates and remove/recreate use a world-monotonic
revision; snapshot reads do not consume it. Missing remove IDs raise
`PROJECTED_MISSING`. A scene load clears batches and restores world visibility.

`WorldSnapshot.projected_geometry` contains format
`f32le-clip4-uv2-rgba4-u32-v1`, texture, order, depth flags, vertex/index counts,
base64 vertex/index payloads, material policy and revision. Encoding caches share immutable
storage. These bytes participate in canonical snapshots/digests; this differs
from the older instances3d pose transport. Renderer cache keys are ID/revision.

`setWorldVisible(false)` suppresses normal world3D mesh, instance, heightfield
and particle submissions, while retaining all simulation data. Projected batches,
ordinary2D sprites and UI remain available. It does not delete entities or fields.
Default true is omitted from canonical JSON; false appears as
`projected_world_visible:false`.

## Viewport and picking

`getViewport()` returns physical render-target`width`, `height`, `aspect` and
monotonic`revision`. Headless defaults are1280x720/revision1. A host may provide
`HostProject.viewport_size=[width,height]` before Game.start; physical size takes
precedence over the legacy aspect-only value. Runtime hosts update through
`EngineRuntime.set_viewport_size`; dimensions must be1..32768. No-op sizes keep
revision. This API does not advance simulation or rewrite game geometry.

Native supplies requested dimensions before start and actual surface dimensions
after window creation/resize. The official Web player supplies drawing-buffer
dimensions, including its capped device pixel ratio; its viewport ABI fails
explicitly when paired with an older Web runtime. Legacy aspect-only hosts must
be updated before claiming physical-pixel projector support.

Game picking must use the same projector, viewport and view revision as rendered
geometry. An ordinary perspective ray is not automatically an inverse for a
nonlinear or integer projector. The engine does not silently substitute a ray.

## Color and backend boundaries

Textures use the existing sRGB image pipeline. `color_mode="linear"` (default)
multiplies decoded linear texture RGB by vertex RGB. `color_mode="encoded"`
converts the sampled linear RGB back through the standard sRGB transfer,
multiplies encoded RGB by vertex RGB, then decodes the result to linear output.
The sRGB surface encodes final output. For an exact texel128/255 and vertex128/255,
encoded mode yields about64/255 on the surface; linear mode yields about93/255.
Alpha is always a linear coverage value, multiplied independently of RGB.

`filter="nearest"` (default) or `"linear"` selects both minification/magnification
without mipmaps. `sampling_space="linear"` (default) interpolates decoded linear
texels. `sampling_space="encoded"` with linear filtering loads all four texels,
converts each RGB to encoded sRGB, interpolates them, then decodes the result.
This is independent of color_mode. Alpha always interpolates linearly without
an sRGB transfer. Nearest sampling is identical for either sampling_space.

`address_mode="clamp"` (default) clamps to edge; `"repeat"` wraps each axis.
Encoded bilinear applies that policy to each neighbor, including negative UVs
and seams at0/1. Reference coordinates are `uv*textureDimensions-0.5`; pixel
centers sample exact texels. Three clones sampler textures while
sharing immutable image data; changing one batch never changes other materials.
Native uses separate material samplers with the shared image bind group.
`alpha_cutoff` is finite0..1 (default0.05); multiplied alpha strictly below the
cutoff discards before depth writes. Survivors output opaque alpha1. Cutoff0
also retains alpha0 pixels; cutoff1 retains only exact alpha1.

There is no blendlist, tone mapping, fog or lighting in this bounded opaque/cutout
material. Unknown blend fields fail validation. Native converts official V to`1-V`;
Web uses official image flipping. Encoded mode is an explicit modulation policy,
not proof of complete legacy fixed-function precision. Encoded-space bilinear
and modulation are explicit policies. Integer rounding, dithering and original
driver blend modes still need separate fixtures and GPU evidence. The manual
bilinear path requires WebGL2 texelFetch; unsupported WebGPU hosts fail closed.

Windows native and official Three WebGL implement this bounded contract.
Three WebGPU and raw WebGPU reject nonempty projected geometry or world suppression
with`PROJECTED_BACKEND_UNSUPPORTED`. Do not silently render those batches through
the normal camera. On Three WebGL, projected geometry plus visible world3D and
Bloom is explicitly rejected because the default framebuffer does not share the
offscreen world depth attachment. Hide normal world3D or disable Bloom. Projected
draws occur after the normal world/postprocess and before UI.

## Verification and implementation review

Core tests execute real Luau for payload validation, atomic/no-op updates,
revision recreation, budgets, visibility and host dimensions. Native tests parse
and validate the actual WGSL using Naga, and verify sorted submission evidence
including SHA256 of uploaded source bytes. Web tests use actual Three geometry
and materials plus lifecycle/unsupported-backend tests. Native reports expose
`kind:projected` rows with vertex/index hashes; compare those to game-owned bytes.
Native computes these hashes only when emitting the final report, outside the
render timing window. `projected_buffer_bytes_last_frame` reports retained
geometry buffer capacity. Removed batches release their buffers. Capacity reuse
allows up to twice the active payload (a 4 MiB floor), capped at the world's
64 MiB live-payload limit; crossing that budget compacts oversized buffers.
This bounds retained resources while avoiding reallocations for ordinary count
fluctuations. The opt-in native GPU rotating-batch test checks actual buffer
sizes, zero uploads on unchanged frames and release after removing every batch.
CPU tests alone do not establish GPU pixel equivalence. An actual official-player
capture of asymmetric UV/color/depth triangles is the next host-boundary gate.

Web packaging also validates the complete local dependency closure before it
creates an output directory: static imports/re-exports, literal dynamic imports
and literal `new URL(path,import.meta.url)` resources must exist in the export.
Queries/fragments resolve to the same packaged file; directory escape is rejected.
The official full/minimal export regression tests exercise the transformed files,
not just WEB_FILES text. Explicit dynamic custom-renderer URLs still use the
declared renderer_files inventory. A Node WASM parity pass alone cannot prove
browser boot; missing player-input/presentation dependencies previously passed
that narrower test and were found by the real browser GPU gate. Preserve that RED.

Implementation is separated into Core model/validation, Luau marshaling, native
resource adapter/shader, portable Web validation and Three resources. New modules
stay below600 lines; substantial new methods stay below60. Existing large native
and Three orchestrators receive hooks only and remain review debt. No Spatial/VFX
worktree code was reset or replaced. Preserve the RED logs and toolchain failures:
debug Windows cdylib tests can exceed export ordinals, so use release tests;
the installed Emscripten LLVM requires Binaryen131 rather than its older113
wasm-opt for`--enable-bulk-memory-opt`.


## Alpha predicate

`alpha_compare = "greater_equal" | "greater"` is optional. The default keeps the
existing cutout rule: sampled texture alpha times vertex alpha passes when it is
greater than or equal to `alpha_cutoff`. `greater` discards equality as well. The
reference remains a finite float in 0..1 (default 0.05); there is no byte
quantization or epsilon, and blend/depth/clip policy is unchanged. Unknown values
fail before mutation. Changing only the predicate advances the batch revision;
repeating the same predicate does not. Explicit greater_equal and omission are
equivalent, and the default field is omitted from serialized snapshots to retain
legacy observation payloads. Nondefault snapshots require synchronized new
Core and official Native/Web adapters; old adapters reject the unknown field.
