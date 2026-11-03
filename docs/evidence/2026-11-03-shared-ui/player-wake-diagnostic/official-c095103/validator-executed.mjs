import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {inspectHostSnapshot} from '../scripts/web-export-host.mjs';
const root='D:/Projects/Unone',hostRoot=root+'/artifacts/web-wake-ui-host-c095103-20261103';
const fingerprint='5e9b79155427125648a06ec65fb733dc2bc430161fbf99ac5129b7e41ffd8a2d';
const sha=b=>createHash('sha256').update(b).digest('hex'),host=JSON.parse(fs.readFileSync(hostRoot+'/host.json'));
assert.equal(host.source_commit,'c09510388b019df887680375a4f9c296dff5f52a');assert.equal(host.source_dirty,false);assert.equal(host.host_sha256,fingerprint);assert.equal(inspectHostSnapshot(hostRoot).sha256,fingerprint);assert.equal(host.files.length,111);
const results=[];
for(const backend of ['main','worker']){
 const file=root+'/.cache/wake-ui-'+backend+'-c095103-20261103.json',bytes=fs.readFileSync(file),capture=JSON.parse(bytes),d=capture.data,p=d.performance,s=p.sprite_resources,c=p.texture_cache,b=p.decoded_images;
 assert(Number(d.frame)>=1080);assert.equal(d.visibility,'visible');assert.equal(d.error,null);assert.equal(d.profile_error,null);assert.equal(p.backend.backend,backend);
 assert.deepEqual(d.canvases,[{width:1280,height:720},{width:1280,height:720}]);
 assert.equal(s.builds,2);assert.equal(s.texture_builds,1);assert.equal(s.retired,2);assert.equal(s.texture_retired,1);
 for(const key of ['entries','texture_entries','handles','live_textures','image_leases','pending','ready','errors','cpu_reserved_bytes_estimate','gpu_reserved_bytes_estimate','idle_material_entries'])assert.equal(s[key],0,backend+'/'+key);
 for(const key of ['entries','decoded_texture_bytes_estimate','pinned_bytes_estimate','loading','pressure_bytes','pressure_entries'])assert.equal(c[key],0,backend+'/cache/'+key);
 assert.equal(b.loads,1);assert.equal(b.resident_entries,1);assert.equal(b.resident_bytes_estimate,128);assert.equal(b.active_entries,0);assert.equal(b.loading,0);assert.equal(b.active_tasks,0);assert.equal(b.queued_tasks,0);
 for(const [kind,count]of Object.entries(p.completion.skip_counts))assert.equal(count,kind==='world_assets_pending'?1:0,backend+'/skip/'+kind);
 assert.equal(p.completion.error_draws,0);assert.equal(p.backend.wasm_linear_bytes,16777216);
 let profile=null;
 if(backend==='main'){
  assert.equal(d.profile.limit,64);assert.equal(d.profile.events_retained,64);assert.equal(d.profile.counts.retained,64);assert(d.profile.counts.overwritten>0);assert(d.profile.wakes.length>0);
  for(const key of ['abandoned','cleared','dropped_attrs','late_ends','late_operations','open','orphan_marks','provider_errors','publish_errors'])assert.equal(d.profile.counts[key],0,'profile/'+key);
  for(const wake of d.profile.wakes){const a=wake.attrs;assert.equal(wake.status,'ok');assert(!Object.hasOwn(a,'error_code'));assert.equal(a.generation,a.generation_end);assert.equal(a.cancelled,false);assert(a.actual_steps>=0&&a.actual_steps<=a.attempted_steps&&a.attempted_steps<=a.admitted);assert(a.wake_end_ms>=a.wake_start_ms);assert(wake.start_ms>=a.wake_end_ms);assert(Math.abs(a.acc_after_elapsed_ms-a.acc_before_ms-a.elapsed_ms)<1e-7);assert(Math.abs(a.acc_after_ms-(a.acc_after_elapsed_ms-a.lost*a.step_ms-a.attempted_steps*a.step_ms))<1e-7);assert.equal(a.acc_current_ms,a.acc_after_ms);}
  profile={limit:d.profile.limit,counts:d.profile.counts,retained_wakes:d.profile.wakes.length,arithmetic_and_preobserver_bounds:'passed',healthy_error_code_absent:true};
 }else assert.equal(d.profile_present,false);
 results.push({backend,observed_utc:capture.observed_utc,observer_frame:Number(d.frame),metrics_frame:p.completion.simulation_frame,raw:{path:file,bytes:bytes.length,sha256:sha(bytes)},sprite:s,texture_cache:c,broker:{loads:b.loads,resident_entries:b.resident_entries,resident_bytes_estimate:b.resident_bytes_estimate,active_entries:b.active_entries},skip_counts:p.completion.skip_counts,profile});
}
const refresh=fs.readFileSync(root+'/.cache/player-wake-ui-actual-refresh-20261103-r1.log','utf8');assert(/pass 22\b/.test(refresh)&&/fail 0\b/.test(refresh)&&/skipped 0\b/.test(refresh));
const result={schema:'unone.wake-ui-frozen-host-acceptance.v1',ok:true,source_commit:host.source_commit,host_root:hostRoot,host_sha256:fingerprint,host_files:111,actual_refresh:{passed:22,failed:0,skipped:0},runs:results,limits:['100-cycle protocol plus terminal GPU ownership counters; not a per-cycle trace or game FPS acceptance.','Main profile capture is a bounded tail of actual production-host wake events; not a causal scheduler-phase reproduction.','Cached performance frame may differ from observer frame. Broker retains one intentional128B decoded scene pin; UI/Bloom allocations are separate.','16MiB linear WASM capacity is not live heap, GC frequency, process/GPU memory or leak proof.','Source-ingestion refresh reuses accepted9c production WASM; not a full SDK or new Native executable. Windows Native final remains4551-blocked.']};
fs.writeFileSync(root+'/.cache/wake-ui-c095103-acceptance-20261103.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({ok:true,commit:host.source_commit,host_sha256:fingerprint,actual_refresh:22,backends:results.map(v=>({backend:v.backend,observer_frame:v.observer_frame,texture_builds:v.sprite.texture_builds,material_builds:v.sprite.builds,world_pending:v.skip_counts.world_assets_pending,profile:v.profile?{retained_wakes:v.profile.retained_wakes,overwritten:v.profile.counts.overwritten}:false}))}));
