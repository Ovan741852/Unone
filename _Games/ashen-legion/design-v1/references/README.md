# UI reference study — 2026-09-19

Reference images are for design study, not shipped game assets. Do not copy them into the game build.

- Hades boon selection: https://www.shacknews.com/article/120582/hades-review-godlike-roguelike — local `hades-boons.jpg`. Studied ink-dark panels, illustrated icons, horizontal choices, emphatic selection outlines and title hierarchy.
- Hades boon selection, downloaded study copy: https://gamingtrend.com/reviews/the-son-of-the-underworld-returns-hades/ — local `hades-boons-gamingtrend.jpg`, 1920×1080. Studied the large choice list, rarity color, selected-card outline and right-side contextual tooltips.
- Hades shop/gameplay, downloaded study copy: https://www.mobygames.com/game/122190/hades/screenshots/windows/1023297/ — local `hades-underworld-shop-mobygames.jpg`, 1200×675. Studied the dim scene treatment, bright purchase target, currency placement and bottom-center buy prompt.
- Hades official game page: https://www.supergiantgames.com/games/hades/
- Shop reference page: https://www.pushsquare.com/guides/hades-guide-how-to-play-and-everything-you-need-to-know (direct image download was blocked; page retained as a source link only).

## Design extraction for YesSir

Borrow the principles, not Hades' art or layout:

- Make the selected item unmistakable with one strong outline and a restrained glow.
- Give each item a compact icon frame, name, effect sentence and one readable cost/status line.
- Reserve a separate side region for explanation or contextual help instead of repeating long text inside every card.
- Use a dark painted field to create contrast, then spend bright color only on selection, rarity, currency and the primary action.
- Keep the game’s existing forest-green / old-gold / brick-red identity and Hazel hand-painted asset style; do not introduce Greek motifs or copy Hades-specific ornaments.

Original implementation: forest green / ivory / vermilion palette; existing original forest key art and SVG building/gear illustrations; horizontal location choices, foldable armory/runes, larger battlefield. No reference screenshot is used as a game UI texture.

Implementation: art-direction.css, index.html, ui.mjs, rpg-ui.mjs. Browser screenshots: ui-menu-art.png, ui-choice-art.png, ui-shop-art.png. Gameplay rules unchanged.
