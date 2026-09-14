"""Validate local report artifacts against the two pinned upstream skill schemas."""
import json
import sys
from pathlib import Path
from jsonschema import Draft202012Validator

sys.stdout.reconfigure(encoding='utf-8')

root = Path(__file__).resolve().parents[2]
out = root / 'docs/reviews/2026-09-11-gamedesignos'
checks = [
    ('analysis.json', 'game-experience-analyzer/templates/structured-output.schema.json'),
    ('evidence-index.json', 'game-experience-analyzer/templates/evidence-index.schema.json'),
    ('ed-triage.json', 'game-experience-density-optimizer/templates/experiment-plan.schema.json'),
]
results = []
for artifact, schema_path in checks:
    schema = json.loads((root / '.agents/skills' / schema_path).read_text(encoding='utf-8'))
    data = json.loads((out / artifact).read_text(encoding='utf-8'))
    Draft202012Validator.check_schema(schema)
    errors = [{'path': list(e.absolute_path), 'message': e.message} for e in Draft202012Validator(schema).iter_errors(data)]
    results.append({'artifact': artifact, 'ok': not errors, 'errors': errors})
evidence = json.loads((out / 'evidence-index.json').read_text(encoding='utf-8'))
ids = {e['evidence_id'] for e in evidence['evidence_index']}
assert len(ids) == len(evidence['evidence_index'])
for judgment in evidence['important_judgments']:
    assert judgment['evidence_refs'] and set(judgment['evidence_refs']) <= ids
(out / 'validation.json').write_text(json.dumps(results, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(results, ensure_ascii=False, indent=2))
raise SystemExit(0 if all(r['ok'] for r in results) else 1)
