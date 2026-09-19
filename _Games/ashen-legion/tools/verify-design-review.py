"""Validate a local GameDesignOS review; no model calls, uploads or runtime install."""
import hashlib
import json
from pathlib import Path
import sys

import jsonschema

root = Path(__file__).resolve().parents[3]
game = root / '_Games/ashen-legion'
review = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else game / 'design-v1/reviews/20260914-gamedesignos'
templates = root / '.agents/skills/game-experience-analyzer/templates'


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


for filename, schema in [('analysis.json', 'structured-output.schema.json'), ('evidence-index.json', 'evidence-index.schema.json')]:
    jsonschema.Draft202012Validator(read(templates / schema)).validate(read(review / filename))

index = read(review / 'evidence-index.json')
evidence_ids = {e['evidence_id'] for e in index['evidence_index']}
assert len(evidence_ids) == len(index['evidence_index']), 'Duplicate evidence IDs'
for judgment in index['important_judgments']:
    assert set(judgment['evidence_refs']) <= evidence_ids, 'Unresolved judgment evidence'
for issue in read(review / 'ed-handoff.json')['issue_cards_for_ed']:
    assert issue['evidence_refs'] and set(issue['evidence_refs']) <= evidence_ids, 'Unresolved ED evidence'

ed = read(review / 'ed-triage.json')
for key in ['output_mode', 'case_boundary', 'evidence_gate', 'metric_horizon', 'optimal_stimulation_fit', 'primary_formula_item', 'primary_lever', 'two_minimal_changes', 'verification_metrics', 'rollback_condition', 'unsupported_claims']:
    assert key in ed, 'Missing quick_ed_triage field: ' + key
assert ed['theory_status'] == 'design_hypothesis'
assert len(ed['two_minimal_changes']) == 2 and len(ed['verification_metrics']) == 3

manifest = read(review / 'source-manifest.json')
for source in manifest['sources'] + manifest['technical_supplements']:
    assert hashlib.sha256(Path(source['path']).read_bytes()).hexdigest() == source['sha256'], 'Evidence changed: ' + source['path']

lock = read(root / '.agents/skills/gamedesignos-source-lock.json')
selected = [f for f in lock['files'] if f.get('selected')]
for source in selected:
    path = root / '.agents/skills' / source['path']
    assert hashlib.sha256(path.read_bytes()).hexdigest() == source['sha256'], 'Skill changed: ' + str(path)

print(f'PASS 2 upstream schemas, evidence references, ED output contract, source hashes and {len(selected)} installed skill files')
