// Presentation camera only. NPC destinations and movement remain authoritative in Luau.
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
export class TownCamera {
 constructor(){this.reset();}
 reset(){this.x=0;this.z=0;this.distance=99;this.yaw=Math.atan2(.19,.73);this.pitch=Math.atan2(.66,Math.hypot(.19,.73));this.followId=null;this.followDistance=42;this.smartTarget=null;this.smartDistance=34;}
 stopFollowing(){this.followId=null;}
 setSmartTarget(position,distance=34){if(position){this.smartTarget={x:position.x,z:position.z};this.smartDistance=distance;}}
 clearSmartTarget(){this.smartTarget=null;}
 focus(position){if(!position)return;this.stopFollowing();this.x=position.x;this.z=position.z;this.distance=42;}
 follow(id,position){if(!position)return;this.clearSmartTarget();this.followId=id;this.followDistance=Math.min(this.distance,42);}
 rotate(dx,dy){
  this.stopFollowing();
  this.yaw=((this.yaw-dx*.006+Math.PI)%(2*Math.PI)+2*Math.PI)%(2*Math.PI)-Math.PI;
  this.pitch=clamp(this.pitch+dy*.005,.35,1.35);
 }
 pan(dx,dy,height){
  this.stopFollowing();
  const scale=2*this.distance*Math.tan(24*Math.PI/180)/Math.max(1,height);
  const right=dx*scale,forward=dy*scale/Math.sin(this.pitch),c=Math.cos(this.yaw),s=Math.sin(this.yaw);
  this.x=clamp(this.x-right*c-forward*s,-65,65);
  this.z=clamp(this.z+right*s-forward*c,-55,55);
 }
 zoom(delta){this.distance=clamp(this.distance*Math.exp(clamp(delta,-1000,1000)*.001),14,150);this.followDistance=this.distance;}
 update(position,dt,reducedMotion=false){
  const target=this.smartTarget||this.followId&&position;
  if(!target){if(this.followId&&!position)this.stopFollowing();return;}
  const alpha=reducedMotion?1:1-Math.exp(-4*clamp(dt,0,.1));
  this.x+=(target.x-this.x)*alpha;this.z+=(target.z-this.z)*alpha;
  this.distance+=((this.smartTarget?this.smartDistance:this.followDistance)-this.distance)*alpha;
 }
 view(){
  const horizontal=this.distance*Math.cos(this.pitch);
  return {position:{x:this.x+horizontal*Math.sin(this.yaw),y:this.distance*Math.sin(this.pitch),z:this.z+horizontal*Math.cos(this.yaw)},target:{x:this.x,y:0,z:this.z},fov_degrees:48};
 }
}
