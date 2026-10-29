import test from 'node:test';
import assert from 'node:assert/strict';
import * as diagnostics from './raster-diagnostics.mjs';
const api=()=>{assert.equal(typeof diagnostics.createPlayerProfiler,'function','player profiler export');return diagnostics;};
function clock(){let t=0;return {now:()=>t,advance:n=>{t+=n;}};}
test('profiling is opt-in by explicit URL flag and the limit is bounded',()=>{
 const {playerProfileOptions}=api();
 for(const search of ['','?backend=worker','?unone_profile=0','?unone_profile=true'])assert.equal(playerProfileOptions(search),null);
 assert.deepEqual(playerProfileOptions('?unone_profile=1'),{limit:256});
 assert.deepEqual(playerProfileOptions('?unone_profile=1&unone_profile_limit=16'),{limit:16});
 for(const bad of ['15','2049','1.5','x'])assert.throws(()=>playerProfileOptions('?unone_profile=1&unone_profile_limit='+bad),/PLAYER_PROFILE_LIMIT_INVALID/);
});
test('events have unique identities across kinds and clears; ring is bounded with explicit overwritten count',()=>{
 const c=clock(),p=api().createPlayerProfiler({now:c.now,limit:4});
 const ids=[];for(let i=0;i<6;i++){const e=p.begin(i%2?'draw':'update');c.advance(1);ids.push(p.end(e,'ok').id);}
 assert.deepEqual(ids,['update:1','draw:1','update:2','draw:2','update:3','draw:3']);
 let r=p.report();assert.equal(r.events.length,4);assert.equal(r.counts.overwritten,2);assert.equal(r.counts.completed,6);
 assert.deepEqual(r.events.map(e=>e.id),ids.slice(2));
 p.clear();r=p.report();assert.equal(r.events.length,0);assert.equal(r.counts.cleared,4);
 assert.equal(p.end(p.begin('update'),'ok').id,'update:4','identities never restart after clear');
});
test('consecutive marks and nested renderer scope never produce overlapping siblings',()=>{
 const c=clock(),p=api().createPlayerProfiler({now:c.now});const e=p.begin('draw');
 c.advance(1);p.mark(e,'interpolation_sample');
 p.within(e,'renderer_draw',()=>{c.advance(2);p.renderer.mark('frame_decode_validate');c.advance(3);p.renderer.mark('frame_resource_prepare');p.renderer.outcome('completed');});
 c.advance(4);p.mark(e,'ui_draw');const r=p.end(e,p.outcomeOf(e)??'ok');
 assert.equal(r.status,'completed');assert.equal(r.wall_ms,10);
 assert.deepEqual(r.spans.map(s=>[s.name,s.parent,s.start_ms,s.end_ms]),[
  ['interpolation_sample',null,0,1],['frame_decode_validate','renderer_draw',1,3],['frame_resource_prepare','renderer_draw',3,6],['renderer_draw',null,1,6],['ui_draw',null,6,10]]);
 const top=r.spans.filter(s=>s.parent===null).reduce((n,s)=>n+s.ms,0);assert.equal(top,r.wall_ms);
 p.renderer.mark('outside');assert.equal(p.report().counts.orphan_marks,1,'renderer marks outside a draw scope are counted, not attributed');
});
test('resource providers are copied at scope entry, so a live shared stats object reports the real delta',()=>{
 const c=clock(),p=api().createPlayerProfiler({now:c.now}),live={frame_geometry_builds:0,frame_live_geometries:0,label:'x'};
 p.provide('frame_resources',()=>live);p.provide('gl',()=>({calls:live.frame_geometry_builds*2,mode:'webgl'}),'after');
 const e=p.begin('draw');p.within(e,'renderer_draw',()=>{live.frame_geometry_builds+=3;live.frame_live_geometries+=3;});
 const r=p.end(e,'ok');
 assert.deepEqual(r.resources.frame_resources,{before:{frame_geometry_builds:0,frame_live_geometries:0},after:{frame_geometry_builds:3,frame_live_geometries:3},delta:{frame_geometry_builds:3,frame_live_geometries:3}});
 assert.deepEqual(r.resources.gl,{after:{calls:6,mode:'webgl'}});
 live.frame_geometry_builds=99;assert.equal(p.report().events[0].resources.frame_resources.after.frame_geometry_builds,3,'recorded values are not live views');
});
test('failed, rejected, abandoned events keep identity; error text and payloads are not exposed',()=>{
 const c=clock(),p=api().createPlayerProfiler({now:c.now,limit:3});
 const e=p.begin('command',{command_kind:'tick',input:{secret:1},note:'x'.repeat(500)});
 const r=p.end(e,'error',{error:Error('{"world":{"save_payload":"SECRET"}}')});
 assert.equal(r.attrs.command_kind,'tick');assert.equal(r.attrs.input,undefined);assert.equal(r.attrs.note,undefined);
 assert.equal(r.attrs.error_code,'UNCLASSIFIED');assert.equal(JSON.stringify(p.report()).includes('SECRET'),false);
 assert.equal(p.end(p.begin('command'),'rejected',{error:Error('RUNTIME_QUEUE_FULL')}).attrs.error_code,'RUNTIME_QUEUE_FULL');
 assert.equal(p.report().counts.dropped_attrs,2);
 const open=[p.begin('command'),p.begin('command'),p.begin('command'),p.begin('command')];
 const report=p.report();assert.equal(report.open.length,3,'open set is bounded');assert.equal(report.events.at(-1).status,'abandoned');
 assert.equal(report.events.at(-1).id,open[0].id);assert.equal(report.counts.abandoned,1);
 // review3: the review2 expectation here (end() throws PLAYER_PROFILE_EVENT_CLOSED) encoded a runtime defect.
 const retained=JSON.stringify(p.report().events);
 assert.equal(p.end(open[0],'ok'),null,'late end of an abandoned event is a counted no-op');
 assert.equal(JSON.stringify(p.report().events),retained,'abandoned record is not rewritten');assert.equal(p.report().counts.late_ends,1);
});
test('publication writes bounded read-only JSON to the dataset and reports its own cost',()=>{
 const c=clock(),body={dataset:{}},p=api().createPlayerProfiler({now:c.now,limit:8,publishTarget:body,publishEvery:2});
 p.end(p.begin('draw'),'ok');assert.equal(body.dataset.playerProfile,undefined);
 p.end(p.begin('draw'),'ok');const r=JSON.parse(body.dataset.playerProfile);
 assert.equal(r.schema,'unone.player-profile.v1');assert.equal(r.events.length,2);assert.equal(r.publish.count,1);
 p.end(p.begin('update'),'error',{error:Error('X_FAILED')});assert.equal(JSON.parse(body.dataset.playerProfile).publish.count,2,'errors publish immediately');
 p.record('context','lost',{context_epoch:2});assert.equal(JSON.parse(body.dataset.playerProfile).events.at(-1).id,'context:1');
});
test('snapshot source tags are host-only weak references',()=>{
 const p=api().createPlayerProfiler({now:()=>0}),value={world:{frame:1}};
 p.tag(value,'command:7');assert.equal(p.sourceOf(value),'command:7');assert.equal(p.sourceOf({}),null);assert.equal(Object.keys(value).length,1);
});
test('every late operation on an abandoned event is a bounded no-op that never alters caller results',()=>{
 const c=clock(),p=api().createPlayerProfiler({now:c.now,limit:16});p.provide('live',()=>({builds:1}));
 const draw=p.begin('draw');
 // The current draw is evicted while its renderer scope is still running.
 const value=p.within(draw,'renderer_draw',()=>{for(let i=0;i<16;i++)p.begin('command');p.renderer.mark('late_phase');p.renderer.outcome('completed');p.renderer.attach(()=>({x:1}));return 42;});
 assert.equal(value,42,'renderer result returned unchanged');
 p.mark(draw,'ui_draw');p.span(draw,'x',0,1);p.set(draw,{a:1});assert.equal(p.end(draw,'ok'),null);
 const error=Error('RENDER_FAILED');const evicted=p.begin('draw');for(let i=0;i<16;i++)p.begin('command');
 assert.throws(()=>p.within(evicted,'renderer_draw',()=>{throw error;}),e=>e===error,'original renderer error propagates');
 const r=p.report();assert.equal(r.counts.abandoned,18);assert.equal(r.counts.late_ends,1);
 assert.equal(r.counts.late_operations,8,'within x2, renderer mark/outcome/attach, mark, span, set');
 // Ring capacity 16 < 18 abandoned closes: the oldest are overwritten, never duplicated by late ends.
 assert.equal(r.counts.completed,18);assert.equal(r.counts.overwritten,2);assert.equal(r.events.length,16);
 const ids=r.events.map(e=>e.id);assert.equal(new Set(ids).size,ids.length);assert(r.events.every(e=>e.status==='abandoned'));
});
test('provider and publication faults are contained, counted and never replace results or errors',()=>{
 const c=clock(),body={dataset:{}};Object.defineProperty(body.dataset,'playerProfile',{set(){throw Error('QUOTA');}});
 const p=api().createPlayerProfiler({now:c.now,publishTarget:body,publishEvery:1});
 p.provide('bad',()=>{throw Error('PROVIDER_BROKEN');});p.provide('good',()=>({n:1}));
 const e=p.begin('draw');assert.equal(p.within(e,'renderer_draw',()=>7),7);
 const original=Error('DRAW_FAILED'),e2=p.begin('draw');
 assert.throws(()=>p.within(e2,'renderer_draw',()=>{throw original;}),x=>x===original);
 assert.doesNotThrow(()=>p.end(e,'completed'));assert.doesNotThrow(()=>p.end(e2,'error',{error:original}));
 const r=p.report();assert.equal(r.counts.provider_errors,4,'2 scopes x (before, after)');assert.equal(r.counts.publish_errors,2);
 assert.deepEqual(r.events[0].resources.good.delta,{n:0});assert.equal(r.events[0].resources.bad,undefined);
});
