const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'..'),out=path.join(root,'tests/hazel-transparent');fs.mkdirSync(out,{recursive:true});
const art=JSON.parse(fs.readFileSync(path.join(root,'design-v1/hazel-transparent-manifest.json'),'utf8'));
const data=e=>'data:image/png;base64,'+fs.readFileSync(path.join(root,e.runtime)).toString('base64');
const category={equipment:'裝備',skill:'技能',building:'建築',common:'常用'};
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage({viewport:{width:1400,height:900}});
 for(let offset=0;offset<art.entries.length;offset+=24){const part=art.entries.slice(offset,offset+24);
  await page.setViewportSize({width:1400,height:Math.ceil(part.length/6)*198+50});
  await page.setContent(`<style>*{box-sizing:border-box}body{margin:0;padding:18px;background:#172d25;color:#e5d9b7;font:14px 'Microsoft JhengHei',sans-serif}main{display:grid;grid-template-columns:repeat(6,1fr);gap:14px}.pair{display:flex;gap:2px}.pair img{width:98px;height:110px;object-fit:contain;background:#f0e2c6}.pair img+img{background:#211d35}figure{margin:0;height:184px}figcaption{padding-top:7px}small{display:block;font-size:10px;color:#96bfa6;margin-top:4px}</style><main>`+part.map(e=>`<figure><div class="pair"><img src="${data(e)}"><img src="${data(e)}"></div><figcaption>${category[e.kind]} · ${escape(e.name)}</figcaption><small>${e.id}</small></figure>`).join('')+'</main>');
  await page.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())));await page.screenshot({path:path.join(out,'catalog-'+(offset/24+1)+'.png')});
 }
 const pairs=art.entries.filter(e=>e.kind==='skill').map(s=>({skill:s,equipment:art.entries.find(e=>e.id===s.pairedEquipment)})).filter(p=>p.equipment);
 for(let offset=0;offset<pairs.length;offset+=12){const part=pairs.slice(offset,offset+12);await page.setViewportSize({width:1320,height:Math.ceil(part.length/4)*246+54});
  await page.setContent(`<style>*{box-sizing:border-box}body{margin:0;padding:18px;background:#1a2923;color:#f0dfbb;font:14px 'Microsoft JhengHei',sans-serif}main{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}article{display:flex;gap:8px;background:#2c3b30;padding:10px}figure{margin:0;width:132px}img{width:132px;height:154px;object-fit:contain}figcaption{height:44px}small{display:block;color:#85c9c1;margin-bottom:4px}</style><main>`+part.map(p=>`<article><figure><img src="${data(p.equipment)}"><figcaption><small>裝備物件</small>${escape(p.equipment.name)}</figcaption></figure><figure><img src="${data(p.skill)}"><figcaption><small>技能效果</small>${escape(p.skill.name)}</figcaption></figure></article>`).join('')+'</main>');await page.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())));await page.screenshot({path:path.join(out,'equipment-skills-'+(offset/12+1)+'.png')});
 }
 console.log(JSON.stringify({artworks:art.entries.length,pairs:pairs.length,catalogPages:Math.ceil(art.entries.length/24)}));
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
