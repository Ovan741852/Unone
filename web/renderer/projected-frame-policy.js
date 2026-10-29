import {FRAME_PROFILES} from '../shared/projected-frame-material.mjs';
export function parseFrameProfile(value){
 if(value===undefined)return null;
 if(!FRAME_PROFILES.includes(value))throw Error('PROJECTED_FRAME_PROFILE_INVALID: '+String(value));return value;
}
export function assertFrameOptions(profile,{backend,raster,antialias,bloom,ao}){
 if(!profile)return;
 if(backend!=='webgl')throw Error('PROJECTED_FRAME_BACKEND_UNSUPPORTED: official WebGL2 only');
 if(raster!=='upper_left_checked'||antialias!==false||bloom||ao)throw Error('PROJECTED_FRAME_PROFILE_UNSUPPORTED: checked/AAfalse/BloomAOoff required');
}
export function assertFrameSnapshot(profile,snapshot,frame){
 const w=snapshot?.world??snapshot;
 if(!profile){if(frame)throw Error('PROJECTED_FRAME_NOT_DECLARED: explicit projected_material_profile required');return;}
 if(!frame)throw Error('PROJECTED_FRAME_REQUIRED: publish complete Frame in Game.start, including empty draws');
 if(w?.projected_world_visible!==false)throw Error('PROJECTED_FRAME_WORLD_DEPTH_UNSUPPORTED: hide world3D explicitly');
 if(Object.keys(w?.projected_geometry??{}).length)throw Error('PROJECTED_FRAME_MIXED');
 if(frame.profile!==profile)throw Error('PROJECTED_FRAME_PROFILE_MISMATCH: constructor and published Frame differ');
}
