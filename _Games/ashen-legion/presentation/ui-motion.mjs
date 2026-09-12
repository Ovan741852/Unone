// Rect-based motion composed through Unone's official Canvas UI. Rendering,
// inspection and input share one tree. Nothing here changes gameplay or RNG.
const ease=t=>1-Math.pow(1-Math.max(0,Math.min(1,t)),3);
const group=raw=>{
 const id=raw.replace(/_hit_(top|bottom)$/, '');
 const card=id.match(/^auto_(?:card|icon|tick|pick|name|info)_(\d+)$/);if(card)return 'autoCard'+card[1];
 let m=id.match(/^(?:choice_(?:plate_|icon_|name_|desc_)?|stock_(?:panel_|icon_|name_|desc_)|buy_)(\d+)(?:_plate)?$/);
 if(m)return (id.startsWith('choice')?'choice':'stock')+m[1];
 m=id.match(/^(?:gear_(?:icon_|name_|skill_)|equip_|sell_)(\d+)(?:_plate)?$/);if(m)return 'gear'+m[1];
 m=id.match(/^hud_unit_(?:plate_|icon_|caption_)?(\d+)$/);if(m)return 'hud'+m[1];
 m=id.match(/^mode_(?:plate_|icon_|label_)?(manual|lock|auto)$/);if(m)return 'mode'+m[1];
 return id.replace(/_(plate|caption)$/,'');
};
function transform(rect,dx,dy,scale=1,pivot=rect){
 const cx=pivot.x+pivot.width/2,cy=pivot.y+pivot.height/2;
 return {x:cx+(rect.x-cx)*scale+dx,y:cy+(rect.y-cy)*scale+dy,width:rect.width*scale,height:rect.height*scale};
}
export function createUiMotion({reducedMotion=()=>false,now=()=>performance.now()}={}){
 let key='',entered=0,hover='',held='',last=null,frameCount=0,active=false;
 const appeared=new Map(),copy=new Map(),punch=new Map(),press=new Map();
 return {
  pointer(kind,id){const at=now();if(kind==='move')hover=id?group(id):'';if(kind==='down'&&id){held=group(id);press.set(held,at);}if(kind==='up'||kind==='cancel')held='';},
  draw(snapshot){
   const tree=snapshot?.world?.ui??snapshot?.ui;if(!tree)return snapshot;
   const at=now(),game=snapshot?.world?.observations?.game??{},reduced=reducedMotion();
   const contentKey=tree.node+':'+Boolean(game.paused)+':'+(game.uiPage??1);
   if(contentKey!==key){key=contentKey;entered=at;appeared.clear();copy.clear();punch.clear();press.clear();hover='';held='';}
   const age=at-entered,battle=game.phase==='battle'&&!game.paused;
   const boxes=new Map();
   for(const n of tree.children){const g=group(n.id),r=n.rect,b=boxes.get(g);boxes.set(g,b?{x:Math.min(b.x,r.x),y:Math.min(b.y,r.y),width:Math.max(b.x+b.width,r.x+r.width)-Math.min(b.x,r.x),height:Math.max(b.y+b.height,r.y+r.height)-Math.min(b.y,r.y)}:{...r});}
   active=!reduced&&age<720;
   let children=tree.children.map(n=>{
    const g=group(n.id);if(!appeared.has(n.id))appeared.set(n.id,at);
    const before=copy.get(n.id);if(before!==undefined&&before!==n.text&&(/^(coins|crystals)$/.test(n.id)||/^buy_\d+$/.test(n.id)&&n.text==='已取得'))punch.set(g,at);
    if(n.id==='story_quote'&&before!==n.text)appeared.set(n.id,at);
    copy.set(n.id,n.text);
    if(reduced)return n;
    let dx=0,dy=0,scale=1;
    const fixed=/^(menu_art|menu_ground|screen_back|interior_shade|map_back)$/.test(n.id);
    if(!battle&&!fixed){const order=Number(g.match(/(?:choice|stock|gear|autoCard)(\d+)/)?.[1]??0),delay=Math.min(order,5)*20;
     const t=ease((age-delay)/220);dy=-(1-t)*1;
     if(/^(title|subtitle|crest|start|town|menu_prologue)/.test(n.id)){dx=-(1-t)*2;dy=0;}
    }
    const born=at-appeared.get(n.id);if(!battle&&!fixed&&born<320&&age>720){dy-=1.2*(1-ease(born/320));active=true;}
    if(!battle&&n.id==='crest')dy+=Math.sin(at/1100)*.32;
    if(!battle&&n.id==='story_portrait')dy+=Math.sin(at/1400)*.10;
    const pulseAt=punch.get(g);if(pulseAt!==undefined&&at-pulseAt<480){scale+=Math.sin((at-pulseAt)/480*Math.PI)*.025;active=true;}
    const pressAt=press.get(g);if(g===held)scale*=.98;else if(pressAt!==undefined&&at-pressAt<280){scale*=1-.02*(1-ease((at-pressAt)/280));active=true;}
    if(g===hover&&!held&&tree.children.some(c=>group(c.id)===g&&c.kind==='button'))scale*=1.012;
    let out={...n,rect:transform(n.rect,dx,dy,scale,boxes.get(g))};
    // Only flavor dialogue is typed; prices, choices and controls are complete
    // from the first frame. No wait or input lock accompanies a transition.
    if(n.id==='story_quote'&&born<650){const chars=Array.from(n.text??''),visible=Math.max(1,Math.ceil(chars.length*ease(born/650)));out.text=chars.map((c,i)=>i<visible||c==='\n'?c:/[\u0000-\u007f]/.test(c)?' ':'　').join('');active=true;}
    // Keep animated bounds inside the screen, including safe-area layouts.
    out.rect.x=Math.max(0,Math.min(100-out.rect.width,out.rect.x));out.rect.y=Math.max(0,Math.min(100-out.rect.height,out.rect.y));
    return out;
   });
   // Low-cost, deterministic fireflies behind controls; never on the battlefield.
   if(game.phase==='menu'&&tree.node==='menu:home'&&!reduced){
    const sparks=Array.from({length:12},(_,i)=>({kind:'image',id:'ambient_mote_'+i,asset:'texture://ui_mote',fit:'stretch',rect:{x:49+(i*13.71)%45+Math.sin(at/2000+i)*1.2,y:8+(i*17.3+at*.0015)%80,width:.3+(1+Math.sin(at/800+i))*.18,height:.5+(1+Math.sin(at/800+i))*.28}}));
    const index=children.findIndex(n=>n.id==='menu_art')+1;children.splice(index,0,...sparks);
   }
   const ui={...tree,children};last=snapshot.world?{...snapshot,world:{...snapshot.world,ui}}:{...snapshot,ui};frameCount++;return last;
  },
  inspect:()=>({reducedMotion:reducedMotion(),active,frameCount,key,backend:'official-canvas-ui',sharedHitTree:true}),
  tree:()=>last?.world?.ui??last?.ui,
 };
}
