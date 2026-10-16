# VOIDWAKE official responsive UI and layered effects

Date: 2026-10-16. Baseline: `074eca18cab0d2bb7f2655108b9427a72bfde44d`
on `main`; this record covers the subsequent working tree.

## Ownership and behavior

The maintained game under `_Games/voidwake` uses the official `@unone/ui` 0.4.0
package, retained `createResponsiveLayout` models and the ordinary production
player. Game-authored semantic regions and aspect variants preserve the desktop
art direction, give the portrait showcase a separate region, stack upgrade
cards and expose touch controls. The presentation reads the same authored
variant values as the View. No alternate renderer, HTML UI, graphics context,
game-specific engine branch or package modification implements this layout.

Directional plumes, afterburners, projectile trails, impact sparks, independent
debris, embers and smoke use native declarative particles. Sprite materials,
shield ripples, dash echoes, plasma detail and the nebula use the official
Shader API and Bloom. Separate visual seeds leave gameplay RNG unchanged.
Fixed pools and conservative reservations limit presentation resources.

The two new transparent PNG assets were generated with ImageGen. Exact prompts,
generation paths and alpha checks are in
[ART-PROMPTS.md](../../_Games/voidwake/ART-PROMPTS.md). These are single images,
not Sprite Sheets or Flipbook animation. The explosion image is a 12-frame
accent; independently moving native particles provide the longer dynamics.
The current native particle schema has no texture-atlas/Flipbook contract.

## Findings corrected during acceptance

- An authored fixed-child overflow in the introduction was corrected within
  the game model. Core layout bounds and overlap policies remain strict.
- The old portrait ship could cover story text. The new named showcase region
  separates the title, hull artwork and copy; desktop positions remain authored.
- Replacing every sentence ending with a newline left an empty final line in
  upgrade descriptions. Trimming that line and allocating four portrait units
  prevents the centered description from clipping. The real-View geometry
  regression checks line count and authored line height.
- New touch instructions required three more CJK glyphs. Separate supplemental
  faces were rebuilt from the existing hash-pinned licensed source. Original
  font faces remain unchanged; all authored non-ASCII characters are covered.
- Large soft-disc exhaust and quantized blue smoke looked like beads. Narrow,
  aligned native streaks and neutral smoke endpoints improve their appearance
  without changing their particle counts or lifetimes. Wave materials retain
  the generated electrical detail. Actual GPU screenshots then exposed broad
  overlapping native annuli and the positive-alpha quantization floor. Five
  large ring emitters were removed from EMP/explosion declarations; independent
  particles and the generated narrow Shader wave front remain. Conservative
  birth prechecks remain above the reduced actual birth counts. UI, gameplay,
  runtime, font and art bytes remain identical across this last data-only tune.
- Native/Web exact parity exposed one-ULP JSON publication loss. Pure Luau
  arithmetic was bit-identical. The shared engine now enables accurate JSON
  float roundtrips; no project coordinate rounding or weaker comparison was
  introduced. See the independent reproduction and focused regressions in
  [the shared transport issue](../issues/2026-10-16-web-json-float-roundtrip.md).

## Validation and review boundaries

The source-only geometry regression executes the real official package and
actual game View: 1,940 checks across seven aspects and six phases. It verifies
action separation, portrait art allocation, upgrade order and description line
height. Geometry checks alone do not establish rendered appearance.

Particle validation samples all 61 definitions, 16 selected effect/time cases,
and 48 directional variants with 672 sampled positions. No sampled exhaust
position lies ahead of the ship. Direction sampling is deterministic metadata
evidence, separate from real GPU drawing. The scene declares 59 materials and
77 sprite entities, with reservations below the native resource limits.

Final validation is preserved in the
[evidence manifest](../evidence/2026-10-16-voidwake-responsive-fx/validation.json):

- Release workspace: 490 passed, zero failed, three ignored; strict workspace
  Clippy and the matching CLI/production WASM build passed. Three focused JSON
  precision regressions also passed; they are included in the workspace count.
- The frozen SDK has 68 verified inventory files and 17 byte-identical shared
  package/type/documentation sources, independently checked by another reader.
- Final official preparation passed all seven normal gates, including ten
  deterministic game cases. Exported Native/Web parity matched all ten cases
  with the corrected JSON transport and final scene.
- The full matching-runtime browser route passed 159 checks at 1440×900,
  1020×884 and 390×844, including real input, live orientation changes, naturally
  reached upgrade/result screens, selection and Restart, fonts and actual GPU
  particles. Its scene predates removal of the five broad native annuli.
- After that scene-only polish, 42 affected browser checks passed. The script,
  configuration, camera, entities and menu UI stayed identical; all 62 runtime,
  player, font and art files matched. The full natural-sector route was not
  falsely attributed to this later release. Final release:
  `7a1e2a7daac5ab2c62f1a90c9baf97b340875e873eaac8ae9f8955083e583de1`.
- Ordinary PNG screenshot acquisition advanced 18–43 simulation frames and
  missed short effects. A separate continuous CDP screencast captured 678
  genuinely presented, unedited JPEG frames. Selected desktop and portrait
  frames show the clear electrical rim and its growth/fade. Actual explosions
  at ages 22–37 frames had hidden blast PNGs but live native cooling embers,
  residual smoke and, in the desktop/portrait samples, metal shrapnel.

See the [continuous-frame manifest](../evidence/2026-10-16-voidwake-responsive-fx/browser-filmstrip-manifest.json),
[desktop EMP frame](../evidence/2026-10-16-voidwake-responsive-fx/polished-desktop-0075.jpg)
and [portrait EMP frame](../evidence/2026-10-16-voidwake-responsive-fx/polished-portrait-0080.jpg).
Preliminary exports, initial failures and their corrections remain labeled
separately. Large raw browser reports remain in ignored local artifacts;
committed compact records retain their hashes and every assertion.
The browser harness reads production observations, forwards actual WebGL calls,
and uses physical pointer/keyboard input without injecting game state. Its
screenshots are separate visual evidence; browser viewport checks are not
physical mobile-device acceptance or a hardware performance benchmark.
The actual context was NVIDIA GTX 1650 via ANGLE/WebGL2. The instrumented full
route reported dropped simulation steps and roughly 16 ms WASM p95 plus
8–11 ms render p95. Those measurements do not establish sustained 60 FPS.
Presentation reservations stayed within their bounds with no sampled cosmetic
drops; resource-budget compliance and frame rate are separate claims.

The prescribed independent Claude fixed-diff attempts are recorded with raw
output and exact scope. A timeout with no response is an incomplete review;
it supplies no findings or approval. The game snapshot predates the later
shared precision correction, which has a separate bounded review attempt.

See [game authoring and repeatable checks](../../_Games/voidwake/README.md).
