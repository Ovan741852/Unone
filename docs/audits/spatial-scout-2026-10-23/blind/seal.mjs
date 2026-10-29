import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';
const root=path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
const manifestPath=path.join(root,'SHA256SUMS.json'),sealPath=path.join(root,'SEAL.txt');
assert.equal(fs.existsSync(manifestPath),false,'Already sealed');assert.equal(fs.existsSync(sealPath),false,'Already sealed');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function list(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?list(path.join(dir,e.name)):[path.join(dir,e.name)]);}
const files=list(root).sort().map(file=>{const bytes=fs.readFileSync(file);return {path:path.relative(root,file).replaceAll('\\','/'),bytes:bytes.length,sha256:hash(bytes)};});
const manifest={algorithm:'sha256',sealedAt:new Date().toISOString(),root,exclusions:['SHA256SUMS.json','SEAL.txt'],files};
fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
const manifestSha256=hash(fs.readFileSync(manifestPath));
for(const file of files){const bytes=fs.readFileSync(path.join(root,file.path));assert.equal(bytes.length,file.bytes);assert.equal(hash(bytes),file.sha256);}
const seal=`UNONE blind spatial scout immutable evidence seal\nManifest: SHA256SUMS.json\nManifest SHA256: ${manifestSha256}\nCovered files: ${files.length}\nEvery covered file verified immediately after manifest creation.\nSHA256SUMS.json is anchored by the hash above; SEAL.txt is the detached seal.\nNo report, source, log or covered artifact is to be rewritten after this point.\n`;
fs.writeFileSync(sealPath,seal,{flag:'wx'});
console.log(JSON.stringify({sealed:true,coveredFiles:files.length,manifest:manifestPath,manifestSha256,report:path.join(root,'report.md'),sourceFallbackStep:null}));