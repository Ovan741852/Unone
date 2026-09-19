"""Downscale approved native-alpha artwork; no matting or repainting."""
import hashlib
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / 'design-v1/hazel-transparent-manifest.json'
manifest = json.loads(path.read_text(encoding='utf-8'))
directory = ROOT / 'assets/formal-ui/transparent-v2'
directory.mkdir(parents=True, exist_ok=True)
for entry in manifest['entries']:
    source = ROOT / entry['original']
    if hashlib.sha256(source.read_bytes()).hexdigest() != entry['sourceSha256']:
        raise ValueError('Original changed: ' + entry['id'])
    target = directory / (entry['id'] + '.png')
    if not target.exists() or entry.get('packagedSourceSha256') != entry['sourceSha256']:
        im = Image.open(source)
        if im.mode != 'RGBA' or im.getchannel('A').getextrema() != (0, 255):
            raise ValueError('Missing native alpha: ' + entry['id'])
        im.thumbnail((256, 256), Image.Resampling.LANCZOS)
        im.save(target, optimize=True)
    entry['runtime'] = target.relative_to(ROOT).as_posix()
    entry['runtimeSha256'] = hashlib.sha256(target.read_bytes()).hexdigest()
    entry['packagedSourceSha256'] = entry['sourceSha256']
    alpha = Image.open(target).getchannel('A')
    entry['runtimeAlphaRange'] = alpha.getextrema()
path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('Packaged', len(manifest['entries']), 'native transparent images at up to 256 px')
