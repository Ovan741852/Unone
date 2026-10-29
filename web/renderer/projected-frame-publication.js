// Renderer-local content identity; not a source epoch, world counter, or clock.
// Retain references to immutable packed strings instead of serializing megabytes of base64
// every redraw. Copy the small mutable declarations so in-place edits still revoke proof.
export function framePresentationIdentity(frame,previous=null){
 if(!frame)return null;
 const fields=['id','texture','format','clip_policy','vertex_count','index_count','vertices','indices'];
 function sameDraw(old,d){
  if(!old)return false;
  for(const key of fields)if(old[key]!==d[key])return false;
  return old.material===JSON.stringify(d.material)&&old.scissor===JSON.stringify(d.scissor??null);
 }
 const rgb=frame.initial.rgb8;
 if(previous&&previous.profile===frame.profile&&previous.depth===frame.initial.depth
  &&previous.rgb.every((v,i)=>v===rgb[i])&&previous.draws.length===frame.draws.length
  &&previous.draws.every((d,i)=>sameDraw(d,frame.draws[i])))return previous;
 return {profile:frame.profile,depth:frame.initial.depth,rgb:[...rgb],draws:frame.draws.map(d=>{
  const row={material:JSON.stringify(d.material),scissor:JSON.stringify(d.scissor??null)};
  for(const key of fields)row[key]=d[key];return row;
 })};
}
