import * as T from 'three';
const canonical=n=>n.replace(/^.*[|:]/,'').replace(/^mixamorig/i,'').toLowerCase();
// Sample world-space bind deltas, then reconstruct target local rotations.
// Keeps target proportions and removes horizontal root motion for the turntable.
export function retargetFBX(source,rig,clip){
 if(!clip||!Number.isFinite(clip.duration)||clip.duration<=0||clip.duration>180)throw Error('需要 0–180 秒的 FBX 動作');
 const src={};source.traverse(o=>{if(o.isBone)src[canonical(o.name)]=o;});
 const required=['Hips','Spine','Head','LeftArm','RightArm','LeftUpLeg','RightUpLeg','LeftLeg','RightLeg'];
 const missing=required.filter(n=>!src[n.toLowerCase()]);if(missing.length)throw Error('缺少人形骨骼：'+missing.join(', '));
 source.updateMatrixWorld(true);const bind={};source.traverse(o=>{if(o.isSkinnedMesh){o.skeleton.bones.forEach((b,i)=>{bind[canonical(b.name)]=new T.Matrix4().copy(o.skeleton.boneInverses[i]).invert();});}});
 const rest={};for(const [n,b]of Object.entries(src))rest[n]=bind[n]?new T.Quaternion().setFromRotationMatrix(new T.Matrix4().extractRotation(bind[n])):b.getWorldQuaternion(new T.Quaternion());
 const hipRest=new T.Vector3().setFromMatrixPosition(bind.hips??src.hips.matrixWorld).y;
 if(Math.abs(hipRest)<.0001)throw Error('FBX 缺少可用的髖部綁定高度');
 const hipPositions=[];
 const mixer=new T.AnimationMixer(source);mixer.clipAction(clip).play();const count=Math.ceil(clip.duration*30)+1,times=[],values={};for(const b of rig.bones)values[b.name]=[];
 for(let i=0;i<count;i++){const t=i/(count-1)*clip.duration;times.push(t);mixer.setTime(Math.min(t,clip.duration-1e-6));source.updateMatrixWorld(true);const world={};for(const b of rig.bones){const n=canonical(b.name),s=src[n],parent=world[b.parent?.name]??new T.Quaternion();const q=s?s.getWorldQuaternion(new T.Quaternion()).multiply(rest[n].clone().invert()):parent.clone();world[b.name]=q;values[b.name].push(...parent.clone().invert().multiply(q).normalize().toArray());}}
 for(const t of times){mixer.setTime(Math.min(t,clip.duration-1e-6));source.updateMatrixWorld(true);hipPositions.push(0,src.hips.getWorldPosition(new T.Vector3()).y/hipRest*rig.rest.mixamorigHips.y,0);}
 mixer.stopAllAction();return {clip:new T.AnimationClip('Mixamo · '+clip.name,clip.duration,[...rig.bones.map(b=>new T.QuaternionKeyframeTrack(b.name+'.quaternion',times,values[b.name])),new T.VectorKeyframeTrack('mixamorigHips.position',times,hipPositions)]),mapped:rig.bones.filter(b=>src[canonical(b.name)]).length};
}
