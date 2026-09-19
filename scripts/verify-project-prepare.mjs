// Integration acceptance against a real, release, hash-verified portable SDK.
import assert from 'node:assert/strict';
import {cp, mkdir, readFile, readdir, writeFile, stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import {resolve,join,relative,toNamespacedPath} from 'node:path';
const {values}=parseArgs({options:{sdk:{type:'string'},project:{type:'string'},out:{type:'string'}}});
for(const key of ['sdk','project','out'])assert.ok(values[key],`Missing --${key}`);
const sdk=resolve(values.sdk),out=resolve(values.out),project=join(out,'project'),cli=join(sdk,'bin','game.exe');
await mkdir(out);
await cp(resolve(values.project),project,{recursive:true,filter:path=>!path.split(/[\\/]/).some(part=>['.unone','.koncrate','bundles'].includes(part))});
const report={scope:'Real release CLI and portable runtime manifests; isolated copied project',ok:false,cases:[]};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fingerprint(root){
  const files={};
  async function visit(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory())await visit(path);else files[relative(root,path)]=hash(await readFile(path));}}
  await visit(root);return files;
}
function run(args){
  const result=spawnSync(cli,['--sdk',sdk,'--project',project,'--json','project',...args],{encoding:'utf8',timeout:120000,windowsHide:true,maxBuffer:8*1024*1024});
  assert.ifError(result.error);
  let json;try{json=JSON.parse(result.stdout);}catch{throw Error(`CLI did not return JSON: ${result.stderr}\n${result.stdout}`);}
  return {exitCode:result.status,...json};
}
async function check(name,action){const start=performance.now();const result=await action();await writeFile(join(out,`${name}.json`),JSON.stringify(result,null,2));report.cases.push({name,ms:Math.round(performance.now()-start),exitCode:result.exitCode,status:result.value?.status,diagnostics:result.diagnostics?.map(d=>d.code)});return result;}
try{
  const before=await fingerprint(project);
  for(const target of ['web','windows'])await check(`preflight-${target}`,async()=>{const r=run(['preflight','--target',target]);assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.value.status,'compatible');assert.deepEqual(await fingerprint(project),before,'preflight must not write files');return r;});
  for(const target of ['web','windows'])await check(`prepare-${target}`,async()=>{const r=run(['prepare','--target',target,'--output',join(out,target)]);assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.exitCode,0);assert.equal(r.value.status,'ready');assert.equal(r.value.target,target);assert.equal(r.value.sync.status,'synced');assert.equal(r.value.launch.kind,target==='web'?'static':'native');if(target==='windows'){assert.equal(r.value.launch.executable_source,'sdk-runtime');assert.ok(r.value.launch.executable.startsWith(r.value.runtime.runtime_root));assert.equal(r.value.launch.args[1],r.value.output);}return r;});
  const webHash=await fingerprint(join(out,'web'));
  await check('existing-output',async()=>{const r=run(['prepare','--target','web','--output',join(out,'web')]);assert.equal(r.ok,false);assert.notEqual(r.exitCode,0);assert.equal(r.diagnostics[0].code,'PROJECT_PREPARE_OUTPUT_EXISTS');assert.deepEqual(await fingerprint(join(out,'web')),webHash);return r;});
  await check('missing-runtime',async()=>{const snapshot=await fingerprint(project);const r=run(['prepare','--target','web','--runtime-id','missing-runtime','--output',join(out,'missing-runtime')]);assert.equal(r.ok,false);assert.notEqual(r.exitCode,0);assert.equal(r.diagnostics[0].code,'SDK_RUNTIME_UNAVAILABLE');assert.deepEqual(await fingerprint(project),snapshot);assert.equal(await stat(join(out,'missing-runtime')).catch(()=>null),null);return r;});
  if(process.platform==='win32')await check('deep-sdk-runtime-rejected-before-mutation',async()=>{
    const snapshot=await fingerprint(project),deepSdk=join(out,'deep-sdk',`install-${'x'.repeat(100)}`);
    await cp(sdk,deepSdk,{recursive:true});
    const child=spawnSync(toNamespacedPath(join(deepSdk,'bin','game.exe')),['--sdk',deepSdk,'--project',project,'--json','project','preflight','--target','windows'],{encoding:'utf8',timeout:30000,windowsHide:true,maxBuffer:8*1024*1024});
    assert.ifError(child.error);const result=JSON.parse(child.stdout);
    assert.equal(result.ok,false);assert.notEqual(child.status,0);assert.equal(result.diagnostics[0].code,'SDK_RUNTIME_EXECUTABLE_PATH_TOO_LONG');
    assert.deepEqual(await fingerprint(project),snapshot);return {exitCode:child.status,...result};
  });
  await check('unsupported-target',async()=>{const r=spawnSync(cli,['--sdk',sdk,'--project',project,'--json','project','prepare','--target','ios','--output',join(out,'ios')],{encoding:'utf8',timeout:10000,windowsHide:true});assert.ifError(r.error);assert.notEqual(r.status,0);assert.match(r.stderr,/invalid value.*ios/);assert.equal(await stat(join(out,'ios')).catch(()=>null),null);return {exitCode:r.status,usageError:r.stderr};});
  const configPath=join(project,'project.unone.json'),config=JSON.parse(await readFile(configPath,'utf8'));
  await writeFile(configPath,JSON.stringify({...config,systems:{...config.systems,spine:true}},null,2));
  await check('unsupported-native-system',async()=>{const snapshot=await fingerprint(project);const r=run(['preflight','--target','windows']);assert.equal(r.ok,false);assert.notEqual(r.exitCode,0);assert.deepEqual(await fingerprint(project),snapshot);assert.ok(r.diagnostics.some(d=>/spine/i.test(d.explanation)));return r;});
  await writeFile(configPath,JSON.stringify(config,null,2));
  const testPath=join(project,'ready.test.json'),test=JSON.parse(await readFile(testPath,'utf8'));test.assertions[0].observation.equals=false;await writeFile(testPath,JSON.stringify(test,null,2));
  await check('verification-failure',async()=>{const r=run(['prepare','--target','web','--output',join(out,'verification-failure')]);assert.equal(r.ok,false);assert.notEqual(r.exitCode,0);assert.equal(r.value.status,'sync_failed');assert.equal(await stat(join(out,'verification-failure')).catch(()=>null),null);assert.deepEqual(await fingerprint(join(out,'web')),webHash);return r;});
  report.sdkCliSha256=hash(await readFile(cli));report.ok=true;
}catch(error){report.error={message:error.message,stack:error.stack};process.exitCode=1;}
await writeFile(join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
