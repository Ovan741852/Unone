import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),base='http://127.0.0.1:8288';
const manifest=JSON.parse(readFileSync(resolve(root,'manifest.json'),'utf8'));
assert.equal(manifest.assets.length,55);
const b=await chromium.launch({channel:'msedge',headless:true});const p=await b.newPage({viewport:{width:1600,height:1100}});
const errors=[],badResponses=[];p.on('pageerror',e=>errors.push(e.message));p.on('response',r=>{if(r.status()>=400)badResponses.push(r.url())});
try{
 await p.goto(base);await p.waitForFunction(()=>document.body.dataset.ready==='true');
 const links=await p.locator('nav a').evaluateAll(a=>a.map(n=>n.hash));
 for(const hash of links){await p.evaluate(h=>location.hash=h,hash);await p.waitForFunction(h=>document.querySelector(`nav a[href="${h}"]`)?.classList.contains('active'),hash);await p.evaluate(()=>Promise.all([...document.images].map(i=>i.decode().catch(()=>{}))));assert.ok(await p.locator('#screen').innerText());assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,hash+' overflow');if(['#home','#town','#route','#battle','#assets'].includes(hash))await p.screenshot({path:resolve(root,'previews',hash.slice(1)+'.png'),fullPage:hash==='#assets'});}
 const animationEvidence=[];
 for(const id of ['big-win','mega-win','legendary-win','coin-burst']){
  await p.locator(`[data-do="animation:${id}"]`).click();await p.waitForFunction(()=>window.designAnimation?.isLoaded===true);
  for(const frame of [0,15,40,80,110]){await p.evaluate(f=>window.designAnimation.goToAndStop(f,true),frame);const paths=await p.locator('#lottie svg path').count();assert.ok(paths>0,id+' paths');animationEvidence.push({id,frame,paths});if(frame===40)await p.locator('.animation-stage').screenshot({path:resolve(root,'previews',id+'.png')});}
  await p.evaluate(()=>window.designAnimation.goToAndStop(30,true));const a=await p.evaluate(()=>window.designAnimation.currentFrame);await p.waitForTimeout(120);assert.equal(await p.evaluate(()=>window.designAnimation.currentFrame),a);await p.locator('[data-do=play]').click();await p.waitForTimeout(150);assert.ok(await p.evaluate(()=>window.designAnimation.currentFrame)>a);
 }
 await p.evaluate(()=>location.hash='enchant');await p.locator('[data-do=enchant]').click();await p.locator('dialog[open]').waitFor();assert.match(await p.locator('dialog').innerText(),/穿透 \+1/);await p.keyboard.press('Escape');assert.equal(await p.locator('dialog').evaluate(d=>d.open),false);
 await p.evaluate(()=>location.hash='assets');await p.locator('[data-do="filter:角色立繪"]').click();assert.equal(await p.locator('.asset').count(),9);
 await p.setViewportSize({width:768,height:1024});await p.evaluate(()=>location.hash='route');await p.waitForFunction(()=>document.querySelector('nav a[href="#route"]').classList.contains('active'));assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'tablet overflow');await p.screenshot({path:resolve(root,'previews/tablet.png'),fullPage:true});
 assert.deepEqual(errors,[]);assert.deepEqual(badResponses,[]);
 writeFileSync(resolve(root,'previews/verification.json'),JSON.stringify({scope:'Design gallery and upstream lottie-web asset rendering ONLY; no Unone runtime integration',pages:links.length,svgAssets:51,lottieAssets:4,animationEvidence,errors,badResponses,checkedAt:new Date().toISOString()},null,2));
 console.log('PASS 15 design pages, 55 assets, 20 Lottie frame probes, pause/play, modal, asset filters, desktop/tablet overflow; zero page/load errors. NOT Unone runtime validation.');
}finally{await b.close()}
