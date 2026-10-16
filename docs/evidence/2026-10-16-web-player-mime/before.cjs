const fs=require('fs');
const path=require('path');
const {chromium}=require('C:/Users/maverickchiu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const out=__dirname;
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  const page=await context.newPage();
  const report={url:'http://127.0.0.1:8344/?sdk=fresh-ui-verified',phase:'before',responses:[],console:[],pageErrors:[],requestFailures:[]};
  page.on('response',r=>report.responses.push({url:r.url(),status:r.status(),contentType:r.headers()['content-type']||null}));
  page.on('console',m=>report.console.push({type:m.type(),text:m.text()}));
  page.on('pageerror',e=>report.pageErrors.push(String(e)));
  page.on('requestfailed',r=>report.requestFailures.push({url:r.url(),error:r.failure()}));
  try {await page.goto(report.url,{waitUntil:'networkidle',timeout:30000});await page.waitForTimeout(1500);}catch(e){report.navigationError=String(e);}
  report.dom=await page.evaluate(()=>({title:document.title,text:document.body.innerText,playerBoot:window.playerBoot,canvases:[...document.querySelectorAll('canvas')].map(c=>({width:c.width,height:c.height,rect:JSON.stringify(c.getBoundingClientRect())})),globals:Object.keys(window).filter(k=>/official|wasm|renderer|player|runtime|probe|tree|studio/i.test(k)),scripts:[...document.scripts].map(s=>({src:s.src,type:s.type}))}));
  report.expectedReproduction=report.console.some(x=>/MIME|module script/i.test(x.text));
  await page.screenshot({path:path.join(out,'before-1440x900.png'),fullPage:true});
  fs.writeFileSync(path.join(out,'before.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  await browser.close();
})();
