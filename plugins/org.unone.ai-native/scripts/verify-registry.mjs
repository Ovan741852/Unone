// Reviewed local regression probe. Mutations occur only in test-owned OS temp
// fixtures. No real accounts, providers, network, product changes or product scores.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));
assert.deepEqual(process.argv.slice(2), ['--root', path.resolve(root)], 'Use record-probe.mjs with the plugin directory as root.');
const child = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'test/audit.test.mjs', 'test/registry.test.mjs'], {
  cwd: root, encoding:'utf8', windowsHide:true, shell:false, timeout:15000, maxBuffer:1024*1024,
});
process.stdout.write(child.stdout || '');
process.stderr.write(child.stderr || '');
assert.equal(child.status, 0, child.error?.message || 'Regression suite failed. Preserve the failed capture.');
process.stdout.write('AI_NATIVE_REGISTRY_REGRESSIONS_PASSED: synthetic state-machine fixtures plus real CLI/stdio; not a fresh blind assessment or product score.\n');
