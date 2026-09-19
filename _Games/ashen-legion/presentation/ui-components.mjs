// Shared game UI skin contract. Atlas regions and content padding are separate.
// Source borders follow the artwork, never a percentage of the destination.
export const slices=['tl','t','tr','l','c','r','bl','b','br'];
export const skins={
 'control-quiet-v3':{borders:[80,80,80,80],trim:true,scale:.12},
 'shop-window-panel-v2':{borders:[360,540,360,360],scale:.20},
 'shop-card-rare-v2':{borders:[210,360,210,360],scale:'width'},
 'shop-card-epic-v2':{borders:[210,360,210,360],scale:'width'},
 'shop-card-legendary-v2':{borders:[210,360,210,360],scale:'width'},
 'shop-button-primary-v2':{borders:[300,100,300,100],trim:true,scale:'height'},
 'shop-button-secondary-v2':{borders:[300,100,300,100],trim:true,scale:'height'},
};

// Nine cells are one component. All corners retain the source aspect ratio;
// only center/edge axes stretch. The same code serves windows and buttons.
export function fitNineSlice(nodes,source,viewport,metadata){
 const parts=slices.map(p=>nodes.get(source+'_'+p));
 if(parts.some(p=>!p))return;
 const key=parts[0].asset.replace('texture://ui_','').replace(/-tl$/,'');
 const spec=skins[key],data=metadata[key];if(!spec||!data)return;
 const r=parts.map(p=>p.rect),x=Math.min(...r.map(q=>q.x)),y=Math.min(...r.map(q=>q.y));
 const w=Math.max(...r.map(q=>q.x+q.width))-x,h=Math.max(...r.map(q=>q.y+q.height))-y;
 const [vw,vh]=viewport,pw=w*vw/100,ph=h*vh/100;
 const scale=spec.scale==='height'?ph/data.height:spec.scale==='width'?pw/data.width:spec.scale*Math.min(vw/1440,vh/900);
 const [sl,st,sr,sb]=spec.borders;
 const s=Math.min(scale,pw/(sl+sr+1),ph/(st+sb+1));
 const l=sl*s/vw*100,t=st*s/vh*100,rr=sr*s/vw*100,b=sb*s/vh*100;
 const xs=[x,x+l,x+w-rr,x+w],ys=[y+h,y+h-t,y+b,y];
 parts.forEach((n,i)=>{const row=Math.floor(i/3),col=i%3;nodes.set(n.id,{...n,rect:{x:xs[col],y:ys[row+1],width:xs[col+1]-xs[col],height:ys[row]-ys[row+1]}});});
}

let measureContext;
export function fitLabel(value,{width,height,size,minSize=8,maxLines=Infinity,wrap=false}){
 // This must use the same family as the official Canvas UI, not character counts.
 measureContext??=document.createElement('canvas').getContext('2d');
 const ctx=measureContext;let lines=[];
 const measure=s=>ctx.measureText(s).width;
 const breakLines=font=>{
  ctx.font=`${font}px "Microsoft JhengHei",sans-serif`;
  const result=[];
  for(const paragraph of String(value).split('\n')){
   if(!wrap){result.push(paragraph);continue;}
   const tokens=[];
   for(const token of paragraph.match(/[A-Za-z0-9][A-Za-z0-9.%+-]*|./gu)??[]){if(/^[，。；、！？：）]$/.test(token)&&tokens.length)tokens[tokens.length-1]+=token;else tokens.push(token);}
   let line='';for(const token of tokens){if(line&&measure(line+token)>width){result.push(line);line='';}line+=token;}result.push(line);
  }
  return result;
 };
 size=Math.max(size,minSize);
 for(;;size=Math.max(minSize,size-.25)){lines=breakLines(size);const count=Math.min(lines.length,maxLines);if(size===minSize||Math.max(...lines.map(measure),1)<=width&&size*Math.max(count*1.2,1/.72)<=height)break;}
 // Single-line names may elide, but never squeeze below the readability floor.
 if(maxLines===1&&lines.length===1&&measure(lines[0])>width){let last=lines[0];while(last&&measure(last+'…')>width)last=last.slice(0,-1);lines=[last+'…'];}
 if(lines.length>maxLines){lines=lines.slice(0,maxLines);let last=lines.at(-1);while(last&&measure(last+'…')>width)last=last.slice(0,-1);lines[lines.length-1]=last+'…';}
 return {text:lines.join('\n'),width:Math.max(...lines.map(measure),1),height:size*Math.max(lines.length*1.2,1/.72),fontSize:size};
}
