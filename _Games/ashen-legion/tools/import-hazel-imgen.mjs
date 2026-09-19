// Package ImageGen outputs without redrawing, recoloring or removing backgrounds.
// Source PNGs remain lossless; the only runtime transform is downscaling to 256 px.
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
const manifestPath=join(root,'design-v1/hazel-imgen-manifest.json');
const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
const originalDir=join(root,'art-source/hazel-imgen-v1'),runtimeDir=join(root,'assets/formal-ui/imgen-v1');
mkdirSync(originalDir,{recursive:true});mkdirSync(runtimeDir,{recursive:true});
const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser=await chromium.launch({channel:'msedge',headless:true});
try {const page=await browser.newPage();
 for(const entry of manifest.entries){
  const file=entry.id+(entry.sourceRevision?'-r'+entry.sourceRevision:'')+'.png';
  const original=join(originalDir,file),runtime=join(runtimeDir,file);
  if(!existsSync(original))copyFileSync(entry.source,original);
  const hash=createHash('sha256').update(readFileSync(original)).digest('hex');
  if(!existsSync(runtime)||entry.sourceSha256!==hash){
   const uri='data:image/png;base64,'+readFileSync(original).toString('base64');
   const encoded=await page.evaluate(async uri=>{const img=new Image();img.src=uri;await img.decode();const c=document.createElement('canvas');c.width=c.height=256;const ctx=c.getContext('2d');ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(img,0,0,256,256);return c.toDataURL('image/png').split(',')[1]},uri);
   writeFileSync(runtime,Buffer.from(encoded,'base64'));
  }
  entry.original='art-source/hazel-imgen-v1/'+file;
  entry.runtime='assets/formal-ui/imgen-v1/'+file;
  entry.sourceSha256=hash;entry.runtimeSha256=createHash('sha256').update(readFileSync(runtime)).digest('hex');
  entry.resources??=[entry.id];
 }
}finally{await browser.close()}
writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
console.log('Packaged '+manifest.entries.length+' built-in ImageGen illustrations');
