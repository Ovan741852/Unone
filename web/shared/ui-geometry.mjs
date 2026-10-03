import {UI_CONTRACT} from './ui-contract.mjs';
export {UI_CONTRACT};

export function uiBudget(tree) {
 const b=tree?.budget;
 const max=b===undefined?UI_CONTRACT.default_max_nodes:b?.max_nodes;
 if((b!==undefined && (!b || Object.keys(b).some(k=>k!=='max_nodes'))) || !Number.isSafeInteger(max)||max<1||max>UI_CONTRACT.host_max_nodes)
  throw Error(`UI_BUDGET_INVALID: requested=${max}, host_max_nodes=${UI_CONTRACT.host_max_nodes}; set budget.max_nodes within 1..host_max_nodes`);
 return max;
}
export function uiUsage(tree){
 const max=uiBudget(tree),out={logical_nodes:0,leaf_nodes:0,render_regions_upper_bound:0,max_nodes:max,host_max_nodes:UI_CONTRACT.host_max_nodes,limit_source:tree?.budget?'screen.budget':'contract.default',subtrees:[]};
 let bytes=0;const encoder=new TextEncoder();
 for(const v of Object.values(tree??{}))if(typeof v==='string')bytes+=encoder.encode(v).length;
 if(bytes>UI_CONTRACT.max_string_bytes)throw Error(`UI_STRING_LIMIT: root; used=${bytes}, limit=${UI_CONTRACT.max_string_bytes}`);
 function visit(n,path,depth){
  if(!n||typeof n!=='object')throw Error(`UI_NODE_INVALID: ${path}`);
  if(++out.logical_nodes>max)throw Error(`UI_NODE_LIMIT: path=${path}, node=${n.id}, used=${out.logical_nodes}, limit=${max}, host_max_nodes=${UI_CONTRACT.host_max_nodes}; raise screen.budget.max_nodes within the host limit or use one image with slice`);
  if(depth>UI_CONTRACT.max_component_depth+1||(n.kind==='component'&&depth>UI_CONTRACT.max_component_depth))throw Error(`UI_DEPTH_LIMIT: ${path}; maximum ${UI_CONTRACT.max_component_depth} component wrappers`);
  for(const v of Object.values(n))if(typeof v==='string')bytes+=encoder.encode(v).length;
  if(bytes>UI_CONTRACT.max_string_bytes)throw Error(`UI_STRING_LIMIT: ${path}; used=${bytes}, limit=${UI_CONTRACT.max_string_bytes}`);
  const before=out.logical_nodes;
  if(n.kind==='component'||n.kind==='scroll_view')for(const [i,c]of (n.children??[]).entries())visit(c,`${path}.children[${i}]`,depth+1);
  else{out.leaf_nodes++;out.render_regions_upper_bound+=n.slice?9:1;}
  return out.logical_nodes-before+1;
 }
 for(const [i,n]of (tree?.children??[]).entries())out.subtrees.push([n.id,visit(n,`root.children[${i}]`,1)]);
 return out;
}
export function validateSlice(slice){
 if(!slice||typeof slice!=='object'||Object.keys(slice).some(k=>!['left','top','right','bottom','pixels_per_unit','source'].includes(k))||['left','top','right','bottom'].some(k=>!Number.isFinite(slice[k])||slice[k]<0)||!Number.isFinite(slice.pixels_per_unit)||slice.pixels_per_unit<=0)
  throw Error('UI_SLICE_INVALID: borders must be finite non-negative source pixels; pixels_per_unit must be positive');
 const s=slice.source;
 if(s!==undefined && (!s||Object.keys(s).some(k=>!['x','y','width','height'].includes(k))||['x','y','width','height'].some(k=>!Number.isFinite(s[k]))||s.x<0||s.y<0||s.width<=slice.left+slice.right||s.height<=slice.top+slice.bottom))throw Error('UI_SLICE_SOURCE_INVALID: source must be a positive pixel rectangle with room between its borders');
}
// Same contract and edge-case vectors as UiSlice::patches. All rects y-down.
export function slicePatches(slice,iw,ih,w,h,vh){
 validateSlice(slice);
 if([iw,ih,w,h,vh].some(v=>!Number.isFinite(v)||v<=0))throw Error('UI_SLICE_SIZE_INVALID: positive finite pixel dimensions required');
 const {left:l,top:t,right:r,bottom:b,pixels_per_unit:ppu}=slice;
 const s=slice.source??{x:0,y:0,width:iw,height:ih};
 if(s.x+s.width>iw||s.y+s.height>ih||l+r>=s.width||t+b>=s.height)throw Error(`UI_SLICE_BOUNDS: source/borders exceed image ${iw}x${ih}; correct slice source pixels, do not stretch the whole image`);
 const requestedScale=vh/100/ppu;if(!Number.isFinite(requestedScale))throw Error('UI_SLICE_SIZE_INVALID: pixels_per_unit is too small for this viewport');
 const scale=Math.min(requestedScale,l+r?w/(l+r):Infinity,t+b?h/(t+b):Infinity);
 const sx=[s.x,s.x+l,s.x+s.width-r,s.x+s.width],sy=[s.y,s.y+t,s.y+s.height-b,s.y+s.height];
 const dx=[0,l*scale,w-r*scale,w],dy=[0,t*scale,h-b*scale,h],out=[];
 for(let y=0;y<3;y++)for(let x=0;x<3;x++){
  const source={x:sx[x],y:sy[y],width:sx[x+1]-sx[x],height:sy[y+1]-sy[y]},dest={x:dx[x],y:dy[y],width:Math.max(0,dx[x+1]-dx[x]),height:Math.max(0,dy[y+1]-dy[y])};
  if(source.width>0&&source.height>0&&dest.width>0&&dest.height>0)out.push([source,dest]);
 }
 return out;
}
