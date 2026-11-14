"""Prepare bounded, hash-verified base64 batches for the GoldSaucer plugin."""
import argparse
import base64
import hashlib
import json
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('package', type=Path)
parser.add_argument('output', type=Path)
args = parser.parse_args()
package = args.package.resolve(strict=True)
report = json.loads(package.with_name(package.name + '-upload.json').read_text('utf-8'))
args.output.mkdir(parents=True, exist_ok=False)
batch, batches = [], []

def flush():
    if not batch:
        return
    path = args.output / f'batch-{len(batches):02d}.json'
    payload = json.dumps(batch, separators=(',', ':'))
    path.write_text(payload, 'ascii')
    batches.append({'path': str(path.resolve()), 'length': len(payload), 'files': len(batch)})
    batch.clear()

for entry in report['files']:
    source = (package / entry['path']).resolve(strict=True)
    if not source.is_relative_to(package):
        raise ValueError('Package path escapes root')
    raw = source.read_bytes()
    assert len(raw) == entry['size']
    assert hashlib.sha256(raw).hexdigest() == entry['sha256']
    item = {'path': entry['path'], 'base64': base64.b64encode(raw).decode('ascii')}
    if len(json.dumps(batch + [item], separators=(',', ':'))) > 7_600_000:
        flush()
    batch.append(item)
    if len(json.dumps(batch, separators=(',', ':'))) > 7_600_000:
        raise ValueError('Single file exceeds transport batch budget')
flush()
(args.output / 'batches.json').write_text(json.dumps(batches), 'utf-8')
print(json.dumps({'batches': len(batches), 'files': len(report['files'])}))
