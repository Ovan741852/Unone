import test from 'node:test';
import assert from 'node:assert/strict';
import {createSpatialHostMetrics} from './spatial-metrics.mjs';
import {createSpatialHost} from './spatial-host.mjs';

test('detached metrics bound operation keys, count failed phases and clone/reset without touching execution',()=>{
 const metrics=createSpatialHostMetrics();const sample={success:true,request_bytes:12,response_bytes:8,json_encode_ms:1,copy_in_ms:2,abi_ms:3,response_decode_ms:4};
 metrics.request('drain',sample);metrics.request('complete',{...sample,success:false});
 const report=metrics.report();assert.equal(report.bridge.totals.requests,2);assert.equal(report.bridge.totals.failed_requests,1);assert.equal(report.bridge.totals.request_bytes,24);assert.equal(report.bridge.totals.abi_ms,6);
 report.bridge.totals.requests=-1;assert.equal(metrics.report().bridge.totals.requests,2);
 assert.throws(()=>metrics.request('invented',sample),/SPATIAL_METRIC_INVALID/);assert.throws(()=>metrics.request('drain',{...sample,abi_ms:Infinity}),/SPATIAL_METRIC_INVALID/);
 assert.equal(metrics.report().bridge.totals.requests,2);metrics.reset();assert.equal(metrics.report().setup,null);assert.equal(metrics.report().bridge.totals.requests,0);
});

function moduleBridge(rejectComplete=false){let n=0;const calls=[];const module={HEAPU8:new Uint8Array(65536),_unone_web_alloc:()=>0,_unone_web_observation_ptr:()=>32768,_unone_web_observation_len:()=>n};
 module._unone_web_spatial_request=(p,len)=>{const request=JSON.parse(new TextDecoder().decode(module.HEAPU8.slice(p,p+len)));calls.push(request);const response=request.kind==='drain'?[{id:7,batch:{version:1}}]:null;const bytes=new TextEncoder().encode(JSON.stringify(response));module.HEAPU8.set(bytes,32768);n=bytes.length;return rejectComplete&&request.kind==='complete'?-1:0;};return {module,calls};}

test('official host attributes setup and exact bridge bytes; failed ABI is counted and no report read adds samples',async()=>{
 const {module,calls}=moduleBridge(true);const host=createSpatialHost(module,{backend:'gpu',createExecutor:async()=>({async execute(){return {version:1,results:[]};},close(){}})});
 await host.load();host.dispatch();await assert.rejects(host.barrier());
 const first=host.report().metrics;assert.equal(first.setup.success,true);assert.equal(first.setup.gpu_initialized,true);assert.equal(first.bridge.totals.failed_requests,1);assert.equal(first.bridge.by_kind.complete.requests,1);
 assert.equal(first.bridge.totals.requests,calls.length);assert.equal(first.bridge.totals.request_bytes,calls.reduce((sum,v)=>sum+new TextEncoder().encode(JSON.stringify(v)).length,0));
 for(const key of ['json_encode_ms','copy_in_ms','abi_ms','response_decode_ms'])assert.ok(Number.isFinite(first.bridge.totals[key])&&first.bridge.totals[key]>=0);
 assert.deepEqual(host.report().metrics,first);host.close();
});

test('CPU and unavailable-GPU setup diagnostics distinguish no dispatch and fallback',async()=>{
 const cpu=createSpatialHost({});await cpu.load();const c=cpu.report().metrics;assert.equal(c.setup.gpu_initialized,false);assert.equal(c.setup.executor_create_ms,0);assert.equal(c.bridge.totals.requests,0);
 const auto=createSpatialHost({}, {backend:'auto'});await auto.load();assert.equal(auto.report().metrics.setup.success,false);assert.match(auto.report().fallback_reason,/SPATIAL_ABI_UNAVAILABLE/);cpu.close();auto.close();
});
