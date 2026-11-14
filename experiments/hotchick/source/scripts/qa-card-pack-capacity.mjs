import assert from 'node:assert/strict';
import {createCards,packStock} from '../game/presentation/cards.mjs';

// This deterministic DOM fixture executes the production card presenter. The
// official player/browser suite separately verifies layout and native ownership.
let clock=0,nextTimer=1;
const timers=new Map();
class Node {
  constructor(tag){this.tagName=tag.toLowerCase();this.children=[];this.parentNode=null;this.dataset={};this.attributes={};this.listeners=new Map();this.className='';this._text='';this.hidden=false;this.disabled=false;this.root=false;this.style={setProperty(name,value){this[name]=value;}};
    this.classList={contains:name=>this.className.split(/\s+/).includes(name),add:(...names)=>{this.className=[...new Set([...this.className.split(/\s+/).filter(Boolean),...names])].join(' ');},remove:name=>{this.className=this.className.split(/\s+/).filter(value=>value!==name).join(' ');},toggle:(name,force)=>{const on=force??!this.classList.contains(name);if(on)this.classList.add(name);else this.classList.remove(name);return on;}};
  }
  get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
  set textContent(value){this._text=String(value);this.replaceChildren();}
  get isConnected(){return this.root||Boolean(this.parentNode?.isConnected);}
  append(...children){for(const child of children){child.parentNode=this;this.children.push(child);}}
  replaceChildren(...children){for(const child of this.children)child.parentNode=null;this.children=[];this.append(...children);}
  setAttribute(name,value){this.attributes[name]=String(value);}
  addEventListener(name,callback){const handlers=this.listeners.get(name)||new Set();handlers.add(callback);this.listeners.set(name,handlers);}
  removeEventListener(name,callback){this.listeners.get(name)?.delete(callback);}
  contains(node){return node===this||this.children.some(child=>child.contains(node));}
  matches(selector){
    if(selector.startsWith('.'))return selector.slice(1).split('.').every(name=>this.classList.contains(name));
    const attr=selector.match(/^\[data-([\w-]+)(?:=["']?([^"'\]]+)["']?)?\]$/);
    if(attr){const key=attr[1].replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase());return attr[2]===undefined?key in this.dataset:String(this.dataset[key])===attr[2];}
    return this.tagName===selector;
  }
  closest(selector){for(let node=this;node;node=node.parentNode)if(node.matches(selector))return node;return null;}
  querySelectorAll(selector){
    const descendants=[];const visit=node=>{for(const child of node.children){descendants.push(child);visit(child);}};visit(this);
    return descendants.filter(node=>selector.split(',').some(part=>{
      const chain=part.trim().replace(/>/g,' ').split(/\s+/);if(!node.matches(chain.pop()))return false;
      let ancestor=node.parentNode;for(let index=chain.length-1;index>=0;index--){while(ancestor&&!ancestor.matches(chain[index]))ancestor=ancestor.parentNode;if(!ancestor)return false;ancestor=ancestor.parentNode;}return true;
    }));
  }
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  getBoundingClientRect(){return {x:0,y:0,left:0,top:0,right:1280,bottom:720,width:1280,height:720};}
  animate(){return {playState:'running',effect:{target:this},cancel(){this.playState='idle';},pause(){this.playState='paused';},play(){this.playState='running';}};}
  focus(){document.activeElement=this;}
}
const original={document:globalThis.document,window:globalThis.window,performance:globalThis.performance,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout,getComputedStyle:globalThis.getComputedStyle};
globalThis.document={createElement:tag=>new Node(tag),activeElement:null};
globalThis.window={matchMedia:()=>({matches:false}),addEventListener(){},removeEventListener(){}};
globalThis.performance={now:()=>clock};
globalThis.setTimeout=(callback,delay)=>{const id=nextTimer++;timers.set(id,{callback,at:clock+Math.max(0,delay)});return id;};
globalThis.clearTimeout=id=>timers.delete(id);
globalThis.getComputedStyle=node=>({transform:node.style.transform||'none'});
function advance(milliseconds){const until=clock+milliseconds;for(let count=0;count<10000;count++){const next=[...timers.entries()].filter(([,timer])=>timer.at<=until).sort((a,b)=>a[1].at-b[1].at)[0];if(!next){clock=until;return;}timers.delete(next[0]);clock=next[1].at;next[1].callback();}throw Error('unexpected timer loop');}
const catalog=[{id:'normal',name:'一般',rarity:'N',characterId:'test',count:0},{id:'rare',name:'閃卡',rarity:'R',characterId:'test',count:0},{id:'super',name:'鑽卡',rarity:'SR',characterId:'test',count:0}];
const observe=count=>({capacity:9999,batchLimit:10,maxOpen:10,ready:true,canDraw:true,drawsAvailable:count,catalog:catalog.map(card=>({...card})),lastBatch:null});
function fixture(count){const host=new Node('main');host.root=true;const actions=[];const cards=createCards({asset:path=>path,action:code=>actions.push(code)});cards.mountPack(host,observe(count));return {host,cards,actions};}
function click(f,selector){const target=f.host.querySelector(selector);assert(target,`missing ${selector}`);for(const handler of f.host.listeners.get('click')||[])handler({target});}
function deliver(f,available,batchSerial=1,start=1,size=10){const current=observe(available),counts={normal:0,rare:0,super:0};const ids=['normal','rare','super'];const items=Array.from({length:size},(_,index)=>{const cardId=ids[index%ids.length];counts[cardId]++;return{serial:start+index,cardId,count:counts[cardId],isNew:counts[cardId]===1};});current.catalog=current.catalog.map(card=>({...card,count:counts[card.id]}));current.lastBatch={serial:batchSerial,size,items};f.cards.update(current);return current;}
const tests=[];function test(name,run){run();tests.push(name);console.log(`PASS ${name}`);}
try {
  test('stored9999 and per-opening10 are independent even with malformed oversized batch limits',()=>{
    assert.deepEqual(packStock(observe(9999)),{available:9999,capacity:9999,batchLimit:10,nextCount:10});
    assert.equal(packStock({...observe(9999),batchLimit:9999}).nextCount,10);
    assert.equal(packStock(observe(1)).nextCount,1);
  });
  test('9999 stored packs render only ten fan packs and one deliberate draw starts a ten-pack animation',()=>{
    const f=fixture(9999);assert.equal(f.host.querySelectorAll('.hc-sealed-pack').length,10);
    assert.equal(f.host.querySelector('[data-card-action=open-pack]').textContent,'開啟 10 包');
    assert(f.host.querySelector('.hc-pack-stock').textContent.includes('9,999'));
    click(f,'[data-card-action=open-pack]');assert.equal(f.cards.metadata().openingCount,10);assert.equal(f.actions.length,1);
    assert.equal(f.host.querySelectorAll('.hc-sealed-pack').length,10);assert(f.host.querySelectorAll('i').length<100);
    deliver(f,9989);advance(5000);assert.equal(f.host.querySelectorAll('.hc-batch-result').length,10);
    assert.equal(f.host.querySelector('[data-card-action=open-pack]').textContent,'再開 10 包');
    assert(f.host.querySelector('.hc-pack-remaining').textContent.includes('9,989'));
    assert.deepEqual(f.cards.metadata().sortedResults.map(item=>catalog.find(card=>card.id===item.cardId).rarity),['SR','SR','SR','R','R','R','N','N','N','N']);
    advance(10000);assert.equal(f.actions.length,1,'results must not automatically draw the next ten');f.cards.release();
  });
  test('eleven packs open ten, retain one, then only a second explicit click opens the final pack',()=>{
    const f=fixture(11);click(f,'[data-card-action=open-pack]');const remaining=deliver(f,1);advance(5000);
    assert.equal(f.host.querySelector('[data-card-action=open-pack]').textContent,'再開 1 包');assert.equal(f.actions.length,1);
    f.cards.update({...remaining,canDraw:false});assert.equal(f.host.querySelector('[data-card-action=open-pack]').disabled,true);
    f.cards.update({...remaining,canDraw:true});assert.equal(f.host.querySelector('[data-card-action=open-pack]').disabled,false);
    click(f,'[data-card-action=open-pack]');assert.equal(f.cards.metadata().openingCount,1);assert.equal(f.host.querySelectorAll('.hc-sealed-pack').length,1);
    deliver(f,0,2,11,1);advance(5000);assert.equal(f.host.querySelectorAll('.hc-batch-result').length,1);
    assert.equal(f.host.querySelector('[data-card-action=open-pack]'),null);assert.equal(f.actions.length,2);f.cards.release();
  });
  test('ten manually selected batches retain ten-card DOM and busy clicks never queue an extra draw',()=>{
    const f=fixture(9999);
    for(let batch=1;batch<=10;batch++){
      click(f,'[data-card-action=open-pack]');assert.equal(f.cards.metadata().openingCount,10);
      // Delivering another click to the charging scene cannot start another batch.
      const fakeButton=new Node('button');fakeButton.dataset.cardAction='open-pack';f.host.append(fakeButton);
      for(const handler of f.host.listeners.get('click')||[])handler({target:fakeButton});assert.equal(f.actions.length,batch);
      deliver(f,9999-batch*10,batch,(batch-1)*10+1);advance(5000);
      assert.equal(f.host.querySelectorAll('.hc-batch-result').length,10);
      assert.equal(f.cards.metadata().openingCount,10);
    }
    assert.equal(f.actions.length,10);assert(f.host.querySelector('.hc-pack-remaining').textContent.includes('9,899'));f.cards.release();
  });
  test('native readiness and viewport canDraw false prevent a card-draw action',()=>{
    const f=fixture(9999);const blocked={...observe(9999),canDraw:false};f.cards.update(blocked);
    click(f,'[data-card-action=open-pack]');assert.equal(f.actions.length,0);assert.equal(f.cards.metadata().waiting,false);f.cards.release();
  });
} finally {
  for(const [name,value]of Object.entries(original)){if(value===undefined)delete globalThis[name];else globalThis[name]=value;}
}
console.log(`Card pack capacity QA: ${tests.length} checks passed; production presenter with a deterministic DOM fixture, no browser or currency.`);
