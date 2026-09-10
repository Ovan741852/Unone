// Official non-DOM UI projection. DOM is used only for the canvas/font host;
// game controls, hit testing and visual layering are not DOM elements.
const inside=(r,x,y)=>x>=r.x&&y>=r.y&&x<r.x+r.width&&y<r.y+r.height;
export function flattenUi(tree){
  const leaves=[];let count=0;
  function walk(nodes,depth){
    if(depth>16)throw Error('UI_DEPTH_LIMIT: maximum 16 component wrappers');
    for(const n of nodes??[]){
      if(++count>256)throw Error('UI_NODE_LIMIT: maximum 256 nodes');
      if(n.kind==='component'){walk(n.children,depth+1);continue;}
      if(!['text','button','image'].includes(n.kind))throw Error(`UI_NODE_UNSUPPORTED: ${n.kind}`);
      if(!n.rect||!['x','y','width','height'].every(k=>Number.isFinite(n.rect[k]))||n.rect.width<=0||n.rect.height<=0)throw Error(`UI_RECT_INVALID: ${n.id}`);
      leaves.push(n);
    }
  }
  walk(tree?.children,0);return leaves;
}
export function createUiPointerRouter({onAction=()=>{}}={}){
  let nodes=[];const captured=new Map(),holds=new Map();
  function release(id,phase){const c=captured.get(id);if(!c)return false;captured.delete(id);
    if(c.action){const count=(holds.get(c.action)??1)-1;if(count>0)holds.set(c.action,count);else{holds.delete(c.action);onAction({action:c.action,phase,nodeId:c.id,pointerId:id});}}return true;}
  return {
    setTree(tree){nodes=flattenUi(tree);for(const [pointer,c]of captured)if(c.action&&!nodes.some(n=>n.id===c.id&&n.kind==='button'&&n.action===c.action)){release(pointer,'cancel');captured.set(pointer,{id:c.id,action:null});}},
    pointer({kind,pointerId=0,x,y}){
      if(kind==='cancel'||kind==='up')return release(pointerId,kind);
      if(captured.has(pointerId))return true;
      if(kind!=='down')return false;
      const node=[...nodes].reverse().find(n=>inside(n.rect,x,y));if(!node)return false;
      const action=node.kind==='button'?node.action:null;captured.set(pointerId,{id:node.id,action});
      if(action){const count=holds.get(action)??0;holds.set(action,count+1);if(!count)onAction({action,phase:'down',nodeId:node.id,pointerId});}
      return true;
    },
    releaseAll(){for(const id of [...captured.keys()])release(id,'cancel');},
    hitTest(x,y){const n=[...nodes].reverse().find(n=>inside(n.rect,x,y));return n?{nodeId:n.id,action:n.kind==='button'?n.action:null}:null;},
    get capturedPointers(){return [...captured.keys()];},
  };
}
function imageLoad(url){return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(Error(`UI_IMAGE_LOAD_FAILED: ${url}`));image.src=url;});}
export async function loadCanvasFont(family,url){
  const font=new FontFace(family,`url(${JSON.stringify(String(url))})`);await font.load();document.fonts.add(font);return font;
}
export function createCanvasUi(canvas,{resolveAsset,loadImage=imageLoad,onAction,onDiagnostic=()=>{},requestRender=()=>{},fontFamily='sans-serif',textColor='#ffffff'}={}){
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('UI_CANVAS_2D_UNAVAILABLE');
  const router=createUiPointerRouter({onAction}),assets=new Map();let previous=null,dirty=true,disposed=false,nodes=[],generation=0;
  const diagnostics=new Map();
  const reportError=(id,error)=>{const value={code:'UI_ASSET_FAILED',asset:id,message:String(error?.message??error)};diagnostics.set(id,value);onDiagnostic(value);};
  function ensureAsset(id){if(assets.has(id))return assets.get(id);
    const entry={image:null,state:'loading'};assets.set(id,entry);const ticket=generation;
    Promise.resolve().then(()=>{if(!resolveAsset)throw Error('UI_ASSET_RESOLVER_REQUIRED');return resolveAsset(id);}).then(value=>typeof value==='string'||value instanceof URL?loadImage(value):value)
      .then(image=>{if(disposed||ticket!==generation||assets.get(id)!==entry){image?.close?.();return;}if(!image||!(image.naturalWidth??image.width))throw Error('UI_IMAGE_INVALID');entry.image=image;entry.state='ready';dirty=true;requestRender();})
      .catch(error=>{if(!disposed&&ticket===generation&&assets.get(id)===entry){entry.state='failed';reportError(id,error);dirty=true;requestRender();}});
    return entry;
  }
  function image(node,x,y,w,h){const e=ensureAsset(node.asset);if(!e.image)return;const img=e.image,iw=img.naturalWidth??img.width,ih=img.naturalHeight??img.height;
    ctx.save();ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();
    if(node.fit==='stretch')ctx.drawImage(img,x,y,w,h);else {const s=node.fit==='cover'?Math.max(w/iw,h/ih):Math.min(w/iw,h/ih);ctx.drawImage(img,x+(w-iw*s)/2,y+(h-ih*s)/2,iw*s,ih*s);}ctx.restore();
  }
  function text(node,x,y,w,h){if(!node.text)return;const lines=String(node.text).split('\n');let size=Math.max(1,Math.min(h/(lines.length*1.2),h*0.72));
    ctx.save();ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();ctx.fillStyle=textColor;ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.font=`${size}px ${fontFamily}`;const longest=Math.max(...lines.map(l=>ctx.measureText(l).width),1);size*=Math.min(1,w/longest);ctx.font=`${size}px ${fontFamily}`;
    lines.forEach((line,i)=>ctx.fillText(line,x+w/2,y+h/2+(i-(lines.length-1)/2)*size*1.2));ctx.restore();
  }
  return {
    draw(snapshot,{width=canvas.clientWidth??canvas.width,height=canvas.clientHeight??canvas.height,dpr=globalThis.devicePixelRatio??1}={}){
      if(disposed)throw Error('UI_DISPOSED');if(![width,height,dpr].every(v=>Number.isFinite(v)&&v>0))return;
      const bw=Math.min(8192,Math.max(1,Math.round(width*dpr))),bh=Math.min(8192,Math.max(1,Math.round(height*dpr)));
      if(canvas.width!==bw||canvas.height!==bh){canvas.width=bw;canvas.height=bh;dirty=true;}
      const tree=(snapshot?.world??snapshot)?.ui??null,key=JSON.stringify(tree);
      if(key!==previous){nodes=flattenUi(tree);router.setTree(tree);previous=key;dirty=true;
        const used=new Set(nodes.filter(n=>n.kind==='image').map(n=>n.asset));for(const [id,e]of assets)if(!used.has(id)){e.image?.close?.();assets.delete(id);diagnostics.delete(id);}}
      if(!dirty)return;dirty=false;ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,bw,bh);
      for(const node of nodes){const r=node.rect,x=r.x*bw/100,y=(100-r.y-r.height)*bh/100,w=r.width*bw/100,h=r.height*bh/100;
        if(node.kind==='image')image(node,x,y,w,h);else text(node,x,y,w,h);}
    },
    pointer:router.pointer,hitTest:router.hitTest,releaseAll:router.releaseAll,
    setFont(family){fontFamily=family;dirty=true;},
    invalidateAssets(){generation++;for(const e of assets.values())e.image?.close?.();assets.clear();diagnostics.clear();dirty=true;},
    report(){return {backend:'canvas2d',nodes:nodes.length,assets:[...assets].map(([id,e])=>({id,state:e.state})),diagnostics:[...diagnostics.values()],fontFamily,limitations:['System font fallback depends on device; load a licensed font with loadCanvasFont for reproducible CJK coverage.','Rectangular hit testing, not per-pixel alpha. No scrolling/editable input/shaping parity guarantee with native.']};},
    dispose(){router.releaseAll();disposed=true;generation++;for(const e of assets.values())e.image?.close?.();assets.clear();},
  };
}
