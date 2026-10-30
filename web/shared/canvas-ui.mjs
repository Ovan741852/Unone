// Official non-DOM UI projection. DOM is used only for the canvas/font host;
// game controls, hit testing and visual layering are not DOM elements.
import {uiUsage} from './ui-geometry.mjs';
import {projectScrollTree,uiProjectionGeneration} from './ui-scroll.mjs';
import {uiTreeGeneration} from './ui-tree-publication.mjs';
import {createImageBatchResolver,imageBatchCanvasTransform,imageBatchSnappedRect} from './ui-image-batch.mjs';
import {DRAW_COMPLETED,DRAW_SKIPPED} from './player-completion.mjs';
import {textPaintBounds,validateInputRegion,validateTextShadow} from './ui-presentation.mjs';
import {paintUiBox,paintUiText,paintUiImage,clipUiBox,createUiOpacityPainter,presentationFontFaces,layoutUiText,measureUiText} from './ui-style.mjs';
const actionNode=n=>n.kind==='button'||n.kind==='combobox'||n.kind==='input_region';
const dragNode=n=>n.kind==='slider'&&n.drag;
const inputNode=n=>actionNode(n)||dragNode(n)||n.kind==='text_input';
const inside=(r,x,y)=>x>=r.x&&y>=r.y&&x<r.x+r.width&&y<r.y+r.height;
const hit=(n,x,y)=>inside(dragNode(n)?n.drag.hit_rect:n.rect,x,y)&&(!n.clip||inside(n.clip,x,y));
const dragSignature=n=>JSON.stringify([n.rect,n.drag,n.clip,n.action]);
const sliderRatio=(drag,x,y)=>{
  const r=drag.track_rect,value=drag.axis==='vertical'?(y-r.y)/r.height:(x-r.x)/r.width;
  const ratio=Math.max(0,Math.min(1,value));return drag.reverse?1-ratio:ratio;
};
function prepareUi(tree,imageBatches,resolver=createImageBatchResolver()){
  const usage=uiUsage(tree,{imageBatches,imageBatchResolver:resolver});
  const leaves=[];
  function walk(nodes,depth){
    for(const n of nodes??[]){
      if(n.kind==='component'){walk(n.children,depth+1);continue;}
      if(!['text','button','image','image_batch','slider','combobox','panel','text_input','input_region'].includes(n.kind))throw Error(`UI_NODE_UNSUPPORTED: ${n.kind}`);
      if(n.kind==='input_region')validateInputRegion(n);
      validateTextShadow(n.style?.text_shadow);
      if(n.style?.text_shadow&&['image','panel','text_input'].includes(n.kind))throw Error(`UI_TEXT_SHADOW_KIND: ${n.id}; nonediting text required`);
      if(n.kind==='text_input'&&(typeof n.text!=='string'||(n.placeholder!==undefined&&typeof n.placeholder!=='string')
        ||(n.max_length!==undefined&&(!Number.isInteger(n.max_length)||n.max_length<1||n.max_length>16384))
        ||['focused','enabled'].some(k=>n[k]!==undefined&&typeof n[k]!=='boolean')))throw Error(`UI_TEXT_INPUT_INVALID: ${n.id}`);
      if(!n.rect||!['x','y','width','height'].every(k=>Number.isFinite(n.rect[k]))||n.rect.width<=0||n.rect.height<=0)throw Error(`UI_RECT_INVALID: ${n.id}`);
      if(n.clip&&(!['x','y','width','height'].every(k=>Number.isFinite(n.clip[k]))||n.clip.width<=0||n.clip.height<=0))throw Error(`UI_CLIP_INVALID: ${n.id}`);
      if(n.drag&&(n.kind!=='slider'||!['horizontal','vertical'].includes(n.drag.axis??'horizontal')||typeof(n.drag.reverse??false)!=='boolean'||typeof(n.drag.enabled??true)!=='boolean'||['track_rect','hit_rect'].some(key=>{const r=n.drag[key];return !r||!['x','y','width','height'].every(k=>Number.isFinite(r[k]))||r.width<=0||r.height<=0;})))throw Error(`UI_SLIDER_DRAG_INVALID: ${n.id}`);
      leaves.push(n);
    }
  }
  walk(projectScrollTree(tree).tree?.children,0);const batches=new Map();
  for(const node of leaves)if(node.kind==='image_batch')batches.set(node,resolver.resolve(node,imageBatches));
  return {nodes:leaves,usage,batches};
}
export function flattenUi(tree,imageBatches){return prepareUi(tree,imageBatches).nodes;}
function pointerRouter({onAction=()=>{},onSlider=()=>{}}={}){
  let nodes=[],disposed=false;const captured=new Map(),holds=new Map(),sliderOwners=new Map(),released=new Set();
  function release(id,phase){const c=captured.get(id);if(!c)return false;captured.delete(id);
    if(c.drag){sliderOwners.delete(c.id);onSlider({id:c.id,phase:phase==='up'?'end':'cancel',ratio:c.ratio});}
    if(c.action){const count=(holds.get(c.action)??1)-1;if(count>0)holds.set(c.action,count);else{holds.delete(c.action);onAction({action:c.action,phase,nodeId:c.id,pointerId:id});}}return true;}
  function setNodes(next){if(disposed)throw Error('UI_DISPOSED');nodes=next;for(const [pointer,c]of captured){const n=nodes.find(n=>n.id===c.id);
    if(c.drag?(!dragNode(n??{})||n.drag.enabled===false||dragSignature(n)!==c.signature):c.action&&(!n||!actionNode(n)||n.action!==c.action)){release(pointer,'cancel');captured.set(pointer,{id:c.id,action:null});}}}
  function findNode(x,y,interactive){for(let i=nodes.length-1;i>=0;i--){const n=nodes[i];if((interactive?inputNode(n):!['panel','image_batch'].includes(n.kind))&&hit(n,x,y))return n;}return null;}
  const api={
    setTree(tree,imageBatches){setNodes(flattenUi(tree,imageBatches));},
    pointer({kind,pointerId=0,x,y}){
      if(disposed)return false;
      if(released.has(pointerId)){if(kind==='down')released.delete(pointerId);else{if(kind==='up'||kind==='cancel')released.delete(pointerId);return true;}}
      const c=captured.get(pointerId);
      if(c?.drag&&(kind==='move'||kind==='up')&&Number.isFinite(x)&&Number.isFinite(y)){
        c.ratio=sliderRatio(c.drag,x,y);if(kind==='move')onSlider({id:c.id,phase:'drag',ratio:c.ratio});
      }
      if(kind==='cancel'||kind==='up'){const owned=release(pointerId,kind);if(owned&&kind==='cancel')released.add(pointerId);return owned;}
      if(c)return true;
      if(kind!=='down')return false;
      const node=findNode(x,y,true);
      // Old slider leaves remain passthrough. Official model sliders declare
      // drag geometry, own the complete stream, and never send world pointers.
      // Decorative leaves do not obscure semantic controls underneath them.
      if(!node)return false;
      if(dragNode(node)){
        if(node.drag.enabled===false||sliderOwners.has(node.id)){captured.set(pointerId,{id:node.id,action:null});return true;}
        const ratio=sliderRatio(node.drag,x,y);captured.set(pointerId,{id:node.id,drag:node.drag,ratio,signature:dragSignature(node)});sliderOwners.set(node.id,pointerId);
        onSlider({id:node.id,phase:'start',ratio});return true;
      }
      const action=actionNode(node)?node.action:null;captured.set(pointerId,{id:node.id,action});
      if(action){const count=holds.get(action)??0;holds.set(action,count+1);if(!count)onAction({action,phase:'down',nodeId:node.id,pointerId});}
      return true;
    },
    releaseAll(){for(const id of [...captured.keys()]){release(id,'cancel');released.add(id);}},
    hitTest(x,y){const n=findNode(x,y,true)??findNode(x,y,false);return n?{nodeId:n.id,action:actionNode(n)?n.action:null,...(dragNode(n)?{kind:'slider',sliderDrag:true}:n.kind==='text_input'?{kind:'text_input'}:{})}:null;},
    get capturedPointers(){return [...captured.keys()];},
    dispose(){if(disposed)return;api.releaseAll();disposed=true;nodes=[];captured.clear();holds.clear();sliderOwners.clear();released.clear();},
  };
  // Prepared leaves are passed only within this module, never cached by caller
  // tree identity. Public setTree still validates and projects every call.
  return {api,setNodes};
}
export function createUiPointerRouter(options={}){return pointerRouter(options).api;}
function imageLoad(url){return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(Error(`UI_IMAGE_LOAD_FAILED: ${url}`));image.src=url;});}
export async function loadCanvasFont(family,url,weight=400){
  try{const font=new FontFace(family,`url(${JSON.stringify(String(url))})`,{weight:String(weight)});await font.load();document.fonts.add(font);return font;}
  catch(error){throw Error(`UI_FONT_LOAD_FAILED: ${family} ${weight}: ${String(error?.message??error)}`);}
}
export async function loadPresentationFonts(ui={},resolveSource=source=>source){
  const loaded=[];
  try{for(const face of presentationFontFaces(ui))loaded.push(await loadCanvasFont(face.family,resolveSource(face.source),face.weight));return loaded;}
  catch(error){for(const font of loaded)document.fonts.delete(font);throw error;}
}
export function createCanvasUi(canvas,{resolveAsset,loadImage=imageLoad,onAction,onSlider,onDiagnostic=()=>{},requestRender=()=>{},fontFamily='sans-serif',textColor='#ffffff',createSurface=()=>canvas.ownerDocument?.createElement('canvas')??new OffscreenCanvas(1,1),getImageBatchPresenter=()=>null}={}){
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('UI_CANVAS_2D_UNAVAILABLE');
  const opacityPainter=createUiOpacityPainter(createSurface);
  const routing=pointerRouter({onAction,onSlider}),router=routing.api,assets=new Map(),batchResolver=createImageBatchResolver(),prefixContext={width:0,height:0,images:assets};
  const readyWaiters=new Set();let requiredAssets=new Set();
  let previous=null,paintKey=null,paintDefinitions=[],dirty=true,disposed=false,nodes=[],generation=0,batches=new Map(),prefix=[],references=[],gpuPrefix=0,loadingAssets=0;
  const diagnostics=new Map(),quadDiagnosticKeys=new Map();let usage=null,renderMs=null,renderRegions=0;
  const reportError=(id,error)=>{const value={code:'UI_ASSET_FAILED',asset:id,message:String(error?.message??error)};diagnostics.set(id,value);onDiagnostic(value);};
  const retireGpu=()=>getImageBatchPresenter()?.clear();
  const outcome=()=>diagnostics.size?DRAW_SKIPPED.ui_diagnostics:loadingAssets?DRAW_SKIPPED.ui_assets_pending:DRAW_COMPLETED;
  function notifyReady(){if(!readyWaiters.size)return;for(const check of [...readyWaiters])check();}
  function ready(){
    if(disposed)return Promise.reject(Error('UI_DISPOSED'));
    for(const id of requiredAssets)ensureAsset(id);
    return new Promise((resolve,reject)=>{const check=()=>{
      let error;if(disposed)error=Error('UI_DISPOSED');else if(diagnostics.size){const first=diagnostics.values().next().value;error=Error(`${first.code}: ${first.node??first.asset??'ui'}; ${first.message}`);}
      if(error){readyWaiters.delete(check);reject(error);}else if(!loadingAssets){readyWaiters.delete(check);resolve();}
    };readyWaiters.add(check);check();});
  }
  function ensureAsset(id){if(assets.has(id))return assets.get(id);
    const entry={image:null,state:'loading'};assets.set(id,entry);loadingAssets++;const ticket=generation;
    Promise.resolve().then(()=>{if(!resolveAsset)throw Error('UI_ASSET_RESOLVER_REQUIRED');return resolveAsset(id);}).then(value=>typeof value==='string'||value instanceof URL?loadImage(value):value)
      .then(image=>{if(disposed||ticket!==generation||assets.get(id)!==entry){image?.close?.();return;}if(!image||!(image.naturalWidth??image.width))throw Error('UI_IMAGE_INVALID');entry.image=image;entry.state='ready';loadingAssets--;dirty=true;try{requestRender();}finally{notifyReady();}})
      .catch(error=>{if(!disposed&&ticket===generation&&assets.get(id)===entry){if(entry.state==='loading')loadingAssets--;entry.state='failed';try{reportError(id,error);dirty=true;requestRender();}finally{notifyReady();}}});
    return entry;
  }
  function image(node,x,y,w,h,target=ctx,quadIndex=null){const e=ensureAsset(node.asset);if(!e.image)return;
    let key=quadIndex===null?node.id:quadDiagnosticKeys.get(node.id)?.get(quadIndex);
    try {
      renderRegions+=paintUiImage(target,node,e.image,{x,y,width:w,height:h,viewportHeight:canvas.height});
      if(key!==undefined)diagnostics.delete(key);
    }catch(error){const original=String(error.message).split(':')[0],code=quadIndex!==null&&original==='UI_SLICE_BOUNDS'?'UI_IMAGE_BATCH_SOURCE_BOUNDS':original;
      if(key===undefined){let keys=quadDiagnosticKeys.get(node.id);if(!keys){keys=new Map();quadDiagnosticKeys.set(node.id,keys);}key=Symbol();keys.set(quadIndex,key);}
      const value={code,node:node.id,asset:node.asset,message:error.message,...(quadIndex!==null?{quad:quadIndex}:{})};diagnostics.set(key,value);onDiagnostic(value);}
  }
  function imageBatch(node){
    const instance=batches.get(node);ctx.save();
    try{
    if(instance.retained||instance.pixelSnap){const r=instance.clip;ctx.beginPath();ctx.rect(r.x*canvas.width/100,(100-r.y-r.height)*canvas.height/100,r.width*canvas.width/100,r.height*canvas.height/100);ctx.clip();
      if(!instance.pixelSnap)ctx.transform(...imageBatchCanvasTransform(instance.transform,canvas.width,canvas.height,instance.definition.originX,instance.definition.originY));}
    for(const [index,q]of instance.definition.quads.entries()){
      const r=q.rect,leaf={id:node.id,asset:q.asset,fit:'stretch',...(q.source?{slice:{left:0,top:0,right:0,bottom:0,pixels_per_unit:1,source:q.source}}:{})};
      ctx.save();
      try{ctx.globalAlpha=(ctx.globalAlpha??1)*(q.opacity??1);if(instance.pixelSnap){const snapped=imageBatchSnappedRect(instance,r,canvas.width,canvas.height);if(!snapped.width||!snapped.height)continue;
          ctx.transform(Math.sign(snapped.width),0,0,Math.sign(snapped.height),snapped.x,snapped.y);image(leaf,0,0,Math.abs(snapped.width),Math.abs(snapped.height),ctx,index);}
        else if(instance.retained)image(leaf,r.x-instance.definition.originX,-(r.y-instance.definition.originY)-r.height,r.width,r.height,ctx,index);
        else image(leaf,r.x*canvas.width/100,(100-r.y-r.height)*canvas.height/100,r.width*canvas.width/100,r.height*canvas.height/100,ctx,index);}
      finally{ctx.restore();}
    }
    }finally{ctx.restore();}
  }
  function text(node,x,y,w,h,scale=1){if(!node.text)return;const lines=String(node.text).split('\n');
    const lh=Number.isFinite(node.lineHeight)&&node.lineHeight>0?node.lineHeight:1.2;
    const align=node.align==='start'||node.align==='end'?node.align:'center';
    const pad=align==='center'?0:Math.min(w*0.05,14*scale);
    const requested=Number.isFinite(node.fontSize)&&node.fontSize>0?node.fontSize*scale:Infinity;
    let size=Math.max(1,Math.min(requested,h/(lines.length*lh),h*0.72));
    ctx.save();ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();ctx.fillStyle=textColor;ctx.textAlign=align==='start'?'left':align==='end'?'right':'center';ctx.textBaseline='middle';
    ctx.font=`${size}px ${fontFamily}`;const longest=Math.max(...lines.map(l=>ctx.measureText(l).width),1);size*=Math.min(1,(w-pad*2)/longest);ctx.font=`${size}px ${fontFamily}`;
    const anchorX=align==='start'?x+pad:align==='end'?x+w-pad:x+w/2;
    lines.forEach((line,i)=>ctx.fillText(line,anchorX,y+h/2+(i-(lines.length-1)/2)*size*lh));ctx.restore();
  }
  function textInput(target,node,bounds){
    const empty=node.text.length===0,style={text_align:'start',vertical_align:'middle',wrap:'none',...(node.style??{})};
    const value={...node,text:empty?(node.placeholder??''):node.text,style};
    const layout=layoutUiText(target,value,{...bounds,fontFamily,textColor}),c=layout.content,line=layout.lines[0];
    const editing=node.text_edit,focus=editing?.focused===true;
    const start=Math.max(0,Math.min(node.text.length,editing?.selection_start??node.text.length));
    const end=Math.max(start,Math.min(node.text.length,editing?.selection_end??start));
    target.save();
    try{
      target.beginPath();target.rect(c.x,c.y,c.width,c.height);target.clip();target.font=layout.font;
      const left=measureUiText(target,node.text.slice(0,start),layout.spacing),right=measureUiText(target,node.text.slice(0,end),layout.spacing);
      const scroll=focus?Math.max(0,right-c.width+2):0,x=(line?.x??c.x)-scroll,y=line?.y??c.y+c.height/2;
      if(focus&&end>start){target.fillStyle='rgba(70,119,160,.3)';target.fillRect(x+left,y-layout.size*.6,Math.max(1,right-left),layout.size*1.2);}
      const opacity=target.globalAlpha??1;
      target.fillStyle=layout.color;target.globalAlpha=opacity*(empty?.5:1);target.textAlign='left';target.textBaseline='middle';
      if('letterSpacing'in target)target.letterSpacing=`${layout.spacing}px`;
      target.fillText(value.text,x,y);target.globalAlpha=opacity;
      if(focus&&start===end){target.fillStyle=layout.color;target.fillRect(x+left,y-layout.size*.55,Math.max(1,bounds.viewportHeight/1000),layout.size*1.1);}
      if(focus&&editing.composing){target.fillStyle=layout.color;target.fillRect(x,y+layout.size*.6,Math.max(1,measureUiText(target,node.text,layout.spacing)),1);}
    }finally{target.restore();}
  }
  function boxPhase(target,node,bounds,phase){
    const {x,y,width,height,viewportHeight}=bounds;
    target.save();
    try{
      // Shadow glyph passes own translated clips. The background and border
      // still need their original unshifted leaf clip, independently of glyphs.
      if(node.style.text_shadow)clipUiBox(target,node.style,x,y,width,height,viewportHeight/100);
      paintUiBox(target,node.style,x,y,width,height,viewportHeight/100,phase);
    }finally{target.restore();}
  }
  return {
    draw(snapshot,{width=canvas.clientWidth??canvas.width,height=canvas.clientHeight??canvas.height,dpr=globalThis.devicePixelRatio??1}={}){
      if(disposed)throw Error('UI_DISPOSED');if(![width,height,dpr].every(v=>Number.isFinite(v)&&v>0))return DRAW_SKIPPED.ui_target_unavailable;
      const bw=Math.min(8192,Math.max(1,Math.round(width*dpr))),bh=Math.min(8192,Math.max(1,Math.round(height*dpr)));
      if(canvas.width!==bw||canvas.height!==bh){canvas.width=bw;canvas.height=bh;dirty=true;}
      const world=snapshot?.world??snapshot,tree=world?.ui??null,imageBatches=world?.ui_image_batches,key=uiTreeGeneration(tree)??uiProjectionGeneration(tree)??JSON.stringify(tree),resourceChanged=key===previous&&references.some(r=>batchResolver.resource(r.id,imageBatches)!==r.definition);
      let compositionChanged=false;
      if(key!==previous||resourceChanged){const prepared=prepareUi(tree,imageBatches,batchResolver);usage=prepared.usage;nodes=prepared.nodes;batches=prepared.batches;routing.setNodes(nodes);previous=key;compositionChanged=true;
        references=[];prefix=[];let leading=true;const used=new Set();
        for(const node of nodes){if(node.kind==='image_batch'){const instance=batches.get(node);instance.prefixIndex=leading?prefix.length:-1;if(leading)prefix.push(instance);if(instance.retained)references.push({id:node.content,definition:instance.definition});for(const id of instance.definition.assets)used.add(id);}
          else if(node.kind==='image')used.add(node.asset);if(node.kind!=='input_region'&&node.kind!=='image_batch')leading=false;}
        if([...assets.keys()].some(id=>!used.has(id)))retireGpu();
        for(const [id,e]of assets)if(!used.has(id)){if(e.state==='loading')loadingAssets--;e.image?.close?.();assets.delete(id);diagnostics.delete(id);}
        requiredAssets=used;for(const id of used)ensureAsset(id);batchResolver.prune(nodes);}
      prefixContext.width=bw;prefixContext.height=bh;
      const presenter=getImageBatchPresenter(),presented=presenter?.drawPrefix(prefix,prefixContext)??0;
      if(!Number.isInteger(presented)||presented<0||presented>prefix.length)throw Error('UI_IMAGE_PREFIX_RESULT_INVALID');
      if(presented!==gpuPrefix){gpuPrefix=presented;compositionChanged=true;}
      if(compositionChanged){const paintNodes=nodes.filter(node=>node.kind!=='image_batch'||batches.get(node).prefixIndex<0||batches.get(node).prefixIndex>=gpuPrefix),nextKey=JSON.stringify(paintNodes),definitions=paintNodes.filter(n=>n.kind==='image_batch').map(n=>batches.get(n).definition);
        if(nextKey!==paintKey||definitions.length!==paintDefinitions.length||definitions.some((d,i)=>d!==paintDefinitions[i]))dirty=true;paintKey=nextKey;paintDefinitions=definitions;}
      if(!dirty){notifyReady();return presenter?.completion?.()?.status==='skipped'?DRAW_SKIPPED.ui_target_unavailable:outcome();}dirty=false;const started=performance.now();renderRegions=0;ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,bw,bh);
      for(const [id,d]of diagnostics)if(d.node)diagnostics.delete(id);quadDiagnosticKeys.clear();
      for(const node of nodes){const r=node.rect,x=r.x*bw/100,y=(100-r.y-r.height)*bh/100,w=r.width*bw/100,h=r.height*bh/100;
        if(node.kind==='input_region')continue;
        if(node.kind==='image_batch'&&batches.get(node).prefixIndex>=0&&batches.get(node).prefixIndex<gpuPrefix)continue;
        const paintBounds=textPaintBounds(node.style,{x,y,width:w,height:h,viewportHeight:bh});
        const c=node.clip;
        if(c){const cx=c.x*bw/100,cy=(100-c.y-c.height)*bh/100,cw=c.width*bw/100,ch=c.height*bh/100;
          if(paintBounds.x>=cx+cw||paintBounds.x+paintBounds.width<=cx||paintBounds.y>=cy+ch||paintBounds.y+paintBounds.height<=cy)continue;
          ctx.save();ctx.beginPath();ctx.rect(cx,cy,cw,ch);ctx.clip();}
        try{
          if(node.kind==='image_batch')imageBatch(node);
          else if(node.style){opacityPainter.paint(ctx,node.style.opacity??1,paintBounds,target=>{
            target.save();
            try{
              if(!node.style.text_shadow)clipUiBox(target,node.style,x,y,w,h,bh/100);
              boxPhase(target,node,{x,y,width:w,height:h,viewportHeight:bh},'background');
              if(node.kind==='image')image(node,x,y,w,h,target);
              else {if(node.kind==='text_input')textInput(target,node,{x,y,width:w,height:h,viewportHeight:bh});else if(node.kind!=='panel')paintUiText(target,node,{x,y,width:w,height:h,viewportHeight:bh,fontFamily,textColor});renderRegions+=1+Number(!!node.style.text_shadow);}
              boxPhase(target,node,{x,y,width:w,height:h,viewportHeight:bh},'border');
            }finally{target.restore();}
          });}
          else if(node.kind==='image')image(node,x,y,w,h);
          else if(node.kind==='text_input'){textInput(ctx,node,{x,y,width:w,height:h,viewportHeight:bh});renderRegions++;}
          else if(['panel','slider','combobox'].includes(node.kind)){renderRegions++;}
          else {text(node,x,y,w,h,bw/width);renderRegions++;}
        }finally{if(c)ctx.restore();}}
      renderMs=performance.now()-started;
      notifyReady();
      return presenter?.completion?.()?.status==='skipped'?DRAW_SKIPPED.ui_target_unavailable:outcome();
    },
    pointer:router.pointer,hitTest:router.hitTest,releaseAll:router.releaseAll,ready,
    setFont(family){fontFamily=family;dirty=true;},
    invalidateAssets(){retireGpu();generation++;for(const e of assets.values())e.image?.close?.();assets.clear();loadingAssets=0;diagnostics.clear();quadDiagnosticKeys.clear();dirty=true;for(const id of requiredAssets)ensureAsset(id);notifyReady();},
    report(){return {backend:'canvas2d',nodes:nodes.length,usage,render_regions:renderRegions,cpu_render_ms:renderMs,gpu_render_ms:null,decoded_rgba_bytes_estimate:[...assets.values()].reduce((sum,e)=>sum+(e.image?(e.image.naturalWidth??e.image.width)*(e.image.naturalHeight??e.image.height)*4:0),0),assets:[...assets].map(([id,e])=>({id,state:e.state})),diagnostics:[...diagnostics.values()],fontFamily,limitations:['CPU timing is last redraw only, not GPU time. Decoded RGBA estimate excludes browser/GPU copies.','System font fallback depends on device; package licensed ui.fonts for reproducible family and weight coverage.','Rectangular hit testing, not per-pixel alpha. Text selection/caret uses UTF-16 browser selection offsets; Web/native shaping parity is not guaranteed.']};},
    dispose(){if(disposed)return;retireGpu();router.dispose();disposed=true;generation++;for(const e of assets.values())e.image?.close?.();assets.clear();loadingAssets=0;requiredAssets.clear();diagnostics.clear();quadDiagnosticKeys.clear();nodes=[];batches.clear();prefix=[];references=[];paintDefinitions=[];batchResolver.clear();previous=paintKey=null;usage=null;renderMs=null;renderRegions=0;opacityPainter.dispose();notifyReady();},
  };
}
