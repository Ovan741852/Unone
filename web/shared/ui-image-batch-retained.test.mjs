import test from 'node:test';
import assert from 'node:assert/strict';
import {createImageBatchResolver,imageBatchSnappedRect} from './ui-image-batch.mjs';
import {retainImageResource} from './retained-image-generation.mjs';
import {uiUsage} from './ui-geometry.mjs';
import {createCanvasUi} from './canvas-ui.mjs';
import {DRAW_COMPLETED,DRAW_SKIPPED} from './player-completion.mjs';
import {createUiTreePublication} from './ui-tree-publication.mjs';
const rect={x:0,y:0,width:100,height:100};
const resource=(extra={})=>({revision:1,bounds:{x:-10,y:-5,width:30,height:20},quads:[{asset:'asset://a',rect:{x:-10,y:-5,width:20,height:10},source:{x:1,y:2,width:3,height:4},opacity:.5}],...extra});
const node=(content='art',extra={})=>({kind:'image_batch',id:'map',rect,content,...extra});

test('pixel snapping is explicit final-framebuffer placement, preserves shared edges and rejects unsupported transforms',()=>{
 const resolver=createImageBatchResolver(),resources={art:retainImageResource(resource())},n=node('art',{pixel_snap:true,transform:{a:1.25,b:0,c:0,d:.75,tx:20.25,ty:30.5}}),instance=resolver.resolve(n,resources);
 assert.equal(instance.pixelSnap,true);assert.equal(resolver.resolve(node(),resources).pixelSnap,false);
 for(const [width,height]of [[100,100],[1600,900],[3200,1800]]){
  const a=imageBatchSnappedRect(instance,{x:0,y:0,width:3.125,height:4.25},width,height),b=imageBatchSnappedRect(instance,{x:3.125,y:0,width:2,height:4.25},width,height);
  assert.equal(a.x+a.width,b.x);assert.equal(a.y,b.y);assert.equal(a.height,b.height);
  for(const v of Object.values(a))assert(Number.isInteger(v));
 }
 const t={...instance,transform:{a:1,b:0,c:0,d:1,tx:0,ty:0}};
 assert.deepEqual(imageBatchSnappedRect(t,{x:-.5,y:-.5,width:1,height:1},100,100),{x:-1,y:99,width:2,height:2});
 assert.deepEqual(imageBatchSnappedRect({...t,transform:{a:-1,b:0,c:0,d:-1,tx:0,ty:0}},{x:0,y:0,width:1,height:2},100,100),{x:0,y:102,width:-1,height:-2});
 assert.equal(imageBatchSnappedRect(t,{x:0,y:0,width:.1,height:1},100,100).width,0);
 assert.throws(()=>resolver.resolve({...n,pixel_snap:'true'},resources),/UI_IMAGE_BATCH_PIXEL_SNAP/);
 for(const extra of [{b:1},{c:1}])assert.throws(()=>resolver.resolve({...n,transform:{...n.transform,...extra}},resources),/UI_IMAGE_BATCH_PIXEL_SNAP_TRANSFORM/);
 assert.equal(resolver.resolve({...n,pixel_snap:false,transform:{...n.transform,b:1}},resources).pixelSnap,false);
});

test('Canvas snaps after affine placement at DPR, retains source/opacity/clip and skips collapsed quads',async()=>{
 const calls=[],transforms=[],clips=[],stack=[],ctx={globalAlpha:1,setTransform(){},clearRect(){},beginPath(){},rect(...r){clips.push(r)},clip(){},
  save(){stack.push(this.globalAlpha)},restore(){this.globalAlpha=stack.pop()},transform(...t){transforms.push(t)},drawImage(...args){calls.push({args,alpha:this.globalAlpha})}};
 const ui=createCanvasUi({width:100,height:100,getContext:()=>ctx},{resolveAsset:()=>({width:10,height:10})});
 const data=resource({bounds:{x:0,y:0,width:10,height:10},quads:[{asset:'asset://a',rect:{x:0,y:0,width:3.125,height:4.25},source:{x:1,y:2,width:3,height:4},opacity:.25},{asset:'asset://a',rect:{x:0,y:0,width:.001,height:1}}]}),
  snapshot={world:{ui_image_batches:{art:retainImageResource(data)},ui:{children:[node('art',{rect:{x:10.1,y:20.2,width:80,height:70},pixel_snap:true,transform:{a:1.25,b:0,c:0,d:.75,tx:20.25,ty:30.5}})]}}};
 ui.draw(snapshot,{width:200,height:100,dpr:2});await new Promise(setImmediate);calls.length=transforms.length=clips.length=0;
 assert.equal(ui.draw(snapshot,{width:200,height:100,dpr:2}),DRAW_COMPLETED);
 assert.deepEqual(clips[0],[40.4,19.599999999999994,320,140]);
 assert.deepEqual(transforms[0],[1,0,0,1,81,133]);assert.equal(calls.length,1);
 assert.deepEqual(calls[0].args.slice(1),[1,2,3,4,0,0,16,6]);assert.equal(calls[0].alpha,.25);
 ui.dispose();
});

test('resource IDs use the Core1024 UTF8-byte bound including Unicode and prototype-like names',()=>{
 const resolver=createImageBatchResolver();
 for(const id of ['a'.repeat(129),'a'.repeat(1024),'測'.repeat(341)+'x','__proto__','toString']){
  const resources=Object.fromEntries([[id,retainImageResource(resource())]]);assert.equal(resolver.resolve(node(id),resources).definition.quads.length,1);
 }
 for(const id of ['a'.repeat(1025),'測'.repeat(342),' ', ''])assert.throws(()=>resolver.resolve(node(id),{}),/UI_IMAGE_RESOURCE_ID/);
 assert.throws(()=>resolver.resolve(node('toString'),{}),/UI_IMAGE_RESOURCE_MISSING/);
});

test('immutable grants reuse admitted content; raw same-ID/revision mutations compare complete data and reload grants stay distinct',()=>{
 const resolver=createImageBatchResolver(),data=resource(),owned=retainImageResource(resource()),map={art:owned},first=resolver.resolve(node(),map).definition;
 for(let i=0;i<100;i++)assert.equal(resolver.resolve(node(),map).definition,first);
 assert.notEqual(resolver.resolve(node(),{art:retainImageResource(resource())}).definition.token,first.token);
 const rawFirst=resolver.resolve(node(),{art:data}).definition;data.quads[0].opacity=.25;const next=resolver.resolve(node(),{art:data}).definition;
 assert.notEqual(next.token,rawFirst.token);assert.equal(rawFirst.quads[0].opacity,.5);assert.equal(next.quads[0].opacity,.25);
 data.quads[0].rect.width=NaN;assert.throws(()=>resolver.resolve(node(),{art:data}),/UI_IMAGE_BATCH_BOUNDS/);
 assert.equal(first.requirements[0].maxX,4);assert.equal(first.requirements[0].maxY,6);assert(Object.isFrozen(first.quads[0].rect));
});

test('local bounds/transforms and referenced UI budgets remain explicit and strict',()=>{
 const resolver=createImageBatchResolver(),resources={art:retainImageResource(resource())},n=node('art',{transform:{a:0,b:0,c:0,d:0,tx:50,ty:50}});
 assert.equal(resolver.resolve(n,resources).transform.a,0);assert.equal(uiUsage({budget:{max_nodes:2},children:[n]},{imageBatches:resources}).logical_nodes,2);
 assert.throws(()=>uiUsage({budget:{max_nodes:1},children:[n]},{imageBatches:resources}),/UI_NODE_LIMIT/);
 assert.throws(()=>resolver.resolve({...n,quads:[]},resources),/UI_IMAGE_BATCH_FIELDS/);
 assert.throws(()=>resolver.resolve({...n,transform:{...n.transform,a:Infinity}},resources),/UI_IMAGE_BATCH_TRANSFORM/);
 assert.throws(()=>resolver.resolve({...n,transform:{...n.transform,typo:1}},resources),/UI_IMAGE_BATCH_TRANSFORM/);
 const scroll={kind:'scroll_view',id:'s',rect,scroll:{axis:'vertical',enabled:true},children:[n]};
 assert.throws(()=>uiUsage({children:[scroll]},{imageBatches:resources}),/UI_IMAGE_BATCH_SPACE/);
});

test('Canvas calls prefix presenter every draw, retains unchanged HUD pixels on transform-only updates and retires GPU before closing images',async()=>{
 const events=[],painted=[],ctx={setTransform(){},clearRect(){events.push('clear')},save(){},restore(){},beginPath(){},rect(){},clip(){},transform(){},drawImage(){events.push('image')},fillText:t=>painted.push(t),measureText:()=>({width:1})};
 let calls=0,enabled=true;const presenter={clear(){events.push('retire')},drawPrefix(prefix,context){calls++;return enabled&&prefix.every(p=>p.definition.assets.every(id=>context.images.get(id)?.state==='ready'))?prefix.length:0;}};
 const ui=createCanvasUi({width:100,height:100,getContext:()=>ctx},{resolveAsset:()=>({width:10,height:10,close(){events.push('close')}}),getImageBatchPresenter:()=>presenter});
 const n=node(),snapshot={world:{ui_image_batches:{art:retainImageResource(resource())},ui:{children:[n,{kind:'button',id:'hud',rect:{x:20,y:20,width:40,height:20},text:'HUD',action:'Go'}]}}};
 assert.equal(ui.draw(snapshot,{width:100,height:100,dpr:1}),DRAW_SKIPPED.ui_assets_pending);await new Promise(setImmediate);
 assert.equal(ui.draw(snapshot),DRAW_COMPLETED);const clears=events.filter(e=>e==='clear').length,paints=painted.length;
 n.transform={a:1,b:0,c:0,d:1,tx:.25,ty:.5};ui.draw(snapshot);ui.draw(snapshot);
 assert.equal(calls,4);assert.equal(events.filter(e=>e==='clear').length,clears);assert.equal(painted.length,paints);assert.equal(ui.hitTest(25,25).action,'Go');
 enabled=false;ui.draw(snapshot);assert.equal(events.filter(e=>e==='clear').length,clears+1);assert(events.includes('image'));
 ui.draw({world:{ui:{children:[]}}});assert(events.lastIndexOf('retire')<events.lastIndexOf('close'));assert.equal(ui.report().nodes,0);ui.dispose();
});

test('Canvas resource replacement invalidates unchanged node contents and missing assets never count completed',async()=>{
 const ctx={setTransform(){},clearRect(){},save(){},restore(){},beginPath(){},rect(){},clip(){},transform(){},drawImage(){}};let draws=0;
 const ui=createCanvasUi({width:100,height:100,getContext:()=>({...ctx,drawImage(){draws++}})},{resolveAsset:()=>({width:10,height:10})});
 const snapshot={ui:createUiTreePublication(JSON.stringify({children:[node()]})).value,ui_image_batches:{art:retainImageResource(resource())}};
 ui.draw(snapshot);await new Promise(setImmediate);assert.equal(ui.draw(snapshot),DRAW_COMPLETED);const before=draws;
 snapshot.ui_image_batches.art=retainImageResource(resource({revision:2,quads:[{asset:'asset://a',rect:{x:0,y:0,width:10,height:10}}]}));
 ui.draw(snapshot);assert.equal(draws,before+1);ui.dispose();
 const failed=createCanvasUi({width:100,height:100,getContext:()=>ctx},{resolveAsset:()=>{throw Error('failed asset')}});
 failed.draw(snapshot);await new Promise(setImmediate);assert.equal(failed.draw(snapshot),DRAW_SKIPPED.ui_diagnostics);failed.dispose();
});

test('Canvas readiness follows only current assets, ignores retired unresolved work and rejects diagnostics/disposal',async()=>{
 const pending=new Map(),ctx={setTransform(){},clearRect(){},save(){},restore(){},beginPath(){},rect(){},clip(){},transform(){},drawImage(){}};
 const ui=createCanvasUi({width:100,height:100,getContext:()=>ctx},{resolveAsset:id=>new Promise((resolve,reject)=>pending.set(id,{resolve,reject}))});
 const image=asset=>({ui:{children:[{kind:'image',id:'image',asset,rect,fit:'stretch'}]}});
 ui.draw(image('asset://old'));await new Promise(setImmediate);let settled=false;const ready=ui.ready().then(()=>settled=true);
 ui.draw(image('asset://current'));await new Promise(setImmediate);assert.equal(settled,false);
 pending.get('asset://current').resolve({width:8,height:8});await ready;assert.equal(settled,true);
 ui.draw(image('asset://failed'));await new Promise(setImmediate);const rejected=assert.rejects(ui.ready(),/UI_ASSET_FAILED: asset:\/\/failed/);pending.get('asset://failed').reject(Error('decode failed'));await rejected;
 ui.draw({ui:{children:[]}});await ui.ready();
 ui.draw(image('asset://dispose'));await new Promise(setImmediate);const disposed=assert.rejects(ui.ready(),/UI_DISPOSED/);ui.dispose();await disposed;
 let closed=0;pending.get('asset://old').resolve({width:8,height:8,close(){closed++;}});await new Promise(setImmediate);assert.equal(closed,1);
});

test('invalidation transfers an existing readiness waiter to the new required generation without a draw',async()=>{
 const pending=[],ctx={setTransform(){},clearRect(){},save(){},restore(){},beginPath(){},rect(){},clip(){},drawImage(){}};
 const ui=createCanvasUi({width:100,height:100,getContext:()=>ctx},{resolveAsset:()=>new Promise(resolve=>pending.push(resolve))});
 ui.draw({ui:{children:[{kind:'image',id:'image',asset:'asset://a',rect,fit:'stretch'}]}});await new Promise(setImmediate);
 let settled=false,closed=0;const ready=ui.ready().then(()=>settled=true);ui.invalidateAssets();await new Promise(setImmediate);assert.equal(pending.length,2);
 pending[0]({width:8,height:8,close(){closed++;}});await new Promise(setImmediate);assert.equal(settled,false);assert.equal(closed,1);
 pending[1]({width:8,height:8});await ready;assert.equal(settled,true);ui.dispose();
});
