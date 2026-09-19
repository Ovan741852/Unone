"""One user-requested local background-removal preview; does not change game assets."""
import json
from pathlib import Path
import numpy as np
import cv2

ROOT = Path(__file__).resolve().parents[1]
from PIL import Image, ImageDraw, ImageFont

source = ROOT / 'art-source/hazel-imgen-v1/gear-sharp.png'
out = ROOT / 'art-source/hazel-alpha-preview'
out.mkdir(parents=True, exist_ok=True)
original = Image.open(source).convert('RGBA')
# This sample has a nearly uniform known green backdrop. Extract its matte locally,
# preserving the original subject pixels rather than generatively repainting them.
rgb = np.asarray(original, dtype=np.float32)[..., :3]
border = np.concatenate([rgb[:20].reshape(-1, 3), rgb[-20:].reshape(-1, 3),
                         rgb[:, :20].reshape(-1, 3), rgb[:, -20:].reshape(-1, 3)])
key = np.median(border, axis=0)
direction = key / np.linalg.norm(key)
projected = np.sum(rgb * direction, axis=2)[..., None] * direction
chroma = np.linalg.norm(rgb - projected, axis=2)
a = np.clip((chroma - 3.5) / 11.5, 0, 1)
# The golden painted glow includes backdrop color. Keep the solid interior opaque,
# but estimate fractional coverage along its edge before undoing the key color.
interior_distance = cv2.distanceTransform((a > 0.95).astype(np.uint8), cv2.DIST_L2, 5)
solid = np.clip((interior_distance - 8.0) / 12.0, 0, 1)
# Warm leather/cloth and olive foliage are opaque material, not emissive haze.
material = (rgb[..., 0] > rgb[..., 1] * 1.27) | ((rgb[..., 2] < rgb[..., 1] * 0.32) & (rgb[..., 0] > rgb[..., 1] * 0.72))
solid = np.maximum(solid, material.astype(np.float32))
delta = rgb - key
minimum_coverage = np.max(np.where(delta >= 0, delta / (255 - key), -delta / key), axis=2)
a *= np.maximum(solid, np.clip(minimum_coverage, 0, 1))
# Undo the green contribution only along partially transparent edges.
foreground = np.clip((rgb - (1 - a[..., None]) * key) / np.maximum(a[..., None], 0.001), 0, 255)
foreground[a == 0] = 0
rgba = np.concatenate([foreground, (a * 255)[..., None]], axis=2).round().astype(np.uint8)
result = Image.fromarray(rgba, 'RGBA')
result.save(out / 'gear-sharp.png')
alpha = result.getchannel('A')
histogram = alpha.histogram()
report = {'source': str(source), 'output': str(out / 'gear-sharp.png'),
          'method': 'Local known-background chroma matte with edge decontamination; user explicitly authorized',
          'backgroundKey': key.tolist(),
          'mode': result.mode, 'alphaRange': alpha.getextrema(),
          'transparentFraction': histogram[0] / (result.width * result.height),
          'softEdgeFraction': sum(histogram[1:255]) / (result.width * result.height)}
(out / 'report.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
proof = Image.new('RGB', (1320, 570), '#26332e')
draw = ImageDraw.Draw(proof)
font = ImageFont.truetype('C:/Windows/Fonts/msjh.ttc', 22)
small = ImageFont.truetype('C:/Windows/Fonts/msjh.ttc', 17)
panels = [('原圖・深綠實底', original, '#203a32'),
          ('去背後・淺色底檢查', result, '#e9dec2'),
          ('去背後・深色底檢查', result, '#231e38')]
for i, (label, asset, color) in enumerate(panels):
    x = 24 + i * 440
    draw.text((x, 20), label, font=font, fill='#f4e5c3')
    tile = Image.new('RGBA', (400, 400), color)
    tile.alpha_composite(asset.resize((380, 380), Image.Resampling.LANCZOS), (10, 10))
    proof.paste(tile.convert('RGB'), (x, 62))
draw.text((24, 492), '鋒利短劍｜保留劍刃、紅布、葉片及金色光弧｜透明 PNG 單張預覽', font=small, fill='#f4e5c3')
draw.text((24, 528), '僅供確認去背效果，尚未批次替換遊戲圖示。', font=small, fill='#c2b799')
proof.save(out / 'comparison.png')
print(json.dumps(report))
