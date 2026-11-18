import test from 'node:test';
import assert from 'node:assert/strict';
import {createAtomicFramePresenter} from './atomic-frame-presenter.mjs';
const ok={status:'completed'},pending={status:'skipped',reason:'ui_assets_pending',presentation:'unchanged'};
function setup(){
 const calls=[];let begin=ok,prepared=ok,world=ok,ui=ok,submission={...ok,presentation:'submitted'},hostError=false;
 const candidate=Symbol('candidate'),transaction={begin(_s,opts){calls.push(['begin',opts.allowResize]);return typeof begin==='function'?begin(opts):begin;},
  commit(){calls.push(['submit']);return submission;},abort(){calls.push(['abort']);return ok;}};
 const presenter=createAtomicFramePresenter({transaction,prepare(){calls.push(['prepare']);return prepared;},drawWorld(){calls.push(['world']);return world;},
  drawUi(){calls.push(['ui']);return ui;},routeToken:()=>candidate,commitRoute:t=>calls.push(['route',t]),abortRoute:t=>calls.push(['abortRoute',t]),
  commitHosts(){calls.push(['hosts']);if(hostError)throw Error('host');},enterWait:x=>calls.push(['wait',x.reason]),
  recover:x=>calls.push(['recover',x.reason]),leaveWait:()=>calls.push(['leave'])});
 return {presenter,calls,set values(v){({begin=begin,prepared=prepared,world=world,ui=ui,submission=submission,hostError=hostError}=v);}};
}
test('successful submission publishes hosts and routing only after the GPU commit',()=>{
 const s=setup();s.presenter.present({});assert.deepEqual(s.calls.map(c=>c[0]),['prepare','begin','world','ui','submit','hosts','route','leave']);
});
test('pending preparation and draws leave old routing and GPU submission intact',()=>{
 for(const field of ['prepared','world','ui']){const s=setup();s.values={[field]:pending};s.presenter.present({});
  const names=s.calls.map(c=>c[0]);assert(!names.includes('submit'));assert(!names.includes('route'));assert(names.includes('wait'));
  if(field!=='prepared')assert(names.includes('abort'));if(field==='ui')assert(names.includes('abortRoute'));}
});
test('resize blocks and covers before canvas mutation, with recovery if a later stage fails',()=>{
 const s=setup();s.values={begin:opts=>opts.allowResize?{...ok,presentation:'unknown'}:{...pending,reason:'frame_resize_required'},ui:pending};
 s.presenter.present({});assert.deepEqual(s.calls.map(c=>c[0]),['prepare','begin','wait','begin','world','ui','abortRoute','abort','recover']);
});
test('unknown submission and post-submit host errors keep input covered',()=>{
 const a=setup();a.values={submission:{status:'skipped',reason:'context_lost',presentation:'unknown'}};a.presenter.present({});
 assert.deepEqual(a.calls.map(c=>c[0]),['prepare','begin','world','ui','submit','abortRoute','recover']);
 const b=setup();b.values={hostError:true};assert.throws(()=>b.presenter.present({}),/host/);
 assert.deepEqual(b.calls.map(c=>c[0]),['prepare','begin','world','ui','submit','hosts','abortRoute','recover']);
});
