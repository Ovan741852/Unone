import {mkdirSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import {parseArgs} from 'node:util';
const {values}=parseArgs({options:{url:{type:'string',default:'http://127.0.0.1:8190/'},out:{type:'string'},label:{type:'string',default:'current'}}});
if(!values.out)throw Error('--out required');const out=resolve(values.out);mkdirSync(out,{recursive:true});
const require=createRequire(import.meta.url);
let playwright;try{playwright=require(process.env.UNONE_PLAYWRIGHT_MODULE||'playwright');}catch(error){
 if(process.env.UNONE_PLAYWRIGHT_MODULE)throw error;
 playwright=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
}
const browser=await playwright.chromium.launch({channel:process.env.UNONE_BROWSER_CHANNEL||'msedge',headless:true});const report={ok:false,label:values.label,cases:[],errors:[]};
try{
 const page=await browser.newPage({viewport:{width:1920,height:1080},reducedMotion:'reduce'});
 page.on('pageerror',e=>report.errors.push(e.message));await page.goto(values.url+'?seed=42');
 await page.waitForSelector('body[data-ready="true"]',{timeout:90000});
 async function capture(name){
  await page.waitForFunction(()=>window.ashen.metrics().ui.assets.every(a=>a.state==='ready'));
  await page.waitForTimeout(400);
  const data=await page.evaluate(()=>({tree:window.ashen.uiTree(),metrics:window.ashen.metrics().ui}));
  assert.equal(data.metrics.diagnostics.length,0,JSON.stringify(data.metrics.diagnostics));
  writeFileSync(join(out,`${values.label}-${name}.json`),JSON.stringify(data,null,2));
  await page.locator('#formal-ui').screenshot({path:join(out,`${values.label}-${name}.png`)});
  report.cases.push({name,nodes:data.tree.children.length,assets:data.metrics.assets.length,metrics:data.metrics});
 }
 async function click(action){
  const point=await page.evaluate(action=>{
   const n=window.ashen.uiTree().children.find(n=>n.kind==='button'&&n.action===action);if(!n)return null;
   const r=document.querySelector('#formal-ui').getBoundingClientRect();return {x:r.x+(n.rect.x+n.rect.width/2)*r.width/100,y:r.y+(100-n.rect.y-n.rect.height/2)*r.height/100};
  },action);assert.ok(point,'Missing '+action);await page.mouse.click(point.x,point.y);await page.mouse.move(1,1);await page.waitForTimeout(200);
 }
 await capture('menu');await click('Start');await capture('profiles');await click('Profile1');await click('LaunchExpedition');
 await page.waitForFunction(()=>window.ashen.state().phase==='choice');
 const i=await page.evaluate(()=>Object.values(window.ashen.state().cards).findIndex(c=>c.id==='market'));assert.ok(i>=0);await click('Choice'+(i+1));
 await capture('shop');await click('ShopDetail1');await capture('detail');
 assert.equal(report.errors.length,0,JSON.stringify(report.errors));report.ok=true;
}catch(e){report.errors.push(e.stack);throw e;}finally{writeFileSync(join(out,`${values.label}-report.json`),JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify({ok:report.ok,label:report.label,cases:report.cases.map(c=>({name:c.name,nodes:c.nodes,assets:c.assets})),errors:report.errors}));
