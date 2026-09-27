# Settings skin, v5

Mode: Operate. Keep the approved illustrated forest / old-brass identity.

Visual references inspected:
- Hades settings: https://interfaceingame.com/screenshots/hades-settings/
- Baldur's Gate 3 audio settings: https://www.sportskeeda.com/esports/baldur-s-gate-3-settings-need-change

Applied observations: readable labels and values aligned in rows; slim sliders
with visible filled/unfilled portions; restraint within each control; decorative
weight at the outside of the window. No reference artwork was copied into the game.

The four controls now share a centered settings window. Music/SFX form one group;
quality/language form the next. Existing game art remains visible behind the panel.
The sliders retain large input regions while their tracks are visually thin.
This is authored composition, not a new automatic layout rule.

The v6 close button reuses the field's nine-slice skin in a square footprint.
Its separate X image stays contained; the Luau button owns the same bounds as
the artwork, without the former settings-specific browser position override.
The old stretched acorn plate is no longer used for this control. A live click
was verified to return to the main menu.

## Asset provenance

Built-in Imgen generated `assets/formal-ui/settings-field-v5.png`.
The source image is unchanged; the engine's nine-slice source rect excludes its
transparent padding. No local raster editing or alpha replacement was performed.

The rail, fill, section divider and selected-option band are simple native SVG
geometry. The handle reuses the previously generated amber image. Values, arrows,
handle position and fill width are composed at runtime, not baked into the frame.

Final generation prompt:

> Create ONE production game-UI skin asset, not a screenshot or mockup. A blank horizontal selection field for a painterly fantasy roguelike settings menu. The game uses faceted storybook illustrations, midnight pine-green fabrics, parchment text, aged warm brass. Draw a restrained rectangular field with slightly chamfered corners, a THIN irregular hand-painted aged-brass outline and a quiet deep blue-green ink interior. Understated graphic edge highlights, no shiny 3D bevels. Broad flat painted color shapes, sparse subtle brush strokes ONLY near the edges; smooth quiet center for text. The field should feel elegant and tactile, like an inset strip in a dark illustrated folio. Front-facing perfectly orthographic. One uninterrupted interior, no sections. 3:1 landscape canvas, with the actual single field a roughly 5:1 rectangle centered, only narrow transparent padding. Real transparent alpha background OUTSIDE the field; interior opaque. No text, letters, numbers, arrows, handle, slider, crest, logo, acorns, leaves, jewels, vines, metal spikes, extra icons, glow, drop shadow, checkerboard, white background, or other objects. Edge artwork must fit in shallow margins for nine-slice scaling. This is a single replaceable blank UI frame asset, never a complete composited control.

## Verification

- Slider drag and both endpoints (0% and 100%); fill remains valid at zero.
- Whole-field dropdown clicks, selection, outside/Escape dismissal, persistence.
- Keyboard list navigation and focus return.
- Popup input does not modify the slider underneath it.
- Closed/open states at 1440×900 and 844×390; dev dock closed for visual inspection.
- Screenshots: `tests/combobox-controls/settings-*.png` and `language-*.png`.
- No Rust rebuild or new engine capability is part of this visual change.
