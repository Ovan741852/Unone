import test from 'node:test';
import assert from 'node:assert/strict';
import {layoutUiText,paintUiText,paintUiBox,presentationFontFaces,measureUiText,createUiOpacityPainter,uiFont} from './ui-style.mjs';
import {createCanvasUi,createUiPointerRouter,loadPresentationFonts} from './canvas-ui.mjs';
function context(){
  const calls=[];return {calls,save(){},restore(){},beginPath(){},rect(...r){calls.push(['rect',...r]);},roundRect(...r){calls.push(['round',...r]);},clip(){},fill(){calls.push(['fill',this.fillStyle]);},stroke(){calls.push(['stroke',this.strokeStyle,this.lineWidth]);},fillText(text,x,y){calls.push(['text',text,x,y,this.font,this.fillStyle]);},measureText(text){const count=[...text].length;return {width:count*(10+Number.parseFloat(this.letterSpacing??0))};},setTransform(){},clearRect(){}};
}
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
    assert.equal(added[0].descriptors.weight,'700');assert.equal(added[0].source,'url("content/ui.ttf")');assert.deepEqual(removed,added);
  }finally{globalThis.FontFace=oldFontFace;globalThis.document=oldDocument;}
});
