// Read-only Scout discovery; save the public contract used for this retest.
import {spawnSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../..');
await mkdir(resolve(here,'tooling'),{recursive:true});
for(const [name,args] of [
 ['recommend',['recommend','--query','AI native 評測']],
 ['init-contract',['describe','--operation','ai_native.init']],
 ['catalog',['catalog']],
 ['template',['init','--id','unone-spatial-observation-profile-v1','--name','Unone spatial arrays and cost diagnostics','--surface','mixed']],
 ['evaluate-contract',['describe','--operation','ai_native.evaluate']],
 ['tool-invariants',['test']],
]){
 const argv=['plugins/org.unone.ai-native/cli.mjs',...args,'--root',root];
 const r=spawnSync(process.execPath,argv,{cwd:root,encoding:'utf8',windowsHide:true,timeout:20000,maxBuffer:2*1024*1024});
 const value=JSON.parse(r.stdout);
 await writeFile(resolve(here,'tooling',name+'.json'),JSON.stringify({command:[process.execPath,...argv],exitCode:r.status,result:value,stderr:r.stderr},null,2)+'\n',{flag:'wx'});
 if(r.status!==0||!value.ok)throw Error('Scout bootstrap failed: '+name);
 console.log(name+': captured');
}
