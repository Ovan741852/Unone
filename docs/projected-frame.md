# Ordered encoded-RGB reference Frames

`api.projected.setFrame(frame)` atomically publishes a complete ordered reference
Frame. It is separate from legacy `projected.set`; the two owners cannot mix.
The game owns projection, source formats, original flags, UV conversion and
initial-content provenance. This API provides no original-game GPU guarantee.

Official Web construction requires:

```json
{"renderer_mode":"official","antialias":false,"bloom":false,
 "projected_raster":"upper_left_checked",
 "projected_material_profile":"rgb8_encoded_rebuild_v1"}
```

AO must remain off. Native, custom and WebGPU reject this explicit profile.
Omission preserves legacy materials, raster defaults and ordinary world3D/UI.
`Game.start` must hide world3D explicitly and publish a Frame, even an empty one.
Profile validation does not change game flags or supply a game Frame.

```lua
api.projected.setWorldVisible(false)
api.projected.setFrame({
 profile="rgb8_encoded_rebuild_v1",
 initial={rgb8={20,40,60},depth=1},
 draws={},
})
```

`initial.rgb8` has exactly three integers 0..255: raw encoded RGB. `depth` is
normalized 0..1. Each redraw rebuilds this known destination and every ordered
draw into an RGBA8 UNORM/depth32float single-sample target, then copies all RGB
to the default framebuffer. It never accumulates the previous RAF's blend.
Nonuniform backdrops require every predecessor draw. Arbitrary existing RGB or
depth import is unsupported; source depth-only clear markers do not imply RGB.

Each draw requires unique `id`, `texture`, `vertices`, `indices`, `clip_policy`,
`material`; physical top-left `scissor` is optional. The 40B f32LE clip4/uv2/RGBA4
and u32 indices are unchanged. Indexed W must be exactly1, z and all RGBA must
be0..1, and each indexed triangle's RGBA bits must match. `clip` permits XY
outside; `inside` requires XY within[-1,1]. The game converts source TL depth
to0..W once; Web maps it to-1..1 once. UV keeps the existing asset flipY/official
bottom-origin convention; this material variant introduces no extra UV flip.

Material fields are all required and closed:

```lua
{
 rgb="texture_times_vertex", texture_alpha="sampled", alpha="texture",
 alpha_test={enabled=true,compare="greater",reference=127/255},
 blend={enabled=true,operation="add",source="source_alpha",
        destination="one_minus_source_alpha"},
 depth={test=true,write=false,compare="less_equal"},
 sampler={min="nearest",mag="linear",address_u="repeat",address_v="clamp"},
}
```

`texture_alpha` is `sampled|one`; the caller chooses `one` for a source format
without alpha, independently of PNG transport. `alpha` is `texture|vertex|
texture_times_vertex`. Compare choices are never/less/equal/less_equal/greater/
not_equal/greater_equal/always. Alpha-test enable/ref are independent of RGB
blending and depth. Reference is normalized f32, without hidden u8 quantization
or epsilon. Disabled depth with writes is explicitly unsupported in this first
profile; other test/write pairs retain independent comparison/write controls.

RGB is raw sampled encoded RGB times vertex RGB. Blending is RGB ADD with
source factor As and destination factor1 or1-As; enabled=false replaces RGB.
Source alpha remains real alpha through the fragment shader. Target alpha is
not destination alpha or a coverage marker; the final copy forces output A=1
and copies alpha0 fragments' RGB. Alpha/depth failures do not change RGB; alpha
discard does not write depth. Each store is RGBA8, not original16bit/dither.

Sampler min/mag and U/V are independent, single mip only. New variants use
NoColorSpace/raw encoded RGB, straight alpha and premultiply=false while
preserving the asset's flipY. They do not mutate ordinary-world textures.
Full uploads/PNG decoder exactness require actual asset GPU validation; the
neutral DataTexture gate does not certify all browser image decoders.

All nested unknown keys, sparse sequences, invalid buffers, duplicate IDs and
budget overflow reject the entire publication before world mutation. Limits
allow1024 ordered draws;262144 vertices/1572864 indices per draw;
1048576 vertices/6291456 indices per Frame. Physical targets are8..8192 per axis,
at most16M pixels and within GPU limits. Empty draws still reconstruct initial
contents. Scene reset removes the owned Frame; there is no implicit mix with
legacy batches. To show an empty Frame publish the same initial with draws={}.

The ordered-frame draw capacity is independent of the legacy256 batch-map limit.
The Luau binding, core constructor and Web snapshot decoder share the1024 bound;
all global and per-draw geometry budgets remain unchanged. Large valid base64
transport uses the previous alphabet/padding shape policy with a linear scan,
avoiding grouped-regexp stack growth at the existing per-draw byte limit.

Input buffer bytes are detached and compared exactly, including signed zero.
Scalar depth/reference are range-checked, converted to f32 and normalize-0 to+0;
the Web decoder applies Math.fround to JSON scalars. Same canonical payload,
byte-identical buffers and order are a revision no-op. Engine frame revision,
GPU context/target generations and game source content epochs are distinct.
Frame revisions above Number.MAX_SAFE_INTEGER serialize as lossless decimal
u64 strings; smaller revisions remain JSON numbers. The decoder rejects unsafe
numeric revisions. A new CoreWorld can restart at revision1: renderer caches
also compare canonical draw content, and content changes revoke the private
completed-game token even while new textures are pending. Only a completed
new pass restores proof. These identities are not source epochs.

Correctness currently validates and decodes every incoming Frame's base64 on
each redraw and compares canonical content for restart safety. This is a known
CPU/allocation cost; future caching must preserve validation and content identity.

Before READY and after target/context changes, official Web runs the existing
919-sample raster gate plus47 new fixed cases/1028 samples through the actual
Frame pass. Actual FBO attachment bits/types, completeness and single-sample
state are queried; a separate2x1 query target encodes actual color/depth
textureSize for readback. Initialization RGB/depth is tested at all four corners.
Failure is explicit unsupported; old validation is revoked on loss. The r3
event-driven startup policy remains; completed-game tokens additionally name
material profile and Frame revision. Constructor failures remain terminal.

Metrics use the existing visible `data-player-raster`, `data-player-metrics`,
`UNONE_RASTER_STATE` and READY diagnostics. `raster.projected` reports profile,
frame_revision, capability status/epoch/generation and `frame_target.attachment`
(actual formats/physical sizes/query method). Lifecycle notifications may
precede game drawing; use current READY metrics' completed_game_draw token.
UI remains an ordinary separate pass. World3D depth sharing, incoming targets,
MRT/destination import, RHW!=1, nonconstant triangle colors, fog/specular,
source target alpha, native precision/dither/MSAA and full original Frame
lifecycle are outside this reference profile.

GPU failures include a stage name and hexadecimal GL error. A pending error at
entry also fails closed; it is never drained and treated as success. Attachment
queries, allocation/binding, validation cleanup and ordinary rendering have
separate diagnostics, so an upstream error is not misreported as a format fault.
The ordinary renderer's asynchronous GPU timer reacquires its extension after
context restoration and discards all prior-epoch query handles and timings.
Missing timer support disables measurements without disabling drawing. Timer
context epoch/loss/pending state is visible in the existing Bloom diagnostics;
it is independent of Frame revision and game source epochs.

## Affine Gouraud profile

`rgb8_encoded_gouraud_v1` explicitly permits distinct normalized RGB and alpha at
each indexed vertex. With required W=1, the official shader interpolates all four
channels affinely before modulation, alpha admission and RGB blending. It retains
the same complete rebuild, encoded RGBA8/depth32float, sampler, clipping, target,
budget and host constraints. This is a reusable rendering primitive, with no game
rules or source-palette selection in the engine.

Declare that exact value in both `frame.profile` and
`presentation.projected_material_profile`; a mismatch fails. Old
`rgb8_encoded_rebuild_v1` still rejects varying triangle RGBA. Switching profiles
is a publication change even for byte-identical constant geometry. Both profiles
remain WebGL2-only, checked raster, AA=false, Bloom/AO off and world3D hidden.

The Gouraud profile adds four fixed GPU cases (32 samples) for interpolated RGB,
alpha test, source-alpha over and additive blending to all previous Frame/raster
checks. These compare to independent barycentric reference values within one
RGB8 unit and do not certify an original game's GPU precision or dithering.
