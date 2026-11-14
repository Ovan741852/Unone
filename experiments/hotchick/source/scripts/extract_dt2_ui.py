"""Extract selected generic DT2 UI frames without changing the source atlas."""

from __future__ import annotations

import hashlib
import json
import plistlib
import re
from pathlib import Path

from PIL import Image, ImageDraw


WORKSPACE = Path(__file__).resolve().parents[1]
DT2_PUBLIC = Path("D:/H5Projects/cc3ch_dt2/public")
OUTPUT = WORKSPACE / "game/presentation/assets/dt2"

SOURCES = [
    (
        DT2_PUBLIC / "shared/TMDCommonResource/CsbRes/gameCommonUI/Plist/CommonUI.plist",
        {
            "btn_close.png": "close-blue.png",
            "btn_spinner_add.png": "spinner-plus.png",
            "btn_spinner_minus.png": "spinner-minus.png",
            "Windows_bottom.png": "panel-blue.png",
            "Windows_bottom_1.png": "panel-blue-alt.png",
            "Options_bottom.png": "panel-navy.png",
            "Options_box.png": "dialog-blue.png",
            "d_SettingBtn.png": "settings-tab.png",
            "d_SettingBtn_e.png": "settings-tab-active.png",
        },
    ),
    (
        DT2_PUBLIC / "dt2/DragonTycoon2Resource/DinosaurExport/DT_resource/MainUI/DT_MainUI_imgs.plist",
        {
            f"DinosaurExport/DT_resource/MainUI/{source}": target
            for source, target in {
                "BetPlus.png": "bet-plus.png",
                "BetPlus_Off.png": "bet-plus-disabled.png",
                "BetMinus.png": "bet-minus.png",
                "BetMinus_Off.png": "bet-minus-disabled.png",
                "button_close.png": "close-cyan.png",
            }.items()
        },
    ),
]


def numbers(value: str) -> list[int]:
    return [int(part) for part in re.findall(r"-?\d+", value)]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def extract_frame(atlas: Image.Image, frame: dict) -> Image.Image:
    x, y, width, height = numbers(frame["frame"])
    rotated = bool(frame.get("rotated", False))
    packed_width, packed_height = (height, width) if rotated else (width, height)
    cropped = atlas.crop((x, y, x + packed_width, y + packed_height))
    if rotated:
        # TexturePacker stores a clockwise-rotated region in the atlas.
        cropped = cropped.transpose(Image.Transpose.ROTATE_90)
    if cropped.size != (width, height):
        raise ValueError(f"Restored frame size mismatch: {cropped.size} vs {(width, height)}")

    source_width, source_height = numbers(frame["sourceSize"])
    if "sourceColorRect" in frame:
        left, top, trim_width, trim_height = numbers(frame["sourceColorRect"])
        if (trim_width, trim_height) != cropped.size:
            raise ValueError("Trim rectangle does not match restored packed dimensions")
    else:
        offset_x, offset_y = numbers(frame.get("offset", "{0,0}"))
        left = round((source_width - width) / 2 + offset_x)
        top = round((source_height - height) / 2 - offset_y)
    if left < 0 or top < 0 or left + width > source_width or top + height > source_height:
        raise ValueError("Trim rectangle escapes original source dimensions")

    restored = Image.new("RGBA", (source_width, source_height), (0, 0, 0, 0))
    restored.paste(cropped, (left, top))
    return restored


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    extracted = []
    for plist_path, selected in SOURCES:
        declaration = plistlib.loads(plist_path.read_bytes())
        atlas_path = plist_path.with_name(declaration["metadata"]["textureFileName"])
        atlas = Image.open(atlas_path).convert("RGBA")
        for frame_name, output_name in selected.items():
            frame = declaration["frames"][frame_name]
            restored = extract_frame(atlas, frame)
            output_path = OUTPUT / output_name
            restored.save(output_path)
            extracted.append({
                "file": output_name,
                "width": restored.width,
                "height": restored.height,
                "sha256": sha256(output_path),
                "source_atlas": str(atlas_path),
                "source_atlas_sha256": sha256(atlas_path),
                "source_plist": str(plist_path),
                "source_plist_sha256": sha256(plist_path),
                "source_frame": frame_name,
                "frame_metadata": frame,
                "nine_slice": None,
            })

    mapping = {
        "version": 1,
        "purpose": "Generic DT2 UI candidates for the HotChick playable prototype",
        "source_policy": "Source files were read only; originals are unchanged.",
        "alpha": "RGBA transparency and original source canvas dimensions are preserved.",
        "nine_slice_note": "Not inferred from frame names; capInsets must be inspected in a consuming CSB before a production nine-slice binding is declared.",
        "button_states": {
            "bet_plus": {"normal": "bet-plus.png", "disabled": "bet-plus-disabled.png", "pressed": None},
            "bet_minus": {"normal": "bet-minus.png", "disabled": "bet-minus-disabled.png", "pressed": None},
            "close": {"normal": "close-cyan.png", "pressed": None, "disabled": None},
        },
        "files": extracted,
    }
    (OUTPUT / "source-map.json").write_text(json.dumps(mapping, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    # Contact sheet is a review aid, not an in-game asset.
    columns, cell_width, cell_height = 4, 270, 192
    rows = (len(extracted) + columns - 1) // columns
    preview = Image.new("RGB", (columns * cell_width, rows * cell_height), "#101b32")
    draw = ImageDraw.Draw(preview)
    for index, item in enumerate(extracted):
        left, top = (index % columns) * cell_width, (index // columns) * cell_height
        image = Image.open(OUTPUT / item["file"]).convert("RGBA")
        image.thumbnail((cell_width - 32, cell_height - 46))
        preview.paste(image, (left + (cell_width - image.width) // 2, top + 10), image)
        draw.text((left + 12, top + cell_height - 30), item["file"], fill="#d9e8ff")
        draw.text((left + 12, top + cell_height - 16), f"{item['width']} x {item['height']}", fill="#8aa7c9")
    preview.save(OUTPUT / "preview.png")
    print(json.dumps({"output": str(OUTPUT), "files": len(extracted)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
