import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createCanvasUi} from './canvas-ui.mjs';
import {createPlayerProfiler,playerProfileOptions} from './raster-diagnostics.mjs';
const source=fs.readFileSync(process.env.UNONE_UI_ASSET_MAIN_SOURCE??new URL('../player/main.js',import.meta.url),'utf8');
const asset='texture://main-ui-diagnostic',tree={children:[{kind:'image',id:'i',asset,rect:{x:0,y:0,width:10,height:10}}]};
function fixture(search){
 const presenter={target:()=>({width:100,height:100,scale:1}),draw:()=>({skipped:false,regions:1}),metrics:()=>({})};
 const ui=createCanvasUi(null,{getPresenter:()=>presenter,acquireAsset:()=>({state:'ready',image:{width:1,height:1},promise:Promise.resolve({width:1,height:1}),release(){}})}),context={profiler:null,location:{search},uiRenderer:ui,window:{},document:{body:{dataset:{}}},playerProfileOptions,createPlayerProfiler};
 const begin=source.indexOf(' const profileOptions=playerProfileOptions(location.search);'),end=source.indexOf('\n const [project,assets,presentation]=',begin);assert(begin>=0&&end>begin);
 vm.createContext(context);vm.runInContext(source.slice(begin,end),context);return {context,ui};
}
test('actual production main installs UI observation only through its existing profiler opt-in',()=>{
 for(const search of ['', '?unone_profile=0','?unone_profile=true']){const f=fixture(search);try{assert.equal(f.context.profiler,null);assert.equal(f.ui.assetDiagnostics(),null);}finally{f.ui.dispose();}}
 const f=fixture('?unone_profile=1&unone_profile_limit=16');try{
  assert(f.ui.assetDiagnostics());f.ui.draw({world:{frame:7,ui:tree}});const report=f.context.profiler.report();
  assert.equal(report.events.length,1);assert.equal(report.events[0].kind,'ui_asset');assert.equal(report.events[0].status,'ok');assert.equal(report.events[0].attrs.transition,'acquire_ready');assert.equal(report.counts.dropped_attrs,0);
 }finally{f.ui.dispose();}
});
test('actual main UI draw span receives lightweight correlation fields without an extra per-frame event',()=>{
 const f=fixture('?unone_profile=1');try{
  const p=f.context.profiler,pd=p.begin('draw'),begin=source.indexOf('const uiOutcome=renderUi(snapshot);'),end=source.indexOf('const cursorOutcome=',begin);assert(begin>=0&&end>begin);
  const context={renderUi:snapshot=>f.ui.draw(snapshot),snapshot:{world:{frame:8,ui:tree}},pd,profiler:p,uiRenderer:f.ui,performance:{now:()=>0},began:0,renderMs:0};
  vm.createContext(context);vm.runInContext(source.slice(begin,end),context);p.end(pd,'completed');const report=p.report(),draw=report.events.find(e=>e.kind==='draw');
  assert.equal(draw.attrs.ui_composition,1);assert.equal(draw.attrs.ui_loading_count,0);assert.equal(report.events.filter(e=>e.kind==='ui_asset').length,1);assert.equal(report.counts.dropped_attrs,0);
  const original=f.ui.assetDiagnostics;f.ui.assetDiagnostics=()=>{throw Error('OFF_MUST_NOT_QUERY_DIAGNOSTICS');};context.pd=null;assert.doesNotThrow(()=>vm.runInContext(source.slice(begin,end),vm.createContext({...context})));f.ui.assetDiagnostics=original;
 }finally{f.ui.dispose();}
});

for(const producerPath of ['../../scripts/web-export-host.mjs','../../crates/unone-cli/src/export.rs'])test(`actual UI-disabled producer ${producerPath} supports production profile-on without asset observation`,async()=>{
 const producer=fs.readFileSync(new URL(producerPath,import.meta.url),'utf8'),line=producer.split(/\r?\n/).find(value=>value.includes('const disabledUiCompleted')&&value.includes('const createCanvasUi'));
 assert(line,'Actual producer UI-off replacement exists');const begin=line.indexOf('const disabledUiCompleted'),end=line.lastIndexOf('"'),stub=line.slice(begin,end);
 const context={profiler:null,uiRenderer:null,location:{search:'?unone_profile=1'},window:{},document:{body:{dataset:{}}},createPlayerProfiler,playerProfileOptions};
 const start=source.indexOf(' const profileOptions=playerProfileOptions(location.search);'),stop=source.indexOf('\n const [project,assets,presentation]=',start);
 vm.createContext(context);vm.runInContext(stub+';uiRenderer=createCanvasUi();'+source.slice(start,stop),context);
 assert(context.profiler);assert.equal(context.uiRenderer.assetDiagnostics(),null);assert.equal(context.uiRenderer.draw().status,'completed');await context.uiRenderer.ready();assert.equal(context.uiRenderer.pointer(),false);assert.equal(context.uiRenderer.hitTest(),null);assert.deepEqual(Array.from(context.uiRenderer.report().assets),[]);
 assert.equal(context.profiler.report().events.length,0);assert.equal(context.profiler.report().counts.dropped_attrs,0);
});
