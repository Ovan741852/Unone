import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url)),base=resolve(here,'blind/scout-arrays-profile');
const hash=b=>createHash('sha256').update(b).digest('hex');
const manifest=await readFile(resolve(base,'SHA256SUMS.json'));
const seal=(await readFile(resolve(base,'SEAL.txt'),'utf8')).trim();
assert.equal(seal.split(/\s+/)[0],hash(manifest));
const files=JSON.parse(manifest);
for(const f of files){const p=resolve(base,f.path);assert.ok(!relative(base,p).startsWith('..'));const b=await readFile(p);assert.equal(b.length,f.bytes);assert.equal(hash(b),f.sha256,f.path);}
const result={ok:true,files:files.length,manifestSha256:hash(manifest),scope:'Read-only hash/length consistency of sealed blind evidence; not independent authorship certification.'};
await writeFile(resolve(here,'blind-verification.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(result));
