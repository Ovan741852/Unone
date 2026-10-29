import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export const audit = path.dirname(fileURLToPath(import.meta.url));
export const sdk = 'D:/Projects/Unone/artifacts/spatial-observation-profile-sdk';
export async function op(label, command, args, options={}) {
 const indexPath=path.join(audit,'operations.json');
 const ops=fs.existsSync(indexPath)?JSON.parse(fs.readFileSync(indexPath,'utf8')):[];
 const id=String(ops.length+1).padStart(3,'0');
 const entry={id,label,plannedAt:new Date().toISOString(),command,argv:args,cwd:options.cwd??audit,timeoutMs:options.timeoutMs??30000,nature:options.nature??'exploration',sourceFallbackStep:null};
 ops.push(entry); fs.writeFileSync(indexPath,JSON.stringify(ops,null,2)+'\n');
 const start=performance.now();
 const result=await new Promise(resolve=>{const child=spawn(command,args,{cwd:entry.cwd,env:{...process.env,...options.env},windowsHide:true});const out=[],err=[];let timedOut=false;const timer=setTimeout(()=>{timedOut=true;child.kill();},entry.timeoutMs);child.stdout.on('data',b=>out.push(b));child.stderr.on('data',b=>err.push(b));child.on('error',error=>err.push(Buffer.from(String(error))));child.on('close',(code,signal)=>{clearTimeout(timer);resolve({stdout:Buffer.concat(out),stderr:Buffer.concat(err),exitCode:code,signal,timedOut});});});
 const prefix=path.join(audit,id+'-'+label.replace(/[^a-z0-9_-]/gi,'-'));
 fs.writeFileSync(prefix+'.stdout',result.stdout);fs.writeFileSync(prefix+'.stderr',result.stderr);
 Object.assign(entry,{finishedAt:new Date().toISOString(),elapsedMs:performance.now()-start,exitCode:result.exitCode,signal:result.signal,timedOut:result.timedOut,stdout:path.basename(prefix+'.stdout'),stderr:path.basename(prefix+'.stderr')});fs.writeFileSync(indexPath,JSON.stringify(ops,null,2)+'\n');
 console.log(JSON.stringify(entry));if(options.echo!==false)console.log(result.stdout.toString());console.error(result.stderr.toString());return result;
}
export function powershell(script){return ['powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',script]];}

