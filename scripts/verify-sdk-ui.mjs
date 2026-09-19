// Fixed case IDs and full evidence survive failures. Never mutates supplied SDK/project.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const args=process.argv.slice(2),option=n=>args[args.indexOf(n)+1];
for(const n of ['--sdk','--output','--other-cli'])if(!args.includes(n))throw Error(`${n} required`);
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.resolve(option('--output'));
if(out===repo||out.startsWith(repo+path.sep)||fs.existsSync(out))throw Error('Choose a new directory outside the checkout');
fs.mkdirSync(out,{recursive:true});fs.cpSync(path.resolve(option('--sdk')),path.join(out,'sdk'),{recursive:true});fs.cpSync(path.join(repo,'docs/fixtures/sdk-ui'),path.join(out,'project'),{recursive:true});fs.mkdirSync(path.join(out,'empty'));
const sdk=path.join(out,'sdk'),project=path.join(out,'project'),cwd=path.join(out,'empty'),manifest=JSON.parse(fs.readFileSync(path.join(sdk,'sdk.json'))),cli=path.join(sdk,manifest.cli);
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const env={...process.env};delete env.UNONE_SDK_ROOT;delete env.UNONE_PLUGIN_PATHS;
const evidence={version:1,startedAt:new Date().toISOString(),host:{platform:process.platform,arch:process.arch,node:process.version},sdkManifestSha256:sha(fs.readFileSync(path.join(sdk,'sdk.json'))),files:manifest.files,checks:[],limits:['Fixture plugin tests transport, not commercial plugin compatibility','Same computer relocation; not a second-machine or mobile test','Hash verification is not schema/renderer compatibility proof']};
const save=()=>fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify(evidence,null,2)+'\n');
evidence.runnerSha256=sha(fs.readFileSync(fileURLToPath(import.meta.url)));
evidence.fixtureFiles=fs.readdirSync(project,{recursive:true}).filter(p=>fs.statSync(path.join(project,p)).isFile()).sort().map(p=>({path:p,sha256:sha(fs.readFileSync(path.join(project,p)))}));
function check(id,command,argv,{ok=true,code,verify}={}){
 const r=spawnSync(command,argv,{cwd,env,encoding:'utf8',timeout:120000,windowsHide:true,maxBuffer:16*1024*1024});
 const row={id,command,argv,exit:r.status,error:r.error?.message??null,stdout:r.stdout,stderr:r.stderr,expectedSuccess:ok,expectedCode:code??null,passed:false};evidence.checks.push(row);
 try{if(r.error||(r.status===0)!==ok)throw Error('unexpected process result');if(code&&!`${r.stdout}\n${r.stderr}`.includes(code))throw Error(`missing ${code}`);if(verify)verify(r);row.passed=true;}catch(e){row.failure=String(e);}save();return row;
}
const call=(id,argv,opt={})=>check(id,cli,[...argv,'--json'],{...opt,verify:r=>{if(JSON.parse(r.stdout).ok!==(opt.ok??true))throw Error('JSON success disagrees');opt.verify?.(r);}});
function mutate(file,change,fn){const raw=fs.readFileSync(file);try{fs.writeFileSync(file,change(raw));fn();}finally{fs.writeFileSync(file,raw);}}
const platform=(target,output)=>['--project',project,'export','platform','--target',target,'--output',path.join(out,output)];
call('SDK-UI-001',['sdk','inspect'],{verify:r=>{const v=JSON.parse(r.stdout).value;if(!v.sources?.cli?.sha256||!v.sources?.runtimes?.length)throw Error('missing source evidence');}});
call('SDK-UI-002',platform('web','web'),{verify:()=>{if(!fs.existsSync(path.join(out,'web/web/shared/canvas-ui.mjs')))throw Error('missing Canvas module');}});
call('SDK-UI-003',platform('windows','native'),{verify:()=>{if(!fs.existsSync(path.join(out,'native/content/presentation.json')))throw Error('missing presentation');}});
const player=path.join(out,'native/unone-native-player.exe');
check('SDK-UI-004',player,['--root',path.join(out,'native'),'--frames','3','--warmup','0','--fixed-tick','--report',path.join(out,'native-render.json')],{verify:()=>{const r=JSON.parse(fs.readFileSync(path.join(out,'native-render.json')));if(r.error||r.frame!==3)throw Error('native frame failed');const image=fs.readFileSync(path.join(out,'native-render.png'));if(!image.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('missing PNG screenshot');evidence.artifacts=[{path:'native-render.png',sha256:sha(image),bytes:image.length,interpretation:'artifact creation checked automatically; appearance requires visual inspection'}];}});
const template=path.join(sdk,'templates/web/shared/canvas-ui.mjs');
mutate(template,b=>Buffer.concat([b,Buffer.from('tamper')]),()=>call('SDK-UI-005',['sdk','inspect'],{ok:false,code:'SDK_HASH_MISMATCH'}));
fs.renameSync(template,template+'.held');try{call('SDK-UI-006',['sdk','inspect'],{ok:false,code:'SDK_FILE_MISSING'});}finally{fs.renameSync(template+'.held',template);}
const wasm=manifest.files.find(f=>f.path.endsWith('.wasm')&&f.path.startsWith('runtimes/'));
mutate(path.join(sdk,wasm.path),b=>Buffer.concat([b,Buffer.from('tamper')]),()=>call('SDK-UI-007',['sdk','inspect'],{ok:false,code:'SDK_HASH_MISMATCH'}));
mutate(path.join(sdk,'sdk.json'),b=>Buffer.from(JSON.stringify({...JSON.parse(b),typo:true})),()=>call('SDK-UI-008',['sdk','inspect'],{ok:false,code:'SDK_MANIFEST_INVALID'}));
call('SDK-UI-009',['--project',project,'plugin','test','--id','org.unone.compat-probe']);
const plugin=path.join(project,'plugins/org.unone.compat-probe/plugin.json');
mutate(plugin,b=>Buffer.from(JSON.stringify({...JSON.parse(b),api:'unone.plugin.v999'})),()=>call('SDK-UI-010',['--project',project,'plugin','test','--id','org.unone.compat-probe'],{ok:false,code:'PLUGIN_API'}));
// A self-consistent old descriptor is not corruption: selection must reject the missing capability.
const native=manifest.runtimes.find(r=>r.target==='windows'),descriptor=path.join(sdk,native.path,'runtime.json'),sdkFile=path.join(sdk,'sdk.json');
const originalManifest=fs.readFileSync(sdkFile);
try{mutate(descriptor,b=>{const r=JSON.parse(b);delete r.ui;const bytes=Buffer.from(JSON.stringify(r));const m=JSON.parse(originalManifest);const entry=m.files.find(f=>f.path===`${native.path}/runtime.json`);entry.sha256=sha(bytes);entry.bytes=bytes.length;fs.writeFileSync(sdkFile,JSON.stringify(m));return bytes;},()=>call('SDK-UI-011',platform('windows','old-runtime'),{ok:false,code:'NATIVE_TEXTURE_FORMAT_UNSUPPORTED',verify:()=>{if(fs.existsSync(path.join(out,'old-runtime')))throw Error('failed export left output');}}));}finally{fs.writeFileSync(sdkFile,originalManifest);}
call('SDK-UI-012',['sdk','inspect']);
check('SDK-UI-013',path.resolve(option('--other-cli')),['--sdk',sdk,'sdk','inspect','--json'],{ok:false,code:'SDK_CLI_MISMATCH'});
mutate(plugin,b=>{const p=JSON.parse(b);p.entry.command='unone-nonexistent-compat-probe-executable';return Buffer.from(JSON.stringify(p));},()=>call('SDK-UI-014',['--project',project,'plugin','test','--id','org.unone.compat-probe'],{ok:false,code:'PLUGIN_PROCESS_START_FAILED'}));
// Documents an intentional current gap: same protocol does not enforce a version range.
mutate(plugin,b=>Buffer.from(JSON.stringify({...JSON.parse(b),version:'999.0.0'})),()=>call('SDK-UI-015',['--project',project,'plugin','test','--id','org.unone.compat-probe']));
evidence.limits.push('SDK-UI-015 demonstrates no plugin semver compatibility gate; protocol success is not version certification');
evidence.finishedAt=new Date().toISOString();evidence.passed=evidence.checks.every(c=>c.passed);save();
console.log(JSON.stringify({passed:evidence.passed,cases:evidence.checks.length,evidence:path.join(out,'evidence.json')}));process.exitCode=evidence.passed?0:1;
