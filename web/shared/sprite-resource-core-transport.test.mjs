import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {savePublication} from './save-publication.mjs';
const moduleUrl=new URL('./runtime-core.mjs',import.meta.url);
async function implementation(){
 const mutant=process.env.UNONE_SPRITE_CORE_MUTANT;
 if(!mutant)return import(moduleUrl.href);
 let source=fs.readFileSync(moduleUrl,'utf8');
 if(mutant==='ui-cache-control')source=source.replace('const plan=JSON.parse(controlDecoder.decode(module.HEAPU8.subarray(pointer,pointer+length)));','const plan=read();');
 else if(mutant==='clone-envelope')source=source.replace("if(Object.hasOwn(plan,'resources'))value.sprite_resource_plan=plan;","if(Object.hasOwn(plan,'resources'))value={...value,sprite_resource_plan:plan};");
 else throw Error('Unknown transport mutant');
 source=source.replace(/from '(\.\/[^']+)'/g,(_,file)=>`from '${new URL(file,moduleUrl).href}'`);
 return import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
}
const {createRuntimeCore}=await implementation();
function runtime(){
 const encoder=new TextEncoder(),decoder=new TextDecoder();let length=0,inputLength=0,frame=0,revision=1;
 const requests=[],module={HEAPU8:new Uint8Array(65536),_unone_web_alloc:n=>{inputLength=n;return 0;},_unone_web_observation_ptr:()=>4096,_unone_web_observation_len:()=>length};
 const tree=encoder.encode(JSON.stringify({kind:'screen',id:'root',children:[]})),save=encoder.encode('{"gold":7}');
 module.HEAPU8.set(tree,32768);module.HEAPU8.set(save,40000);
 const publish=value=>{const bytes=encoder.encode(JSON.stringify(value));module.HEAPU8.set(bytes,4096);length=bytes.length;return 0;};
 const world=()=>publish({world:{frame,instances3d:{}},observation_digest:'sha256:untouched',
  ui_tree_transport:{format:'ui-tree-memory-v1',epoch:'1',revision:'1',memory:{offset:32768,byte_length:tree.length}},
  save_transport:{format:'save-memory-v1',epoch:'1',revision:'1',memory:{offset:40000,byte_length:save.length}}});
 module._unone_web_load_project=world;module._unone_web_set_instance_transport=world;module._unone_web_set_viewport_aspect=()=>0;
 module._unone_web_set_input_frame=()=>0;module._unone_web_tick=()=>{frame++;return world();};
 module._unone_web_sprite_resources_request=()=>{const request=JSON.parse(decoder.decode(module.HEAPU8.subarray(0,inputLength)));requests.push(request);return publish(request.after===revision?{revision}:{revision,resources:[{id:'1',asset:'texture://page'}]});};
 return{core:createRuntimeCore(module),requests,changePlan(){revision++;}};
}
test('compact intent polls preserve UI identity and retained-save provenance',async()=>{
 const f=runtime(),first=await f.core.execute({kind:'load',payload:{config:{}}});
 assert.equal(first.sprite_resource_plan.revision,1);assert(savePublication(first),'retained save provenance must survive plan attachment');
 const second=await f.core.execute({kind:'tick',input:{actions:{}}});
 assert.equal(first.world.ui,second.world.ui,'detached plan controls must preserve retained UI identity');
 assert.equal(savePublication(first).token,savePublication(second).token);
 assert.equal(second.sprite_resource_plan,undefined);assert.equal(second.observation_digest,'sha256:untouched');
 assert.deepEqual(f.requests,[{kind:'plan',after:null},{kind:'plan',after:1}]);
 f.changePlan();const third=await f.core.execute({kind:'tick',input:{actions:{}}});
 assert.equal(third.sprite_resource_plan.revision,2);assert.equal(savePublication(third).token,savePublication(first).token);
 f.core.close();
});
