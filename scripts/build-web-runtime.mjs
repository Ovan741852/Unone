// Official POSIX player build. Tool installation belongs to the caller/CI;
// Windows continues to use build-web-live.ps1 and its local policy boundary.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';

export const EMSDK_COMMIT='e8b64774ff1a3ddb6a013203ced27a34e70c2d8b';
export const VARIANTS=['production','phase-profile','sampling-profile'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const target='wasm32-unknown-emscripten';
const usage=`node build-web-runtime.mjs --repo <clean checkout> --cli <matching Linux CLI>
 --emsdk <emsdk checkout> --binaryen <Binaryen131> --target-dir <ignored/outside directory>
 --output <fresh runtime directory> --log-dir <fresh log directory>
 [--variant production|phase-profile|sampling-profile] [--python <Python3.11>]
POSIX only; release opt2, all-systems. No debug fallback, SDK or browser claim.
The current checkout's build-web-live.ps1 is the official ABI/linker contract.`;

function quotedList(value){
 const words=[...value.matchAll(/'([a-z][a-z0-9_]*)'/g)].map(row=>row[1]);
 assert(words.length&&value.replace(/'([a-z][a-z0-9_]*)'|[\s,]/g,'')==='','Invalid official export list');
 return words;
}
export function officialPlayerContract(source,{diagnostic=false,particle=true}={}){
 const base=[...source.matchAll(/\$exports\s*=\s*@\(([^)]*)\)/g)];
 const extra=[...source.matchAll(/\$exports\s*\+=\s*@\(([^)]*)\)/g)];
 assert.equal(base.length,1,'Expected one official player ABI list');
 assert.equal(extra.length,1,'Expected one official particle ABI list');
 const diagnosticRows=[...source.matchAll(/if\s*\(\$diagnosticPlayer\)\s*\{\s*\$exports\s*\+=\s*'([a-z_]+)'\s*\}/g)];
 assert.equal(diagnosticRows.length,1,'Missing official diagnostic ABI addition');
 const exports=[...quotedList(base[0][1]),...(diagnostic?[diagnosticRows[0][1]]:[]),...(particle?quotedList(extra[0][1]):[])];
 assert.equal(new Set(exports).size,exports.length,'Duplicate official ABI');
 const settings=[...source.matchAll(/'((?: -C link-arg=-s[A-Z_]+=[A-Za-z0-9]+)+)'/g)];
 assert.equal(settings.length,1,'Expected one official player linker setting list');
 const linker=settings[0][1].trim().split(' ');
 assert(linker.includes('link-arg=-sENVIRONMENT=web'),'Player must use the official Web environment');
 return {exports,linker};
}

export function selectedSystems(report){
 assert(report?.ok===true&&Array.isArray(report.value?.systems),'Current CLI systems report required');
 const rows=report.value.systems;
 assert(rows.length&&rows.every(row=>typeof row.id==='string'&&/^[a-z][a-z0-9_]*$/.test(row.id)),'Invalid system IDs');
 assert.equal(new Set(rows.map(row=>row.id)).size,rows.length,'Duplicate system IDs');
 assert(rows.every(row=>row.compiled===true),'CLI must have every reported system compiled');
 return rows.map(row=>row.id).sort();
}

export function buildEnvironment({repo,emsdk,binaryen,emscripten,python,contract,env=process.env}){
 const result={...env,EMSDK:emsdk,EM_CONFIG:path.join(emsdk,'.emscripten'),EM_BINARYEN_ROOT:binaryen,
  CC_wasm32_unknown_emscripten:path.join(emscripten,'emcc'),CXX_wasm32_unknown_emscripten:path.join(emscripten,'em++'),
  AR_wasm32_unknown_emscripten:path.join(emscripten,'emar'),CXXFLAGS_wasm32_unknown_emscripten:'-fwasm-exceptions',
  RUSTFLAGS:[...contract.exports.flatMap(name=>['-C',`link-arg=--export=unone_web_${name}`]),...contract.linker].join(' ')};
 if(python)result.EMSDK_PYTHON=python;
 // Encoded flags override RUSTFLAGS in Cargo; never inherit unrelated machine flags.
 delete result.CARGO_ENCODED_RUSTFLAGS;delete result.RUSTC_WRAPPER;delete result.RUSTC_WORKSPACE_WRAPPER;
 assert(fs.existsSync(path.join(repo,'crates/unone-player/Cargo.toml')),'Missing official player manifest');
 return result;
}

export function checkWasm(wasm,contract,diagnostic){
 const actual=WebAssembly.Module.exports(new WebAssembly.Module(wasm)).map(row=>row.name);
 for(const name of contract.exports)assert(actual.includes(`unone_web_${name}`),`Missing actual ABI: ${name}`);
 assert.equal(actual.includes('unone_web_developer_request'),diagnostic,'Developer ABI isolation failed');
 return actual;
}

function ignoredOrOutside(repo,directory){
 const relative=path.relative(repo,directory);
 if(relative==='..'||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative))return;
 const check=spawnSync('git',['-C',repo,'check-ignore','--quiet','--',directory],{encoding:'utf8'});
 assert.equal(check.status,0,'Build/log/output directories inside checkout must be Git-ignored');
}
export function destination(value,{fresh=false}={}){
 const resolved=path.resolve(value),suffix=[];let ancestor=resolved;
 if(fresh)assert(!fs.existsSync(resolved),`Refuse overwrite: ${resolved}`);
 while(!fs.existsSync(ancestor)){suffix.unshift(path.basename(ancestor));ancestor=path.dirname(ancestor);}
 return path.join(fs.realpathSync(ancestor),...suffix);
}
function runner(repo,logs,records){
 return (label,command,args,env=process.env)=>{
  const result=spawnSync(command,args,{cwd:repo,env,encoding:'utf8',maxBuffer:32*1024*1024,timeout:30*60*1000});
  const row={label,command,args,status:result.status,signal:result.signal,error:result.error?String(result.error):null};
  records.push(row);fs.writeFileSync(path.join(logs,`${label}.stdout.log`),result.stdout??'');
  fs.writeFileSync(path.join(logs,`${label}.stderr.log`),result.stderr??'');
  fs.writeFileSync(path.join(logs,'commands.json'),JSON.stringify(records,null,2)+'\n');
  assert(!result.error&&!result.signal&&result.status===0,`Command failed: ${label}; see ${logs}`);
  return result.stdout.trim();
 };
}
function emittedFiles(stdout){
 const messages=stdout.split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
 const artifact=messages.findLast(row=>row.reason==='compiler-artifact'&&row.target?.name==='unone-player');
 assert(artifact,'Cargo did not report the official player artifact');
 const files=[...(artifact.filenames??[]),artifact.executable].filter(Boolean);
 const javascript=files.find(file=>file.endsWith('.js'));assert(javascript,'Missing emitted player JavaScript');
 const bytes=fs.readFileSync(javascript);
 const names=[...bytes.toString('utf8').matchAll(/wasmBinaryFile\s*=\s*['"]([A-Za-z0-9_.-]+\.wasm)['"]/g)];
 const wasm=files.find(file=>file.endsWith('.wasm'))??(names.length===1?path.join(path.dirname(javascript),names[0][1]):null);
 assert(wasm&&fs.statSync(wasm).isFile(),'Missing emitted player WASM');
 return {javascript,wasm};
}

export async function main(argv=process.argv.slice(2),platform=process.platform){
 const {values}=parseArgs({args:argv,options:Object.fromEntries(['repo','cli','emsdk','binaryen','target-dir','output','log-dir','variant','python'].map(key=>[key,{type:'string'}]).concat([['help',{type:'boolean'}]]))});
 if(values.help){console.log(usage);return;}
 assert(platform!=='win32','POSIX builder does not execute on Windows; use the existing approved platform toolchain');
 assert(['linux','darwin'].includes(platform),'Unsupported build platform');
 assert.equal(Number(process.versions.node.split('.')[0]),24,'Use the pinned host Node24, not the SDK build-time Node');
 for(const key of ['repo','cli','emsdk','binaryen','target-dir','output','log-dir'])assert(values[key],`Missing --${key}`);
 const repo=fs.realpathSync(values.repo),cli=fs.realpathSync(values.cli),emsdk=fs.realpathSync(values.emsdk),binaryen=fs.realpathSync(values.binaryen);
 const output=destination(values.output,{fresh:true}),logs=destination(values['log-dir'],{fresh:true}),targetDir=destination(values['target-dir']);
 for(const directory of [output,logs,targetDir])ignoredOrOutside(repo,directory);
 const variant=values.variant??'production';assert(VARIANTS.includes(variant),'Invalid build variant');
 const records=[];fs.mkdirSync(logs,{recursive:true});const run=runner(repo,logs,records);
 const commit=run('source-commit','git',['rev-parse','HEAD']);assert(/^[a-f0-9]{40}$/.test(commit));
 assert.equal(run('source-clean','git',['status','--porcelain']),'','A clean source checkout is required');
 assert.equal(run('emsdk-commit','git',['-C',emsdk,'rev-parse','HEAD']),EMSDK_COMMIT,'Unexpected emsdk checkout');
 const emscripten=[path.join(emsdk,'upstream/emscripten'),path.join(emsdk,'emscripten')].find(dir=>fs.existsSync(path.join(dir,'emcc')));
 assert(emscripten,'Missing emcc in the selected emsdk');
 const ps=fs.readFileSync(path.join(repo,'scripts/build-web-live.ps1'));
 const systems=selectedSystems(JSON.parse(run('systems',cli,['--project',path.join(repo,'tests/host-parity-project'),'systems','list','--json'])));
 const diagnostic=variant!=='production',contract=officialPlayerContract(ps.toString('utf8'),{diagnostic,particle:systems.includes('particle')});
 const env=buildEnvironment({repo,emsdk,binaryen,emscripten,python:values.python,contract});
 assert(/\b3\.1\.39\b/.test(run('emcc-version',path.join(emscripten,'emcc'),['--version'],env)),'Emscripten3.1.39 required');
 assert(/\b131\b/.test(run('binaryen-version',path.join(binaryen,'bin/wasm-opt'),['--version'],env)),'Binaryen131 required');
 const features=['all-systems',...(diagnostic?[variant]:[])];
 const built=run('cargo','cargo',['build','--locked','--manifest-path',path.join(repo,'crates/unone-player/Cargo.toml'),'--target-dir',targetDir,'--release','--target',target,'--no-default-features','--features',features.join(','),'--message-format=json-render-diagnostics'],env);
 const files=emittedFiles(built),wasm=fs.readFileSync(files.wasm),javascript=fs.readFileSync(files.javascript);
 const actual=checkWasm(wasm,contract,diagnostic),pkg=JSON.parse(fs.readFileSync(path.join(repo,'packages/unone-ui/package.unone.json')));
 assert.equal(pkg.name,'@unone/ui');assert(typeof pkg.version==='string'&&pkg.version);
 assert.equal(run('source-clean-after','git',['status','--porcelain']),'','Source changed during compilation');
 assert.equal(run('source-commit-after','git',['rev-parse','HEAD']),commit,'Source commit changed during compilation');
 const manifest={compiled_systems:systems,runtime_packages:systems.includes('ui')?{[pkg.name]:pkg.version}:{},cargo_features:features,profile:'release',dev_tools:false,preview_tools:diagnostic,phase_profile:variant==='phase-profile',sampling_profile:variant==='sampling-profile',bytecode_optimization_level:2,profile_mode:variant==='phase-profile'?'phase-only':variant==='sampling-profile'?'opt2-sampling':'none',javascript:path.basename(files.javascript),wasm:path.basename(files.wasm),wasm_bytes:wasm.length,wasm_sha256:sha(wasm),javascript_sha256:sha(javascript),exports:contract.exports,source_commit:commit,source_dirty:false};
 fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,manifest.javascript),javascript);fs.writeFileSync(path.join(output,manifest.wasm),wasm);
 fs.writeFileSync(path.join(output,'runtime.json'),JSON.stringify(manifest,null,2)+'\n');
 const hashes=Object.fromEntries(['runtime.json',manifest.javascript,manifest.wasm].map(name=>{const bytes=fs.readFileSync(path.join(output,name));return [name,{bytes:bytes.length,sha256:sha(bytes)}];}));
 fs.writeFileSync(path.join(logs,'artifact-hashes.json'),JSON.stringify(hashes,null,2)+'\n');
 fs.writeFileSync(path.join(logs,'build-provenance.json'),JSON.stringify({node:process.version,platform,emsdk_commit:EMSDK_COMMIT,source_commit:commit,builder_sha256:sha(fs.readFileSync(fileURLToPath(import.meta.url))),powershell_contract_sha256:sha(ps),cli_sha256:sha(fs.readFileSync(cli)),actual_wasm_exports:actual,rustflags:env.RUSTFLAGS,scope:'Official all-systems source runtime; parity/visual acceptance are separate checks.'},null,2)+'\n');
 console.log(JSON.stringify({ok:true,output,logs,manifest}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.stack??error);process.exitCode=1;});
