import test from 'node:test';
import assert from 'node:assert/strict';
import {layoutUiText,paintUiText,paintUiBox,presentationFontFaces,measureUiText,createUiOpacityPainter,uiFont} from './ui-style.mjs';
import {createCanvasUi,createUiPointerRouter,loadPresentationFonts} from './canvas-ui.mjs';
function context(){
  const calls=[];return {calls,save(){},restore(){},beginPath(){},rect(...r){calls.push(['rect',...r]);},roundRect(...r){calls.push(['round',...r]);},clip(){},fill(){calls.push(['fill',this.fillStyle]);},stroke(){calls.push(['stroke',this.strokeStyle,this.lineWidth]);},fillText(text,x,y){calls.push(['text',text,x,y,this.font,this.fillStyle]);},measureText(text){const count=[...text].length;return {width:count*(10+Number.parseFloat(this.letterSpacing??0))};},setTransform(){},clearRect(){}};
}
test('a deferred Web face leaves startup and the first unrelated screen ready, then paints the requested text once ready',async t=>{
  const eager=[],registered=[],requests=[],errors=[];
  let finish,redraws=0;
  const fonts={add:face=>registered.push(face),delete(){},check:()=>false,
    load:query=>{requests.push(query);return new Promise(resolve=>{finish=resolve;});}};
  const previousDocument=globalThis.document,previousFontFace=globalThis.FontFace;
  globalThis.document={fonts};
  globalThis.FontFace=class{constructor(family){this.family=family;}async load(){eager.push(this.family);}};
  t.after(()=>{globalThis.document=previousDocument;globalThis.FontFace=previousFontFace;});
  const faces=[{family:'Body',source:'body.ttf'},{family:'Names',source:'names.ttf',weight:600,on_demand:true}];
  const progress=[];
  await loadPresentationFonts({fonts:faces},x=>x,(done,total)=>progress.push([done,total]));
  assert.deepEqual(eager,['Body']);assert.deepEqual(registered.map(f=>f.family),['Body','Names']);
  assert.deepEqual(progress,[[1,1]]);
  assert.throws(()=>presentationFontFaces({fonts:[{...faces[1],on_demand:1}]}),/UI_FONT_INVALID/);
  const ctx=context(),ui=createCanvasUi({width:120,height:50,getContext:()=>ctx});
  ui.setDeferredFonts(faces,()=>redraws++,e=>errors.push(e));
  const draw=(family,text)=>ui.draw({ui:{children:[{id:'label',kind:'text',rect:{x:0,y:0,width:100,height:100},text,style:{font_family:family}}]}});
  draw('Body','Title');assert.deepEqual(requests,[]);
  draw('Names','李');draw('Names','李娜');assert.deepEqual(requests,['400 16px "Names"']);
  assert(!ctx.calls.some(r=>r[0]==='text'&&r[1].includes('李')));
  finish([registered[1]]);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(redraws,1);draw('Names','李娜');assert(ctx.calls.some(r=>r[0]==='text'&&r[1]==='李娜'));
  draw('Body','Title');draw('Names','李娜');assert.equal(requests.length,1);assert.deepEqual(errors,[]);
  draw('Names, sans-serif','名');draw('Names, sans-serif','姓名');
  assert.equal(requests.at(-1),'400 16px "Names", sans-serif');assert.equal(requests.length,2);
  assert(!ctx.calls.some(r=>r[0]==='text'&&r[1]==='姓名'));
  fonts.check=()=>true;finish([registered[1]]);await new Promise(resolve=>setImmediate(resolve));
  draw('Names, sans-serif','姓名');assert(ctx.calls.some(r=>r[0]==='text'&&r[1]==='姓名'));
  ui.dispose();
});
const bounds={x:10,y:20,width:100,height:100,viewportHeight:1000};
test('styled font sizes use viewport height, never shrink to fit the rectangle',()=>{
  const ctx=context(),node={text:'Wide text',style:{font_family:'Fixture UI',font_size:3,font_weight:700,color:[.1,.5,.9,.8]}};
  for(const height of [10,100]){const result=paintUiText(ctx,node,{...bounds,width:12,height});assert.equal(result.size,30);assert.equal(result.font,'700 30px "Fixture UI"');assert.equal(result.color,'rgba(26,128,230,0.8)');}
  assert.equal(layoutUiText(ctx,{text:'Default',style:{}},bounds).size,20);
  assert.equal(layoutUiText(ctx,node,{...bounds,viewportHeight:2000}).size,60);
  assert.equal(uiFont('sans-serif',20),'400 20px sans-serif');
  assert.equal(uiFont('Reading UI, sans-serif',20),'400 20px "Reading UI", sans-serif');
  assert.equal(uiFont('"Comma, Family", monospace',20),'400 20px "Comma, Family", monospace');
});
test('native tracking preserves whole shaped lines and old hosts reject unsupported joining scripts',()=>{
  const ctx=context();ctx.letterSpacing='0px';
  assert.equal(measureUiText(ctx,'ABC',3),36);assert.equal(measureUiText(ctx,'A',3),10);assert.equal(measureUiText(ctx,'',3),0);assert.equal(ctx.letterSpacing,'0px');
  paintUiText(ctx,{text:'مرحبا',style:{letter_spacing:.2}},bounds);
  assert.equal(ctx.calls.filter(v=>v[0]==='text').length,1);assert.equal(ctx.calls.find(v=>v[0]==='text')[1],'مرحبا');
  assert.throws(()=>paintUiText(context(),{text:'مرحبا',style:{letter_spacing:.2}},bounds),/UI_TEXT_TRACKING_UNSUPPORTED/);
});
test('padding, measured alignment, line height and tracking share vertical units',()=>{
  const ctx=context(),node={text:'AB\nC',style:{font_size:2,line_height:1.5,letter_spacing:.2,text_align:'end',vertical_align:'bottom',padding:{left:1,top:2,right:3,bottom:1}}};
  const result=layoutUiText(ctx,node,bounds);assert.deepEqual(result.content,{x:20,y:40,width:60,height:70});
  assert.deepEqual(result.lines.map(({text,x,y})=>({text,x,y})),[{text:'AB',x:58,y:65},{text:'C',x:70,y:95}]);
  paintUiText(ctx,node,bounds);assert.equal(ctx.calls.filter(c=>c[0]==='text').length,3);assert.equal(measureUiText(ctx,'AB',2),22);
});
test('word wrapping measures Latin, CJK, long words and Unicode graphemes',()=>{
  const ctx=context(),node={text:'alpha beta\n中文測試\nABCDEFG',style:{font_size:1,wrap:'word',text_align:'start',vertical_align:'top'}};
  assert.deepEqual(layoutUiText(ctx,node,{...bounds,width:35,height:500}).lines.map(v=>v.text),['alp','ha','bet','a','中文測','試','ABC','DEF','G']);
  const grapheme={text:'👩‍🚀!',style:{font_size:1,wrap:'word'}};
  assert.deepEqual(layoutUiText(ctx,grapheme,{...bounds,width:10,height:500}).lines.map(v=>v.text),['👩‍🚀','!']);
});
test('ellipsis measures horizontal overflow without changing size or explicit line layout',()=>{
  const ctx=context(),node={text:'ABCDE\nFGHIJ\nKLMNO',style:{font_size:2,line_height:1,overflow:'ellipsis',vertical_align:'top'}};
  const result=layoutUiText(ctx,node,{...bounds,width:35,height:40});assert.equal(result.size,20);assert.deepEqual(result.lines.map(v=>v.text),['AB…','FG…','KL…']);
  assert.deepEqual(layoutUiText(ctx,node,{...bounds,width:5,height:40}).lines.map(v=>v.text),['','','']);
});
test('panel painting has rounded backgrounds, borders and no input interception',()=>{
  const ctx=context();paintUiBox(ctx,{background:[0,0,0,.5],border_color:[1,1,1,1],border_width:.2,border_radius:1},0,0,200,100,10);
  assert(ctx.calls.some(c=>c[0]==='round'&&c.at(-1)===10));assert.deepEqual(ctx.calls.at(-1),['stroke','rgba(255,255,255,1)',2]);
  const router=createUiPointerRouter(),rect={x:0,y:0,width:100,height:100};router.setTree({children:[{kind:'button',id:'action',rect,action:'Continue'},{kind:'panel',id:'decoration',rect,style:{background:[1,1,1,.1]}}]});
  assert.equal(router.hitTest(50,50).action,'Continue');assert.equal(router.pointer({kind:'down',x:50,y:50}),true);
  const ui=createCanvasUi({width:100,height:100,getContext:()=>ctx});ui.draw({ui:{children:[{kind:'panel',id:'box',rect,style:{background:[0,0,0,.5]}}]}},{width:100,height:100,dpr:1});assert.equal(ui.report().nodes,1);
});
test('opacity composites one isolated leaf, reuses its surface and disposes resources',()=>{
  let made=0;const ctx=context(),layer=context(),surface={width:1,height:1,getContext:()=>layer};ctx.canvas={width:200,height:100};ctx.drawImage=(...args)=>ctx.calls.push(['composite',ctx.globalAlpha,...args]);
  const painter=createUiOpacityPainter(()=>{made++;return surface;});
  for(let i=0;i<2;i++)painter.paint(ctx,.5,{x:10.5,y:20.5,width:30,height:40},target=>{assert.equal(target,layer);target.fillStyle='red';target.fill();});
  assert.equal(made,1);assert.equal(surface.width,31);assert.equal(surface.height,41);assert.equal(ctx.calls.filter(v=>v[0]==='composite').length,2);assert.equal(ctx.calls[0][1],.5);
  painter.dispose();assert.equal(surface.width,1);assert.equal(surface.height,1);
});
test('font catalogs preserve legacy faces and distinguish weights with actionable failures',async()=>{
  const fullCatalog=Array.from({length:32},(_,i)=>({family:`Fixture ${i}`,source:`fonts/${i}.ttf`}));
  assert.equal(presentationFontFaces({fonts:fullCatalog}).length,32);
  assert.equal(presentationFontFaces({font_source:'legacy.ttf',font_family:'Legacy',fonts:fullCatalog.slice(1)}).length,32);
  assert.throws(()=>presentationFontFaces({font_source:'legacy.ttf',font_family:'Legacy',fonts:fullCatalog}),/UI_FONT_LIMIT/);
  assert.deepEqual(presentationFontFaces({font_source:'old.woff2',font_family:'Old',fonts:[{family:'UI',source:'ui.ttf'},{family:'UI',source:'bold.otf',weight:700}]}).map(v=>v.weight),[400,400,700]);
  assert.throws(()=>presentationFontFaces({fonts:[{family:'UI',source:'ui.woff2'}]}),/UI_FONT_FORMAT_UNSUPPORTED/);
  assert.throws(()=>presentationFontFaces({fonts:[{family:'UI',source:'ui.ttf'},{family:'UI',source:'other.ttf'}]}),/UI_FONT_DUPLICATE/);
  assert.throws(()=>presentationFontFaces({font_source:'old.ttf'}),/UI_FONT_FAMILY_REQUIRED/);
  const added=[],removed=[],oldFontFace=globalThis.FontFace,oldDocument=globalThis.document;
  globalThis.document={fonts:{add:f=>added.push(f),delete:f=>removed.push(f)}};
  globalThis.FontFace=class {constructor(family,source,descriptors){Object.assign(this,{family,source,descriptors});}async load(){if(this.family==='Broken')throw Error('bad font');return this;}};
  try{
    await assert.rejects(loadPresentationFonts({fonts:[{family:'UI',source:'ui.ttf',weight:700},{family:'Broken',source:'broken.ttf'}]},s=>`content/${s}`),/UI_FONT_LOAD_FAILED: Broken 400/);
    assert.deepEqual(added,[]);assert.deepEqual(removed,[]);
  }finally{globalThis.FontFace=oldFontFace;globalThis.document=oldDocument;}
});

test('startup requests every font before waiting, installs in catalog order and leaves no late face after a failure',async()=>{
  const oldFace=globalThis.FontFace,oldDocument=globalThis.document;
  const pending=[],added=[],progress=[];
  globalThis.document={fonts:{add:font=>added.push(font),delete:font=>added.splice(added.indexOf(font),1)}};
  globalThis.FontFace=class {
    constructor(family,source,descriptors){Object.assign(this,{family,source,descriptors});}
    load(){return new Promise((resolve,reject)=>pending.push({resolve,reject}));}
  };
  const load=()=>loadPresentationFonts({fonts:[{family:'UI',source:'ui.ttf',weight:700},{family:'Labels',source:'labels.ttf'}]},
    source=>'content/'+source,(done,total)=>progress.push([done,total]));
  try{
    const loaded=load();
    assert.equal(pending.length,2);
    pending[1].resolve();pending[0].resolve();
    assert.deepEqual(await loaded,added);
    assert.deepEqual(added.map(font=>font.family),['UI','Labels']);
    assert.equal(added[0].descriptors.weight,'700');assert.equal(added[0].source,'url("content/ui.ttf")');
    assert.deepEqual(progress,[[1,2],[2,2]]);
    const failed=load();
    pending[3].reject(Error('bad face'));
    await assert.rejects(failed,/UI_FONT_LOAD_FAILED: Labels 400/);
    pending[2].resolve();await new Promise(resolve=>setImmediate(resolve));
    assert.equal(added.length,2);assert.equal(progress.length,2);
    const previous=added.slice();
    globalThis.document.fonts.add=font=>{if(font.family==='Labels')throw Error('cannot install');added.push(font);};
    const installFailure=load();
    pending[4].resolve();pending[5].resolve();
    await assert.rejects(installFailure,/UI_FONT_LOAD_FAILED: Labels 400: cannot install/);
    assert.deepEqual(added,previous);
  }finally{globalThis.FontFace=oldFace;globalThis.document=oldDocument;}
});
