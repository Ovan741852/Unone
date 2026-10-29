import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssetUsageReader} from './asset-usages.js';

test('live image batches index every ordered quad, duplicate asset and nearest component without executing game code',async()=>{
  let loads=0,ticks=0;
  const source={version:1,project_root:'fixture',assets:{'texture://red':'atlas.png','texture://blue':'atlas.png'},
    references:[],unresolved:[],source_files:[],scope:{scan_complete:true,runtime_complete:false}};
  const batch={kind:'image_batch',id:'scene-art',quads:[{asset:'texture://red'},{asset:'texture://blue'},{asset:'texture://red'}]};
  const snapshot={world:{frame:42,entities:[],ui:{kind:'screen',id:'screen',children:[
    {kind:'component',id:'outer',component:'scene',children:[
      {kind:'component',id:'inner',component:'art',children:[batch]},
    ]},
  ]}}};
  const reader=createAssetUsageReader({getAssetUsageIndex:async()=>{loads++;return source;},getSnapshot:()=>snapshot,tick:()=>ticks++});
  const usage=await reader.usages('texture://red');
  assert.equal(usage.live.length,3,'same-file aliases remain included');
  assert.deepEqual(usage.live.map(row=>[row.asset,row.quad_index,row.node_id]),[
    ['texture://red',0,'scene-art'],['texture://blue',1,'scene-art'],['texture://red',2,'scene-art']]);
  assert.equal(usage.live[1].ui_path,'ui.children[0].children[0].children[0].quads[1]');
  assert.deepEqual(usage.live[0].node_path,['screen','outer','inner','scene-art']);
  assert.equal(usage.live[0].component_id,'inner');
  assert.equal(usage.live[0].component,'art');
  const assets=(await reader.assets()).assets;
  assert.deepEqual(assets.map(row=>[row.id,row.live_count]),[['texture://blue',1],['texture://red',2]]);
  batch.quads=[];
  assert.equal((await reader.usages('texture://red')).live.length,0);
  assert.equal(loads,1);assert.equal(ticks,0);
});

test('no-inventory development index retains incomplete scope and reports live batch assets',async()=>{
  const scope={scan_complete:false,runtime_complete:false,issues:['ASSET_MANIFEST_NOT_CONFIGURED: no inventory; source scanning was not performed.'],limitations:['Zero references do not prove deletion is safe.']};
  const source={version:1,project_root:'fixture',assets:{},references:[],unresolved:[],source_files:[],scope};
  const snapshot={world:{ui:{id:'art',kind:'image_batch',quads:[{asset:'texture://runtime-only'}]}}};
  const reader=createAssetUsageReader({getAssetUsageIndex:async()=>source,getSnapshot:()=>snapshot});
  const assets=await reader.assets();
  assert.equal(assets.source_error,null);
  assert.equal(assets.scope.scan_complete,false);
  assert.equal(assets.assets[0].source,null);
  assert.equal(assets.assets[0].live_count,1);
  const usage=await reader.usages('texture://runtime-only');
  assert.equal(usage.live.length,1);
  assert.equal(usage.references.length,0);
  assert.deepEqual(usage.scope,scope);
  assert.match(usage.note,/零筆結果不代表可刪除/);
});
