import test from 'node:test';
import assert from 'node:assert/strict';
const {completeStartupPresentation,adoptStartupRenderer}=await import(process.env.UNONE_STARTUP_MODULE??'./startup-presentation.mjs');
const flush=async()=>{for(let n=0;n<12;n++)await Promise.resolve();};
function fixture(change={}){
 let rawLost=false,state='presented',time=0,sequence=0,epoch=1,generation=1,unstable=false,drawError=null;
 const frames=new Map(),timers=new Map(),listeners=new Set(),trace=[],phases=[],abort=new AbortController();let id=0;
 const token=()=>({context_epoch:epoch,target_generation:generation,physical_size:[1280,720],dpr:1,game_draw_sequence:sequence});
 const sample=()=>{if(state==='disposed')throw Error('PROJECTED_RASTER_DISPOSED');if(rawLost)state='lost';if(state==='failed')throw Error('real profile mismatch');
  return {state,token:state==='presented'?token():null};};
 const options={draw(){trace.push('draw');if(drawError)throw drawError;if(!rawLost&&!unstable){state='presented';sequence++;}},
  waitForAssets:async()=>trace.push('assets'),sample,subscribe:f=>{listeners.add(f);return()=>listeners.delete(f);},
  nextFrame:f=>{frames.set(++id,f);return id;},cancelFrame:n=>frames.delete(n),
  timer:(f,ms)=>{timers.set(++id,{f,at:time+ms});return id;},clearTimer:n=>timers.delete(n),now:()=>time,
  commit(){trace.push('READY','scheduler');},onState:s=>phases.push(s),signal:abort.signal,...change};
 const result={settled:false,error:null};const promise=completeStartupPresentation(options).then(()=>result.settled=true,e=>{result.settled=true;result.error=e;});
 return {trace,frames,timers,listeners,phases,abort,promise,result,options,
  lose(){rawLost=true;},restore(){rawLost=false;state='needs_draw';epoch++;generation++;for(const f of [...listeners])f();},
  notify(){for(const f of [...listeners])f();},dispose(){state='disposed';for(const f of [...listeners])f();},
  unstable(){unstable=true;state='needs_draw';},failDraw(){drawError=Error('real shader fault');},
  async frame(before=()=>{}){const fs=[...frames.values()];frames.clear();before();for(const f of fs)f(time);await flush();},
  async advance(ms,fire=true){time+=ms;if(fire)for(const [n,t] of [...timers])if(t.at<=time){timers.delete(n);t.f();}await flush();}};
}
test('healthy path retains two draws and commits READY/scheduler inside the final RAF callback once',async()=>{
 const h=fixture();await flush();assert.deepEqual(h.trace,['draw','assets','draw']);assert.equal(h.frames.size,1);
 await h.frame();await h.promise;assert.deepEqual(h.trace,['draw','assets','draw','READY','scheduler']);
 assert.equal(h.frames.size+h.timers.size+h.listeners.size,0);
});
test('last RAF raw loss before event cannot emit stale READY; restore revalidates/redraws before commit',async()=>{
 const h=fixture();await flush();await h.frame(()=>h.lose());
 assert.ok(!h.trace.includes('READY'));assert.equal(h.result.settled,false);assert.equal(h.frames.size,0);assert.equal(h.listeners.size,1);
 h.restore();await flush();await h.frame();assert.ok(!h.trace.includes('READY'));await h.frame();await h.promise;
 assert.equal(h.trace.filter(x=>x==='READY').length,1);assert.equal(h.trace.filter(x=>x==='draw').length,3);
 assert.equal(h.phases.at(-1).phase,'ready');assert.equal(h.frames.size+h.timers.size+h.listeners.size,0);
});
test('restore before subscription sample closes missed-event race and genuine shader failure stays terminal',async()=>{
 let h;h=fixture({subscribe:f=>{h.restore();return()=>{};}});await flush();await h.frame(()=>h.lose());
 await h.frame();await h.frame();await h.promise;assert.equal(h.result.error,null);
 const bad=fixture();await flush();await bad.frame(()=>bad.lose());bad.failDraw();bad.restore();await flush();await bad.frame();await bad.promise;
 assert.match(bad.result.error.message,/real shader fault/);assert.ok(!bad.trace.includes('READY'));
});
test('cumulative lost wait is bounded; delayed timer cannot let late restore commit',async()=>{
 const h=fixture();await flush();await h.frame(()=>h.lose());assert.equal(h.timers.size,1);
 await h.advance(30000);h.restore();await flush();await h.frame();await h.frame(()=>h.lose());
 await h.advance(30001,false);h.restore();await flush();await h.promise;
 assert.match(h.result.error.message,/CONTEXT_RECOVERY_TIMEOUT/);assert.ok(!h.trace.includes('READY'));
 assert.equal(h.frames.size+h.timers.size+h.listeners.size,0);
});
test('32-attempt budget rejects continuously unstable presentation without a busy poll',async()=>{
 const h=fixture();h.unstable();await flush();for(let n=0;n<40&&!h.result.settled;n++)await h.frame();await h.promise;
 assert.match(h.result.error.message,/PRESENTATION_UNSTABLE/);assert.equal(h.trace.filter(x=>x==='draw').length,32);
 assert.ok(!h.trace.includes('READY'));assert.equal(h.frames.size+h.timers.size+h.listeners.size,0);
});
test('abort/pagehide cancels pending RAF, lost subscription, and late asset completion',async()=>{
 const frame=fixture();await flush();frame.abort.abort();await flush();assert.equal(frame.result.settled,true);await frame.promise;assert.equal(frame.result.error.name,'AbortError');assert.equal(frame.frames.size,0);
 const lost=fixture();await flush();await lost.frame(()=>lost.lose());lost.abort.abort();await lost.promise;lost.restore();await flush();
 assert.equal(lost.result.error.name,'AbortError');assert.equal(lost.frames.size+lost.timers.size+lost.listeners.size,0);
 let release;const assets=fixture({waitForAssets:()=>new Promise(r=>release=r)});await flush();assets.abort.abort();await flush();assert.equal(assets.result.settled,true);await assets.promise;
 release();await flush();assert.equal(assets.trace.filter(x=>x==='draw').length,1);assert.ok(!assets.trace.includes('READY'));
});
test('disposed/terminal state wakes wait and fails closed, no implicit context or World reconstruction',async()=>{
 const h=fixture();await flush();await h.frame(()=>h.lose());h.dispose();await flush();assert.equal(h.result.settled,true);
 await h.promise;assert.match(h.result.error.message,/DISPOSED/);assert.ok(!h.trace.includes('READY'));assert.equal(h.listeners.size,0);
});
test('late factory resolve after pagehide disposes once, constructor throws stay terminal and are not retried',async()=>{
 const abort=new AbortController();let release,calls=0,disposed=0;
 const pending=adoptStartupRenderer(()=>{calls++;return new Promise(r=>release=r);},{signal:abort.signal,dispose:()=>disposed++});
 abort.abort();release({});await assert.rejects(pending,{name:'AbortError'});assert.equal(calls,1);assert.equal(disposed,1);
 const error=Error('constructor failed');await assert.rejects(adoptStartupRenderer(async()=>{throw error;},{dispose:()=>disposed++}),e=>e===error);
 assert.equal(disposed,1);
});
test('committing observer cannot invalidate the final sample and still emit READY',async()=>{
 let h,once=true;h=fixture({onState:s=>{if(s.phase==='committing'&&once){once=false;h.lose();}}});
 await flush();await h.frame();assert.ok(!h.trace.includes('READY'));assert.equal(h.result.settled,false);
 h.restore();await flush();await h.frame();await h.frame();await h.promise;assert.equal(h.result.error,null);
});
