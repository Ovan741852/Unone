import { createHash } from 'node:crypto';
import { AuditError, keys, text } from './files.mjs';

function editDistance(a, b) {
  const row = Array.from({length:b.length + 1}, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length];
}

// Reusable, data-only two-stage discovery. No provider, filesystem scan or execution.
export function createDiscovery(contracts) {
  const byId = new Map();
  for (const contract of contracts) {
    if (byId.has(contract.id)) throw new Error(`Duplicate operation ${contract.id}`);
    const frozen = structuredClone(contract);
    const contractHash = createHash('sha256').update(JSON.stringify(frozen)).digest('hex');
    byId.set(frozen.id, { ...frozen, contractHash });
  }
  function describe(id) {
    text(id, 'operation', 100);
    const contract = byId.get(id);
    if (!contract) {
      const closest = [...byId.keys()].map(candidate => ({candidate, distance:editDistance(id.toLocaleLowerCase(),candidate.toLocaleLowerCase())}))
        .filter(item => item.distance <= Math.max(1, Math.floor(id.length * 0.12)))
        .sort((a,b) => a.distance - b.distance || a.candidate.localeCompare(b.candidate))[0]?.candidate;
      const fix = closest
        ? `Operation ID typo likely. Did you mean ${closest}? Retry ai_native.describe with that exact ID; otherwise call ai_native.recommend with your goal.`
        : 'Use ai_native.recommend with your goal, then ai_native.describe with one returned operation ID.';
      throw new AuditError('DISCOVERY_OPERATION_UNKNOWN', 'operation', 'This plugin does not expose the requested operation.', [...byId.keys()], id, fix);
    }
    return structuredClone(contract);
  }
  function recommend(input) {
    keys(input, ['query','limit'], 'input'); text(input.query, 'input.query', 500);
    const limit = input.limit ?? 3;
    if (!Number.isInteger(limit) || limit < 1 || limit > 5) throw new AuditError('DISCOVERY_LIMIT_INVALID', 'input.limit', 'Recommendation count must stay bounded.', 'integer 1–5', limit, 'Request at most five candidates; refine the goal if more results are needed.');
    const query = input.query.toLocaleLowerCase();
    const candidates = [...byId.values()].map(contract => {
      const matches = contract.keywords.filter(k=>query.includes(k.toLocaleLowerCase()));
      const exact = query.includes(contract.id.toLocaleLowerCase());
      return { contract, matches, score: matches.length + (exact ? 100 : 0) };
    }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score || a.contract.id.localeCompare(b.contract.id));
    const hasInitializer = candidates.some(({contract}) => contract.id === 'ai_native.init');
    const hasEvaluator = candidates.some(({contract}) => contract.id === 'ai_native.evaluate');
    const normalizedQuery = query.replaceAll('-', ' ');
    const asksForNewAssessment = (/\b(?:new|start|begin|create|fresh|from scratch)\b/.test(normalizedQuery)
      && /\b(?:assessment|audit|evaluation|score|rating)\b/.test(normalizedQuery))
      || (/\b(?:self|myself|itself|ourselves|scout|this tool|this plugin)\b/.test(normalizedQuery)
        && /\b(?:audit|assess|evaluate|score|rate|rating)\b/.test(normalizedQuery)
        && !/\b(?:existing|completed|saved|report|report path)\b/.test(normalizedQuery));
    if (hasInitializer && hasEvaluator && asksForNewAssessment) {
      candidates.sort((a,b) => Number(b.contract.id === 'ai_native.init') - Number(a.contract.id === 'ai_native.init') || b.score-a.score || a.contract.id.localeCompare(b.contract.id));
    }
    const nextAction = hasEvaluator
      ? `For a new assessment, select ai_native.init first for a JSON template (returned only; no file is written), then gather evidence and call ai_native.evaluate with the completed report JSON or a report_path. ${hasInitializer ? 'Both start and evaluation contracts are listed above.' : 'The init operation can be found with a query such as "start a new assessment".'}`
      : candidates.length ? 'Choose a candidate, retrieve its contract, then call explicitly with its contractHash.' : 'No matching operation in this plugin. Clarify the goal or query another installed plugin; no API was invented.';
    return {
      schema: 'unone.discovery.recommendation.v1', strategy: 'deterministic-keyword-v1', query: input.query,
      candidates: candidates.slice(0,limit).map(({contract,matches}) => ({ operation: contract.id, summary: contract.summary, available: structuredClone(contract.available), readOnly: contract.readOnly, reason: { matchedKeywords: matches, note: 'Metadata match, not a guarantee this operation satisfies the whole task.' }, next: { tool: 'ai_native.describe', input: { operation: contract.id } } })),
      hasMore: candidates.length > limit,
      nextAction,
      limitations: ['Only this supplied catalog is searched; no global registry or semantic model lookup.', 'Recommendation does not execute, grant permissions, or install a plugin.'],
    };
  }
  function selected(id, contractHash) {
    const contract = describe(id);
    if (contractHash !== contract.contractHash) throw new AuditError('DISCOVERY_CONTRACT_STALE', 'input.contractHash', 'The selected API contract is missing or has changed.', contract.contractHash, typeof contractHash === 'string' ? contractHash.slice(0,64) : null, 'Call ai_native.describe again, check the schema and limitations, then retry with that contractHash.');
    if (contract.available.status !== 'available') throw new AuditError('DISCOVERY_UNAVAILABLE', 'operation', 'The selected capability is not available in this environment.', 'available', contract.available, 'Read the declared requirements; do not treat a recommended option as installed or supported.');
    return contract;
  }
  return { recommend, describe, selected, ids: () => [...byId.keys()] };
}
