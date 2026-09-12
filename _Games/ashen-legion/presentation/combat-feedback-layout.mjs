// Game HUD reservation shared by the floating labels and celebration host.
export const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export const easeOut=t=>1-(1-clamp(t,0,1))**3;
export function combatFeedbackLayout({width,height,insets={}},phase='battle'){
 const portrait=width/height<1.05,scale=height<600?1+Math.min(.5,(600-height)/420):1;
 const raw=phase==='battle'?(portrait?{x:8,y:26,w:84,h:8.5}:{x:35,y:10*scale,w:33,h:8.5*scale}):(portrait?{x:8,y:16,w:84,h:7}:{x:32,y:15,w:36,h:7});
 const l=insets.left??0,r=insets.right??0,t=insets.top??0,b=insets.bottom??0,W=width-l-r,H=height-t-b;
 const slot={x:l+raw.x/100*W,y:t+raw.y/100*H,width:raw.w/100*W,height:raw.h/100*H};
 const w=Math.min(slot.width,slot.height*960/220),h=w*220/960;
 return {portrait,dock:{x:slot.x+(slot.width-w)/2,y:slot.y+(slot.height-h)/2,width:w,height:h},field:{x:l+W*.015,y:t+H*(portrait?.395:.27),width:W*.97,height:H*(portrait?.29:.43)}};
}
export function percentRect(rect,width,height){return {x:rect.x/width*100,y:100-(rect.y+rect.height)/height*100,width:rect.width/width*100,height:rect.height/height*100};}
