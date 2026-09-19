// Browser presentation only. Renderers use landscape-local pixels; invert
// the CSS rotation once before UI hit testing or world raycasts.
export function createLandscapeViewport(canvas){
 const portrait=matchMedia('(orientation: portrait)');
 function toLocal({clientX,clientY}){
  const r=canvas.getBoundingClientRect(),x=(clientX-r.left)/r.width,y=(clientY-r.top)/r.height;
  return portrait.matches?{x:y*canvas.clientWidth,y:(1-x)*canvas.clientHeight}:{x:x*canvas.clientWidth,y:y*canvas.clientHeight};
 }
 function toClient({x,y}){
  const r=canvas.getBoundingClientRect(),u=x/canvas.clientWidth,v=y/canvas.clientHeight;
  return portrait.matches?{x:r.left+(1-v)*r.width,y:r.top+u*r.height}:{x:r.left+u*r.width,y:r.top+v*r.height};
 }
 function safeInsets(){
  const s=getComputedStyle(document.documentElement);
  const p=Object.fromEntries(['left','right','top','bottom'].map(k=>[k,parseFloat(s.getPropertyValue('--safe-'+k))||0]));
  return portrait.matches?{left:p.top,top:p.right,right:p.bottom,bottom:p.left}:p;
 }
 return {toLocal,toClient,safeInsets,inspect:()=>({width:canvas.clientWidth,height:canvas.clientHeight,portrait:false,rotationDegrees:portrait.matches?90:0})};
}
