const {chromium}=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
const {mkdirSync}=require('node:fs');
const uiPoint=require('./ui-test-pointer.cjs');

(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const url=(process.env.GAME_TEST_URL||'http://127.0.0.1:8193/')+'?build=combobox-test&seed=42';
  const nodes=()=>page.evaluate(()=>window.ashen.uiTree().children);
  const get=async id=>(await nodes()).find(n=>n.id===id);
  async function click(id,u=.5){
   const node=await get(id);assert.ok(node,'Missing '+id);
   const p=await uiPoint(page,node.rect,u,.5);await page.mouse.click(p.x,p.y);await page.waitForTimeout(150);
  }
  await page.goto(url);await page.waitForSelector('body[data-ready="true"]',{timeout:60000});
  await click('settings');
  assert.equal((await get('settings_quality')).kind,'combobox');
  const field=await get('settings_quality_field');
  assert.equal(field.asset,'texture://ui_settings-field-v5');assert.ok(field.slice.source);
  // Left edge, centre and arrow all activate the SAME semantic field.
  for(const u of [.02,.5,.97]){
   await click('settings_quality',u);assert.equal((await get('settings_quality')).expanded,true);
   await click('settings_quality',u);assert.equal((await get('settings_quality')).expanded,false);
  }
  await click('settings_quality');await click('settings_quality_option_low');
  assert.equal((await get('settings_quality')).text,'低');assert.equal((await get('settings_quality')).expanded,false);
  await click('settings_quality');
  const dismiss=await get('settings_dropdown_dismiss'),outside=await uiPoint(page,dismiss.rect,.15,.85);
  await page.mouse.click(outside.x,outside.y);await page.waitForTimeout(150);
  assert.equal((await get('settings_quality')).expanded,false);
  await click('settings_language');await page.keyboard.press('Escape');await page.waitForTimeout(150);
  assert.equal((await get('settings_language')).expanded,false,'Escape must dismiss popup without leaving settings');
  const soundBefore=(await get('settings_sfx_value')).text;
  await click('settings_language');await click('settings_language_option_zh_tw');
  assert.equal((await get('settings_sfx_value')).text,soundBefore,'popup selection must not drag the underlying slider');
  await click('settings_language');await click('settings_language_option_en');
  assert.equal((await get('settings_language')).text,'English');
  await page.reload();await page.waitForSelector('body[data-ready="true"]',{timeout:60000});await click('settings');
  assert.equal((await get('settings_quality')).text,'低');assert.equal((await get('settings_language')).text,'English');
  // Keyboard selection uses the same actions and returns focus to the field.
  const combo=page.locator('[data-shop-control="settings_quality"]');
  await combo.focus();await page.keyboard.press('ArrowDown');await page.waitForTimeout(150);
  await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await page.waitForTimeout(150);
  assert.equal((await get('settings_quality')).text,'中');
  assert.equal(await combo.getAttribute('aria-expanded'),'false');
  mkdirSync('_Games/ashen-legion/tests/combobox-controls',{recursive:true});
  await page.getByRole('button',{name:'收起開發工具',exact:true}).click();
  for(const size of [{width:1440,height:900},{width:844,height:390}]){
   await page.setViewportSize(size);await page.waitForTimeout(200);await click('settings_language');
   const panel=await get('settings_language_options_plate');
   assert.ok(panel.rect.x>=0&&panel.rect.y>=0&&panel.rect.x+panel.rect.width<=100&&panel.rect.y+panel.rect.height<=100);
   await page.screenshot({path:`_Games/ashen-legion/tests/combobox-controls/language-${size.width}.png`});
   await click('settings_language');
   await page.screenshot({path:`_Games/ashen-legion/tests/combobox-controls/settings-${size.width}.png`});
  }
  assert.deepEqual(errors,[]);
  console.log('PASS full-field toggles, selection, outside/Escape dismissal, persisted values, keyboard selection and landscape layouts.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
