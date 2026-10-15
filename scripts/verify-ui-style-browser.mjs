// Real-browser typography, packaged-font and Canvas/legacy DOM adapter gate.
// Optional --font and --bold point at licensed TTF/OTF fixtures; no game art is
// generated or substituted by this test.
import {createServer} from 'node:http';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve,join} from 'node:path';
import {parseArgs} from 'node:util';
import assert from 'node:assert/strict';
const {values}=parseArgs({options:{out:{type:'string'},font:{type:'string'},bold:{type:'string'}}});
if(!values.out)throw Error('Usage: node scripts/verify-ui-style-browser.mjs --out <evidence-directory> [--font <regular.ttf> --bold <bold.ttf>]');
if(Boolean(values.font)!==Boolean(values.bold))throw Error('Provide both --font and --bold');
const out=resolve(values.out);mkdirSync(out,{recursive:true});
const require=createRequire(import.meta.url),playwright=require(process.env.UNONE_PLAYWRIGHT_MODULE||'playwright');
const modules=new Map(['canvas-ui.mjs','ui-tree.js','ui-style.mjs','ui-contract.mjs','ui-geometry.mjs','ui-scroll.mjs'].map(n=>['/'+n,readFileSync(new URL('../web/shared/'+n,import.meta.url))]));
const fonts=new Map(values.font?[['/regular.ttf',readFileSync(values.font)],['/bold.ttf',readFileSync(values.bold)]]:[]);
const html='<style>body{margin:0;background:#18202c;display:flex;gap:20px}.stage{position:relative;width:360px;height:240px}.unone-ui-node{position:absolute;box-sizing:border-box;overflow:hidden}canvas{display:block}#official{width:100%;height:100%}</style><div class="stage" id="canvas-stage"><canvas id="official"></canvas></div><div class="stage" id="dom-stage"></div>';
const server=createServer((req,res)=>{if(modules.has(req.url)){res.setHeader('Content-Type','text/javascript');res.end(modules.get(req.url));}else if(fonts.has(req.url)){res.setHeader('Content-Type','font/ttf');res.end(fonts.get(req.url));}else if(req.url==='/missing.ttf'){res.statusCode=404;res.end();}else{res.setHeader('Content-Type','text/html');res.end(html);}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await playwright.chromium.launch(process.env.UNONE_BROWSER_PATH?{executablePath:process.env.UNONE_BROWSER_PATH,headless:true}:{channel:process.env.UNONE_BROWSER_CHANNEL||'msedge',headless:true});
const report={ok:false,fonts:Boolean(values.font),cases:[],errors:[]};
try{
  for(const dpr of [1,2]){
    const page=await browser.newPage({viewport:{width:1000,height:750},deviceScaleFactor:dpr});page.on('pageerror',e=>report.errors.push(e.message));
    await page.goto('http://127.0.0.1:'+server.address().port);
    const fontReport=await page.evaluate(async useFonts=>{
      // Keep both readback fixtures on the CPU path; Chromium can otherwise
      // switch one repeatedly-read canvas between GPU/CPU antialiasing modes.
      const getContext=HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext=function(kind,options){return getContext.call(this,kind,kind==='2d'?{...options,willReadFrequently:true}:options);};
      const {createCanvasUi,loadPresentationFonts}=await import('/canvas-ui.mjs'),{createUiTree}=await import('/ui-tree.js');
      const {layoutUiText,measureUiText}=await import('/ui-style.mjs');window.layoutUiText=layoutUiText;
      window.family=useFonts?'Fixture UI':'sans-serif';
      window.fontFaces=useFonts?await loadPresentationFonts({fonts:[{family:window.family,source:'regular.ttf'},{family:window.family,source:'bold.ttf',weight:700}]}):[];
      window.ui=createCanvasUi(document.querySelector('#official'),{fontFamily:window.family});window.dom=createUiTree(document.querySelector('#dom-stage'));
      const ctx=document.createElement('canvas').getContext('2d');ctx.font=`400 24px "${window.family}"`;const regular=ctx.measureText('UI 字體風格').width;ctx.font=`700 24px "${window.family}"`;const bold=ctx.measureText('UI 字體風格').width;
      const tracking=['ABC','A','中文測','👩‍🚀!'].map(text=>({text,plain:measureUiText(ctx,text,0),tracked:measureUiText(ctx,text,3)}));
      return {faces:window.fontFaces.map(f=>({family:f.family,weight:f.weight,status:f.status})),regular,bold,tracking};
    },Boolean(values.font));
    if(values.font){assert.deepEqual(fontReport.faces.map(f=>[f.weight,f.status]),[['400','loaded'],['700','loaded']]);assert.notEqual(fontReport.regular,fontReport.bold);}
    fontReport.tracking.forEach(({plain,tracked},i)=>assert.ok(Math.abs(tracked-plain-[6,0,6,3][i])<1e-8,JSON.stringify(fontReport.tracking)));
    for(const [width,height]of [[360,240],[240,360]])for(const scenario of ['wrapped','ellipsis','box','opacity']){
      const result=await page.evaluate(async({width,height,scenario,dpr})=>{
        for(const stage of document.querySelectorAll('.stage'))Object.assign(stage.style,{width:width+'px',height:height+'px'});
        const style={font_family:window.family,font_size:6,font_weight:700,line_height:1.3,letter_spacing:.15,color:[.8,.9,1,1],text_align:'start',vertical_align:'top',padding:{left:5,top:4,right:5,bottom:4},background:[.04,.08,.13,.95],border_color:[.15,.7,.8,1],border_width:.6,border_radius:3};
        const text=scenario==='wrapped'?'Readable UI typography: 字體與排版API\nWords and 長句自然換行。':'A label that stays at its declared size even when it exceeds its bounds.';
        if(scenario==='wrapped')style.wrap='word';if(scenario==='ellipsis')style.overflow='ellipsis';
        const panel=scenario==='box'||scenario==='opacity';
        if(panel)for(const key of ['font_family','font_size','font_weight','line_height','letter_spacing','color','text_align','vertical_align'])delete style[key];
        if(scenario==='opacity')Object.assign(style,{opacity:.5,background:[0,0,1,1],border_color:[1,0,0,1],border_width:4});
        window.node={kind:panel?'panel':'button',id:'fixture',...(panel?{}:{action:'Continue',text}),rect:{x:0,y:0,width:100,height:100},style};
        window.ui.draw({ui:{children:[window.node]}},{width,height,dpr});window.dom({ui:{children:[window.node]}});
        await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
        const official=document.querySelector('#official'),dom=document.querySelector('#dom-stage canvas');
        const a=official.getContext('2d').getImageData(0,0,official.width,official.height).data,b=dom.getContext('2d').getImageData(0,0,dom.width,dom.height).data;
        let mismatch=0,maxDelta=0;const rows=new Set();for(let i=0;i<a.length;i++)if(a[i]!==b[i]){mismatch++;maxDelta=Math.max(maxDelta,Math.abs(a[i]-b[i]));rows.add(Math.floor(i/(official.width*4)));}
        const layout=window.layoutUiText(official.getContext('2d'),{...window.node,text},{x:0,y:0,width:width*dpr,height:height*dpr,viewportHeight:height*dpr});
        const sample=(x,y)=>[...official.getContext('2d').getImageData(x,y,1,1).data];
        return {mismatch,maxDelta,diffRows:[...rows],canvas:[official.width,official.height],dom:[dom.width,dom.height],size:layout.size,lines:layout.lines.map(v=>({text:v.text,width:v.width})),contentWidth:layout.content.width,corner:sample(0,0),center:sample(official.width/2,official.height/2),border:sample(official.width/2,dpr*2)};
      },{width,height,scenario,dpr});
      if(result.mismatch)await page.screenshot({path:join(out,'adapter-mismatch.png')});
      assert.deepEqual(result.canvas,result.dom);assert.equal(result.mismatch,0,JSON.stringify({width,height,dpr,scenario,result}));assert.ok(Math.abs(result.size-height*dpr*(scenario==='box'||scenario==='opacity'?.02:.06))<1e-9);assert.equal(result.corner[3],0);
      if(scenario==='wrapped')assert.ok(result.lines.length>1);if(scenario==='ellipsis')assert.ok(result.lines.every(v=>v.width<=result.contentWidth)&&result.lines.some(v=>v.text.endsWith('…')));
      if(scenario==='opacity'){assert.deepEqual(result.center,[0,0,255,128]);assert.deepEqual(result.border,[255,0,0,128]);}
      report.cases.push({dpr,width,height,scenario,...result});
      await page.locator('#canvas-stage').screenshot({path:join(out,`${scenario}-${width}x${height}-${dpr}x.png`)});
    }
    const interaction=await page.evaluate(async()=>{
      const {createUiPointerRouter,loadPresentationFonts}=await import('/canvas-ui.mjs');const r=createUiPointerRouter(),rect={x:0,y:0,width:100,height:100};
      r.setTree({children:[{kind:'button',id:'action',rect,action:'Continue'},{kind:'text',id:'caption',rect,text:'Continue'},{kind:'image',id:'frame',rect,asset:'frame'},{kind:'panel',id:'decoration',rect}]});
      const captured=r.pointer({kind:'down',x:50,y:50}),hit=r.hitTest(50,50);r.releaseAll();r.setTree({children:[{kind:'text',id:'caption',rect,text:'Text'}]});
      const passthrough=!r.pointer({kind:'down',x:50,y:50});let error;
      try{await loadPresentationFonts({fonts:[{family:'Missing Fixture',source:'missing.ttf'}]});}catch(e){error=e.message;}
      return {captured,hit,passthrough,fontFailure:error?.startsWith('UI_FONT_LOAD_FAILED: Missing Fixture 400')};
    });
    assert.deepEqual(interaction,{captured:true,hit:{nodeId:'action',action:'Continue'},passthrough:true,fontFailure:true});report.cases.push({dpr,interaction,fontReport});await page.close();
  }
  assert.deepEqual(report.errors,[]);report.ok=true;
}catch(error){report.errors.push(error.stack);throw error;}
finally{writeFileSync(join(out,'browser-report.json'),JSON.stringify(report,null,2));await browser.close();server.close();}
console.log(JSON.stringify({ok:report.ok,fonts:report.fonts,cases:report.cases.length,errors:report.errors}));
