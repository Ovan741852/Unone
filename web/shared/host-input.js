const DEFAULT_POINTER = Object.freeze({
  position: Object.freeze({ x: 0, y: 0 }),
  screen_position: Object.freeze({ x: 0, y: 0 }),
  down: false,
});

function copyPointer(pointer) {
  const position = pointer?.position ?? DEFAULT_POINTER.position;
  const screen = pointer?.screen_position ?? position;
  if (![position.x, position.y, screen.x, screen.y].every(Number.isFinite) || typeof pointer?.down !== "boolean") {
    throw new TypeError("INPUT_FRAME_INVALID: pointer coordinates must be finite numbers and down a boolean");
  }
  return {
    position: { x: position.x, y: position.y },
    screen_position: { x: screen.x, y: screen.y },
    down: pointer.down,
  };
}

function validAction(action) {
  return typeof action === "string" && action.length > 0;
}

/**
 * Normalize browser input into fixed-step frames.
 *
 * Held actions are present on every consumed frame. Pressed actions are
 * edge-triggered and are drained exactly once, independent of how many fixed
 * simulation steps a display callback catches up. Pointer edge frames are
 * retained in order; adjacent pointer moves are coalesced without crossing
 * an edge such as down/up.
 */
export function createHostInput({ initialPointer = DEFAULT_POINTER } = {}) {
  let pointer = copyPointer(initialPointer);
  const held = new Set();
  const pressed = new Set();
  const pointerFrames = [];
  const semanticHeld = new Set(), semanticEdges = [];
  const sliderEvents = [], sliderActive = new Map(), sliderConsumedActive = new Map();
  const sliderPhases = new Set(['start', 'drag', 'end', 'cancel']);
  function cancelSliders() {
    const active = new Map([...sliderConsumedActive, ...sliderActive]);
    sliderEvents.length = 0;
    sliderActive.clear();
    for (const [id, ratio] of active) sliderEvents.push({id, phase:'cancel', ratio});
  }
  function queueSliderInteraction({id, phase, ratio} = {}) {
    if (!validAction(id) || !sliderPhases.has(phase) || !Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
      throw new TypeError('UI_SLIDER_INPUT_INVALID: id, phase and finite ratio 0..1 are required');
    }
    const last = sliderEvents[sliderEvents.length - 1];
    if (phase === 'drag' && last?.id === id && last.phase === 'drag') {
      last.ratio = ratio;
    } else {
      if (sliderEvents.length >= 256 || (!sliderActive.has(id) && !sliderConsumedActive.has(id) && new Set([...sliderActive.keys(), ...sliderConsumedActive.keys()]).size >= 256)) {
        cancelSliders();
        throw new Error('UI_SLIDER_QUEUE_FULL: release pointers and retry');
      }
      sliderEvents.push({id, phase, ratio});
    }
    if (phase === 'start' || phase === 'drag') sliderActive.set(id, ratio);
    else sliderActive.delete(id);
  }
  function queueActionTransition(action,down){
    if(!validAction(action)||typeof down!=='boolean')throw new TypeError('UI_ACTION_INVALID');
    if(semanticEdges.length>=256){semanticEdges.length=0;semanticHeld.clear();throw new Error('UI_ACTION_QUEUE_FULL: release pointers and retry');}
    semanticEdges.push({action,down});
  }

  function queueAction(action) {
    if (validAction(action)) pressed.add(action);
  }

  function setHeld(action, isDown) {
    if (!validAction(action)) return;
    if (isDown) held.add(action);
    else held.delete(action);
  }

  function updatePointer(nextPointer, kind = "edge") {
    pointer = copyPointer(nextPointer);
    const frame = { kind, pointer: copyPointer(pointer) };
    const last = pointerFrames[pointerFrames.length - 1];
    if (kind === "move" && last?.kind === "move") {
      last.pointer = frame.pointer;
    } else {
      pointerFrames.push(frame);
    }
  }

  function consumeFrame() {
    const semantic=semanticEdges.shift();if(semantic){if(semantic.down)semanticHeld.add(semantic.action);else semanticHeld.delete(semantic.action);}
    const edge = pointerFrames.shift();
    const framePointer = edge?.pointer ?? copyPointer(pointer);
    const actions = Object.fromEntries(
      [...new Set([...held, ...pressed, ...semanticHeld])].sort().map((action) => [action, true])
    );
    pressed.clear();
    // A quick tap must reach the model as start, then end on separate ticks.
    // Other slider ids can advance in the same tick, without reordering an id.
    const sliders = [], consumed = new Set(), remaining = [];
    for (const event of sliderEvents) {
      if (consumed.has(event.id)) { remaining.push(event); continue; }
      consumed.add(event.id);
      sliders.push([event.id, {phase:event.phase, ratio:event.ratio}]);
      if (event.phase === 'start' || event.phase === 'drag') sliderConsumedActive.set(event.id, event.ratio);
      else sliderConsumedActive.delete(event.id);
    }
    sliderEvents.splice(0, sliderEvents.length, ...remaining);
    return { actions, pointer: framePointer, ...(consumed.size ? {ui_sliders:Object.fromEntries(sliders)} : {}) };
  }

  function releasePointer() {
    pointer.down = false;
    pointerFrames.length = 0;
  }

  function releaseAll() {
    held.clear();
    pressed.clear();
    releasePointer();
    semanticHeld.clear();semanticEdges.length=0;
    cancelSliders();
  }

  return {
    queueAction,
    queueActionTransition,
    queueSliderInteraction,
    setHeld,
    updatePointer,
    consumeFrame,
    releasePointer,
    releaseAll,
    get pointer() {
      return copyPointer(pointer);
    },
    get heldActions() {
      return [...held].sort();
    },
    get pendingActions() {
      return [...pressed].sort();
    },
    get pendingPointerFrames() {
      return pointerFrames.map(({ kind, pointer: framePointer }) => ({
        kind,
        pointer: copyPointer(framePointer),
      }));
    },
  };
}

export { DEFAULT_POINTER };
