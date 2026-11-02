#!/usr/bin/env node
// Source-ingestion refresh, not a replacement for the CLI import/precompile/SDK pipeline.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {Worker} from 'node:worker_threads';
import {checkedRoot,sourceFile,fileRecord,dataRecord,sha,json,put,requireThat,inside,verifiedExport,writePublication} from './web-export-files.mjs';
import {inspectHostSnapshot,resolveSystems,assembleHost,validateDependencies} from './web-export-host.mjs';
import {assembleContent} from './web-export-content.mjs';
export {inspectHostSnapshot} from './web-export-host.mjs';

export function inspectRuntime(directory){
 const root=checkedRoot(directory),manifestFile=sourceFile(root,'runtime.json'),manifestBytes=fs.readFileSync(manifestFile),metadata=json(manifestFile);
 requireThat(metadata.profile==='release'&&metadata.dev_tools===false&&metadata.preview_tools===false&&metadata.phase_profile!==true&&metadata.sampling_profile!==true&&metadata.profile_mode!=='phase-only'&&metadata.source_dirty===false&&/^[a-f0-9]{40}$/.test(metadata.source_commit),'WEB_REFRESH_RUNTIME_VARIANT');
 requireThat(metadata.bytecode_optimization_level===2&&Array.isArray(metadata.compiled_systems)&&metadata.runtime_packages&&typeof metadata.runtime_packages==='object','WEB_REFRESH_RUNTIME_METADATA');
 const files=new Map();for(const [field,key]of [['javascript','javascript_sha256'],['wasm','wasm_sha256']]){const name=metadata[field];requireThat(typeof name==='string'&&name.length<=255&&/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name),'WEB_REFRESH_RUNTIME_NAME');const record=fileRecord(sourceFile(root,name),'runtime/'+name);requireThat(record.sha256===metadata[key],'WEB_REFRESH_RUNTIME_HASH',name);put(files,record);}
 const wasm=fs.readFileSync(files.get('runtime/'+metadata.wasm).source),exports=new Set(WebAssembly.Module.exports(new WebAssembly.Module(wasm)).map(v=>v.name));
 for(const name of ['alloc','load_project','unload_project','set_input_frame','tick','observation_ptr','observation_len','sprite_resources_request'])requireThat(exports.has('unone_web_'+name),'WEB_REFRESH_RUNTIME_ABI',name);
 for(const name of ['developer_request','reload_script','bundle_begin'])requireThat(!exports.has('unone_web_'+name),'WEB_REFRESH_RUNTIME_DEVELOPMENT_ABI',name);
 put(files,dataRecord('runtime/runtime.json',manifestBytes));return{root,metadata,files,sha256:sha(manifestBytes)};
}
async function validatePresentation(hostRoot,presentation,assets){
 const from=relative=>import(pathToFileURL(sourceFile(hostRoot,'web/'+relative)).href);
 const [encoding,raster,frame,texture]=await Promise.all([from('shared/asset-encoding.js'),from('renderer/projected-raster-policy.js'),from('renderer/projected-frame-policy.js'),from('renderer/texture-cache-policy.js')]);
 const policy=raster.parseProjectedRaster(presentation.projected_raster),profile=frame.parseFrameProfile(presentation.projected_material_profile);
 if(presentation.antialias!==undefined)requireThat(typeof presentation.antialias==='boolean','ANTIALIAS_INVALID');
 if(policy.requested==='upper_left_checked')requireThat(presentation.antialias===false&&!presentation.bloom,'PROJECTED_RASTER_PROFILE_UNSUPPORTED');
 frame.assertFrameOptions(profile,{backend:'webgl',raster:policy.requested,antialias:presentation.antialias??true,bloom:presentation.bloom,ao:false});
 texture.parseTextureCache(presentation.texture_cache);requireThat(presentation.physical_input===undefined||presentation.physical_input==='ordered_physical_v1','INPUT_PHYSICAL_PROFILE_INVALID');
 for(const asset of assets.assets)if(asset.kind!=='data')encoding.requireAssetEncoding(asset,asset.kind==='texture2d'?'image':asset.kind==='mesh3d'?'mesh':asset.kind==='audio'?'audio':'effekseer');
 return encoding;
}
function addPreload(project,content,encoding,html){
 const file=path.join(project,'player.image-assets.json');if(!fs.existsSync(file))return{html,plan:null};
 const raw=json(sourceFile(project,'player.image-assets.json'),encoding.IMAGE_PRELOAD_PLAN_MAX_BYTES),plan=encoding.validateImagePreloadPlan(raw,encoding.createAssetCatalog(content.assets)),bytes=Buffer.from(JSON.stringify(plan));
 requireThat(bytes.length<=encoding.IMAGE_PRELOAD_PLAN_MAX_BYTES,'IMAGE_PRELOAD_PLAN_LIMIT');const required=new Set(plan.startup.flatMap(id=>plan.groups[id]));requireThat(required.size<=plan.budget.max_entries,'IMAGE_PRELOAD_STARTUP_BUDGET');let total=0;
 for(const id of required){const asset=content.assets.assets.find(a=>a.id===id),file=content.files.get('content/'+asset.source);const header=Buffer.alloc(24),fd=fs.openSync(file.source,'r');let count;try{count=fs.readSync(fd,header,0,24,0);}finally{fs.closeSync(fd);}requireThat(count===24&&header.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&header.readUInt32BE(8)===13&&header.toString('ascii',12,16)==='IHDR','IMAGE_PRELOAD_STARTUP_DIMENSIONS_UNSUPPORTED',id);const width=header.readUInt32BE(16),height=header.readUInt32BE(20);requireThat(width>0&&height>0&&Number.isSafeInteger(width*height*4),'IMAGE_PRELOAD_PNG_HEADER_INVALID');total+=width*height*4;}
 requireThat(Number.isSafeInteger(total)&&total<=plan.budget.max_bytes,'IMAGE_PRELOAD_STARTUP_BUDGET');put(content.files,dataRecord('content/image-assets.json',bytes));return{html:html.replace('<head>','<head><meta name="unone-image-assets" content="content/image-assets.json">'),plan:{sha256:sha(bytes),required_entries:required.size,required_rgba_estimate:total}};
}
function validateCore({runtime,hostRoot,content,timeout}){
 return new Promise((resolve,reject)=>{const worker=new Worker(new URL('./web-export-validate-worker.mjs',import.meta.url),{workerData:{javascript:runtime.files.get('runtime/'+runtime.metadata.javascript).source,wasm:runtime.files.get('runtime/'+runtime.metadata.wasm).source,expected:{javascript:runtime.metadata.javascript_sha256,wasm:runtime.metadata.wasm_sha256},payload:{...content.payload,asset_catalog:content.assets.assets.filter(a=>a.kind==='texture2d').map(a=>({id:a.id,kind:a.kind}))},data:content.data},resourceLimits:{maxOldGenerationSizeMb:512}});let settled=false;
  const finish=async(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);await worker.terminate();if(error)reject(error);else resolve(value);};
  const timer=setTimeout(()=>finish(Error('WEB_REFRESH_CORE_VALIDATION_TIMEOUT')),timeout);
  worker.once('message',message=>finish(message.ok?null:Error(message.error),message.value));worker.once('error',error=>finish(error));worker.once('exit',code=>{if(!settled)finish(Error('WEB_REFRESH_CORE_VALIDATION_EXIT: '+code));});
 });
}
export async function refreshOfficialWeb({project,inputExport,hostRoot,hostSha256,hostCommit,runtime,runtimeSha256,output,validationTimeoutMs=30000}){
 for(const value of [project,inputExport,hostRoot,runtime,output])requireThat(typeof value==='string'&&value,'WEB_REFRESH_ARGUMENTS');
 requireThat(/^[a-f0-9]{64}$/.test(hostSha256)&&/^[a-f0-9]{64}$/.test(runtimeSha256)&&/^[a-f0-9]{40}$/.test(hostCommit),'WEB_REFRESH_PINS_REQUIRED');
 const projectRoot=checkedRoot(project),baseRoot=checkedRoot(inputExport),host=checkedRoot(hostRoot),runtimeRoot=checkedRoot(runtime),out=path.resolve(output);
 requireThat(!fs.existsSync(out)&&![projectRoot,baseRoot,runtimeRoot].some(root=>inside(root,out)),'WEB_REFRESH_OUTPUT_NOT_FRESH');checkedRoot(path.dirname(out));
 const inspection=inspectHostSnapshot(host);requireThat(inspection.sha256===hostSha256,'WEB_REFRESH_HOST_PIN_MISMATCH');const selected=inspectRuntime(runtimeRoot);requireThat(selected.sha256===runtimeSha256,'WEB_REFRESH_RUNTIME_PIN_MISMATCH');
 const base=verifiedExport(baseRoot),content=assembleContent(projectRoot,base),enabled=resolveSystems(host,content.payload.config.systems??{});
 for(const id of enabled)requireThat(selected.metadata.compiled_systems.includes(id),'SYSTEM_NOT_COMPILED',id);
 for(const [id,version]of Object.entries(content.payload.config.runtime_packages??{}))requireThat(selected.metadata.runtime_packages[id]===version,'RUNTIME_PACKAGE_UNAVAILABLE',id+'@'+version);
 const encoding=await validatePresentation(host,content.presentation,content.assets),built=assembleHost(host,inspection,enabled,selected.metadata,content.assets),preload=addPreload(projectRoot,content,encoding,built.html);
 const files=new Map([...built.files,...content.files,...selected.files]),dependencies=validateDependencies(files);
 requireThat(Number.isInteger(validationTimeoutMs)&&validationTimeoutMs>=100&&validationTimeoutMs<=120000,'WEB_REFRESH_TIMEOUT_INVALID');
 const validation=await validateCore({runtime:selected,hostRoot:host,content,timeout:validationTimeoutMs});
 // Pin again after async validation. A concurrent writer cannot publish a
 // mixture of trusted host generations or edited fresh authoring input.
 requireThat(inspectHostSnapshot(host).sha256===hostSha256,'WEB_REFRESH_HOST_CHANGED');
 for(const file of files.values())if(file.source){const now=fileRecord(file.source,file.path);requireThat(now.sha256===file.sha256&&now.bytes===file.bytes,'WEB_REFRESH_INPUT_CHANGED',file.path);}
 const freshContent=assembleContent(projectRoot,base);requireThat(sha(freshContent.files.get('content/project.json').data)===sha(content.files.get('content/project.json').data)&&sha(freshContent.files.get('content/assets.json').data)===sha(content.files.get('content/assets.json').data)&&sha(freshContent.files.get('content/presentation.json').data)===sha(content.files.get('content/presentation.json').data),'WEB_REFRESH_PROJECT_CHANGED');
 return writePublication(out,preload.html,files,{project:content.payload.config.name,renderer_mode:'official',renderer:'three-webgl',variant:'production',profile:'release',dev_tools:false,preview_tools:false,enabled_systems:enabled,compiled_systems:selected.metadata.compiled_systems,module_dependencies_checked:dependencies,
  preparation:{mode:'source-ingestion-refresh',tool_files:['refresh-official-web.mjs','web-export-files.mjs','web-export-content.mjs','web-export-host.mjs','web-export-validate-worker.mjs','prepare-web-image-assets.mjs'].map(name=>{const r=fileRecord(fileURLToPath(new URL(name,import.meta.url)),name);return{path:r.path,bytes:r.bytes,sha256:r.sha256};}),host_source_commit:hostCommit,host_commit_origin:'caller-supplied label; exact relevant file bytes pinned independently',host_sha256:hostSha256,host_files:inspection.files.map(({path,bytes,sha256})=>({path,bytes,sha256})),core_source_commit:selected.metadata.source_commit,runtime_manifest_sha256:runtimeSha256,runtime_wasm_sha256:selected.metadata.wasm_sha256,runtime_javascript_sha256:selected.metadata.javascript_sha256,base_manifest_sha256:base.manifest_sha256,base_generation_matches_content:base.generation_matches,project:content.project_pins,reused_derived_asset_ids:content.reused,preload:preload.plan,validation,limitations:['Source and source modules compile at runtime load; current native CLI production precompilation was not performed.','Importers, asset conversions, analyzer, gameplay tests, browser/GPU presentation and complete SDK preparation are not performed.','Fresh current host index replaces base HTML; project-owned entry customizations must be reapplied and resealed by their owner.']},cache_policy:{'index.html':'no-cache, must-revalidate','releases/':'public, max-age=31536000, immutable',deployment:'publish complete generation before index; retain old generations for open clients'}});
}
const own=fileURLToPath(import.meta.url);
if(process.argv[1]&&path.resolve(process.argv[1])===own){try{const {values}=parseArgs({options:{project:{type:'string'},'input-export':{type:'string'},'host-root':{type:'string'},'host-sha256':{type:'string'},'host-commit':{type:'string'},runtime:{type:'string'},'runtime-sha256':{type:'string'},output:{type:'string'},'inspect-host':{type:'boolean'},'inspect-runtime':{type:'boolean'}}});if(values['inspect-host'])console.log(JSON.stringify(inspectHostSnapshot(checkedRoot(values['host-root'])),null,2));else if(values['inspect-runtime']){const r=inspectRuntime(values.runtime);console.log(JSON.stringify({sha256:r.sha256,metadata:r.metadata},null,2));}else{const report=await refreshOfficialWeb({project:values.project,inputExport:values['input-export'],hostRoot:values['host-root'],hostSha256:values['host-sha256'],hostCommit:values['host-commit'],runtime:values.runtime,runtimeSha256:values['runtime-sha256'],output:values.output});console.log(JSON.stringify({ok:true,output:path.resolve(values.output),mode:report.preparation.mode,release_root:report.release_root,files:report.files.length,host_sha256:report.preparation.host_sha256,core_source_commit:report.preparation.core_source_commit}));}}catch(error){console.error(JSON.stringify({ok:false,error:String(error.stack??error)}));process.exitCode=1;}}
