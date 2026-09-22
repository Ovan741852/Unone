// The developer host and exported player use the same UI projection. A host
// may provide resolveAsset(assetId), returning a URL or a promise for one;
// Core only transports the stable asset id and never performs IO.
import {uiUsage,slicePatches} from './ui-geometry.mjs';
export function createUiTree(layer, { resolveAsset = null } = {}) {
  let previous = null;
  let renderGeneration = 0;
  let sliceCleanups=[];

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

    const element = document.createElement(node.kind === "button" ? "button" : node.kind === "image" ? (node.slice ? "canvas" : "img") : "div");
    place(element, node);
    if (node.kind === "image") {
      element.alt = node.alt ?? node.id;
      element.decoding = "async";
      element.draggable = false;
      element.style.objectFit = node.fit ?? "contain";
      element.dataset.asset = node.asset;
      if(node.slice){element.setAttribute('role','img');element.setAttribute('aria-label',node.alt??node.id);}
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
            if(!node.slice){element.src=url;return;}
            const img=new Image();let observer;
            const draw=()=>{
              if(generation!==renderGeneration||!element.isConnected||!img.complete||!img.naturalWidth)return;
              const viewportHeight=layer.clientHeight,viewportWidth=layer.clientWidth,dpr=globalThis.devicePixelRatio??1;
              const w=node.rect.width*viewportWidth/100,h=node.rect.height*viewportHeight/100;
              if(w<=0||h<=0)return;
              element.width=Math.min(8192,Math.max(1,Math.round(w*dpr)));element.height=Math.min(8192,Math.max(1,Math.round(h*dpr)));
              const ctx=element.getContext('2d');
              try{
                if(node.fit&&node.fit!=='stretch')throw Error('UI_SLICE_FIT_CONFLICT: omit fit or use stretch');
                ctx.setTransform(element.width/w,0,0,element.height/h,0,0);
                for(const [s,d]of slicePatches(node.slice,img.naturalWidth,img.naturalHeight,w,h,viewportHeight))ctx.drawImage(img,s.x,s.y,s.width,s.height,d.x,d.y,d.width,d.height);
                delete element.dataset.assetError;
              }catch(e){element.dataset.assetError=e.message;}
            };
            img.onload=draw;img.onerror=()=>{if(generation===renderGeneration)element.dataset.assetError=`UI_IMAGE_LOAD_FAILED: ${node.asset}`;};img.src=url;
            if(typeof ResizeObserver!=='undefined'){observer=new ResizeObserver(draw);observer.observe(layer);}
            sliceCleanups.push(()=>{observer?.disconnect();img.onload=null;img.onerror=null;});
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
