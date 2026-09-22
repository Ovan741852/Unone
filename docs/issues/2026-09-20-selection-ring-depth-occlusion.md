# Selection ring depth occlusion

## Report

The wuxia town selected-resident ring rendered over the resident mesh. The reference image showed the yellow ring crossing the character's body instead of being occluded by the nearer geometry.

## Finding

This was not a native Unone depth-buffer failure. The town viewer created its presentation-only `RingGeometry` with `MeshBasicMaterial({depthTest:false})` and a high render order, explicitly forcing it over scene geometry.

## Fix

The viewer ring now uses depth testing, keeps depth writes disabled, and applies a small polygon offset so it stays above the ground without drawing through the selected resident. The fix is local to the viewer presentation layer; gameplay and engine ownership are unchanged.

## Verification

- Viewer source syntax and existing camera/label/status checks pass.
- The selected resident is visible in front of the rear portion of the ring in the browser screenshot.
- No native runtime, model, OBS context, or live world was changed while applying this fix.
