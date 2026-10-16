Local font faces packaged by the official Unone player. Families: Barlow
Condensed, Share Tech Mono, Noto Sans TC (UI character subset). Sources:
https://fonts.google.com/ and https://github.com/google/fonts.
Each family is redistributed under the accompanying SIL Open Font License.
Only TTF faces declared in player.presentation.json are included.

NotoSansTC-Supplemental-{400,600,700}.ttf are separate, missing-glyph-only
derivatives of the cached Noto Sans TC variable font (upstream family:
https://github.com/google/fonts/tree/main/ofl/notosanstc). The three original
NotoSansTC-{400,600,700}.ttf subsets remain byte-identical. Explicit font-family
stacks select original Noto glyphs first; the supplement supplies only missing
characters. Share Tech Mono remains first for Latin text in mono styles, with
the packaged Noto faces explicitly listed after it for CJK and symbols.

The supplement includes every authored non-ASCII character absent from the
original subsets, including the upgrade/result text, not only browser samples.
The derivative retains the upstream copyright and SIL OFL metadata; the same
notosanstc-LICENSE.txt applies. No glyphs are merged into another family.

Rebuild with fontTools 4.56.0 and the pinned cached variable TTF:
  python _Games/voidwake/tools/build-supplemental-fonts.py --source PATH/TO/NotoSansTC-VF.ttf
The source SHA-256, output hashes and codepoints are recorded in
supplemental-fonts.json. The tool rejects a different upstream source hash.
Check the checked-in font hashes and authored character coverage without the
full source font:
  python _Games/voidwake/tools/build-supplemental-fonts.py --check
