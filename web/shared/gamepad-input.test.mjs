import test from 'node:test';
import assert from 'node:assert/strict';
import {GAMEPAD_BUTTONS, readGamepads,createGamepadPolling} from './player-input.js';
import {createHostInput} from './host-input.js';

const pad = (index, overrides = {}) => ({
  index, connected: true, mapping: 'standard',
  axes: [0, 0, 0, 0],
  buttons: GAMEPAD_BUTTONS.map(() => ({pressed: false, value: 0})),
  ...overrides,
});

test('standard pads map to slots, y-up sticks, triggers and pressed button names', () => {
  const buttons = GAMEPAD_BUTTONS.map(() => ({pressed: false, value: 0}));
  buttons[0] = {pressed: true, value: 1};          // A
  buttons[7] = {pressed: true, value: 0.6};        // RT
  buttons[15] = {pressed: true, value: 1};         // Right
  const states = readGamepads([null, pad(1, {axes: [0.5, -0.25, 2, 0.75], buttons}), pad(0, {connected: false}), pad(5)]);
  assert.deepEqual(states, [{slot: 2, left_x: 0.5, left_y: 0.25, right_x: 1, right_y: -0.75, left_trigger: 0, right_trigger: 0.6,
    buttons: ['A', 'RT', 'Right']}], 'disconnected and fifth pads are skipped; out-of-range axes clamp');
  assert.deepEqual(readGamepads(undefined), []);
});

test('host input turns held pad buttons into any-pad and per-slot actions and carries the axes', () => {
  const input = createHostInput();
  input.queuePhysicalAction('Space', true);
  input.setGamepads([{slot: 1, left_x: 0.2, left_y: 0, right_x: 0, right_y: 0, left_trigger: 0, right_trigger: 1, buttons: ['A']}]);
  const frame = input.consumeFrame();
  assert.deepEqual(Object.keys(frame.actions), ['Gamepad1_A', 'Gamepad_A', 'Space']);
  assert.deepEqual(frame.gamepads, [{slot: 1, left_x: 0.2, left_y: 0, right_x: 0, right_y: 0, left_trigger: 0, right_trigger: 1}]);
  // Held while polled as held; gone once the pad disconnects.
  assert.ok(input.consumeFrame().actions.Gamepad_A);
  input.setGamepads([]);
  const idle = input.consumeFrame();
  assert.equal(idle.actions.Gamepad_A, undefined);
  assert.equal(idle.gamepads, undefined, 'frames without pads keep their old shape');
  assert.throws(() => input.setGamepads(null), /GAMEPAD_INPUT_INVALID/);
});

test('explicit iframe policy denial skips the forbidden API and remains bounded',()=>{
 let policyReads=0,reads=0;const polling=createGamepadPolling({document:{permissionsPolicy:{features:()=>['gamepad'],allowsFeature:name=>{assert.equal(name,'gamepad');policyReads++;return false;}}},navigator:{getGamepads(){reads++;throw Error('must not probe denied feature');}}});
 for(let n=0;n<120;n++)assert.deepEqual(polling.poll(),[]);
 assert.equal(reads,0);assert.equal(policyReads,1);assert.deepEqual({...polling.report(),scope:undefined},{state:'blocked',reason:'permissions_policy',browser_calls:0,scope:undefined});
});
test('WebKit SecurityError without policy introspection clears held buttons and keeps pointer and keyboard input',()=>{
 let reads=0;const buttons=GAMEPAD_BUTTONS.map(()=>({pressed:false,value:0}));buttons[0].pressed=true;
 const polling=createGamepadPolling({document:{},navigator:{getGamepads(){if(++reads>1)throw Object.assign(Error('Third-party iframes are not allowed'),{name:'SecurityError'});return [pad(0,{buttons})];}}}),input=createHostInput();
 input.setGamepads(polling.poll());assert(input.consumeFrame().actions.Gamepad_A);
 input.queuePhysicalAction('Space',true);input.setGamepads(polling.poll());const frame=input.consumeFrame();assert(frame.actions.Space);assert.equal(frame.actions.Gamepad_A,undefined);assert.equal(frame.gamepads,undefined);
 for(let n=0;n<120;n++)assert.deepEqual(polling.poll(),[]);assert.equal(reads,2);assert.equal(polling.report().reason,'SecurityError');
});
test('guard includes a denied API getter and absent/non-callable implementations',()=>{
 const denied=Object.defineProperty({},'getGamepads',{get(){throw Object.assign(Error('denied'),{name:'SecurityError'});}});
 const p=createGamepadPolling({navigator:denied,document:null});assert.deepEqual(p.poll(),[]);assert.equal(p.report().state,'blocked');assert.equal(p.report().browser_calls,0);
 for(const navigator of [null,{}, {getGamepads:true}]){const missing=createGamepadPolling({navigator,document:null});assert.deepEqual(missing.poll(),[]);assert.equal(missing.report().reason,'api_missing');}
});
test('unavailable policy introspection does not disable an otherwise working controller',()=>{
 let reads=0;const p=createGamepadPolling({document:{featurePolicy:{features(){throw Error('unsupported policy inspection');}}},navigator:{getGamepads(){reads++;return [pad(0)];}}});
 assert.equal(p.poll()[0].slot,1);assert.equal(p.poll()[0].slot,1);assert.equal(reads,2);assert.equal(p.report().state,'ready');
});
test('unknown policy features defer to a guarded API probe',()=>{
 const p=createGamepadPolling({document:{featurePolicy:{features:()=>['fullscreen'],allowsFeature(){throw Error('should not ask about an unrecognised feature');}}},navigator:{getGamepads:()=>[]}});
 assert.deepEqual(p.poll(),[]);assert.equal(p.report().state,'ready');
});
test('unexpected browser API failure is diagnosed once without hiding mapper errors',()=>{
 const broken=createGamepadPolling({document:null,navigator:{getGamepads(){throw new TypeError('broken device implementation');}}});assert.deepEqual(broken.poll(),[]);assert.equal(broken.report().state,'error');assert.equal(broken.report().reason,'TypeError');assert(Object.isFrozen(broken.report()));
 const malformed=createGamepadPolling({document:null,navigator:{getGamepads:()=>({})}});assert.throws(()=>malformed.poll(),TypeError,'the pure mapper is outside the browser exception guard');
});
