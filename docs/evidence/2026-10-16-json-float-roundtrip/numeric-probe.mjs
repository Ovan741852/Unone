import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const root=resolve('.'),out=join(root,'artifacts/voidwake-responsive-fx/review'),project=join(out,'numeric-probe-project');
mkdirSync(project,{recursive:true});
const config={name:'Numeric boundary probe',entry_script:'main.luau',systems:JSON.parse(readFileSync(join(root,'_Games/voidwake/project.unone.json'),'utf8')).systems,runtime_packages:{'@unone/ui':'0.4.0'}};
const script=`
local function bits(value)
 local bytes=buffer.create(8);buffer.writef64(bytes,0,value)
 return string.format("%08x%08x",buffer.readu32(bytes,4),buffer.readu32(bytes,0))
end
return {start=function(api)
 local a,b,c=3.1,.08,2.72
 local right=100-a
 local models=api.ui.components.createResponsiveLayout({variants={{name="single",minAspect=0,values={},
  layout={id="root",kind="row",padding={left=3.1,right=3.1},children={{id="content",kind="slot"}}}}}})
 local r=models.resolve({aspect=16/9}).rect("content")
 local values={a=a,b=b,c=c,right=right,width=right-a,constant=100-3.1-3.1,
  title=100-(54.12+.08),layoutWidth=r.width,layoutX=r.x}
 local raw={}
 for key,value in pairs(values) do raw[key]=bits(value) end
 api.observation.set("values",values);api.observation.set("bits",raw)
end,update=function()end}
`;
writeFileSync(join(project,'project.unone.json'),JSON.stringify(config,null,2));
writeFileSync(join(project,'main.luau'),script);
const nativeResult=spawnSync('D:/TSProject/Voidwake/game/tools/build/native/release/game.exe',['--project',project,'run','--frames','0','--json'],{encoding:'utf8'});
writeFileSync(join(out,'numeric-native-raw.json'),nativeResult.stdout);
if(nativeResult.status!==0)throw Error(nativeResult.stderr+'\n'+nativeResult.stdout);
const nativeReport=JSON.parse(nativeResult.stdout).value;
const native=nativeReport.world.observations;
const rt=join(root,'artifacts/ui-responsive/runtime-web'),manifest=JSON.parse(readFileSync(join(rt,'runtime.json'),'utf8'));
const js=join(rt,manifest.javascript);
const module=await new Promise((accept,reject)=>{
 const options={wasmBinary:new Uint8Array(readFileSync(join(rt,manifest.wasm))),noInitialRun:true,onAbort:r=>reject(Error(String(r))),print:()=>{},printErr:()=>{}};
 const context={Module:options,crypto:webcrypto,window:{},document:{currentScript:{src:pathToFileURL(js).href}},location:{href:pathToFileURL(js).href},console,TextDecoder,TextEncoder,WebAssembly,setTimeout,clearTimeout,performance};
 options.onRuntimeInitialized=()=>accept(context.Module);
 vm.runInNewContext(readFileSync(js,'utf8'),context,{filename:js});
});
const {loadProject}=await import(pathToFileURL(join(root,'web/shared/load-project.js')).href);
const wasmReport=loadProject(module,{config,script,scene:null},42n);
const wasm=wasmReport.world.observations;
writeFileSync(join(out,'numeric-wasm-raw.json'),new TextDecoder().decode(module.HEAPU8.slice(module._unone_web_observation_ptr(),module._unone_web_observation_ptr()+module._unone_web_observation_len())));
const differences=[];
for(const name of Object.keys(native.bits)) if(native.bits[name]!==wasm.bits[name])differences.push({name,native:native.values[name],wasm:wasm.values[name],nativeBits:native.bits[name],wasmBits:wasm.bits[name]});
const result={nativeDigest:nativeReport.observation_digest,wasmDigest:wasmReport.observation_digest,native,wasm,differences};
writeFileSync(join(out,'numeric-probe.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
