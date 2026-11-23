// Real WebGL diagnostic fixture: invoked by an isolated browser test, not exported.
import {createThreeRenderer} from './three.js';
import {createCanvasUi} from '../shared/canvas-ui.mjs';

export async function compareLayerPaint(canvas) {
 const assert=(ok,message)=>{if(!ok)throw Error(message)};
 const rect={x:0,y:0,width:100,height:100},small={x:25,y:25,width:50,height:50};
 const art={kind:'panel',id:'ground',rect,style:{background:[.18,.3,.4,1]}};
 const foreground={kind:'panel',id:'foreground',rect:small,style:{background:[.9,.2,.1,.42]}};
 const label={kind:'text',id:'name',rect:{x:10,y:58,width:30,height:8},text:'NPC'};
 const button={kind:'button',id:'button',rect:{x:70,y:10,width:20,height:10},text:'OK',action:'Confirm'};
 const group=(id,role,children)=>({kind:'component',id,component:'test.group',render_role:role,rect,children});
 const plain={kind:'screen',id:'plain',node:'town',children:[art,foreground,label,button]};
 const layered={kind:'screen',id:'layered',node:'town',children:[group('scene','scene',[art,foreground]),group('labels','scene_labels',[label]),group('ui','overlay',[button])]};
 const renderer=await createThreeRenderer(canvas,{kind:'three-webgl',antialias:false,frameTransaction:true,webglDefaultDepth:false});
 const ui=createCanvasUi(null,{getPresenter:()=>renderer.ui});
 const draw=tree=>{
  const snapshot={world:{camera:{view_height:5,zoom:1},entities:{},ui:tree}};
  const begun=renderer.frameTransaction.begin(snapshot,{allowResize:true});assert(begun.status==='completed','begin '+JSON.stringify(begun));
  const world=renderer.draw(snapshot),paint=ui.draw(snapshot,{deferRouting:true});
  assert(world.status==='completed'&&paint.status==='completed','draw '+JSON.stringify({world,paint}));
  const token=ui.stagedRoute(),result=renderer.frameTransaction.commit();assert(result.status==='completed','commit');ui.commitRoute(token);
  return {pixels:canvas.toDataURL(),hit:ui.hitTest(80,15)};
 };
 try{
  const before=draw(plain),after=draw(layered);
  assert(before.pixels===after.pixels,'full-resolution pixels differ');
  assert(before.hit?.action==='Confirm'&&after.hit?.action==='Confirm','pointer routing differs');
  return {width:canvas.width,height:canvas.height,matching:true,hit:after.hit,metrics:renderer.metrics().frame_transaction};
 }finally{ui.dispose();renderer.dispose();}
}
