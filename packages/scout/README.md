# Unone Scout

Optional, zero-dependency Node SDK for demand-driven capability discovery:
`recommend(goal) → describe(one operation) → explicit call`.
This is developer tooling, not a runtime Core primitive or a replacement for MCP.

`createScoutProtocol(contracts)` returns immutable-by-copy compact index,
keyword recommendation, selected full contract/hash, and input validation.
The host **must** independently check identity, grants, current availability and
side effects. Contract hashes are not authorization. No model or network call occurs.

Contracts declare `id`, `summary`, `keywords`, `readOnly`, `requirements`,
`inputSchema`, and domain-specific outputs/examples/errors/recovery/limits.
Only a small JSON Schema subset is supported: scalar `type`, `properties`,
`required`, boolean `additionalProperties`, one item schema, array length and
uniqueness, string length and pattern, numeric bounds, `enum`, `const`, `oneOf`,
and description/default metadata. Type-specific constraints require an explicit
matching type; schema-valued additional properties, tuple items, references and
union type arrays are not supported. Unsupported keywords/forms fail at startup,
and a matching `oneOf` branch still applies sibling constraints. Metadata never
mutates arguments. This is not a general JSON Schema validator.

```js
import {createScoutProtocol} from './scout.mjs';
const scout = createScoutProtocol([{
  id: 'example.read', summary: 'Read one approved record', keywords: ['read', '讀取'],
  readOnly: true, requirements: ['authorized project'],
  inputSchema: {type: 'object', properties: {id: {type: 'string', minLength: 1}},
    required: ['id'], additionalProperties: false},
  output: '{id, content}', examples: [{id: 'record-1'}],
}]);
const candidate = scout.recommend({query: '讀取資料'}).candidates[0];
const selected = scout.describe(candidate.operation); // cache until hash changes
scout.select(selected.id, selected.contractHash, {id: 'record-1'});
// Validation only: the embedding host must authorize and execute its own handler.
```

Koncrate Viewer vendors the exact SDK file in `host/scout-protocol.mjs` so an
independent clone or packaged app has no sibling-repository dependency. Update by
copying a reviewed version and checking SHA-256 identity, then run both test suites.
The AI-native audit plugin's older `ai_native.*` discovery remains compatible;
it is not silently migrated in this release.
