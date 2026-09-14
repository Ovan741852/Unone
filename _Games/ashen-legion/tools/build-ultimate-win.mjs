// Original low-poly crown, laurel and sunburst; official Unone Lottie subset.
import {writeFileSync} from 'node:fs';
import {validateLottieDocument} from '../presentation/lottie/runtime/lottie.mjs';
const v=k=>({a:0,k}),rgb=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255).concat(1);
const keys=rows=>({a:1,k:rows.map(([t,s],i)=>({t,s:Array.isArray(s)?s:[s],...(i<rows.length-1?{e:Array.isArray(rows[i+1][1])?rows[i+1][1]:[rows[i+1][1]],o:{x:.2,y:0},i:{x:.8,y:1}}:{})}))});
const shape=(points,color)=>[{ty:'sh',ks:v({i:points.map(()=>[0,0]),o:points.map(()=>[0,0]),v:points,c:true})},{ty:'fl',c:v(rgb(color)),o:v(100),r:1}];
const layers=[];
function layer(nm,points,color,{p=[400,240,0],r=0,delay=0,scale=100,opacity}={}){
 layers.push({ty:4,nm,sr:1,ip:0,op:384,st:0,ks:{p:v(p),a:v([0,0,0]),r:v(r),o:opacity??keys([[0,0],[22+delay,0],[30+delay,100],[346,100],[382,0]]),s:keys([[0,[scale*.55,scale*.55,100]],[22+delay,[scale*.65,scale*.65,100]],[34+delay,[scale*1.08,scale*1.08,100]],[49+delay,[scale,scale,100]]])},shapes:shape(points,color)});
}
// Front to back, as required by the Lottie painter.
layer('Heart of the forest',[[0,-54],[23,-20],[0,17],[-23,-20]],'#c44436');
layer('Gem light',[[-2,-47],[15,-21],[-2,-17]],'#ffb57c');
layer('Crown folded gold',[[-112,-48],[-69,-26],[-76,53],[-99,30]],'#d5913d');
layer('Crown folded gold right',[[112,-48],[69,-26],[76,53],[99,30]],'#ad612f');
layer('Crown front',[[-103,-26],[-46,-5],[0,-74],[46,-5],[103,-26],[82,74],[0,99],[-82,74]],'#eeb65b');
layer('Crown bright facets',[[-46,-5],[0,-74],[0,75],[-72,59]],'#ffdc8c');
layer('Crown rim',[[-90,54],[0,80],[90,54],[85,78],[0,105],[-85,78]],'#ffe4a0');
layer('Crown peaks',[[-100,39],[-128,-105],[-65,-53],[0,-146],[65,-53],[128,-105],[100,39],[0,70]],'#ffe2a0');
layer('Crown side tips',[[-104,39],[-132,-111],[-66,-59],[0,-153],[66,-59],[132,-111],[104,39],[0,75]],'#6e382b');
layer('Crimson banner',[[-178,80],[-276,56],[-260,106],[-286,154],[-181,139],[-150,153],[0,128],[150,153],[181,139],[286,154],[260,106],[276,56],[178,80]],'#923b35',{delay:4});
layer('Banner folded ends',[[-185,83],[-218,96],[-181,139],[-150,153],[-161,103]],'#d16243',{delay:4});
layer('Banner folded ends right',[[185,83],[218,96],[181,139],[150,153],[161,103]],'#5c2831',{delay:4});
for(const side of [-1,1])for(let i=0;i<8;i++){
 const a=(-15+i*13)*Math.PI/180,x=side*(164+Math.sin(a)*100),y=121-Math.cos(a)*245;
 layer('Oak leaf '+side+' '+i,[[0,0],[-22,-14],[-32,-39],[-12,-34],[-7,-60],[8,-43],[22,-48],[18,-19]],i%2?'#b58243':'#e9bc72',{p:[400+x,240+y,0],r:side*(20+i*12),delay:i*.7});
}
for(let i=0;i<24;i++){
 const a=i*Math.PI/12,r=205+(i%3)*14,x=400+Math.sin(a)*r,y=225-Math.cos(a)*r;
 layer('Star tip '+i,[[0,-20],[3,-4],[14,0],[3,4],[0,20],[-3,4],[-14,0],[-3,-4]],i%2?'#d49746':'#ffedb6',{p:[x,y,0],r:i*15,scale:60+i%4*15,delay:4+i%3});
}
const doc={v:'5.9.0',fr:60,ip:0,op:384,w:800,h:480,nm:'Forest crown · ultimate ceremony',ddd:0,assets:[],layers,markers:[{tm:0,cm:'gather',dr:0},{tm:27,cm:'impact',dr:0},{tm:52,cm:'count',dr:0},{tm:267,cm:'seal',dr:0},{tm:346,cm:'depart',dr:0}]};
const issues=validateLottieDocument(doc);if(issues.length)throw Error(JSON.stringify(issues));
writeFileSync(new URL('../presentation/lottie/ultimate-crown.json',import.meta.url),JSON.stringify(doc));
console.log('VALIDATED ultimate crown: '+layers.length+' original vector layers');
