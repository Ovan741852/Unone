import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/three.player.min.js';
import {createBloom} from './bloom.js';

function fixture(){
 const canvas=new EventTarget(),events=[];let epoch=1,enabled=false,lost=false,error=0,id=0,available=true;
 const extension={TIME_ELAPSED_EXT:0x88bf,GPU_DISJOINT_EXT:0x8fbb};
 const valid=()=>{if(!enabled){error=0x0500;events.push(['disabled-extension',epoch]);return false;}return true;};
 const query=q=>{if(q.epoch!==epoch){error=0x0502;events.push(['stale-query',q.id]);return false;}return valid();};
 const gl={canvas,NO_ERROR:0,QUERY_RESULT_AVAILABLE:0x8867,QUERY_RESULT:0x8866,isContextLost:()=>lost,
  getExtension(name){events.push(['extension',name,epoch]);if(name!=='EXT_disjoint_timer_query_webgl2'||!available||lost)return null;enabled=true;return extension;},
  getParameter(){valid();return false;},createQuery:()=>({id:++id,epoch}),
  beginQuery(target,q){query(q);events.push(['begin',q.id,epoch]);},endQuery(){valid();events.push(['end',epoch]);},
  deleteQuery(q){query(q);events.push(['delete',q.id,epoch]);},getQueryParameter(q,p){query(q);events.push(['poll',q.id,epoch]);return p===gl.QUERY_RESULT_AVAILABLE?true:1000000;},
  getError(){const e=error;error=0;return e;}};
 const renderer={domElement:canvas,getContext:()=>gl,getDrawingBufferSize:v=>v.set(64,64),setRenderTarget(){},render(){events.push(['render',epoch]);}};
 const bloom=createBloom(THREE,renderer);bloom.setEnabled(false);bloom.setAO(false);
 const draw=overlay=>bloom.draw(new THREE.Scene(),new THREE.PerspectiveCamera(),overlay);
 return {bloom,gl,events,draw,unavailable:()=>available=false,
  rawLoss(){lost=true;enabled=false;},lossEvent(){canvas.dispatchEvent(new Event('webglcontextlost'));},
  restore(){lost=false;enabled=false;epoch++;canvas.dispatchEvent(new Event('webglcontextrestored'));}};
}

test('actual Bloom-off ordinary draw reacquires timer extension and never polls a prior-epoch query after restore',()=>{
 const f=fixture();f.draw();assert.equal(f.gl.getError(),0);f.rawLoss();f.lossEvent();f.restore();f.draw();
 assert.equal(f.gl.getError(),0,'restore must enable extension before ordinary draw');
 assert(!f.events.some(e=>e[0]==='stale-query'||e[0]==='disabled-extension'));
 assert.equal(f.events.filter(e=>e[0]==='extension'&&e[1]==='EXT_disjoint_timer_query_webgl2').length,2);
 assert(!f.events.some(e=>e[0]==='delete'&&e[1]===1));f.bloom.dispose();
});

test('raw loss before event and loss during ordinary draw never touch old query handles',()=>{
 for(const inFlight of [false,true]){
  const f=fixture();f.draw();const before=f.events.length;
  if(inFlight)f.draw(()=>f.rawLoss());else{f.rawLoss();f.draw();}
  const afterLoss=f.events.slice(before);assert(!afterLoss.some(e=>e[0]==='disabled-extension'||e[0]==='stale-query'));
  f.lossEvent();f.restore();f.draw();assert.equal(f.gl.getError(),0);f.bloom.dispose();
 }
});

test('extension unavailable after restore leaves ordinary rendering enabled without invented timings',()=>{
 const f=fixture();f.draw();f.rawLoss();f.lossEvent();f.unavailable();f.restore();f.draw();
 assert.equal(f.gl.getError(),0);assert.equal(f.bloom.metrics().gpu_timer_available,false);
 assert.equal(f.bloom.metrics().gpu_off,null);assert(f.events.some(e=>e[0]==='render'&&e[1]===2));f.bloom.dispose();
});

test('repeated restore keeps query epochs distinct; disposal removes lifecycle listeners',()=>{
 const f=fixture();for(let i=0;i<3;i++){f.draw();f.rawLoss();f.lossEvent();f.restore();}
 f.draw();assert.equal(f.gl.getError(),0);f.bloom.dispose();const before=f.events.length;
 f.rawLoss();f.lossEvent();f.restore();assert.equal(f.events.length,before);f.bloom.dispose();
 assert.throws(f.draw,/POSTPROCESSING_DISPOSED/);
});
