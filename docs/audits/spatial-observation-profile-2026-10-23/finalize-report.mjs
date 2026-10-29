// Add the independently completed semantic judgment without changing ratings.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url));
const report=JSON.parse(await readFile(resolve(here,'audit.proposed.json'),'utf8'));
const review=await readFile(resolve(here,'semantic-review.md'));
const quote=review.toString('utf8').split(/\r?\n/).find(line=>line.includes('80.5'));
assert.ok(quote,'Read the completed independent semantic review before finalization');
report.evidence.push({id:'semantic-review',kind:'observation',path:'docs/audits/spatial-observation-profile-2026-10-23/semantic-review.md',sha256:createHash('sha256').update(review).digest('hex'),quote});
for(const check of report.checks)check.evidence.push('semantic-review');
await writeFile(resolve(here,'audit.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({finalized:true,ratingsUnchanged:true,evidence:report.evidence.length,quote}));
