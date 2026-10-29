import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createCanvasUi,createUiPointerRouter} from './canvas-ui.mjs';
import {createUiScrollHost} from './ui-scroll.mjs';
import {createUiTextInputHost} from './ui-text-input.mjs';

class Element{
 style={};dataset={};children=[];events=new Map();value='';selectionStart=0;selectionEnd=0;scrollTop=0;scrollLeft=0;
 append(child){child.parent=this;this.children.push(child);}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this);}
 setAttribute(){}
 addEventListener(type,fn){const list=this.events.get(type)??[];list.push(fn);this.events.set(type,list);}
 removeEventListener(type,fn){this.events.set(type,(this.events.get(type)??[]).filter(f=>f!==fn));}
 getBoundingClientRect(){return {x:0,y:0,left:0,top:0,width:1000,height:1000};}
 get clientWidth(){return 1000;}get clientHeight(){return 1000;}get scrollWidth(){return 2000;}get scrollHeight(){return 2000;}
 focus(){this.ownerDocument.activeElement=this;}blur(){this.ownerDocument.activeElement=null;}
 setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;}
}
function makeRetainedHost(kind,never,onRequest){
 const rect={x:10,y:10,width:40,height:40},node={kind:'button',id:'leaf',action:'Activate',text:'',rect};
 const document=new Element(),window=new Element(),canvas=new Element(),stage=new Element();
 document.body=new Element();document.defaultView=window;document.createElement=()=>{const el=new Element();el.ownerDocument=document;return el;};
 canvas.ownerDocument=document;canvas.width=canvas.height=1000;
 canvas.getContext=()=>({setTransform(){},clearRect(){}});
 globalThis.document=document;globalThis.window=window;
 let host,target=rect;
 if(kind==='canvas'){host=createCanvasUi(canvas);host.draw({ui:{children:[node]}});}
 else if(kind==='pointer'){host=createUiPointerRouter();host.setTree({children:[node]});}
 else if(kind==='text'){
  host=createUiTextInputHost({canvas});host.draw({ui:{children:[{...node,kind:'text_input',focused:true}]}});
 }else{
  const keys=Array.from({length:10000},(_,i)=>'key'+i);target=keys;
  host=createUiScrollHost({canvas,stage,requestWindow:()=>{onRequest();return never;}});
  host.draw({ui:{children:[{kind:'scroll_view',id:'rows',rect,children:[],scroll:{axis:'vertical',enabled:true,
   virtual_items:{keys,columns:1,column_width:40,row_height:10,gap_x:0,gap_y:0,first:1,last:1,revision:1}}}]}});
 }
 return {host,ref:new WeakRef(target)};
}

if(process.argv.includes('--ui-retention-child')){
 const never=new Promise(()=>{}),kinds=['canvas','pointer','text','scroll'];let requests=0;
 const handles=kinds.map(kind=>makeRetainedHost(kind,never,()=>requests++));
 // Let the scroll request actually start before disposing. Keeping its promise
 // and every disposed public handle alive must not keep the former UI data.
 await new Promise(setImmediate);assert.equal(requests,1,'the virtual request must actually be pending');for(const {host}of handles)host.dispose();
 let live=[];
 for(let attempt=0;attempt<12;attempt++){
  await new Promise(setImmediate);globalThis.gc();live=handles.flatMap(({ref},i)=>ref.deref()?[kinds[i]]:[]);if(!live.length)break;
 }
 assert.deepEqual(live,[],'disposed public handles / pending host requests retain former UI data');
 assert.equal(handles.length,4);assert(never instanceof Promise);for(const {host}of handles){host.report?.();assert.equal(host.hitTest?.(20,20)??null,null);}
 process.stdout.write('collected canvas,pointer,text,scroll\n');
}else{
 test('disposed UI handles release prior node graphs even while a virtual host request stays pending',()=>{
  const result=spawnSync(process.execPath,['--expose-gc',fileURLToPath(import.meta.url),'--ui-retention-child'],{encoding:'utf8',timeout:15000});
  assert.equal(result.status,0,result.stderr||result.error?.message);assert.match(result.stdout,/collected canvas,pointer,text,scroll/);
 });
}
