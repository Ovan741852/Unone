import {createRuntimeBackend} from './web/shared/runtime-backend.mjs';
let result={status:'running'};document.querySelector('#result').textContent='Modules loaded';
try {
 const expected=await fetch('job-acceptance-input.json').then(r=>r.json());
 const payload=await fetch('content/project.json').then(r=>r.json());
 const manifest=await fetch('runtime/runtime.json').then(r=>r.json());
 const url=new URL('runtime/'+manifest.javascript,location.href).href,runs=[];
 for(const [kind,mode] of [['worker','inline'],['main','workers'],['worker','workers']]){
  document.querySelector('#result').textContent='Boot '+kind+' '+mode;
  const backend=await createRuntimeBackend({kind,url,jobPolicy:{mode,max_workers:2,memory_budget_mb:256},device:{cores:8,memoryGB:8}});
  await backend.request({kind:'load',payload,seed:'42'});
  const digests=[];
  for(let tick=0;tick<30;tick++){const value=await backend.request({kind:'tick',input:{actions:{}}});digests.push(value.observation_digest);}
  runs.push({kind,mode,digests,report:backend.report()});backend.close();
 }
 const parity=runs.every(r=>JSON.stringify(r.digests)===JSON.stringify(runs[0].digests));
 if(!parity)throw Error('WORKER_PARITY_MISMATCH');
 if(runs.slice(1).some(r=>r.report.jobs.pool.workers_started<expected.minimum_workers))throw Error('MULTIPLE_WORKERS_NOT_EXERCISED');
 if(runs.slice(1).some(r=>r.report.jobs.binary_transport?.format!=='UJB1'||!(r.report.jobs.binary_transport.payload_sent_bytes>0)||!r.report.jobs.pool.worker_transport.some(t=>t?.format==='UJB1'&&t.payload_received_bytes>0)))throw Error('BINARY_PAYLOAD_NOT_EXERCISED');
 if(runs[0].digests.at(-1)!==expected.digest)throw Error('CLI_JOB_PARITY_MISMATCH');
 result={status:'passed',ticks:30,parity,cli_parity:true,runtime:manifest,runs};
}catch(e){result={status:'failed',error:String(e.stack??e)};}
document.querySelector('#result').textContent=JSON.stringify(result,null,2);
await fetch('/__report?name='+location.pathname.split('/').at(-2),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(result)});
