import {createRequire} from 'node:module';import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const out=resolve(import.meta.dirname,'evidence');await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1600,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(process.env.QUICKTEST_URL||'http://127.0.0.1:8194');await page.waitForSelector('body[data-ready=true]');
 await page.locator('#suite').click();await page.waitForFunction(()=>!document.querySelector('#suite').disabled,null,{timeout:120000});
 const results=await page.locator('#results').innerText();assert.match(results,/boss-appears-final30/);assert.doesNotMatch(results,/FAIL/);assert.match(await page.locator('#status').textContent(),/19\/19/);
 await page.locator('[data-scene=horde]').click();await page.waitForFunction(()=>!document.querySelector('#suite').disabled);assert.match(await page.locator('#status').textContent(),/場景已就緒/);
 const download=page.waitForEvent('download');await page.locator('#download').click();await (await download).saveAs(resolve(out,'replay.json'));
 const original=JSON.parse(await readFile(resolve(out,'replay.json'),'utf8'));
 await page.locator('#replay').setInputFiles(resolve(out,'replay.json'));await page.waitForFunction(()=>!document.querySelector('#suite').disabled);assert.match(await page.locator('#status').textContent(),/重播完成/);
 const replayed=page.waitForEvent('download');await page.locator('#download').click();const second=resolve(out,'replayed.json');await(await replayed).saveAs(second);
 const actual=JSON.parse(await readFile(second,'utf8'));assert.deepEqual(actual.observations,original.observations);assert.deepEqual(actual.inputs,original.inputs);
 await page.locator('#play').click();await page.waitForTimeout(200);await page.locator('[data-action=Mode_auto]').click();await page.locator('[data-action=Auto_apply]').click();await page.waitForTimeout(1500);await page.locator('#play').click();
 await page.screenshot({path:resolve(import.meta.dirname,'preview.png'),fullPage:true});assert.deepEqual(errors,[]);
 await writeFile(resolve(out,'verification.json'),JSON.stringify({tests:results.split('\n'),replayFrames:actual.inputs.length,replayEqual:true,errors},null,2));
 console.log('PASS 19/19 actual WASM replays; exported/imported replay observations and inputs identical; normal-speed AUTO smoke; no page errors');
}finally{await browser.close();}
