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

// Host data channel names match the engine: 1-128 UTF-8 bytes, not blank, no control characters.
const utf8 = new TextEncoder();
function validHostDataChannel(channel) {
  return typeof channel === 'string' && channel.trim() !== '' && channel.length <= 128 && utf8.encode(channel).length <= 128
    && !/[\u0000-\u001f\u007f-\u009f]/.test(channel);
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
  const textEvents = [], textActive = new Map();
  const textPhases = new Set(['change', 'submit', 'cancel', 'focus', 'blur']);
  // Host data (docs/host-data.md): the latest JSON text per channel, handed to the next tick
  // only. Not user input, so releasing keys and pointers leaves it alone.
  const hostData = new Map();
  const physicalActions=createActionQueue(),screenButtons=new Map();
  // Polled gamepads (player-input.js readGamepads): held buttons and raw axes.
  let gamepads=[];
  function setGamepads(states){
    if(!Array.isArray(states))throw new TypeError('GAMEPAD_INPUT_INVALID: a list of gamepad states is required');
    gamepads=states.map(({slot,left_x,left_y,right_x,right_y,left_trigger,right_trigger,buttons=[]})=>({
      slot,left_x,left_y,right_x,right_y,left_trigger,right_trigger,buttons:[...buttons]}));
  }
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
  function queueTextInputInteraction({id, phase, text, composing} = {}) {
    if (!validAction(id) || new TextEncoder().encode(id).length > 1024 || !textPhases.has(phase)
      || typeof text !== 'string' || new TextEncoder().encode(text).length > 65536 || typeof composing !== 'boolean'
      || (phase === 'submit' && composing)) {
      throw new TypeError('UI_TEXT_INPUT_INVALID: stable id, phase, bounded UTF-8 text and composing flag are required');
    }
    const event = {id, phase, text, composing}, last = textEvents.at(-1);
    if (phase === 'change' && last?.id === id && last.phase === 'change' && last.composing === composing) textEvents[textEvents.length - 1] = event;
    else {
      if (textEvents.length >= 256 || new Set([...textEvents.map(e=>e.id), id]).size > 64) throw new Error('UI_TEXT_INPUT_QUEUE_FULL: stop text admission and retry');
      textEvents.push(event);
    }
    if (phase === 'blur' || phase === 'cancel') textActive.delete(id);
    else textActive.set(id, text);
  }
  function queueHostData(channel, json) {
    if (!validHostDataChannel(channel) || typeof json !== 'string' || (json.length > 87381 && utf8.encode(json).length > 262144)) {
      throw new TypeError('HOST_DATA_INVALID: expected a channel of 1-128 UTF-8 bytes and JSON text of at most 262144 UTF-8 bytes');
    }
    if (!hostData.has(channel) && hostData.size >= 16) throw new Error('HOST_DATA_CHANNELS_FULL: at most 16 channels per tick');
    hostData.set(channel, json);
  }
  function releaseKeyboard() {
    held.clear();heldSorted=null;pressed.clear();physicalActions.reset();
  }

  function queueAction(action) {
    if (validAction(action)) pressed.add(action);
  }

  // Held names sorted once per change, not once per tick: a custom renderer can hold hundreds of packet bits, and
  // rebuilding and sorting them every fixed tick cost more than the game's own frame work on phones.
  let heldSorted = null;
  function setHeld(action, isDown) {
    if (!validAction(action)) return;
    if (isDown) { if (!held.has(action)) { held.add(action); heldSorted = null; } }
    else if (held.delete(action)) heldSorted = null;
  }

  function queuePhysicalAction(action,down) {
    if(!validAction(action)||typeof down!=='boolean')throw new TypeError('PHYSICAL_ACTION_INVALID');
    physicalActions.event(action,down);
  }

  function queueScreenAction(action,down,sample) {
    if(!validAction(action)||typeof down!=='boolean')throw new TypeError('SCREEN_ACTION_INVALID');
    if(!screenButtons.has(action))screenButtons.set(action,createScreenButtonQueue());
    screenButtons.get(action).event(down,copyPointer(sample));
  }

  function releaseScreenActions(){for(const queue of screenButtons.values())queue.reset();}

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
    let framePointer = edge?.pointer ?? copyPointer(pointer),advanceSecondary=edge?.kind!=='edge';
    const physical=physicalActions.tick();
    for(const [action,queue] of screenButtons) {
      const secondary=queue.tick(advanceSecondary);
      if(secondary.down)physical.push(action);
      if(secondary.pointer){framePointer={...secondary.pointer,down:framePointer.down};advanceSecondary=false;}
    }
    const padActions=gamepads.flatMap(pad=>pad.buttons.flatMap(button=>[`Gamepad_${button}`,`Gamepad${pad.slot}_${button}`]));
    heldSorted ??= [...held].sort();
    const names = pressed.size || semanticHeld.size || physical.length || padActions.length
      ? [...new Set([...heldSorted, ...pressed, ...semanticHeld, ...physical, ...padActions])].sort()
      : heldSorted;
    const actions = {};
    for (const action of names) actions[action] = true;
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
    const texts = [], textConsumed = new Set(), textRemaining = [];
    for (const event of textEvents) {
      if (textConsumed.has(event.id)) { textRemaining.push(event); continue; }
      textConsumed.add(event.id);
      texts.push([event.id, {phase:event.phase, text:event.text, composing:event.composing}]);
    }
    textEvents.splice(0, textEvents.length, ...textRemaining);
    const host = hostData.size ? Object.fromEntries(hostData) : null;
    hostData.clear();
    return { actions, pointer: framePointer, ...(consumed.size ? {ui_sliders:Object.fromEntries(sliders)} : {}),
      ...(gamepads.length ? {gamepads:gamepads.map(({buttons,...axes})=>axes)} : {}),
      ...(textConsumed.size ? {ui_text_inputs:Object.fromEntries(texts)} : {}),
      ...(host ? {host_data:host} : {}) };
  }

  function releasePointer() {
    pointer.down = false;
    pointerFrames.length = 0;
  }

  function releaseAll() {
    releaseKeyboard();releaseScreenActions();
    releasePointer();
    semanticHeld.clear();semanticEdges.length=0;
    cancelSliders();
    // Preserve admitted text and submit order across focus/lifecycle barriers.
    // Append a cancellation rather than dropping a just-committed IME value.
    for (const [id,text] of textActive) queueTextInputInteraction({id,phase:'cancel',text,composing:false});
    textActive.clear();
  }

  return {
    queueAction,
    queueActionTransition,
    queueSliderInteraction,
    queueTextInputInteraction,
    queueHostData,
    setHeld,
    queuePhysicalAction,
    queueScreenAction,
    setGamepads,
    updatePointer,
    consumeFrame,
    releasePointer,
    releaseKeyboard,
    releaseScreenActions,
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

// Trusted custom renderers send named game actions through this capability.
// KeyboardEvent.code is reserved for physical keys and intentionally rejects
// arbitrary names. Held packet bits are committed together before the tick;
// button press edges use pulse rather than a DOM key event. sendData hands Luau
// a whole state at once (docs/host-data.md): the value is copied as JSON when
// sent, the next tick reads it with api.input.getHostData(channel), and a later
// send before that tick replaces it. Optional in version 1: feature-detect it.
/**
 * @typedef {Readonly<{version:1, setHeld:(action:string,down:boolean)=>boolean,
 * pulse:(action:string)=>boolean, transition:(action:string,down:boolean)=>boolean,
 * sendData:(channel:string,value:unknown)=>boolean}>} RendererHostActions
 */
export function createRendererHostActions(input, {isActive = () => true} = {}) {
  function validate(action) {
    if (typeof action !== 'string' || action.length < 1 || action.length > 128 || /[\u0000-\u001f\u007f]/.test(action)) {
      throw new TypeError('HOST_ACTION_INVALID: expected a bounded action name');
    }
  }
  return Object.freeze({
    version: 1,
    setHeld(action, down) { validate(action); if (typeof down !== 'boolean') throw new TypeError('HOST_ACTION_INVALID: down must be boolean'); if(!isActive())return false;input.setHeld(action, down);return true; },
    pulse(action) { validate(action);if(!isActive())return false;input.queueAction(action);return true; },
    transition(action, down) { validate(action);if(typeof down!=='boolean')throw new TypeError('HOST_ACTION_INVALID: down must be boolean');if(!isActive())return false;input.queueActionTransition(action, down);return true; },
    sendData(channel, value) {
      if (!validHostDataChannel(channel)) throw new TypeError('HOST_DATA_INVALID: expected a channel of 1-128 UTF-8 bytes without control characters');
      const json = JSON.stringify(value);
      if (typeof json !== 'string') throw new TypeError('HOST_DATA_INVALID: the value must be JSON (an object, array, string, number or boolean)');
      if (!isActive()) return false;
      input.queueHostData(channel, json);
      return true;
    },
  });
}
import {createActionQueue,createScreenButtonQueue} from './physical-input.js';
