import {requireAssetEncoding} from '../shared/asset-encoding.js';

export async function createEffects(gl, assets, loadAssetUrl) {
  const declared=assets.filter(a=>a.kind==='effekseer');
  if(!declared.length) return null;
  if(!gl) throw new Error('EFFEKSEER_HOST_UNSUPPORTED: select the WebGL renderer');
  await new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src=new URL('../vendor/effekseer/effekseer.js',import.meta.url).href;
    script.onload=resolve;script.onerror=()=>reject(new Error('EFFEKSEER_SCRIPT_LOAD_FAILED'));
    document.head.appendChild(script);
  });
  const library=window.effekseer;
  await new Promise((resolve,reject)=>library.initRuntime(new URL('../vendor/effekseer/effekseer.wasm',import.meta.url).href,resolve,()=>reject(new Error('EFFEKSEER_WASM_LOAD_FAILED'))));
  const context=library.createContext();context.init(gl,{instanceMaxCount:2000,squareMaxCount:4000});
  context.setRestorationOfStatesFlag(false);
  const effects=new Map(),live=new Map();
  for(const asset of declared) {
    requireAssetEncoding(asset,'effekseer');
    const url=await loadAssetUrl(asset);
    const effect=await new Promise((resolve,reject)=>{
      const loaded=context.loadEffect(url,1,()=>resolve(loaded),message=>reject(new Error(`EFFEKSEER_LOAD_FAILED: ${asset.id}: ${message}`)));
    });
    effects.set(asset.id,effect);
  }
  let lastFrame=null;
  return {
    draw(world,camera) {
      const requested=new Set((world.effects??[]).map(e=>e.handle));
      for(const [id,record] of live) if(!requested.has(id)) {record.stop();live.delete(id);}
      for(const item of world.effects??[]) {
        if(live.has(item.handle)) continue;
        const effect=effects.get(item.asset);
        if(!effect) throw new Error(`EFFEKSEER_ASSET_MISSING: ${item.asset}`);
        const handle=context.play(effect,item.position.x,item.position.y,0);
        handle.setScale(item.scale,item.scale,item.scale);
        handle.setRotation(0,0,item.rotation);
        live.set(item.handle,handle);
      }
      // Presentation follows simulation frames rather than monitor refresh rate.
      const elapsed=lastFrame===null?0:Math.max(0,world.frame-lastFrame);
      if(elapsed>0) context.update(elapsed);
      lastFrame=world.frame;
      context.setProjectionMatrix(camera.projectionMatrix.elements);
      context.setCameraMatrix(camera.matrixWorldInverse.elements);
      context.draw();
    },
    get count(){return live.size;},
  };
}
