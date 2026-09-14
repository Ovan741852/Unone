import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const out=fileURLToPath(new URL('./',import.meta.url));mkdirSync(out,{recursive:true});
const cli='D:/Projects/Unone/target/debug/game.exe',project='D:/Projects/YesSir/_Games/ashen-legion';
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const env={...process.env,UNONE_PLUGIN_PATHS:'D:/Projects'};
function run(name,args,environment=env){const r=spawnSync(cli,['--project',project,'--json',...args],{cwd:'D:/Projects/Unone',env:environment,encoding:'utf8',timeout:60000});const report={command:cli,args,exit_code:r.status,error:r.error?.message??null,stderr:r.stderr,result:r.stdout?JSON.parse(r.stdout):null};writeFileSync(join(out,name+'.json'),JSON.stringify(report,null,2));return report;}
const defaultEnvironment={...process.env};delete defaultEnvironment.UNONE_PLUGIN_PATHS;
const defaultDiscovery=run('discovery-default',['plugin','list'],defaultEnvironment);
run('discovery-explicit',['plugin','list']);
const results=[];
for(const [short,id,root] of [['ui','org.koncrate.unone-ui','D:/Projects/UnoneUI'],['shader','org.koncrate.unone-shader','D:/Projects/Unone-shader']]){
 const inspect=run(short+'-inspect',['plugin','inspect','--id',id]);
 const test=run(short+'-self-test',['plugin','test','--id',id]);
 const manifestPath=join(root,'plugin.json'),entryPath=join(root,'plugin.mjs'),manifest=JSON.parse(readFileSync(manifestPath));
 const git=arg=>spawnSync('git',['-C',root,...arg],{encoding:'utf8'}).stdout.trim();
 results.push({id,version:manifest.version,manifestPath,manifest_sha256:hash(manifestPath),entryPath,entry_sha256:hash(entryPath),commit:git(['rev-parse','HEAD']),working_tree:git(['status','--porcelain']),inspect_ok:inspect.result?.ok,test_ok:test.result?.ok,test_exit:test.exit_code});
}
const summary={date:new Date().toISOString(),project,cli,cli_sha256:hash(cli),discovery_without_env:defaultDiscovery.result?.value?.plugins?.map(p=>p.id),explicit_plugin_root:env.UNONE_PLUGIN_PATHS,plugins:results,shipped_ui:{path:project+'/dist/web/web/shared/canvas-ui.mjs',sha256:hash(project+'/dist/web/web/shared/canvas-ui.mjs')},scope:'Existing plugin inspect and self-test only. No SDK swap, no native full-game test, no long parity rerun.'};
writeFileSync(join(out,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));if(results.some(r=>!r.inspect_ok||!r.test_ok||r.test_exit!==0))process.exitCode=1;
