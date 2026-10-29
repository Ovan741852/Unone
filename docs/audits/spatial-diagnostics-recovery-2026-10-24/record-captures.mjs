import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../..'),base='docs/audits/spatial-diagnostics-recovery-2026-10-24';
const seal=JSON.parse(await readFile(resolve(here,'blind-verification.json'),'utf8'));assert.equal(seal.ok,true);
const sha=b=>createHash('sha256').update(b).digest('hex');const archive=JSON.parse(await readFile(resolve(here,'source-snapshot.json'),'utf8'));
for(const f of archive.files)assert.equal(sha(await readFile(resolve(root,f.path))),f.sha256,'source changed since selected archive: '+f.path);
const subjects=JSON.parse(await readFile(resolve(here,'subject-paths.json'),'utf8'));
subjects.push(...['final-project/project.unone.json','final-project/scripts/main.luau','final-project/scenes/main.scene.json','verify-json.mjs'].map(p=>base+'/blind/scout-diagnostics-sdk/'+p));assert.equal(subjects.length,62);assert.equal(new Set(subjects).size,subjects.length);
await writeFile(resolve(here,'final-subject-paths.json'),JSON.stringify(subjects,null,2)+'\n',{flag:'wx'});
for(const [name,script]of [['public','public-probe-v3.mjs'],['cost','cost-probe.mjs'],['web','web-probe.mjs'],['fault','fault-probe.mjs'],['native','native-probe.mjs'],['blind-replay','blind-replay.mjs']]){
 const output=base+'/capture-'+name+'.json';
 const args=['plugins/org.unone.ai-native/scripts/record-probe.mjs','--root',root,'--script',base+'/'+script,'--output',output,'--mode','fixture','--timeout','60000','--limitation','Selected archived text inputs and pinned local binaries; not full compiler provenance, real device-loss validation, blind GPU authorship, universal speedup or rendered-player certification.',...subjects.flatMap(p=>['--subject',p])];
 console.log(JSON.stringify({event:'start',name}));const child=spawn(process.execPath,args,{cwd:root,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);const code=await new Promise((res,rej)=>{child.once('error',rej);child.once('close',res);});
 await writeFile(resolve(root,output+'.recorder.txt'),JSON.stringify({command:[process.execPath,...args],exitCode:code,stdout,stderr},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({event:'finished',name,code,stdout,stderr}));assert.equal(code,0,'preserve failed capture and repair with a new path: '+name);
}
