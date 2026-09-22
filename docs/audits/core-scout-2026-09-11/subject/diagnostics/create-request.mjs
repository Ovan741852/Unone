// Usage: node create-request.mjs <game executable> <request output.json>
// Generates a runnable request for the checked-in project, not fixed fake hashes.
import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const [game,output]=process.argv.slice(2);
if(!game||!output)throw Error('Usage: node create-request.mjs <game executable> <request output.json>');
const project=fileURLToPath(new URL('./project/',import.meta.url));
const run=spawnSync(resolve(game),['--project',project,'--json','replay','fingerprint'],{encoding:'utf8',timeout:60000,windowsHide:true});
if(run.status!==0)throw Error(run.stderr||run.error||run.stdout);
const envelope=JSON.parse(run.stdout);if(!envelope.ok)throw Error(JSON.stringify(envelope.diagnostics));
const target=envelope.value;
const scenarioSchema=readFileSync(new URL('./scenario.schema.json',import.meta.url),'utf8');
const schema=JSON.parse(scenarioSchema);
const reproduction={schemaVersion:1,mode:'exact_version',...target,
  scenarioSchema:{schemaRef:schema.$id,id:schema.$id,version:1,hash:'sha256:'+createHash('sha256').update(scenarioSchema).digest('hex')},
  captureOrigin:{kind:'start'},seed:'18446744073709551615',scenario:{initialCount:0},
  inputs:{schemaRef:'https://unone.dev/schema/input.schema.json',startTick:0,frames:Array.from({length:40},(_,i)=>i%10===9?{actions:{release:true}}:{}),completeThroughTick:39,complete:true,truncated:false},
  expected:{kind:'invariant',id:'counter',expectedValue:40,endCondition:{kind:'after_tick',tick:39}},adapter:{id:'example.counter',version:'1'}};
const request={reproduction,target,scenarioSchema,mode:'exact_version',maxTicks:40,timeoutMs:60000,
  regressionChecks:[{id:'retained',expectedValue:0,endCondition:{kind:'after_tick',tick:39}}],
  memory:{sampleEveryTicks:10,warmupTicks:10,collect:true,label:'idle_after_cycle'}};
writeFileSync(resolve(output),JSON.stringify(request,null,2));
console.log(JSON.stringify({request:resolve(output),project,next:[resolve(game),'--project',project,'--json','replay','scenario','--request',resolve(output)]},null,2));
