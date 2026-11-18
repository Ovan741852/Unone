import {createThreeRenderer} from './three.js';
import {createAssetCatalog,createImageAssetBroker} from '../shared/asset-encoding.js';
window.testMeshRetry=async()=>{
 const assets=[{id:'sprite',kind:'texture2d',source:'sprite.png',encoding:{decoder:'image',format:'png',mime:'image/png'}},{id:'mesh',kind:'mesh3d',source:'qa/model.mesh.json'}];
 const catalog=createAssetCatalog({assets}),image=document.createElement('canvas');image.width=image.height=4;
 const broker=createImageAssetBroker(catalog,{resolveAssetUrl:a=>a.source,inspectImage:async()=>({format:'png',width:4,height:4}),loadImage:async()=>image});
 const canvas=document.createElement('canvas');canvas.style.cssText='width:320px;height:180px';document.body.append(canvas);
 const r=await createThreeRenderer(canvas,{kind:'three-webgl',threeModuleUrl:'/web/vendor/three/three.player.min.js',antialias:false,frameTransaction:true,webglDefaultDepth:false,getAssetManifest:()=>({assets}),getAssetCatalog:()=>catalog,getImageAssets:()=>broker,loadAssetUrl:async asset=>'/'+asset.source});
 const tx=r.frameTransaction,assert=(x,message)=>{if(!x)throw Error(message);};
 try{
  const sprite=r.spriteResources.prepare({id:'keep',asset:'sprite'});await sprite.readyPromise;
  const prior={epoch:sprite.epoch,state:sprite.state,metrics:r.metrics().sprite_resources};assert(prior.state==='ready','sprite must start ready');
  const snapshot={world:{camera:{view_height:5,zoom:1},camera3d:{position:{x:2,y:2,z:8},target:{x:0,y:0,z:0},fov_degrees:50},entities:{mesh:{id:'mesh',mesh3d:{asset:'mesh',visible:true},transform3d:{position:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}}}}}};
  function startDraw(){const begin=tx.begin(snapshot,{allowResize:true});assert(begin.status==='completed','begin '+JSON.stringify(begin));const result=r.draw(snapshot);if(result.status!=='completed')tx.abort();return result;}
  assert(startDraw().status==='skipped','first 503 should be pending');let error=null;try{await r.ready();}catch(e){error=String(e.message??e)}assert(error?.includes('MESH_ASSET_FETCH_FAILED'),'must expose mesh fetch error '+error);
  const retired=r.retryFailedMeshAssets();assert(retired===1,'exactly one failed mesh owner retired');assert(sprite.state==='ready'&&sprite.epoch===prior.epoch,'retry altered sprite handle or epoch');
  assert(startDraw().status==='skipped','fresh fetch should be pending');await r.ready();assert(startDraw().status==='completed','retried mesh draw');assert(tx.commit().status==='completed','commit');
  const after=r.metrics().sprite_resources;assert(sprite.state==='ready'&&sprite.epoch===prior.epoch,'successful mesh altered sprite handle');assert(after.builds===prior.metrics.builds&&after.retired===prior.metrics.retired,'successful sprite was rebuilt');
  return {error,retired,sprite:{before:prior,after:{epoch:sprite.epoch,state:sprite.state,metrics:after}},mesh:r.metrics().mesh_entities};
 }finally{r.dispose();broker.dispose();}
};
