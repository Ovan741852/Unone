// Invokes the unchanged Scout recorder with the same selected inputs for every
// reviewed probe. Mutation is limited to new local audit outputs and temp fixtures.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../..');
const base='docs/audits/spatial-observation-profile-2026-10-23';
const blind=base+'/blind/scout-arrays-profile';
const subjects=JSON.parse(await readFile(resolve(here,'selected-subjects.json'),'utf8'));
subjects.push(...['main.final.luau','project.final.json','scene.final.json','verify-report.mjs'].map(p=>blind+'/'+p));
assert.equal(new Set(subjects).size,subjects.length);assert.ok(subjects.length<=64);
await writeFile(resolve(here,'final-subject-paths.json'),JSON.stringify(subjects,null,2)+'\n',{flag:'wx'});
for(const [name,script]of [['public','probe.mjs'],['web','web-probe.mjs'],['native','native-probe.mjs'],['kernel','kernel-probe.mjs'],['blind-replay','blind-replay.mjs']]){
 const output=base+'/capture-'+name+'.json';
 const args=['plugins/org.unone.ai-native/scripts/record-probe.mjs','--root',root,'--script',base+'/'+script,'--output',output,'--mode','fixture','--timeout','60000','--limitation','Selected inputs, pinned local binaries and synthetic fixtures; not full source-to-binary provenance, cross-device certification, GPU speedup, kernel timestamps or rendered presentation.',...subjects.flatMap(p=>['--subject',p])];
 console.log(JSON.stringify({event:'start',name}));
 const child=spawn(process.execPath,args,{cwd:root,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
 child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
 const code=await new Promise((res,rej)=>{child.once('error',rej);child.once('close',res);});
 await writeFile(resolve(root,output+'.recorder.txt'),JSON.stringify({command:[process.execPath,...args],exitCode:code,stdout,stderr},null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({event:'finished',name,code,stdout,stderr}));assert.equal(code,0,name+' recorder failed; preserve and repair with a new capture');
}
