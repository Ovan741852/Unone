import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {module,payload,tick,loadProject,readObservation} from './runtime-harness.mjs';
import {policies,simulate} from '../../../_Tools/fishing-quicktest/balance.mjs';
const mode=process.argv[2]??'split',project=mode==='baseline'?JSON.parse(readFileSync(new URL('../tests/currency-baseline-project.json',import.meta.url))):payload;
const runs=[];
for(const id of ['survival','cyclone','momentum']){
 const run=await simulate({seed:42,policy:policies.find(p=>p.id===id),maxFrames:13000,load:seed=>loadProject(module,project,BigInt(seed)),tick,observe:()=>readObservation(module).world.observations});
 runs.push(run);console.log(JSON.stringify({mode,id,status:run.status,battleSeconds:run.battleSeconds,coins:run.finalCoins,crystals:run.finalCrystals,crystalEarned:run.crystalEarned,crystalSpent:run.crystalSpent,items:Object.values(run.items).length,invariants:run.invariantFailures}));
}
const hash=value=>createHash('sha256').update(value).digest('hex');
const policyHash=hash(readFileSync(new URL('../../../_Tools/fishing-quicktest/build-policy.mjs',import.meta.url),'utf8')+readFileSync(new URL('../../../_Tools/fishing-quicktest/balance.mjs',import.meta.url),'utf8'));
writeFileSync(new URL('../tests/currency-quicktest-'+mode+'.json',import.meta.url),JSON.stringify({mode,scriptHash:hash(project.script),policyHash,policyVersion:5,seed:42,maxFrames:13000,scope:'Opening economy sample with real input, fresh town, three builds. Censored means sample limit, not victory.',runs},null,2));
