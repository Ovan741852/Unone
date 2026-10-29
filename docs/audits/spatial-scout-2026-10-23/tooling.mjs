// Read-only Scout bootstrap and template capture. Writes only this new audit.
import {spawnSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../..');
const plugin=resolve(root,'plugins/org.unone.ai-native');
await mkdir(resolve(here,'tooling'),{recursive:true});
const calls=[
 ['recommend',['recommend','--query','AI native 評測']],
 ['init-contract',['describe','--operation','ai_native.init']],
 ['catalog',['catalog']],
 ['template',['init','--id','unone-spatial-v1','--name','Unone spatial batch API','--surface','mixed']],
 ['evaluate-contract',['describe','--operation','ai_native.evaluate']],
 ['tool-invariants',['test']],
];
for(const [name,args] of calls){
 const result=spawnSync(process.execPath,['cli.mjs',...args,'--root',root],{cwd:plugin,encoding:'utf8',windowsHide:true,timeout:20000,maxBuffer:2*1024*1024});
 const value=JSON.parse(result.stdout);
 await writeFile(resolve(here,'tooling',name+'.json'),JSON.stringify({command:[process.execPath,'cli.mjs',...args,'--root',root],exitCode:result.status,result:value,stderr:result.stderr},null,2)+'\n',{flag:'wx'});
 if(result.status!==0||!value.ok)throw Error('Scout bootstrap failed: '+name);
 console.log(name+': captured');
}
