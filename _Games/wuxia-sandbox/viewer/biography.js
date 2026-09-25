// Snapshot facts only. Receipt dates are transaction dates, never a death date.
const text=value=>typeof value==='string'&&value.trim()?value:'未記錄';
const known=value=>Number.isFinite(value)&&value>=0;
const amount=(value,unit)=>known(value)?value.toLocaleString('zh-TW')+unit:'未記錄';

export function residentBiography(npc={},people=[]){
 const finance=npc.finance||{},partner=typeof npc.partner_id==='string'&&npc.partner_id?npc.partner_id:null;
 const partnerName=partner?(Array.isArray(people)?people:[]).find(p=>p.id===partner)?.name:null;
 // Luau retains the newest five receipts first; reverse that retained sequence.
 const records=(Array.isArray(finance.receipts)?finance.receipts:[]).filter(r=>r&&typeof r==='object').slice(0,5).reverse().map(r=>({
  line:(known(r.day)&&r.day>=1?'第 '+r.day+' 日':'日期未記錄')+' · '+text(r.from||r.from_id)+' → '+text(r.to||r.to_id)+' · '+amount(r.amount,' 文'),
  reason:text(r.reason)
 }));
 return{dead:npc.alive===false,bio:text(npc.bio),background:text(npc.background),
  career:text(npc.role)+'；任職：'+text(finance.employer),
  preferences:text(npc.personality)+'；喜好：'+text(npc.preferences),
  martial:text(npc.martial_style)+' · '+(known(npc.martial_level)?'Lv.'+npc.martial_level:'等級未記錄'),
  relations:text(npc.relationship_summary)+(partner?'；伴侶紀錄：'+text(partnerName||partner):'')+'；子女：'+(known(npc.children_count)?npc.children_count:0),
  deathCause:text(npc.death_cause),estate:amount(npc.wealth,' 文'),records,
  totals:'本輪累計：完成工作 '+amount(finance.shifts,' 班')+'；收入 '+amount(finance.income,' 文')+'；支出 '+amount(finance.spent,' 文')};
}
