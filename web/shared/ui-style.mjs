// Shared official UI typography and box painting. All declared lengths use
// viewport-height design units (1 unit = 1% of the presentation viewport height).
import {slicePatches} from './ui-geometry.mjs';
const segmenter=typeof Intl.Segmenter==='function'?new Intl.Segmenter(undefined,{granularity:'grapheme'}):null;
export const textGraphemes=text=>segmenter?[...segmenter.segment(String(text))].map(v=>v.segment):Array.from(String(text));
export const uiColor=(value,fallback='transparent')=>Array.isArray(value)?`rgba(${value.slice(0,3).map(v=>Math.round(v*255)).join(',')},${value[3]})`:fallback;
const genericFamilies=new Set(['serif','sans-serif','monospace','cursive','fantasy','system-ui','ui-serif','ui-sans-serif','ui-monospace','ui-rounded','emoji','math','fangsong']);
export function uiFont(family,size,weight=400){
  const names=[];let token='',quote=null,escaped=false;
  for(const c of family){
    if(escaped){token+=c;escaped=false;continue;}
    if(c==='\\'){token+=c;escaped=true;continue;}
    if(quote){token+=c;if(c===quote)quote=null;continue;}
    if(c==='"'||c==="'"){quote=c;token+=c;continue;}
    if(c===','){names.push(token);token='';}else token+=c;
  }
  names.push(token);
  const list=names.map(value=>{const name=value.trim();if(genericFamilies.has(name))return name;
    const unquoted=/^(["']).*\1$/u.test(name)?name.slice(1,-1).replace(/\\(["'\\])/gu,'$1'):name;return JSON.stringify(unquoted);}).join(', ');
  return `${weight} ${size}px ${list}`;
}
function roundedPath(ctx,x,y,w,h,r){
  ctx.beginPath();r=Math.max(0,Math.min(r,w/2,h/2));
  if(r&&ctx.roundRect)ctx.roundRect(x,y,w,h,r);else ctx.rect(x,y,w,h);
}
export function clipUiBox(ctx,style,x,y,w,h,unit){roundedPath(ctx,x,y,w,h,(style.border_radius??0)*unit);ctx.clip();}
export function createUiOpacityPainter(createSurface){
  let surface=null;
  return {
    paint(ctx,opacity,bounds,draw){
      if(opacity>=1){draw(ctx);return;}
      if(opacity<=0)return;
      const x=Math.max(0,Math.floor(bounds.x)),y=Math.max(0,Math.floor(bounds.y));
      const width=Math.min(ctx.canvas.width,Math.ceil(bounds.x+bounds.width))-x,height=Math.min(ctx.canvas.height,Math.ceil(bounds.y+bounds.height))-y;
      if(width<=0||height<=0)return;
      surface??=createSurface();
      if(surface.width!==width||surface.height!==height){surface.width=width;surface.height=height;}
      const layer=surface.getContext('2d');if(!layer)throw Error('UI_CANVAS_2D_UNAVAILABLE: opacity layer');
      layer.setTransform(1,0,0,1,0,0);layer.clearRect(0,0,width,height);layer.setTransform(1,0,0,1,-x,-y);draw(layer);
      ctx.save();ctx.globalAlpha=opacity;ctx.drawImage(surface,x,y);ctx.restore();
    },
    dispose(){if(surface){surface.width=surface.height=1;surface=null;}},
  };
}
export function paintUiBox(ctx,style,x,y,w,h,unit,phase='all'){
  const border=Math.min((style.border_width??0)*unit,w,h),radius=(style.border_radius??0)*unit;
  if(phase!=='border'&&style.background){roundedPath(ctx,x,y,w,h,radius);ctx.fillStyle=uiColor(style.background);ctx.fill();}
  if(phase!=='background'&&border>0){const inset=border/2;roundedPath(ctx,x+inset,y+inset,Math.max(0,w-2*inset),Math.max(0,h-2*inset),Math.max(0,radius-inset));ctx.lineWidth=border;ctx.strokeStyle=uiColor(style.border_color,'#ffffff');ctx.stroke();}
}
export function paintUiImage(ctx,node,img,{x,y,width:w,height:h,viewportHeight}){
  const unit=viewportHeight/100,pad=node.style?.padding??{},left=(pad.left??0)*unit,top=(pad.top??0)*unit;
  const width=Math.max(0,w-left-(pad.right??0)*unit),height=Math.max(0,h-top-(pad.bottom??0)*unit);
  if(!width||!height)return 0;
  const iw=img.naturalWidth??img.width,ih=img.naturalHeight??img.height;let regions=0;
  ctx.save();
  try{
    roundedPath(ctx,x,y,w,h,(node.style?.border_radius??0)*unit);ctx.clip();ctx.beginPath();ctx.rect(x+left,y+top,width,height);ctx.clip();
    if(node.slice){
      if(node.fit&&node.fit!=='stretch')throw Error('UI_SLICE_FIT_CONFLICT: omit fit or use stretch');
      for(const [s,d]of slicePatches(node.slice,iw,ih,width,height,viewportHeight)){ctx.drawImage(img,s.x,s.y,s.width,s.height,x+left+d.x,y+top+d.y,d.width,d.height);regions++;}
    }else{
      if(node.fit==='stretch')ctx.drawImage(img,x+left,y+top,width,height);
      else {const scale=node.fit==='cover'?Math.max(width/iw,height/ih):Math.min(width/iw,height/ih);ctx.drawImage(img,x+left+(width-iw*scale)/2,y+top+(height-ih*scale)/2,iw*scale,ih*scale);}regions++;
    }
  }finally{ctx.restore();}
  return regions;
}
export function measureUiText(ctx,text,spacing=0){
  // Canvas includes one trailing tracking advance. The shared contract and
  // native shaped text apply spacing only between glyph clusters.
  if('letterSpacing' in ctx){const previous=ctx.letterSpacing;ctx.letterSpacing=`${spacing}px`;try{return Math.max(0,ctx.measureText(text).width-(text?spacing:0));}finally{ctx.letterSpacing=previous;}}
  const glyphs=textGraphemes(text);return ctx.measureText(text).width+Math.max(0,glyphs.length-1)*spacing;
}
const cjk=/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
function wrapLine(ctx,text,width,spacing){
  const result=[];let rest=textGraphemes(text);
  if(!rest.length)return [''];
  while(rest.length){
    let fit=0,lastBreak=0;
    for(let i=1;i<=rest.length;i++){
      if(measureUiText(ctx,rest.slice(0,i).join(''),spacing)>width&&i>1)break;
      fit=i;
      if(/\s/u.test(rest[i-1])||cjk.test(rest[i-1])||cjk.test(rest[i]??''))lastBreak=i;
      if(i===rest.length)break;
    }
    if(fit===rest.length){result.push(rest.join('').trimEnd());break;}
    const count=lastBreak>0&&lastBreak<=fit?lastBreak:Math.max(1,fit);
    result.push(rest.slice(0,count).join('').trimEnd());rest=rest.slice(count);
    while(rest.length&&/\s/u.test(rest[0]))rest.shift();
  }
  return result;
}
function ellipsize(ctx,text,width,spacing,force=false){
  if(!force&&measureUiText(ctx,text,spacing)<=width)return text;
  const chars=textGraphemes(text.trimEnd());
  if(measureUiText(ctx,'…',spacing)>width)return '';
  while(chars.length&&measureUiText(ctx,chars.join('')+'…',spacing)>width)chars.pop();
  return chars.join('')+'…';
}
export function layoutUiText(ctx,node,{x,y,width,height,viewportHeight,fontFamily='sans-serif',textColor='#ffffff'}){
  const style=node.style??{},unit=viewportHeight/100,pad=style.padding??{};
  const content={x:x+(pad.left??0)*unit,y:y+(pad.top??0)*unit,width:Math.max(0,width-((pad.left??0)+(pad.right??0))*unit),height:Math.max(0,height-((pad.top??0)+(pad.bottom??0))*unit)};
  const family=style.font_family??fontFamily,weight=style.font_weight??400,lineHeight=style.line_height??1.2;
  const spacing=(style.letter_spacing??0)*unit,size=(style.font_size??2)*unit;
  ctx.font=uiFont(family,size,weight);
  let lines=String(node.text??'').split('\n').flatMap(line=>style.wrap==='word'?wrapLine(ctx,line,content.width,spacing):[line]);
  const advance=size*lineHeight;
  if(style.overflow==='ellipsis')lines=lines.map(line=>ellipsize(ctx,line,content.width,spacing));
  const align=style.text_align??node.align??'center',vertical=style.vertical_align??'middle';
  const blockHeight=lines.length*advance,offset=vertical==='top'?0:vertical==='bottom'?content.height-blockHeight:(content.height-blockHeight)/2;
  const placed=lines.map((text,index)=>{const measured=measureUiText(ctx,text,spacing);return {text,x:content.x+(align==='start'?0:align==='end'?content.width-measured:(content.width-measured)/2),y:content.y+offset+(index+.5)*advance,width:measured};});
  return {font:uiFont(family,size,weight),size,spacing,lineHeight,content,lines:placed,color:uiColor(style.color,textColor)};
}
export function paintUiText(ctx,node,bounds){
  if(!node.text)return null;
  const layout=layoutUiText(ctx,node,bounds),c=layout.content;
  ctx.save();ctx.beginPath();ctx.rect(c.x,c.y,c.width,c.height);ctx.clip();ctx.font=layout.font;ctx.fillStyle=layout.color;ctx.textAlign='left';ctx.textBaseline='middle';
  try{
    const nativeTracking='letterSpacing' in ctx;
    if(nativeTracking)ctx.letterSpacing=`${layout.spacing}px`;
    for(const line of layout.lines){
      if(!layout.spacing||nativeTracking)ctx.fillText(line.text,line.x,line.y);
      else {
        if(/[^\p{Script=Latin}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Common}\p{Script=Inherited}]/u.test(line.text))throw Error('UI_TEXT_TRACKING_UNSUPPORTED: this host needs Canvas letterSpacing support to preserve shaping for this script');
        let offset=0,prefix='';for(const glyph of textGraphemes(line.text)){ctx.fillText(glyph,line.x+offset,line.y);prefix+=glyph;offset=ctx.measureText(prefix).width+textGraphemes(prefix).length*layout.spacing;}
      }
    }
  }finally{ctx.restore();}
  return layout;
}

export function presentationFontFaces(ui={}){
  const fonts=[...(ui.fonts??[])];
  for(const face of fonts)if(!/\.(ttf|otf)$/i.test(face.source??''))throw Error('UI_FONT_FORMAT_UNSUPPORTED: ui.fonts supports shared TTF/OTF faces');
  if(ui.font_source){if(!ui.font_family?.trim())throw Error('UI_FONT_FAMILY_REQUIRED');fonts.unshift({family:ui.font_family,source:ui.font_source,weight:400});}
  if(fonts.length>32)throw Error('UI_FONT_LIMIT: at most 32 font faces may be packaged, including font_source');
  const seen=new Set();
  return fonts.map(face=>{const weight=face.weight??400,key=JSON.stringify([face.family,weight]);
    if(typeof face.family!=='string'||!face.family.trim()||new TextEncoder().encode(face.family).length>128||/[\u0000-\u001f\u007f]/.test(face.family)||typeof face.source!=='string'||!face.source.trim()||!Number.isInteger(weight)||weight<100||weight>900)throw Error('UI_FONT_INVALID: family, source and weight 100..900 are required');
    if(seen.has(key))throw Error(`UI_FONT_DUPLICATE: ${face.family} ${weight}`);seen.add(key);return {...face,weight};});
}
