// DOM measurement plus official UnoneUI AABB preflight. Does not claim Core renders HTML.
const {chromium}=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const {spawnSync}=require('node:child_process');const {writeFileSync}=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});const reports=[];try{
 for(const [width,height] of [[1440,900],[1280,720],[900,600]]){
  const page=await browser.newPage({viewport:{width,height}});await page.goto('http://127.0.0.1:8190/');await page.waitForSelector('body[data-ready="true"]');
  await page.locator('[data-action="Start"]').click();await page.locator('[data-action="Choice1"]').click();await page.locator('[data-action="LeaveShop"]').click();await page.waitForFunction(()=>ashen.state().phase==='battle');
  const nodes=await page.evaluate(()=>[...document.querySelectorAll('button,select')].filter(x=>x.checkVisibility()&&!x.disabled).map((x,i)=>{const r=x.getBoundingClientRect();return {kind:'button',id:'control-'+i,text:(x.textContent.trim()||x.id).slice(0,35),action:'Control'+i,rect:{x:r.x/innerWidth*100,y:r.y/innerHeight*100,width:r.width/innerWidth*100,height:r.height/innerHeight*100}}}));
  for(const n of nodes)assert.ok(n.rect.x>=0&&n.rect.y>=0&&n.rect.x+n.rect.width<=100.1&&n.rect.y+n.rect.height<=100.1,`offscreen ${width} ${n.text}`);
  const result=spawnSync(process.execPath,['D:/Projects/UnoneUI/plugin.mjs'],{input:JSON.stringify({tool:'ui.inspect_layout',input:{tree:{kind:'screen',id:'measured-dom',node:'battle',children:nodes},aspect:width/height,strict:true}})+'\n',encoding:'utf8'});
  const report=JSON.parse(result.stdout);reports.push({width,height,report});assert.equal(report.ok,true,JSON.stringify(report));
  await page.close();
 }
 writeFileSync(path.resolve(__dirname,'../tests/layout-results.json'),JSON.stringify(reports,null,2));console.log('PASS measured battle controls at 1440×900, 1280×720, 900×600 via official UnoneUI ui.inspect_layout');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
