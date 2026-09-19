const fs=require('node:fs'),path=require('node:path');
const{chromium}=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'..'),out=path.join(root,'tests/hazel-imgen');fs.mkdirSync(out,{recursive:true});
const art=JSON.parse(fs.readFileSync(path.join(root,'design-v1/hazel-imgen-manifest.json'),'utf8'));
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{const page=await browser.newPage({viewport:{width:1440,height:950}});
 for(let offset=0;offset<art.entries.length;offset+=24){
  const part=art.entries.slice(offset,offset+24);const html='<style>body{margin:0;background:#142a24;color:#eedabb;font:14px "Microsoft JhengHei",sans-serif;padding:18px;display:grid;grid-template-columns:repeat(6,1fr);gap:18px}figure{margin:0;text-align:center}img{width:150px;height:150px}small img{width:40px;height:40px}figcaption{height:30px}</style>'+part.map(e=>{const uri='data:image/png;base64,'+fs.readFileSync(path.join(root,e.runtime)).toString('base64');return `<figure><img src="${uri}"><small><img src="${uri}"></small><figcaption>${e.name??e.id}</figcaption></figure>`}).join('');
  await page.setContent(html);await page.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())));await page.screenshot({path:path.join(out,'catalog-'+(offset/24+1)+'.png'),fullPage:true});
 }
 console.log('Catalog sheets: '+Math.ceil(art.entries.length/24)+'; illustrated assets: '+art.entries.length);
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
