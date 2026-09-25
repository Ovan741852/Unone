// Presentation of supplied state only; injury/HP never determines whether someone is dead.
const fields=[['injury','傷勢'],['fatigue','疲勞'],['hunger','飢餓'],['fear','恐懼'],['loneliness','孤獨'],['jealousy','嫉妒']];
const thresholds=[['fatigue',78,'疲憊'],['hunger',70,'飢餓'],['fear',60,'惶恐'],['loneliness',65,'寂寞'],['jealousy',55,'吃醋']];
const value=n=>Number.isFinite(n)&&n>=0&&n<=100?n:null;
const reading=(label,n)=>label+' '+(n===null?'未提供':n+'/100');

export function residentStatus(npc={}){
 if(npc.alive===false)return{dead:true,hp:null,hpText:'',labels:['已故'],compact:'已故',full:'已故',metrics:[]};
 const stats=Object.fromEntries(fields.map(([key])=>[key,value(npc[key])]));
 const hp=value(npc.hp)??(stats.injury===null?null:Math.ceil(100-stats.injury));
 const hpText=reading('生命',hp),labels=[];
 if(stats.injury>0)labels.push(stats.injury>=60?'重傷':'受傷');
 for(const [key,threshold,label]of thresholds)if(stats[key]!==null&&stats[key]>=threshold)labels.push(label);
 if(npc.sleeping===true)labels.push('熟睡');
 else if(npc.resting===true)labels.push('休息中');
 if(Object.values(stats).some(n=>n===null))labels.push('資料不全');
 if(!labels.length)labels.push('狀態平穩');
 const metrics=[hpText,...fields.map(([key,label])=>reading(label,stats[key]))];
 return{dead:false,hp,hpText,labels,metrics,
  compact:labels.slice(0,2).join(' · ')+(labels.length>2?' +'+(labels.length-2):''),
  full:labels.join(' · ')+'；'+metrics.join(' · ')};
}
