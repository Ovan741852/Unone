# 0053: UI image owners in the shared texture cache

Status: implemented; source review and Node validation passed. Actual official
Web rendering and Game performance acceptance are pending.

UI image textures previously belonged to the current composition. Removing the
last leaf disposed its texture even when the configured renderer cache could
have retained it. The composition's decoded-image lease also ended. A later
composition could therefore need both another decode and another GPU upload.
This is a reusable renderer ownership requirement; game navigation, streaming
choices, asset selection and visibility rules remain authored gameplay.

The reference model is shared resources with explicit lifetime: Godot returns
cached resource references and releases resources when their references end.
[Godot Resource documentation](https://docs.godotengine.org/en/stable/classes/class_resource.html)
Unity Addressables likewise pairs load/release ownership and documents the
release/immediate-reload churn this design avoids.
[Unity memory-management documentation](https://docs.unity.cn/Packages/com.unity.addressables@2.3/manual/MemoryManagement.html)
Unone adds its existing bounded idle grace to this model; neither reference
implies a hard process-memory cap or prescribes Unone's particular budget.

Use the existing renderer `textureCache` controller for UI image physical
owners as well as world asset textures. An owner holds its own ready decoded
image lease and its GPU texture. Its identity includes the trusted broker and
catalog scope, exact asset ID and the UI sampler domain. Several UI leaves may
share this owner. A world sprite using different color-space or sampler state
requires its own physical texture, even when both textures share decoded pixels.
Glyph atlases, data textures and render targets remain separate resources.

Owners used by the last successful UI rebuild stay pinned across unchanged
draws. An image that leaves that composition becomes idle under the same byte/count/renderer-frame
policy as world owners. Reclamation removes the lookup first, detaches any run
to the white texture, disposes the GPU texture and finally releases its decoded
lease. Context loss, catalog/broker replacement, reset and teardown must retire
the appropriate scope without making a retired owner available to reentrant
acquisition. Helpers without the trusted shared provider retain an explicit
immediate-retirement path.

The controller provides idle reclamation, not hard total-memory admission.
Protected active/prepared/persistent owners may exceed its configured budget;
those bytes must remain visible as pressure. A UI owner's decoded lease is an
active broker lease, so the broker's unused-image limit does not bound those
pixels. Reporting GPU estimates and broker residency separately avoids claiming
a process-memory cap or counting shared decoded pixels as additional GPU owners.

The observed game working set makes this distinction concrete. Eight known
images across two map compositions have an RGBA estimate of 68,409,216 bytes
(65.24 MiB), above the authored 64 MiB renderer budget before other owners. This
is a union, not evidence that all eight are simultaneously active. The 32 MiB
atlas alone also exceeds the broker's 16 MiB unused-image limit. Twelve observed
ready/release/loading recurrences and 46 synchronous ready hits prove both
misses and reuse; those misses alone do not prove the previous bounded decoded
policy was incorrect.

Increasing only the decoded idle budget was rejected as the primary fix because
it leaves GPU recreation untouched. A separate UI texture budget was rejected
because it would allow independent caches to each consume the declared limit.
Unlimited retention, changing game content and treating genuine pending images
as ready do not satisfy this ownership requirement. Any authored budget change
must be assessed separately from this engine change.

Acceptance must cover exact identity, active pins, shared leaves, true cold
loading, short hide/show reuse, budget and TTL retirement, failure cleanup,
context/reset and reentrancy. Actual official Web main/worker rendering and the
game's seven-scene FPS/GC/memory gates remain separate checks. Windows Native
final execution remains blocked by Windows App Control 4551.

Exact final hashes, negative controls, 96 focused passes, the full Node result
(902 passes, 5 skipped, no failures), and the two incomplete external review
attempts are preserved in [the source evidence](../evidence/2026-11-03-shared-ui/ui-image-cache-source.json).
