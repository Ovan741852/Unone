import assert from 'node:assert/strict';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url)),base=resolve(here,'blind/scout-diagnostics-sdk');const sha=b=>createHash('sha256').update(b).digest('hex');
const bytes=await readFile(resolve(base,'SHA256SUMS.json'));const hash=sha(bytes);assert.equal(hash,'07772eefb848d205b064dbf7fc2bdc7af0e683601148b85337705f778f62cb16');
assert.ok((await readFile(resolve(base,'SEAL.txt'),'utf8')).includes(hash));const files=JSON.parse(bytes).files;assert.equal(files.length,87);
for(const f of files){const p=resolve(base,f.path);assert.ok(!relative(base,p).startsWith('..'));const b=await readFile(p);assert.equal(b.length,f.bytes);assert.equal(sha(b),f.sha256,f.path);}
async function walk(dir){const out=[];for(const entry of await readdir(dir,{withFileTypes:true})){assert.ok(!entry.isSymbolicLink());const p=resolve(dir,entry.name);out.push(...(entry.isDirectory()?await walk(p):[relative(base,p).replaceAll('\\','/')]));}return out;}
assert.deepEqual((await walk(base)).filter(p=>!['SHA256SUMS.json','SEAL.txt'].includes(p)).sort(),files.map(f=>f.path).sort());
const report={ok:true,files:files.length,manifestSha256:hash,scope:'Read-only exact file-set, size and hash verification; local seal is not certified authorship or full build provenance.'};
await writeFile(resolve(here,'blind-verification.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
