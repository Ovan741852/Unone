// The developer host and exported player use the same UI projection. A host
// may provide resolveAsset(assetId), returning a URL or a promise for one;
// Core only transports the stable asset id and never performs IO.
import {uiUsage} from './ui-geometry.mjs';
import {paintUiBox,paintUiText,paintUiImage,clipUiBox,createUiOpacityPainter} from './ui-style.mjs';
export function createUiTree(layer, { resolveAsset = null } = {}) {
  let previous = null;
  let renderGeneration = 0;
  let sliceCleanups=[];

  // Styled leaves share the official measured Canvas text implementation. DOM
  // remains the semantic/accessibility wrapper in this legacy host.
  function styledLeaf(element,node,generation){
    if(node.kind==='image')return;
    element.textContent='';element.setAttribute('aria-label',node.text??node.id);
    Object.assign(element.style,{padding:'0',border:'0',background:'transparent',overflow:'hidden'});
    const canvas=document.createElement('canvas');canvas.setAttribute('aria-hidden','true');Object.assign(canvas.style,{position:'absolute',inset:'0',width:'100%',height:'100%',pointerEvents:'none',border:'0',borderRadius:'0',background:'transparent',aspectRatio:'auto'});element.appendChild(canvas);
    const opacityPainter=createUiOpacityPainter(()=>document.createElement('canvas'));
    const draw=()=>{
      if(generation!==renderGeneration||!element.isConnected)return;
      const height=layer.clientHeight,width=layer.clientWidth,w=node.rect.width*width/100,h=node.rect.height*height/100,dpr=globalThis.devicePixelRatio??1;
      if(w<=0||h<=0)return;canvas.width=Math.min(8192,Math.max(1,Math.round(w*dpr)));canvas.height=Math.min(8192,Math.max(1,Math.round(h*dpr)));
      const ctx=canvas.getContext('2d');
      opacityPainter.paint(ctx,node.style.opacity??1,{x:0,y:0,width:canvas.width,height:canvas.height},target=>{
        target.save();
        try{target.setTransform(canvas.width/w,0,0,canvas.height/h,0,0);clipUiBox(target,node.style,0,0,w,h,height/100);
          paintUiBox(target,node.style,0,0,w,h,height/100,'background');
          if(node.kind!=='panel')paintUiText(target,node,{x:0,y:0,width:w,height:h,viewportHeight:height});
          paintUiBox(target,node.style,0,0,w,h,height/100,'border');
        }finally{target.restore();}
      });
    };
    let observer;if(typeof ResizeObserver!=='undefined'){observer=new ResizeObserver(draw);observer.observe(layer);}
    sliceCleanups.push(()=>{observer?.disconnect();opacityPainter.dispose();});queueMicrotask(draw);
    if(document.fonts?.ready)document.fonts.ready.then(draw);
  }

  function place(element, node) {
    element.className = `unone-ui-node unone-ui-${node.kind}`;
    element.dataset.nodeId = node.id;
    Object.assign(element.style, {
      left: `${node.rect.x}%`,
      bottom: `${node.rect.y}%`,
      width: `${node.rect.width}%`,
      height: `${node.rect.height}%`,
    });
  }

  function appendNode(node, parent, generation) {
    if (node.kind === 'scroll_view') throw Error('UI_HOST_CAPABILITY_UNSUPPORTED: scroll_view requires the Canvas scroll host, not the legacy DOM renderer');
    if (node.kind === "component") {
      const group = document.createElement("div");
      group.className = "unone-ui-component";
      group.dataset.nodeId = node.id;
      group.dataset.component = node.component;
      // A component is a semantic reusable wrapper. Its children keep the
      // Core screen design space, so display:contents avoids a second layout
      // transform while preserving the source identity for inspection.
      group.style.display = "contents";
      parent.appendChild(group);
      for (const child of node.children ?? []) appendNode(child, group, generation);
      return;
    }

    const canvasImage=node.kind==='image'&&(node.slice||node.style);
    const element = document.createElement(node.kind === "button" ? "button" : node.kind === "image" ? (canvasImage ? "canvas" : "img") : "div");
    place(element, node);
    if (node.kind === "image") {
      element.alt = node.alt ?? node.id;
      element.decoding = "async";
      element.draggable = false;
      element.style.objectFit = node.fit ?? "contain";
      element.dataset.asset = node.asset;
      if(canvasImage){element.setAttribute('role','img');element.setAttribute('aria-label',node.alt??node.id);Object.assign(element.style,{border:'0',borderRadius:'0',background:'transparent',aspectRatio:'auto'});}
      if (resolveAsset) {
        let resolved;
        try {
          resolved = resolveAsset(node.asset);
        } catch (error) {
          element.dataset.assetError = error?.message ?? String(error);
          previous = null;
          resolved = null;
        }
        if (resolved !== null) {
          Promise.resolve(resolved).then((url) => {
            if (generation !== renderGeneration || !url || !element.isConnected)return;
            if(!canvasImage){element.src=url;return;}
            const img=new Image(),opacityPainter=createUiOpacityPainter(()=>document.createElement('canvas'));let observer;
            const draw=()=>{
              if(generation!==renderGeneration||!element.isConnected||!img.complete||!img.naturalWidth)return;
              const viewportHeight=layer.clientHeight,viewportWidth=layer.clientWidth,dpr=globalThis.devicePixelRatio??1;
              const w=node.rect.width*viewportWidth/100,h=node.rect.height*viewportHeight/100;
              if(w<=0||h<=0)return;
              element.width=Math.min(8192,Math.max(1,Math.round(w*dpr)));element.height=Math.min(8192,Math.max(1,Math.round(h*dpr)));
              const ctx=element.getContext('2d');
              try{
                opacityPainter.paint(ctx,node.style?.opacity??1,{x:0,y:0,width:element.width,height:element.height},target=>{
                  target.save();try{target.setTransform(element.width/w,0,0,element.height/h,0,0);
                    if(node.style){clipUiBox(target,node.style,0,0,w,h,viewportHeight/100);paintUiBox(target,node.style,0,0,w,h,viewportHeight/100,'background');}
                    paintUiImage(target,node,img,{x:0,y:0,width:w,height:h,viewportHeight});
                    if(node.style)paintUiBox(target,node.style,0,0,w,h,viewportHeight/100,'border');
                  }finally{target.restore();}
                });
                delete element.dataset.assetError;
              }catch(e){element.dataset.assetError=e.message;}
            };
            img.onload=draw;img.onerror=()=>{if(generation===renderGeneration)element.dataset.assetError=`UI_IMAGE_LOAD_FAILED: ${node.asset}`;};img.src=url;
            if(typeof ResizeObserver!=='undefined'){observer=new ResizeObserver(draw);observer.observe(layer);}
            sliceCleanups.push(()=>{observer?.disconnect();img.onload=null;img.onerror=null;opacityPainter.dispose();});
          }).catch((error) => {
            if (generation === renderGeneration && element.isConnected) {
              element.dataset.assetError = error?.message ?? String(error);
              previous = null;
            }
          });
        }
      }
    } else {
      element.textContent = node.text ?? "";
    }
    if (node.kind === "button") element.dataset.action = node.action;
    parent.appendChild(element);
    if(node.style)styledLeaf(element,node,generation);
  }

  return (snapshot) => {
    const ui = (snapshot.world ?? snapshot)?.ui ?? null;
    const serialized = JSON.stringify(ui);
    if (serialized === previous) return;
    uiUsage(ui);
    previous = serialized;for(const cleanup of sliceCleanups)cleanup();sliceCleanups=[];layer.replaceChildren();
    const generation = ++renderGeneration;
    for (const node of ui?.children ?? []) appendNode(node, layer, generation);
  };
}
