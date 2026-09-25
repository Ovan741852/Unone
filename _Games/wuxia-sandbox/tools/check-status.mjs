import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {residentStatus} from '../viewer/status.js';
const calm={alive:true,injury:0,fatigue:0,hunger:0,fear:0,loneliness:0,jealousy:0};
assert.deepEqual(residentStatus(calm).labels,['狀態平穩']);
const raw={...calm,injury:100,fatigue:100,hunger:100,loneliness:100};
const before=structuredClone(raw),status=residentStatus(raw);
assert.equal(status.dead,false);assert.equal(status.hp,0);
assert.equal(status.compact,'重傷 · 疲憊 +2');
assert.deepEqual(status.labels,['重傷','疲憊','飢餓','寂寞']);
assert.ok(status.full.includes('傷勢 100/100')&&status.full.includes('生命 0/100'));
assert.deepEqual(raw,before,'formatting must not mutate snapshots');
assert.equal(residentStatus({...raw,hp:12}).hp,12,'supplied HP takes precedence');
assert.equal(residentStatus({...calm,injury:88}).labels[0],'重傷');
for(const [field,threshold,label]of [['fatigue',78,'疲憊'],['hunger',70,'飢餓'],['fear',60,'惶恐'],['loneliness',65,'寂寞'],['jealousy',55,'吃醋']]){
 assert.ok(!residentStatus({...calm,[field]:threshold-1}).labels.includes(label));
 assert.ok(residentStatus({...calm,[field]:threshold}).labels.includes(label));
}
for(const [injury,label]of [[0,'狀態平穩'],[.1,'受傷'],[59.9,'受傷'],[60,'重傷']])assert.equal(residentStatus({...calm,injury}).labels[0],label);
const deceased=residentStatus({...raw,alive:false,sleeping:true,resting:true,fear:100,jealousy:100});
assert.deepEqual(deceased.labels,['已故']);assert.equal(deceased.full,'已故');
assert.equal(deceased.hp,null);assert.equal(deceased.hpText,'');assert.deepEqual(deceased.metrics,[]);
for(const invalid of [undefined,null,NaN,Infinity,'0',-1]){
 const unknown=residentStatus({...calm,injury:invalid});
 assert.equal(unknown.hp,null);assert.ok(unknown.labels.includes('資料不全'));
 assert.ok(!unknown.labels.includes('狀態平穩'));assert.ok(unknown.full.includes('傷勢 未提供'));
}
assert.equal(residentStatus({}).dead,false);assert.ok(residentStatus({}).full.includes('資料不全'));
for(const flag of [undefined,null,false,1,'true'])assert.deepEqual(residentStatus({...calm,sleeping:flag,resting:flag,action_id:'rest',emotion:'熟睡'}).labels,['狀態平穩']);
assert.ok(residentStatus({...raw,sleeping:true,resting:true}).labels.includes('熟睡'));
assert.ok(residentStatus({...raw,resting:true}).labels.includes('休息中'));
assert.ok(!residentStatus({...raw,sleeping:true,resting:true}).labels.includes('休息中'));
// Execute the actual assignment: failed units are complete for handoff, not successful work.
const source=readFileSync(new URL('../viewer/app.js',import.meta.url),'utf8');
const assignment=source.split('\n').find(line=>line.trim().startsWith("$('person-progress').textContent="));
assert.ok(assignment,'production progress assignment must exist');
for(const [npc,expected]of [
 [{alive:true,task:{failed:true,complete:true}},'本段未完成；原因見互動紀錄／執行結果。'],
 [{alive:true,task:{complete:true}},'本段已完成；下一個計畫可接續執行。'],
 [{alive:true,traveling:true,task:{complete:false}},'正在前往目的地；也能提前規劃下一步。'],
 [{alive:true,hp:0,injury:100,task:{ticks:12,effort:6.375,minutes:48.8,complete:false}},'本段已進行 48 遊戲分鐘／12 次執行。'],
 [{alive:true,task:{ticks:2,minutes:12.8,duration_minutes:30,duration_estimated:true,remaining_minutes:17.2,complete:false}},'本段已進行 12／30 預估遊戲分鐘，剩餘約 17 分鐘。'],
 [{alive:true,task:{ticks:2,minutes:12.8,duration_minutes:30,duration_estimated:true,complete:false}},'本段已進行 12／30 預估遊戲分鐘，剩餘時間未提供。'],
 [{alive:true,task:{ticks:2,minutes:12.8,duration_minutes:null,complete:false}},'本段已進行 12 遊戲分鐘／2 次執行。'],
 [{alive:false,task:{failed:true,complete:true}},'生命已結束，行動停止。'],
 [{alive:true},'等待第一個行動'],[{},'等待第一個行動']
]){
 const before=structuredClone(npc),node={};
 runInNewContext(assignment,{npc,$:id=>{assert.equal(id,'person-progress');return node;}});
 assert.equal(node.textContent,expected);assert.deepEqual(npc,before);
}
const shortLine=source.split('\n').find(line=>line.startsWith('const shortAction='));
const shortAction=runInNewContext(shortLine+'\nshortAction;');
const paired={alive:true,action:'工作',interaction:{head_label:'被治療 · 柳如煙 · 執行中',summary:'雙方已接受，治療中',counterpart_name:'柳如煙'}};
assert.equal(shortAction(paired),paired.interaction.head_label);assert.equal(paired.action,'工作');
assert.equal(shortAction({...paired,alive:false}),'已故');assert.equal(shortAction({alive:true,action:'工作'}),'工作');
assert.match(shortAction({...paired,combat:{mode:'duel',phase:'windup'}}),/切磋.*柳如煙/);
const interactionLine=source.split('\n').find(line=>line.trim().startsWith("$('person-interaction').textContent="));
assert.ok(readFileSync(new URL('../viewer/index.html',import.meta.url),'utf8').includes('id="person-interaction"'));
for(const [npc,expected] of [[paired,'互動中：雙方已接受，治療中'],[{alive:true,last_interaction:{summary:'治療失敗：藥材不足'}},'最近互動：治療失敗：藥材不足'],[{alive:true},''],[{...paired,alive:false},'互動中：雙方已接受，治療中'],
 [{alive:true,task:{failed:true},interaction_result:'傷勢達上限，無法勞動',last_interaction:{summary:'先前交談成功'}},'執行結果：傷勢達上限，無法勞動']]){
 const node={},before=structuredClone(npc);runInNewContext(interactionLine,{npc,dead:npc.alive===false,$:()=>node});
 assert.equal(node.textContent,expected);assert.equal(node.hidden,npc.alive===false||!node.textContent);assert.equal(node.title,node.textContent);assert.deepEqual(npc,before);
}
console.log('Status checks passed: concurrent conditions, progress failure/success, actual pair head/detail wiring, unchanged own action, missing legacy data and dead fallback.');
