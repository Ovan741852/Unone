// Shared transport checks and conservative paint bounds for official UI hosts.
function invalidShadow(){throw Error('UI_TEXT_SHADOW_INVALID: finite offsets -100..100 viewport-height units and four RGBA values 0..1 required');}
export function validateTextShadow(shadow){
 if(shadow===undefined)return null;
 if(!shadow||typeof shadow!=='object'||Array.isArray(shadow)
  ||Object.keys(shadow).some(k=>!['offset_x','offset_y','color'].includes(k))
  ||[shadow.offset_x,shadow.offset_y].some(v=>!Number.isFinite(v)||v < -100||v > 100)
  ||!Array.isArray(shadow.color)||shadow.color.length!==4)invalidShadow();
 for(let i=0;i<4;i++)if(!Number.isFinite(shadow.color[i])||shadow.color[i]<0||shadow.color[i]>1)invalidShadow();
 return shadow;
}
export function textPaintBounds(style,bounds){
 const shadow=validateTextShadow(style?.text_shadow);if(!shadow)return bounds;
 const dx=shadow.offset_x*bounds.viewportHeight/100,dy=shadow.offset_y*bounds.viewportHeight/100;
 return {...bounds,x:bounds.x+Math.min(0,dx),y:bounds.y+Math.min(0,dy),
  width:bounds.width+Math.abs(dx),height:bounds.height+Math.abs(dy)};
}
export function validateInputRegion(node){
 const allowed=['kind','id','rect','action','clip','scrollOwner','virtualKey','virtualIndex','virtualCount'];
 if(Object.keys(node).some(k=>!allowed.includes(k))||typeof node.action!=='string'||!node.action.trim())
  throw Error(`UI_INPUT_REGION_FIELDS: ${node.id}; action and placement only, no visual fields`);
}
