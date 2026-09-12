const {chromium}=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1600,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8194');await page.waitForSelector('body[data-ready=true]',{timeout:45000});
  await page.locator('[data-scene=start]').click();await page.waitForFunction(()=>!document.querySelector('#suite').disabled);await page.locator('#play').click();
  await page.locator('[data-action=Mode_auto]').click();await page.locator('[data-action=Auto_none]').click();
  await page.locator('[data-action=Auto_target_acorn]').click();await page.locator('[data-action=Auto_apply]').click();
  await page.waitForTimeout(1000);await page.locator('[data-action=Auto_settings]').click();
  await page.waitForSelector('[data-action=Auto_target_acorn]');
  assert.match(await page.locator('[data-action=Auto_target_acorn]').innerText(),/✓/);
  assert.match(await page.locator('[data-action=Auto_target_stag]').innerText(),/○/);
  await page.locator('[data-action=Auto_stop]').click();await page.waitForTimeout(100);await page.locator('#play').click();
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(__dirname,'evidence/auto-selection.json'),JSON.stringify({ok:true,scope:'Real quicktest host mirrors production AUTO controls, applies one species and restores it on reopen',errors},null,2));
  console.log('PASS quicktest AUTO setup, apply, restore and stop.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
