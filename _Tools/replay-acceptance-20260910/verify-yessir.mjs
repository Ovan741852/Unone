import {readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'));
const original=resolve(root,'../../_Games/ashen-legion'),project=join(root,'project');
const binary='D:/Projects/Unone/target/debug/game.exe';
const hash=x=>'sha256:'+createHash('sha256').update(x).digest('hex');
const before=hash(readFileSync(join(original,'main.luau')));
const config=JSON.parse(readFileSync(join(original,'project.unone.json')));
const assets=JSON.parse(readFileSync(join(original,'assets.json')));
for(const f of ['main.luau','project.unone.json','scene.json','assets.json','bundles/manifest.json','bundles/content.bundle',...config.test_files,...assets.assets.map(a=>a.source)]){
 mkdirSync(dirname(join(project,f)),{recursive:true});copyFileSync(join(original,f),join(project,f));
}
const source=readFileSync(join(project,'main.luau'),'utf8');
const adapter=`
Game.replay={
 id="yessir.menu-cycle",version="1",
 restore=function(capture:any,_api:any)
  return capture.captureOrigin.kind=="start" and capture.scenario.name=="menu_cycle" and S.phase=="menu"
 end,
 compatible=function(v:any,_api:any)
  return v.source.game.id==v.target.game.id and v.source.engine.coreRevision==v.target.engine.coreRevision
   and v.source.assets.manifestHash==v.target.assets.manifestHash
   and v.sourceAdapter.id=="yessir.menu-cycle" and v.sourceAdapter.version=="1"
   and v.targetAdapter.id=="yessir.menu-cycle" and v.targetAdapter.version=="1"
   and v.scenarioSchema.version==1
 end,
 inspect=function(_ctx:any,_api:any)
  local diagnostics={}
  if S.phase=="battle" then table.insert(diagnostics,{code="BATTLE_OBSERVED",flag="game.replay.battle.observed"}) end
  return {invariants={phase=S.phase,menu_clean=S.phase=="menu" and #troops==0 and S.fired==0 and #S.inventory==0},diagnostics=diagnostics}
 end,
}
return Game
`;
writeFileSync(join(project,'main.luau'),source.replace(/return Game\s*$/,adapter));
const processEvidence=[];
function cli(args){
 const p=spawnSync(binary,['--project',project,'--json',...args],{encoding:'utf8',timeout:70000,windowsHide:true,maxBuffer:16*1024*1024});
 if(p.error)throw p.error;
 let envelope;
 try{envelope=JSON.parse(p.stdout);}catch{throw Error(p.stderr+'\n'+p.stdout);}
 processEvidence.push({args,exitCode:p.status,signal:p.signal,stderr:p.stderr});
 assert.equal(p.signal,null,'CLI must return normally with a JSON verdict');
 assert.ok(p.status===0||p.status===1,'Unexpected CLI exit code');
 return envelope;
}
const schema=JSON.stringify({$schema:'https://json-schema.org/draft/2020-12/schema',$id:'schema://yessir/menu-cycle/v1','x-unone-version':1,type:'object',required:['name'],additionalProperties:false,properties:{name:{const:'menu_cycle'}}});
const target=cli(['replay','fingerprint']);if(!target.ok)throw Error(JSON.stringify(target));
writeFileSync(join(root,'yessir-fingerprint.json'),JSON.stringify(target,null,2));
const frames=Array.from({length:240},(_,i)=>{
 const t=i%60;
 if(t===0)return {actions:{Start:true}};
 if(t===2)return {actions:{Choice1:true}};
 if(t===4)return {actions:{LeaveShop:true}};
 if(t===6)return {pointer:{position:{x:0,y:0},screen_position:{x:50,y:50},down:true}};
 if(t===50)return {actions:{Home:true}};
 return {};
});
const request={reproduction:{schemaVersion:1,mode:'exact_version',...target.value,scenarioSchema:{schemaRef:'schema://yessir/menu-cycle/v1',id:'schema://yessir/menu-cycle/v1',version:1,hash:hash(schema)},captureOrigin:{kind:'start'},seed:'42',scenario:{name:'menu_cycle'},inputs:{schemaRef:'https://unone.dev/schema/input.schema.json',startTick:0,frames,completeThroughTick:239,complete:true,truncated:false},expected:{kind:'diagnostic',code:'BATTLE_OBSERVED',flag:'game.replay.battle.observed',endCondition:{kind:'after_tick',tick:239}},adapter:{id:'yessir.menu-cycle',version:'1'}},target:target.value,scenarioSchema:schema,mode:'exact_version',maxTicks:240,timeoutMs:60000,regressionChecks:[{id:'menu_clean',expectedValue:true,endCondition:{kind:'after_tick',tick:239}}]};
const results=[];
function run(name,r,expectedStatus='reproduced',expectedRegression='passed'){
 const file=join(root,name+'-request.json');writeFileSync(file,JSON.stringify(r,null,2));
 const out=cli(['replay','scenario','--request',file]);writeFileSync(join(root,name+'-result.json'),JSON.stringify(out,null,2));
 const v=out.value??{};const processResult=processEvidence.at(-1);
 const negative=['incompatible','incomplete','execution_failed'].includes(expectedStatus)||['failed','incomplete'].includes(expectedRegression);
 const row={name,exitCode:processResult.exitCode,ok:out.ok,status:v.status,regressionStatus:v.regressionStatus,ticksExecuted:v.ticksExecuted,originalMatcher:v.originalMatcher,overrideMatcher:v.overrideMatcher,memory:v.memory?{samples:v.memory.samples,trends:v.memory.trends}:undefined,diagnostics:out.diagnostics};results.push(row);console.log(JSON.stringify(row));
 writeFileSync(join(root,name+'-process.json'),JSON.stringify(processResult,null,2));
 assert.equal(v.status,expectedStatus,name+' status');
 assert.equal(v.regressionStatus,expectedRegression,name+' regression');
 assert.equal(out.ok,!negative,name+' envelope');
 assert.equal(processResult.exitCode,negative?1:0,name+' exit');
 return out;
}
run('yessir-exact',request);
run('yessir-memory',{...request,memory:{sampleEveryTicks:60,warmupTicks:60,collect:true,label:'menu_after_home'}});
let idle=structuredClone(request);idle.reproduction.inputs.frames=frames.map(()=>({}));idle.reproduction.expected={kind:'invariant',id:'menu_clean',expectedValue:true,endCondition:{kind:'after_tick',tick:239}};idle.memory={sampleEveryTicks:60,warmupTicks:60,collect:true,label:'menu_idle_control'};run('yessir-idle-memory',idle);
let r=structuredClone(request);r.reproduction.inputs.frames.pop();run('yessir-missing-input',r,'incomplete','not_evaluated');
r=structuredClone(request);r.reproduction.expected.code='NOT_OBSERVED';run('yessir-absent-matcher',r,'not_reproduced');
r=structuredClone(request);r.regressionChecks[0].expectedValue=false;run('yessir-regression-failed',r,'reproduced','failed');
writeFileSync(join(project,'main.luau'),readFileSync(join(project,'main.luau'),'utf8')+'\n-- Revised source identity; gameplay unchanged.\n');
const newTarget=cli(['replay','fingerprint']);if(!newTarget.ok)throw Error(JSON.stringify(newTarget));
assert.equal(newTarget.value.assets.manifestHash,target.value.assets.manifestHash,'Source-only change must preserve asset identity');
assert.notEqual(newTarget.value.game.scriptHash,target.value.game.scriptHash);
r=structuredClone(request);r.target=newTarget.value;run('yessir-version-mismatch',r,'incompatible','not_evaluated');
r.mode='compatible_version';r.expectedOverride={kind:'invariant',id:'menu_clean',expectedValue:true,endCondition:{kind:'after_tick',tick:239}};run('yessir-compatible-override',r);
r.reproduction.expected.code='NOT_OBSERVED';const independent=run('yessir-override-independent',r);
assert.equal(independent.value.originalMatcher.matched,false);assert.equal(independent.value.overrideMatcher.matched,true);assert.equal(independent.value.statusMatcher,'override');
if(before!==hash(readFileSync(join(original,'main.luau'))))throw Error('Original source changed');
writeFileSync(join(root,'summary.json'),JSON.stringify({originalUnchanged:true,results,processEvidence},null,2));
