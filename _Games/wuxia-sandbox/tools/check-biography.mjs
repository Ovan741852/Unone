import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {residentBiography} from '../viewer/biography.js';

// Supplied live shape; receipt reasons are test strings, not a reconstructed life story.
const sue={id:'npc_2',name:'蘇晚晴',alive:false,bio:'靠故事與消息維生，最怕茶棚突然安靜。',
 background:'跟著商隊在各地聽故事長大',role:'說書人',personality:'外向、好奇',preferences:'新消息、熱茶、掌聲',
 martial_style:'流雲步',martial_level:75,relationship_summary:'周小滿·朋友、侯三娘·敵對、程子安·熟識',partner_id:'',
 death_cause:'NanoJev 選擇攻擊，傷勢累積致死',wealth:2,
 finance:{income:102,spent:162,shifts:45,employer:'聽雨客棧',receipts:[
  {day:19,kind:'wage',amount:2,from:'聽雨客棧',to:'蘇晚晴',reason:'工錢紀錄'},
  {day:18,kind:'theft',amount:13,from:'蘇晚晴',to:'陳星河',reason:'謀財交易紀錄'},
  {day:18,kind:'purchase',amount:5,from:'蘇晚晴',to:'回春醫館',reason:'藥材購買紀錄'},
  {day:18,kind:'purchase',amount:5,from:'蘇晚晴',to:'聽雨客棧',reason:'飯食購買紀錄'},
  {day:17,kind:'purchase',amount:5,from:'蘇晚晴',to:'回春醫館',reason:'較早的藥材購買紀錄'}]}};
const before=structuredClone(sue),bio=residentBiography(sue);
assert.equal(bio.bio,sue.bio);assert.equal(bio.background,sue.background);
assert.equal(bio.career,'說書人；任職：聽雨客棧');assert.equal(bio.martial,'流雲步 · Lv.75');
assert.ok(bio.preferences.includes('外向、好奇')&&bio.preferences.includes('新消息、熱茶、掌聲'));
assert.equal(bio.relations,sue.relationship_summary);assert.equal(bio.deathCause,sue.death_cause);
assert.equal(bio.estate,'2 文');assert.equal(bio.totals,'本輪累計：完成工作 45 班；收入 102 文；支出 162 文');
assert.equal(bio.records.length,5);assert.ok(bio.records[0].line.startsWith('第 17 日'));
assert.ok(bio.records[4].line.startsWith('第 19 日'));
assert.equal(bio.records[3].line,'第 18 日 · 蘇晚晴 → 陳星河 · 13 文');
assert.equal(bio.records[3].reason,sue.finance.receipts[1].reason);
assert.deepEqual(sue,before,'source snapshot/receipt order must remain untouched');
assert.ok(!JSON.stringify(bio).includes('兇手')&&!JSON.stringify(bio).includes('死亡日期'));
for(const missing of [{},{alive:false,wealth:null,finance:{receipts:{}}},{alive:false,wealth:NaN,finance:{income:NaN,spent:null,shifts:undefined}}]){
 const result=residentBiography(missing);
 assert.equal(result.bio,'未記錄');assert.equal(result.estate,'未記錄');assert.equal(result.deathCause,'未記錄');
 assert.ok(result.totals.includes('完成工作 未記錄'));assert.deepEqual(result.records,[]);
 assert.ok(!JSON.stringify(result).includes('undefined'));
}
assert.equal(residentBiography({wealth:0,finance:{shifts:0,income:0,spent:0}}).estate,'0 文');
assert.equal(residentBiography({finance:{receipts:[{}]}}).records[0].line,'日期未記錄 · 未記錄 → 未記錄 · 未記錄');
assert.ok(residentBiography({...sue,partner_id:'npc_7'},[{id:'npc_7',name:'周小滿'}]).relations.endsWith('伴侶紀錄：周小滿'));
assert.equal(residentBiography({...sue,alive:true,injury:100,hp:0}).dead,false);
assert.equal(residentBiography({alive:undefined}).dead,false);

// Execute the actual panel-placement function against a minimal DOM boundary.
const source=readFileSync(new URL('../viewer/app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../viewer/index.html',import.meta.url),'utf8');
const start=source.indexOf('function biographyRows('),end=source.indexOf('\nfunction select(',start);
assert.ok(start>=0&&end>start);
const nodes=new Map(),$=id=>{assert.ok(html.includes('id="'+id+'"'),'missing HTML selector '+id);if(!nodes.has(id))nodes.set(id,{id,parentElement:null,append(child){child.parentElement=this;}});return nodes.get(id);};
$('biography-home').append($('person-biography'));$('finance-home').append($('person-finance'));
const render=runInNewContext(source.slice(start,end)+'\nbiographyRows;',{$,residentBiography});
for(const alive of [true,false,false,true,false,true]){
 render({...sue,alive},[]);
 assert.equal($('person-biography').parentElement,$(alive?'biography-home':'memorial-life'));
 assert.equal($('person-finance').parentElement,$(alive?'finance-home':'memorial-records'));
 assert.equal($('person-career-row').hidden,alive);assert.equal($('person-career').hidden,alive);
 if(!alive)assert.equal($('person-ledger-details').open,true);
 assert.equal($('person-ledger-heading').textContent,alive?'個人最近收支':'最近留存紀錄（非完整生平）');
}
assert.ok(html.indexOf('id="person-memorial"')<html.indexOf('class="person-identity"'));
assert.ok(source.includes('const bio=biographyRows(npc,vm.npc)'),'production update must use the tested function');
console.log('Biography checks passed: supplied facts, limited chronological receipts, missing data, no mutation, actual dead/living panel relocation and selectors.');
