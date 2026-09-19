"""Validate native ImageGen alpha and copy the approved output byte-for-byte."""
import hashlib
import json
import shutil
import sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
def write_json_atomic(path, value):
    # Parallel image workers may finish while the gallery reads receipts.
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(path)

receipt_path = Path(sys.argv[1]).resolve()
receipt = json.loads(receipt_path.read_text(encoding='utf-8'))
source = Path(receipt['source'])
image = Image.open(source)
report = {'mode': image.mode, 'size': image.size}
valid = image.mode == 'RGBA'
if valid:
    alpha = image.getchannel('A')
    hist = alpha.histogram()
    count = image.width * image.height
    edge = (list(alpha.crop((0, 0, image.width, 1)).getdata()) +
            list(alpha.crop((0, image.height-1, image.width, image.height)).getdata()) +
            list(alpha.crop((0, 0, 1, image.height)).getdata()) +
            list(alpha.crop((image.width-1, 0, image.width, image.height)).getdata()))
    report.update(alphaRange=alpha.getextrema(), transparentFraction=hist[0]/count,
                  opaqueFraction=sum(hist[240:])/count, edgeCoverage=sum(x>8 for x in edge)/len(edge))
    valid = alpha.getextrema() == (0, 255) and report['transparentFraction'] >= 0.12 and report['opaqueFraction'] >= 0.025 and report['edgeCoverage'] <= 0.015
report['valid'] = valid
receipt['alphaCheck'] = report
if valid:
    target = ROOT / 'art-source/hazel-transparent-v2' / (receipt['id'] + '.png')
    target.parent.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    # No matting, recoloring, cleanup or resampling here: retain ImageGen's native alpha.
    if not target.exists() or hashlib.sha256(target.read_bytes()).hexdigest() != digest:
        shutil.copyfile(source, target)
    receipt['original'] = target.relative_to(ROOT).as_posix()
    receipt['sourceSha256'] = digest
write_json_atomic(receipt_path, receipt)
if valid:
    accepted = ROOT / 'art-source/hazel-transparent-receipts' / (receipt['id'] + '.json')
    accepted.parent.mkdir(parents=True, exist_ok=True)
    write_json_atomic(accepted, receipt)
print(json.dumps({'id': receipt['id'], **report}))
sys.exit(0 if valid else 2)
