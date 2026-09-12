// Same production WASM, inputs and seeds before/after; no game-state injection.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {module,payload,tick,loadProject,readObservation} from './runtime-harness.mjs';
import {simulate} from '../../../_Tools/fishing-quicktest/balance.mjs';
const runs=[];
const before=JSON.parse(readFileSync(new URL('../tests/cavalry-before-project.json',import.meta.url)));
for(const [version,project] of [['before',before],['after',payload]])for(const seed of [42,43]){
 const run=await simulate({seed,policy:{id:'cavalry',name:'騎兵專用',unit:3},maxFrames:11200,load:seed=>loadProject(module,project,BigInt(seed)),tick,observe:()=>readObservation(module).world.observations});
 runs.push({version,scriptHash:createHash('sha256').update(project.script).digest('hex'),...run});
 console.log(JSON.stringify({version,seed,status:run.status,battleSeconds:run.battleSeconds,coins:run.finalCoins,shots:run.fired,pierces:run.piercesUsed,roundsCleared:run.roundsCleared,invariants:run.invariantFailures}));
}
writeFileSync(new URL('../tests/cavalry-quicktest.json',import.meta.url),JSON.stringify({scope:'Fresh town, bare cavalry only, continuous manual fire with retargeting; LOCK on major boss. No gear, sword fallback, injected money or guaranteed prizes. At most 11200 frames, not a complete 20-minute balance test. Different contact counts advance lottery RNG differently.',seeds:[42,43],policyHash:createHash('sha256').update(readFileSync(new URL('../../../_Tools/fishing-quicktest/balance.mjs',import.meta.url))).digest('hex'),runs},null,2));
