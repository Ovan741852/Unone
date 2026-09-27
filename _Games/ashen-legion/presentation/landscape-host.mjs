// One desktop design space; the complete scene/UI/focus surface scales together.
export const DESKTOP_VIEWPORT={width:1920,height:1080};
export function createLandscapeViewport(canvas){
 function resize(){
  const reserved=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--unone-dev-reserved-right'))||0;
  const available=Math.max(320,innerWidth-reserved);
  document.documentElement.style.setProperty('--desktop-scale',Math.min(available/1920,innerHeight/1080));
 }
 resize();window.addEventListener('resize',resize);
 function toLocal({clientX,clientY}){
  const r=canvas.getBoundingClientRect(),x=(clientX-r.left)/r.width,y=(clientY-r.top)/r.height;
  return {x:x*1920,y:y*1080};
 }
 function toClient({x,y}){
  const r=canvas.getBoundingClientRect(),u=x/canvas.clientWidth,v=y/canvas.clientHeight;
  return {x:r.left+u*r.width,y:r.top+v*r.height};
 }
 function safeInsets(){
  return {left:0,top:0,right:0,bottom:0};
 }
 return {toLocal,toClient,safeInsets,inspect:()=>({...DESKTOP_VIEWPORT,rotationDegrees:0,fixedDesktop:true,scale:canvas.getBoundingClientRect().width/1920})};
}
