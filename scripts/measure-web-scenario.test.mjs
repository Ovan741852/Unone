// Scenario runs for measure-web-export: the file format, real input fields, what one sample holds,
// OS process memory parsing and the round/trend bookkeeping, driven against a fake page.
import test from 'node:test';
import assert from 'node:assert/strict';
import {SCENARIO_SCHEMA,parseScenario,keyFields,flattenMemory,flattenHeap,flattenProcesses,windowsMemoryScript,parseWindowsMemory,parseProcStatus,readProcessMemory,trend,phaseTrends,columns,runScenario} from './measure-web-scenario.mjs';
import {parseArgs,scenarioSummary,scenarioConsole} from './measure-web-export.mjs';

const roundTrip={schema:SCENARIO_SCHEMA,name:'city-tech-bag',start_mark:'city.interactive',
 phases:[{name:'menus',warmup_rounds:1,rounds:4,steps:[{key:'KeyT'},{wait_mark:'tech.interactive'},{key:'KeyB'},{wait_mark:'bag.interactive'},{key:'Escape'},{wait_mark:'city.interactive'}]}]};

test('a scenario file is checked field by field and filled with defaults',()=>{
 const s=parseScenario(JSON.stringify(roundTrip));
 assert.deepEqual([s.settle_ms,s.sample_ms,s.step_timeout_ms,s.start_mark],[10000,250,15000,'city.interactive']);
 assert.deepEqual(s.phases[0].steps[0],{kind:'key',key:'KeyT',hold_ms:50});
 assert.deepEqual(s.phases[0].steps[1],{kind:'wait_mark',wait_mark:'tech.interactive',timeout_ms:15000});
 assert.ok(Object.isFrozen(s.phases[0].steps));
 const bad=(change,pattern)=>assert.throws(()=>parseScenario(JSON.stringify(change(structuredClone(roundTrip)))),pattern);
 bad(s=>{s.schema='v0';return s;},/schema/);
 bad(s=>{s.extra=1;return s;},/extra: unknown field/);
 bad(s=>{s.phases[0].steps[0]={key:'T'};return s;},/steps\[0\]\.key: a KeyboardEvent\.code/);
 bad(s=>{s.phases[0].steps[0]={key:'KeyT',wait_ms:1};return s;},/exactly one of/);
 bad(s=>{s.phases[0].steps[0]={tap:[10]};return s;},/tap: \[x, y\]/);
 bad(s=>{s.phases[0].steps[0]={wait_mark:'x',hold_ms:5};return s;},/hold_ms: not allowed on a wait_mark step/);
 bad(s=>{s.phases.push({...s.phases[0]});return s;},/"menus" is used twice/);
 bad(s=>{s.phases[0].name='settle';return s;},/not "settle"/);
 bad(s=>{delete s.phases[0].rounds;return s;},/rounds: required/);
 bad(s=>{s.sample_ms=10;return s;},/sample_ms: whole number 50\.\.60000/);
 bad(s=>{s.phases[0].rounds=100;return s;},/at most 256 api\.profile\.mark calls/);
 assert.throws(()=>parseScenario('{'),/not JSON/);
});

test('keys become DevTools key events with the code, key and virtual key code a browser sends',()=>{
 assert.deepEqual(keyFields('KeyT'),{code:'KeyT',key:'t',windowsVirtualKeyCode:84,nativeVirtualKeyCode:84,text:'t'});
 assert.deepEqual(keyFields('Digit1'),{code:'Digit1',key:'1',windowsVirtualKeyCode:49,nativeVirtualKeyCode:49,text:'1'});
 assert.deepEqual(keyFields('Escape'),{code:'Escape',key:'Escape',windowsVirtualKeyCode:27,nativeVirtualKeyCode:27});
 assert.equal(keyFields('F5').windowsVirtualKeyCode,116);
 assert.equal(keyFields('Space').text,' ');
 assert.equal(keyFields('t'),null);assert.equal(keyFields('F13'),null);
});

test('a sample keeps every number an owner reported and leaves out what it did not',()=>{
 const memory={owners:[{id:'images.decoded.resident',bytes:400,entries:2},{id:'gpu.textures',bytes:null,entries:9},{id:'gpu.ui_prefix',bytes:null,entries:3,geometries:1,image_leases:3},{id:'luau.heap',bytes:null,entries:null}],failures:{image_loads_failed:0,sprite_errors:null}};
 assert.deepEqual(flattenMemory(memory),{'images.decoded.resident.bytes':400,'images.decoded.resident.entries':2,'gpu.textures.entries':9,'gpu.ui_prefix.entries':3,'gpu.ui_prefix.geometries':1,'gpu.ui_prefix.image_leases':3,'failures.image_loads_failed':0});
 assert.deepEqual(flattenMemory(null),{});
 assert.deepEqual(flattenHeap({usedSize:10,totalSize:20,backingStorageSize:5},{documents:1,nodes:30,jsEventListeners:4}),{'js_heap.used_bytes':10,'js_heap.total_bytes':20,'js_heap.backing_storage_bytes':5,'dom.documents':1,'dom.nodes':30,'dom.listeners':4});
 assert.deepEqual(flattenHeap(null,null),{});
});

test('process rows are reported per process: browser, GPU and the largest renderer, never summed',()=>{
 const os={processes:[{type:'browser',working_set_bytes:100,private_bytes:80},{type:'gpu',working_set_bytes:300,gpu_dedicated_bytes:5000,peak_working_set_bytes:350},
  {type:'renderer',working_set_bytes:50},{type:'renderer',working_set_bytes:900,private_bytes:700},{type:'utility',working_set_bytes:10}]};
 assert.deepEqual(flattenProcesses(os),{'os.browser_process.working_set_bytes':100,'os.browser_process.private_bytes':80,'os.gpu_process.working_set_bytes':300,'os.gpu_process.peak_working_set_bytes':350,
  'os.gpu_process.gpu_dedicated_bytes':5000,'os.renderer_processes':2,'os.largest_renderer.working_set_bytes':900,'os.largest_renderer.private_bytes':700});
 assert.deepEqual(flattenProcesses({supported:false,processes:[]}),{});
});

test('Windows memory is read per PID, GPU memory summed over one process\'s adapters',()=>{
 const script=windowsMemoryScript([11,22,'x',3.5]);
 assert.match(script,/\$ids=@\(11,22\)/);assert.match(script,/Name LIKE 'pid_11_%' OR Name LIKE 'pid_22_%'/);
 const processes=[{id:11,type:'gpu'},{id:22,type:'renderer'},{id:33,type:'browser'}];
 const text=JSON.stringify({processes:[{pid:11,working_set:1000,peak_working_set:2000,private:900},{pid:22,working_set:500,peak_working_set:600,private:400}],
  gpu:[{name:'pid_11_luid_0x0_0x1_phys_0',dedicated:7000,shared:100},{name:'pid_11_luid_0x0_0x2_phys_0',dedicated:1000,shared:50}],gpu_error:null});
 const parsed=parseWindowsMemory(text,processes);
 assert.deepEqual(parsed.processes[0],{pid:11,type:'gpu',alive:true,working_set_bytes:1000,peak_working_set_bytes:2000,private_bytes:900,gpu_dedicated_bytes:8000,gpu_shared_bytes:150,gpu_adapters:2});
 assert.deepEqual([parsed.processes[1].gpu_dedicated_bytes,parsed.processes[1].gpu_adapters],[0,0],'a readable counter set without the process means it holds none');
 assert.deepEqual([parsed.processes[2].alive,parsed.processes[2].working_set_bytes,parsed.processes[2].gpu_dedicated_bytes],[false,null,null],'an exited process is null, not zero');
 const single=parseWindowsMemory(JSON.stringify({processes:{pid:11,working_set:1,peak_working_set:2,private:3},gpu:null,gpu_error:'Invalid class'}),processes.slice(0,1));
 assert.deepEqual([single.processes[0].working_set_bytes,single.processes[0].gpu_dedicated_bytes,single.gpu_error],[1,null,'Invalid class'],'unreadable GPU counters are null');
});

test('Linux reads /proc status; other platforms say they are unsupported; failures are reported',async()=>{
 assert.deepEqual(parseProcStatus('Name:\tchrome\nVmHWM:\t  2048 kB\nVmRSS:\t  1024 kB\nRssAnon:\t 512 kB\n',{id:5,type:'renderer'}),
  {pid:5,type:'renderer',alive:true,working_set_bytes:1024*1024,peak_working_set_bytes:2048*1024,private_bytes:512*1024,gpu_dedicated_bytes:null,gpu_shared_bytes:null,gpu_adapters:0});
 const info=[{id:7,type:'GPU'},{id:8,type:'renderer'},{id:'bad',type:'browser'}];
 const linux=await readProcessMemory(info,{platform:'linux',readText:async file=>{if(file==='/proc/8/status')throw Error('gone');return 'VmRSS:\t4 kB\n';}});
 assert.deepEqual(linux.processes.map(p=>[p.pid,p.type,p.alive,p.working_set_bytes]),[[7,'gpu',true,4096],[8,'renderer',false,null]]);
 const mac=await readProcessMemory(info,{platform:'darwin'});
 assert.deepEqual([mac.supported,mac.processes.length],[false,0]);
 let ran=null;
 const win=await readProcessMemory(info,{platform:'win32',run:async(command,args)=>{ran={command,args};return JSON.stringify({processes:[{pid:7,working_set:9,peak_working_set:9,private:9}],gpu:[],gpu_error:null});}});
 assert.equal(ran.command,'powershell.exe');assert.ok(ran.args.includes('-EncodedCommand'));
 assert.match(Buffer.from(ran.args.at(-1),'base64').toString('utf16le'),/\$ids=@\(7,8\)/);
 assert.deepEqual(win.processes.map(p=>[p.pid,p.working_set_bytes,p.gpu_dedicated_bytes]),[[7,9,0],[8,null,null]]);
 const broken=await readProcessMemory(info,{platform:'win32',run:async()=>{throw Error('exit 1: denied');}});
 assert.deepEqual([broken.supported,broken.processes.length,broken.error],[true,0,'exit 1: denied']);
});

test('a trend describes one window: halves by maximum, slope per round, rounds that rose',()=>{
 assert.deepEqual(trend([10,12,11,12,11,12]),{n:6,nulls:0,first:10,last:12,min:10,max:12,first_half_max:12,second_half_max:12,second_half_not_higher:true,slope_per_round:0.229,rounds_increased:3,increased_every_round:false});
 const growing=trend([1,2,3,4,5,6]);assert.deepEqual([growing.second_half_not_higher,growing.increased_every_round,growing.slope_per_round],[false,true,1]);
 const few=trend([5,6,7]);assert.deepEqual([few.second_half_not_higher,few.increased_every_round],[null,true],'four rounds before halves are compared');
 assert.deepEqual([trend([null,null]).n,trend([null,null]).nulls,trend([]).first],[0,2,null]);
 assert.equal(trend([3,null,3,3]).nulls,1);
 const rounds=[{warmup:true,end:{a:100},peak:{a:100}},{warmup:false,end:{a:1,b:5},peak:{a:2}},{warmup:false,end:{a:1},peak:{a:3}}];
 const t=phaseTrends(rounds);assert.equal(t.rounds,2);assert.deepEqual([t.end.a.max,t.end.b.nulls,t.peak.a.max],[1,1,3],'warmup rounds are left out');
 assert.deepEqual(columns([{t_ms:1,phase:'p',round:1,checkpoint:false,metrics:{b:2,a:1}},{t_ms:2,phase:'p',round:1,checkpoint:true,metrics:{a:3}}]),
  {columns:['t_ms','phase','round','checkpoint','a','b'],rows:[[1,'p',1,false,1,2],[2,'p',1,true,3,null]]});
});

// A page whose game presents a milestone a few page milliseconds after each key, and whose decoded
// images grow on the first two rounds and then stay put.
function fakePage({marksFor={KeyT:'tech.interactive',KeyB:'bag.interactive',Escape:'city.interactive'},silent=new Set()}={}){
 const rows=[['city.interactive',1,10,12]],state={now:100,sequence:1,keys:[],resident:1,heapReads:0};
 const sampleJson=()=>JSON.stringify({error:null,memory:{owners:[{id:'images.decoded.resident',bytes:state.resident*100,entries:state.resident},{id:'gpu.textures',bytes:null,entries:state.resident+1}],failures:{image_loads_failed:0}},
  milestones:{rows:rows.map(r=>[...r]),engine_dropped:0,host_dropped:0}});
 return {state,page:{
  async send(method,params){
   if(method==='Input.dispatchKeyEvent'){state.keys.push(`${params.type}:${params.code}`);
    if(params.type==='keyDown'){const mark=marksFor[params.code];if(mark&&!silent.has(mark)){state.sequence++;if(mark==='city.interactive'&&state.resident<4)state.resident++;rows.push([mark,state.sequence,state.now+1,state.now+6]);}}return {};}
   if(method==='Runtime.getHeapUsage'){state.heapReads++;return {usedSize:1000,totalSize:2000};}
   if(method==='Memory.getDOMCounters')return {documents:1,nodes:20,jsEventListeners:3};
   return {};
  },
  async evaluate(expression){state.now+=2;return expression.includes('includeMemory:true')?sampleJson():JSON.stringify({error:null,now:state.now,milestones:{rows:rows.map(r=>[...r]),engine_dropped:0,host_dropped:0}});},
 }};
}

test('a scenario runs its rounds with real key events, checkpoints each round and settles',async()=>{
 const scenario=parseScenario(JSON.stringify({...roundTrip,sample_ms:50,settle_ms:0}));
 const {page,state}=fakePage();let osReads=0;
 const readOs=async()=>{osReads++;return {supported:true,processes:[{pid:1,type:'gpu',working_set_bytes:500+osReads,gpu_dedicated_bytes:7000},{pid:2,type:'renderer',working_set_bytes:900}]};};
 const result=await runScenario(page,scenario,{readOs,pollMs:1});
 assert.equal(result.ok,true,result.error);
 assert.equal(result.os_supported,true);
 assert.deepEqual(state.keys.slice(0,4),['keyDown:KeyT','keyUp:KeyT','keyDown:KeyB','keyUp:KeyB']);
 const rounds=result.phases[0].rounds;
 assert.deepEqual(rounds.map(r=>[r.warmup,r.index]),[[true,1],[false,1],[false,2],[false,3],[false,4]]);
 assert.deepEqual(rounds[1].steps.map(s=>s.kind),['key','wait_mark','key','wait_mark','key','wait_mark']);
 assert.equal(rounds[1].steps[1].mark,'tech.interactive');
 assert.ok(rounds[1].steps[1].presented_after_input_ms>0,'presentation is measured from the input on the page clock');
 assert.ok(rounds[1].steps[1].sequence<rounds[1].steps[3].sequence,'each wait takes the next presented mark');
 assert.deepEqual([rounds[4].end['images.decoded.resident.entries'],rounds[4].end['os.gpu_process.gpu_dedicated_bytes'],rounds[4].end['os.renderer_processes']],[4,7000,1]);
 assert.ok(rounds[4].peak['images.decoded.resident.entries']>=rounds[4].end['images.decoded.resident.entries']);
 const t=result.phases[0].trend;
 assert.deepEqual([t.rounds,t.end['images.decoded.resident.entries'].first,t.end['images.decoded.resident.entries'].last],[4,3,4],'warmup round left out of the trend');
 assert.equal(t.end['os.gpu_process.working_set_bytes'].increased_every_round,true);
 assert.ok(result.baseline.metrics['js_heap.used_bytes']===1000);
 assert.equal(result.settled.after_ms,0);assert.ok(result.settled.metrics['dom.nodes']===20);
 assert.equal(osReads,1+1+5+1,'warm-up read, baseline, five rounds, settle');
 assert.equal(result.samples.columns.slice(0,4).join(),'t_ms,phase,round,checkpoint');
 assert.ok(result.samples.rows.some(row=>row[1]==='menus:warmup')&&result.samples.rows.some(row=>row[1]==='settle'));
 const summary=scenarioSummary([{index:1,...result}]);
 assert.equal(summary['menus.last_round_end.images.decoded.resident.entries'].median,4);
 assert.equal(summary['settled.os.gpu_process.gpu_dedicated_bytes'].n,1);
 const printed=scenarioConsole({runs:[{index:1,...result}]});
 assert.deepEqual(printed.phases.menus.round_end['images.decoded.resident.entries'],{first:3,last:4,max:4,second_half_not_higher:true},'growth that stopped in the first half');
});

test('a milestone that never comes ends the run with what was measured',async()=>{
 const scenario=parseScenario(JSON.stringify({...roundTrip,sample_ms:50,settle_ms:0,phases:[{...roundTrip.phases[0],warmup_rounds:0,steps:[{key:'KeyT'},{wait_mark:'tech.interactive',timeout_ms:100}]}]}));
 const {page}=fakePage({silent:new Set(['tech.interactive'])});
 const result=await runScenario(page,scenario,{pollMs:1});
 assert.equal(result.ok,false);assert.match(result.error,/MEASURE_SCENARIO_MARK_TIMEOUT: tech\.interactive was not presented within 100 ms/);
 assert.equal(result.os_supported,null,'no OS reader given');
 assert.ok(result.baseline&&result.samples.rows.length>=1,'the baseline and samples survive');
 assert.equal(result.settled,null);
});

test('--scenario makes startup runs opt-in and checks its run count',()=>{
 const base=['--export','e','--output','o.json'];
 const s=parseArgs([...base,'--scenario','s.json']);
 assert.deepEqual([s.cold,s.warm,s.profilePairs,s.scenarioRuns,s.scenario],[0,0,0,1,'s.json']);
 const both=parseArgs([...base,'--scenario','s.json','--scenario-runs','3','--cold','2']);
 assert.deepEqual([both.cold,both.warm,both.scenarioRuns],[2,0,3]);
 assert.equal(parseArgs(base).scenarioRuns,0,'no scenario, no scenario runs');
 assert.throws(()=>parseArgs([...base,'--scenario','s.json','--scenario-runs','0']),/--scenario-runs must be an integer 1\.\.100/);
 assert.throws(()=>parseArgs([...base,'--cold','0','--warm','0','--profile-pairs','0']),/nothing to measure/);
});
