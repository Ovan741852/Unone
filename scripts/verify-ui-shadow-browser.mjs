// Actual Chromium Canvas pixels using official renderer and packaged TC face.
// Component proof only; Root performs normal-game Web acceptance separately.
import {createServer} from 'node:http';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {parseArgs} from 'node:util';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const {values}=parseArgs({options:{sdk:{type:'string'},out:{type:'string'},colors:{type:'boolean',default:false},font:{type:'string'}}});
if(!values.out)throw Error('--out required');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),out=resolve(values.out);mkdirSync(out,{recursive:false});
const source=values.sdk?join(resolve(values.sdk),'templates/web/shared'):join(root,'web/shared');
if(!values.font)throw Error('--font requires a licensed CJK TTF fixture');
const font=resolve(values.font);
const files=new Map(['canvas-ui.mjs','ui-style.mjs','ui-presentation.mjs','ui-contract.mjs','ui-geometry.mjs','ui-scroll.mjs'].map(n=>['/'+n,readFileSync(join(source,n))]));
files.set('/font.ttf',readFileSync(font));
const sha=b=>createHash('sha256').update(b).digest('hex');
const server=createServer((req,res)=>{const file=files.get(req.url);if(file){res.setHeader('Content-Type',req.url==='/font.ttf'?'font/ttf':'text/javascript');res.end(file);}
 else if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<canvas id="old"></canvas><canvas id="new"></canvas>');}else{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const require=createRequire(import.meta.url),pw=require('C:/Users/liNao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser=await pw.chromium.launch({channel:'msedge',headless:true});
const labels=['新遊戲','教學','載入','多人對戰','選項','展示','製作群','即將推出','離開','返回','聲音','音效 <開>','音效 <關>','−','+'];
const glyphs=[...new Set([...labels.join('')])];
const report={scope:'Actual official Canvas pixels, TC translation adapter only; not original bitmap font or normal game acceptance',
 font:{path:font,sha256:sha(readFileSync(font))},modules:Object.fromEntries([...files].filter(([n])=>n.endsWith('.mjs')).map(([n,b])=>[n,sha(b)])),cases:[],errors:[]};
try{
 for(const [width,height,dpr]of [[640,480,1],[1280,720,1],[1280,720,2],[360,640,1]]){
  const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:dpr});
  page.on('pageerror',e=>report.errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);
  const cases=await page.evaluate(async({width,height,dpr,labels,glyphs,colors})=>{
   const original=HTMLCanvasElement.prototype.getContext;
   HTMLCanvasElement.prototype.getContext=function(k,o){return original.call(this,k,k==='2d'?{...o,willReadFrequently:true}:o);};
   const {createCanvasUi,loadPresentationFonts}=await import('/canvas-ui.mjs');
   await loadPresentationFonts({fonts:[{family:'R11 TC',source:'/font.ttf',weight:400}]});
   const old=document.querySelector('#old'),next=document.querySelector('#new');
   const before=createCanvasUi(old,{fontFamily:'R11 TC'}),after=createCanvasUi(next,{fontFamily:'R11 TC'});
   const aspect=width/height,sw=Math.min(100,100*(4/3)/aspect);
   const rect=(x,y,w,h)=>({x:(100-sw)/2+x/640*sw,y:100-(y+h)/480*100,width:w/640*sw,height:h/480*100});
   const normal=[239/255,239/255,239/255,1],shadow=[.04,.02,0,1],rows=[];
   const palette=colors?[normal,[219/255,147/255,23/255,1],[.46,.40,.29,1],[.62,.48,.25,1],[.94,.81,.28,1]]:[normal];
   const samples=[...labels.flatMap(label=>palette.map(color=>({label,color,individual:false}))),
    ...glyphs.map(label=>({label,color:normal,individual:true}))];
   for(const {label,color,individual}of samples)for(const y of [225,454]){
    const w=Math.max(24,[...label].reduce((n,c)=>n+(c.codePointAt(0)>=0x2E80?24:13),0));
    const x=320-Math.floor(w/2),h=Math.min(28,480-y),sh=Math.min(28,479-y);
    const base={font_size:5,font_weight:400,padding:{},text_align:'center',vertical_align:'middle',wrap:'none',overflow:'clip'};
    const text=(id,r,c)=>({kind:'text',id,text:label,rect:r,style:{...base,color:c}});
    const node=text('label',rect(x,y,w,h),color);
    before.draw({ui:{children:[text('shadow',rect(x+1,y+1,w,sh),shadow),node]}},{width,height,dpr});
    after.draw({ui:{children:[{...node,style:{...node.style,text_shadow:{offset_x:sw*aspect/640,
     offset_y:(1+(sh-h)/2)*100/480,color:shadow}}}]}},{width,height,dpr});
    const a=old.getContext('2d').getImageData(0,0,old.width,old.height).data;
    const b=next.getContext('2d').getImageData(0,0,next.width,next.height).data;
    let different=0,ink=0,maxDelta=0;
    for(let i=0;i<a.length;i++){if(a[i]!==b[i]){different++;maxDelta=Math.max(maxDelta,Math.abs(a[i]-b[i]));}if(i%4===3&&a[i])ink++;}
    rows.push({label,color,individual_glyph:individual,y,foreground_height:h,old_shadow_height:sh,different_bytes:different,max_delta:maxDelta,ink_pixels:ink});
   }
   // Transparent, zero-offset shadow must leave existing rounded background/border pixels
   // unchanged, including the offscreen whole-leaf opacity path (the original SDK8 defect).
   for(const kind of ['text','button'])for(const radius of [0,2,6])for(const opacity of [1,.5]){
    const style={font_size:3,color:[1,1,1,1],background:[.1,.4,.8,1],border_radius:radius,opacity};
    const node={kind,id:'box',text:'',rect:{x:10.3,y:20.4,width:30.4,height:12.2},style,...(kind==='button'?{action:'Go'}:{})};
    before.draw({ui:{children:[node]}},{width,height,dpr});
    after.draw({ui:{children:[{...node,style:{...style,text_shadow:{offset_x:0,offset_y:0,color:[0,0,0,0]}}}]}},{width,height,dpr});
    const a=old.getContext('2d').getImageData(0,0,old.width,old.height).data,b=next.getContext('2d').getImageData(0,0,next.width,next.height).data;
    let different=0,maxDelta=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i]){different++;maxDelta=Math.max(maxDelta,Math.abs(a[i]-b[i]));}
    rows.push({label:'',transparent_shadow_box:true,kind,radius,opacity,different_bytes:different,max_delta:maxDelta,ink_pixels:0});
   }
   before.dispose();after.dispose();return rows;
  },{width,height,dpr,labels,glyphs,colors:values.colors});
  report.cases.push({width,height,dpr,rows:cases});await page.close();
 }
 report.pass=report.errors.length===0&&report.cases.every(c=>c.rows.every(r=>r.different_bytes===0&&(r.label.trim()===''||r.ink_pixels>0)));
}finally{
 await browser.close();await new Promise(r=>server.close(r));
 writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify({pass:report.pass,cases:report.cases.reduce((n,c)=>n+c.rows.length,0),
 failures:report.cases.flatMap(c=>c.rows.filter(r=>r.different_bytes||(r.label.trim()&&!r.ink_pixels)).map(r=>({...r,width:c.width,height:c.height,dpr:c.dpr})))}));
if(!report.pass)process.exitCode=1;
