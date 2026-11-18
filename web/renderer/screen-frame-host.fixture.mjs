import {createThreeRenderer} from './three.js';
import {createAtomicFramePresenter} from '../shared/atomic-frame-presenter.mjs';
import {authoredCases,packCase} from './fixtures/raster-origin/registry.mjs';

window.testAtomicHostWorlds=async()=>{
 const canvas=()=>{const c=document.createElement('canvas');c.style.cssText='width:320px;height:180px';document.body.append(c);return c;};
 const referenceCanvas=canvas(),stagedCanvas=canvas(),asset={id:'white',kind:'texture2d',source:'white.svg'};
 const opts={kind:'three-webgl',threeModuleUrl:'/web/vendor/three/three.player.min.js',antialias:false,getAssetManifest:()=>({assets:[asset]}),loadAssetUrl:async()=>'/white.svg'};
 const reference=await createThreeRenderer(referenceCanvas,opts),staged=await createThreeRenderer(stagedCanvas,{...opts,frameTransaction:true,webglDefaultDepth:false});
 const tx=staged.frameTransaction;if(!tx)throw Error('NO_TRANSACTION');
 const read=c=>{const gl=c.getContext('webgl2'),bytes=new Uint8Array(c.width*c.height*4);gl.readPixels(0,0,c.width,c.height,gl.RGBA,gl.UNSIGNED_BYTE,bytes);return bytes;};
 const ok={status:'completed'},events=[];
 const coordinator=createAtomicFramePresenter({transaction:tx,transactionSnapshot:value=>value.display,prepare:()=>ok,drawWorld:value=>staged.draw(value.display),drawUi:()=>ok,routeToken:()=>null,commitRoute:()=>{},abortRoute:()=>{},commitHosts:()=>{},enterWait:x=>events.push(x),recover:x=>events.push(x),leaveWait:()=>{}});
 const camera3d={position:{x:3,y:2,z:8},target:{x:0,y:0,z:0},fov_degrees:50};
 const box=(id,z)=>({id,mesh3d:{asset:'mesh://primitive/box',visible:true},transform3d:{position:{x:0,y:0,z},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}}});
 const base={camera:{view_height:5,zoom:1},entities:{},projected_world_visible:false};
 const worlds={empty:base,mesh:{...base,projected_world_visible:true,camera3d,entities:{front:box('front',0),back:box('back',-1)}},
  terrain:{...base,projected_world_visible:true,camera3d,heightfields:{ground:{width:2,depth:2,cell_size:4,origin:{x:-2,y:-1,z:-2},heights:[0,0,0,0],texture:'white',revision:1}}},
  projected:{...base,...packCase(authoredCases().find(x=>x.id==='depth'),320,180)}};
 const results=[];
 try{for(const name of ['empty','mesh','empty','terrain','empty','projected','empty']){
   const actual={world:worlds[name]},wrapper={snapshot:{world:base},display:actual};
   let control=reference.draw(actual);if(control.status!=='completed'){await reference.ready();control=reference.draw(actual);}if(control.status!=='completed')throw Error(`REFERENCE_${name} `+JSON.stringify(control));
   let result=coordinator.present(wrapper);if(result.status!=='completed'){await staged.ready();result=coordinator.present(wrapper);}if(result.status!=='completed')throw Error(`STAGED_${name} `+JSON.stringify(result));
   control=reference.draw(actual);if(control.status!=='completed')throw Error(`REFERENCE_REDRAW_${name} `+JSON.stringify(control));
   const depth=tx.metrics().depth_allocated,expectedDepth=name!=='empty';if(depth!==expectedDepth)throw Error(`INCORRECT_DEPTH_${name}: ${depth}`);
   const a=read(referenceCanvas),b=read(stagedCanvas);let different=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i])different++;if(different)throw Error(`PIXELS_${name}: ${different}`);results.push({name,depth,different});
  }return {results,events};
 }finally{coordinator.dispose();reference.dispose();staged.dispose();}
};
