import fs from 'node:fs';import path from 'node:path';import {audit} from './runner.mjs';
const report=JSON.parse(fs.readFileSync(path.join(audit,process.argv[2]),'utf8'));
console.log('world keys:',Object.keys(report.value.world));
function find(x,p=''){if(x&&typeof x==='object'){if(Object.hasOwn(x,'typed_numbers'))return {path:p,value:x};for(const [k,v]of Object.entries(x)){const r=find(v,p+'.'+k);if(r)return r;}}return null;}
const result=find(report);if(!result)throw Error('authored observations missing');console.log('observation path:',result.path);
const o=result.value;console.log(JSON.stringify({observations:Object.keys(o),small:o.small_profile,large:o.large_profile,initial:o.initial_result,empty:o.empty_batch_result,invalid:o.invalid_update,consumed:o.consumed_take,entity:report.value.world.entities},null,2));
