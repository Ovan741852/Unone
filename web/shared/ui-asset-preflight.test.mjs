import test from 'node:test';import assert from 'node:assert/strict';
import {createUiAssetPreflight} from './ui-asset-preflight.mjs';
function harness(){let notify=0;const entries=new Map(),events=[];
 function acquire(id){events.push('acquire:'+id);let item=entries.get(id);if(!item){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});promise.catch(()=>{});item={state:'loading',promise,resolve,reject,leases:0};entries.set(id,item);}item.leases++;let released=false;return {get state(){return item.state},get error(){return item.error},promise:item.promise,release(){if(!released){released=true;item.leases--;events.push('release:'+id)}}};}
 return {entries,events,gate:createUiAssetPreflight({acquire,onChange:()=>notify++}),notify:()=>notify,resolve(id){const e=entries.get(id);e.state='ready';e.resolve({width:2,height:2});},reject(id){const e=entries.get(id);e.state='error';e.error=Error('network');e.reject(e.error);}};}
const snap=(...ids)=>({world:{ui:{kind:'screen',id:'s',children:ids.map((id,i)=>({kind:'image',id:'i'+i,asset:id,rect:{x:0,y:0,width:1,height:1}}))}}});
const tick=()=>new Promise(r=>setTimeout(r,0));
test('pins incoming before retiring outgoing, blocks only until ready, and ignores stale promises',async()=>{const h=harness();assert.equal(h.gate.update(snap('asset://a')).outcome.reason,'ui_assets_pending');
 h.gate.update(snap('asset://b'));assert.deepEqual(h.events.slice(0,3),['acquire:asset://a','acquire:asset://b','release:asset://a']);
 h.resolve('asset://a');await tick();assert.equal(h.notify(),0);h.resolve('asset://b');await tick();assert.equal(h.notify(),1);
 assert.equal(h.gate.update(snap('asset://b')).outcome.status,'completed');h.gate.release();assert.equal(h.entries.get('asset://b').leases,0);});
test('errors surface without suppressing rejection; cancellation releases exactly once',async()=>{const h=harness();h.gate.update(snap('asset://a'));h.reject('asset://a');await tick();let value=h.gate.update(snap('asset://a'));assert.equal(value.outcome.reason,'ui_diagnostics');assert.match(value.error.message,/network/);h.gate.dispose();h.gate.dispose();assert.equal(h.entries.get('asset://a').leases,0);});
test('walks components and all scroll children while exempting runtime data textures',()=>{const h=harness();const s={world:{ui:{children:[{kind:'component',children:[{kind:'scroll_view',children:[{kind:'image',asset:'asset://a'},{kind:'image',asset:'data-texture://b'}]}]}]}}};
 assert.equal(h.gate.update(s).outcome.reason,'ui_assets_pending');assert.deepEqual(h.events,['acquire:asset://a']);h.gate.dispose();});
