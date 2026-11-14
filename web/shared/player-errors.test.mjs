import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {playerErrorPolicy,createRecoveryReporter} from './player-errors.mjs';

const RELEASE={ui_capacity:'keep_previous',script_errors:'continue',max_consecutive_script_errors:60};
const STRICT={ui_capacity:'fail',script_errors:'fail',max_consecutive_script_errors:60};

test('the exported policy reaches the engine; strict and missing policies send nothing',()=>{
 assert.deepEqual(playerErrorPolicy({error_policy:RELEASE}),RELEASE);
 assert.equal(playerErrorPolicy({error_policy:STRICT}),null,'the engine default is already strict');
 assert.equal(playerErrorPolicy({}),null,'an export without error_policy stays strict');
 assert.deepEqual(playerErrorPolicy({error_policy:{script_errors:'continue'}}),{ui_capacity:'fail',script_errors:'continue',max_consecutive_script_errors:60});
 assert.equal(playerErrorPolicy({error_policy:RELEASE},'?seed=7&unone_errors=strict'),null,'QA forces fail-fast on a production export');
 assert.throws(()=>playerErrorPolicy({error_policy:RELEASE},'?unone_errors=lenient'),/PLAYER_ERROR_POLICY_OVERRIDE_INVALID/);
 for(const error_policy of [null,'continue',[],{ui_capacity:'truncate'},{retries:1},{max_consecutive_script_errors:0},{max_consecutive_script_errors:3601},{max_consecutive_script_errors:1.5}])
  assert.throws(()=>playerErrorPolicy({error_policy}),/ERROR_POLICY_INVALID/,JSON.stringify(error_policy));
});

function harness(){
 let clock=0,timers=new Map(),nextTimer=0;const warnings=[],dataset={},children=[];
 const doc={body:{append(node){children.push(node);}},createElement:()=>{const node={dataset:{},style:{},hidden:false,textContent:'',attributes:{},setAttribute(k,v){this.attributes[k]=v;},remove(){children.splice(children.indexOf(node),1);}};return node;}};
 const reporter=createRecoveryReporter({target:{dataset},log:{warn:text=>warnings.push(text)},now:()=>clock,doc,warnIntervalMs:5000,noticeMs:4000,
  schedule:(fn,ms)=>{timers.set(++nextTimer,{fn,at:clock+ms});return nextTimer;},cancel:id=>timers.delete(id)});
 return {reporter,warnings,dataset,children,advance(ms){clock+=ms;for(const [id,t] of [...timers])if(t.at<=clock){timers.delete(id);t.fn();}}};
}
const rejection={code:'UI_NODE_LIMIT',frame:7,path:'root.children[78].children[2].children[1]',node:'main-nav-icon-training',used:1025,limit:1024,message:'UI_NODE_LIMIT: ...'};
const world=(ui,script,extra={})=>({frame:1,recovered_errors:{ui_rejections:ui,script_errors:script,consecutive_script_errors:0,...(ui?{last_ui_rejection:rejection}:{}),...extra}});

test('each recovery is reported once: console warning, QA dataset and a small notice',()=>{
 const h=harness();
 assert.equal(h.reporter.accept({frame:0}),false,'no recovery, no report');assert.equal(h.warnings.length,0);
 assert.equal(h.reporter.accept(world(1,0)),true);
 assert.equal(h.warnings.length,1);assert.match(h.warnings[0],/^UNONE_PLAYER_RECOVERED UI publish over capacity; kept the previous screen: .*"node":"main-nav-icon-training"/);
 assert.deepEqual(JSON.parse(h.dataset.playerRecoveredErrors).last_ui_rejection,rejection);
 assert.equal(h.children.length,1);assert.equal(h.children[0].attributes.role,'status');assert.equal(h.children[0].style.cssText.includes('pointer-events:none'),true);
 assert.equal(h.children[0].textContent,'Recovered: UI kept previous screen ×1 (UI_NODE_LIMIT)');
 assert.equal(h.reporter.accept(world(1,0)),false,'an unchanged count is not a new recovery');
 h.advance(4000);assert.equal(h.children[0].hidden,true,'the notice hides once recoveries stop');
});

test('warnings are rate limited per kind and summarize what they skipped',()=>{
 const h=harness();
 for(let n=1;n<=10;n++){h.reporter.accept(world(n,0));h.advance(100);}
 assert.equal(h.warnings.length,1,'one warning in the first interval');
 h.advance(5000);h.reporter.accept(world(11,0));
 assert.equal(h.warnings.length,2);assert.match(h.warnings[1],/\(\+9 more\)/);
 h.reporter.accept(world(11,1,{last_script_error:{frame:30,code:'LUAU_RUNTIME_ERROR',message:'main.luau:4: boom'}}));
 assert.equal(h.warnings.length,3,'a script error has its own budget');assert.match(h.warnings[2],/Game\.update error; skipped the rest of that update: .*boom/);
 assert.equal(h.children[0].textContent,'Recovered: UI kept previous screen ×11 (UI_NODE_LIMIT) · script errors skipped ×1');
 assert.equal(h.children[0].hidden,false);
});

test('a restarted session counts from zero again and dispose removes the notice',()=>{
 const h=harness();
 h.reporter.accept(world(3,0));h.advance(6000);
 assert.equal(h.reporter.accept({frame:0}),false,'new session without recoveries');
 assert.equal(h.reporter.accept(world(1,0)),true,'the first recovery of the new session is reported');
 assert.equal(h.warnings.length,2);
 h.reporter.dispose();assert.equal(h.children.length,0);assert.equal(h.reporter.accept(world(2,0)),false);
});

// The actual player: every accepted snapshot passes through the reporter, and
// the load payload carries the resolved policy before Game.start runs.
const source=fs.readFileSync(new URL('../player/main.js',import.meta.url),'utf8');
test('actual player hands every accepted world to the reporter',()=>{
 const line=source.split('\n').find(text=>text.startsWith('function acceptSnapshot('));assert(line,'acceptSnapshot missing');
 const seen=[];const context={snapshot:undefined,recovery:{accept:world=>seen.push(world)},resourceHost:null,interpolator:null,scheduler:null,backend:{memory(){}},
  playerCompletion:{accept(){}}};
 vm.createContext(context);vm.runInContext(line+';globalThis.acceptSnapshot=acceptSnapshot;',context);
 const value={world:{frame:3,recovered_errors:{ui_rejections:1}}};context.acceptSnapshot(value);
 assert.deepEqual(seen,[value.world]);assert.throws(()=>context.acceptSnapshot({}),/HOST_SNAPSHOT_INVALID/);assert.equal(seen.length,1);
});
test('actual player sends the resolved policy in both load payloads',()=>{
 const start=source.slice(source.indexOf('async function start(){'),source.indexOf('function pointer('));
 const resolve=start.indexOf('errorPolicy=playerErrorPolicy(presentation,location.search)'),attach=start.indexOf('if(errorPolicy)project.error_policy=errorPolicy;'),load=start.indexOf("backend.request({kind:'load',payload:project");
 assert(resolve>=0&&attach>resolve&&load>attach,'start() resolves the policy, then attaches it before loading');
 const restart=source.slice(source.indexOf('async function restart(){'),source.indexOf('async function finishStartup('));
 const again=restart.indexOf('if(errorPolicy)projectPayload.error_policy=errorPolicy;'),reload=restart.indexOf("backend.request({kind:'load',payload:projectPayload");
 assert(again>=0&&reload>again,'restart() keeps the same policy');
});
