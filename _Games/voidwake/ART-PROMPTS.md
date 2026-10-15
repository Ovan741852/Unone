# Image generation provenance

All game artwork in `assets/` was generated with the built-in `image_gen.imagegen` tool on 2026-10-15. No SVG artwork, drawn replacement sprites, procedural raster art, external stock image, cropping, recoloring, or alpha extraction was used. The final files are unmodified copies of the generated PNGs, preserving source alpha. CSS and shader effects operate at runtime and do not replace these artworks.

## Assets

| File | Purpose | Background |
| --- | --- | --- |
| `nebula.png` | Deep space background | Opaque |
| `player.png` | North-facing player fighter | Transparent alpha |
| `enemy.png` | North-facing hostile corvette | Transparent alpha |
| `boss.png` | North-facing capital battleship | Transparent alpha |
| `asteroid.png` | Asteroid obstacle | Transparent alpha |
| `explosion.png` | Fireball burst effect | Transparent alpha |

## Exact prompts

### nebula.png

Tool: `image_gen.imagegen`; `transparent_background: false`.

Original output: `imagegen-output/01a13eaa-dcec-7433-ade9-7301954d2501/exec-31d4f15c-dc2b-4a16-b802-58c826b9acd4.png`.

Final project path: `assets/nebula.png`.

```text
Use case: stylized-concept
Asset type: photographic background raster for a realistic top-down 2D space roguelike game
Primary request: Cinematic panoramic outer space, a colossal desaturated teal nebula suspended in deep black space, a distant small warm amber planet on the far right.
Style/medium: Realistic astrophotography, physically plausible cosmic dust, subtle volumetric gas, restrained high-end science-fiction film realism.
Composition/framing: Very wide horizontal panoramic landscape 16:9. Nebula concentrated along left and upper edges, right planet partially in shadow; center remains dark and spacious for tiny combat sprites. Plenty of clean dark negative space throughout.
Lighting/mood: Moody subtle cold teal, black-blue shadows, distant amber rim illumination.
Constraints: Single continuous environment image. No spacecraft, no people, no text, no symbols, no UI, no borders, no logos, no watermark. Avoid bright busy starfield, avoid cartoon, no vector artwork.
```

### player.png

Tool: `image_gen.imagegen`; `transparent_background: true`.

Original output: `imagegen-output/01a13eaa-dcec-7433-ade9-7301954d2501/exec-fb3a895e-bba0-4f6c-96f3-5c41f76e809a.png`.

Final project path: `assets/player.png`.

```text
Use case: stylized-concept
Asset type: transparent PNG ship sprite for a realistic top-down 2D space roguelike game
Primary request: ONE realistic compact gunmetal starfighter, nose points straight to the top of the image (north), narrow pointed armored nose, broad swept wings, two rear engine housings, tiny restrained teal navigation lights.
Style/medium: Photorealistic practical spacecraft miniature photographed from directly above, crisp weathered dark steel, readable high contrast panel seams, subtle mechanical details.
Composition/framing: Strict overhead orthographic top view with zero perspective, zero tilt, no side profile. Ship centered in a square canvas, occupies about 80 percent of height and width with clear margin. Ship's entire silhouette visible.
Lighting/mood: Neutral overhead studio key light, subtle teal highlights. No attached ground shadow.
Scene/backdrop: Actual transparent alpha background around isolated spacecraft; no opaque backdrop, no checkered backdrop.
Constraints: One ship only, no environment, no platform, no text, no labels, no symbols, no HUD, no borders, no logos, no watermark. No vector, no cartoon. Tiny engine lights only, no long exhaust trails. Preserve genuinely transparent background.
```

### enemy.png

Tool: `image_gen.imagegen`; `transparent_background: true`.

Original output: `imagegen-output/01a13eaa-dcec-7433-ade9-7301954d2501/exec-136dc879-8ba3-49b9-8c2b-b85fc332389a.png`.

Final project path: `assets/enemy.png`.

```text
Use case: stylized-concept
Asset type: transparent PNG enemy spacecraft sprite for a realistic top-down 2D space roguelike game
Primary request: ONE hostile compact military corvette, gunmetal armored hull with worn dark rust-red armor accents, angular forked swept wings and powerful rear engines, aggressive pointed nose points straight to the top of image (north). Tiny red navigation lights.
Style/medium: Photorealistic practical spacecraft miniature photographed from directly above; worn metal paneling, crisp silhouette, realistic machinery and hull plates.
Composition/framing: Strict overhead orthographic top view, zero perspective, zero tilt. Entire ship centered in square canvas occupies approximately 80 percent, clear margin all around.
Lighting/mood: Neutral overhead studio key light; restrained dim red lights. No ground shadow.
Scene/backdrop: Actual transparent alpha around the isolated spacecraft, no opaque background, no checkered backdrop.
Constraints: One ship only. No environment, no platform, no text, no HUD, no symbols, no borders, no logo, no watermark, no long exhaust. No cartoon, no vector. Preserve genuine transparent alpha.
```

### boss.png

Tool: `image_gen.imagegen`; `transparent_background: true`.

Original output: `imagegen-output/01a13eaa-dcec-7433-ade9-7301954d2501/exec-be7cb6d1-cbe8-4db3-b1a3-89cb1239584e.png`.

Final project path: `assets/boss.png`.

```text
Use case: stylized-concept
Asset type: transparent PNG boss battleship sprite for a realistic top-down 2D space roguelike game
Primary request: ONE imposing wide capital battleship, broad bilateral heavy armored gunmetal wings, chunky armored prow facing straight north/top, symmetrical turrets built into the hull, central recessed glowing orange reactor, several stern engines. Dark aged metal, realistic industrial science-fiction design.
Style/medium: Photorealistic practical spacecraft miniature photographed directly overhead, exceptionally readable paneling, battle wear and steel texture.
Composition/framing: Strict overhead orthographic top view, zero tilt and zero perspective. Wide balanced silhouette, entire ship centered within a square canvas with margin, ship occupies around 82 percent of width.
Lighting/mood: Neutral overhead studio light, restrained amber reactor and orange engine lights. No ground shadow.
Scene/backdrop: Actual transparent alpha background around isolated battleship, no opaque backdrop and no checkerboard.
Constraints: One ship only, all turrets integrated into same ship. No environment, no platform, no text, no labels, no HUD, no border, no logos, no watermark, no long exhaust. Not cartoon or vector. Genuinely transparent alpha.
```

### asteroid.png

Tool: `image_gen.imagegen`; `transparent_background: true`.

Original output: `imagegen-output/01a13eaa-dcec-7433-ade9-7301954d2501/exec-2eeab59e-fe7b-4e52-84d4-4bc901b30c0f.png`.

Final project path: `assets/asteroid.png`.

```text
Use case: stylized-concept
Asset type: transparent PNG asteroid sprite for a realistic top-down 2D space roguelike game
Primary request: ONE isolated irregular roughly rounded asteroid, jagged dark charcoal rock with realistic impact craters, chipped mineral faces, sparse subtle warm brown iron seams, naturally uneven outer silhouette.
Style/medium: Photorealistic space rock, high-resolution natural rocky texture, realistic pores and fracture shadows.
Composition/framing: Direct overhead orthographic view, centered on square canvas, fills 80 percent with comfortable clear margin all around. No perspective ground plane.
Lighting/mood: Directional cool neutral light from upper left, dark shaded crevices, shape readable on dark space. No cast shadow outside rock.
Scene/backdrop: Actual transparent alpha background, isolated object with clean irregular edges, no opaque or checkerboard backdrop.
Constraints: One asteroid only, no stars, no space environment, no platform, no text, no UI, no border, no logo, no watermark. No cartoon, no vector. Preserve actual alpha transparency.
```

### ui-panel.png — official player migration

Tool: built-in `image_gen.imagegen`; `transparent_background: false`.

Original output: `imagegen-output/01a13ea6-e5f4-7103-a54c-bda6e9ac57ee/exec-ed690d4f-5773-4500-a954-411ee55cfa94.png`.

Final project path: `assets/ui-panel.png`.
Used through official semantic image nodes with nine-slice borders; all text is
real UI text placed over this generated PNG.

```text
Use case: ui-mockup. Asset type: a single production game UI blank panel texture PNG for a realistic top-down deep-space spaceship roguelike, to be used behind real text in the official engine. Generate exactly ONE flat rectangular panel filling the entire image, landscape aspect about 3:2, front orthographic, no perspective. Extremely dark midnight blue-black matte aerospace composite interior, softly translucent-looking smoky glass but opaque output, subtle fine realistic metal grain, very thin muted warm amber/brass perimeter hairline inset 2 percent, small precise mechanical clipped corners, sparse tiny serial ticks ONLY near corners, subtle dim cyan ambient rim on right. Center 85 percent is perfectly quiet uniform dark blank negative space for UI text. Elegant restrained sci-fi NASA industrial typography aesthetic but absolutely NO letters, NO words, NO numbers, NO logos, NO icons, NO pictures, NO ships, NO decorative busy grids, NO drop shadow outside panel, NO watermark. All edges fully visible and aligned, fill entire image with panel, realistic material, not cartoon. This will be stretched behind game menu/HUD/cards.
```

### explosion.png

Tool: `image_gen.imagegen`; `transparent_background: true`.

Original output: `imagegen-output/01a13eaa-dcec-7433-ade9-7301954d2501/exec-2cee5ccc-10d6-4e19-b98f-ea21c9270f21.png`.

Final project path: `assets/explosion.png`.

```text
Use case: stylized-concept
Asset type: transparent PNG explosion effect sprite for a realistic top-down 2D space roguelike game
Primary request: ONE compact circular incandescent orange fireball explosion seen overhead, bright white-hot central core graduating to amber and burnt orange flame, soft wispy smoke fading away to full transparency, realistic turbulent plasma and subtle few sparks.
Style/medium: Photorealistic cinematic visual effects, convincing incandescent fire and wispy smoke, natural irregular rounded silhouette.
Composition/framing: Direct overhead centered in square canvas, explosion fills around 75 percent, clear transparent margin. One instantaneous explosion burst.
Lighting/mood: High luminous hot core, warm orange fringe, transparent wispy smoky edges. No environment.
Scene/backdrop: Actual transparent alpha background around the effect, transparent outside soft natural irregular contour, no opaque black background and no checkerboard.
Constraints: No objects, no ship, no background, no plane, no text, no UI, no border, no logos, no watermark. No vector, no cartoon, no spherical solid ball. Preserve genuinely transparent alpha.
```
