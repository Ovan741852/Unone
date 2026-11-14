import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../player/main.js',import.meta.url),'utf8');
const start=source.indexOf('let stageDisplay='),end=source.indexOf('function acceptSnapshot(',start);
assert(start>=0&&end>start);
function fixture(){
 let context;const requests=[],accepted=[];
 const style=()=>({removeProperty(name){delete this[name];}});
 const canvas={style:style(),get clientWidth(){return parseFloat(this.style.width)||context.innerWidth;},get clientHeight(){return parseFloat(this.style.height)||context.innerHeight;}};
 const layer={style:style()};context=vm.createContext({canvas,document:{querySelector:()=>layer},window:{devicePixelRatio:1.5},innerWidth:800,innerHeight:1000,snapshot:null,renderer:null,fail:error=>{throw error;},backend:{request:async value=>{requests.push(value);return {world:{frame:1}};}},startupAbort:{signal:{aborted:false}},acceptSnapshot:(...args)=>accepted.push(args)});
 vm.runInContext(source.slice(start,end),context);vm.runInContext('stageDisplay={width:720,height:1280,aspect:"keep"};fitStage()',context);
 return {context,canvas,layer,requests,accepted,resize:()=>vm.runInContext('resizeStageViewport()',context)};
}
test('display refits both layers before a startup backend snapshot exists',async()=>{
 const f=fixture();assert.equal(f.canvas.style.width,'562px');f.context.innerWidth=440;f.context.innerHeight=782;await f.resize();assert.equal(f.canvas.style.width,'439px');assert.equal(f.layer.style.height,'780px');assert.equal(f.requests.length,0);
});
test('a resize missed by an in-flight project load is reconciled before presentation',async()=>{
 const f=fixture();f.context.innerWidth=440;f.context.innerHeight=782;await f.resize();vm.runInContext('snapshot={world:{}};sentViewport=[843,1500]',f.context);await f.resize();assert.equal(f.requests.length,1);assert.equal(f.requests[0].width,658);assert.equal(f.requests[0].height,1170);assert.equal(f.accepted.length,1);await f.resize();assert.equal(f.requests.length,1);
});
test('viewport requests remain deduplicated and stop after disposal',async()=>{
 const f=fixture();vm.runInContext('snapshot={world:{}}',f.context);await f.resize();for(let i=0;i<100;i++)await f.resize();assert.equal(f.requests.length,1);f.context.startupAbort.signal.aborted=true;f.context.innerWidth=300;await f.resize();assert.equal(f.requests.length,1);
});
test('the one resize listener is registered before startup and reused by restart',()=>{
 const listener="window.addEventListener('resize',()=>viewportChanged());";assert.equal(source.split(listener).length,2);assert(source.indexOf(listener)<source.indexOf('start().catch('));assert(source.includes('await resizeStageViewport();'));
});
