// Executes the emitted production VM; recorded presentation receipts are input,
// and therefore this gate deliberately makes no GPU/pixel claim.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {readPinnedRuntime,instantiateEmittedRuntime} from './immutable-bytes-emitted-runtime.mjs';
import {createRuntimeCore} from '../web/shared/runtime-core.mjs';

const {values}=parseArgs({options:{runtime:{type:'string'},out:{type:'string'},'expected-source':{type:'string'},'expected-wasm':{type:'string'}}});
for(const key of ['runtime','out','expected-source','expected-wasm'])assert(values[key],`Missing --${key}`);
const sha=b=>createHash('sha256').update(b).digest('hex');
const directory=fs.realpathSync(values.runtime),out=path.resolve(values.out);
assert(!fs.existsSync(out),'Refuse to overwrite evidence');
const metadataBytes=fs.readFileSync(path.join(directory,'runtime.json')),metadata=JSON.parse(metadataBytes);
const report={schema:'unone.sprite-resources.emitted-wasm.v1',ok:false,checks:[],pins:{},stderr:[],stderr_overflow:0,aborts:[],
  limitations:['Actual production WASM Core with recorded host receipts; no GPU, scanout, FPS or global leak/GC certification.',
    'Source ingestion exercises the runtime API; this gate does not certify the latest CLI precompiler or a complete SDK.']};
function pin(file,expected,label){const b=fs.readFileSync(file);assert.equal(sha(b),expected,label);report.pins[label]={path:file,sha256:expected,bytes:b.length};return b;}
const selected=readPinnedRuntime({directory,expected:{manifest:sha(metadataBytes),source:values['expected-source'],
  javascript:metadata.javascript_sha256,wasm:values['expected-wasm']},pinned:pin});
assert(selected.metadata.exports.includes('sprite_resources_request'));
const script=`local Game={}; local lease; local e; local revision
local appearance={transform={position={x=7,y=9},rotation=.5,scale={x=2,y=3}},size={x=4,y=5},sheet={columns=2,rows=2},frame=3,uniforms={shade={.2,.3,.4,.5}}}
function Game.start(api)
 e=api.entity.spawn('hero');lease=api.sprite.prepare('texture://hero','tint')
 assert(type(lease)=='userdata' and type(lease.id)=='string')
 assert(not pcall(function() lease.id='forged' end));assert(not pcall(api.save.set,lease))
end
function Game.update(api)
 if api.input.isDown('commit') then revision=api.sprite.commit(e,lease,appearance) end
 if api.input.isDown('bad') then local bad=table.clone(appearance);bad.uniforms={shade=4};assert(not pcall(api.sprite.commit,e,lease,bad)) end
 if api.input.isDown('move') then api.entity.setPosition(e,{x=11,y=12}) end
 if api.input.isDown('release') then api.sprite.release(lease);api.sprite.release(lease) end
 if api.input.isDown('hide') then api.entity.setSpriteVisible(e,false) end
 if api.input.isDown('fail') then error('expected update failure') end
 api.observation.set('status',api.sprite.status(lease));api.observation.set('commit',api.sprite.getCommit(e));api.observation.set('revision',revision)
end
return Game`;
report.pins.fixture={sha256:sha(script),bytes:Buffer.byteLength(script)};
const payload={config:{name:'sprite-resources-wasm',entry_script:'main.luau'},script,
  asset_catalog:[{id:'texture://hero',kind:'texture2d'}],
  scene:{shader_materials:{tint:{fragment:'vec4 unoneShade(vec2 uv, vec4 color) { return color * shade; }',uniforms:{shade:[1,1,1,1]}}}}};
let core;
const check=(name,fn)=>{fn();report.checks.push(name);};
try{
 const module=await instantiateEmittedRuntime({...selected,timeoutMs:30000,diagnostics:report});
 assert.equal(typeof module._unone_web_sprite_resources_request,'function');
 core=createRuntimeCore(module,{requirePhysicalViewport:false});
 const load=()=>core.execute({kind:'load',payload,seed:'42'});
 const tick=(actions={},presentation_resources)=>core.execute({kind:'tick',input:{actions,...(presentation_resources?{presentation_resources}:{})}});
 const start=await load(),plan=start.sprite_resource_plan,id=plan.resources[0].id;
 check('opaque lease prepares a typed captured material plan',()=>{assert.equal(plan.resources.length,1);assert.equal(plan.resources[0].asset,'texture://hero');assert.equal(plan.resources[0].material_id,'tint');});
 let state=await tick({commit:true});
 check('loading cannot publish partial appearance and unchanged plan is omitted',()=>{assert(!state.world.entities.hero.sprite);assert.equal(state.world.observations.commit.state,'none');assert(!Object.hasOwn(state,'sprite_resource_plan'));});
 const ready=epoch=>({resources:[{id,state:'ready',epoch,bytes:64}]});
 state=await tick({commit:true},ready(1));
 const revision=state.world.entities.hero.sprite_appearance.revision;
 check('prepared receipt atomically publishes UV pose size and independent uniforms',()=>{const e=state.world.entities.hero;assert.equal(e.sprite.frame,3);assert.equal(e.transform.x,7);assert.deepEqual(e.sprite_uniforms.shade,[.2,.3,.4,.5]);assert.deepEqual(state.world.shader_materials.tint.uniforms.shade,[1,1,1,1]);assert.equal(state.world.observations.commit.state,'pending');});
 state=await tick({commit:true,bad:true});
 check('invalid instance uniform cannot mutate the accepted revision',()=>assert.equal(state.world.entities.hero.sprite_appearance.revision,revision));
 state=await tick({move:true},{appearances:[{entity:'hero',revision,state:'submitted',epoch:1}]});
 check('submission is distinct and live movement retains ownership',()=>{assert.equal(state.world.observations.commit.submittedRevision,revision);assert.equal(state.world.entities.hero.transform.x,11);});
 state=await tick({}, {resources:[{id,state:'loading',epoch:2,bytes:0}],appearances:[{entity:'hero',revision,state:'submitted',epoch:1}]});
 check('new epoch invalidates prior submission receipt',()=>{assert.equal(state.world.observations.status.epoch,2);assert.equal(state.world.observations.commit.state,'pending');});
 await tick({},ready(2));state=await tick({release:true});
 check('idempotent caller release preserves visible entity demand',()=>{assert.equal(state.world.observations.status.state,'released');assert.equal(state.sprite_resource_plan.resources.length,1);assert.equal(state.sprite_resource_plan.resources[0].id,id);});
 state=await tick({hide:true});
 check('hide drops last entity demand and invalidates commit',()=>{assert.deepEqual(state.sprite_resource_plan.resources,[]);assert.equal(state.world.observations.commit.state,'none');});
 const reset=await load(),resetId=reset.sprite_resource_plan.resources[0].id;
 await assert.rejects(tick({commit:true,fail:true},{resources:[{id:resetId,state:'ready',epoch:1,bytes:64}]}),/expected update failure/);
 state=await tick({commit:true});
 check('failed tick keeps admitted feedback and rolls back appearance revision',()=>{assert.equal(state.world.observations.status.state,'ready');assert.equal(state.world.entities.hero.sprite_appearance.revision,1);});
 await assert.rejects(tick({}, {resources:[{id:resetId,state:'ready',epoch:1.5,bytes:0}]}));
 check('fractional epoch input is rejected by actual Core',()=>{});
 report.ok=true;
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}
finally{try{core?.close();report.unloaded=true;}catch(error){report.cleanup_error=String(error);report.ok=false;process.exitCode=1;}
 fs.mkdirSync(out,{recursive:false});fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2)+'\n');
 fs.writeFileSync(path.join(out,'fixture.luau'),script);console.log(JSON.stringify({ok:report.ok,checks:report.checks.length,out,error:report.error??null}));}
