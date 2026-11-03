import {createShaderMaterials} from '../../web/renderer/shader-materials.js';

const RAD=Math.PI/180;
const finite=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;

function roundedPath(context,width,height,radius){
  context.beginPath();context.moveTo(radius,0);context.lineTo(width-radius,0);context.quadraticCurveTo(width,0,width,radius);
  context.lineTo(width,height-radius);context.quadraticCurveTo(width,height,width-radius,height);context.lineTo(radius,height);
  context.quadraticCurveTo(0,height,0,height-radius);context.lineTo(0,radius);context.quadraticCurveTo(0,0,radius,0);context.closePath();
}

function cardCanvas(image,card){
  const canvas=document.createElement('canvas');canvas.width=600;canvas.height=900;
  const context=canvas.getContext('2d');
  roundedPath(context,600,900,32);context.save();context.clip();
  context.drawImage(image,0,0,600,900);
  const shade=context.createLinearGradient(0,626,0,900);shade.addColorStop(0,'#110c1f00');shade.addColorStop(1,'#110c1fed');
  context.fillStyle=shade;context.fillRect(0,626,600,274);
  context.fillStyle='#ffebc8';context.shadowColor='#000b';context.shadowBlur=8;
  context.font='700 28px "Microsoft JhengHei","PingFang TC",sans-serif';context.fillText(card.rarity||'',38,787);
  context.font='600 32px "Microsoft JhengHei","PingFang TC",sans-serif';context.fillText(card.name||'',38,851,524);
  context.restore();context.shadowBlur=0;context.strokeStyle='#ecd9b5cc';context.lineWidth=3;
  roundedPath(context,598,898,31);context.stroke();return canvas;
}

function backCanvas(){
  const canvas=document.createElement('canvas');canvas.width=600;canvas.height=900;const context=canvas.getContext('2d');
  roundedPath(context,600,900,32);context.save();context.clip();
  const shade=context.createRadialGradient(300,405,20,300,450,600);shade.addColorStop(0,'#704258');shade.addColorStop(1,'#21182f');
  context.fillStyle=shade;context.fillRect(0,0,600,900);context.strokeStyle='#e4be9519';context.lineWidth=2;
  for(let offset=-900;offset<900;offset+=27){context.beginPath();context.moveTo(offset,0);context.lineTo(offset+900,900);context.stroke();}
  context.strokeStyle='#e8bf9288';context.lineWidth=3;context.save();context.translate(30,30);roundedPath(context,540,840,22);context.stroke();context.restore();
  context.strokeRect(48,48,504,804);context.textAlign='center';context.fillStyle='#f4d1a5';
  context.font='90px "Segoe UI Symbol",serif';context.fillText('♛',300,320);
  context.font='700 64px "Microsoft JhengHei",sans-serif';context.fillText('海 王',300,462);
  context.font='24px "Microsoft JhengHei",sans-serif';context.fillText('心 動 典 藏',300,548);
  context.fillStyle='#ce9fb9';context.font='54px "Segoe UI Symbol",serif';context.fillText('♥',300,666);
  context.restore();return canvas;
}

/** A presentation extension using the existing official renderer/context.
 * Luau owns shader definitions and uniforms. The official material adapter owns
 * ShaderMaterial construction/compilation; this module only supplies real meshes,
 * deterministic canvas textures and the observed DOM inspection pose.
 */
export function createCardShader({THREE,ctx,asset}){
  if(!THREE||!ctx?.scene||!ctx?.renderer||!ctx?.camera)throw Error('Card shader requires the official renderer context.');
  const group=new THREE.Group();group.name='HotChickCardShader';group.visible=false;group.renderOrder=9000;ctx.scene.add(group);
  const geometry=new THREE.PlaneGeometry(1,1),front=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({transparent:true,opacity:0}));
  const placeholder=front.material;front.name='card-view-front';front.renderOrder=9010;front.position.z=.006;
  const backTexture=new THREE.CanvasTexture(backCanvas());backTexture.colorSpace=THREE.SRGBColorSpace;backTexture.generateMipmaps=false;backTexture.minFilter=THREE.LinearFilter;backTexture.magFilter=THREE.LinearFilter;
  const backMaterial=new THREE.MeshBasicMaterial({map:backTexture,transparent:true,depthTest:false,depthWrite:false,side:THREE.FrontSide});
  const back=new THREE.Mesh(geometry,backMaterial);back.name='card-view-back';back.renderOrder=9010;back.rotation.y=Math.PI;back.position.z=-.006;
  group.add(front,back);
  const cache=new Map();let factory=null,disposed=false,current=null,status={ready:false,active:false,cardId:null,materialId:null,reason:'idle'};
  const textureSettings=map=>{map.colorSpace=THREE.SRGBColorSpace;map.generateMipmaps=false;map.minFilter=THREE.LinearFilter;map.magFilter=THREE.LinearFilter;return map;};
  function resource(card){
    const key=String(card.id);if(cache.has(key))return cache.get(key);
    const entry={state:'loading',map:null,base:null,error:null,image:null};cache.set(key,entry);
    const image=new Image();entry.image=image;image.decoding='async';
    image.onload=()=>{
      entry.image=null;if(disposed)return;
      try{entry.map=textureSettings(new THREE.CanvasTexture(cardCanvas(image,card)));entry.base=new THREE.MeshBasicMaterial({map:entry.map,color:0xffffff,transparent:true,depthTest:false,depthWrite:false,side:THREE.FrontSide});entry.state='ready';}
      catch(error){entry.state='error';entry.error=String(error);}
    };
    image.onerror=()=>{entry.image=null;entry.state='error';entry.error=`Card image could not load: ${card.imageAsset||key}`;};
    image.src=asset(card.imageAsset||`cards/${key}.webp`);return entry;
  }
  function setVisible(visible){
    group.visible=Boolean(visible)&&Boolean(status.ready)&&!disposed;
    status={...status,active:group.visible};return metadata();
  }
  function update({snapshot,pose,card,canvasRect}={}){
    if(disposed)return {ready:false,active:false,reason:'disposed'};
    const materialId=card?.rarity==='R'?'card_foil':card?.rarity==='SR'?'card_diamond':null;
    if(!materialId){group.visible=false;factory?.clear();front.material=placeholder;current=null;status={ready:false,active:false,cardId:card?.id||null,materialId:null,reason:'normal-card'};return metadata();}
    const world=snapshot?.world||snapshot;
    const rect=pose?.rect,width=finite(rect?.width),height=finite(rect?.height),canvasWidth=finite(canvasRect?.width),canvasHeight=finite(canvasRect?.height);
    const cardId=String(card.id);group.visible=false;
    status={ready:false,active:false,cardId,materialId,reason:'loading'};
    if(!world?.shader_materials?.[materialId]){status.reason='awaiting-official-material-definition';return metadata();}
    if(width<=0||height<=0||canvasWidth<=0||canvasHeight<=0){status.reason='awaiting-card-rectangle';return metadata();}
    const entry=resource(card);if(entry.state!=='ready'){status.reason=entry.state;status.error=entry.error;return metadata();}
    factory??=createShaderMaterials(THREE,ctx.renderer,ctx.backend);
    const selected=factory.assign({id:'card-view-front',shader_material:materialId},entry.base,world);
    selected.depthTest=false;selected.depthWrite=false;selected.side=THREE.FrontSide;front.material=selected;current={entry,cardId,materialId};
    const camera=ctx.camera,visibleWidth=camera.right-camera.left,visibleHeight=camera.top-camera.bottom;
    const left=finite(rect.left,finite(rect.x)),top=finite(rect.top,finite(rect.y));
    const canvasLeft=finite(canvasRect.left,finite(canvasRect.x)),canvasTop=finite(canvasRect.top,finite(canvasRect.y));
    group.position.set(camera.position.x+camera.left+(left+width/2-canvasLeft)/canvasWidth*visibleWidth,camera.position.y+camera.top-(top+height/2-canvasTop)/canvasHeight*visibleHeight,5);
    // pose.rect already includes CSS zoom. Applying pose.zoom again would double it.
    group.scale.set(width/canvasWidth*visibleWidth,height/canvasHeight*visibleHeight,1);
    // CSS y points down; the official camera's world y points up.
    group.rotation.set(-finite(pose.rotationX)*RAD,finite(pose.rotationY)*RAD,0,'XYZ');
    group.visible=true;status={ready:true,active:true,cardId,materialId,reason:'official-shader',pose:{rotationX:finite(pose.rotationX),rotationY:finite(pose.rotationY),zoom:finite(pose.zoom,1)},rect:{left,top,width,height},worldSize:{width:group.scale.x,height:group.scale.y}};
    return metadata();
  }
  function metadata(){
    const material=current?front.material:null;
    const program=material?ctx.renderer.properties?.get?.(material)?.currentProgram:null;
    return {...status,active:group.visible&&!disposed,implementation:'Unone official createShaderMaterials + existing renderer context',backend:ctx.backend,meshes:group.visible?2:0,materialCount:factory?.count||0,materialType:material?.type||null,materialName:material?.name||null,sourceMarker:material?.fragmentShader?.match(/UNONE_MATERIAL:([^\s]+)/)?.[1]||null,compiled:Boolean(program),program:program?{id:program.id,name:program.name,usedTimes:program.usedTimes}:null,uniforms:material?{strength:material.uniforms?.strength?.value,motion:material.uniforms?.motion?.value}:null,textureCount:[...cache.values()].filter(entry=>entry.state==='ready').length,loadedCardId:current?.cardId||null,geometryRotation:{x:group.rotation.x,y:group.rotation.y},worldPosition:{x:group.position.x,y:group.position.y,z:group.position.z},disposed};
  }
  function dispose(){
    if(disposed)return;disposed=true;group.visible=false;group.removeFromParent();
    for(const entry of cache.values()){if(entry.image){entry.image.onload=null;entry.image.onerror=null;entry.image.src='';}entry.base?.dispose();entry.map?.dispose();}cache.clear();
    factory?.dispose();placeholder.dispose();backMaterial.dispose();backTexture.dispose();geometry.dispose();current=null;status={ready:false,active:false,cardId:null,materialId:null,reason:'disposed'};
  }
  return {update,setVisible,metadata,dispose};
}
