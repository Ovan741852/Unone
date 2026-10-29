// Presentation-boundary queues. Same transition semantics as native keyboard.rs
// and mouse.rs; no gameplay action meaning or camera policy lives here.
export function createActionQueue() {
  const physical=new Set(),presented=new Set(),pending=new Map();
  return {
    event(action,down) {
      if(physical.has(action)===down)return;
      if(down)physical.add(action);else physical.delete(action);
      if(!pending.has(action))pending.set(action,[]);
      pending.get(action).push(down);
    },
    tick() {
      for(const [action,queue] of pending) {
        if(queue.shift())presented.add(action);else presented.delete(action);
        if(!queue.length)pending.delete(action);
      }
      return [...presented];
    },
    reset(){physical.clear();presented.clear();pending.clear();},
  };
}

export function createScreenButtonQueue() {
  let physical=false,presented=false;const pending=[];
  return {
    event(down,pointer) {
      if(physical===down)return;
      physical=down;pending.push({down,pointer});
    },
    tick(advance) {
      const edge=advance?pending.shift():undefined;
      if(edge)presented=edge.down;
      return {down:presented,pointer:edge?.pointer};
    },
    reset(){physical=false;presented=false;pending.length=0;},
  };
}
