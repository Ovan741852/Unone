// Renderer-local content identity; not a source epoch, world counter, or clock.
export function framePresentationIdentity(frame){
 if(!frame)return null;
 const draws=frame.draws.map(({data,...declaration})=>declaration);
 return JSON.stringify({profile:frame.profile,initial:frame.initial,draws});
}
