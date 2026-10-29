// Read-only with respect to this evidence directory. Replays write only a new OS-temp project and stdout.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';import {verify} from './verify-report.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const sdk=process.argv[2]??'D:/Projects/Unone/artifacts/spatial-observation-profile-sdk';
const analyzer=process.argv[3]??'D:/Projects/Unone/.toolcache/luau-0.734/luau-analyze.exe';
const manifest=JSON.parse(fs.readFileSync(path.join(sdk,'sdk.json'),'utf8'));
const project=fs.mkdtempSync(path.join(os.tmpdir(),'unone-spatial-replay-'));
fs.mkdirSync(path.join(project,'scripts'));fs.mkdirSync(path.join(project,'scenes'));
fs.copyFileSync(path.join(here,'main.final.luau'),path.join(project,'scripts/main.luau'));
fs.copyFileSync(path.join(here,'project.final.json'),path.join(project,'project.unone.json'));
fs.copyFileSync(path.join(here,'scene.final.json'),path.join(project,'scenes/main.scene.json'));
const command=path.join(sdk,manifest.cli);
function run(label,args,env={}){const argv=['--sdk',sdk,'--project',project,'--json',...args];console.log(JSON.stringify({plannedAt:new Date().toISOString(),label,command,argv,cwd:project,timeoutMs:60000,envOverrides:env,sourceFallbackStep:null}));const start=performance.now();const r=spawnSync(command,argv,{cwd:project,env:{...process.env,...env},encoding:'utf8',timeout:60000,maxBuffer:64*1024*1024,windowsHide:true});fs.writeFileSync(path.join(project,label+'.stdout'),r.stdout??'');fs.writeFileSync(path.join(project,label+'.stderr'),r.stderr??'');console.log(JSON.stringify({label,elapsedMs:performance.now()-start,exitCode:r.status,signal:r.signal,error:r.error?String(r.error):null,stdout:path.join(project,label+'.stdout'),stderr:path.join(project,label+'.stderr'),stdoutSha256:crypto.createHash('sha256').update(r.stdout??'').digest('hex')}));if(r.status!==0)throw Error(label+' failed: '+(r.stdout??'')+(r.stderr??''));return JSON.parse(r.stdout);}
const strict=run('strict-check',['check','--types'],{UNONE_LUAU_ANALYZER:analyzer});if(!strict.ok||!strict.value.type_check.passed)throw Error('strict check did not pass');
const report=run('native-six-ticks',['run','--frames','6']);console.log(JSON.stringify({project,strictPassed:true,verification:verify(report)},null,2));
