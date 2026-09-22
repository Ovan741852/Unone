// Agent decisions only: all purchases, item rolls and combat resolve in Luau.
export const buildPolicies=[
 ['survival','省錢長征',1,['longlife','hunter_vigor','heat','pierce','recruit']],
 ['thunder','鏡面雷暴',1,['ricochet_precision','crit_power','lightning','pierce','critical']],
 ['rebound','折返蓄力',1,['bounce_power','rebound_charge','bounce_life','pierce','wall_quake']],
 ['momentum','疾風破陣',3,['haste','momentum','finisher','pierce','distance']],
 ['cleave','穿陣旋風',3,['piercing_wave','shock','pierce','longlife','crowd_ring']],
 ['frost','霜鋼重擊',1,['frost_touch','shatter','heavy','slow_force','pierce']],
 ['frenzy','狂獵續航',1,['frenzy','hunter_vigor','pierce','rally','rapid']],
 ['embers','背水餘燼',1,['last_stand','ember_burst','expire_burst','pierce','short_fuse']],
 ['cyclone','落地風環',2,['spin_master','king_hunter','shock','pierce','wide_blade']]
].map(([id,name,unit,skills],index)=>({id,name,unit,skills,build:true,buildIndex:index+1}));
export function chooseBuildInput(s,p,frame){
 const input={actions:{},pointer:{position:{x:0,y:0},down:false}};
 const values=x=>Object.values(x??{}),stock=values(s.stock),items=values(s.items),worn=values(s.worn?.[p.unit-1]);
 const score=id=>{if(id==='pierce'&&p.unit===1)return 20;const i=p.skills.indexOf(id);return i<0?0:10-i};
 // Release action edges every other frame, allowing the normal button semantics.
 if(frame%2)return input;
 input.actions['Unit'+p.unit]=true;
 // A cheap extra contact is the economic foundation of contact-death sword builds.
 const targetBuild=p.unit===1&&!items.some(x=>x.skill==='pierce')?5:p.buildIndex;
 if(s.buildIndex!==targetBuild){input.actions['Build'+targetBuild]=true;return input;}
 if(s.phase==='choice'){
  const cards=values(s.cards);const order=items.length<2?['market','tech','rune','curse','potion','enchant']:['tech','market','rune','enchant','potion','curse'];
  const ranked=cards.map((c,i)=>({i,value:order.indexOf(c.id)})).sort((a,b)=>a.value-b.value);
  input.actions['Choice'+(ranked[0].i+1)]=true;return input;
 }
 if(s.phase==='clear' && s.chestCount>0 && frame%180<90){input.actions.OpenChest=true;return input;}
 if(s.phase==='loadout'){
  const better=items.map((item,i)=>({item,i,score:score(item.skill)+score(item.enchant)})).filter(x=>{
   const old=items.find(y=>y.id===worn[x.item.slot-1]);return x.item.id!==old?.id&&x.score>(old?score(old.skill)+score(old.enchant):0);
  }).sort((a,b)=>b.score-a.score);
  if(better.length){input.actions['Equip'+(better[0].i+1)]=true;return input;}
 }
 if(s.phase==='loadout'){
  const runes=values(s.runes),bag=values(s.runeBag);if(!runes[p.unit-1]){const i=bag.findIndex(n=>n>0);if(i>=0){input.actions['Rune'+(i+1)]=true;return input;}}
  input.actions[s.loadoutReturn==='shop'?'Deploy':'ReturnFromLoadout']=true;return input;
 }
 if(s.phase==='clear'){if(s.presentationDelay<=0)input.actions.Next=true;return input;}
 if(s.phase!=='shop')return input;
 const split=typeof s.crystals==='number';const canUpgrade=price=>split?s.crystals>=price:s.coins-price>=reserve;
 const reserve=Math.max(112,(s.costs?.[p.unit-1]??40)*5);
 if(s.enchantPending){input.actions[score(s.enchantPending.skill)>score(items.find(x=>x.id===s.enchantPending.itemId)?.enchant)?'AcceptEnchant':'KeepEnchant']=true;return input;}
 if(s.location==='market'&&!(s.round<=2&&stock.some(x=>x.sold&&x.kind==='gear'))){
  const choices=stock.map((x,i)=>({x,i})).filter(({x})=>!x.sold&&score(x.skill)>0&&canUpgrade(x.price)&&!items.some(y=>y.skill===x.skill)).sort((a,b)=>score(b.x.skill)-score(a.x.skill));
  if(choices.length){input.actions['Buy'+(choices[0].i+1)]=true;return input;}
  if(!s.refreshUsed&&(split?s.crystals>=14:s.coins>reserve+120)){input.actions.RefreshShop=true;return input;}
 }else if(s.location==='rune'){
  const owned=values(s.runes).some(Boolean)||values(s.runeBag).some(n=>n>0);
  const i=stock.findIndex(x=>!x.sold&&canUpgrade(x.price));if(!owned&&i>=0){input.actions['Buy'+(i+1)]=true;return input;}
 }else if(s.location==='tech'&&!s.researchUsed){
  const picks=stock.map((x,i)=>({x,i})).filter(({x})=>x.unit===p.unit&&score(x.value)>0&&canUpgrade(x.price)).sort((a,b)=>score(b.x.value)-score(a.x.value));
  if(picks.length){input.actions['Buy'+(picks[0].i+1)]=true;return input;}
 }else if(s.location==='potion'&&values(s.potions).length<2&&s.coins>reserve+48){
  const i=stock.findIndex(x=>!x.sold);if(i>=0){input.actions['Buy'+(i+1)]=true;return input;}
 }else if(s.location==='curse'&&s.round<=4&&values(s.curses).length<1){input.actions.Buy2=true;return input;
 }else if(s.location==='enchant'&&s.enchantUses<2&&canUpgrade(split?8:60)){
  const item=items.find(x=>worn.includes(x.id)&&!x.enchant);
  if(item){if(s.equipSlot!==item.slot)input.actions['Slot'+item.slot]=true;else input.actions.Enchant=true;return input;}
 }
 input.actions.LeaveShop=true;return input;
}
