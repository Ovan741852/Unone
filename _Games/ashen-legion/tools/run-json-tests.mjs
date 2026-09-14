import {module,payload,tick,loadProject,readObservation} from './runtime-harness.mjs';
import {readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {frameInput,checkAssertions} from '../../../_Tools/fishing-quicktest/replay.mjs';
const root=new URL('../tests/',import.meta.url),results=[];
for(const file of readdirSync(root).filter(x=>x.endsWith('.test.json'))){
 const spec=JSON.parse(readFileSync(new URL(file,root)));loadProject(module,payload,BigInt(spec.seed??42));
 for(let frame=0;frame<spec.frames;frame++)tick(frameInput(spec,frame));
 const observation=readObservation(module).world.observations,assertions=checkAssertions(spec,observation);
 const pass=assertions.every(a=>a.pass);results.push({file,pass,assertions});
 console.log((pass?'PASS ':'FAIL ')+file+(pass?'':' '+JSON.stringify(assertions.filter(x=>!x.pass))));
}
writeFileSync(new URL('current-results.json',root),JSON.stringify(results,null,2));
if(results.some(x=>!x.pass))process.exitCode=1;
