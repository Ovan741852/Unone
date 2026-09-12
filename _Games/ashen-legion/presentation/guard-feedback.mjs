// Read actual guard progress and resolved receipts. This never estimates win odds.
export function guardFeedback(monster,state){
 const progress=Math.max(0,Math.min(1,monster.guardProgress??monster.damage/Math.max(1,monster.guard)));
 const last=Object.values(state.lotteryResults??{}).filter(r=>r.monsterId===monster.id).at(-1);
 const recentMiss=last&&!last.won&&state.rewardClock-last.time>=0&&state.rewardClock-last.time<.85;
 const near=progress>=(state.economyTuning?.nearBreak??.7);
 return {progress,near,recentMiss:Boolean(recentMiss),kind:near?'near':recentMiss?'miss':'normal',
  label:near?'即將破防':recentMiss?'未開獎':'破防',percent:Math.floor(progress*100)};
}
