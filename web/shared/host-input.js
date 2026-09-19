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
    return { actions, pointer: framePointer };
  }

  function releaseAll() {
    held.clear();
    pressed.clear();
    pointer.down = false;
    pointerFrames.length = 0;
    semanticHeld.clear();semanticEdges.length=0;
  }

  return {
    queueAction,
    queueActionTransition,
    setHeld,
    updatePointer,
    consumeFrame,
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
