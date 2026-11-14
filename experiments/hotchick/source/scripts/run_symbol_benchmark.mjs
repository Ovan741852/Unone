import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {CdpClient} from './cdp-client.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const options = Object.fromEntries(process.argv.slice(2).map(value => { const i=value.indexOf('='); return [value.slice(2,i), value.slice(i+1)]; }));
const output = path.resolve(options.output ?? path.join(root,'artifacts/symbol-benchmark/results'));
fs.mkdirSync(output,{recursive:true});
const modes=(options.modes??'static,webm-shared,webm-independent,atlas').split(',');
const counts=(options.counts??'1,16,64,128').split(',').map(Number);
const repeats=Number(options.repeats??3);
const durationMs=Number(options.duration??15000), warmupMs=Number(options.warmup??5000);
const base=options.base??'http://127.0.0.1:8237/player/';
const cdp=await CdpClient.connect(Number(options.port??9237));
const system=await cdp.send('SystemInfo.getInfo');
const machine={node:process.version,cpu:os.cpus()[0].model,logicalCores:os.cpus().length,totalMemory:os.totalmem(),platform:os.platform(),release:os.release()};
const results={startedAt:new Date().toISOString(),settings:{base,modes,counts,repeats,warmupMs,durationMs,viewport:[1280,720],deviceScaleFactor:1,browserMode:'headless-gpu-verified',phase:options.phase??'sync'},machine,browser:cdp.version,system,assets:JSON.parse(fs.readFileSync(path.join(root,'artifacts/symbol-benchmark/assets/asset-manifest.json'),'utf8')),cases:[]};
fs.writeFileSync(path.join(output,'raw-results.json'),JSON.stringify(results,null,2));
function save() {fs.writeFileSync(path.join(output,'raw-results.json'),JSON.stringify(results,null,2));}
function processMemory(ids) {
  try {return JSON.parse(execFileSync('python',['-c',"import psutil,json,sys; out=[]\nfor pid in json.loads(sys.argv[1]):\n try:\n  p=psutil.Process(pid);out.append({'pid':pid,'rss_bytes':p.memory_info().rss})\n except psutil.Error: pass\nprint(json.dumps(out))",JSON.stringify(ids)],{encoding:'utf8',timeout:15000}));}
  catch(error){return {error:String(error)};}
}
for(let repeat=0;repeat<repeats;repeat++) {
  const rotated=[...modes.slice(repeat%modes.length),...modes.slice(0,repeat%modes.length)];
  for(const count of counts) for(const mode of rotated) {
    const condition={repeat:repeat+1,mode,count,phase:results.settings.phase};
    const entry={...condition,startedAt:new Date().toISOString()};
    const pageUrl=new URL(base);for(const [key,value]of Object.entries(condition))pageUrl.searchParams.set(key,String(value));
    const target=await cdp.send('Target.createTarget',{url:'about:blank'});
    const {sessionId}=await cdp.send('Target.attachToTarget',{targetId:target.targetId,flatten:true});
    const consoleErrors=[],players={};
    const listener=event=>{
      if(event.sessionId!==sessionId)return;
      if(event.method==='Runtime.exceptionThrown')consoleErrors.push(event.params.exceptionDetails);
      if(event.method==='Log.entryAdded'&&event.params.entry.level==='error')consoleErrors.push(event.params.entry);
      if(event.method==='Media.playerPropertiesChanged') {
        const player=players[event.params.playerId]??={};for(const property of event.params.properties)player[property.name]=property.value;
      }
      if(event.method==='Media.playerErrorsRaised')consoleErrors.push(event.params);
    };
    cdp.listeners.add(listener);
    try {
      await cdp.send('Page.enable',{},sessionId);await cdp.send('Runtime.enable',{},sessionId);await cdp.send('Log.enable',{},sessionId);await cdp.send('Media.enable',{},sessionId);await cdp.send('Performance.enable',{},sessionId);
      await cdp.send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false},sessionId);
      await cdp.send('Page.navigate',{url:pageUrl.href},sessionId);
      entry.url=pageUrl.href;
      const readyDeadline=Date.now()+120000;
      while(true) {
        const state=await cdp.evaluate(sessionId,"({ready:Boolean(window.benchmark?.ready),error:document.body?.dataset.playerError,benchError:window.benchmark?.error})");
        if(state?.error||state?.benchError)throw new Error(JSON.stringify(state));
        if(state?.ready)break;
        if(Date.now()>readyDeadline)throw new Error('BENCH_READY_TIMEOUT');
        await new Promise(resolve=>setTimeout(resolve,250));
      }
      entry.metadata=await cdp.evaluate(sessionId,'window.benchmark.metadata()');
      const serializedGpu=JSON.stringify(entry.metadata).toLowerCase();
      if(serializedGpu.includes('swiftshader')||serializedGpu.includes('llvmpipe'))throw new Error('SOFTWARE_GPU_NOT_A_HARDWARE_BENCHMARK');
      await cdp.evaluate(sessionId,`new Promise(resolve=>setTimeout(resolve,${warmupMs}))`);
      const before=await cdp.send('SystemInfo.getProcessInfo');
      const start=performance.now();
      entry.measurement=await cdp.evaluate(sessionId,`window.benchmark.measure({warmupMs:0,durationMs:${durationMs}})`,durationMs+60000);
      const elapsed=(performance.now()-start)/1000;
      const after=await cdp.send('SystemInfo.getProcessInfo');
      const beforeMap=new Map(before.processInfo.map(p=>[p.id,p]));
      entry.chromeProcessCpu=after.processInfo.map(p=>({pid:p.id,type:p.type,cpuSeconds:beforeMap.has(p.id)?Math.max(0,p.cpuTime-beforeMap.get(p.id).cpuTime):null}));
      entry.measuredWallSeconds=elapsed;
      entry.cpuCoreEquivalents=entry.chromeProcessCpu.reduce((sum,p)=>sum+(p.cpuSeconds??0),0)/elapsed;
      entry.chromeProcessWorkingSets=processMemory(after.processInfo.map(p=>p.id));
      entry.performanceMetrics=await cdp.send('Performance.getMetrics',{},sessionId);
      entry.mediaPlayers=players;
      entry.consoleErrors=consoleErrors;
      entry.status='ok';
      console.log(JSON.stringify({event:'case',...condition,status:entry.status,summary:{rafFps:entry.measurement?.rafFps,rafP95:entry.measurement?.raf?.p95,renderFps:entry.measurement?.renderFps,videoDropRatio:entry.measurement?.videos?.droppedRatio,stalledPlayers:entry.measurement?.videos?.nonAdvancing},cpuCoreEquivalents:entry.cpuCoreEquivalents}));
    } catch(error) {
      entry.status='error';entry.error=String(error);entry.consoleErrors=consoleErrors;entry.mediaPlayers=players;
      console.log(JSON.stringify({event:'case',...condition,status:entry.status,error:entry.error}));
    } finally {
      results.cases.push(entry);save();cdp.listeners.delete(listener);
      await cdp.send('Target.closeTarget',{targetId:target.targetId});
    }
    // Avoid overheating in pathological cases; retain the failed condition as evidence.
    if(entry.error?.includes('SOFTWARE_GPU'))throw new Error(entry.error);
  }
}
results.completedAt=new Date().toISOString();save();
console.log(JSON.stringify({event:'complete',file:path.join(output,'raw-results.json'),cases:results.cases.length}));
cdp.close();
