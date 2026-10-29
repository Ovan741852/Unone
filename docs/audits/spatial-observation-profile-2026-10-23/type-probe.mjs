// Local strict-type design experiments; no engine/game files are modified.
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const dir=await mkdtemp(resolve(tmpdir(),'unone-observation-array-types-'));
const variants={
 generic:'<T>(values: {T}?) -> {T}',
 indexed:'<T>(values: {T}?) -> ({T} & {[number]: ObservationValue})',
 string_indexed:'<T>(values: {T}?) -> ({T} & {[string]: ObservationValue})',
 broad:'(values: {ObservationValue}?) -> {ObservationValue}',
};
for(const [name,signature] of Object.entries(variants)){
 const source=`--!strict
type ObservationValue = nil | boolean | number | string | {[string]: ObservationValue} | {ObservationValue}
type Api = {array: ${signature}, set: (key: string, value: ObservationValue) -> ()}
local function test(api: Api)
 local points: {number} = {1,2,3}
 local mapped = api.array(points)
 local n: number = mapped[1]
 api.set('typed', mapped)
 api.set('empty', api.array())
 api.set('literal', api.array({1,2,3}))
 return n
end
return test
`;
 const path=resolve(dir,name+'.luau');await writeFile(path,source);
 const r=spawnSync('D:/Projects/Unone/.toolcache/luau-0.734/luau-analyze.exe',['--formatter=gnu',path],{encoding:'utf8',windowsHide:true});
 console.log(JSON.stringify({name,status:r.status,stdout:r.stdout,stderr:r.stderr,path}));
 if(name==='string_indexed'){
  const advanced=source.replace('return n',`local records: {{id:number, label:string}} = {{id=1,label='a'}}
 local wrapped = api.array(records)
 local id: number = wrapped[1].id
 local label: string = wrapped[1].label
 api.set('records', wrapped)
 return n + id + #label`);
  const deep=resolve(dir,'string-nested.luau');await writeFile(deep,advanced);
  const good=spawnSync('D:/Projects/Unone/.toolcache/luau-0.734/luau-analyze.exe',['--formatter=gnu',deep],{encoding:'utf8',windowsHide:true});
  console.log(JSON.stringify({name:'string-nested',status:good.status,stderr:good.stderr}));
  await writeFile(deep,advanced.replace('local n: number',"mapped[1]='bad'\n local n: number"));
  const bad=spawnSync('D:/Projects/Unone/.toolcache/luau-0.734/luau-analyze.exe',['--formatter=gnu',deep],{encoding:'utf8',windowsHide:true});
  console.log(JSON.stringify({name:'string-invalid-write',status:bad.status,stderr:bad.stderr}));
 }
}
