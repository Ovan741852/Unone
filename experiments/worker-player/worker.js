let inFlight=false;
let host,pack,signature,active=false,last=0,accumulator=0;
let tickMs=[],packMs=[],bytes=0,ticks=0,dropped=0,checkpoints=[];
function publish(snapshot){if(inFlight)return;inFlight=true;const at=performance.now();const p=pack(snapshot,host.module,signature);signature=p.signature;packMs.push(performance.now()-at);bytes+=p.bytes;postMessage({kind:'state',snapshot:p.snapshot,binary:p.binary,sent_at:performance.timeOrigin+performance.now()},p.binary?[p.binary]:[]);}
function wake(){if(!active)return;const now=performance.now();accumulator+=Math.min(250,now-last);last=now;let due=Math.floor(accumulator/(1000/60));if(due>2){dropped+=due-2;accumulator-=(due-2)*1000/60;due=2;}let latest;
 for(let i=0;i<due;i++){const at=performance.now();latest=host.tick();tickMs.push(performance.now()-at);ticks++;accumulator-=1000/60;if(latest.world.frame%120===0)checkpoints.push({frame:latest.world.frame,digest:latest.observation_digest});}
 if(latest)publish(latest);setTimeout(wake,Math.max(0,1000/60-accumulator));}
onmessage=async({data})=>{try{if(!data||!['boot','step','ack','start','resetMetrics','stop'].includes(data.kind))throw Error('WORKER_COMMAND_UNKNOWN');if(data.kind==='boot'&&host)throw Error('WORKER_ALREADY_LOADED');if(data.kind==='start'&&active)throw Error('WORKER_ALREADY_RUNNING');if(data.kind==='boot'){const lib=await import('./runtime-host.mjs');pack=lib.pack;host=await lib.boot(url=>importScripts(url));publish(host.read());postMessage({kind:'ready'});}
 else if(data.kind==='step'){if(active)throw Error('Cannot manually step a running worker');publish(host.tick());}
 else if(data.kind==='ack'){inFlight=false;}
 else if(data.kind==='start'){active=true;last=performance.now();wake();}
 else if(data.kind==='resetMetrics'){tickMs=[];packMs=[];bytes=0;ticks=0;dropped=0;checkpoints=[];}
 else if(data.kind==='stop'){active=false;postMessage({kind:'metrics',tickMs,packMs,bytes,ticks,dropped,checkpoints});}
 }catch(error){active=false;postMessage({kind:'error',message:String(error.stack??error)});}};
