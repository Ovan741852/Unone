// Actual exported official-player lifecycle smoke. Never loads a second VM,
// calls a Core command, changes renderer code, or replaces the compositor.
// Player input and the explicitly tested WEBGL_lose_context transition are the
// only active test stimuli. Publication inspection is passive/read-only.
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';

const {values}=parseArgs({options:{export:{type:'string'},out:{type:'string'},backends:{type:'string',default:'main,worker'},headed:{type:'boolean',default:false}}});
assert(values.export&&values.out,'Usage: node browser-runner.mjs --export <fresh official export> --out <new evidence folder> [--backends main,worker] [--headed]');
const exportRoot=resolve(values.export),out=resolve(values.out),backends=values.backends.split(',');
assert(backends.length&&backends.every(name=>name==='main'||name==='worker'));
const require=createRequire(import.meta.url);let chromium;
for(const module of [process.env.PLAYWRIGHT_MODULE,'C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright','playwright'].filter(Boolean)){
    try{({chromium}=require(module));break;}catch{}
}
assert(chromium,'Use an existing Playwright installation via PLAYWRIGHT_MODULE');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const readJson=async path=>JSON.parse(await readFile(path,'utf8'));
const exported=await readJson(join(exportRoot,'export.json'));
const releaseRoot=join(exportRoot,exported.release_root);
const project=await readJson(join(releaseRoot,'content/project.json'));
const presentation=await readJson(join(releaseRoot,'content/presentation.json'));
const runtimeBytes=await readFile(join(releaseRoot,'runtime/runtime.json'));
const runtime=JSON.parse(runtimeBytes);
assert.equal(project.config.runtime_packages['@unone/ui'],runtime.runtime_packages?.['@unone/ui'],'Fixture and selected runtime must declare the same exact UI package');
assert.equal(presentation.renderer_mode,'official');
assert.equal(exported.dev_tools,false,'Use a production export to exercise the production path');
assert.equal(sha(await readFile(join(releaseRoot,'runtime',runtime.wasm))),runtime.wasm_sha256);
assert.equal(sha(await readFile(join(releaseRoot,'runtime',runtime.javascript))),runtime.javascript_sha256);
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.ttf':'font/ttf','.woff2':'font/woff2'};
const server=http.createServer(async(req,res)=>{
    try{
        const url=new URL(req.url,'http://localhost'),path=resolve(exportRoot,'.'+(url.pathname==='/'?'/index.html':decodeURIComponent(url.pathname)));
        assert(path.toLowerCase().startsWith((exportRoot+sep).toLowerCase()),'Path outside export');
        const bytes=await readFile(path);
        res.writeHead(200,{'content-type':mime[extname(path)]??'application/octet-stream','cache-control':'no-store'});res.end(bytes);
    }catch(error){res.writeHead(404);res.end(String(error.message??error));}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
await mkdir(out,{recursive:true});
const report={schema:'unone.retained-official-web-smoke.v3',ok:false,scope:'Actual official production export, Core ABI and main/worker resource/save publication, camera-only retention, pixel snapping, ordered mixed UI, ownership transitions and context recovery, including context/browser teardown health. No frame-rate, GC or memory-soak claim.',exportRoot,release:exported.release_root,runtime,runtimeManifestSha256:sha(runtimeBytes),projectScriptSha256:sha(project.script),results:[]};
function finalizeSmokeResult(result,browserClosed){
    const before=result.teardown.before_context_close;
    result.teardown.browser_closed=browserClosed;
    result.teardown.late_events={errors:result.errors.slice(before.errors),failed:result.failed.slice(before.failed),warnings:result.warnings.slice(before.warnings)};
    result.errors=[...result.errors];result.failed=[...result.failed];result.warnings=[...result.warnings];
    result.health_checked_after_browser_teardown=true;
    result.ok=result.phase_assertions_passed===true&&!result.error&&result.teardown.context_closed===true&&browserClosed===true&&!result.teardown.context_close_error&&result.errors.length===0&&result.failed.length===0&&result.warnings.length===0;
    return result;
}
let browser;
try{
    browser=await chromium.launch({...process.env.UNONE_BROWSER_PATH?{executablePath:process.env.UNONE_BROWSER_PATH}:{channel:process.env.UNONE_BROWSER_CHANNEL??'msedge'},headless:!values.headed});
    report.browser=await browser.version();
    for(const backend of backends){
        const folder=join(out,backend);await mkdir(folder,{recursive:true});
        const context=await browser.newContext({viewport:{width:960,height:600},deviceScaleFactor:1});
        const page=await context.newPage(),errors=[],failed=[],warnings=[];
        page.on('pageerror',error=>errors.push(error.message));
        page.on('console',message=>{if(message.type()==='error')errors.push(message.text());else if(message.type()==='warning')warnings.push(message.text());});
        page.on('requestfailed',request=>failed.push({url:request.url(),failure:request.failure()}));
        const result={backend,ok:false,phase_assertions_passed:false,cases:[],errors,failed,warnings,teardown:{context_closed:false}};
        try{
            await page.addInitScript(()=>{
                const probe={kind:null,latest:null,snapshotInspections:0,workerDefinitionUpdates:0,workerSaveUpdates:0,saveMainRevision:null,saveBytes:0,storageWrites:0,workerPackets:0,observerErrors:[]};
                const setItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(String(key).startsWith('unone-player:'))probe.storageWrites++;return setItem.call(this,key,value);};
                const mainResources=new Map();let mainEpoch=null,wasm=null,facade=null,officialRead=null,observedPointer=0,observedLength=0;
                // Import the decoder/receiver from this exact exported release
                // after its real base element exists. The probe never copies a
                // private UI codec or issues an additional Core command.
                const observerModules=new Promise((resolve,reject)=>{
                    const initialize=async()=>{
                        try{const [reader,transfer]=await Promise.all([import(new URL('web/shared/load-project.js',document.baseURI)),import(new URL('web/shared/instance-transfer.mjs',document.baseURI))]);officialRead=reader.readObservation;resolve(transfer.InstanceReceiver);}
                        catch(error){reject(error);}
                    };
                    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize,{once:true});else void initialize();
                });
                observerModules.catch(error=>probe.observerErrors.push(String(error.message??error)));
                const metadata=definition=>({revision:definition.revision,bounds:definition.bounds,quads:definition.quads.length,assets:definition.quads.map(quad=>quad.asset)});
                function adopt(value,resources,transport){
                    if(!value?.world)return;
                    if(value.save_transport){probe.saveMainRevision=value.save_transport.epoch+':'+value.save_transport.revision;probe.saveBytes=value.save_transport.memory.byte_length;}
                    const nodes=[];
                    function visit(children=[]){for(const node of children){nodes.push({kind:node.kind,id:node.id,content:node.content??null,rect:node.rect??null,transform:node.transform??null,action:node.action??null});if(node.children)visit(node.children);}}
                    visit(value.world.ui?.children);
                    probe.latest={frame:value.world.frame,observations:{...value.world.observations},resources:Object.fromEntries(resources),nodes,transport};probe.snapshotInspections++;
                }
                function mainRead(){
                    if(!wasm||!officialRead)return;
                    const pointer=wasm.unone_web_observation_ptr(),length=wasm.unone_web_observation_len();
                    observedPointer=pointer;observedLength=length;
                    const heap=new Uint8Array(wasm.memory.buffer),decode=bytes=>new TextDecoder().decode(bytes);
                    const value=JSON.parse(decode(heap.subarray(pointer,pointer+length)));
                    if(!value?.world)return;
                    // The official reader restores all generation leases. Its
                    // facade reuses the two pointer values already read above.
                    const restored=officialRead(facade);if(Object.hasOwn(restored.world,'ui'))value.world.ui=restored.world.ui;
                    const transport=value.ui_transport;
                    if(transport){
                        if(transport.epoch!==mainEpoch){mainResources.clear();mainEpoch=transport.epoch;}
                        const live=new Set();
                        for(const [id,entry]of Object.entries(transport.resources)){
                            live.add(id);const old=mainResources.get(id);
                            if(old?.key!==entry.revision){const memory=entry.memory,definition=JSON.parse(decode(heap.subarray(memory.offset,memory.offset+memory.byte_length)));mainResources.set(id,{key:entry.revision,metadata:metadata(definition)});}
                        }
                        for(const id of mainResources.keys())if(!live.has(id))mainResources.delete(id);
                        adopt(value,[...mainResources].map(([id,entry])=>[id,entry.metadata]),{format:transport.format,epoch:transport.epoch,observationBytes:length,definitionBytes:Object.values(transport.resources).reduce((sum,entry)=>sum+entry.memory.byte_length,0)});
                    }else adopt(value,Object.entries(value.world.ui_image_batches??{}).map(([id,definition])=>[id,metadata(definition)]),{format:'full-json',observationBytes:length});
                }
                const capture=result=>{const exports=result?.instance?.exports??result?.exports;if(exports?.unone_web_observation_ptr&&exports.memory){wasm=exports;facade={get HEAPU8(){return new Uint8Array(exports.memory.buffer);},_unone_web_observation_ptr:()=>observedPointer,_unone_web_observation_len:()=>observedLength};probe.kind='main-wasm-read';}return result;};
                for(const name of ['instantiate','instantiateStreaming']){
                    const original=WebAssembly[name];WebAssembly[name]=async function(...args){return capture(await original.apply(WebAssembly,args));};
                }
                const NativeWorker=globalThis.Worker;
                globalThis.Worker=class extends NativeWorker {
                    constructor(...args){
                        super(...args);
                        if(String(args[0]).includes('runtime-worker.js')){
                            const resources=new Map(),receiverReady=observerModules.then(Receiver=>new Receiver());let pending=0,accepting=true;probe.kind='worker-message-observer';
                            receiverReady.catch(()=>{}); // observerModules records initialization failure.
                            this.addEventListener('message',event=>{
                                const data=event.data,packet=data?.packet;if(!accepting||!data?.ok||!packet?.value?.world)return;
                                if(++pending>128){pending--;accepting=false;probe.observerErrors.push('Observer module initialization exceeded128 pending packets');return;}
                                void receiverReady.then(receiver=>{
                                try{
                                    const decoded=receiver.accept(packet);receiver.takeRecycled();
                                    const images=packet.ui_images;if(typeof packet.save?.json==='string'){probe.workerSaveUpdates++;probe.saveBytes=packet.save.json.length;}
                                    if(images){
                                        const candidates=new Map(resources);
                                        for(const update of images.updates){candidates.set(update.id,metadata(update.definition));probe.workerDefinitionUpdates++;}
                                        resources.clear();for(const active of images.active){const definition=candidates.get(active.id);if(!definition)throw Error('Observer missing transferred definition');resources.set(active.id,definition);}
                                    }else resources.clear();
                                    probe.workerPackets++;
                                    adopt(decoded,resources,{format:images?.format??null,updates:images?.updates.length??0,transfer:data.metrics?.transfer??null});
                                }catch(error){accepting=false;probe.observerErrors.push(String(error.message??error));}
                                }).catch(error=>{accepting=false;probe.observerErrors.push(String(error.message??error));}).finally(()=>pending--);
                            });
                        }
                    }
                };
                probe.read=()=>{try{if(wasm)mainRead();}catch(error){probe.observerErrors.push(String(error.message??error));}return {kind:probe.kind,latest:probe.latest,snapshotInspections:probe.snapshotInspections,workerDefinitionUpdates:probe.workerDefinitionUpdates,workerSaveUpdates:probe.workerSaveUpdates,saveMainRevision:probe.saveMainRevision,saveBytes:probe.saveBytes,storageWrites:probe.storageWrites,workerPackets:probe.workerPackets,observerErrors:[...probe.observerErrors]};};
                Object.defineProperty(window,'__retainedSmoke',{value:probe,configurable:true});
            });
            await page.goto('http://127.0.0.1:'+server.address().port+'/?backend='+backend,{waitUntil:'domcontentloaded',timeout:90000});
            await page.waitForFunction(()=>document.body.dataset.playerError||(document.body.dataset.playerMetrics&&window.unonePlayerPerformance&&window.__retainedSmoke.read().latest?.observations.fixture==='retained-official-web-0.2'),{},{timeout:90000});
            const collect=label=>page.evaluate(label=>({label,error:document.body.dataset.playerError??null,renderer:document.body.dataset.playerRenderer,boot:JSON.parse(document.body.dataset.playerMetrics??'null'),host:JSON.parse(document.body.dataset.playerPerformance??'null'),completion:window.unonePlayerPerformance.snapshot({windowMs:5000}),probe:window.__retainedSmoke.read()}),label);
            const waitPhase=phase=>page.waitForFunction(phase=>document.body.dataset.playerError||window.__retainedSmoke.read().latest?.observations.phase===phase,phase,{timeout:30000});
            const ready=()=>page.waitForFunction(()=>document.body.dataset.playerError||window.unonePlayerPerformance.snapshot().last_draw_status==='completed',{},{timeout:30000});
            await ready();const initial=await collect('initial');
            assert.equal(initial.error,null);assert.equal(initial.renderer,'official');assert.equal(initial.completion.completion_contract,'available');
            assert.deepEqual(Object.keys(initial.probe.latest.resources).sort(),['accent','background','fog','world']);
            assert.deepEqual(initial.probe.latest.resources.world.assets,['texture://qa-atlas-a','texture://qa-atlas-b','texture://qa-atlas-a']);
            const stored=()=>page.evaluate(()=>{const key=Object.keys(localStorage).find(key=>key.startsWith('unone-player:'));return key?JSON.parse(localStorage.getItem(key)):null;});
            assert.equal((await stored())?.coins,7,'Game.start save must be persisted before READY');assert.equal(initial.probe.storageWrites,1);assert(initial.probe.saveBytes>112*1024);
            result.cases.push(initial);await page.screenshot({path:join(folder,'initial.png')});
            const firstFrame=initial.probe.latest.frame;
            await page.waitForFunction(frame=>document.body.dataset.playerError||window.__retainedSmoke.read().latest?.frame>=frame+15,firstFrame,{timeout:30000});
            const moving=await collect('moving-camera');
            assert.notEqual(moving.probe.latest.observations.camera_x,initial.probe.latest.observations.camera_x);
            assert.deepEqual(moving.probe.latest.resources,initial.probe.latest.resources,'Camera-only updates must retain every resource generation');
            if(backend==='worker')assert.equal(moving.probe.workerDefinitionUpdates,initial.probe.workerDefinitionUpdates,'Camera-only worker publications must not resend artwork definitions');
            if(backend==='worker')assert.equal(moving.probe.workerSaveUpdates,initial.probe.workerSaveUpdates,'Unchanged worker publications must not resend saves');
            else{assert.equal(moving.probe.saveMainRevision,initial.probe.saveMainRevision);assert(moving.probe.latest.transport.observationBytes<32768,'Unchanged save bytes must stay out of the envelope');}
            assert.equal(moving.probe.storageWrites,1,'Unchanged ticks must not write storage');
            const refs=moving.probe.latest.nodes.filter(node=>node.content).map(node=>node.id);
            assert.deepEqual(refs,['background','world-art','fog-art','hud-art']);
            const order=moving.probe.latest.nodes.map(node=>node.id);
            assert(order.indexOf('interleaved-label')<order.indexOf('hud-art'));
            result.cases.push(moving);
            await page.keyboard.press('v');await page.waitForFunction(()=>{const key=Object.keys(localStorage).find(key=>key.startsWith('unone-player:'));return key&&JSON.parse(localStorage.getItem(key)).coins===8;},{},{timeout:30000});
            const saveChanged=await collect('save-replacement');assert.equal(saveChanged.probe.storageWrites,2);assert.equal((await stored()).large.length,112*1024);
            if(backend==='worker')assert.equal(saveChanged.probe.workerSaveUpdates,initial.probe.workerSaveUpdates+1);else assert.notEqual(saveChanged.probe.saveMainRevision,initial.probe.saveMainRevision);
            result.cases.push(saveChanged);
            const toggle=moving.probe.latest.nodes.find(node=>node.id==='camera-toggle').rect;
            const point=await page.evaluate(rect=>{const box=document.querySelector('#game').getBoundingClientRect();return {x:box.left+(rect.x+rect.width/2)*box.width/100,y:box.top+(100-rect.y-rect.height/2)*box.height/100};},toggle);
            await page.mouse.click(point.x,point.y,{delay:90});
            await page.waitForFunction(()=>document.body.dataset.playerError||window.__retainedSmoke.read().latest?.observations.camera_moving===false,{},{timeout:30000});
            const paused=await collect('official-button-hit');assert.equal(paused.probe.latest.observations.toggles,1);result.cases.push(paused);
            await page.keyboard.press('r');await waitPhase('replaced');await ready();const replaced=await collect('replace-live-resource');
            assert(replaced.probe.latest.resources.world.revision>initial.probe.latest.resources.world.revision);
            assert.equal(replaced.probe.latest.resources.accent.revision,initial.probe.latest.resources.accent.revision);
            result.cases.push(replaced);await page.screenshot({path:join(folder,'replaced.png')});
            await page.keyboard.press('d');await waitPhase('removed');await ready();const removed=await collect('remove-after-tree-replacement');
            assert.equal(removed.probe.latest.resources.accent,undefined);assert(!removed.probe.latest.nodes.some(node=>node.content==='accent'));result.cases.push(removed);
            await page.keyboard.press('c');await waitPhase('recreated');await ready();const recreated=await collect('recreate-id');
            assert(recreated.probe.latest.resources.accent.revision>initial.probe.latest.resources.accent.revision);result.cases.push(recreated);
            const loss=await page.evaluate(()=>{const canvas=document.querySelector('#game'),gl=canvas.getContext('webgl2')??canvas.getContext('webgl'),extension=gl?.getExtension('WEBGL_lose_context');if(!extension)return {available:false};window.__retainedContextLoss=extension;extension.loseContext();return {available:true,at:performance.now(),completed:window.unonePlayerPerformance.snapshot().completed_draws};});
            assert(loss.available,'Context-loss extension unavailable: this recovery case is unverified');
            await page.waitForTimeout(300);const lost=await collect('context-lost');result.cases.push(lost);
            assert.notEqual(lost.completion.last_draw_status,'completed','A lost WebGL context must not count as a completed presentation');
            assert.equal(lost.completion.completed_draws,loss.completed,'Completed counter must stop during context loss');
            await page.evaluate(()=>window.__retainedContextLoss.restoreContext());
            await page.waitForFunction(before=>document.body.dataset.playerError||(window.unonePlayerPerformance.snapshot().completed_draws>before&&window.unonePlayerPerformance.snapshot().last_draw_status==='completed'),lost.completion.completed_draws,{timeout:30000});
            const restored=await collect('context-restored');result.cases.push(restored);
            assert.equal(restored.error,null);assert(restored.completion.completed_draws>lost.completion.completed_draws);assert.equal(restored.completion.last_draw_status,'completed');
            assert.deepEqual(restored.probe.latest.resources,recreated.probe.latest.resources,'Context recovery must not mutate Core resources');
            assert.deepEqual(restored.probe.observerErrors,[]);await page.screenshot({path:join(folder,'restored.png')});
            result.phase_assertions_passed=true;
        }catch(error){result.error=String(error.stack??error);await page.screenshot({path:join(folder,'failure.png')}).catch(()=>{});throw error;}
        finally{
            report.results.push(result);
            result.teardown.before_context_close={errors:errors.length,failed:failed.length,warnings:warnings.length};
            try{await context.close();result.teardown.context_closed=true;}catch(error){result.teardown.context_close_error=String(error.stack??error);}
            // A provisional file preserves phase evidence without claiming a pass.
            await writeFile(join(folder,'result.json'),JSON.stringify(result,null,2)+'\n');
        }
    }
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}
finally{
    report.teardown={browser_closed:false,server_closed:false};
    try{await browser?.close();report.teardown.browser_closed=Boolean(browser);}catch(error){report.teardown.browser_close_error=String(error.stack??error);}
    try{await new Promise((done,reject)=>server.close(error=>error?reject(error):done()));report.teardown.server_closed=true;}catch(error){report.teardown.server_close_error=String(error.stack??error);}
    // Drain already queued automation events only after all browser targets close.
    await new Promise(done=>setImmediate(done));
    for(const result of report.results){finalizeSmokeResult(result,report.teardown.browser_closed);await writeFile(join(out,result.backend,'result.json'),JSON.stringify(result,null,2)+'\n');}
    report.ok=!report.error&&report.teardown.browser_closed&&report.teardown.server_closed&&report.results.length===backends.length&&report.results.every(result=>result.ok);
    if(!report.ok){report.error??='SMOKE_HEALTH_OR_TEARDOWN_FAILED';process.exitCode=1;}
    await writeFile(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({ok:report.ok,report:join(out,'report.json'),error:report.error}));
}
