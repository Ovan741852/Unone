import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import cp from 'node:child_process';import crypto from 'node:crypto';
const ROOT=path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
const LOG=path.join(ROOT,'ledger.jsonl');let seq=fs.existsSync(LOG)?fs.readFileSync(LOG,'utf8').trim().split('\n').filter(Boolean).length:0;
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const argv=process.argv.slice(2);const rec={sequence:++seq,started:new Date().toISOString(),argv,cwd:process.cwd(),kind:argv[0]};
try {let result;
if(argv[0]==='read'){const data=fs.readFileSync(argv[1],'utf8');result={path:argv[1],sha256:sha(data),text:data};}
else if(argv[0]==='exec'){const [,name,exe,...args]=argv;const start=performance.now();const r=cp.spawnSync(exe,args,{cwd:ROOT,encoding:'utf8',env:{...process.env,UNONE_LUAU_ANALYZER:'D:/Projects/Unone/.toolcache/luau-0.734/luau-analyze.exe'},maxBuffer:64*1024*1024});result={executable:exe,args,status:r.status,signal:r.signal,error:r.error?String(r.error):null,elapsed_ms:performance.now()-start,stdout:r.stdout,stderr:r.stderr};fs.writeFileSync(path.join(ROOT,name+'.raw.json'),JSON.stringify(result,null,2));}
else if(argv[0]==='write'){const b=Buffer.from(argv[2],'base64');fs.mkdirSync(path.dirname(argv[1]),{recursive:true});fs.writeFileSync(argv[1],b);result={path:argv[1],bytes:b.length,sha256:sha(b)};}
else if(argv[0]==='copy'){fs.cpSync(argv[1],argv[2],{recursive:true,errorOnExist:true,force:false});result={source:argv[1],destination:argv[2]};}
else if(argv[0]==='temp'){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sdk-scout-'));fs.writeFileSync(path.join(ROOT,'temp-project-path.txt'),dir);result={tempProject:dir};}
else if(argv[0]==='identity'){const files=argv.slice(1).map(p=>({path:p,bytes:fs.statSync(p).size,sha256:sha(fs.readFileSync(p))}));result={node:process.version,nodeExecutable:process.execPath,platform:process.platform,arch:process.arch,osRelease:os.release(),files};}
else throw new Error('Unknown runner action');
rec.result=result;rec.finished=new Date().toISOString();fs.appendFileSync(LOG,JSON.stringify(rec)+'\n');console.log(JSON.stringify(result));}
catch(e){rec.error=String(e);rec.finished=new Date().toISOString();fs.appendFileSync(LOG,JSON.stringify(rec)+'\n');console.error(String(e));process.exitCode=1;}
