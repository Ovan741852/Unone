import {buildPolicies,chooseBuildInput} from './build-policy.mjs';
// Input policies and observation summaries only. All game rules stay in Unone Luau.
export const policies=[...buildPolicies,{id:'sword',name:'劍兵專用',unit:1},{id:'spear',name:'槍兵專用',unit:2},{id:'cavalry',name:'騎兵專用',unit:3}];
export const invariantKeys=['economy_conserved','deployment_cost_conserved','troop_count_conserved','troops_in_bounds','lock_exclusive'];
export async function simulate({seed,policy,load,tick,observe,cancelled=()=>false,progress=async()=>{},maxFrames=90000}){
 await load(seed);
 let frames=0,battleFrames=0,dryFrames=0,firstAwardSeconds=null,minCoins=Infinity,maxCoins=0,roundsCleared=0,bossReached=false;
 let aim={x:0,y:0},canFire=false,lastPhase='';
 const failures=new Set(),choices=[],timeline=[];
 const step=async input=>{await tick(input);frames++;const o=observe();for(const k of invariantKeys)if(o[k]!==true)failures.add(k);if(o.crystal_conserved===false)failures.add("crystal_conserved");return o.game};
 let s=await step({actions:{Start:true}});s=await step({actions:{}});
 while(frames<maxFrames){
  if(cancelled())return {seed,policy:policy.id,status:'cancelled',frames};
  let input={actions:{},pointer:{position:aim,down:false}};
  if(s.phase==='victory'||s.phase==='defeat')break;
  if(policy.build&&s.phase!=='battle'){
   input=chooseBuildInput(s,policy,frames);
   if(s.phase==='clear'&&s.chestCount>0&&frames%180<90)input.actions.OpenChest=true;
   if(s.phase==='clear')roundsCleared=Math.max(roundsCleared,s.round);
   if(Object.keys(input.actions).some(k=>k.startsWith('Buy')||k.startsWith('Equip')||k.startsWith('Accept')||k.startsWith('Choice')))choices.push({round:s.round,action:input.actions,coins:s.coins});
  }else if(s.phase==='choice'){
   if(lastPhase!=='choice'){choices.push({round:s.round,card:Object.values(s.cards??{})[0]?.id??null});input.actions={['Unit'+policy.unit]:true,Choice1:true};}
  }else if(s.phase==='shop'){
   if(frames%2===0)input.actions.LeaveShop=true;
  }else if(s.phase==='clear'){
   roundsCleared=Math.max(roundsCleared,s.round);if((s.presentationDelay??0)<=0&&frames%2===0)input.actions.Next=true;
  }else if(s.phase==='battle'){
   // Deliberately simple, disclosed bot: nearest small enemy, then major boss
   // once present; perfect observation but only retarget every 0.2 seconds.
   if(frames%12===0||lastPhase!=='battle'){
    const all=Object.values(s.monsters??{});const bosses=all.filter(m=>m.rank===5);
    const small=all.filter(m=>m.rank<=2);const candidates=bosses.length?bosses:small.length?small:all;
    const half=s.arenaHalfExtent??7.4,port=half-.3;const origin=[{x:0,z:port},{x:port,z:0},{x:0,z:-port},{x:-port,z:0}][(s.seat??1)-1];
    if(policy.build&&policy.unit>1&&!bosses.length){
     const crowd=m=>all.reduce((total,n)=>total+((m.x-n.x)**2+(m.z-n.z)**2<8?1:0),0);
     candidates.sort((a,b)=>crowd(b)-crowd(a)||a.id-b.id);
    }else candidates.sort((a,b)=>(a.x-origin.x)**2+(a.z-origin.z)**2-((b.x-origin.x)**2+(b.z-origin.z)**2)||a.id-b.id);
    canFire=candidates.length>0;if(canFire)aim={x:candidates[0].x,y:candidates[0].z};
   }
   const unit=policy.build&&!s.bossPresent&&(s.coins<(s.costs?.[policy.unit-1]??40)*5||policy.unit===3&&Object.values(s.monsters??{}).filter(m=>m.rank<=2).length<26)?1:policy.unit;
   input.actions={['Unit'+unit]:true};
   // LOCK is a toggle. Send its rising edge once rather than flipping it every tick.
   if(s.bossPresent){if(!s.lockEnabled)input.actions.Mode_lock=true;if(s.autoEnabled)input.actions.Mode_auto=true;}
   else if(s.lockEnabled||s.autoEnabled)input.actions.Mode_manual=true;
   if(s.bossPresent)input.actions.Filter_boss=true;
   let shotAim=aim;
   if(policy.build&&['rebound','thunder'].includes(policy.id)&&!s.bossPresent){const half=s.arenaHalfExtent??7.4,port=half-.3;const reflectedX=(aim.x<0?-half*2:half*2)-aim.x;const wallX=reflectedX<0?-half+.1:half-.1;shotAim={x:wallX,y:port+(aim.y-port)*wallX/reflectedX}}
   input.pointer={position:shotAim,down:canFire&&(!policy.build||frames%(s.bossPresent?16:unit===1?28:45)===0)};
   if(s.fireRearm||input.actions.Mode_lock||input.actions.Mode_auto||input.actions.Mode_manual)input.pointer.down=false;
   if(policy.build&&s.bossPresent&&frames%120===0)input.actions.Potion1=true;
  }
  lastPhase=s.phase;s=await step(input);
  if(s.phase==='battle'){
   battleFrames++;if(s.coins<(s.costs?.[policy.unit-1]??Infinity))dryFrames++;
   bossReached ||= Boolean(s.bossPresent);minCoins=Math.min(minCoins,s.coins);maxCoins=Math.max(maxCoins,s.coins);
  }
  if((s.event??0)>0&&firstAwardSeconds===null)firstAwardSeconds=battleFrames/60;
  if((frames%120===0)||lastPhase!==s.phase){timeline.push({frame:frames,round:s.round,phase:s.phase,coins:s.coins,crystals:s.crystals,time:s.time,breaks:s.breaks});await progress({seed,policy:policy.id,frames,round:s.round,coins:s.coins});}
 }
 if(s.phase==='clear'||s.phase==='victory')roundsCleared=Math.max(roundsCleared,s.round);
 return {seed,policy:policy.id,status:s.phase==='victory'?'victory':s.phase==='defeat'?(s.time<=0?'timeout':'bankrupt'):'censored',frames,battleSeconds:battleFrames/60,roundsCleared,bossReached,finalCoins:s.coins,finalCrystals:s.crystals,crystalEarned:s.crystalEarned,crystalSpent:s.crystalSpent,crystalSold:s.crystalSold,minCoins:Number.isFinite(minCoins)?minCoins:s.coins,maxCoins,spent:s.spent,earned:s.earned,refunded:s.refunded,fired:s.fired,breaks:s.breaks,criticalHits:s.criticalHits,piercesUsed:s.piercesUsed,spinHits:s.spinHits,firstAwardSeconds,rankEconomy:s.rankEconomy,loadouts:s.loadouts,items:s.items,tech:s.tech,shopSpent:s.shopSpent,lotteryMisses:s.lotteryMisses,town:s.town,unableToAffordSeconds:dryFrames/60,invariantFailures:[...failures],choices,timeline};
}
export function summarize(runs){return policies.map(p=>{const rows=runs.filter(r=>r.policy===p.id&&!['cancelled','censored'].includes(r.status));const n=rows.length;const avg=key=>n?rows.reduce((a,r)=>a+(r[key]??0),0)/n:null;return {policy:p.id,name:p.name,completed:n,victories:rows.filter(r=>r.status==='victory').length,bankruptcies:rows.filter(r=>r.status==='bankrupt').length,timeouts:rows.filter(r=>r.status==='timeout').length,censored:runs.filter(r=>r.policy===p.id&&r.status==='censored').length,meanRoundsCleared:avg('roundsCleared'),meanFinalCoins:avg('finalCoins'),meanDrySeconds:avg('unableToAffordSeconds'),invariantFailures:rows.reduce((a,r)=>a+r.invariantFailures.length,0)}})}
